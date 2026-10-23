#!/usr/bin/env node

/**
 * capture-a11y-focus-visible — capture the Issue #395 verification screen
 * into `docs/verification/a11y/focus-visible.webp`.
 *
 * What this captures
 * ------------------
 * The focus contract, in a real browser, in TWO states of the SAME page:
 *
 *   left  — the page WITHOUT the focus compensation. The browser scrolls
 *           the last focusable element of the document to the bottom edge
 *           of the viewport (it cannot scroll past the end of the
 *           document), which is exactly where a fixed bottom overlay
 *           sits. The element is entirely behind the overlay.
 *   right — the page WITH the compensation the repository ships. The
 *           element is clear of the overlay.
 *
 * The two states differ ONLY by the compensation, and the compensation is
 * copied VERBATIM from `src/styles.css` — the same rules, the same
 * custom property, the same fallback. A stylesheet that stops declaring
 * the compensation makes the two states identical, and the capture fails
 * instead of photographing a picture that no longer describes the code.
 *
 * It is also an ASSERTION, not only a screenshot:
 *
 *   - the focused element's COMPUTED outline is read from the browser and
 *     checked for visibility (a non-`none` style, a non-zero width, a
 *     non-transparent colour), which is the SC 2.4.7 half;
 *   - `document.elementFromPoint()` is asked what is actually painted at
 *     the centre of the focused element, which is the SC 2.4.11 half.
 *     The element is OBSCURED when the answer is not the element itself.
 *
 * Why a generated harness instead of a page of the site
 * ------------------------------------------------------
 * The claim is about the MECHANISM — a fixed overlay, a focused element
 * at the end of the document, and the room reserved for the overlay — and
 * the mechanism is only reproducible when the focused element is the last
 * one in the document. The site is not the fixture; the compensation
 * contract is. The harness therefore renders the SHIPPED compensation
 * rules and the SHIPPED focus colour, and nothing else.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is read
 *     or printed. The harness is generated from the shipped stylesheet and
 *     the shipped token modules.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port; Chromium refuses ES modules from `file://`, which
 *     is the only reason an origin exists.
 *   - Chromium screenshots are not byte-reproducible across processes, so
 *     the report records conditions instead of claiming a deterministic
 *     artefact.
 *
 * WebP, not PNG
 * -------------
 * Chromium only writes PNG, but a verification artefact does not justify
 * a permanently large binary in the tree. The capture is taken into
 * `.tmp/`, encoded with the existing `sharp` devDependency at width <=
 * 1600 / quality 80, and the committed file is the `.webp` sibling. The
 * script REFUSES any non-`.webp` output path and deletes the intermediate
 * PNG.
 *
 * Usage:
 *   node scripts/capture-a11y-focus-visible.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/a11y/focus-visible.webp)
 *   --png-dir=<path>     temporary PNG directory (default .tmp/a11y-focus-visible)
 *   --json-out=<path>    report destination
 *                         (default .tmp/a11y-focus-visible/report.json)
 *   --no-capture         build and assert nothing browser-side; write no
 *                         artefact
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	FOCUS_CONDITIONS,
	HUMAN_EVALUATION,
	collectEvidence,
	findStyleObjects,
} from './check-a11y-focus-visible.mjs';
import { loadTokenModules, resolveRawColor, resolveSemanticValue } from './check-a11y-contrast.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The committed artefact. */
export const ARTEFACT = 'docs/verification/a11y/focus-visible.webp';

/** The generated harness. */
export const HARNESS_DIR = '.tmp/a11y-focus-visible/harness';

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 400 * 1024;

/** The viewport the two states are captured at. */
export const VIEWPORT = { width: 800, height: 600 };
export const DEVICE_SCALE_FACTOR = 1;

/**
 * The custom property the shipped compensation is written against.
 *
 * It is the property `src/editorial/analytics/AnalyticsConsent.tsx`
 * publishes (the height the fixed surface occupies), so the harness
 * reproduces the shipped chain rather than a made-up one.
 */
export const OFFSET_PROPERTY = '--analytics-consent-offset';

/** The height the representative overlay occupies, in CSS pixels. */
export const OVERLAY_HEIGHT = 140;

/** How long to wait for the focus scroll to settle before measuring. */
export const SETTLE_MS = 250;

/**
 * The WCAG 2.2 criteria this artefact speaks to, with their levels.
 */
