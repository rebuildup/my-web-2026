#!/usr/bin/env node

/**
 * capture-a11y-reflow — capture the Issue #400 verification screen into
 * `docs/verification/a11y/reflow.webp`.
 *
 * What this captures
 * ------------------
 * The reflow fixture kinds rendered at the 320 CSS px budget (WCAG 2.2
 * SC 1.4.10, the 400% zoom viewport) and again at 200% text (SC 1.4.4),
 * side by side, with the measured `scrollWidth` / `clientWidth` of every
 * specimen printed next to it.
 *
 * It is an ASSERTION, not only a screenshot. For every specimen on the
 * screen the script reads the live DOM box and computes
 * `scrollWidth > clientWidth`. The shipped-contract specimens must NOT
 * overflow; the reproduced-defect specimens MUST overflow. A defect that
 * stopped overflowing fails the capture instead of producing a
 * plausible-looking picture, which is the negative control the Issue
 * asks for.
 *
 * The kinds are the gate's vocabulary (`check-a11y-reflow.mjs`), so the
 * browser half and the source half cannot disagree about what a
 * specimen is.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is
 *     read or printed. The harness is generated inline.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port.
 *   - Chromium screenshots are not byte-reproducible across processes, so
 *     the report records conditions instead of claiming a deterministic
 *     artefact.
 *
 * WebP, not PNG
 * -------------
 * Issue #400 names a `.png` path, but Chromium only writes PNG and a
 * verification artefact does not justify a permanently large binary in
 * the tree. The capture goes to `.tmp/`, is re-encoded with the existing
 * `sharp` devDependency at width <= 1600 / quality 80, and the committed
 * file is the `.webp` sibling. The script REFUSES any non-`.webp` output
 * path and deletes the intermediate PNG.
 *
 * Usage:
 *   node scripts/capture-a11y-reflow.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/a11y/reflow.webp)
 *   --png-dir=<path>     temporary PNG directory (default .tmp/a11y-reflow)
 *   --json-out=<path>    report destination
 *                         (default .tmp/a11y-reflow/report.json)
 *   --width=<n>          page viewport width (default 1600)
 *   --no-capture         write no artefact
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REFLOW_BUDGET_PX, UNBREAKABLE_KINDS } from './check-a11y-reflow.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The two stages every specimen is measured in. */
export const STAGES = [
	{ id: 'base', label: '320 px (SC 1.4.10 reflow)', fontScale: 1 },
	{ id: 'text-200', label: '320 px @ 200% text (SC 1.4.4)', fontScale: 2 },
];

/** The page viewport the harness is captured at. */
export const PAGE_WIDTH = 1600;

/** The two specimen groups the screen compares. */
export const GROUPS = ['shipped contract', 'reproduced defect'];

const LONG_WORD = 'Donaudampfschifffahrtsgesellschaftskapitaenswitwenrentenversicherungsanstalt';
const LONG_URL =
	'https://example.com/very/long/path/segment/that/never/breaks/at/a/space/and/keeps/going/forever';
const PSEUDO_LOCALE_WORD = 'próódóóct···náávygáátióón···sééttííngs···cóónfíígúúráátióón···páágéé';

/**
 * The specimens, in render order.
 *
 * `expectOverflow` is the negative control: a `shipped contract` specimen
 * must fit and a `reproduced defect` specimen must overflow. If either
 * flips, the capture fails.
 */
export const EXPECTED_CASES = [
	{
		id: 'pass-long-word',
		kind: 'long-word',
		group: 'shipped contract',
		wrap: 'anywhere',
		expectOverflow: false,
		text: LONG_WORD,
	},
	{
		id: 'pass-long-url',
		kind: 'long-url',
		group: 'shipped contract',
		wrap: 'break-word',
		expectOverflow: false,
		text: LONG_URL,
	},
	{
		id: 'pass-pseudo-locale',
		kind: 'pseudo-locale',
		group: 'shipped contract',
		wrap: 'anywhere',
		expectOverflow: false,
		text: PSEUDO_LOCALE_WORD,
	},
	{
		id: 'fail-without-break',
		kind: 'long-word',
		group: 'reproduced defect',
		wrap: null,
		expectOverflow: true,
		text: LONG_WORD,
	},
	{
		id: 'fail-fixed-width',
		kind: 'long-word',
		group: 'reproduced defect',
		wrap: 'anywhere',
		fixedWidthPx: 640,
		expectOverflow: true,
		text: LONG_WORD,
	},
	{
		id: 'fail-nowrap',
		kind: 'long-url',
		group: 'reproduced defect',
		wrap: 'anywhere',
		nowrap: true,
		expectOverflow: true,
		text: LONG_URL,
	},
];

