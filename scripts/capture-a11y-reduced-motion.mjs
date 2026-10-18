#!/usr/bin/env node

/**
 * capture-a11y-reduced-motion — capture the Issue #403 verification
 * screen into `docs/verification/a11y/reduced-motion-on-off.webp`.
 *
 * What this captures
 * ------------------
 * The shipped fixture (`src/home/access/reduced-motion.stories.tsx`,
 * the `home/ReducedMotion` story) rendered TWICE in one Chromium: once
 * in a `reducedMotion: 'no-preference'` context and once in a
 * `reducedMotion: 'reduce'` context. Same story id, same document,
 * only the OS preference differs — so any visible difference between
 * the two panels is the preference, not the fixture.
 *
 * It is also an ASSERTION, not only a screenshot. In both contexts the
 * script reads, from the live DOM:
 *
 *   - `getComputedStyle(img).animationName` for the first digit slot,
 *   - the digit strip's `data-motion-state`,
 *   - the strip's accessible name (`aria-label`), and
 *   - the mode banner the fixture renders from the live media query.
 *
 * and fails (exit 1) unless: the no-preference context animates with
 * `counterDigitRoll`, the reduce context animates with `none`, both
 * banners report the mode they were launched with, and BOTH contexts
 * report the SAME accessible label and the same digit-slot count. That
 * last pair is the Issue's completion condition as an executable
 * statement: turning motion off must remove movement and nothing else.
 *
 * The artefact also carries the machine gate's own verdict, so the
 * image is not a pretty screenshot with the evidence living somewhere
 * else.
 *
 * Why a generated harness instead of the Storybook gallery
 * --------------------------------------------------------
 * `pnpm run build-storybook` in this repository emits a MANAGER-ONLY
 * static build (no `iframe.html`): the `@storybook/react-vite` builder
 * merges the project's `vite.config.ts`, whose Cloudflare / TanStack
 * Start plugins take over the output (recorded in
 * `scripts/capture-error-state-gallery.mjs`, Issue #501). So the
 * harness below imports the SHIPPED story module itself and renders the
 * story's own `render()` output — the capture and the Storybook gallery
 * cannot drift, and fixing the Storybook build stays its own ticket.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is
 *     read or printed. The fixture data is literals in the story file.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port; Chromium refuses ES modules from `file://`, which
 *     is the only reason an origin exists.
 *   - Chromium screenshots are not byte-reproducible across processes,
 *     so the report records conditions instead of claiming a
 *     deterministic artefact.
 *
 * WebP, not PNG
 * -------------
 * Chromium only writes PNG and Issue #403 names a `.png` path, but a
 * verification artefact does not justify a permanently large binary in
 * the tree. The capture is taken into `.tmp/`, encoded with the
 * existing `sharp` devDependency at width <= 1600 / quality 80, and the
 * committed file is the `.webp` sibling. The script REFUSES any
 * non-`.webp` output path and deletes the intermediate PNGs.
 *
 * Usage:
 *   node scripts/capture-a11y-reduced-motion.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/a11y/reduced-motion-on-off.webp)
 *   --png-dir=<path>     temporary PNG directory (default .tmp/a11y-reduced-motion)
 *   --json-out=<path>    report destination (default .tmp/a11y-reduced-motion/report.json)
 *   --width=<n>          viewport width (default 900)
 *   --no-build           reuse an existing harness build in .tmp
 *   --no-capture         build and assert nothing browser-side; write no artefact
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WCAG_MAPPING, collectEvidence, renderGateSummary } from './check-reduced-motion.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped story the capture renders, in both preference contexts. */
export const STORY_MODULE = 'src/home/access/reduced-motion.stories.tsx';
export const STORY_EXPORT = 'Fixture';

/** Readiness markers the capture waits for before reading anything. */
export const FIXTURE_TEST_ID = 'reduced-motion-fixture';
export const MODE_TEST_ID = 'reduced-motion-mode';
export const MOTION_HOOK = '[data-motion="counter-roll"]';

/** The keyframe the counter animates with, as the browser must report it. */
export const EXPECTED_ANIMATION_NAME = 'counterDigitRoll';

export const HARNESS_DIR = '.tmp/a11y-reduced-motion/harness';
export const HARNESS_DIST = '.tmp/a11y-reduced-motion/harness-dist';

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

/** Panel geometry for the side-by-side artefact (pure, so it is testable). */
export const PANEL_GUTTER = 10;

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

