#!/usr/bin/env node
/**
 * capture-manifesto — capture the Issue #535 verification screens into
 * `docs/verification/vision/manifesto-*.png`.
 *
 * What this captures
 * ------------------
 * The SHIPPED previews of the "why I make things" experiment: the
 * Storybook stories `src/personal/manifesto/Manifesto.stories.tsx`
 * (`Article` and `Landing`) rendering the data the verification
 * document is proved against
 * (`src/personal/manifesto/Manifesto.preview.ts`). Each variant is
 * captured at a WIDE viewport (1440px) and a NARROW viewport (480px),
 * because Issue #535 asks for the two presentations to be compared at
 * both widths — a landing page that only works wide is not a landing
 * page.
 *
 *   - manifesto-article.png          Article @ 1440
 *   - manifesto-article-narrow.png   Article @ 480
 *   - manifesto-landing.png          Landing @ 1440
 *   - manifesto-landing-narrow.png   Landing @ 480
 *
 * It is also an ASSERTION, not only a picture. From the rendered DOM
 * it reads the document title, every question heading and question
 * text, every evidence statement's source path, every published link
 * `href`, every section heading and every note bullet, and compares
 * them with the preview data module — for BOTH variants. A preview
 * that dropped a question, invented a link, or merged the two Miro
 * values into one slogan fails the capture instead of producing a
 * flattering picture. It also reads whether each render scrolls
 * sideways at its own width (WCAG 2.2 SC 1.4.10 Reflow).
 *
 * Why a generated harness instead of `storybook dev`
 * ---------------------------------------------------
 * `pnpm run build-storybook` in this repository emits a MANAGER-ONLY
 * static build (no `iframe.html`): the `@storybook/react-vite` builder
 * merges the project's `vite.config.ts`, and the
 * `@cloudflare/vite-plugin` + TanStack Start plugins in it take over
 * the output. That defect is recorded in
 * `scripts/capture-error-state-gallery.mjs` (Issue #501) and
 * `scripts/capture-handle-map.mjs` (Issue #524).
 *
 * `storybook dev` itself DOES start and DOES render the stories, but
 * the capture still uses a harness so that it does not depend on a
 * long-lived dev server, so that the DOM assertions run inside the
 * same command as the capture, and so that its result does not depend
 * on the Storybook builder. The harness imports the SHIPPED story
 * module and renders the shipped story's own `render()` output — the
 * same tree Storybook renders — through a local Vite build, so the
 * capture and the Storybook surface cannot drift apart.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, and no secret
 *     is read or printed. The preview data is literals in the source.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port. Chromium refuses ES modules loaded from `file://`,
 *     which is the only reason an origin exists at all.
 *   - Chromium screenshots are not byte-reproducible across processes,
 *     so the report records the conditions instead of claiming a
 *     deterministic artefact.
 *
 * Usage:
 *   node scripts/capture-manifesto.mjs [options]
 *
 *   --screenshot=<path>  NOT used — the four artefact paths are fixed
 *                        by CAPTURES below (the Issue names them).
 *   --json-out=<path>     report destination
 *                         (default .tmp/manifesto/report.json)
 *   --only=<key>          capture a subset: article-wide,
 *                         article-narrow, landing-wide, landing-narrow
 *                         (default: all four)
 *   --no-build            reuse an existing harness build in .tmp
 *   --no-capture          resolve and build everything, write no artefact
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	MANIFESTO_DOCUMENT,
	MANIFESTO_LINKS,
	MANIFESTO_MATERIALS,
	MANIFESTO_NOTES,
	MANIFESTO_QUESTIONS,
	MANIFESTO_SOURCES,
} from '../src/personal/manifesto/Manifesto.preview.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped story module the capture renders. */
export const STORY_MODULE = 'src/personal/manifesto/Manifesto.stories.tsx';

/**
 * The four captures Issue #535 requires, plus the narrow pair.
 *
 * `key` is the `--only` selector; `story` is the exported story the
 * harness renders; `width` is the viewport; `artefact` is the
 * committed PNG path. The wide pair is what the Issue names
 * explicitly; the narrow pair is the same stories at 480px, which is
 * the width the Issue's "狭幅" comparison needs as evidence.
 */
