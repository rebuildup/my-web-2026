#!/usr/bin/env node

/**
 * capture-a11y-heading-landmarks — capture the Issue #398 verification
 * screen into `docs/verification/a11y/heading-landmarks.webp`.
 *
 * What this captures
 * ------------------
 * ONE screen that shows the two structures side by side:
 *
 *   - the left pane is a CONFORMING page: one `main` landmark, one
 *     `<h1>`, and contiguous heading levels (`h1` → `h2` → `h3`).
 *   - the right pane is a VIOLATING page: two `<h1>`s, a level that
 *     skips (`h1` → `h3`), and no `main` landmark.
 *
 * The two panes are the same markup the gate reads, so a reader can
 * see WHAT the gate decides without reading the source.
 *
 * It is also an ASSERTION, not only a screenshot. The script reads the
 * rendered DOM back out of Chromium and applies the SAME five rules
 * the source gate applies, to the RENDERED facts:
 *
 *   - the conforming pane must have exactly one `<h1>`, one `main`
 *     landmark and no skipped level;
 *   - the violating pane must have two `<h1>`s, one skipped level and
 *     no `main` landmark.
 *
 * If the rendered facts disagree, no artefact is written: a
 * plausible-looking picture of a broken contract is worse than no
 * picture.
 *
 * The gate's own verdict is printed in the header, so the artefact
 * states the source-level result and the rendered result together.
 *
 * Why a DOM specimen instead of the shipped pages
 * -----------------------------------------------
 * The shipped pages render through the Worker and its D1 / R2
 * bindings, so they cannot be rendered offline. The specimen is the
 * markup contract itself — the elements the gate reads — and the
 * evidence panel lists the per-page verdict the source gate reached
 * for the real pages.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is
 *     read or printed. The specimen is literals in this file.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port; Chromium refuses ES modules from `file://`,
 *     which is the only reason an origin exists.
 *   - Chromium screenshots are not byte-reproducible across
 *     processes, so the report records conditions instead of claiming
 *     a deterministic artefact.
 *
 * WebP, not PNG
 * -------------
 * The Issue names a `.png` path, but a verification artefact does not
 * justify a permanently large binary in the tree. The capture is
 * taken into `.tmp/`, encoded with the existing `sharp` devDependency
 * at width <= 1600 / quality 80, and the committed file is the
 * `.webp` sibling. The script REFUSES any non-`.webp` output path
 * and deletes the intermediate PNG.
 *
 * Usage:
 *   node scripts/capture-a11y-heading-landmarks.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/a11y/heading-landmarks.webp)
 *   --png-dir=<path>     temporary PNG directory
 *                         (default .tmp/a11y-heading-landmarks)
 *   --json-out=<path>    report destination
 *                         (default .tmp/a11y-heading-landmarks/report.json)
 *   --width=<n>          CSS viewport width (default 1200)
 *   --no-capture         write no artefact
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectEvidence, renderGateSummary } from './check-a11y-heading-landmarks.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The rules the capture decides, in the gate's vocabulary. */
export const RULES = [
	'page-multiple-h1',
	'page-missing-h1',
	'page-heading-level-skip',
	'page-missing-landmark',
	'landmark-duplicated',
];

/** The WCAG 2.2 criteria this artefact speaks to, with their levels. */
export const WCAG_MAPPING = [
	{ sc: '1.3.1', name: 'Info and Relationships', level: 'A' },
	{ sc: '2.4.6', name: 'Headings and Labels', level: 'AA' },
];

export const HARNESS_DIR = '.tmp/a11y-heading-landmarks';

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
 * The two specimens the screen compares (pure).
 *
 * `expected` is what the rendered facts MUST be, so the capture
 * asserts the specimen instead of photographing whatever it rendered.
 */
export const SPECIMENS = [
	{
		id: 'conforming',
		label: 'Conforming page',
		html: `<main data-specimen="conforming">
			<h1>Portfolio</h1>
			<section>
				<h2>Selected work</h2>
				<h3>Case study</h3>
			</section>
		</main>`,
		expected: {
			headings: [1, 2, 3],
			mains: 1,
			violations: [],
		},
	},
	{
		id: 'violating',
		label: 'Violating page',
		html: `<div data-specimen="violating">
			<h1>Portfolio</h1>
			<h1>Case study</h1>
			<section>
				<h3>Selected work</h3>
			</section>
		</div>`,
		expected: {
			headings: [1, 1, 3],
			mains: 0,
			violations: ['page-multiple-h1', 'page-heading-level-skip', 'page-missing-landmark'],
		},
	},
];

/**
 * Apply the gate's rules to the facts a browser observed (pure).
 *
 * The same five rules as the source gate, decided on the RENDERED
 * DOM: a heading list and a `main` landmark count. Keeping the rule
 * names identical is what lets the report say "the source gate and
 * the rendered page agree".
 */
