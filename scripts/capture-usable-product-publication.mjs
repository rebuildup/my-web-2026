#!/usr/bin/env node
/**
 * capture-usable-product-publication — capture the Issue #515
 * verification screen into
 * `docs/verification/vision/usable-product-checklist.webp`.
 *
 * What this captures
 * ------------------
 * The SHIPPED preview of the usable-product publication checklist: the
 * Storybook story
 * `src/personal/usable-product-publication/UsableProductPublication.stories.tsx`
 * rendering the data the record `docs/personal/usable-product-publication.md`
 * is proved against. The capture is not a drawing of the record — it
 * is the record's own preview, so a screenshot in a pull request
 * cannot show something the site does not render.
 *
 * It is also an ASSERTION, not only a picture. From the rendered DOM
 * it reads the document title, the lead paragraph, every section
 * heading and its prose, every bullet, every stage (name / exit /
 * judgement), every stage check, every worked example (subject /
 * record / facts / per-stage evidence and gap), the adopted and the
 * held decisions, the open questions, and it compares them with the
 * preview data module. A preview that stopped rendering a section, a
 * stage or an example fails the capture instead of producing a
 * flattering picture of half the inventory. It also reads whether the
 * document scrolls sideways at the capture width (WCAG 2.2 SC 1.4.10
 * Reflow).
 *
 * Why a generated harness instead of the Storybook builder
 * ---------------------------------------------------------
 * `pnpm run build-storybook` in this repository emits a MANAGER-ONLY
 * static build (no `iframe.html`): the `@storybook/react-vite` builder
 * merges the project's `vite.config.ts`, and the
 * `@cloudflare/vite-plugin` + TanStack Start plugins in it take over
 * the output. There is therefore no static gallery to photograph.
 * That defect is recorded in `scripts/capture-error-state-gallery.mjs`
 * (Issue #501) and `scripts/capture-a11y-table-code.mjs` (Issue #407).
 *
 * `storybook dev` itself DOES work (measured 2026-10-31:
 * `pnpm exec storybook dev --port 6013` serves the index with HTTP
 * 200 and `iframe.html?id=<story id>` renders the story; the
 * `Missing required secrets for Worker "my-web-2026"` line it prints
 * is a warning from `@cloudflare/vite-plugin`, not a startup
 * failure — the repository already runs
 * `pnpm run a11y:axe-storybook:ci` against a Storybook dev server).
 * The capture still uses a generated harness so that it does not
 * depend on a long-lived dev server, so that the DOM assertions run
 * inside the same command as the capture, and so that its result does
 * not depend on the Storybook builder.
 *
 * The harness below imports the SHIPPED story module and renders the
 * shipped story's OWN component with the shipped story's OWN `args` —
 * which is exactly the tree Storybook renders for that story, because
 * the story declares `component` + `args` rather than a `render`
 * function — through a local Vite build, so the capture and the
 * Storybook surface cannot drift apart.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, and no secret
 *     is read or printed. The preview data is literals in the source.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port.
 *   - Chromium screenshots are not byte-reproducible across processes,
 *     so the report records the conditions instead of claiming a
 *     deterministic artefact.
 *
 * WebP, not PNG
 * -------------
 * A verification artefact does not justify a permanently large binary
 * in the tree. The capture is encoded with the existing `sharp`
 * devDependency at width <= 1440 / quality 80, and the committed file
 * is the `.webp` artefact the record names. The script REFUSES any
 * non-`.webp` output path.
 *
 * Usage:
 *   node scripts/capture-usable-product-publication.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/vision/usable-product-checklist.webp)
 *   --json-out=<path>     report destination
 *                         (default .tmp/usable-product-publication/report.json)
 *   --width=<n>           viewport width (default 1440)
 *   --height=<n>          viewport height (default 900)
 *   --no-build            reuse an existing harness build in .tmp
 *   --no-capture          resolve and build everything, write no artefact
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	usableProductAdopted,
	usableProductExamples,
	usableProductHeld,
	usableProductLabels,
	usableProductLead,
	usableProductOpenDecisions,
	usableProductSections,
	usableProductStages,
	usableProductTitle,
} from '../src/personal/usable-product-publication/UsableProductPublication.preview.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped story module the capture renders. */
export const STORY_MODULE =
	'src/personal/usable-product-publication/UsableProductPublication.stories.tsx';

/**
 * The shipped story the capture renders.
 *
 * The story declares `component` + `args` (not a `render` function), so
 * the harness renders the story's own component with the story's own
 * `args` — the tree Storybook renders for this story.
 */
export const STORY_EXPORT = 'Checklist';