export const WCAG_MAPPING = [
	{ sc: '2.4.7', name: 'Focus Visible', level: 'AA' },
	{ sc: '2.4.11', name: 'Focus Not Obscured (Minimum)', level: 'AA' },
];

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

/** Minimal XML / HTML escaping. */
export function escapeXml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * The shipped compensation rules, read from `src/styles.css` (pure over
 * the stylesheet text).
 *
 * A rule is part of the compensation when one of its declarations
 * CONSUMES the offset property. The rule is copied verbatim, so the
 * harness carries the shipped selector, the shipped property and the
 * shipped fallback — not a paraphrase of them.
 */
export function readShippedCompensation(source) {
	const code = source.replace(/\/\*[\s\S]*?\*\//g, '');
	const rules = [];
	for (const match of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const selector = match[1].trim();
		const declarations = [];
		for (const declaration of match[2].split(';')) {
			const text = declaration.trim();
			if (text === '') continue;
			const separator = text.indexOf(':');
			if (separator === -1) continue;
			declarations.push({
				property: text.slice(0, separator).trim(),
				value: text.slice(separator + 1).trim(),
			});
		}
		if (declarations.length === 0) continue;
		const consumesOffset = declarations.some((declaration) =>
			declaration.value.includes(`var(${OFFSET_PROPERTY}`),
		);
		if (!consumesOffset) continue;
		rules.push({ selector, declarations });
	}
	return rules;
}

/**
 * The CSS the harness renders for one state (pure).
 *
 * `enabled` decides whether the offset-consuming declarations are emitted.
 * Every other declaration of the shipped rule is emitted in BOTH states,
 * so the two screenshots differ only by the compensation.
 */
export function compensationCss(rules, { enabled }) {
	return rules
		.map((rule) => {
			const declarations = rule.declarations.filter(
				(declaration) => enabled || !declaration.value.includes(`var(${OFFSET_PROPERTY}`),
			);
			if (declarations.length === 0) return '';
			const body = declarations
				.map((declaration) => `${declaration.property}: ${declaration.value}`)
				.join('; ');
			return `${rule.selector} { ${body} }`;
		})
		.filter((text) => text !== '')
		.join('\n');
}

/**
 * The focus ring the shipped navigation draws (pure over the source).
 *
 * The harness must not invent a focus ring: the claim this artefact makes
 * is about the ring the repository SHIPS, so the ring is read from
 * `src/editorial/nav/PublicNav.tsx` and the token reference in it is
 * resolved with the colour the token modules publish. A navigation that
 * stopped declaring an outline makes the capture fail instead of
 * photographing a ring the repository does not draw.
 */
export function readShippedFocusRing(source, { focusColor }) {
	for (const object of findStyleObjects(source)) {
		for (const [key, declaration] of object.declarations) {
			if (!FOCUS_CONDITIONS.includes(key)) continue;
			if (declaration.kind !== 'object' || !declaration.object) continue;
			const outline = declaration.object.get('outline');
			if (!outline) continue;
			return {
				condition: key,
				value: outline.value.replace(/\{[^}]*border\.focus[^}]*\}/g, focusColor),
			};
		}
	}
	return null;
}

/**
 * The generated harness page (pure).
 *
 * The page is representative UI, not the site: a long document whose
 * LAST focusable element is the one under test, and a fixed overlay at
 * the bottom of the viewport — the shape of the shipped consent surface.
 */
export function harnessHtml({
	rules,
	enabled,
	canvas,
	focusColor,
	textColor,
	focusRing = '2px solid var(--colors-border-focus)',
	offsetProperty = OFFSET_PROPERTY,
	overlayHeight = OVERLAY_HEIGHT,
}) {
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>focus visibility / focus not obscured (#395)</title>
		<style>
			* { box-sizing: border-box; }
			:root {
				${offsetProperty}: ${overlayHeight}px;
				--colors-bg-canvas: ${escapeXml(canvas)};
				--colors-text-default: ${escapeXml(textColor)};
				--colors-border-focus: ${escapeXml(focusColor)};
				color-scheme: light;
			}
			${compensationCss(rules, { enabled })}
			body {
				margin: 0;
				background: var(--colors-bg-canvas);
				color: var(--colors-text-default);
				font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
				scroll-behavior: auto;
			}
			#filler { height: 2500px; }
			#focus-target {
				display: block;
				padding: 16px 20px;
				border-bottom: 1px solid rgba(128, 128, 128, 0.35);
				outline: ${escapeXml(focusRing)};
				outline-offset: 2px;
				color: var(--colors-text-default);
			}
			#focus-overlay {
				position: fixed;
				inset-inline: 0;
				bottom: 0;
				height: ${overlayHeight}px;
				display: flex;
				align-items: center;
				padding: 0 20px;
				background: #1f2937;
				color: #f9fafb;
				font-size: 13px;
			}
		</style>
	</head>
	<body>
		<div id="filler"></div>
		<a id="focus-target" href="#end">the last focusable element of the document</a>
		<div id="focus-overlay">a fixed overlay at the bottom of the viewport</div>
	</body>