export const CAPTURES = [
	{
		key: 'article-wide',
		story: 'Article',
		variant: 'article',
		width: 1440,
		height: 900,
		artefact: 'docs/verification/vision/manifesto-article.png',
	},
	{
		key: 'article-narrow',
		story: 'Article',
		variant: 'article',
		width: 480,
		height: 900,
		artefact: 'docs/verification/vision/manifesto-article-narrow.png',
	},
	{
		key: 'landing-wide',
		story: 'Landing',
		variant: 'landing',
		width: 1440,
		height: 900,
		artefact: 'docs/verification/vision/manifesto-landing.png',
	},
	{
		key: 'landing-narrow',
		story: 'Landing',
		variant: 'landing',
		width: 480,
		height: 900,
		artefact: 'docs/verification/vision/manifesto-landing-narrow.png',
	},
];

export const HARNESS_DIR = '.tmp/manifesto/harness';
export const HARNESS_DIST = '.tmp/manifesto/harness-dist';

/**
 * Committed captures are PNG with a size budget: a manifesto that
 * grows past this is a sign the preview stopped being a one-screen
 * experiment, not a reason to commit a large binary.
 */
export const PNG_BUDGET_BYTES = 1024 * 1024;

/** Whether a capture fits the verification-artefact budget (pure). */
export function screenshotBudgetVerdict(bytes) {
	return {
		bytes,
		kb: Math.round(bytes / 1024),
		withinBudget: bytes <= PNG_BUDGET_BYTES,
	};
}

/** Reject an output path that is not PNG, or that leaves the repository (pure). */
export function assertPngOutputPath(path, repoRoot = REPO_ROOT) {
	if (extname(path).toLowerCase() !== '.png') {
		throw new Error(`refusing to write a non-PNG verification artefact: ${path}`);
	}
	const rel = relative(repoRoot, resolve(repoRoot, path));
	if (rel.startsWith('..')) {
		throw new Error(`refusing to write outside the repository: ${path}`);
	}
	return resolve(repoRoot, path);
}

/** Collapse a whitespace run so DOM text and data literals compare equal. */
export function collapseText(value) {
	return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** The generated harness entry — imports the shipped story module. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>manifesto preview harness</title>
</head>
<body>
<div id="root"></div>
<script type="module" src="./main.tsx"></script>
</body>
</html>
`;
}

/**
 * The generated harness entry point.
 *
 * `STORY_EXPORT` is substituted per capture: the harness renders the
 * shipped story's own `render()` output — the same tree Storybook
 * renders — so the capture and the Storybook surface cannot drift.
 */
export function harnessMainTsx(storyExport, harnessDir = HARNESS_DIR) {
	const depth = harnessDir.split('/').length;
	const up = '../'.repeat(depth);
	return `import { createRoot } from 'react-dom/client';
import '${up}src/styles.css';
import { ${storyExport} } from '${up}${STORY_MODULE}';

const container = document.getElementById('root');
if (!container) throw new Error('harness root missing');

// Storybook renders the story's own \`render()\` output; the capture
// renders the same thing through the shipped story object, so the two
// surfaces cannot drift apart.
createRoot(container).render(<>{${storyExport}.render?.()}</>);
`;
}

/** The generated Vite config (harness root, repo PostCSS config). */
export function harnessViteConfig(harnessDir = HARNESS_DIR, repoRoot = REPO_ROOT) {
	const depth = harnessDir.split('/').length;
	const outDir = join(repoRoot, HARNESS_DIST);
	return `import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
	root: '${harnessDir}',
	base: './',
	plugins: [react()],
	css: {
		postcss: '${join(repoRoot, 'postcss.config.mjs')}',
	},
	build: {
		outDir: '${outDir}',
		emptyOutDir: true,
	},
});
`;
}

/** Content types the generated harness build needs. */
const CONTENT_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.map': 'application/json; charset=utf-8',
};

/** Resolve one request path inside the served root (pure). */
export function resolveStaticTarget(root, requestPath) {
	const base = resolve(root);
	const candidate = resolve(base, `.${decodeURIComponent(requestPath)}`);
	if (candidate !== base && !candidate.startsWith(`${base}/`)) {
		return { status: 403, file: null };
	}
	const isDirectory = existsSync(candidate) && statSync(candidate).isDirectory();
	const target = existsSync(candidate) && !isDirectory ? candidate : join(candidate, 'index.html');
	if (!existsSync(target)) return { status: 404, file: null };
	return {
		status: 200,
		file: target,
		contentType: CONTENT_TYPES[extname(target)] ?? 'application/octet-stream',
	};
}

/** Serve `root` over loopback on an ephemeral port, for the capture only. */
export function serveDirectory(root) {
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const resolved = resolveStaticTarget(root, url.pathname);
		if (resolved.status !== 200) {
			res.writeHead(resolved.status).end(resolved.status === 403 ? 'forbidden' : 'not found');
			return;
		}
		res.writeHead(200, { 'content-type': resolved.contentType });
		createReadStream(resolved.file).pipe(res);
	});
	return new Promise((resolveServer) => {
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			resolveServer({
				baseUrl: `http://127.0.0.1:${port}`,
				close: () =>
					new Promise((done) => {
						server.closeAllConnections?.();
						server.close(() => done());
					}),
			});
		});
	});
}

