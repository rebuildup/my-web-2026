#!/usr/bin/env node

/**
 * capture-a11y-icon-button-names — capture the Issue #396 verification
 * screen into `docs/verification/a11y/icon-button-names.webp`.
 *
 * What this captures
 * ------------------
 * The repository's own fixtures, rendered side by side:
 *
 *   - the `pass/` fixture whose icon-only button carries an `aria-label`,
 *   - the `fail/` fixture whose icon-only button carries nothing at all.
 *
 * Both live in the repository (`scripts/fixtures/a11y-icon-button-names/`)
 * and the harness imports them DIRECTLY, so the artefact cannot drift
 * from the files the gate reads. The screen shows the one contrast the
 * Issue is about: two buttons that look the same to a sighted reader
 * and are not the same to a screen reader.
 *
 * It is also an ASSERTION, not only a screenshot. From the live DOM it
 * reads, for every case:
 *
 *   - whether the button rendered at all and carries an icon,
 *   - the accessible name the browser resolves for it, and WHICH
 *     mechanism supplied it (`aria-label` / `aria-labelledby` /
 *     `title` / text / none),
 *   - the accessibility tree Chromium reports for the whole screen, so
 *     the artefact records what a screen reader would announce and not
 *     only what the markup intended.
 *
 * The named case must resolve a NON-EMPTY name, and the unnamed case
 * must resolve NO name: the second half is what makes the artefact a
 * reproduction of the defect rather than a picture of a button.
 *
 * Why a generated harness instead of the Storybook build
 * --------------------------------------------------------
 * `pnpm run build-storybook` in this repository emits a MANAGER-ONLY
 * static build (no `iframe.html`): the `@storybook/react-vite` builder
 * merges the project's `vite.config.ts`, whose Cloudflare / TanStack
 * Start plugins take over the output (recorded in
 * `scripts/capture-error-state-gallery.mjs`, Issue #501). The harness
 * below imports the fixture files themselves, so the capture and the
 * gate cannot diverge.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is
 *     read or printed. The fixtures are literals in the repository.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port. Chromium refuses ES modules from `file://`,
 *     which is the only reason an origin exists.
 *   - Chromium screenshots are not byte-reproducible across processes,
 *     so the report records conditions instead of claiming a
 *     deterministic artefact.
 *
 * WebP, not PNG
 * -------------
 * Chromium only writes PNG and Issue #396 names a `.png` path, but a
 * verification artefact does not justify a permanently large binary in
 * the tree. The capture is taken into `.tmp/`, encoded with the
 * existing `sharp` devDependency at width <= 1600 / quality 80, and the
 * committed file is the `.webp` sibling. The script REFUSES any
 * non-`.webp` output path and deletes the intermediate PNG.
 *
 * Usage:
 *   node scripts/capture-a11y-icon-button-names.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/a11y/icon-button-names.webp)
 *   --png-dir=<path>     temporary PNG directory (default .tmp/a11y-icon-button-names)
 *   --json-out=<path>    report destination (default .tmp/a11y-icon-button-names/report.json)
 *   --width=<n>          CSS viewport width (default 1280)
 *   --no-build           reuse an existing harness build in .tmp
 *   --no-capture         build and assert nothing browser-side; write no artefact
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectEvidence, renderGateSummary } from './check-a11y-icon-button-names.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The fixture files the capture renders, and the case each one is. */
export const CASES = [
	{
		caseId: 'named',
		label: 'named icon button',
		module: 'scripts/fixtures/a11y-icon-button-names/pass/aria-label.tsx',
		exportName: 'AriaLabelIconButton',
		expectation: 'named',
	},
	{
		caseId: 'unnamed',
		label: 'icon button without a name',
		module: 'scripts/fixtures/a11y-icon-button-names/fail/missing-name.tsx',
		exportName: 'MissingNameIconButton',
		expectation: 'unnamed',
	},
];

