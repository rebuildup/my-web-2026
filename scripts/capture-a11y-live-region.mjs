#!/usr/bin/env node

/**
 * capture-a11y-live-region — capture the Issue #405 verification screen into
 * `docs/verification/a11y/live-region-state.webp`.
 *
 * What this captures
 * ------------------
 * One screen that drives a status region through the states a reaction
 * mutation actually has — idle, pending (`aria-busy`), success, empty and
 * failure — and records, for each step, the live-region attributes and the
 * mutation count of the region's subtree. The failure notice is a sibling
 * `role="alert"`, never a second status region.
 *
 * It is an ASSERTION, not only a screenshot. The browser drives the
 * transitions and the script fails (exit 1, no artefact) when:
 *
 *   - the status region is ever assertive,
 *   - `aria-busy` is not `true` while pending or not `false` when settled,
 *   - a result does not change the region (the announcement is silent), or
 *   - a settled result mutates the region again (the same result is
 *     announced twice).
 *
 * The vocabulary (live roles, aria-live values) is imported from the gate,
 * so the browser half and the source half cannot disagree about what a live
 * region is.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is read
 *     or printed. The harness is generated inline.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port.
 *   - Chromium screenshots are not byte-reproducible across processes, so
 *     the report records conditions instead of claiming a deterministic
 *     artefact.
 *
 * WebP, not PNG
 * -------------
 * Issue #405 names a `.png` path, but Chromium only writes PNG and a
 * verification artefact does not justify a permanently large binary in the
 * tree. The capture goes to `.tmp/`, is re-encoded with the existing
 * `sharp` devDependency at width <= 1600 / quality 80, and the committed
 * file is the `.webp` sibling. The script REFUSES any non-`.webp` output
 * path and deletes the intermediate PNG.
 *
 * Usage:
 *   node scripts/capture-a11y-live-region.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/a11y/live-region-state.webp)
 *   --png-dir=<path>     temporary PNG directory (default .tmp/a11y-live-region)
 *   --json-out=<path>    report destination (default .tmp/a11y-live-region/report.json)
 *   --width=<n>          page viewport width (default 1600)
 *   --no-capture         write no artefact
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARIA_LIVE_VALUES, LIVE_ROLES } from './check-a11y-live-region.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The states the harness is driven through, in order. */
export const STEPS = [
	{ id: 'idle', label: 'idle — nothing announced yet', expectBusy: 'false' },
	{ id: 'pending', label: 'pending — aria-busy="true" batches the update', expectBusy: 'true' },
	{ id: 'success', label: 'success — the chip is announced once', expectBusy: 'false' },
	{ id: 'settled', label: 'settled — the same result does not re-announce', expectBusy: 'false' },
	{ id: 'fail-pending', label: 'failure — aria-busy="true"', expectBusy: 'true' },
	{
		id: 'fail-alert',
		label: 'failure — a sibling role="alert", not a status',
		expectBusy: 'false',
	},
	{ id: 'empty-pending', label: 'empty — aria-busy="true"', expectBusy: 'true' },
	{ id: 'empty-settled', label: 'empty — one announcement, no re-announce', expectBusy: 'false' },
	{ id: 'narrow', label: '320 px — the live semantics are unchanged', expectBusy: 'false' },
];

/** The WCAG 2.2 criteria this artefact speaks to. */
export const WCAG_MAPPING = [
	{ sc: '4.1.3', name: 'Status Messages', level: 'AA' },
	{ sc: '4.1.2', name: 'Name, Role, Value', level: 'A' },
];

export const HARNESS_DIR = '.tmp/a11y-live-region/harness';

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

/** Minimal HTML escaping: the panel text is computed, not source. */
export function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * The harness page.
 *
 * The status region carries the contract the shipped widget carries:
 * `role="status"`, `aria-live="polite"`, `aria-atomic="true"` and
 * `aria-busy` while a mutation is in flight. The failure notice is a
 * sibling `role="alert"`. The page exposes `window.__liveRegion` so
 * Playwright can read the state and the mutation count.
 */