export function evaluateRenderedOutline({ headings, mains }) {
	const violations = [];
	const h1s = headings.filter((level) => level === 1);
	if (h1s.length === 0) violations.push('page-missing-h1');
	if (h1s.length > 1) violations.push('page-multiple-h1');
	for (let index = 1; index < headings.length; index += 1) {
		if (headings[index] > headings[index - 1] + 1) violations.push('page-heading-level-skip');
	}
	if (mains === 0) violations.push('page-missing-landmark');
	if (mains > 1) violations.push('landmark-duplicated');
	return violations;
}

/**
 * Decide whether the rendered facts prove the contract (pure).
 *
 * Every specimen's expected facts are asserted, so a specimen that
 * stopped rendering what it claims fails the capture instead of
 * quietly verifying nothing.
 */
export function evaluateObservation(observation) {
	const failures = [];
	for (const specimen of SPECIMENS) {
		const facts = observation?.[specimen.id];
		if (!facts) {
			failures.push(`the "${specimen.id}" specimen was not rendered`);
			continue;
		}
		if (JSON.stringify(facts.headings) !== JSON.stringify(specimen.expected.headings)) {
			failures.push(
				`the "${specimen.id}" specimen rendered headings [${facts.headings.join(', ')}], expected [${specimen.expected.headings.join(', ')}]`,
			);
		}
		if (facts.mains !== specimen.expected.mains) {
			failures.push(
				`the "${specimen.id}" specimen rendered ${facts.mains} main landmark(s), expected ${specimen.expected.mains}`,
			);
		}
		const violations = evaluateRenderedOutline(facts);
		if (JSON.stringify(violations) !== JSON.stringify(specimen.expected.violations)) {
			failures.push(
				`the "${specimen.id}" specimen rendered the rules [${violations.join(', ') || 'none'}], expected [${specimen.expected.violations.join(', ') || 'none'}]`,
			);
		}
	}
	return { ok: failures.length === 0, failures };
}

