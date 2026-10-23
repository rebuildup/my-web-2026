#!/usr/bin/env node

/**
 * capture-a11y-image-alt — capture the Issue #397 verification screen into
 * `docs/verification/a11y/image-alt.webp`.
 *
 * What this captures
 * ------------------
 * One screen that shows BOTH sides of the image contract at once:
 *
 *   - the two states a shipped surface may be in: a MEANINGFUL image (an
 *     `alt` that says what the image carries) and a DECORATIVE image (an
 *     empty `alt` plus a decorative mark), and
 *   - the three states the gate rejects: no `alt` at all, an empty `alt`
 *     with nothing saying the image is decorative, and an `alt` that is
 *     whitespace only.
 *
 * It is an ASSERTION, not only a screenshot. For every image on the screen
 * the script reads, from the live DOM: whether the `alt` ATTRIBUTE exists
 * (an absent attribute and an empty attribute are different facts and are
 * read separately), what the attribute contains, and which decorative marks
 * are present. The verdict is then computed by the GATE's own
 * `evaluateImage`, so the browser half and the source half cannot disagree
 * about what the contract is.
 *
 * The screen is a generated harness rather than a shipped page: the images
 * under contract are inline SVG data URIs, so the capture issues no network
 * request, reads no secret and touches no binding.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is read
 *     or printed. The images are data URIs in the generated page.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port.
 *   - Chromium screenshots are not byte-reproducible across processes, so
 *     the report records conditions instead of claiming a deterministic
 *     artefact.
 *
 * WebP, not PNG
 * -------------
 * Issue #397 names a `.png` path, but Chromium only writes PNG and a
 * verification artefact does not justify a permanently large binary in the
 * tree. The capture goes to `.tmp/`, is re-encoded with the existing `sharp`
 * devDependency at width <= 1600 / quality 80, and the committed file is
 * the `.webp` sibling. The script REFUSES any non-`.webp` output path and
 * deletes the intermediate PNG.
 *
 * Usage:
 *   node scripts/capture-a11y-image-alt.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/a11y/image-alt.webp)
 *   --png-dir=<path>     temporary PNG directory (default .tmp/a11y-image-alt)
 *   --json-out=<path>    report destination
 *                         (default .tmp/a11y-image-alt/report.json)
 *   --width=<n>          CSS viewport width (default 1600)
 *   --no-capture         write no artefact
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	DECORATIVE_MARKS,
	collectEvidence,
	evaluateImage,
	renderGateSummary,
} from './check-a11y-image-alt.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The states the screen shows, in render order. */
export const EXPECTED_CASES = [
	{ id: 'pass-meaningful', group: 'shipped contract', expectation: 'described' },
	{ id: 'pass-decorative', group: 'shipped contract', expectation: 'decorative' },
	{ id: 'fail-missing-alt', group: 'reproduced defect', expectation: 'missing-alt' },
	{
		id: 'fail-empty-alt-without-mark',
		group: 'reproduced defect',
		expectation: 'unmarked-empty',
	},
	{ id: 'fail-blank-alt', group: 'reproduced defect', expectation: 'blank-alt' },
];

/** The WCAG 2.2 criterion this artefact speaks to. */
export const WCAG_MAPPING = [{ sc: '1.1.1', name: 'Non-text Content', level: 'A' }];

export const HARNESS_DIR = '.tmp/a11y-image-alt/harness';

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

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