export function harnessIndexHtml() {
	const steps = STEPS.map(
		(step) =>
			`<tr><td><code>${escapeHtml(step.id)}</code></td><td>${escapeHtml(step.label)}</td></tr>`,
	).join('\n\t\t');
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>live region — Issue #405</title>
		<style>
			* { box-sizing: border-box; }
			body { margin: 0; padding: 24px 28px 36px; background: #ffffff; color: #101828;
				font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
			h1 { font-size: 20px; margin: 0 0 6px; }
			p.lede { margin: 0 0 20px; color: #475467; }
			.panel { display: flex; gap: 28px; align-items: flex-start; }
			.stage { width: 560px; }
			.controls { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
			button { font: inherit; padding: 6px 12px; border: 1px solid #98a2b3; border-radius: 6px;
				background: #ffffff; cursor: pointer; }
			.recorded { display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
				border: 1px solid #d0d5dd; border-radius: 8px; padding: 10px; min-height: 44px; }
			.chip { border: 1px solid #d0d5dd; border-radius: 999px; padding: 4px 10px; }
			.empty { color: #475467; }
			[role="alert"] { margin: 10px 0 0; color: #b42318; }
			[data-narrow="true"] .recorded { width: 320px; }
			table { border-collapse: collapse; font-size: 12px; margin-top: 8px; }
			td, th { border: 1px solid #d0d5dd; padding: 2px 8px; text-align: left; }
			code { color: #101828; }
		</style>
	</head>
	<body>
		<h1>live region — Issue #405 (WCAG 2.2 SC 4.1.3 / 4.1.2, level AA)</h1>
		<p class="lede">One status region, driven through idle / pending / success / empty / failure. The failure notice is a sibling <code>role="alert"</code>; the same result never writes the region twice.</p>
		<div class="panel">
			<div class="stage" id="stage">
				<div class="controls">
					<button id="btn-add" type="button">Add reaction</button>
					<button id="btn-empty" type="button">Remove all</button>
					<button id="btn-fail" type="button">Fail</button>
					<button id="btn-reset" type="button">Reset</button>
				</div>
				<div role="status" aria-live="polite" aria-atomic="true" aria-busy="false" id="status">
					<div class="recorded" id="recorded"><span class="empty">No reactions yet</span></div>
				</div>
				<p role="alert" id="alert" hidden></p>
			</div>
			<div class="stage">
				<table>
					<thead><tr><th>step</th><th>what it shows</th></tr></thead>
					<tbody>
		${steps}
					</tbody>
				</table>
			</div>
		</div>
		<script>
			const status = document.getElementById('status');
			const recorded = document.getElementById('recorded');
			const alert = document.getElementById('alert');
			const state = { name: 'idle', mutations: 0 };
			const observer = new MutationObserver((records) => {
				state.mutations += records.length;
			});
			observer.observe(status, { childList: true, subtree: true, characterData: true });

			function render(list) {
				recorded.replaceChildren();
				if (list.length === 0) {
					const empty = document.createElement('span');
					empty.className = 'empty';
					empty.textContent = 'No reactions yet';
					recorded.appendChild(empty);
					return;
				}
				for (const chip of list) {
					const span = document.createElement('span');
					span.className = 'chip';
					span.textContent = chip;
					recorded.appendChild(span);
				}
			}

			function setBusy(value) {
				status.setAttribute('aria-busy', value ? 'true' : 'false');
			}

			function transition(name, delayMs, apply) {
				window.__liveRegion.state = name;
				setBusy(true);
				alert.hidden = true;
				setTimeout(() => {
					apply();
					setBusy(false);
				}, delayMs);
			}

			document.getElementById('btn-add').addEventListener('click', () => {
				transition('pending', 250, () => {
					render(['👍 1', '🎉 1']);
					window.__liveRegion.state = 'success';
				});
			});
			document.getElementById('btn-empty').addEventListener('click', () => {
				transition('empty-pending', 250, () => {
					render([]);
					window.__liveRegion.state = 'empty-settled';
				});
			});
			document.getElementById('btn-fail').addEventListener('click', () => {
				transition('fail-pending', 250, () => {
					alert.hidden = false;
					alert.textContent = 'Reaction could not be sent';
					window.__liveRegion.state = 'fail-alert';
				});
			});
			document.getElementById('btn-reset').addEventListener('click', () => {
				alert.hidden = true;
				render([]);
				window.__liveRegion.state = 'idle';
				setBusy(false);
			});

			window.__liveRegion = {
				get state() { return state.name; },
				set state(value) { state.name = value; },
				get mutations() { return state.mutations; },
			};
		</script>
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
 * Read the live-region facts out of the rendered page.
 *
 * Runs in the browser, so it is written as a function body that Chromium
 * serialises — no imports, no closure variables.
 */
export const READ_STATE = () => {
	const read = (element) => ({
		present: element !== null && !element.hasAttribute('hidden'),
		role: element?.getAttribute('role') ?? null,
		ariaLive: element?.getAttribute('aria-live') ?? null,
		ariaAtomic: element?.getAttribute('aria-atomic') ?? null,
		ariaBusy: element?.getAttribute('aria-busy') ?? null,
		text: (element?.textContent ?? '').replace(/\s+/g, ' ').trim(),
	});
	return {
		state: window.__liveRegion.state,
		mutations: window.__liveRegion.mutations,
		status: read(document.getElementById('status')),
		alert: read(document.getElementById('alert')),
	};
};

/**
 * Decide whether the browser observations prove the live-region contract
 * (pure). `observations` is one record per step, in STEPS order.
 */
export function evaluateObservation(observations) {
	const failures = [];
	const rows = [];
	const byId = new Map((observations ?? []).map((entry) => [entry.id, entry]));

	for (const step of STEPS) {
		const entry = byId.get(step.id);
		if (!entry) {
			failures.push(`step ${step.id} was not observed`);
			continue;
		}
		const { status } = entry;
		rows.push(
			`${step.id.padEnd(14)} role=${status.role} aria-live=${status.ariaLive} aria-atomic=${status.ariaAtomic} busy=${status.ariaBusy} mutations=${entry.mutations} text=${JSON.stringify(status.text)}`,
		);

		const isLive =
			status.role !== null
				? LIVE_ROLES.includes(status.role)
				: status.ariaLive !== null && ARIA_LIVE_VALUES.includes(status.ariaLive);
		if (!isLive) {
			failures.push(`${step.id}: the status element is not a live region (role/aria-live missing)`);
		}
		if (status.ariaLive === 'assertive' || status.role === 'alert') {
			failures.push(`${step.id}: the status region is assertive; only the failure alert may be`);
		}
		if (status.ariaBusy !== step.expectBusy) {
			failures.push(
				`${step.id}: aria-busy is ${JSON.stringify(status.ariaBusy)}, expected ${JSON.stringify(step.expectBusy)}`,
			);
		}
	}

	const pending = byId.get('pending');
	const success = byId.get('success');
	const settled = byId.get('settled');
	const failPending = byId.get('fail-pending');
	const failAlert = byId.get('fail-alert');
	const emptyPending = byId.get('empty-pending');
	const emptySettled = byId.get('empty-settled');
	const narrow = byId.get('narrow');

	if (pending && success && success.status.text === pending.status.text) {
		failures.push('success: the region text did not change, so the result was not announced');
	}
	if (pending && success && success.mutations <= pending.mutations) {
		failures.push('success: the region was not mutated, so the result was not announced');
	}
	if (success && settled) {
		if (settled.status.text !== success.status.text) {
			failures.push('settled: the region text changed after the result (a second announcement)');
		}
		if (settled.mutations !== success.mutations) {
			failures.push('settled: the region mutated again after the result (a second announcement)');
		}
	}
	if (failPending && failAlert) {
		if (failAlert.alert.role !== 'alert' || !failAlert.alert.present) {
			failures.push('fail-alert: the failure is not exposed as a role="alert"');
		}
		if (failAlert.status.text !== failPending.status.text) {
			failures.push('fail-alert: the status region changed on failure (double announcement)');
		}
	}
	if (emptyPending && emptySettled && emptySettled.mutations <= emptyPending.mutations) {
		failures.push('empty-settled: the empty result was not announced');
	}
	if (narrow) {
		const before = byId.get('empty-settled');
		if (before && narrow.status.text !== before.status.text) {
			failures.push('narrow: the live region text changed with the viewport width');
		}
		if (narrow.status.ariaLive !== before?.status.ariaLive) {
			failures.push('narrow: the live region attributes changed with the viewport width');
		}
	}

	return { ok: failures.length === 0, failures, rows };
}

/** The header band: what was measured, what was not. */
export function headerSvg({ gate, verdict, width = SCREENSHOT_MAX_WIDTH }) {
	const title = 'live region — Issue #405 (WCAG 2.2 SC 4.1.3 / 4.1.2, AA)';
	const rows = [
		`${STEPS.length} step(s) driven in one Chromium: idle / pending / success / settled / failure / empty / 320 px`,
		'machine-checked: role, aria-live, aria-atomic and aria-busy read from the live DOM at every step',
		'machine-checked: a result changes the region once; a settled result does not mutate it again',
		`machine-checked: the failure is a sibling role="alert", never a second status region`,
		`machine-checked: gate ${gate.violations.length} violation(s) over ${gate.shipped.filesScanned} shipped .tsx file(s), ${gate.shipped.liveRegions.length} live region(s)`,
		'not machine-checked: whether an announcement is polite enough in practice, the wording, a real screen-reader pass',
		`WCAG 2.2: ${WCAG_MAPPING.map((entry) => `${entry.sc} ${entry.level}`).join(' · ')}`,
		'',
		...verdict.rows,
	];
	const rowTop = 34 + 30;
	const height = rowTop + rows.length * 19 + 16;
	const lines = rows
		.map(
			(row, index) =>
				`<text x="16" y="${rowTop + index * 19}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" fill="#1c2030">${escapeHtml(row)}</text>`,
		)
		.join('\n');
	return {
		height,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
	<rect width="${width}" height="${height}" fill="#f4efdf" />
	<text x="16" y="28" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="20" font-weight="700" fill="#0b1020">${escapeHtml(title)}</text>
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
		screenshot: 'docs/verification/a11y/live-region-state.webp',
		pngDir: '.tmp/a11y-live-region',
		jsonOut: '.tmp/a11y-live-region/report.json',
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

/** Drive the harness through the steps and read the live-region facts. */
async function observeSteps(page) {
	const observations = [];
	const read = async (id) => ({
		id,
		...(await page.evaluate(READ_STATE)),
	});

	observations.push(await read('idle'));

	await page.click('#btn-add');
	observations.push(await read('pending'));
	await page.waitForFunction(() => window.__liveRegion.state === 'success');
	observations.push(await read('success'));
	await page.waitForTimeout(120);
	observations.push(await read('settled'));

	await page.click('#btn-fail');
	observations.push(await read('fail-pending'));
	await page.waitForFunction(() => window.__liveRegion.state === 'fail-alert');
	observations.push(await read('fail-alert'));

	await page.click('#btn-empty');
	observations.push(await read('empty-pending'));
	await page.waitForFunction(() => window.__liveRegion.state === 'empty-settled');
	observations.push(await read('empty-settled'));

	await page.evaluate(() => {
		document.getElementById('stage').setAttribute('data-narrow', 'true');
	});
	await page.waitForTimeout(60);
	observations.push(await read('narrow'));

	return observations;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.capture) assertWebpOutputPath(options.screenshot);

	const { collectEvidence, renderGateSummary } = await import('./check-a11y-live-region.mjs');
	const gate = collectEvidence();
	if (gate.violations.length > 0) {
		process.stderr.write(`${renderGateSummary(gate)}\n`);
		throw new Error(
			`the live-region gate reports ${gate.violations.length} violation(s); the artefact would photograph a broken contract`,
		);
	}

	writeHarness();
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
			const pagePng = resolve(REPO_ROOT, options.pngDir, 'screen.png');
			ensureDir(join(options.pngDir, 'x.png'));
			const browser = await chromium.launch();
			try {
				const context = await browser.newContext({
					viewport: { width: options.width, height: 900 },
					deviceScaleFactor: 1,
					isMobile: false,
				});
				const page = await context.newPage();
				await page.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle' });
				observations = await observeSteps(page);
				writeFileSync(pagePng, await page.screenshot({ fullPage: true, type: 'png' }));
				await context.close();
			} finally {
				await browser.close();
			}

			verdict = evaluateObservation(observations);
			for (const failure of verdict.failures) process.stderr.write(`- ${failure}\n`);
			if (!verdict.ok) {
				throw new Error(
					`the browser observations contradict the live-region contract (${verdict.failures.length} failure(s)); no artefact was written`,
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
		issue: '#405',
		generatedBy: 'scripts/capture-a11y-live-region.mjs',
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
		harness: { dir: HARNESS_DIR, html: harnessIndexHtml() },
		steps: STEPS,
		observations,
		verdict,
		gate: {
			violations: gate.violations,
			filesScanned: gate.shipped.filesScanned,
			liveRegions: gate.shipped.liveRegions,
		},
		wcag: WCAG_MAPPING,
		humanEvaluation: gate.humanEvaluation,
		policy: {
			webpOnly: true,
			maxWidth: SCREENSHOT_MAX_WIDTH,
			quality: SCREENSHOT_QUALITY,
			budgetBytes: SCREENSHOT_BUDGET_BYTES,
			issuePathSubstituted: 'docs/verification/a11y/live-region-state.png -> .webp',
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

if (process.argv[1]?.endsWith('capture-a11y-live-region.mjs')) {
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