/**
 * Write the generated harness for ONE story export (idempotent, so
 * `--no-build` can reuse a matching build only when the story is the
 * same — the caller rebuilds whenever the story changes).
 */
export function writeHarness(storyExport, repoRoot = REPO_ROOT) {
	const dir = resolve(repoRoot, HARNESS_DIR);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'index.html'), harnessIndexHtml());
	writeFileSync(join(dir, 'main.tsx'), harnessMainTsx(storyExport));
	writeFileSync(join(dir, 'vite.config.ts'), harnessViteConfig(HARNESS_DIR, repoRoot));
	return dir;
}

/**
 * Compare the rendered DOM with the preview data (pure).
 *
 * `variant` selects which story rendered ('article' | 'landing').
 * The observation is what the browser read; the data is what the
 * document says. The failures are the difference, so a capture that
 * shows half the questions — or a link the records do not publish —
 * cannot be published as evidence of the whole preview.
 */
export function verifyRenderedPreview(observation, variant, data = defaultData()) {
	const failures = [];

	const expectedTitle = data.document.title;
	if (collapseText(observation.title) !== collapseText(expectedTitle)) {
		failures.push(
			`the document title is "${collapseText(observation.title)}", expected "${collapseText(expectedTitle)}"`,
		);
	}

	// The variant marker the story stamps on its root element — a
	// capture pointed at the wrong story fails here, not silently.
	if (observation.variant !== variant) {
		failures.push(`the rendered variant is "${observation.variant}", expected "${variant}"`);
	}

	const expectedMeta = [
		data.document.status,
		data.document.source,
		data.document.verification,
		data.document.document,
	];
	const renderedMeta = (observation.meta ?? []).map(collapseText);
	for (const value of expectedMeta) {
		if (!renderedMeta.includes(collapseText(value))) {
			failures.push(`the document metadata "${collapseText(value)}" is missing from the preview`);
		}
	}

	// Every question heading AND question text, in order — the Issue's
	// 「2 つの価値を独立の問いとして残す」 is a DOM fact here: a merged
	// or dropped question fails this comparison.
	const expectedQuestions = data.questions.flatMap((q) => [q.heading, q.question]);
	const renderedQuestions = (observation.questions ?? []).map(collapseText);
	for (const expected of expectedQuestions.map(collapseText)) {
		if (!renderedQuestions.includes(expected)) {
			failures.push(`the question text "${expected}" is missing from the ${variant} preview`);
		}
	}
	if (renderedQuestions.length !== expectedQuestions.length) {
		failures.push(
			`the ${variant} preview rendered ${renderedQuestions.length} question block(s), expected ${expectedQuestions.length}`,
		);
	}

	// Every Miro axis citation must appear verbatim — the citation is
	// the only Miro-derived text allowed on the screen. The article
	// prefixes it with `miro:`, so the check is a containment, not an
	// equality.
	for (const question of data.questions) {
		const axis = collapseText(question.miroAxis);
		const rendered = (observation.miroAxes ?? []).map(collapseText);
		if (!rendered.some((value) => value.includes(axis))) {
			failures.push(`the Miro axis citation "${axis}" is missing from the ${variant} preview`);
		}
	}

	// Every evidence statement's source path, as rendered `source:` lines.
	const expectedSourcePaths = [
		...data.sources.map((source) => source.path),
		...data.questions.flatMap((q) =>
			q.evidence.map((e) => data.sources.find((s) => s.id === e.sourceId)?.path),
		),
	].filter((path) => typeof path === 'string');
	const renderedText = collapseText(observation.bodyText ?? '');
	for (const path of new Set(expectedSourcePaths)) {
		if (!renderedText.includes(path)) {
			failures.push(`the source path "${path}" is missing from the ${variant} preview`);
		}
	}

	// Every published link must be an actual <a href>, and the page
	// must not carry a URL the data does not declare — an invented
	// link is exactly what the issue forbids. The comparison is on
	// the UNIQUE href set: the landing variant legitimately renders
	// the same two URLs twice (hero CTA + footer list), which is a
	// presentation choice, not a new link.
	const expectedHrefs = new Set(data.links.map((link) => link.url));
	const renderedHrefs = new Set(observation.hrefs ?? []);
	for (const href of expectedHrefs) {
		if (!renderedHrefs.has(href)) {
			failures.push(`the published link "${href}" is missing from the ${variant} preview`);
		}
	}
	for (const href of renderedHrefs) {
		if (!expectedHrefs.has(href)) {
			failures.push(
				`the ${variant} preview rendered an undeclared link "${href}" — an invented link`,
			);
		}
	}

	// The material labels and the note bullets. Material labels are
	// checked against the whole body text (both variants render them
	// inside different list shapes); notes are read from the marked
	// list so a dropped colophon line fails by name.
	for (const material of data.materials) {
		if (!renderedText.includes(collapseText(material.label))) {
			failures.push(
				`the material "${collapseText(material.label)}" is missing from the ${variant} preview`,
			);
		}
	}
	const renderedNotes = (observation.notes ?? []).map(collapseText);
	const expectedNotes = data.notes.map(collapseText);
	for (const note of expectedNotes) {
		if (!renderedNotes.includes(note)) {
			failures.push(`the note "${note}" is missing from the ${variant} preview`);
		}
	}
	if (renderedNotes.length !== expectedNotes.length) {
		failures.push(
			`the ${variant} preview rendered ${renderedNotes.length} note(s), expected ${expectedNotes.length}`,
		);
	}

	if (observation.scrollWidth > observation.clientWidth) {
		failures.push(
			`the ${variant} preview scrolls sideways (${observation.scrollWidth}px > ${observation.clientWidth}px)`,
		);
	}

	return { ok: failures.length === 0, failures };
}

