#!/usr/bin/env node
/**
 * capture-handle-map — capture the Issue #524 verification screen into
 * `docs/verification/identity/handle-map-story.png`.
 *
 * What this captures
 * ------------------
 * The SHIPPED preview of the name / handle legend: the Storybook story
 * `src/personal/handle-map/HandleMap.stories.tsx` (`Default`) rendering
 * the data the document is proved against
 * (`src/personal/handle-map/HandleMap.preview.ts`). The capture is not
 * a drawing of the document — it is the preview itself, so a
 * screenshot in a pull request cannot show something the component
 * does not render.
 *
 * It is also an ASSERTION, not only a picture. From the rendered DOM it
 * reads the document title, the document metadata, every legend entry
 * name, every rendered link `href`, every section heading and every
 * section bullet, and compares them with the preview data module. A
 * preview that stopped rendering an entry, invented a link, or dropped
 * a section fails the capture instead of producing a flattering
 * picture. It also reads whether the document scrolls sideways at the
 * capture width (WCAG 2.2 SC 1.4.10 Reflow).
 *
 * Why a generated harness instead of `storybook dev`
 * ---------------------------------------------------
 * `pnpm run build-storybook` in this repository emits a MANAGER-ONLY
 * static build (no `iframe.html`): the `@storybook/react-vite` builder
 * merges the project's `vite.config.ts`, and the `@cloudflare/vite-plugin`
 * + TanStack Start plugins in it take over the output. That defect is
 * recorded in `scripts/capture-error-state-gallery.mjs` (Issue #501)
 * and `scripts/capture-a11y-table-code.mjs` (Issue #407).
 *
 * `storybook dev` itself DOES start and DOES render the stories
 * (measured 2026-10-31, recorded in `capture-music-connections.mjs`).
 * The capture still uses a harness so that it does not depend on a
 * long-lived dev server, so that the DOM assertions run inside the
 * same command as the capture, and so that its result does not depend
 * on the Storybook builder. The harness imports the SHIPPED story
 * module and renders the shipped story's own `render()` output — the
 * same tree Storybook renders — through a local Vite build, so the
 * capture and the Storybook surface cannot drift apart.
 *
 * Why PNG, not WebP
 * -----------------
 * Issue #524 names the artefact `docs/verification/identity/
 * handle-map-story.png` explicitly, and the legend is a small surface
 * (one screenful at the capture width), so a PNG stays small enough to
 * commit. The script REFUSES any non-`.png` output path.
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
 *   node scripts/capture-handle-map.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/identity/handle-map-story.png)
 *   --json-out=<path>     report destination
 *                         (default .tmp/handle-map/report.json)
 *   --width=<n>           viewport width (default 1440)
 *   --height=<n>          viewport height (default 900)
 *   --no-build            reuse an existing harness build in .tmp
 *   --no-capture          resolve and build everything, write no artefact
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	HANDLE_MAP_DOCUMENT,
	HANDLE_MAP_ENTRIES,
	HANDLE_MAP_LEGEND,
	HANDLE_MAP_SECTIONS,
} from '../src/personal/handle-map/HandleMap.preview.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped story module the capture renders. */
export const STORY_MODULE = 'src/personal/handle-map/HandleMap.stories.tsx';

/**
 * The shipped story the capture renders.
 *
 * `Default` is the story that shows the whole legend at the standard
 * page width. The harness imports the story module directly, so
 * renaming the story or moving the component makes the capture fail
 * loudly instead of quietly photographing an empty page.
 */
export const STORY_EXPORT = 'Default';

export const HARNESS_DIR = '.tmp/handle-map/harness';
export const HARNESS_DIST = '.tmp/handle-map/harness-dist';

/** The one committed artefact path. */
export const DEFAULT_ARTEFACT_PATH = 'docs/verification/identity/handle-map-story.png';