/** Minimal HTML / SVG escaping: the gate text is command output, not source. */
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
	const { animated, reduced } = observation;
	if (animated.animationName !== EXPECTED_ANIMATION_NAME) {
		failures.push(
			`no-preference context animates with "${animated.animationName}", expected "${EXPECTED_ANIMATION_NAME}"`,
		);
	}
	if (reduced.animationName !== 'none') {
		failures.push(
			`reduce context still animates with "${reduced.animationName}"; the opt-out must emit no animation declaration at all`,
		);
	}
	if (animated.mode !== 'no-preference') {
		failures.push(`no-preference context rendered mode "${animated.mode}"`);
	}
	if (reduced.mode !== 'reduce') {
		failures.push(`reduce context rendered mode "${reduced.mode}"`);
	}
	if (animated.motionState !== 'animated' || reduced.motionState !== 'reduced') {
		failures.push(
			`data-motion-state disagrees with the preference (animated=${animated.motionState}, reduced=${reduced.motionState})`,
		);
	}
	if (animated.label !== reduced.label) {
		failures.push(
			`the accessible value changed with motion: "${animated.label}" vs "${reduced.label}"`,
		);
	}
	if (animated.digitSlots !== reduced.digitSlots || animated.digitSlots === 0) {
		failures.push(
			`digit slots differ between modes (${animated.digitSlots} vs ${reduced.digitSlots})`,
		);
	}
	return { ok: failures.length === 0, failures };
}

/** The generated harness page. Deterministic, so the report can hash it. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>reduced-motion fixture (#403)</title>
	</head>
	<body style="margin:0;background:#ffffff">
		<div id="root"></div>
		<script type="module" src="./main.tsx"></script>
	</body>
</html>
`;
}

/**
 * The generated harness entry point. It renders the SHIPPED story's
 * `render()` output, and the shipped stylesheet, so the capture shows
 * the same tree (and the same Panda layer order) a Storybook reviewer
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

/**
 * The header band of the artefact: what was rendered, what the browser
 * reported, which criteria are machine-checked, and which are not.
 *
 * The header exists because a screenshot alone cannot be reviewed: a
 * reviewer needs to know which preference each panel was rendered
 * under and that the assertions passed, without opening the JSON report.
 */