/** The Storybook story id of the captured story (for the record). */
export const STORY_ID = 'preview-usableproductpublication-515--checklist';

export const HARNESS_DIR = '.tmp/usable-product-publication/harness';
export const HARNESS_DIST = '.tmp/usable-product-publication/harness-dist';

/** The one committed artefact path. */
export const DEFAULT_ARTEFACT_PATH = 'docs/verification/vision/usable-product-checklist.webp';

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1440;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

/**
 * The width the committed artefact is encoded at.
 *
 * The checklist is long: the five stages are drawn three times over
 * (once as the stage table, once as the per-stage checks, once as the
 * per-stage evidence notes of every worked example), and three worked
 * examples are attached. The full-page capture therefore costs more
 * than the 300 kB budget a committed verification artefact may
 * occupy, and the budget is never raised to fit a bigger picture. The
 * artefact is encoded narrower instead: the same page, downsampled,
 * stays inside the budget (measured 2026-10-31: 1200 px wide costs
 * 330 kB and is over budget, 1024 px wide costs 260 kB and is under
 * it).
 */
export const ARTEFACT_WIDTH = 1024;

/** The device pixel ratio of the capture (the artefact is downsampled). */
export const SCREENSHOT_DEVICE_SCALE_FACTOR = 1;

/** Whether a capture fits the verification-artefact budget (pure). */
export function screenshotBudgetVerdict(bytes) {
	return {
		bytes,
		kb: Math.round(bytes / 1024),
		withinBudget: bytes <= SCREENSHOT_BUDGET_BYTES,
	};
}

/** Reject an output path that is not WebP, or that leaves the repository (pure). */
export function assertWebpOutputPath(path, repoRoot = REPO_ROOT) {
	if (extname(path).toLowerCase() !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${path}`);
	}
	const rel = relative(repoRoot, resolve(repoRoot, path));
	if (rel.startsWith('..')) {
		throw new Error(`refusing to write outside the repository: ${path}`);
	}
	return resolve(repoRoot, path);
}

/** The generated harness page. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="ja">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>「使えるもの」を配布・API・操作の公開条件に落とす preview (#515)</title>
	</head>
	<body style="margin:0;background:#ffffff">
		<div id="root"></div>
		<script type="module" src="./main.tsx"></script>
	</body>
</html>
`;
}

/**
 * The generated harness entry point.
 *
 * The shipped story declares `component` + `args` (not `render:`), so
 * the harness renders the story's own component with the story's own
 * `args` — the very tree Storybook renders for that story — and loads
 * the shipped global stylesheet so the capture shows the same Panda
 * layer order a reader sees.
 */
export function harnessMainTsx(harnessDir = HARNESS_DIR) {
	const depth = harnessDir.split('/').length;
	const up = '../'.repeat(depth);
	return `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import '${up}src/styles.css';
import meta, { ${STORY_EXPORT} } from '${up}${STORY_MODULE}';

const container = document.getElementById('root');
if (!container) throw new Error('harness root missing');

const Component = meta.component;
if (!Component) {
	throw new Error('the shipped story declares no component');
}

// Storybook renders the story's own component with the story's own
// \`args\`; the capture renders the same tree, so the two surfaces
// cannot drift apart.
createRoot(container).render(createElement(Component, ${STORY_EXPORT}.args));
`;
}

/** The generated Vite config (harness root, repo PostCSS config). */
export function harnessViteConfig(harnessDir = HARNESS_DIR, repoRoot = REPO_ROOT) {
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

/** Write the generated harness (idempotent, so `--no-build` can reuse it). */
export function writeHarness(repoRoot = REPO_ROOT) {
	const dir = resolve(repoRoot, HARNESS_DIR);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'index.html'), harnessIndexHtml());
	writeFileSync(join(dir, 'main.tsx'), harnessMainTsx());
	writeFileSync(join(dir, 'vite.config.ts'), harnessViteConfig(HARNESS_DIR, repoRoot));
	return dir;
}

/**
 * Compare the rendered DOM with the preview data (pure).
 *
 * The observation is what the browser read; the data is what the
 * record says. The failures are the difference, so a capture that
 * shows half the checklist cannot be published as evidence of the
 * whole checklist.
 */