/** The WCAG 2.2 criteria this artefact speaks to. */
export const WCAG_MAPPING = [
	{ sc: '1.4.10', name: 'Reflow', level: 'AA' },
	{ sc: '1.4.4', name: 'Resize Text', level: 'AA' },
];

export const HARNESS_DIR = '.tmp/a11y-reflow/harness';

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

/** Whether a capture fits the verification-artefact budget (pure). */
export function screenshotBudgetVerdict(bytes) {
	return { bytes, kb: Math.round(bytes / 1024), withinBudget: bytes <= SCREENSHOT_BUDGET_BYTES };
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

/** The inline style of one specimen, from its declared countermeasure. */
export function specimenStyle(entry) {
	const declarations = ['max-width:100%'];
	if (entry.wrap === 'anywhere') declarations.push('overflow-wrap:anywhere');
	if (entry.wrap === 'break-word') declarations.push('overflow-wrap:break-word');
	if (entry.fixedWidthPx) declarations.push(`min-width:${entry.fixedWidthPx}px`);
	if (entry.nowrap) declarations.push('white-space:nowrap');
	return declarations.join(';');
}

/** One specimen element: a fixed 320 px frame holding the styled content. */
function specimenEntry(entry, stageId) {
	return `<div class="frame" data-case="${escapeXml(entry.id)}" data-stage="${escapeXml(stageId)}" data-group="${escapeXml(entry.group)}" data-expect-overflow="${entry.expectOverflow}" data-kind="${escapeXml(entry.kind)}">
	<div class="case" style="${specimenStyle(entry)}">${escapeXml(entry.text)}</div>
</div>`;
}

/**
 * The generated harness page.
 *
 * Both the shipped-contract and the reproduced-defect specimens are on ONE
 * screen, in both stages, so a reviewer can compare them without opening
 * two files — and the measurement reads all of them.
 */
export function harnessIndexHtml() {
	const stages = STAGES.map((stage) => {
		const cases = EXPECTED_CASES.map((entry) => specimenEntry(entry, stage.id)).join('\n\t\t');
		return `<section class="stage" data-stage="${escapeXml(stage.id)}" style="font-size:${stage.fontScale * 100}%">
		<h2>${escapeXml(stage.label)}</h2>
		<div class="frames">${cases}</div>
	</section>`;
	}).join('\n\t');
	const legend = EXPECTED_CASES.map(
		(entry) =>
			`<tr><td><code>${escapeXml(entry.id)}</code></td><td>${escapeXml(entry.kind)}</td><td>${escapeXml(entry.group)}</td><td>${entry.expectOverflow ? 'must overflow' : 'must fit'}</td></tr>`,
	).join('\n\t\t');
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>text reflow — Issue #400</title>
		<style>
			* { box-sizing: border-box; }
			body { margin: 0; padding: 20px 24px 32px; width: ${PAGE_WIDTH}px; background: #ffffff; color: #101828;
				font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
			h1 { font-size: 20px; margin: 0 0 6px; }
			p.lede { margin: 0 0 18px; color: #475467; }
			h2 { font-size: 13px; margin: 14px 0 8px; text-transform: uppercase; letter-spacing: 0.06em; color: #344054; }
			.stage { margin-bottom: 10px; }
			.frames { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start; }
			.frame { width: ${REFLOW_BUDGET_PX}px; overflow: hidden; border: 1px dashed #98a2b3; padding: 6px; }
			.case { background: #f8fafc; border: 1px solid #d0d5dd; padding: 4px 6px; }
			table { border-collapse: collapse; margin-top: 8px; font-size: 12px; }
			td, th { border: 1px solid #d0d5dd; padding: 2px 8px; text-align: left; }
			code { color: #101828; }
		</style>
	</head>
	<body>
		<h1>text reflow — Issue #400 (WCAG 2.2 SC 1.4.10 / 1.4.4, level AA)</h1>
		<p class="lede">Every specimen is rendered inside a ${REFLOW_BUDGET_PX} px frame, at 100% and at 200% text. The shipped-contract rows carry a break boundary; the reproduced-defect rows do not.</p>
	${stages}
		<table>
			<thead><tr><th>specimen</th><th>kind</th><th>group</th><th>expectation</th></tr></thead>
			<tbody>
		${legend}
			</tbody>
		</table>
	</body>
</html>
`;
}

const CONTENT_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
};

/** Resolve one request path inside the served root (pure). */
export function resolveStaticTarget(root, requestPath) {
	const base = resolve(root);
	const candidate = resolve(base, `.${decodeURIComponent(requestPath)}`);
	if (candidate !== base && !candidate.startsWith(`${base}/`)) return { status: 403, file: null };
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

/** Write the generated harness (idempotent, so a re-run reuses it). */
export function writeHarness(repoRoot = REPO_ROOT) {
	const dir = resolve(repoRoot, HARNESS_DIR);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'index.html'), harnessIndexHtml());
	return dir;
}

/**
 * Read the live boxes out of the rendered page.
 *
 * Runs in the browser, so it is written as a function body Chromium
 * serialises — no imports, no closure variables.
 */
export const READ_DOCUMENT = () => ({
	viewportWidth: document.documentElement.clientWidth,
	documentWidth: document.documentElement.scrollWidth,
	cases: [...document.querySelectorAll('[data-case]')].map((element) => ({
		id: element.getAttribute('data-case'),
		stage: element.getAttribute('data-stage'),
		group: element.getAttribute('data-group'),
		expectOverflow: element.getAttribute('data-expect-overflow') === 'true',
		scrollWidth: element.scrollWidth,
		clientWidth: element.clientWidth,
	})),
});

/** The measured overflow facts for one observation (pure). */
export function overflowOf(observation) {
	return observation.scrollWidth > observation.clientWidth + 1;
}

/**
 * Decide whether the browser observations prove the reflow contract (pure).
 *
 * The negative control lives here: a `shipped contract` specimen that
 * overflows is a failure, and a `reproduced defect` specimen that does NOT
 * overflow is a failure too.
 */
export function evaluateObservation(observation) {
	const failures = [];
	const rows = [];
	if (observation.documentWidth > observation.viewportWidth + 1) {
		failures.push(
			`the document scrolls horizontally (${observation.documentWidth} px > ${observation.viewportWidth} px)`,
		);
	}
	for (const expected of EXPECTED_CASES) {
		for (const stage of STAGES) {
			const entry = (observation.cases ?? []).find(
				(candidate) => candidate.id === expected.id && candidate.stage === stage.id,
			);
			if (!entry) {
				failures.push(`specimen ${expected.id} was not rendered in stage ${stage.id}`);
				continue;
			}
			if (entry.clientWidth > REFLOW_BUDGET_PX + 1) {
				failures.push(
					`${expected.id} [${stage.id}]: the box is ${entry.clientWidth} px wide, not rendered inside the ${REFLOW_BUDGET_PX} px reflow budget`,
				);
			}
			const overflow = overflowOf(entry);
			if (overflow !== expected.expectOverflow) {
				failures.push(
					`${expected.id} [${stage.id}]: ${overflow ? 'overflows' : 'fits'} where the screen claims it must ${expected.expectOverflow ? 'overflow' : 'fit'}`,
				);
			}
			rows.push(
				`${stage.id.padEnd(8)} ${expected.id.padEnd(20)} scroll=${entry.scrollWidth} client=${entry.clientWidth} ${overflow ? 'OVERFLOW' : 'fits'} (expect ${expected.expectOverflow ? 'overflow' : 'fit'})`,
			);
		}
	}
	return { ok: failures.length === 0, failures, rows };
}

/** The header band: what was measured, what was not. */
export function headerSvg({ gate, verdict, width = SCREENSHOT_MAX_WIDTH }) {
	const title = 'text reflow — Issue #400 (WCAG 2.2 SC 1.4.10 / 1.4.4, AA)';
	const rows = [
		`${EXPECTED_CASES.length} specimen(s) x ${STAGES.length} stage(s) = ${EXPECTED_CASES.length * STAGES.length} measured box(es) at the ${REFLOW_BUDGET_PX} px reflow budget`,
		'machine-checked: every box measured from the live DOM (scrollWidth > clientWidth); the reproduced defects must overflow, the shipped contract must fit',
		`machine-checked: ${verdict.ok ? 'every specimen resolved to the box the screen claims' : 'a specimen did NOT resolve to the claimed box'}`,
		`machine-checked: gate ${gate.violations.length} violation(s); base floor = ${gate.base.breaks.join(', ') || 'none'}`,
		'not machine-checked: whether a broken URL still reads correctly, hyphenation quality, how the reflowed page feels',
		`WCAG 2.2: ${WCAG_MAPPING.map((entry) => `${entry.sc} ${entry.level}`).join(' · ')}`,
		'',
		...verdict.rows,
	];
	const rowTop = 34 + 30;
	const height = rowTop + rows.length * 19 + 16;
	const lines = rows
		.map(
			(row, index) =>
				`<text x="16" y="${rowTop + index * 19}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" fill="#1c2030">${escapeXml(row)}</text>`,
		)
		.join('\n');
	return {
		height,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
	<rect width="${width}" height="${height}" fill="#f4efdf" />
	<text x="16" y="28" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="20" font-weight="700" fill="#0b1020">${escapeXml(title)}</text>
	${lines}
</svg>
`,
	};
}

/** Compose the artefact: the header band above the rendered screen. */
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
		screenshot: 'docs/verification/a11y/reflow.webp',
		pngDir: '.tmp/a11y-reflow',
		jsonOut: '.tmp/a11y-reflow/report.json',
		width: PAGE_WIDTH,
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

	const { collectEvidence, renderGateSummary } = await import('./check-a11y-reflow.mjs');
	const gate = collectEvidence();
	if (gate.violations.length > 0) {
		process.stderr.write(`${renderGateSummary(gate)}\n`);
		throw new Error(
			`the reflow gate reports ${gate.violations.length} violation(s); the artefact would photograph a broken contract`,
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
			const pagePng = resolve(REPO_ROOT, options.pngDir, 'screen.png');
			ensureDir(join(options.pngDir, 'x.png'));
			const browser = await chromium.launch();
			try {
				const context = await browser.newContext({
					viewport: { width: options.width, height: 1000 },
					deviceScaleFactor: 1,
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
					`the browser observations contradict the reflow contract (${verdict.failures.length} failure(s)); no artefact was written`,
				);
			}

			const header = headerSvg({ gate, verdict });
			const outPath = resolve(REPO_ROOT, options.screenshot);
			ensureDir(options.screenshot);
			const geometry = await composeArtefact({ sharp, pagePng, header, outPath });
			const meta = await sharp(outPath).metadata();
			const budget = screenshotBudgetVerdict(statSync(outPath).size);
			rmSync(pagePng, { force: true });
			if (!budget.withinBudget) {
				throw new Error(
					`capture is ${budget.kb} kB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB budget`,
				);
			}
			capture = {
				artefact: options.screenshot,
				viewport: { width: options.width, height: 1000 },
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
		issue: '#400',
		generatedBy: 'scripts/capture-a11y-reflow.mjs',
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
		harness: { dir: HARNESS_DIR, html: harnessIndexHtml() },
		stages: STAGES,
		observation,
		verdict,
		gate: { violations: gate.violations, baseBreaks: gate.base.breaks },
		kinds: UNBREAKABLE_KINDS,
		wcag: WCAG_MAPPING,
		humanEvaluation: gate.humanEvaluation,
		policy: {
			webpOnly: true,
			maxWidth: SCREENSHOT_MAX_WIDTH,
			quality: SCREENSHOT_QUALITY,
			budgetBytes: SCREENSHOT_BUDGET_BYTES,
			issuePathSubstituted: 'docs/verification/a11y/reflow-400-percent.png -> .webp',
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

if (process.argv[1]?.endsWith('capture-a11y-reflow.mjs')) {
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
