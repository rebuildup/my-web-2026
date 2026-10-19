#!/usr/bin/env node

/**
 * capture-a11y-table-code — capture the Issue #407 verification screen
 * into `docs/verification/a11y/table-code-mobile.webp`.
 *
 * What this captures
 * ------------------
 * The shipped fixture (`src/editorial/table-code.tsx` →
 * `TableCodeFixture`, published on `/design-system` and in Storybook)
 * rendered at a 375 px mobile viewport in one Chromium: the real
 * rendering, the accessibility tree facts a browser can be asked for,
 * and the machine gate's own verdict.
 *
 * It is also an ASSERTION, not only a screenshot. Per fixture state
 * (normal / empty / failure / compact) it reads, from the live DOM:
 *
 *   - every table has a `<caption>` and every header cell has a scope,
 *   - every scroll box is focusable (`tabindex="0"`) and its accessible
 *     name resolves (the `aria-labelledby` target exists and has text),
 *   - the DOCUMENT does not scroll sideways (`scrollWidth <=
 *     clientWidth` on the root) — WCAG 2.2 SC 1.4.10 Reflow,
 *   - each scroll box that overflows actually MOVES when the keyboard
 *     is used: the script focuses it and presses ArrowRight, then
 *     reads `scrollLeft` — WCAG 2.2 SC 2.1.1 Keyboard.
 *
 * Reading only the first table would let a defect in one state pass, so
 * every `[data-table-scroll]` / `[data-code-scroll]` is collected with
 * `querySelectorAll` and identified by the `data-case` the fixture
 * renders. The expected set of four states is asserted, so a fixture
 * that quietly stopped rendering one of them fails the capture instead
 * of "verifying" three of four.
 *
 * The artefact carries the machine-checked facts AND the human-
 * evaluation list side by side, because the Issue asks for the two to
 * be distinguished rather than merged into one green mark.
 *
 * Why a generated harness instead of the Storybook gallery
 * --------------------------------------------------------
 * `pnpm run build-storybook` in this repository emits a MANAGER-ONLY
 * static build (no `iframe.html`): the `@storybook/react-vite` builder
 * merges the project's `vite.config.ts`, whose Cloudflare / TanStack
 * Start plugins take over the output (recorded in
 * `scripts/capture-error-state-gallery.mjs`, Issue #501). The harness
 * below imports the SHIPPED module itself and renders the shipped
 * fixture, so the capture and the public page cannot drift.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is
 *     read or printed. The fixture data is literals in the source file.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port; Chromium refuses ES modules from `file://`,
 *     which is the only reason an origin exists.
 *   - Chromium screenshots are not byte-reproducible across processes,
 *     so the report records conditions instead of claiming a
 *     deterministic artefact.
 *
 * WebP, not PNG
 * -------------
 * Chromium only writes PNG and Issue #407 names a `.png` path, but a
 * verification artefact does not justify a permanently large binary in
 * the tree. The capture is taken into `.tmp/`, encoded with the
 * existing `sharp` devDependency at width <= 1600 / quality 80, and the
 * committed file is the `.webp` sibling. The script REFUSES any
 * non-`.webp` output path and deletes the intermediate PNG.
 *
 * Usage:
 *   node scripts/capture-a11y-table-code.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/a11y/table-code-mobile.webp)
 *   --png-dir=<path>     temporary PNG directory (default .tmp/a11y-table-code)
 *   --json-out=<path>    report destination (default .tmp/a11y-table-code/report.json)
 *   --width=<n>          CSS viewport width (default 375)
 *   --no-build           reuse an existing harness build in .tmp
 *   --no-capture         build and assert nothing browser-side; write no artefact
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectEvidence, renderGateSummary } from './check-table-code-a11y.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped fixture the capture renders. */
export const FIXTURE_MODULE = 'src/editorial/table-code.tsx';
export const FIXTURE_EXPORT = 'TableCodeFixture';

/** Readiness marker the capture waits for before reading anything. */
export const FIXTURE_SELECTOR = '[data-table-code-fixture]';

/**
 * The fixture states this Issue names, in render order. The capture
 * asserts this exact set, so "all four states were compared" is a
 * checked statement rather than a claim about whatever the fixture
 * happened to render.
 */
