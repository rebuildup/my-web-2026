#!/usr/bin/env node
/**
 * capture-music-connections — capture the Issue #525 verification screen
 * into `docs/verification/influences/music-connections-preview.webp`.
 *
 * What this captures
 * ------------------
 * The SHIPPED preview of the music-connections reference document: the
 * Storybook story `src/personal/music-connections/MusicConnections.stories.tsx`
 * rendering the data the reference document is proved against
 * (`src/personal/music-connections/MusicConnections.preview.ts`). The
 * capture is not a drawing of the document — it is the document's own
 * preview, so a screenshot in a pull request cannot show something the
 * site does not render.
 *
 * It is also an ASSERTION, not only a picture. From the rendered DOM it
 * reads the document title, the document metadata, every section
 * heading, every section lead, every sub-heading and every bullet, and
 * compares them with the preview data module. A preview that stopped
 * rendering a section, a sub-heading or a bullet fails the capture
 * instead of producing a flattering picture of half the document. It
 * also reads whether the document scrolls sideways at the capture width
 * (WCAG 2.2 SC 1.4.10 Reflow).
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
 * (measured 2026-10-31: `pnpm exec storybook dev --port 6013` serves
 * the index and `iframe.html?id=<story id>` renders the story; the
 * `Missing required secrets for Worker "my-web-2026"` line it prints
 * is a warning, not a startup failure). The capture still uses a
 * harness so that it does not depend on a long-lived dev server, so
 * that the DOM assertions run inside the same command as the capture,
 * and so that its result does not depend on the Storybook builder.
 * The harness below imports the SHIPPED story module and
 * renders the shipped story's own `render()` output — the same tree
 * Storybook renders — through a local Vite build, so the capture and
 * the Storybook surface cannot drift apart.
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
 * stays within 300 KB. The script REFUSES any non-`.webp` output path.
 *
 * Usage:
 *   node scripts/capture-music-connections.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/influences/music-connections-preview.webp)
 *   --json-out=<path>     report destination
 *                         (default .tmp/music-connections/report.json)
 *   --width=<n>           viewport width (default 1440, max 1440)
 *   --height=<n>          viewport height (default 900)
 *   --clip-height=<n>     capture at most this many pixels of the page
 *                         (default 0 = as much as the budget allows)
 *   --no-build            reuse an existing harness build in .tmp
 *   --no-capture          resolve and build everything, write no artefact
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUSIC_CONNECTIONS } from '../src/personal/music-connections/MusicConnections.preview.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped story module the capture renders. */
export const STORY_MODULE = 'src/personal/music-connections/MusicConnections.stories.tsx';

/**
 * The shipped story the capture renders.
 *
 * `Default` is the story that shows the whole reference document at the
 * standard page width. The harness imports the story module directly,
 * so renaming the story or moving the document makes the capture fail
 * loudly instead of quietly photographing an empty page.
 */
export const STORY_EXPORT = 'Default';

export const HARNESS_DIR = '.tmp/music-connections/harness';
export const HARNESS_DIST = '.tmp/music-connections/harness-dist';

/** The one committed artefact path. */
export const DEFAULT_ARTEFACT_PATH = 'docs/verification/influences/music-connections-preview.webp';

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1440;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

/**
 * The whole reference document does not fit the artefact budget.
 *
 * The document renders about 8000 px tall at the shipped page width, and
 * an image of that many pixels of prose does not fit 300 KB as WebP at
 * quality 80. The capture therefore takes the LONGEST prefix of the
 * document — measured on the rendered section boundaries, never in the
 * middle of a section — that fits the budget, so the committed artefact
 * shows whole sections at a readable size. The assertions always cover
 * the WHOLE document, whatever the artefact shows.
 */
export const DEFAULT_CLIP_HEIGHT = 0;

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