export function verifyRenderedPreview(
	observation,
	data = {
		title: usableProductTitle,
		lead: usableProductLead,
		sections: usableProductSections,
		stages: usableProductStages,
		examples: usableProductExamples,
		adopted: usableProductAdopted,
		held: usableProductHeld,
		open: usableProductOpenDecisions,
		labels: usableProductLabels,
	},
) {
	const failures = [];
	if (!observation?.present) {
		return { ok: false, failures: ['the preview surface was not rendered'] };
	}

	if (observation.title !== data.title) {
		failures.push(`the document title is "${observation.title}", expected "${data.title}"`);
	}
	if (observation.lead !== data.lead) {
		failures.push('the lead paragraph does not match the record');
	}

	const renderedSections = observation.sections ?? [];
	if (renderedSections.length !== data.sections.length) {
		failures.push(
			`the preview rendered ${renderedSections.length} section(s), expected ${data.sections.length}`,
		);
	}

	for (const expected of data.sections) {
		const rendered = renderedSections.find((section) => section.id === expected.id);
		if (!rendered) {
			failures.push(`the section "${expected.heading}" is missing from the preview`);
			continue;
		}
		if (rendered.heading !== expected.heading) {
			failures.push(
				`the section "${expected.id}" renders the heading "${rendered.heading}", expected "${expected.heading}"`,
			);
		}
		for (const paragraph of expected.paragraphs) {
			if (!(rendered.paragraphs ?? []).includes(paragraph)) {
				failures.push(
					`the section "${expected.heading}" did not render the paragraph "${paragraph}"`,
				);
			}
		}
		for (const bullet of expected.bullets) {
			if (!(rendered.items ?? []).includes(bullet)) {
				failures.push(`the section "${expected.heading}" did not render the item "${bullet}"`);
			}
		}
	}

	// The five stages: their name, their exit and their judgement are
	// the exit contract the whole document is about.
	const stageCards = renderedSections.find((section) => section.id === 'stages')?.cards ?? [];
	if (stageCards.length !== data.stages.length) {
		failures.push(
			`the stage section rendered ${stageCards.length} stage card(s), expected ${data.stages.length}`,
		);
	}
	for (const stage of data.stages) {
		const card = stageCards.find((item) => item.stage === stage.id);
		if (!card) {
			failures.push(`the stage "${stage.name}" is not rendered in the stage section`);
			continue;
		}
		if ((card.lines ?? [])[0] !== stage.name) {
			failures.push(`the stage card "${stage.id}" does not carry the stage name "${stage.name}"`);
		}
		if (!(card.lines ?? []).includes(stage.exit)) {
			failures.push(`the stage "${stage.name}" does not render its exit`);
		}
		if (!(card.lines ?? []).includes(stage.judgement)) {
			failures.push(`the stage "${stage.name}" does not render its judgement`);
		}
	}

	// The per-stage checks: every check of every stage is a list item.
	const checklistCards =
		renderedSections.find((section) => section.id === 'checklist')?.cards ?? [];
	if (checklistCards.length !== data.stages.length) {
		failures.push(
			`the checklist section rendered ${checklistCards.length} stage card(s), expected ${data.stages.length}`,
		);
	}
	for (const stage of data.stages) {
		const card = checklistCards.find((item) => item.stage === stage.id);
		if (!card) {
			failures.push(`the checks of the stage "${stage.name}" are not rendered`);
			continue;
		}
		if ((card.lines ?? [])[0] !== stage.name) {
			failures.push(`the check card "${stage.id}" does not carry the stage name "${stage.name}"`);
		}
		for (const item of stage.items) {
			if (!(card.items ?? []).includes(item.label)) {
				failures.push(
					`the checks of the stage "${stage.name}" did not render the item "${item.label}"`,
				);
			}
		}
	}

	// The worked examples: the subject, the committed record, the
	// facts and the per-stage evidence (and the gap, when the record
	// does not answer the stage).
	const exampleSections = renderedSections.filter((section) => section.id.startsWith('example-'));
	if (exampleSections.length !== data.examples.length) {
		failures.push(
			`the preview rendered ${exampleSections.length} example section(s), expected ${data.examples.length}`,
		);
	}
	for (const example of data.examples) {
		const section = exampleSections.find((item) => item.id === `example-${example.id}`);
		if (!section) {
			failures.push(`the example "${example.subject}" is not rendered`);
			continue;
		}
		if (section.subject !== example.subject) {
			failures.push(
				`the example section renders the subject "${section.subject}", expected "${example.subject}"`,
			);
		}
		const expectedMeta = `${example.record}（${example.pointer}）`;
		if (section.record !== expectedMeta) {
			failures.push(
				`the example "${example.subject}" does not render its committed record "${expectedMeta}"`,
			);
		}
		for (const fact of example.facts) {
			const expected = `${fact.label} = ${fact.value}`;
			if (!(section.facts ?? []).includes(expected)) {
				failures.push(`the example "${example.subject}" did not render the fact "${expected}"`);
			}
		}
		for (const note of example.notes) {
			const stage = data.stages.find((item) => item.id === note.stageId);
			const card = (section.cards ?? []).find((item) => item.stage === note.stageId);
			if (!card) {
				failures.push(
					`the example "${example.subject}" does not render the note of the stage "${note.stageId}"`,
				);
				continue;
			}
			if ((card.lines ?? [])[0] !== stage?.name) {
				failures.push(
					`the note card "${note.stageId}" of the example "${example.subject}" does not carry the stage name "${stage?.name}"`,
				);
			}
			if (!(card.lines ?? []).includes(note.evidence)) {
				failures.push(
					`the example "${example.subject}" does not render the evidence of the stage "${note.stageId}"`,
				);
			}
			if (note.gap !== null && !(card.lines ?? []).includes(note.gap)) {
				failures.push(
					`the example "${example.subject}" does not render the gap of the stage "${note.stageId}"`,
				);
			}
		}
	}

	// The decisions: what this Issue adopts, what it holds, and the
	// questions only the owner can answer.
	const decisions = renderedSections.find((section) => section.id === 'decisions');
	const adopted = decisions?.adopted ?? [];
	const held = decisions?.held ?? [];
	if (adopted.length !== data.adopted.length) {
		failures.push(
			`the adopted list rendered ${adopted.length} item(s), expected ${data.adopted.length}`,
		);
	}
	for (const item of data.adopted) {
		if (!adopted.includes(item)) {
			failures.push(`the adopted decision "${item}" is not rendered`);
		}
	}
	if (held.length !== data.held.length) {
		failures.push(`the held list rendered ${held.length} item(s), expected ${data.held.length}`);
	}
	for (const item of data.held) {
		if (!held.includes(item)) {
			failures.push(`the held decision "${item}" is not rendered`);
		}
	}
	const open = renderedSections.find((section) => section.id === 'open');
	const openItems = open?.items ?? [];
	if (openItems.length !== data.open.length) {
		failures.push(
			`the open-decision list rendered ${openItems.length} item(s), expected ${data.open.length}`,
		);
	}
	for (const item of data.open) {
		if (!openItems.includes(item)) {
			failures.push(`the open question "${item}" is not rendered`);
		}
	}

	if (observation.scrollWidth > observation.clientWidth) {
		failures.push(
			`the preview scrolls sideways (${observation.scrollWidth}px > ${observation.clientWidth}px)`,
		);
	}

	return { ok: failures.length === 0, failures };
}