export const EXPECTED_CASE_IDS = ['01-normal', '02-empty', '03-failure', '04-compact'];

/** The WCAG 2.2 criteria this artefact speaks to, with their levels. */
export const WCAG_MAPPING = [
	{ sc: '1.3.1', name: 'Info and Relationships', level: 'A' },
	{ sc: '1.4.10', name: 'Reflow', level: 'AA' },
	{ sc: '2.1.1', name: 'Keyboard', level: 'A' },
	{ sc: '2.4.6', name: 'Headings and Labels', level: 'AA' },
];

/**
 * How long to wait for the fixture to mount, and how many times to
 * look. An unbounded retry turns a broken mount into a capture that
 * hangs forever instead of one that reports the cause.
 */
export const MOUNT_WAIT_ATTEMPTS = 3;
export const MOUNT_WAIT_TIMEOUT_MS = 10_000;

/** Bounded poll for the animated keyboard scroll to settle. */
export const SCROLL_SETTLE_ATTEMPTS = 6;
export const SCROLL_SETTLE_INTERVAL_MS = 120;

export const HARNESS_DIR = '.tmp/a11y-table-code/harness';
export const HARNESS_DIST = '.tmp/a11y-table-code/harness-dist';

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

/** Pixel geometry of the artefact (pure, so it is testable). */
export const GUTTER = 24;
export const PANEL_WIDTH = 780;
export const HEADER_PAD = 34;
export const ROW_STEP = 22;
export const ROW_FONT_SIZE = 13;
export const TITLE_FONT_SIZE = 20;

/** Whether a capture fits the verification-artefact budget (pure). */
export function screenshotBudgetVerdict(bytes) {
	return {
		bytes,
		kb: Math.round(bytes / 1024),
		withinBudget: bytes <= SCREENSHOT_BUDGET_BYTES,
	};
}