function defaultData() {
	return {
		document: MANIFESTO_DOCUMENT,
		sources: MANIFESTO_SOURCES,
		materials: MANIFESTO_MATERIALS,
		questions: MANIFESTO_QUESTIONS,
		links: MANIFESTO_LINKS,
		notes: MANIFESTO_NOTES,
	};
}

/** Read the rendered facts out of the page. Runs inside Chromium. */
export const READ_DOCUMENT = () => {
	const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
	const root = document.querySelector('[data-manifesto-variant]');
	return {
		title: text(document.querySelector('h1')),
		variant: root?.getAttribute('data-manifesto-variant') ?? null,
		headings: [...document.querySelectorAll('h1, h2, h3')].map((element) => ({
			level: element.tagName,
			text: text(element),
		})),
		meta: [...document.querySelectorAll('header dl dd')].map(text),
		// Each question block carries `data-manifesto-question`; the
		// heading (h2 in the article, h3 in the landing card) and the
		// question paragraph are read per block, in document order.
		questions: [...document.querySelectorAll('[data-manifesto-question]')].flatMap((el) => [
			text(el.querySelector('h2, h3')),
			text(el.querySelector('p')),
		]),
		miroAxes: [...document.querySelectorAll('code, span')]
			.map(text)
			.filter((value) => value.startsWith('miro:') || value.includes('哲学 >')),
		notes: [...document.querySelectorAll('[data-notes-list] li')].map(text),
		hrefs: [...document.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href')),
		bodyText: document.body.innerText,
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
		scrollHeight: document.documentElement.scrollHeight,
	};
};

function parseArgs(argv) {
	const options = {
		jsonOut: '.tmp/manifesto/report.json',
		only: null,
		build: true,
		capture: true,
	};
	for (const arg of argv) {
		if (arg === '--no-build') {
			options.build = false;
			continue;
		}
		if (arg === '--no-capture') {
			options.capture = false;
			continue;
		}
		if (arg.startsWith('--json-out=')) {
			options.jsonOut = arg.slice('--json-out='.length);
			continue;
		}
		if (arg.startsWith('--only=')) {
			options.only = arg.slice('--only='.length);
			continue;
		}
		if (arg.startsWith('--screenshot=')) {
			throw new Error(
				'--screenshot is not supported: the Issue names the four artefact paths (see CAPTURES)',
			);
		}
		throw new Error(`unknown argument: ${arg}`);
	}
	return options;
}

function selectedCaptures(only) {
	if (!only) return CAPTURES;
	const selected = CAPTURES.filter((capture) => capture.key === only);
	if (selected.length === 0) {
		throw new Error(
			`unknown --only key "${only}"; expected one of ${CAPTURES.map((c) => c.key).join(', ')}`,
		);
	}
	return selected;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const captures = selectedCaptures(options.only);

	// Group by story so the harness is built once per story export.
	const byStory = new Map();
	for (const capture of captures) {
		if (!byStory.has(capture.story)) byStory.set(capture.story, []);
		byStory.get(capture.story).push(capture);
	}

	const results = [];
	for (const [story, storyCaptures] of byStory) {
		writeHarness(story);
		const distRoot = resolve(REPO_ROOT, HARNESS_DIST);
		if (options.build) {
			process.stdout.write(`[capture] building the manifesto harness (${story})…\n`);
			execFileSync(
				'pnpm',
				['exec', 'vite', 'build', '--config', join(HARNESS_DIR, 'vite.config.ts')],
				{ cwd: REPO_ROOT, stdio: 'inherit' },
			);
		} else {
			process.stdout.write(`[capture] reusing the existing harness build (${story})\n`);
		}
		if (!existsSync(join(distRoot, 'index.html'))) {
			throw new Error(`harness build produced no ${HARNESS_DIST}/index.html`);
		}

		const server = await serveDirectory(distRoot);
		try {
			if (!options.capture) {
				process.stdout.write(`[capture] --no-capture: harness built (${story}), nothing written\n`);
				continue;
			}
			const { chromium } = await import('@playwright/test');
			const browser = await chromium.launch();
			try {
				for (const capture of storyCaptures) {
					const artefactPath = assertPngOutputPath(capture.artefact);
					const context = await browser.newContext({
						viewport: { width: capture.width, height: capture.height },
						deviceScaleFactor: 1,
						colorScheme: 'light',
					});
					const page = await context.newPage();
					await page.goto(`${server.baseUrl}/index.html`, { waitUntil: 'networkidle' });
					const observation = await page.evaluate(READ_DOCUMENT);
					const verdict = verifyRenderedPreview(observation, capture.variant);
					if (!verdict.ok) {
						throw new Error(
							`the rendered ${capture.variant} preview does not match the preview data:\n  - ${verdict.failures.join('\n  - ')}`,
						);
					}
					const png = await page.screenshot({ fullPage: true });
					mkdirSync(dirname(artefactPath), { recursive: true });
					writeFileSync(artefactPath, png);
					const budget = screenshotBudgetVerdict(statSync(artefactPath).size);
					process.stdout.write(
						`[capture] wrote ${relative(REPO_ROOT, artefactPath)} (${capture.width}x${observation.scrollHeight}, ${budget.kb} KB, within budget: ${budget.withinBudget})\n`,
					);
					if (!budget.withinBudget) {
						throw new Error(
							`the artefact is ${budget.kb} KB, over the ${Math.round(PNG_BUDGET_BYTES / 1024)} KB budget; the preview grew past a one-screen experiment — narrow the capture or revisit the preview before committing it`,
						);
					}
					results.push({
						key: capture.key,
						story: { module: STORY_MODULE, story: capture.story },
						artefact: relative(REPO_ROOT, artefactPath),
						conditions: {
							viewport: { width: capture.width, height: capture.height },
							deviceScaleFactor: 1,
							colorScheme: 'light',
							waitUntil: 'networkidle',
							screenshot: 'fullPage',
							encode: { format: 'png' },
						},
						observation: {
							variant: observation.variant,
							scrollWidth: observation.scrollWidth,
							clientWidth: observation.clientWidth,
							scrollHeight: observation.scrollHeight,
						},
						verdict,
						capture: { width: capture.width, height: observation.scrollHeight, ...budget },
					});
					await context.close();
				}
			} finally {
				await browser.close();
			}
		} finally {
			await server.close();
		}
	}

	const report = {
		captures: results,
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
	};
	const reportPath = resolve(REPO_ROOT, options.jsonOut);
	mkdirSync(dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(`[capture] report: ${relative(REPO_ROOT, reportPath)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		process.stderr.write(`capture failed: ${error.message}\n`);
		process.exit(1);
	});
}