export function headerSvg({ animated, reduced, gate, panelWidth, width = SCREENSHOT_MAX_WIDTH }) {
	const title = 'prefers-reduced-motion: on / off — Issue #403';
	const surface = gate.surfaces[0];
	const rows = [
		`left  ${animated.mode}: animation-name=${animated.animationName}, label "${animated.label}", ${animated.digitSlots} digit slots`,
		`right ${reduced.mode}: animation-name=${reduced.animationName}, label "${reduced.label}", ${reduced.digitSlots} digit slots`,
		`machine-checked: gate ${gate.violations.length} violation(s) · floor ${gate.stylesheet.floor.missing.length === 0 ? 'present' : 'MISSING'} (${gate.stylesheet.floor.declarations.filter((name) => ['animation-duration', 'transition-duration', 'scroll-behavior'].includes(name)).join(', ')}) · ${gate.violations.length === 0 ? 'no autoplaying media' : 'see report'}`,
		`machine-checked: ${surface ? `${surface.file} hook=${surface.hooks[0]?.name ?? 'none'}, render-time opt-out=${surface.renderTimeOptOut ? 'yes' : 'no'}, stylesheet opt-out=${surface.stylesheetOptOut}` : 'no motion surface found'}`,
		'not machine-checked: reading comfort, focus order, contrast, screen-reader pass (human evaluation)',
		`WCAG 2.2: ${WCAG_MAPPING.map((entry) => `${entry.sc} ${entry.level}`).join(' · ')}`,
	];
	const topPad = 34;
	const rowTop = topPad + 34;
	const rowStep = 22;
	const labelStrip = 34;
	const height = rowTop + rows.length * rowStep + labelStrip;
	const lines = rows
		.map(
			(row, index) =>
				`<text x="16" y="${rowTop + index * rowStep}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" fill="#1c2030">${escapeXml(row)}</text>`,
		)
		.join('\n');
	return {
		height,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
	<rect width="${width}" height="${height}" fill="#f4efdf" />
	<text x="16" y="${topPad}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="20" font-weight="700" fill="#0b1020">${escapeXml(title)}</text>
	${lines}
	<rect x="0" y="${height - labelStrip}" width="${width}" height="${labelStrip}" fill="#e8e2d0" />
	<text x="16" y="${height - 11}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" fill="#5b6072">${escapeXml('motion ON — digit roll-up plays')}</text>
	<text x="${panelWidth + PANEL_GUTTER + 16}" y="${height - 11}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" fill="#5b6072">${escapeXml('motion REDUCED — same slots, same label, no movement')}</text>
</svg>
`,
	};
}

function parseArgs(argv) {
	const options = {
		screenshot: 'docs/verification/a11y/reduced-motion-on-off.webp',
		pngDir: '.tmp/a11y-reduced-motion',
		jsonOut: '.tmp/a11y-reduced-motion/report.json',
		width: 900,
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

/** Write the generated harness (idempotent, so `--no-build` can reuse it). */
export function writeHarness(repoRoot = REPO_ROOT) {
	const dir = resolve(repoRoot, HARNESS_DIR);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'index.html'), harnessIndexHtml());
	writeFileSync(join(dir, 'main.tsx'), harnessMainTsx());
	writeFileSync(join(dir, 'vite.config.ts'), harnessViteConfig(HARNESS_DIR, repoRoot));
	return dir;
}

/** Read the contract-relevant facts out of a rendered fixture page. */
async function observeFixture(page, expectedMode) {
	await page.waitForSelector(`[data-testid="${FIXTURE_TEST_ID}"]`, { timeout: 30_000 });
	const observation = await page.evaluate(
		({ hook, modeTestId }) => {
			const strip = document.querySelector(hook);
			const image = strip?.querySelector('img');
			const banner = document.querySelector(`[data-testid="${modeTestId}"]`);
			return {
				mode: banner?.getAttribute('data-mode') ?? null,
				animationName: image ? getComputedStyle(image).animationName : null,
				motionState: strip?.getAttribute('data-motion-state') ?? null,
				label: strip?.getAttribute('aria-label') ?? null,
				digitSlots: strip ? strip.querySelectorAll('img').length : 0,
			};
		},
		{ hook: MOTION_HOOK, modeTestId: MODE_TEST_ID },
	);
	if (observation.mode !== expectedMode) {
		process.stdout.write(
			`[capture] waiting for the fixture to settle on mode=${expectedMode} (saw ${observation.mode})\n`,
		);
		await page
			.waitForFunction(
				({ modeTestId, mode }) =>
					document.querySelector(`[data-testid="${modeTestId}"]`)?.getAttribute('data-mode') ===
					mode,
				{ hook: MOTION_HOOK, modeTestId: MODE_TEST_ID, mode: expectedMode },
				{ timeout: 30_000 },
			)
			.catch(() => {});
		return observeFixture(page, expectedMode);
	}
	return observation;
}

async function captureContext(browser, baseUrl, reducedMotion, width, pngPath) {
	const context = await browser.newContext({
		viewport: { width, height: 1000 },
		deviceScaleFactor: 1,
		reducedMotion,
	});
	try {
		const page = await context.newPage();
		await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
		const observation = await observeFixture(
			page,
			reducedMotion === 'reduce' ? 'reduce' : 'no-preference',
		);
		const png = await page.screenshot({ fullPage: true, type: 'png' });
		writeFileSync(pngPath, png);
		return { ...observation, reducedMotion, pngPath };
	} finally {
		await context.close();
	}
}

/**
 * Compose the two panels into one artefact: a header band, then the
 * `no-preference` render and the `reduce` render side by side.
 */
export async function composeArtefact({ sharp, animatedPng, reducedPng, header, outPath }) {
	const panelWidth = Math.floor((SCREENSHOT_MAX_WIDTH - PANEL_GUTTER) / 2);
	const animated = await sharp(animatedPng).resize({ width: panelWidth }).png().toBuffer();
	const reduced = await sharp(reducedPng).resize({ width: panelWidth }).png().toBuffer();
	const animatedMeta = await sharp(animated).metadata();
	const reducedMeta = await sharp(reduced).metadata();
	const height = Math.max(animatedMeta.height ?? 0, reducedMeta.height ?? 0);
	// The two renders can differ by a pixel row or two (the reduced-mode
	// document has no animation frame to settle), so the shorter panel is
	// padded rather than the image being stretched.
	const pad = async (buffer, meta) =>
		sharp(buffer)
			.extend({
				top: 0,
				bottom: Math.max(0, height - (meta.height ?? 0)),
				background: '#ffffff',
			})
			.png()
			.toBuffer();
	const leftPanel = await pad(animated, animatedMeta);
	const rightPanel = await pad(reduced, reducedMeta);
	const body = await sharp({
		create: {
			width: SCREENSHOT_MAX_WIDTH,
			height,
			channels: 3,
			background: { r: 255, g: 255, b: 255 },
		},
	})
		.composite([
			{ input: leftPanel, left: 0, top: 0 },
			{ input: rightPanel, left: panelWidth + PANEL_GUTTER, top: 0 },
		])
		.png()
		.toBuffer();
	// The header band is ABOVE the panels, not painted over them: a
	// composite at top 0 would cover the first rows of both renders, which
	// is exactly the part a reviewer needs to read.
	await sharp(body)
		.extend({
			top: header.height,
			bottom: 0,
			left: 0,
			right: 0,
			background: { r: 244, g: 239, b: 223 },
		})
		.composite([{ input: Buffer.from(header.svg), left: 0, top: 0 }])
		.webp({ quality: SCREENSHOT_QUALITY })
		.toFile(outPath);
	return { panelWidth, bodyHeight: height, headerHeight: header.height };
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.capture) assertWebpOutputPath(options.screenshot);

	const gate = collectEvidence();
	if (gate.violations.length > 0) {
		throw new Error(
			`the reduced-motion gate reports ${gate.violations.length} violation(s); the artefact would photograph a broken contract`,
		);
	}

	writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);
	if (options.build || !existsSync(join(distRoot, 'index.html'))) {
		process.stdout.write('[capture] building the reduced-motion harness…\n');
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
	let observations = null;
	try {
		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: harness built, nothing written\n');
		} else {
			const { chromium } = await import('@playwright/test');
			const sharp = (await import('sharp')).default;
			ensureDir(join(options.pngDir, 'x.png'));
			const animatedPng = resolve(REPO_ROOT, options.pngDir, 'motion-on.png');
			const reducedPng = resolve(REPO_ROOT, options.pngDir, 'motion-reduced.png');
			const browser = await chromium.launch();
			let animated;
			let reduced;
			try {
				animated = await captureContext(
					browser,
					server.baseUrl,
					'no-preference',
					options.width,
					animatedPng,
				);
				reduced = await captureContext(
					browser,
					server.baseUrl,
					'reduce',
					options.width,
					reducedPng,
				);
			} finally {
				await browser.close();
			}
			observations = {
				noPreference: {
					mode: animated.mode,
					animationName: animated.animationName,
					motionState: animated.motionState,
					label: animated.label,
					digitSlots: animated.digitSlots,
				},
				reduce: {
					mode: reduced.mode,
					animationName: reduced.animationName,
					motionState: reduced.motionState,
					label: reduced.label,
					digitSlots: reduced.digitSlots,
				},
			};

			verdict = evaluateObservation({ animated, reduced });
			for (const failure of verdict.failures) process.stderr.write(`- ${failure}\n`);
			if (!verdict.ok) {
				throw new Error(
					`the browser observations contradict the reduced-motion contract (${verdict.failures.length} failure(s)); no artefact was written`,
				);
			}

			const panelWidth = Math.floor((SCREENSHOT_MAX_WIDTH - PANEL_GUTTER) / 2);
			const header = headerSvg({ animated, reduced, gate, panelWidth });
			const outPath = resolve(REPO_ROOT, options.screenshot);
			ensureDir(options.screenshot);
			const geometry = await composeArtefact({
				sharp,
				animatedPng,
				reducedPng,
				header,
				outPath,
			});
			const meta = await sharp(outPath).metadata();
			const budget = screenshotBudgetVerdict(statSync(outPath).size);
			// The intermediate PNGs never reach the repository.
			rmSync(animatedPng, { force: true });
			rmSync(reducedPng, { force: true });
			if (!budget.withinBudget) {
				throw new Error(
					`capture is ${budget.kb} kB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB budget`,
				);
			}
			capture = {
				artefact: options.screenshot,
				story: `${STORY_MODULE}#${STORY_EXPORT}`,
				viewport: { width: options.width, height: 1000 },
				deviceScaleFactor: 1,
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
		issue: '#403',
		generatedBy: 'scripts/capture-a11y-reduced-motion.mjs',
		story: { module: STORY_MODULE, export: STORY_EXPORT, testId: FIXTURE_TEST_ID },
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
		harness: { dir: HARNESS_DIR, dist: HARNESS_DIST, entry: harnessIndexHtml() },
		observations,
		verdict,
		gate: {
			violations: gate.violations,
			surfaces: gate.surfaces,
			stylesheet: {
				file: gate.stylesheet.file,
				blockCount: gate.stylesheet.blockCount,
				optedOutHooks: [...gate.stylesheet.optedOutHooks.keys()],
			},
		},
		wcag: WCAG_MAPPING,
		policy: {
			webpOnly: true,
			maxWidth: SCREENSHOT_MAX_WIDTH,
			quality: SCREENSHOT_QUALITY,
			budgetBytes: SCREENSHOT_BUDGET_BYTES,
			issuePathSubstituted: 'docs/verification/a11y/reduced-motion-on-off.png -> .webp',
			reproducible:
				'the encode step is deterministic; the browser capture is not byte-reproducible',
		},
		capture,
	};
	ensureDir(options.jsonOut);
	writeFileSync(resolve(REPO_ROOT, options.jsonOut), `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(`[capture] report ${options.jsonOut}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		process.stderr.write(`capture failed: ${error.message}\n`);
		process.exit(1);
	});
}