/**
 * Read the rendered facts out of the page. Runs inside Chromium.
 *
 * The observation keeps the facts the record has to be checked
 * against separately, so a failure says WHICH fact is missing instead
 * of "the page differs".
 */
export const READ_PREVIEW = () => {
	const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
	const root = document.querySelector('[data-testid="usable-product-publication"]');
	if (!root) {
		return {
			present: false,
			title: null,
			lead: null,
			sections: [],
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
		};
	}
	const readCard = (card) => ({
		stage: card.getAttribute('data-stage'),
		lines: [...card.querySelectorAll(':scope > p')].map(text),
		items: [...card.querySelectorAll(':scope > ul > li')].map(text),
	});
	const readSection = (section) => {
		const labelledBy = section.getAttribute('aria-labelledby') ?? '';
		const id = labelledBy.replace(/^usable-product-/, '');
		const cards = [...section.querySelectorAll(':scope > div[data-stage]')].map(readCard);
		const firstCard = section.querySelector(':scope > div');
		// The subject paragraph of an example carries the subject as its
		// first text node and a Badge after it, so the subject is read
		// from the text node, not from the paragraph's whole text.
		const subjectParagraph = firstCard?.querySelector('p');
		const subject = subjectParagraph?.firstChild?.textContent?.trim() ?? null;
		const record =
			[...(firstCard?.querySelectorAll(':scope > p') ?? [])]
				.map(text)
				.find((line) => line.includes('（')) ?? null;
		const facts = [...(firstCard?.querySelectorAll(':scope > ul > li') ?? [])].map(text);
		const decisionCards = [...section.querySelectorAll(':scope > div')];
		return {
			id,
			heading: text(section.querySelector('h2')),
			paragraphs: [...section.querySelectorAll(':scope > p')].map(text),
			items: [...section.querySelectorAll(':scope > ul > li')].map(text),
			cards,
			subject,
			record,
			facts,
			adopted: [...(decisionCards[0]?.querySelectorAll(':scope > ul > li') ?? [])].map(text),
			held: [...(decisionCards[1]?.querySelectorAll(':scope > ul > li') ?? [])].map(text),
		};
	};
	const pageHeader = root.querySelector('header');
	return {
		present: true,
		title: text(root.querySelector('h1')),
		lead: text(pageHeader?.querySelector('p')),
		sections: [...root.querySelectorAll('section[aria-labelledby^="usable-product-"]')].map(
			readSection,
		),
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
		pageHeight: document.documentElement.scrollHeight,
	};
};