</html>
`;
}

/**
 * Focus the element under test (runs in the browser).
 *
 * The focus is what makes the browser scroll the element into view — the
 * behaviour the criterion is about.
 */
export const FOCUS_TARGET = () => {
	document.getElementById('focus-target')?.focus();
};

/**
 * Read the focus state from the browser (runs in the browser).
 *
 * The outline is read from the COMPUTED style, and the covering element
 * is read from `elementFromPoint()` — what the browser actually paints at
 * the centre of the focused element.
 */
export const READ_FOCUS_STATE = () => {
	const target = document.getElementById('focus-target');
	const overlay = document.getElementById('focus-overlay');
	if (!target || !overlay) return null;
	const computed = window.getComputedStyle(target);
	const rect = target.getBoundingClientRect();
	const overlayRect = overlay.getBoundingClientRect();
	const point = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
	const topElement = point ? point.id || point.tagName : null;
	return {
		activeElementId: document.activeElement ? document.activeElement.id : null,
		outlineStyle: computed.outlineStyle,
		outlineWidth: computed.outlineWidth,
		outlineColor: computed.outlineColor,
		outlineOffset: computed.outlineOffset,
		rectTop: Math.round(rect.top),
		rectBottom: Math.round(rect.bottom),
		viewportHeight: window.innerHeight,
		overlayTop: Math.round(overlayRect.top),
		overlayBottom: Math.round(overlayRect.bottom),
		topElementAtCentre: topElement,
		obscured: !(point === target || target.contains(point)),
	};
};

/**
 * Decide whether the measured states prove the contract (pure).
 *
 *   - the focus indicator is VISIBLE in both states;
 *   - without the compensation the element is OBSCURED (the defect is
 *     real, and the artefact is not photographing a scenario that cannot
 *     happen);
 *   - with the compensation the element is NOT obscured (the shipped
 *     compensation is what makes the difference).
 */
export function evaluateScenarios({ states }) {
	const failures = [];
	const uncompensated = states.uncompensated;
	const compensated = states.compensated;
	if (!uncompensated || !compensated) {
		return { ok: false, failures: ['one of the two states was not measured'] };
	}
	for (const [name, state] of Object.entries(states)) {
		if (state.activeElementId !== 'focus-target') {
			failures.push(`${name}: the element under test is not the focused element`);
		}
		if (state.outlineStyle === 'none' || state.outlineWidth === '0px') {
			failures.push(
				`${name}: the focus indicator is not visible (outline ${state.outlineStyle} ${state.outlineWidth})`,
			);
		}
		if (state.outlineColor === 'rgba(0, 0, 0, 0)') {
			failures.push(`${name}: the focus indicator is transparent`);
		}
	}
	if (!uncompensated.obscured) {
		failures.push(
			'uncompensated: the focused element is NOT covered by the overlay, so this page does not reproduce the defect the compensation exists for',
		);
	}
	if (compensated.obscured) {
		failures.push(
			`compensated: the focused element is still covered by the overlay (elementFromPoint → ${compensated.topElementAtCentre})`,
		);
	}
	return { ok: failures.length === 0, failures };
}

/** The header band: what was measured, what was not. */
export function headerSvg({ states, rules, width = SCREENSHOT_MAX_WIDTH }) {
	const title = 'focus visible / focus not obscured — the shipped compensation (Issue #395)';
	const uncompensated = states.uncompensated;
	const compensated = states.compensated;
	const lines = [
		'machine-checked: the focus indicator is visible in both states (computed outline, SC 2.4.7, AA)',
		`machine-checked: without the compensation the focused element is entirely behind the overlay (elementFromPoint → ${uncompensated?.topElementAtCentre ?? 'n/a'}; SC 2.4.11, AA)`,
		`machine-checked: with the compensation shipped in src/styles.css the focused element is clear (elementFromPoint → ${compensated?.topElementAtCentre ?? 'n/a'})`,
		`the compensation copied from src/styles.css: ${rules.map((rule) => rule.selector).join(' / ') || 'none'}`,
		'not machine-checked: whether the indicator is legible against its background (Issue #399), whether the reserved room is tall enough at every viewport, focus order, screen-reader announcement (human evaluation)',
		`WCAG 2.2: ${WCAG_MAPPING.map((entry) => `${entry.sc} ${entry.level}`).join(' · ')}`,
	];
	const rowTop = 34;
	const step = 20;
	const height = rowTop + lines.length * step + 16;
	const text = lines
		.map(
			(line, index) =>
				`<text x="16" y="${rowTop + index * step}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" fill="#1c2030">${escapeXml(line)}</text>`,
		)
		.join('\n');
	return {
		height,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
	<rect width="${width}" height="${height}" fill="#f4efdf" />
	<text x="16" y="20" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="16" font-weight="700" fill="#0b1020">${escapeXml(title)}</text>
	${text}
</svg>
`,
	};
}