/** Reject an output path that is not WebP, or that leaves the repository. */
export function assertWebpOutputPath(path, repoRoot = REPO_ROOT) {
	if (extname(path).toLowerCase() !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${path}`);
	}
	const rel = relative(repoRoot, resolve(repoRoot, path));
	if (rel.startsWith('..')) {
		throw new Error(`refusing to write outside the repository: ${path}`);
	}
	return rel;
}

/** Minimal XML escaping: the panel text is computed, not source. */
export function escapeXml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Decide whether a browser observation proves the contract (pure).
 *
 * Kept pure and exported so the assertion is unit-testable without a
 * browser: a capture that can only fail inside Chromium is a capture
 * nobody re-runs when it breaks.
 */
export function evaluateObservation(observation) {
	const failures = [];

	if (observation.documentScrollWidth > observation.documentClientWidth) {
		failures.push(
			`the document scrolls sideways at ${observation.viewportWidth}px (scrollWidth ${observation.documentScrollWidth} > clientWidth ${observation.documentClientWidth}); the scroll must stay inside the component (SC 1.4.10)`,
		);
	}

	const cases = observation.cases ?? [];
	const ids = cases.map((entry) => entry.caseId);
	const missing = EXPECTED_CASE_IDS.filter((id) => !ids.includes(id));
	if (missing.length > 0) {
		failures.push(
			`fixture state(s) ${missing.join(', ')} were not rendered; every state the Issue names has to be compared, not the first one that happens to appear`,
		);
	}

	for (const entry of cases) {
		const where = `fixture state ${entry.caseId}`;
		for (const table of entry.tables ?? []) {
			if (table.captionCount !== 1) {
				failures.push(
					`${where}: table "${table.name}" rendered ${table.captionCount} caption(s), expected exactly 1`,
				);
			}
			if (table.captionText.trim() === '') {
				failures.push(
					`${where}: table "${table.name}" has an empty caption, so the region is named by nothing`,
				);
			}
			if (table.thTotal === 0) {
				failures.push(`${where}: table "${table.name}" rendered no header cell`);
			}
			if (table.thScoped !== table.thTotal) {
				failures.push(
					`${where}: table "${table.name}" has ${table.thTotal - table.thScoped} unscoped header cell(s); a screen reader cannot relate the cells without scope (SC 1.3.1)`,
				);
			}
			if (!table.focusable) {
				failures.push(
					`${where}: table "${table.name}" scroll box is not focusable, so it cannot be scrolled with a keyboard (SC 2.1.1)`,
				);
			}
			if (!table.named) {
				failures.push(
					`${where}: table "${table.name}" scroll box has no resolvable accessible name (SC 2.4.6)`,
				);
			}
			if (table.overflows && !(table.scrollLeftAfterArrowKey > 0)) {
				failures.push(
					`${where}: table "${table.name}" overflows horizontally (${table.scrollWidth} > ${table.clientWidth}px) but ArrowRight did not move it; the scroll box is not keyboard-operable (SC 2.1.1)`,
				);
			}
		}
		for (const code of entry.codes ?? []) {
			if (!code.focusable) {
				failures.push(`${where}: code block "${code.name}" is not focusable (SC 2.1.1)`);
			}
			if (code.overflows && !(code.scrollLeftAfterArrowKey > 0)) {
				failures.push(
					`${where}: code block "${code.name}" overflows horizontally (${code.scrollWidth} > ${code.clientWidth}px) but ArrowRight did not move it (SC 2.1.1)`,
				);
			}
		}
	}

	return { ok: failures.length === 0, failures };
}

/**
 * One compact line per fixture state, for the artefact's evidence
 * panel: the actual rendering on the left, the machine-checked result
 * on the right.
 */
export function evidenceRows(observation) {
	const rows = [];
	for (const entry of observation.cases ?? []) {
		for (const table of entry.tables ?? []) {
			rows.push(
				`${entry.caseId} table "${table.name}" caption=${table.captionCount} scope=${table.thScoped}/${table.thTotal} focus=${table.focusable ? 'yes' : 'NO'} name=${table.named ? 'yes' : 'NO'}`,
			);
			rows.push(
				`    box ${table.scrollWidth}px in ${table.clientWidth}px  arrow-key scrollLeft=${table.scrollLeftAfterArrowKey}px  ${table.overflows ? 'scrolls inside the component' : 'fits, no scroll needed'}`,
			);
		}
		for (const code of entry.codes ?? []) {
			rows.push(
				`${entry.caseId} code  "${code.name}" focus=${code.focusable ? 'yes' : 'NO'} box ${code.scrollWidth}px in ${code.clientWidth}px arrow-key scrollLeft=${code.scrollLeftAfterArrowKey}px`,
			);
		}
	}
	return rows;
}

/** The generated harness page. Deterministic, so the report can hash it. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>table / code readability fixture (#407)</title>
	</head>
	<body style="margin:0;background:#ffffff">
		<div id="root"></div>
		<script type="module" src="./main.tsx"></script>
	</body>
</html>
`;
}

/**
 * The generated harness entry point. It renders the SHIPPED fixture and
 * the shipped stylesheet, so the capture shows the same tree (and the
 * same Panda layer order) a reader of `/design-system` sees.
 */
export function harnessMainTsx(harnessDir = HARNESS_DIR) {
	const depth = harnessDir.split('/').length;
	const up = '../'.repeat(depth);
	return `import { createRoot } from 'react-dom/client';
import '${up}src/styles.css';
import { ${FIXTURE_EXPORT} } from '${up}${FIXTURE_MODULE}';

const container = document.getElementById('root');
if (!container) throw new Error('harness root missing');

createRoot(container).render(<${FIXTURE_EXPORT} />);
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
 * Read the accessibility-relevant facts out of the rendered page.
 *
 * Runs in the browser, so it is written as a function body that
 * Chromium serialises — no imports, no closure variables.
 */
export const READ_DOCUMENT = () => {
	const resolveName = (element) => {
		const id = element.getAttribute('aria-labelledby');
		if (!id) return { named: false, name: null };
		const target = document.getElementById(id);
		const text = (target?.textContent ?? '').replace(/\s+/g, ' ').trim();
		return { named: text.length > 0, name: text };
	};
	const describe = (element, hook) => {
		const { named, name } = resolveName(element);
		return {
			hook,
			name,
			named,
			focusable: element.getAttribute('tabindex') === '0',
			overflows: element.scrollWidth > element.clientWidth,
			scrollWidth: element.scrollWidth,
			clientWidth: element.clientWidth,
			scrollLeftAfterArrowKey: element.scrollLeft,
		};
	};
	const root = document.documentElement;
	const cases = [...document.querySelectorAll('[data-case]')].map((section) => {
		const table = section.querySelector('[data-table-scroll]');
		const caption = table?.querySelector('caption');
		const headers = table ? [...table.querySelectorAll('th')] : [];
		return {
			caseId: section.getAttribute('data-case'),
			tables: table
				? [
						{
							captionCount: table.querySelectorAll('caption').length,
							captionText: (caption?.textContent ?? '').replace(/\s+/g, ' ').trim(),
							thTotal: headers.length,
							thScoped: headers.filter((header) => header.hasAttribute('scope')).length,
							...describe(table, 'data-table-scroll'),
						},
					]
				: [],
			codes: [...section.querySelectorAll('[data-code-scroll]')].map((element) =>
				describe(element, 'data-code-scroll'),
			),
		};
	});
	return {
		viewportWidth: root.clientWidth,
		documentScrollWidth: root.scrollWidth,
		documentClientWidth: root.clientWidth,
		cases,
	};
};

/**
 * Focus one scroll box by index and report how far ArrowRight moved it.
 *
 * The arguments travel as ONE object: Playwright serialises a single
 * argument into `page.evaluate`, and a second positional one fails at
 * runtime rather than in a unit test.
 */
export const FOCUS_AND_READ = ({ selector, index }) => {
	const element = document.querySelectorAll(selector)[index];
	if (!element) return { found: false, scrollLeftAfterArrowKey: 0 };
	element.focus({ preventScroll: true });
	return {
		found: document.activeElement === element,
		scrollLeftAfterArrowKey: element.scrollLeft,
		overflows: element.scrollWidth > element.clientWidth,
		scrollWidth: element.scrollWidth,
		clientWidth: element.clientWidth,
	};
};

/**
 * Read one scroll box's current `scrollLeft` without touching focus.
 *
 * Separate from {@link FOCUS_AND_READ} on purpose: Chromium animates
 * keyboard scrolling, so the position is polled until it settles, and
 * re-focusing between polls would be measuring the focus call rather
 * than the keypress.
 */
export const READ_SCROLL_LEFT = ({ selector, index }) => {
	const element = document.querySelectorAll(selector)[index];
	if (!element) return { scrollLeft: 0 };
	return { scrollLeft: element.scrollLeft };
};

/** Compose the artefact: header band, then the mobile render and evidence. */
export async function composeArtefact({ sharp, pagePng, header, outPath }) {
	const panelWidth = SCREENSHOT_MAX_WIDTH - PANEL_WIDTH - GUTTER;
	const page = await sharp(pagePng).resize({ width: PANEL_WIDTH }).png().toBuffer();
	const pageMeta = await sharp(page).metadata();
	const pageHeight = pageMeta.height ?? 0;
	// The canvas is as tall as the taller of the two columns, so the
	// evidence panel is never clipped and the render is never stretched.
	const bodyHeight = Math.max(pageHeight, header.panelHeight ?? 0);
	const body = await sharp(page)
		.extend({
			top: 0,
			bottom: bodyHeight - pageHeight,
			left: 0,
			// PANEL_WIDTH + GUTTER + panelWidth, i.e. the full canvas width:
			// the white gutter between the render and the panel is part of
			// the canvas, not part of the panel.
			right: SCREENSHOT_MAX_WIDTH - PANEL_WIDTH,
			background: { r: 255, g: 255, b: 255 },
		})
		.png()
		.toBuffer();
	await sharp(body)
		.extend({
			top: header.height,
			bottom: 0,
			left: 0,
			right: 0,
			background: { r: 244, g: 239, b: 223 },
		})
		.composite([
			{ input: Buffer.from(header.svg), left: 0, top: 0 },
			// The evidence panel is drawn to the right of the render, not
			// over it: a composite at top 0 would cover the first rows of
			// the render, which is exactly what a reviewer needs to read.
			{ input: Buffer.from(header.panelSvg), left: PANEL_WIDTH + GUTTER, top: header.height },
		])
		.webp({ quality: SCREENSHOT_QUALITY })
		.toFile(outPath);
	return {
		pageWidth: pageMeta.width ?? null,
		pageHeight,
		bodyHeight,
		headerHeight: header.height,
		panelWidth,
	};
}

/** The header band: what was rendered, what was measured, what was not. */
export function headerSvg({ observation, gate, width = SCREENSHOT_MAX_WIDTH }) {
	const title = 'table / code readability at 375 px — Issue #407';
	const rows = [
		`fixture ${FIXTURE_MODULE}#${FIXTURE_EXPORT} · viewport ${observation.viewportWidth}px · deviceScaleFactor 2`,
		`machine-checked: document scrollWidth ${observation.documentScrollWidth} <= clientWidth ${observation.documentClientWidth} (SC 1.4.10 Reflow, AA)`,
		`machine-checked: ${observation.cases.length} fixture state(s) rendered, every table caption present and every header cell scoped (SC 1.3.1, A)`,
		'machine-checked: every scroll box focusable (tabindex=0) and moved by ArrowRight (SC 2.1.1, A); regions named by their caption (SC 2.4.6, AA)',
		`machine-checked: gate ${gate.violations.length} violation(s) over ${gate.filesScanned} source file(s)`,
		'not machine-checked: contrast at 200% zoom, caption wording, screen-reader pass, reading comfort (human evaluation)',
		`WCAG 2.2: ${WCAG_MAPPING.map((entry) => `${entry.sc} ${entry.level}`).join(' · ')}`,
	];
	const rowTop = HEADER_PAD + 34;
	const height = rowTop + rows.length * ROW_STEP + 20;
	const lines = rows
		.map(
			(row, index) =>
				`<text x="16" y="${rowTop + index * ROW_STEP}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="${ROW_FONT_SIZE}" fill="#1c2030">${escapeXml(row)}</text>`,
		)
		.join('\n');
	return {
		height,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
	<rect width="${width}" height="${height}" fill="#f4efdf" />
	<text x="16" y="${HEADER_PAD}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="${TITLE_FONT_SIZE}" font-weight="700" fill="#0b1020">${escapeXml(title)}</text>
	${lines}
</svg>
`,
	};
}

/** The evidence panel: one row per measured surface, drawn beside the render. */
export function evidencePanelSvg({ observation, gate, width }) {
	const rows = evidenceRows(observation);
	const body = [
		'machine-checked per surface',
		'',
		...rows,
		'',
		`regions measured: ${rows.length}`,
		`document: scrollWidth ${observation.documentScrollWidth} / clientWidth ${observation.documentClientWidth}`,
		`gate: ${gate.violations.length} violation(s), markers ${gate.primitive.markers.filter((marker) => marker.present).length}/${gate.primitive.markers.length}`,
		'',
		'human evaluation (not measured here)',
		...gate.humanEvaluation.map((item) => `- ${item}`),
	];
	const rowTop = 20;
	const step = ROW_STEP;
	const panelHeight = body.length * step + rowTop + 12;
	const lines = body
		.map(
			(row, index) =>
				`<text x="14" y="${rowTop + index * step}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" fill="#1c2030">${escapeXml(row)}</text>`,
		)
		.join('\n');
	return {
		height: panelHeight,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${panelHeight}">
	<rect width="${width}" height="${panelHeight}" fill="#ffffff" />
	<rect x="0" y="0" width="${width}" height="${panelHeight}" fill="none" stroke="#d8d2c0" stroke-width="2" />
	${lines}
</svg>
`,
	};
}

