#!/usr/bin/env node

/**
 * capture-a11y-contrast — capture the Issue #399 verification screen into
 * `docs/verification/a11y/contrast.webp`.
 *
 * What this captures
 * ------------------
 * The shipped token layer (`src/editorial/tokens.ts` +
 * `src/editorial/semantic-tokens.ts`) rendered as the pair matrix of
 * `scripts/check-a11y-contrast.mjs`: every combination of the matrix, in the
 * light AND the dark appearance, side by side, each swatch labelled with the
 * ratio the gate measured for it.
 *
 * It is also an ASSERTION, not only a screenshot. The browser reads the
 * COMPUTED foreground and background of every swatch, recomputes the ratio
 * from those computed values and compares it with the ratio the gate
 * measured from the token modules. A swatch that renders a different colour
 * than the token says it does — a stale stylesheet, a wrong cascade, a
 * silently swapped step — fails the capture instead of producing a
 * plausible-looking picture.
 *
 * The two appearances are captured in ONE image, because the claim this
 * artefact makes is "both appearances hold", and a reader has to be able to
 * compare them without opening two files.
 *
 * Why a generated harness instead of a page of the site
 * ------------------------------------------------------
 * The matrix pairs a foreground token with a background token in a
 * combination the site does not necessarily render (a status colour on the
 * tinted feature region, for instance). The site is not the fixture; the
 * token layer is. The harness therefore renders the SHIPPED token values
 * (resolved from the same modules the gate imports) and nothing else, so
 * the picture cannot drift from the gate's verdict.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is read
 *     or printed. The harness is generated from the token modules.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port; Chromium refuses ES modules from `file://`, which is
 *     the only reason an origin exists.
 *   - Chromium screenshots are not byte-reproducible across processes, so
 *     the report records conditions instead of claiming a deterministic
 *     artefact.
 *
 * WebP, not PNG
 * -------------
 * Chromium only writes PNG and Issue #399 names a `.png` path, but a
 * verification artefact does not justify a permanently large binary in the
 * tree. The capture is taken into `.tmp/`, encoded with the existing
 * `sharp` devDependency at width <= 1600 / quality 80, and the committed
 * file is the `.webp` sibling. The script REFUSES any non-`.webp` output
 * path and deletes the intermediate PNG.
 *
 * Usage:
 *   node scripts/capture-a11y-contrast.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/a11y/contrast.webp)
 *   --png-dir=<path>     temporary PNG directory (default .tmp/a11y-contrast)
 *   --json-out=<path>    report destination
 *                         (default .tmp/a11y-contrast/report.json)
 *   --no-capture         build and assert nothing browser-side; write no
 *                         artefact
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	APPEARANCES,
	CONTRAST_PAIRS,
	EXCLUDED_TOKENS,
	HUMAN_EVALUATION,
	auditPairs,
	collectEvidence,
	contrastRatio,
	formatRatio,
	loadTokenModules,
	resolveRawColor,
	resolveSemanticValue,
} from './check-a11y-contrast.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The committed artefact. */
export const ARTEFACT = 'docs/verification/a11y/contrast.webp';

/** The generated harness. */
export const HARNESS_DIR = '.tmp/a11y-contrast/harness';
export const HARNESS_HTML = `${HARNESS_DIR}/index.html`;

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 400 * 1024;

/** The viewport the matrix is captured at. */
export const VIEWPORT = { width: 1600, height: 1000 };
export const DEVICE_SCALE_FACTOR = 1;

/** How long to wait for the harness to mount, and how many times to look. */
export const MOUNT_WAIT_ATTEMPTS = 3;
export const MOUNT_WAIT_TIMEOUT_MS = 10_000;

/**
 * The WCAG 2.2 criteria this artefact speaks to, with their levels.
 */
