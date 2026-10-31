#!/usr/bin/env node
/**
 * capture-growth-through-making — capture the Issue #513 verification
 * screen into `docs/verification/vision/growth-case-study-preview.webp`.
 *
 * What this captures
 * ------------------
 * The SHIPPED preview of the growth-through-making content
 * specification: the Storybook story
 * `src/routes/design-system/sections/GrowthThroughMaking.stories.tsx`
 * rendering the data the specification is proved against. The capture
 * is not a drawing of the specification — it is the specification's
 * own preview, so a screenshot in a pull request cannot show
 * something the site does not render.
 *
 * It is also an ASSERTION, not only a picture. From the rendered DOM
 * it reads the document title, every section heading, every
 * sub-heading, every lead paragraph and every bullet, and compares
 * them with the preview data module. A preview that stopped
 * rendering a section, a sub-heading or a bullet fails the capture
 * instead of producing a flattering picture of half the document. It
 * also reads whether the document scrolls sideways at the capture
 * width (WCAG 2.2 SC 1.4.10 Reflow).
 *
 * Why a generated harness instead of `storybook dev`
 * ---------------------------------------------------
 * `storybook dev` cannot serve this repository's stories: the
 * `@storybook/react-vite` builder merges the project's
 * `vite.config.ts`, whose `@cloudflare/vite-plugin` takes over the
 * dev server and then refuses to start without the Worker's runtime
 * secrets. The same reason is recorded in
 * `scripts/capture-error-state-gallery.mjs` (Issue #501) and
 * `scripts/capture-a11y-table-code.mjs` (Issue #407). The harness
 * below imports the SHIPPED story module and renders the shipped
 * story's own `render()` output — the same tree Storybook renders —
 * through a local Vite build, so the capture and the Storybook
 * surface cannot drift apart.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, and no
 *     secret is read or printed. The preview data is literals in the
 *     source.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port.
 *   - Chromium screenshots are not byte-reproducible across
 *     processes, so the report records the conditions instead of
 *     claiming a deterministic artefact.
 *
 * WebP, not PNG
 * -------------
 * Chromium only writes PNG, but a verification artefact does not
 * justify a permanently large binary in the tree. The capture is
 * encoded with the existing `sharp` devDependency at width <= 1440 /
 * quality 80, and the script REFUSES any non-`.webp` output path.
 *
 * Usage:
 *   node scripts/capture-growth-through-making.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/vision/growth-case-study-preview.webp)
 *   --json-out=<path>     report destination
 *                         (default .tmp/growth-through-making/report.json)
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
import { GROWTH_THROUGH_MAKING } from '../src/routes/design-system/sections/GrowthThroughMaking.preview.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped story module the capture renders. */
export const STORY_MODULE = 'src/routes/design-system/sections/GrowthThroughMaking.stories.tsx';

/** The shipped story whose `render()` output the capture renders. */
export const STORY_EXPORT = 'Default';

export const HARNESS_DIR = '.tmp/growth-through-making/harness';
export const HARNESS_DIST = '.tmp/growth-through-making/harness-dist';

/** The one committed artefact path. */
export const DEFAULT_ARTEFACT_PATH = 'docs/verification/vision/growth-case-study-preview.webp';

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1440;
export const SCREENSHOT_QUALITY = 80;
/**
 * The width the committed file is encoded at.
 *
 * The specification is a long document: its full-page capture is
 * about 6 300 px tall, and encoding that at the 1440 px capture
 * width costs ~480 kB — more than the 300 kB budget. The budget is
 * not raised for one document, so the capture is NARROWED instead:
 * the full page is captured at the reference width and encoded at
 * 960 px, which keeps every section, every sub-heading and every
 * bullet in the picture (~260 kB) instead of a legible-looking but
 * half-document picture. The DOM assertions are unaffected — they
 * read the rendered page, not the encoded file.
 */
export const SCREENSHOT_ENCODE_WIDTH = 960;
/**
 * The WebP encoder effort.
 *
 * A higher effort finds a smaller encoding of the SAME quality
 * setting, so the committed file stays inside the budget without the
 * picture being degraded.
 */
export const SCREENSHOT_EFFORT = 6;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

/**
 * The device pixel ratio the capture shoots at.
 *
 * The artefact is a full-page reading of a long specification, so
 * `2` would quadruple the pixel count of an already tall image for a
 * verification screen that is read, not zoomed. `1` keeps the
 * committed file inside the 300 kB budget without lowering the
 * quality setting.
 */
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