/** Compose the artefact: the header band above the two states. */
export async function composeArtefact({ sharp, shots, header, outPath }) {
	const panels = [];
	for (const shot of shots) {
		const buffer = await sharp(shot.path).png().toBuffer();
		panels.push(buffer);
	}
	const body = await sharp({
		create: {
			width: VIEWPORT.width * panels.length,
			height: VIEWPORT.height,
			channels: 3,
			background: { r: 255, g: 255, b: 255 },
		},
	})
		.composite(
			panels.map((input, index) => ({
				input,
				left: index * VIEWPORT.width,
				top: 0,
			})),
		)
		.png()
		.toBuffer();
	const extended = await sharp(body)
		.extend({
			top: header.height,
			bottom: 0,
			left: 0,
			right: 0,
			background: { r: 244, g: 239, b: 223 },
		})
		.png()
		.toBuffer();
	await sharp(extended)
		.composite([{ input: Buffer.from(header.svg), left: 0, top: 0 }])
		.webp({ quality: SCREENSHOT_QUALITY })
		.toFile(outPath);
	return { panelWidth: VIEWPORT.width, panelHeight: VIEWPORT.height };
}

/** Content types the generated harness needs. */
const CONTENT_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
};

/** Resolve one request path inside the served root (pure). */
export function resolveStaticTarget(root, requestPath) {
	const base = resolve(root);
	const candidate = resolve(base, `.${decodeURIComponent(requestPath)}`);
	if (candidate !== base && !candidate.startsWith(`${base}/`)) return { status: 403, file: null };
	if (!existsSync(candidate)) return { status: 404, file: null };
	return {
		status: 200,
		file: candidate,
		contentType: CONTENT_TYPES[extname(candidate)] ?? 'application/octet-stream',
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

function parseArgs(argv) {
	const options = {
		screenshot: ARTEFACT,
		pngDir: '.tmp/a11y-focus-visible',
		jsonOut: '.tmp/a11y-focus-visible/report.json',
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

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.capture) assertWebpOutputPath(options.screenshot);

	const gate = await collectEvidence();
	if (gate.violations.length > 0) {
		process.stderr.write(`the focus gate reports ${gate.violations.length} violation(s)\n`);
		for (const violation of gate.violations) {
			process.stderr.write(`  [${violation.rule}] ${violation.message}\n`);
		}
		throw new Error(
			'the focus gate reports violations; the artefact would photograph a broken contract',
		);
	}

	const { rawTokens, semanticTokens } = await loadTokenModules();
	const canvas = resolveRawColor(
		rawTokens,
		resolveSemanticValue(semanticTokens, 'bg.canvas', 'base').reference,
	);
	const textColor = resolveRawColor(
		rawTokens,
		resolveSemanticValue(semanticTokens, 'text.default', 'base').reference,
	);
	const focusColor = resolveRawColor(
		rawTokens,
		resolveSemanticValue(semanticTokens, 'border.focus', 'base').reference,
	);

	const stylesheet = readFileSync(resolve(REPO_ROOT, 'src/styles.css'), 'utf8');
	const rules = readShippedCompensation(stylesheet);
	if (rules.length === 0) {
		throw new Error(
			`src/styles.css declares no rule that consumes ${OFFSET_PROPERTY}; the shipped compensation is gone, so the artefact would photograph a contract the repository no longer has`,
		);
	}

	const navigation = readFileSync(resolve(REPO_ROOT, 'src/editorial/nav/PublicNav.tsx'), 'utf8');
	const focusRing = readShippedFocusRing(navigation, { focusColor });
	if (!focusRing) {
		throw new Error(
			'src/editorial/nav/PublicNav.tsx declares no focus outline; the artefact would photograph a focus ring the repository does not draw',
		);
	}

	const harness = HARNESS_DIR;
	ensureDir(harness);
	writeFileSync(
		resolve(REPO_ROOT, harness, 'uncompensated.html'),
		harnessHtml({
			rules,
			enabled: false,
			canvas,
			focusColor,
			textColor,
			focusRing: focusRing.value,
		}),
	);
	writeFileSync(
		resolve(REPO_ROOT, harness, 'compensated.html'),
		harnessHtml({
			rules,
			enabled: true,
			canvas,
			focusColor,
			textColor,
			focusRing: focusRing.value,
		}),
	);

	const server = await serveDirectory(resolve(REPO_ROOT, harness));
	let capture = null;
	let verdict = null;
	let states = null;
	try {
		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: harness written, nothing captured\n');
		} else {
			const { chromium } = await import('@playwright/test');
			const sharp = (await import('sharp')).default;
			ensureDir(options.pngDir);
			const browser = await chromium.launch();
			const shots = [];
			try {
				const context = await browser.newContext({
					viewport: VIEWPORT,
					deviceScaleFactor: DEVICE_SCALE_FACTOR,
					isMobile: false,
				});
				const page = await context.newPage();
				states = {};
				for (const [name, file] of [
					['uncompensated', 'uncompensated.html'],
					['compensated', 'compensated.html'],
				]) {
					await page.goto(`${server.baseUrl}/${file}`, { waitUntil: 'networkidle' });
					await page.waitForSelector('#focus-target');
					await page.evaluate(FOCUS_TARGET);
					await page.waitForTimeout(SETTLE_MS);
					states[name] = await page.evaluate(READ_FOCUS_STATE);
					const shot = resolve(REPO_ROOT, options.pngDir, `${name}.png`);
					writeFileSync(shot, await page.screenshot({ type: 'png' }));
					shots.push({ name, path: shot });
				}
				await context.close();
			} finally {
				await browser.close();
			}

			verdict = evaluateScenarios({ states });
			for (const failure of verdict.failures) process.stderr.write(`- ${failure}\n`);
			if (!verdict.ok) {
				throw new Error(
					`the measured states do not prove the focus contract (${verdict.failures.length} failure(s)); no artefact was written`,
				);
			}

			const header = headerSvg({ states, rules });
			const outPath = resolve(REPO_ROOT, options.screenshot);
			ensureDir(options.screenshot);
			const geometry = await composeArtefact({ sharp, shots, header, outPath });
			const meta = await sharp(outPath).metadata();
			const bytes = statSync(outPath).size;
			// The intermediate PNGs never reach the repository.
			for (const shot of shots) rmSync(shot.path, { force: true });
			if (bytes > SCREENSHOT_BUDGET_BYTES) {
				throw new Error(
					`capture is ${Math.round(bytes / 1024)} kB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB budget`,
				);
			}
			capture = {
				artefact: options.screenshot,
				viewport: VIEWPORT,
				deviceScaleFactor: DEVICE_SCALE_FACTOR,
				quality: SCREENSHOT_QUALITY,
				width: meta.width ?? null,
				height: meta.height ?? null,
				bytes,
				kb: Math.round(bytes / 1024),
				...geometry,
			};
			process.stdout.write(
				`[capture] wrote ${options.screenshot} (${capture.width}x${capture.height}, ${capture.kb} kB)\n`,
			);
		}
	} finally {
		await server.close();
	}

	const report = {
		issue: '#395',
		generatedBy: 'scripts/capture-a11y-focus-visible.mjs',
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
		harness: { dir: harness },
		states,
		verdict,
		compensation: rules,
		focusRing,
		colours: { canvas, focusColor, textColor },
		gate: { violations: gate.violations },
		wcag: WCAG_MAPPING,
		humanEvaluation: HUMAN_EVALUATION,
		capture,
	};
	ensureDir(options.jsonOut);
	writeFileSync(resolve(REPO_ROOT, options.jsonOut), `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(`[capture] wrote ${options.jsonOut}\n`);
	return 0;
}

if (process.argv[1]?.endsWith('capture-a11y-focus-visible.mjs')) {
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