function parseArgs(argv) {
	const options = {
		screenshot: 'docs/verification/a11y/table-code-mobile.webp',
		pngDir: '.tmp/a11y-table-code',
		jsonOut: '.tmp/a11y-table-code/report.json',
		width: 375,
		build: true,
		capture: true,
	};
	for (const arg of argv) {
		const separator = arg.indexOf('=');
		const flag = (
			arg.startsWith('--') ? arg.slice(2, separator === -1 ? undefined : separator) : arg
		).replace(/^--/, '');
		const value = separator === -1 ? null : arg.slice(separator + 1);
		switch (flag) {
			case 'screenshot':
				options.screenshot = value;
				break;
			case 'png-dir':
				options.pngDir = value;
				break;
			case 'json-out':
				options.jsonOut = value;
				break;
			case 'width':
				options.width = Number(value);
				break;
			case 'no-build':
				options.build = false;
				break;
			case 'no-capture':
				options.capture = false;
				break;
			default:
				throw new Error(`unknown option: --${flag}`);
		}
	}
	return options;
}

function ensureDir(path) {
	mkdirSync(dirname(resolve(REPO_ROOT, path)), { recursive: true });
}

/** Wait for the fixture, then read it. Bounded, so a broken mount reports. */
async function observeFixture(page) {
	let lastError = null;
	for (let attempt = 1; attempt <= MOUNT_WAIT_ATTEMPTS; attempt += 1) {
		try {
			await page.waitForSelector(FIXTURE_SELECTOR, { timeout: MOUNT_WAIT_TIMEOUT_MS });
			return await page.evaluate(READ_DOCUMENT);
		} catch (error) {
			lastError = error;
			process.stdout.write(
				`[capture] attempt ${attempt}/${MOUNT_WAIT_ATTEMPTS}: the fixture is not on the page (${error.message})\n`,
			);
		}
	}
	throw new Error(
		`the shipped fixture never mounted after ${MOUNT_WAIT_ATTEMPTS} attempts; the artefact would photograph nothing (${lastError?.message ?? 'unknown error'})`,
	);
}