/** Collapse a whitespace run so two texts can be compared as text (pure). */
export function collapseText(text) {
	return (text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Drop every whitespace character (pure).
 *
 * The preview renders a labelled example as a label element plus a
 * body element, so the rendered list item carries one separator space
 * the data module does not hold. Both sides are compacted before they
 * are compared, so the difference in *where* the space sits cannot make
 * a correct preview fail — while every other character still has to
 * match.
 */
export function compactText(text) {
	return (text ?? '').replace(/\s+/g, '');
}

/** The generated harness page. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="ja">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>音楽からの接続点 preview (#525)</title>
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
 * reference document says. The failures are the difference, so a
 * capture that shows half the document cannot be published as evidence
 * of the whole document.
 */
export function verifyRenderedPreview(observation, data = MUSIC_CONNECTIONS) {
	const failures = [];
	const sections = data.sections;

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

	const renderedHeadings = observation.headings ?? [];
	const renderedSectionHeadings = renderedHeadings
		.filter((heading) => heading.level === 'H2')
		.map((heading) => collapseText(heading.text));
	const expectedSectionHeadings = sections.map((section) => collapseText(section.heading));
	if (renderedSectionHeadings.join('\n') !== expectedSectionHeadings.join('\n')) {
		failures.push(
			`the rendered sections are [${renderedSectionHeadings.join(' | ')}], expected [${expectedSectionHeadings.join(' | ')}]`,
		);
	}

	const renderedSubHeadings = renderedHeadings
		.filter((heading) => heading.level === 'H3')
		.map((heading) => collapseText(heading.text));
	const expectedSubHeadings = sections
		.flatMap((section) => section.blocks)
		.filter((block) => block.heading)
		.map((block) => collapseText(block.heading));
	if (renderedSubHeadings.join('\n') !== expectedSubHeadings.join('\n')) {
		failures.push(
			`the rendered sub-headings are [${renderedSubHeadings.join(' | ')}], expected [${expectedSubHeadings.join(' | ')}]`,
		);
	}

	const renderedLeads = (observation.leads ?? []).map(collapseText);
	const expectedLeads = sections.map((section) => collapseText(section.lead));
	if (renderedLeads.join('\n') !== expectedLeads.join('\n')) {
		failures.push(
			`the rendered section leads do not match the preview data (${renderedLeads.length} rendered, ${expectedLeads.length} expected)`,
		);
	}

	const expectedBullets = sections
		.flatMap((section) => section.blocks)
		.flatMap((block) => block.bullets);
	const renderedBullets = (observation.bullets ?? []).map(compactText);
	const compactedExpected = expectedBullets.map(compactText);
	if (renderedBullets.join('\n') !== compactedExpected.join('\n')) {
		failures.push(
			`the preview rendered ${renderedBullets.length} bullet(s), expected ${compactedExpected.length}`,
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
		leads: [...document.querySelectorAll('section > header > p')].map(text),
		bullets: [...document.querySelectorAll('section li')].map(text),
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
		scrollHeight: document.documentElement.scrollHeight,
	};
};

/**
 * The places the capture may cut the document (runs inside Chromium).
 *
 * A cut is always the bottom of a rendered section (or the document
 * header), never an arbitrary line in the middle of a section, so the
 * committed artefact never shows a half section.
 */
export const READ_CUT_POINTS = () => {
	const bottomOf = (element) => Math.ceil(element.getBoundingClientRect().bottom + window.scrollY);
	const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
	const cuts = [];
	const header = document.querySelector('body header');
	if (header) {
		cuts.push({ label: 'document header only', y: bottomOf(header) });
	}
	for (const section of document.querySelectorAll('section')) {
		cuts.push({
			label: `section: ${text(section.querySelector('h2'))}`,
			y: bottomOf(section),
		});
	}
	cuts.push({
		label: 'whole document',
		y: Math.ceil(document.documentElement.scrollHeight),
	});
	// Longest first: the capture takes the first candidate that fits the
	// artefact budget.
	return cuts.sort((left, right) => right.y - left.y);
};

function parseArgs(argv) {
	const options = {
		screenshot: DEFAULT_ARTEFACT_PATH,
		jsonOut: '.tmp/music-connections/report.json',
		width: 1440,
		height: 900,
		clipHeight: DEFAULT_CLIP_HEIGHT,
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
		if (arg.startsWith('--clip-height=')) {
			options.clipHeight = Number(arg.slice('--clip-height='.length));
			continue;
		}
		throw new Error(`unknown argument: ${arg}`);
	}
	if (options.width > SCREENSHOT_MAX_WIDTH) {
		throw new Error(
			`the capture width ${options.width}px is over the ${SCREENSHOT_MAX_WIDTH}px cap; narrow the capture instead`,
		);
	}
	return options;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const artefactPath = assertWebpOutputPath(options.screenshot);

	writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);

	if (options.build) {
		process.stdout.write('[capture] building the music-connections harness…\n');
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
			const sharp = (await import('sharp')).default;
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
				const cuts = await page.evaluate(READ_CUT_POINTS);
				const candidates = cuts.filter((cut) => {
					if (options.clipHeight <= 0) return true;
					return cut.y <= options.clipHeight;
				});
				let encoded = null;
				let chosen = null;
				for (const cut of candidates) {
					const png = await page.screenshot({
						fullPage: true,
						clip: { x: 0, y: 0, width: options.width, height: cut.y },
					});
					const buffer = await sharp(png)
						.resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
						.webp({ quality: SCREENSHOT_QUALITY })
						.toBuffer();
					encoded = { buffer, cut };
					chosen = cut;
					// The candidates run from the whole document down to its
					// first section, so the first one that fits the budget is
					// the LONGEST prefix that fits.
					if (buffer.length <= SCREENSHOT_BUDGET_BYTES) break;
				}
				if (!encoded || !chosen) {
					throw new Error('no capture candidate could be produced');
				}
				mkdirSync(dirname(artefactPath), { recursive: true });
				writeFileSync(artefactPath, encoded.buffer);
				const meta = await sharp(artefactPath).metadata();
				const budget = screenshotBudgetVerdict(statSync(artefactPath).size);
				process.stdout.write(
					`[capture] wrote ${relative(REPO_ROOT, artefactPath)} (${meta.width}x${meta.height}, ${budget.kb} KB, within budget: ${budget.withinBudget})\n`,
				);
				process.stdout.write(
					`[capture] captured through "${chosen.label}" (${chosen.y}px of the ${observation.scrollHeight}px document)\n`,
				);
				if (!budget.withinBudget) {
					throw new Error(
						`the artefact is ${budget.kb} KB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} KB budget; narrow the capture or lower the quality before committing it`,
					);
				}
				capture = {
					artefact: relative(REPO_ROOT, artefactPath),
					capturedThrough: chosen.label,
					capturedPixels: chosen.y,
					documentPixels: observation.scrollHeight,
					width: meta.width ?? null,
					height: meta.height ?? null,
					quality: SCREENSHOT_QUALITY,
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
			encode: { width: SCREENSHOT_MAX_WIDTH, quality: SCREENSHOT_QUALITY, format: 'webp' },
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