/** An inline SVG data URI, so the capture issues no network request. */
export function svgDataUri(svg) {
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const MEANINGFUL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200" viewBox="0 0 360 200"><rect width="360" height="200" rx="8" fill="#101828"/><rect x="20" y="24" width="150" height="16" rx="4" fill="#7dd3fc"/><rect x="20" y="60" width="260" height="10" rx="4" fill="#475467"/><rect x="20" y="84" width="220" height="10" rx="4" fill="#475467"/><rect x="20" y="108" width="240" height="10" rx="4" fill="#475467"/><rect x="20" y="140" width="120" height="26" rx="6" fill="#2e90fa"/><text x="32" y="158" font-family="monospace" font-size="13" fill="#ffffff">build</text></svg>`;

const DECORATIVE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200" viewBox="0 0 360 200"><rect width="360" height="200" rx="8" fill="#f4efdf"/><circle cx="180" cy="100" r="56" fill="#e4dcc4"/><rect x="60" y="178" width="240" height="6" rx="3" fill="#d8d2c0"/></svg>`;

/** One screen entry: the markup under test. */
function screenEntry({ id, alt, mark, label, decorative }) {
	const altAttribute = alt === null ? '' : ` alt="${alt}"`;
	const markAttribute = mark === null ? '' : ` ${mark}`;
	const source = decorative ? DECORATIVE_SVG : MEANINGFUL_SVG;
	return `<figure class="case" data-case="${id}">
			<img src="${svgDataUri(source)}"${altAttribute}${markAttribute} width="360" height="200" />
			<figcaption><code>${escapeXml(id)}</code> — ${escapeXml(label)}</figcaption>
		</figure>`;
}

/**
 * The generated harness page.
 *
 * Both sides of the contract are on ONE screen, so a reviewer can compare
 * the shipped states with the reproduced defects without two screenshots.
 */
export function harnessIndexHtml() {
	const shipped = EXPECTED_CASES.filter((entry) => entry.group === 'shipped contract').map(
		(entry) =>
			screenEntry({
				id: entry.id,
				decorative: entry.id === 'pass-decorative',
				alt:
					entry.id === 'pass-meaningful'
						? 'A terminal window showing a completed production build'
						: '',
				mark: entry.id === 'pass-decorative' ? 'aria-hidden="true"' : null,
				label:
					entry.id === 'pass-meaningful'
						? 'meaningful image — the alt says what the image carries'
						: 'decorative image — empty alt plus a decorative mark',
			}),
	);
	const defects = EXPECTED_CASES.filter((entry) => entry.group === 'reproduced defect').map(
		(entry) =>
			screenEntry({
				id: entry.id,
				decorative: false,
				alt: entry.id === 'fail-missing-alt' ? null : entry.id === 'fail-blank-alt' ? ' ' : '',
				mark: null,
				label:
					entry.id === 'fail-missing-alt'
						? 'no alt attribute — the defect the gate rejects'
						: entry.id === 'fail-empty-alt-without-mark'
							? 'empty alt with no decorative mark — the defect the gate rejects'
							: 'blank alt — neither a description nor a decorative declaration',
			}),
	);
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>image alt / decorative image — Issue #397</title>
		<style>
			body { margin: 0; padding: 28px 32px 40px; background: #ffffff; color: #101828;
				font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
			h1 { font-size: 20px; margin: 0 0 6px; }
			p.lede { margin: 0 0 24px; color: #475467; font-size: 13px; }
			h2 { font-size: 14px; margin: 26px 0 12px; text-transform: uppercase; letter-spacing: 0.08em;
				color: #344054; }
			.grid { display: flex; flex-wrap: wrap; gap: 20px; }
			.case { margin: 0; width: 360px; }
			.case img { display: block; border: 1px solid #d0d5dd; border-radius: 8px; }
			.case figcaption { margin-top: 8px; font-size: 12px; color: #475467; }
			.case code { color: #101828; }
		</style>
	</head>
	<body>
		<h1>image alt / decorative image — Issue #397 (WCAG 2.2 SC 1.1.1, level A)</h1>
		<p class="lede">Left: the two states a shipped surface may be in. Right: the three states the gate rejects.</p>
		<h2>shipped contract</h2>
		<div class="grid">${shipped.join('\n\t\t')}</div>
		<h2>reproduced defect</h2>
		<div class="grid">${defects.join('\n\t\t')}</div>
	</body>
</html>
`;
}

const CONTENT_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.webp': 'image/webp',
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

/** Write the generated harness (idempotent, so a re-run reuses it). */
export function writeHarness(repoRoot = REPO_ROOT) {
	const dir = resolve(repoRoot, HARNESS_DIR);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'index.html'), harnessIndexHtml());
	return dir;
}

/**
 * Read the accessibility-relevant facts out of the rendered page.
 *
 * Runs in the browser, so it is written as a function body that Chromium
 * serialises — no imports, no closure variables. The `alt` ATTRIBUTE and its
 * value are read separately: an absent attribute and an empty attribute are
 * different facts.
 */
export const READ_DOCUMENT = () => {
	const read = (element) => {
		const attributes = [];
		for (const attribute of element.attributes) {
			attributes.push({ name: attribute.name, kind: 'string', value: attribute.value });
		}
		return {
			hasAlt: element.hasAttribute('alt'),
			alt: element.getAttribute('alt'),
			attributes,
		};
	};
	return {
		viewportWidth: document.documentElement.clientWidth,
		cases: [...document.querySelectorAll('[data-case]')].map((figure) => ({
			caseId: figure.getAttribute('data-case'),
			...read(figure.querySelector('img')),
		})),
	};
};

/**
 * Decide whether the browser observation proves the contract (pure).
 *
 * The verdict of each image is computed by the GATE's own `evaluateImage`,
 * so the browser half and the source half share one rule implementation.
 */
export function evaluateObservation(observation) {
	const failures = [];
	const rows = [];
	const seen = (observation.cases ?? []).map((entry) => entry.caseId);
	const missing = EXPECTED_CASES.filter((entry) => !seen.includes(entry.id)).map(
		(entry) => entry.id,
	);
	if (missing.length > 0) {
		failures.push(
			`state(s) ${missing.join(', ')} were not rendered; every state this artefact claims to compare has to be on the screen`,
		);
	}
	for (const expected of EXPECTED_CASES) {
		const entry = (observation.cases ?? []).find((candidate) => candidate.caseId === expected.id);
		if (!entry) continue;
		const attributes = entry.hasAlt
			? [
					{ name: 'alt', kind: 'string', value: entry.alt ?? '' },
					...entry.attributes.filter((attribute) => attribute.name !== 'alt'),
				]
			: entry.attributes;
		const evaluation = evaluateImage(attributes);
		if (evaluation.verdict !== expected.expectation) {
			failures.push(
				`${expected.id}: the browser reports "${evaluation.verdict}" where the screen claims "${expected.expectation}"`,
			);
		}
		rows.push(
			`${expected.id.padEnd(28)} alt=${entry.hasAlt ? JSON.stringify(entry.alt) : '(attribute absent)'} verdict=${evaluation.verdict} marks=${evaluation.decorativeMarks.join(',') || '-'}`,
		);
	}
	return { ok: failures.length === 0, failures, rows };
}

/** The header band: what was rendered, what was measured, what was not. */
export function headerSvg({ observation, verdict, gate, width = SCREENSHOT_MAX_WIDTH }) {
	const title = 'image alt / decorative image — Issue #397';
	const rows = [
		`${EXPECTED_CASES.length} state(s) on one screen: ${EXPECTED_CASES.filter((entry) => entry.group === 'shipped contract').length} shipped, ${EXPECTED_CASES.filter((entry) => entry.group === 'reproduced defect').length} reproduced defects`,
		`machine-checked: every image's alt attribute and decorative mark read from the live DOM (SC 1.1.1 Non-text Content, A)`,
		`machine-checked: ${verdict.ok ? 'every state resolved to the verdict the screen claims' : 'a state did NOT resolve to the claimed verdict'}`,
		`machine-checked: gate ${gate.violations.length} violation(s) over ${gate.filesScanned} shipped .tsx file(s)`,
		'not machine-checked: whether an alt describes the image well, whether a decorative image really is decorative, a screen-reader pass',
		`WCAG 2.2: ${WCAG_MAPPING.map((entry) => `${entry.sc} ${entry.level}`).join(' · ')}`,
		'',
		...verdict.rows,
	];
	const rowTop = 34 + 34;
	const height = rowTop + rows.length * 20 + 16;
	const lines = rows
		.map(
			(row, index) =>
				`<text x="16" y="${rowTop + index * 20}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" fill="#1c2030">${escapeXml(row)}</text>`,
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
	const page = await sharp(pagePng).resize({ width: SCREENSHOT_MAX_WIDTH }).png().toBuffer();
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
		screenshot: 'docs/verification/a11y/image-alt.webp',
		pngDir: '.tmp/a11y-image-alt',
		jsonOut: '.tmp/a11y-image-alt/report.json',
		width: SCREENSHOT_MAX_WIDTH,
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
			`the image alt gate reports ${gate.violations.length} violation(s); the artefact would photograph a broken contract`,
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
			const pagePng = resolve(REPO_ROOT, options.pngDir, 'screen.png');
			const browser = await chromium.launch();
			try {
				const context = await browser.newContext({
					viewport: { width: options.width, height: 900 },
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
					`the browser observations contradict the image alt contract (${verdict.failures.length} failure(s)); no artefact was written`,
				);
			}

			const header = headerSvg({ observation, verdict, gate });
			const outPath = resolve(REPO_ROOT, options.screenshot);
			ensureDir(options.screenshot);
			const geometry = await composeArtefact({ sharp, pagePng, header, outPath });
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
				viewport: { width: options.width, height: 900 },
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
		issue: '#397',
		generatedBy: 'scripts/capture-a11y-image-alt.mjs',
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
		harness: { dir: HARNESS_DIR, entry: harnessIndexHtml() },
		observation,
		verdict,
		gate: {
			violations: gate.violations,
			filesScanned: gate.filesScanned,
			imagesScanned: gate.imagesScanned,
		},
		decorativeMarks: DECORATIVE_MARKS.map((mark) => mark.describe),
		wcag: WCAG_MAPPING,
		humanEvaluation: gate.humanEvaluation,
		policy: {
			webpOnly: true,
			maxWidth: SCREENSHOT_MAX_WIDTH,
			quality: SCREENSHOT_QUALITY,
			budgetBytes: SCREENSHOT_BUDGET_BYTES,
			issuePathSubstituted: 'docs/verification/a11y/image-alt.png -> .webp',
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

if (process.argv[1]?.endsWith('capture-a11y-image-alt.mjs')) {
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