export const WCAG_MAPPING = [
	{ sc: '1.4.3', name: 'Contrast (Minimum)', level: 'AA' },
	{ sc: '1.4.1', name: 'Use of Color', level: 'A' },
	{ sc: '1.4.11', name: 'Non-text Contrast', level: 'AA' },
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
 * The swatch rows of one appearance: the resolved colours and the ratio.
 *
 * Pure over the measured evidence, so the capture cannot render a colour
 * the gate did not measure.
 */
export function panelRows(evidence, appearanceId) {
	return evidence.rows
		.filter((row) => row.appearance === appearanceId)
		.map((row) => ({
			// The appearance is part of the id: the same token pair is
			// measured in both appearances, so the id has to name which
			// one the swatch renders.
			id: `${appearanceId}-${row.fg}-on-${row.bg}`.replace(/\./g, '-'),
			fg: row.fg,
			bg: row.bg,
			kind: row.kind,
			threshold: row.threshold,
			fgHex: row.fgValue,
			bgHex: row.bgValue,
			ratio: row.ratio,
			pass: row.pass,
			note: row.note,
		}));
}

/**
 * The generated harness page: both appearances side by side, every swatch
 * labelled with its measured ratio.
 */
export function harnessHtml(panels) {
	const panelMarkup = panels
		.map(
			(panel) => `
		<section class="panel" style="background:${escapeXml(panel.canvas)}" data-appearance="${escapeXml(panel.id)}">
			<h2 style="color:${escapeXml(panel.labelColor)}">${escapeXml(panel.label)}</h2>
			${panel.rows
				.map(
					(row) => `
			<div class="swatch" data-swatch="${escapeXml(row.id)}" data-fg="${escapeXml(row.fgHex)}" data-bg="${escapeXml(row.bgHex)}" data-ratio="${row.ratio ?? ''}" style="background:${escapeXml(row.bgHex)};color:${escapeXml(row.fgHex)}">
				<span class="sample">Aa 0123 &mdash; ${escapeXml(row.fg)} on ${escapeXml(row.bg)}</span>
				<span class="ratio" style="color:${escapeXml(row.fgHex)}">${escapeXml(formatRatio(row.ratio))}:1 &#183; needs ${row.threshold}:1 &#183; ${row.pass ? 'PASS' : 'FAIL'}</span>
			</div>`,
				)
				.join('')}
		</section>`,
		)
		.join('\n');

	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>colour contrast matrix (#399)</title>
		<style>
			* { box-sizing: border-box; }
			body {
				margin: 0;
				background: ${escapeXml(panels[0]?.pageBackground ?? '#ffffff')};
				font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
			}
			.grid { display: flex; gap: 16px; padding: 16px; align-items: flex-start; }
			.panel { flex: 1 1 0; padding: 14px; border-radius: 10px; }
			.panel h2 { margin: 0 0 10px; font-size: 15px; letter-spacing: 0.04em; text-transform: uppercase; }
			.swatch {
				border-radius: 6px;
				padding: 7px 9px;
				margin-bottom: 6px;
				font-size: 12px;
				line-height: 1.45;
				border: 1px solid rgba(128, 128, 128, 0.35);
			}
			.sample { display: block; font-weight: 700; }
			.ratio { display: block; font-size: 11px; opacity: 0.95; }
		</style>
	</head>
	<body>
		<div class="grid" data-testid="a11y-contrast-matrix">
${panelMarkup}
		</div>
	</body>
</html>
`;
}

/**
 * The two panels the harness renders: the appearance label, the canvas
 * colour and the rows.
 */
export function buildPanels(evidence, { rawTokens, semanticTokens }) {
	return APPEARANCES.map((appearance) => {
		const canvas = resolveRawColor(
			rawTokens,
			resolveSemanticValue(semanticTokens, 'bg.canvas', appearance.condition).reference,
		);
		const labelColor = resolveRawColor(
			rawTokens,
			resolveSemanticValue(semanticTokens, 'text.default', appearance.condition).reference,
		);
		return {
			id: appearance.id,
			label: appearance.label,
			canvas,
			labelColor,
			pageBackground: canvas,
			rows: panelRows(evidence, appearance.id),
		};
	});
}

/**
 * Decide whether the RENDERED colours prove the measured contract (pure).
 *
 * The browser reports the computed foreground / background of every
 * swatch; the ratio is recomputed from those values and compared with the
 * ratio the gate measured from the token modules. A mismatch means the
 * picture and the gate are talking about different colours.
 */
export function evaluateRendered({ rows, observations, tolerance = 0.05 }) {
	const failures = [];
	const expected = new Map(rows.map((row) => [row.id, row]));

	for (const observation of observations) {
		const row = expected.get(observation.id);
		if (!row) {
			failures.push(`the harness rendered an unknown swatch "${observation.id}"`);
			continue;
		}
		if (observation.fg !== row.fgHex.toLowerCase()) {
			failures.push(
				`${observation.id}: the rendered foreground is ${observation.fg}, the token says ${row.fgHex}`,
			);
		}
		if (observation.bg !== row.bgHex.toLowerCase()) {
			failures.push(
				`${observation.id}: the rendered background is ${observation.bg}, the token says ${row.bgHex}`,
			);
		}
		const rendered = contrastRatio(observation.fg, observation.bg);
		if (rendered === null) {
			failures.push(`${observation.id}: the rendered colours could not be measured`);
			continue;
		}
		if (Math.abs(rendered - row.ratio) > tolerance) {
			failures.push(
				`${observation.id}: the rendered pair measures ${formatRatio(rendered)}:1, the gate measured ${formatRatio(row.ratio)}:1`,
			);
		}
	}

	const missing = [...expected.keys()].filter((id) => !observations.some((row) => row.id === id));
	for (const id of missing) failures.push(`the harness did not render the swatch "${id}"`);

	return { ok: failures.length === 0, failures };
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

/**
 * Read the computed colours of every rendered swatch.
 *
 * Runs in the browser, so it is written as a function body that Chromium
 * serialises — no imports, no closure variables.
 */
export const READ_SWATCHES = () => {
	const toHex = (value) => {
		const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
		if (!match) return value;
		return `#${[match[1], match[2], match[3]]
			.map((part) => Number.parseInt(part, 10).toString(16).padStart(2, '0'))
			.join('')}`;
	};
	return [...document.querySelectorAll('[data-swatch]')].map((element) => {
		const computed = window.getComputedStyle(element);
		return {
			id: element.getAttribute('data-swatch'),
			fg: toHex(computed.color),
			bg: toHex(computed.backgroundColor),
		};
	});
};

/** The header band: what was measured, what was not. */
export function headerSvg({ gate, rows, width = SCREENSHOT_MAX_WIDTH }) {
	const title = 'colour contrast AA — the token pair matrix (Issue #399)';
	const lines = [
		`machine-checked: ${rows.length} pair/appearance row(s) measured from src/editorial/tokens.ts + src/editorial/semantic-tokens.ts (WCAG 2.2 SC 1.4.3, AA)`,
		`machine-checked: gate verdict ${gate.violations.length} violation(s); every swatch re-measured from the rendered colours`,
		'not machine-checked: whether a status colour is semantically adequate, category hue separability, contrast over images (human evaluation)',
		`excluded: ${EXCLUDED_TOKENS.map((entry) => entry.token).join(', ')} — decorative separator, no information of its own`,
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

/** Compose the artefact: the header band above the rendered matrix. */
export async function composeArtefact({ sharp, pagePng, header, outPath }) {
	const page = await sharp(pagePng)
		.resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
		.png()
		.toBuffer();
	const meta = await sharp(page).metadata();
	const body = await sharp(page)
		.extend({
			top: header.height,
			bottom: 0,
			left: 0,
			right: 0,
			background: { r: 244, g: 239, b: 223 },
		})
		.png()
		.toBuffer();
	await sharp(body)
		.composite([{ input: Buffer.from(header.svg), left: 0, top: 0 }])
		.webp({ quality: SCREENSHOT_QUALITY })
		.toFile(outPath);
	return {
		pageWidth: meta.width ?? null,
		pageHeight: meta.height ?? null,
		headerHeight: header.height,
	};
}

function parseArgs(argv) {
	const options = {
		screenshot: ARTEFACT,
		pngDir: '.tmp/a11y-contrast',
		jsonOut: '.tmp/a11y-contrast/report.json',
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

/** Wait for the matrix, then read it. Bounded, so a broken mount reports. */
async function observeMatrix(page) {
	let lastError = null;
	for (let attempt = 1; attempt <= MOUNT_WAIT_ATTEMPTS; attempt += 1) {
		try {
			await page.waitForSelector('[data-testid="a11y-contrast-matrix"]', {
				timeout: MOUNT_WAIT_TIMEOUT_MS,
			});
			await page.waitForSelector('[data-swatch]', { timeout: MOUNT_WAIT_TIMEOUT_MS });
			return await page.evaluate(READ_SWATCHES);
		} catch (error) {
			lastError = error;
			process.stdout.write(
				`[capture] attempt ${attempt}/${MOUNT_WAIT_ATTEMPTS}: the matrix is not on the page (${error.message})\n`,
			);
		}
	}
	throw new Error(
		`the contrast matrix never mounted after ${MOUNT_WAIT_ATTEMPTS} attempts; the artefact would photograph nothing (${lastError?.message ?? 'unknown error'})`,
	);
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.capture) assertWebpOutputPath(options.screenshot);

	const { rawTokens, semanticTokens } = await loadTokenModules();
	const gate = await collectEvidence();
	if (gate.violations.length > 0) {
		process.stderr.write(`the contrast gate reports ${gate.violations.length} violation(s)\n`);
		for (const violation of gate.violations) {
			process.stderr.write(`  [${violation.rule}] ${violation.message}\n`);
		}
		throw new Error(
			'the contrast gate reports violations; the artefact would photograph a broken contract',
		);
	}

	const panels = buildPanels(gate, { rawTokens, semanticTokens });
	const rows = panels.flatMap((panel) => panel.rows);
	const html = harnessHtml(panels);
	ensureDir(HARNESS_HTML);
	writeFileSync(resolve(REPO_ROOT, HARNESS_HTML), html);

	const server = await serveDirectory(resolve(REPO_ROOT, HARNESS_DIR));
	let capture = null;
	let verdict = null;
	let observations = null;
	try {
		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: harness written, nothing captured\n');
		} else {
			const { chromium } = await import('@playwright/test');
			const sharp = (await import('sharp')).default;
			const pagePng = resolve(REPO_ROOT, options.pngDir, 'matrix.png');
			ensureDir(options.pngDir);
			const browser = await chromium.launch();
			try {
				const context = await browser.newContext({
					viewport: VIEWPORT,
					deviceScaleFactor: DEVICE_SCALE_FACTOR,
					isMobile: false,
				});
				const page = await context.newPage();
				await page.goto(`${server.baseUrl}/index.html`, { waitUntil: 'networkidle' });
				observations = await observeMatrix(page);
				writeFileSync(pagePng, await page.screenshot({ fullPage: true, type: 'png' }));
				await context.close();
			} finally {
				await browser.close();
			}

			verdict = evaluateRendered({ rows, observations });
			for (const failure of verdict.failures) process.stderr.write(`- ${failure}\n`);
			if (!verdict.ok) {
				throw new Error(
					`the rendered colours contradict the measured contract (${verdict.failures.length} failure(s)); no artefact was written`,
				);
			}

			const header = headerSvg({ gate, rows });
			const outPath = resolve(REPO_ROOT, options.screenshot);
			ensureDir(options.screenshot);
			const geometry = await composeArtefact({ sharp, pagePng, header, outPath });
			const meta = await sharp(outPath).metadata();
			const bytes = statSync(outPath).size;
			// The intermediate PNG never reaches the repository.
			rmSync(pagePng, { force: true });
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
		issue: '#399',
		generatedBy: 'scripts/capture-a11y-contrast.mjs',
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
		harness: { dir: HARNESS_DIR, html: HARNESS_HTML },
		observations,
		verdict,
		gate: { violations: gate.violations, rows: gate.rows },
		wcag: WCAG_MAPPING,
		humanEvaluation: HUMAN_EVALUATION,
		excluded: EXCLUDED_TOKENS,
		pairs: CONTRAST_PAIRS,
		capture,
	};
	ensureDir(options.jsonOut);
	writeFileSync(resolve(REPO_ROOT, options.jsonOut), `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(`[capture] wrote ${options.jsonOut}\n`);
	return 0;
}

if (process.argv[1]?.endsWith('capture-a11y-contrast.mjs')) {
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