/** The generated harness page: the two specimens side by side. */
export function harnessIndexHtml() {
	const panes = SPECIMENS.map(
		(specimen) => `<section class="pane">
			<p class="pane-label">${escapeXml(specimen.label)}</p>
			<div class="specimen">${specimen.html}</div>
		</section>`,
	).join('\n');
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>heading outline / landmark specimen (#398)</title>
		<style>
			* { box-sizing: border-box; }
			body {
				margin: 0;
				padding: 28px;
				background: #ffffff;
				color: #1c2030;
				font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
			}
			.panes { display: flex; gap: 28px; align-items: flex-start; }
			.pane { flex: 1 1 0; }
			.pane-label {
				margin: 0 0 10px;
				font-size: 13px;
				letter-spacing: 0.08em;
				text-transform: uppercase;
				color: #5a6072;
			}
			.specimen {
				border: 1px solid #d8d2c0;
				border-radius: 8px;
				padding: 18px 20px;
				background: #fbfaf6;
			}
			.specimen h1 { font-size: 26px; margin: 0 0 14px; }
			.specimen h2 { font-size: 20px; margin: 0 0 10px; }
			.specimen h3 { font-size: 16px; margin: 0 0 10px; }
			.specimen section { border-left: 2px solid #d8d2c0; padding-left: 12px; }
		</style>
	</head>
	<body>
		<div class="panes">${panes}</div>
	</body>
</html>
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

/** Write the generated harness (idempotent). */
export function writeHarness(repoRoot = REPO_ROOT) {
	const dir = resolve(repoRoot, HARNESS_DIR);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'index.html'), harnessIndexHtml());
	return dir;
}

/**
 * Read the accessibility-relevant facts out of the rendered page.
 *
 * Runs in the browser, so it is written as a function body that
 * Chromium serialises — no imports, no closure variables.
 */
export const READ_DOCUMENT = () => {
	const readSpecimen = (id) => {
		const element = document.querySelector(`[data-specimen="${id}"]`);
		if (!element) return null;
		const headings = [...element.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((heading) =>
			Number(heading.tagName.slice(1)),
		);
		// The specimen element itself may BE the landmark, so it is
		// counted together with its descendants.
		const mains =
			(element.tagName.toLowerCase() === 'main' ? 1 : 0) +
			element.querySelectorAll('main').length +
			[...element.querySelectorAll('[role="main"]')].filter(
				(node) => node.tagName.toLowerCase() !== 'main',
			).length;
		return { headings, mains };
	};
	return {
		conforming: readSpecimen('conforming'),
		violating: readSpecimen('violating'),
	};
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
	const title = 'heading outline / landmark contract — Issue #398';
	const rows = [
		'left: conforming page — one main landmark, one h1, contiguous levels (h1 → h2 → h3)',
		'right: violating page — two h1, a skipped level (h1 → h3), no main landmark',
		`machine-checked: the rendered specimens report [${SPECIMENS.map((specimen) => `${specimen.id}: ${evaluateRenderedOutline(observation?.[specimen.id] ?? { headings: [], mains: 0 }).join('+') || 'clean'}`).join(' · ')}]`,
		`machine-checked: the source gate reports ${gate.violations.length} violation(s) over ${gate.filesScanned} source file(s) in ${gate.units.length} page unit(s)`,
		'not machine-checked: heading wording, outline order, a real screen-reader pass (human evaluation)',
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

/** The evidence panel: the per-page verdict, drawn beside the render. */
export function evidencePanelSvg({ observation, gate, width }) {
	const body = [
		'machine-checked per specimen (rendered DOM)',
		'',
		...SPECIMENS.map((specimen) => {
			const facts = observation?.[specimen.id] ?? { headings: [], mains: 0 };
			const rules = evaluateRenderedOutline(facts);
			return `${specimen.id}: headings [${facts.headings.join(', ')}] main=${facts.mains} rules=[${rules.join(', ') || 'none'}]`;
		}),
		'',
		'machine-checked per page unit (source gate)',
		'',
		...gate.units.map(
			(unit) =>
				`${unit.id}: h1=${unit.headings.filter((heading) => heading.level === 1).length} main=${unit.landmarks.length} (${unit.kind})`,
		),
		'',
		'exempted rules (declared, with the reason)',
		...gate.exemptions.flatMap((exemption) => [
			`- ${exemption.unit}: ${exemption.rule}`,
			`  ${exemption.reason}`,
		]),
		'',
		`gate: ${gate.violations.length} violation(s), ${gate.filesScanned} file(s) scanned`,
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
		screenshot: 'docs/verification/a11y/heading-landmarks.webp',
		pngDir: '.tmp/a11y-heading-landmarks',
		jsonOut: '.tmp/a11y-heading-landmarks/report.json',
		width: 1200,
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

	const gate = collectEvidence();
	if (gate.violations.length > 0) {
		process.stderr.write(`${renderGateSummary(gate)}\n`);
		throw new Error(
			`the heading / landmark gate reports ${gate.violations.length} violation(s); the artefact would photograph a broken contract`,
		);
	}

	writeHarness();
	const server = await serveDirectory(resolve(REPO_ROOT, HARNESS_DIR));
	let capture = null;
	let verdict = null;
	let observation = null;
	try {
		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: harness written, nothing captured\n');
		} else {
			const { chromium } = await import('@playwright/test');
			const sharp = (await import('sharp')).default;
			ensureDir(join(options.pngDir, 'x.png'));
			const pagePng = resolve(REPO_ROOT, options.pngDir, 'specimen.png');
			const browser = await chromium.launch();
			try {
				const context = await browser.newContext({
					viewport: { width: options.width, height: 720 },
					deviceScaleFactor: 2,
					isMobile: false,
				});
				const page = await context.newPage();
				await page.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle' });
				observation = await page.evaluate(READ_DOCUMENT);
				writeFileSync(pagePng, await page.screenshot({ fullPage: true, type: 'png' }));
				await context.close();
			} finally {
				await browser.close();
			}

			verdict = evaluateObservation(observation);
			for (const failure of verdict.failures) process.stderr.write(`- ${failure}\n`);
			if (!verdict.ok) {
				throw new Error(
					`the rendered specimens contradict the heading / landmark contract (${verdict.failures.length} failure(s)); no artefact was written`,
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
				viewport: { width: options.width, height: 720 },
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
		issue: '#398',
		generatedBy: 'scripts/capture-a11y-heading-landmarks.mjs',
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
		harness: { dir: HARNESS_DIR, entry: harnessIndexHtml() },
		specimens: SPECIMENS.map((specimen) => ({
			id: specimen.id,
			expected: specimen.expected,
			observed: observation?.[specimen.id] ?? null,
			rules: evaluateRenderedOutline(observation?.[specimen.id] ?? { headings: [], mains: 0 }),
		})),
		verdict,
		gate: {
			violations: gate.violations,
			filesScanned: gate.filesScanned,
			units: gate.units.map((unit) => ({
				id: unit.id,
				files: unit.files,
				isComponentSurface: unit.isComponentSurface,
			})),
		},
		wcag: WCAG_MAPPING,
		humanEvaluation: gate.humanEvaluation,
		policy: {
			webpOnly: true,
			maxWidth: SCREENSHOT_MAX_WIDTH,
			quality: SCREENSHOT_QUALITY,
			budgetBytes: SCREENSHOT_BUDGET_BYTES,
			issuePathSubstituted: 'docs/verification/a11y/heading-landmarks.png -> .webp',
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

if (process.argv[1]?.endsWith('capture-a11y-heading-landmarks.mjs')) {
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