/** Readiness marker the capture waits for before reading anything. */
export const FIXTURE_SELECTOR = '[data-a11y-case]';

/** The WCAG 2.2 criteria this artefact speaks to, with their levels. */
export const WCAG_MAPPING = [
	{ sc: '1.3.1', name: 'Info and Relationships', level: 'A' },
	{ sc: '2.4.6', name: 'Headings and Labels', level: 'AA' },
	{ sc: '4.1.2', name: 'Name, Role, Value', level: 'A' },
];

export const HARNESS_DIR = '.tmp/a11y-icon-button-names/harness';
export const HARNESS_DIST = '.tmp/a11y-icon-button-names/harness-dist';

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
	const cases = observation.cases ?? [];
	const ids = cases.map((entry) => entry.caseId);
	for (const expected of CASES) {
		if (!ids.includes(expected.caseId)) {
			failures.push(
				`the ${expected.caseId} case was not rendered; both cases have to be compared, not the first one that appears`,
			);
		}
	}

	for (const entry of cases) {
		const where = `case "${entry.caseId}"`;
		if (!entry.hasButton) {
			failures.push(`${where}: no button rendered`);
			continue;
		}
		if (!entry.hasIcon) {
			failures.push(`${where}: the button carries no icon, so it is not the icon-button case`);
		}
		if (entry.expectation === 'named') {
			if (entry.resolvedName.trim() === '') {
				failures.push(
					`${where}: the named button resolves NO accessible name (source: ${entry.nameSource}); the artefact would claim a contract the page does not keep (SC 4.1.2)`,
				);
			}
		} else if (entry.expectation === 'unnamed') {
			if (entry.resolvedName.trim() !== '') {
				failures.push(
					`${where}: the unnamed button resolves the name "${entry.resolvedName}" (source: ${entry.nameSource}); the defect this artefact reproduces is gone`,
				);
			}
		}
	}

	return { ok: failures.length === 0, failures };
}

/**
 * One compact line per case, for the artefact's evidence panel: what
 * the browser resolved, next to the case it belongs to.
 */
export function evidenceRows(observation) {
	return (observation.cases ?? []).map(
		(entry) =>
			`${entry.caseId.padEnd(9)} name-source=${entry.nameSource.padEnd(13)} resolved="${entry.resolvedName}" icon=${entry.hasIcon ? 'yes' : 'NO'}`,
	);
}

/** The generated harness page. Deterministic, so the report can hash it. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>icon button accessible names (#396)</title>
		<style>
			body {
				margin: 0;
				padding: 32px;
				background: #ffffff;
				color: #1c2030;
				font-family: ui-sans-serif, system-ui, sans-serif;
			}
			h1 {
				font-size: 20px;
				margin: 0 0 4px;
			}
			p.lead {
				margin: 0 0 28px;
				color: #5a6072;
				font-size: 13px;
			}
			.cases {
				display: flex;
				gap: 48px;
				align-items: flex-start;
			}
			.case {
				border: 1px solid #d8d2c0;
				border-radius: 8px;
				padding: 20px;
				min-width: 220px;
			}
			.case h2 {
				font-size: 13px;
				margin: 0 0 4px;
			}
			.case p {
				font-size: 12px;
				color: #5a6072;
				margin: 0 0 16px;
			}
			button {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 44px;
				height: 44px;
				border-radius: 8px;
				border: 1px solid #d8d2c0;
				background: #f7f5ef;
				color: #1c2030;
			}
			button svg {
				width: 20px;
				height: 20px;
			}
		</style>
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
 * It imports the fixture files themselves, so the capture shows the
 * same buttons the gate reads — a renamed or rewritten fixture changes
 * the artefact instead of leaving a stale one behind.
 */