/**
 * Committed captures are PNG (Issue #524 names a `.png` path) with a
 * size budget: a legend that grows past this is a sign the preview
 * stopped being a legend, not a reason to commit a large binary.
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

/** Collapse a whitespace run so two texts can be compared as text (pure). */
export function collapseText(text) {
	return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** The generated harness page. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="ja">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>名前と handle の対応 preview (#524)</title>
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
 * It renders the SHIPPED story's own `render()` output, which is what
 * Storybook renders for that story, and it loads the shipped global
 * stylesheet so the capture shows the same Panda layer order a reader
 * sees.
 */
export function harnessMainTsx(harnessDir = HARNESS_DIR) {
	const depth = harnessDir.split('/').length;
	const up = '../'.repeat(depth);
	return `import { createRoot } from 'react-dom/client';
import '${up}src/styles.css';
import { ${STORY_EXPORT} } from '${up}${STORY_MODULE}';

const container = document.getElementById('root');
if (!container) throw new Error('harness root missing');

// Storybook renders the story's own \`render()\` output; the capture
// renders the same thing through the shipped story object, so the two
// surfaces cannot drift apart.
createRoot(container).render(<>{${STORY_EXPORT}.render?.()}</>);
`;
}

/** The generated Vite config (harness root, repo PostCSS config). */
export function harnessViteConfig(harnessDir = HARNESS_DIR, repoRoot = REPO_ROOT) {
	const depth = harnessDir.split('/').length;
	const up = '../'.repeat(depth);
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
 * document says. The failures are the difference, so a capture that
 * shows half the legend — or a link the records do not publish —
 * cannot be published as evidence of the whole legend.
 */
export function verifyRenderedPreview(
	observation,
	data = {
		document: HANDLE_MAP_DOCUMENT,
		legend: HANDLE_MAP_LEGEND,
		entries: HANDLE_MAP_ENTRIES,
		sections: HANDLE_MAP_SECTIONS,
	},
) {
	const failures = [];

	const expectedTitle = data.document.title;
	if (collapseText(observation.title) !== collapseText(expectedTitle)) {
		failures.push(
			`the document title is "${collapseText(observation.title)}", expected "${collapseText(expectedTitle)}"`,
		);
	}

	const expectedMeta = [
		data.document.status,
		data.document.source,
		data.document.verification,
		data.document.preview,
	];
	const renderedMeta = (observation.meta ?? []).map(collapseText);
	for (const value of expectedMeta) {
		if (!renderedMeta.includes(collapseText(value))) {
			failures.push(`the document metadata "${collapseText(value)}" is missing from the preview`);
		}
	}

	// Every legend entry name, in order — a dropped or renamed entry
	// fails here.
	const expectedNames = data.entries.map((entry) => collapseText(entry.name));
	const renderedNames = (observation.entryNames ?? []).map(collapseText);
	if (renderedNames.join('\n') !== expectedNames.join('\n')) {
		failures.push(
			`the rendered legend entries are [${renderedNames.join(' | ')}], expected [${expectedNames.join(' | ')}]`,
		);
	}

	// Every published link must be an actual <a href>, and the page
	// must not carry MORE links than the entries declare — an invented
	// link is exactly what the issue forbids.
	const expectedHrefs = data.entries.flatMap((entry) => entry.links.map((link) => link.url));
	const renderedHrefs = observation.hrefs ?? [];
	for (const href of expectedHrefs) {
		if (!renderedHrefs.includes(href)) {
			failures.push(`the published link "${href}" is missing from the preview`);
		}
	}
	if (renderedHrefs.length !== expectedHrefs.length) {
		failures.push(
			`the preview rendered ${renderedHrefs.length} link(s), expected ${expectedHrefs.length} — an undeclared link is an invented link`,
		);
	}

	// Section headings: the legend heading first, then the note
	// sections, in order.
	const expectedHeadings = [data.legend.heading, ...data.sections.map((s) => s.heading)].map(
		collapseText,
	);
	const renderedHeadings = (observation.headings ?? [])
		.filter((heading) => heading.level === 'H2')
		.map((heading) => collapseText(heading.text));
	if (renderedHeadings.join('\n') !== expectedHeadings.join('\n')) {
		failures.push(
			`the rendered sections are [${renderedHeadings.join(' | ')}], expected [${expectedHeadings.join(' | ')}]`,
		);
	}

	// The note-section bullets, byte-compared after whitespace collapse.
	const expectedBullets = data.sections.flatMap((section) => section.bullets);
	const renderedBullets = (observation.bullets ?? []).map(collapseText);
	if (renderedBullets.join('\n') !== expectedBullets.map(collapseText).join('\n')) {
		failures.push(
			`the preview rendered ${renderedBullets.length} note bullet(s), expected ${expectedBullets.length}`,
		);
	}

	if (observation.scrollWidth > observation.clientWidth) {
		failures.push(
			`the preview scrolls sideways (${observation.scrollWidth}px > ${observation.clientWidth}px)`,
		);
	}

	return { ok: failures.length === 0, failures };
}

/** Read the rendered facts out of the page. Runs inside Chromium. */
export const READ_DOCUMENT = () => {
	const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
	return {
		title: text(document.querySelector('h1')),
		headings: [...document.querySelectorAll('h1, h2, h3')].map((element) => ({
			level: element.tagName,
			text: text(element),
		})),
		meta: [...document.querySelectorAll('header ul li')].map(text),
		entryNames: [...document.querySelectorAll('[data-handle-map-entry] h3')].map(text),
		hrefs: [...document.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href')),
		bullets: [...document.querySelectorAll('[data-notes-list] li')].map(text),
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
		scrollHeight: document.documentElement.scrollHeight,
	};
};

function parseArgs(argv) {
	const options = {
		screenshot: DEFAULT_ARTEFACT_PATH,
		jsonOut: '.tmp/handle-map/report.json',
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
	const artefactPath = assertPngOutputPath(options.screenshot);

	writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);

	if (options.build) {
		process.stdout.write('[capture] building the handle-map harness…\n');
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
	let capture = null;
	try {
		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: harness built, nothing written\n');
		} else {
			const { chromium } = await import('@playwright/test');
			const browser = await chromium.launch();
			try {
				const context = await browser.newContext({
					viewport: { width: options.width, height: options.height },
					deviceScaleFactor: 1,
					colorScheme: 'light',
				});
				const page = await context.newPage();
				await page.goto(`${server.baseUrl}/index.html`, { waitUntil: 'networkidle' });
				observation = await page.evaluate(READ_DOCUMENT);
				verdict = verifyRenderedPreview(observation);
				if (!verdict.ok) {
					throw new Error(
						`the rendered preview does not match the preview data:\n  - ${verdict.failures.join('\n  - ')}`,
					);
				}
				const png = await page.screenshot({ fullPage: true });
				mkdirSync(dirname(artefactPath), { recursive: true });
				writeFileSync(artefactPath, png);
				const budget = screenshotBudgetVerdict(statSync(artefactPath).size);
				process.stdout.write(
					`[capture] wrote ${relative(REPO_ROOT, artefactPath)} (${options.width}x${observation.scrollHeight}, ${budget.kb} KB, within budget: ${budget.withinBudget})\n`,
				);
				if (!budget.withinBudget) {
					throw new Error(
						`the artefact is ${budget.kb} KB, over the ${Math.round(PNG_BUDGET_BYTES / 1024)} KB budget; the legend grew past a one-screen component — narrow the capture or revisit the preview before committing it`,
					);
				}
				capture = {
					artefact: relative(REPO_ROOT, artefactPath),
					width: options.width,
					height: observation.scrollHeight,
					...budget,
				};
			} finally {
				await browser.close();
			}
		}
	} finally {
		await server.close();
	}

	const report = {
		artefact: relative(REPO_ROOT, artefactPath),
		story: { module: STORY_MODULE, story: STORY_EXPORT },
		conditions: {
			viewport: { width: options.width, height: options.height },
			deviceScaleFactor: 1,
			colorScheme: 'light',
			waitUntil: 'networkidle',
			screenshot: 'fullPage',
			encode: { format: 'png' },
		},
		observation,
		verdict,
		capture,
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