/** Collapse the whitespace of a rendered or authored string (pure). */
export function normalizeText(value) {
	return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** Reject an encode width wider than the committed width cap (pure). */
export function assertEncodeWidth(width = SCREENSHOT_ENCODE_WIDTH, max = SCREENSHOT_MAX_WIDTH) {
	if (width > max) {
		throw new Error(`the capture encodes at ${width}px, over the ${max}px width cap`);
	}
	return width;
}

/** The generated harness page. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="ja">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>作りながら成長する — コンテンツ仕様 preview (#513)</title>
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
 * stylesheet so the capture shows the same Panda layer order a
 * reader sees.
 */
export function harnessMainTsx(harnessDir = HARNESS_DIR) {
	const depth = harnessDir.split('/').length;
	const up = '../'.repeat(depth);
	return `import { createRoot } from 'react-dom/client';
import '${up}src/styles.css';
import { ${STORY_EXPORT} } from '${up}${STORY_MODULE}';

const container = document.getElementById('root');
if (!container) throw new Error('harness root missing');

// Storybook renders the story's \`render()\` output; the capture
// renders the same call, so the two surfaces cannot drift apart.
const render = ${STORY_EXPORT}.render;
if (typeof render !== 'function') throw new Error('the shipped story has no render() output');
createRoot(container).render(render());
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
 * The observation is what the browser read; the sections are what the
 * specification says. The failures are the difference, so a capture
 * that shows half the specification cannot be published as evidence of
 * the whole specification.
 */
export function verifyRenderedDocument(observation, sections = GROWTH_THROUGH_MAKING.sections) {
	const failures = [];
	const spec = GROWTH_THROUGH_MAKING.document;

	const expectedTitle = normalizeText(spec.title);
	if (normalizeText(observation.title) !== expectedTitle) {
		failures.push(`the document title is "${observation.title}", expected "${spec.title}"`);
	}

	const headings = observation.headings ?? [];
	const renderedSections = headings.filter((heading) => heading.level === 'H2').map((h) => h.text);
	const expectedSections = sections.map((section) => section.heading);
	if (renderedSections.join('\n') !== expectedSections.join('\n')) {
		failures.push(
			`the rendered sections are [${renderedSections.join(' | ')}], expected [${expectedSections.join(' | ')}]`,
		);
	}

	const renderedSubHeadings = headings
		.filter((heading) => heading.level === 'H3')
		.map((h) => h.text);
	const expectedSubHeadings = sections.flatMap((section) =>
		section.blocks.map((block) => block.heading).filter((heading) => heading !== null),
	);
	if (renderedSubHeadings.join('\n') !== expectedSubHeadings.join('\n')) {
		failures.push(
			`the rendered sub-headings are [${renderedSubHeadings.join(' | ')}], expected [${expectedSubHeadings.join(' | ')}]`,
		);
	}

	const renderedLeads = (observation.leads ?? []).map(normalizeText);
	const expectedLeads = sections.map((section) => normalizeText(section.lead));
	if (renderedLeads.join('\n') !== expectedLeads.join('\n')) {
		failures.push(
			`the rendered lead paragraphs are [${renderedLeads.join(' | ')}], expected [${expectedLeads.join(' | ')}]`,
		);
	}

	const renderedBullets = (observation.bullets ?? []).map(normalizeText);
	const expectedBullets = sections.flatMap((section) =>
		section.blocks.flatMap((block) => block.bullets.map((bullet) => normalizeText(bullet))),
	);
	if (renderedBullets.join('\n') !== expectedBullets.join('\n')) {
		const missing = expectedBullets.filter((bullet) => !renderedBullets.includes(bullet));
		failures.push(
			`the preview rendered ${renderedBullets.length} bullet(s), expected ${expectedBullets.length}${missing.length > 0 ? `; missing: [${missing.join(' | ')}]` : ''}`,
		);
	}

	const renderedMeta = (observation.meta ?? []).map(normalizeText);
	const expectedMeta = [spec.status, spec.source, spec.verification, spec.preview].map(
		normalizeText,
	);
	if (renderedMeta.join('\n') !== expectedMeta.join('\n')) {
		failures.push(
			`the rendered document metadata is [${renderedMeta.join(' | ')}], expected [${expectedMeta.join(' | ')}]`,
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
	const listItems = [...document.querySelectorAll('li')];
	return {
		title: text(document.querySelector('h1')),
		headings: [...document.querySelectorAll('h1, h2, h3')].map((element) => ({
			level: element.tagName,
			text: text(element),
		})),
		leads: [...document.querySelectorAll('section header p')].map(text),
		bullets: listItems.filter((item) => item.closest('section') !== null).map(text),
		meta: listItems.filter((item) => item.closest('section') === null).map(text),
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	};
};

function parseArgs(argv) {
	const options = {
		screenshot: DEFAULT_ARTEFACT_PATH,
		jsonOut: '.tmp/growth-through-making/report.json',
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
	assertEncodeWidth();

	writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);

	if (options.build) {
		process.stdout.write('[capture] building the growth-through-making harness…\n');
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
				observation = await page.evaluate(READ_DOCUMENT);
				verdict = verifyRenderedDocument(observation);
				if (!verdict.ok) {
					throw new Error(
						`the rendered preview does not match the preview data:\n  - ${verdict.failures.join('\n  - ')}`,
					);
				}
				const png = await page.screenshot({ fullPage: true });
				mkdirSync(dirname(artefactPath), { recursive: true });
				await sharp(png)
					.resize({ width: SCREENSHOT_ENCODE_WIDTH, withoutEnlargement: true })
					.webp({ quality: SCREENSHOT_QUALITY, effort: SCREENSHOT_EFFORT })
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
		story: { module: STORY_MODULE, story: STORY_EXPORT },
		conditions: {
			viewport: { width: options.width, height: options.height },
			deviceScaleFactor: SCREENSHOT_DEVICE_SCALE_FACTOR,
			colorScheme: 'light',
			waitUntil: 'networkidle',
			screenshot: 'fullPage',
			encode: {
				captureWidth: SCREENSHOT_MAX_WIDTH,
				width: SCREENSHOT_ENCODE_WIDTH,
				quality: SCREENSHOT_QUALITY,
				effort: SCREENSHOT_EFFORT,
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