export function harnessMainTsx(harnessDir = HARNESS_DIR) {
	const depth = harnessDir.split('/').length;
	const up = '../'.repeat(depth);
	const imports = CASES.map(
		(entry) => `import { ${entry.exportName} } from '${up}${entry.module.replace(/\.tsx$/, '')}';`,
	).join('\n');
	const cases = CASES.map(
		(entry) => `		<section
			data-a11y-case="${entry.caseId}"
			data-a11y-label="${entry.label}"
			data-a11y-expectation="${entry.expectation}"
		>
			<h2>${entry.label}</h2>
			<p>${entry.module.split('/').pop()}</p>
			<${entry.exportName} />
		</section>`,
	).join('\n');
	return `import { createRoot } from 'react-dom/client';
${imports}

const container = document.getElementById('root');
if (!container) throw new Error('harness root missing');

createRoot(container).render(
	<div data-a11y-root="true">
		<h1>Icon button accessible names — Issue #396</h1>
		<p class="lead">
			The two buttons look the same. Only the left one is announced with a name.
		</p>
		<div class="cases">
${cases}
		</div>
	</div>,
);
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
 * Read the accessibility-relevant facts out of the rendered page.
 *
 * Runs in the browser, so it is written as a function body that
 * Chromium serialises — no imports, no closure variables.
 */
export const READ_CASES = () => {
	const resolveName = (element) => {
		const ariaLabel = element.getAttribute('aria-label');
		if (ariaLabel && ariaLabel.trim() !== '') {
			return { source: 'aria-label', name: ariaLabel.trim() };
		}
		const labelledBy = element.getAttribute('aria-labelledby');
		if (labelledBy && labelledBy.trim() !== '') {
			const target = document.getElementById(labelledBy.trim());
			const text = (target?.textContent ?? '').replace(/\s+/g, ' ').trim();
			if (text !== '') return { source: 'aria-labelledby', name: text };
		}
		const title = element.getAttribute('title');
		if (title && title.trim() !== '') {
			return { source: 'title', name: title.trim() };
		}
		const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (text !== '') return { source: 'text', name: text };
		return { source: 'none', name: '' };
	};
	return [...document.querySelectorAll('[data-a11y-case]')].map((section) => {
		const button = section.querySelector('button');
		const resolved = button ? resolveName(button) : { source: 'none', name: '' };
		return {
			caseId: section.getAttribute('data-a11y-case'),
			label: section.getAttribute('data-a11y-label') ?? '',
			expectation: section.getAttribute('data-a11y-expectation') ?? '',
			hasButton: Boolean(button),
			hasIcon: Boolean(button?.querySelector('svg, img')),
			nameSource: resolved.source,
			resolvedName: resolved.name,
		};
	});
};

/** Compose the artefact: header band, then the render and the evidence. */
export async function composeArtefact({ sharp, pagePng, header, outPath }) {
	const panelWidth = SCREENSHOT_MAX_WIDTH - PANEL_WIDTH - GUTTER;
	const page = await sharp(pagePng).resize({ width: PANEL_WIDTH }).png().toBuffer();
	const pageMeta = await sharp(page).metadata();
	const pageHeight = pageMeta.height ?? 0;
	const bodyHeight = Math.max(pageHeight, header.panelHeight ?? 0);
	const body = await sharp(page)
		.extend({
			top: 0,
			bottom: bodyHeight - pageHeight,
			left: 0,
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
			{
				input: Buffer.from(header.panelSvg),
				left: PANEL_WIDTH + GUTTER,
				top: header.height,
			},
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
	const title = 'icon button accessible names — Issue #396';
	const rows = [
		'fixtures: scripts/fixtures/a11y-icon-button-names/{pass,fail} — rendered as they are in the repository',
		`machine-checked: ${(observation.cases ?? []).length} case(s) rendered, each with an icon-only button`,
		'machine-checked: the named case resolves a non-empty accessible name (SC 4.1.2 Name, Role, Value, A)',
		'machine-checked: the unnamed case resolves NO accessible name — the defect is observable in the browser',
		`machine-checked: gate ${gate.violations.length} violation(s) over ${gate.filesScanned} source file(s) under src/`,
		'not machine-checked: whether the wording describes the action, a real screen-reader pass (human evaluation)',
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

/** The evidence panel: one row per measured case, drawn beside the render. */
export function evidencePanelSvg({ observation, gate, width }) {
	const rows = evidenceRows(observation);
	const body = [
		'machine-checked per case',
		'',
		...rows,
		'',
		'Chromium accessibility tree',
		...(observation.accessibilitySnapshot ?? '(not captured)').split('\n'),
		'',
		`cases measured: ${rows.length}`,
		`gate: ${gate.violations.length} violation(s) over ${gate.filesScanned} source file(s)`,
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
		screenshot: 'docs/verification/a11y/icon-button-names.webp',
		pngDir: '.tmp/a11y-icon-button-names',
		jsonOut: '.tmp/a11y-icon-button-names/report.json',
		width: 1280,
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

/** Wait for the fixtures, then read them. Bounded, so a broken mount reports. */
async function observeCases(page) {
	let lastError = null;
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			await page.waitForSelector(FIXTURE_SELECTOR, { timeout: 10_000 });
			return await page.evaluate(READ_CASES);
		} catch (error) {
			lastError = error;
			process.stdout.write(
				`[capture] attempt ${attempt}/3: the fixtures are not on the page (${error.message})\n`,
			);
		}
	}
	throw new Error(
		`the fixtures never mounted after 3 attempts; the artefact would photograph nothing (${lastError?.message ?? 'unknown error'})`,
	);
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.capture) assertWebpOutputPath(options.screenshot);

	const gate = collectEvidence();
	if (gate.violations.length > 0) {
		process.stderr.write(`${renderGateSummary(gate)}\n`);
		throw new Error(
			`the icon-button gate reports ${gate.violations.length} violation(s); the artefact would photograph a broken contract`,
		);
	}

	writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);
	if (options.build || !existsSync(join(distRoot, 'index.html'))) {
		process.stdout.write('[capture] building the icon-button harness…\n');
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
			const pagePng = resolve(REPO_ROOT, options.pngDir, 'capture.png');
			const browser = await chromium.launch();
			try {
				const context = await browser.newContext({
					viewport: { width: options.width, height: 820 },
					deviceScaleFactor: 2,
					isMobile: false,
				});
				const page = await context.newPage();
				await page.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle' });
				const cases = await observeCases(page);
				const accessibilitySnapshot = await page.locator('[data-a11y-root]').ariaSnapshot();
				observation = { cases, accessibilitySnapshot };
				writeFileSync(pagePng, await page.screenshot({ fullPage: true, type: 'png' }));
				await context.close();
			} finally {
				await browser.close();
			}

			verdict = evaluateObservation(observation);
			for (const failure of verdict.failures) process.stderr.write(`- ${failure}\n`);
			if (!verdict.ok) {
				throw new Error(
					`the browser observations contradict the icon-button contract (${verdict.failures.length} failure(s)); no artefact was written`,
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
				cases: CASES.map((entry) => entry.module),
				viewport: { width: options.width, height: 820 },
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
		issue: '#396',
		generatedBy: 'scripts/capture-a11y-icon-button-names.mjs',
		fixtures: CASES,
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
			textlessButtons: gate.textlessButtons,
			iconOnlyButtons: gate.iconOnlyButtons,
			namedTextlessButtons: gate.namedTextlessButtons,
		},
		wcag: WCAG_MAPPING,
		humanEvaluation: gate.humanEvaluation,
		policy: {
			webpOnly: true,
			maxWidth: SCREENSHOT_MAX_WIDTH,
			quality: SCREENSHOT_QUALITY,
			budgetBytes: SCREENSHOT_BUDGET_BYTES,
			issuePathSubstituted: 'docs/verification/a11y/icon-button-names.png -> .webp',
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

if (process.argv[1]?.endsWith('capture-a11y-icon-button-names.mjs')) {
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