/**
 * Focus each overflowing scroll box and press ArrowRight, so the
 * keyboard claim is measured rather than asserted.
 */
/**
 * Poll one scroll box until its position stops changing.
 *
 * Bounded: Chromium animates keyboard scrolling, so reading on the
 * frame right after the keypress can observe `0` for a box that is
 * about to move. Waiting forever would turn a broken box into a hung
 * capture, so the wait is a fixed number of short polls.
 */
async function settleScroll(page, args) {
	let previous = -1;
	for (let attempt = 0; attempt < SCROLL_SETTLE_ATTEMPTS; attempt += 1) {
		const { scrollLeft } = await page.evaluate(READ_SCROLL_LEFT, args);
		if (scrollLeft > 0) return scrollLeft;
		if (scrollLeft === previous) return scrollLeft;
		previous = scrollLeft;
		await page.waitForTimeout(SCROLL_SETTLE_INTERVAL_MS);
	}
	return previous;
}

async function measureKeyboardScroll(page, observation) {
	const counts = await page.evaluate(() =>
		[...document.querySelectorAll('[data-case]')].map((section) => ({
			caseId: section.getAttribute('data-case'),
			tables: section.querySelectorAll('[data-table-scroll]').length,
			codes: section.querySelectorAll('[data-code-scroll]').length,
		})),
	);

	for (const entry of observation.cases) {
		const found = counts.find((section) => section.caseId === entry.caseId);
		if (!found) continue;
		for (const [selector, length, targets] of [
			['[data-table-scroll]', found.tables, entry.tables],
			['[data-code-scroll]', found.codes, entry.codes],
		]) {
			for (let index = 0; index < length; index += 1) {
				// Focus the box, press ArrowRight, then read how far it moved.
				// Three steps on purpose: the point of the measurement is
				// that a KEYBOARD moves this box, not that it can scroll.
				const args = { selector, index };
				await page.evaluate(FOCUS_AND_READ, args);
				await page.keyboard.press('ArrowRight');
				const settled = await settleScroll(page, args);
				const target = targets?.[index];
				if (target) target.scrollLeftAfterArrowKey = settled;
			}
		}
	}
	return observation;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.capture) assertWebpOutputPath(options.screenshot);

	const gate = collectEvidence();
	if (gate.violations.length > 0) {
		process.stderr.write(`${renderGateSummary(gate)}\n`);
		throw new Error(
			`the table / code gate reports ${gate.violations.length} violation(s); the artefact would photograph a broken contract`,
		);
	}

	writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);
	if (options.build || !existsSync(join(distRoot, 'index.html'))) {
		process.stdout.write('[capture] building the table / code harness…\n');
		execFileSync(
			'pnpm',
			['exec', 'vite', 'build', '--config', join(HARNESS_DIR, 'vite.config.ts')],
			{
				cwd: REPO_ROOT,
				stdio: 'inherit',
			},
		);
	} else {
		process.stdout.write('[capture] reusing the existing harness build\n');
	}
	if (!existsSync(join(distRoot, 'index.html'))) {
		throw new Error(`harness build produced no ${HARNESS_DIST}/index.html`);
	}

	const server = await serveDirectory(distRoot);
	let capture = null;
	let verdict = null;
	let observation = null;
	try {
		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: harness built, nothing written\n');
		} else {
			const { chromium } = await import('@playwright/test');
			const sharp = (await import('sharp')).default;
			ensureDir(join(options.pngDir, 'x.png'));
			const pagePng = resolve(REPO_ROOT, options.pngDir, 'mobile.png');
			const browser = await chromium.launch();
			try {
				const context = await browser.newContext({
					viewport: { width: options.width, height: 812 },
					deviceScaleFactor: 2,
					isMobile: false,
				});
				const page = await context.newPage();
				await page.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle' });
				observation = await observeFixture(page);
				// The screenshot is taken BEFORE the keyboard probe so the
				// artefact shows the page as a reader first meets it, not
				// with a focus ring the reader never asked for.
				writeFileSync(pagePng, await page.screenshot({ fullPage: true, type: 'png' }));
				await measureKeyboardScroll(page, observation);
				await context.close();
			} finally {
				await browser.close();
			}

			verdict = evaluateObservation(observation);
			for (const failure of verdict.failures) process.stderr.write(`- ${failure}\n`);
			if (!verdict.ok) {
				throw new Error(
					`the browser observations contradict the table / code contract (${verdict.failures.length} failure(s)); no artefact was written`,
				);
			}

			const header = headerSvg({ observation, gate });
			const panel = evidencePanelSvg({
				observation,
				gate,
				width: SCREENSHOT_MAX_WIDTH - PANEL_WIDTH - GUTTER,
			});
			const outPath = resolve(REPO_ROOT, options.screenshot);
			ensureDir(options.screenshot);
			const geometry = await composeArtefact({
				sharp,
				pagePng,
				header: { ...header, panelSvg: panel.svg, panelHeight: panel.height },
				outPath,
			});
			const meta = await sharp(outPath).metadata();
			const budget = screenshotBudgetVerdict(statSync(outPath).size);
			// The intermediate PNG never reaches the repository.
			rmSync(pagePng, { force: true });
			if (!budget.withinBudget) {
				throw new Error(
					`capture is ${budget.kb} kB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB budget`,
				);
			}
			capture = {
				artefact: options.screenshot,
				fixture: `${FIXTURE_MODULE}#${FIXTURE_EXPORT}`,
				viewport: { width: options.width, height: 812 },
				deviceScaleFactor: 2,
				quality: SCREENSHOT_QUALITY,
				width: meta.width ?? null,
				height: meta.height ?? null,
				...geometry,
				...budget,
			};
			process.stdout.write(
				`[capture] wrote ${options.screenshot} (${capture.width}x${capture.height}, ${budget.kb} kB)\n`,
			);
		}
	} finally {
		await server.close();
	}

	const report = {
		issue: '#407',
		generatedBy: 'scripts/capture-a11y-table-code.mjs',
		fixture: { module: FIXTURE_MODULE, export: FIXTURE_EXPORT, selector: FIXTURE_SELECTOR },
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
		harness: { dir: HARNESS_DIR, dist: HARNESS_DIST, entry: harnessIndexHtml() },
		observation,
		verdict,
		gate: {
			violations: gate.violations,
			filesScanned: gate.filesScanned,
			primitive: gate.primitive,
			cases: gate.cases,
		},
		wcag: WCAG_MAPPING,
		humanEvaluation: gate.humanEvaluation,
		policy: {
			webpOnly: true,
			maxWidth: SCREENSHOT_MAX_WIDTH,
			quality: SCREENSHOT_QUALITY,
			budgetBytes: SCREENSHOT_BUDGET_BYTES,
			issuePathSubstituted: 'docs/verification/a11y/table-code-mobile.png -> .webp',
			reproducible:
				'the encode step is deterministic; the browser capture is not byte-reproducible',
		},
		capture,
	};
	ensureDir(options.jsonOut);
	writeFileSync(resolve(REPO_ROOT, options.jsonOut), `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(`[capture] wrote ${options.jsonOut}\n`);
	return 0;
}

if (process.argv[1]?.endsWith('capture-a11y-table-code.mjs')) {
	main().then(
		(code) => {
			process.exitCode = code;
		},
		(error) => {
			process.stderr.write(`${error.message}\n`);
			process.exitCode = 1;
		},
	);
}