function parseArgs(argv) {
	const options = {
		screenshot: DEFAULT_ARTEFACT_PATH,
		jsonOut: '.tmp/usable-product-publication/report.json',
		width: 1440,
		height: 900,
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
		if (arg.startsWith('--screenshot=')) {
			options.screenshot = arg.slice('--screenshot='.length);
			continue;
		}
		if (arg.startsWith('--json-out=')) {
			options.jsonOut = arg.slice('--json-out='.length);
			continue;
		}
		if (arg.startsWith('--width=')) {
			options.width = Number(arg.slice('--width='.length));
			continue;
		}
		if (arg.startsWith('--height=')) {
			options.height = Number(arg.slice('--height='.length));
			continue;
		}
		throw new Error(`unknown argument: ${arg}`);
	}
	return options;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const artefactPath = assertWebpOutputPath(options.screenshot);

	writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);

	if (options.build) {
		process.stdout.write('[capture] building the usable-product harness…\n');
		execFileSync(
			'pnpm',
			['exec', 'vite', 'build', '--config', join(HARNESS_DIR, 'vite.config.ts')],
			{ cwd: REPO_ROOT, stdio: 'inherit' },
		);
	} else {
		process.stdout.write('[capture] reusing the existing harness build\n');
	}
	if (!existsSync(join(distRoot, 'index.html'))) {
		throw new Error(`harness build produced no ${HARNESS_DIST}/index.html`);
	}

	const server = await serveDirectory(distRoot);
	let observation = null;
	let verdict = null;
	try {
		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: harness built, nothing written\n');
		} else {
			const { chromium } = await import('@playwright/test');
			const sharp = (await import('sharp')).default;
			const browser = await chromium.launch();
			try {
				const context = await browser.newContext({
					viewport: { width: options.width, height: options.height },
					deviceScaleFactor: SCREENSHOT_DEVICE_SCALE_FACTOR,
					colorScheme: 'light',
				});
				const page = await context.newPage();
				await page.goto(`${server.baseUrl}/index.html`, { waitUntil: 'networkidle' });
				observation = await page.evaluate(READ_PREVIEW);
				verdict = verifyRenderedPreview(observation);
				if (!verdict.ok) {
					// A failed verification must not leave a picture behind
					// that claims to be the verified artefact.
					rmSync(artefactPath, { force: true });
					throw new Error(
						`the rendered preview does not match the record data:\n  - ${verdict.failures.join('\n  - ')}`,
					);
				}
				const png = await page.screenshot({ fullPage: true });
				mkdirSync(dirname(artefactPath), { recursive: true });
				await sharp(png)
					.resize({
						width: Math.min(ARTEFACT_WIDTH, SCREENSHOT_MAX_WIDTH),
						withoutEnlargement: true,
					})
					.webp({ quality: SCREENSHOT_QUALITY })
					.toFile(artefactPath);
				const meta = await sharp(artefactPath).metadata();
				const budget = screenshotBudgetVerdict(statSync(artefactPath).size);
				process.stdout.write(
					`[capture] wrote ${relative(REPO_ROOT, artefactPath)} (${meta.width}x${meta.height}, ${budget.kb} KB, within budget: ${budget.withinBudget})\n`,
				);
				if (!budget.withinBudget) {
					throw new Error(
						`the artefact is ${budget.kb} KB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} KB budget; narrow the capture or lower the quality before committing it`,
					);
				}
			} finally {
				await browser.close();
			}
		}
	} finally {
		await server.close();
	}

	const report = {
		artefact: relative(REPO_ROOT, artefactPath),
		story: { module: STORY_MODULE, story: STORY_EXPORT, id: STORY_ID },
		conditions: {
			viewport: { width: options.width, height: options.height },
			deviceScaleFactor: SCREENSHOT_DEVICE_SCALE_FACTOR,
			colorScheme: 'light',
			waitUntil: 'networkidle',
			screenshot: 'fullPage',
			encode: {
				width: Math.min(ARTEFACT_WIDTH, SCREENSHOT_MAX_WIDTH),
				maxWidth: SCREENSHOT_MAX_WIDTH,
				quality: SCREENSHOT_QUALITY,
				format: 'webp',
			},
		},
		observation,
		verdict,
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
