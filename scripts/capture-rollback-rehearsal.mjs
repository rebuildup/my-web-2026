#!/usr/bin/env node

/**
 * capture-rollback-rehearsal — capture the Issue #503 verification screen
 * for `docs/verification/ops/rollback-rehearsal.webp`.
 *
 * What this captures
 * ------------------
 * The result of the offline rehearsal in `scripts/_rollback-rehearsal.mjs`:
 * each documented rollback path with its trigger, decision owner, recorded
 * command or owner procedure, expected observation, outcome, and what is
 * not reversible. The page is generated from the SAME table the test
 * asserts, so the image cannot drift from the rehearsal.
 *
 * Safety
 * ------
 *   - No deploy, no Cloudflare API call, no binding read, no credential.
 *     The only build is an HTML string written into `.tmp/`.
 *   - The page is served over a loopback-only HTTP server on an ephemeral
 *     port. Chromium refuses ES modules from `file://`; the page itself
 *     has no script and no remote asset, so the origin exists only to give
 *     the browser a document.
 *   - Every non-loopback request is measured with Playwright request
 *     events. A single one fails the capture instead of leaving a stale
 *     "zero external requests" claim in the report.
 *
 * WebP, not PNG
 * -------------
 * Issue #503 names a `.png` path. Verification artefacts in this
 * repository are compressed WebP (see `docs/verification/security/README.md`
 * and the sibling ops artefacts). Chromium only writes PNG, so the capture
 * buffer is re-encoded with the existing `sharp` devDependency, and the
 * committed file is the `.webp` sibling of the Issue's path. The script
 * REFUSES a non-`.webp` output path; no PNG file is written.
 *
 * Staged, then promoted
 * ---------------------
 * The candidate is encoded into `.tmp/` first. Only after the rehearsal
 * passes, the rendered path count matches, the page contains its markers,
 * the size budget holds and the outbound request count is zero is the
 * candidate moved onto the committed path. A failed run leaves the
 * committed artefact byte-for-byte untouched.
 *
 * Usage:
 *   node scripts/capture-rollback-rehearsal.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/ops/rollback-rehearsal.webp)
 *   --json-out=<path>     report destination
 *                         (default .tmp/rollback-rehearsal/report.json)
 *   --width=<n>           viewport width (default 1440)
 *   --no-capture          run the rehearsal and write the report, no browser
 */

import { execFileSync } from 'node:child_process';
import {
	createReadStream,
	existsSync,
	mkdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	OWNER_LABEL,
	RUNBOOK_PATH,
	formatRollbackRehearsal,
	runRollbackRehearsal,
} from './_rollback-rehearsal.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The committed artefact. WebP only. */
export const REPORT_SCREENSHOT = 'docs/verification/ops/rollback-rehearsal.webp';

/** Readiness marker the capture waits for before taking the screenshot. */
export const PAGE_TEST_ID = 'rollback-rehearsal';

/** Path card marker; the capture asserts there is exactly one per path. */
export const PATH_TEST_ID = 'rollback-path';

export const REPORT_DIR = '.tmp/rollback-rehearsal/report';

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
/**
 * The rehearsal table is a dense text page, so the highest quality that
 * still fits the budget is the one to commit — the same rule the other
 * text-table captures follow (`docs/verification/security/README.md`).
 */
export const SCREENSHOT_QUALITY_LADDER = [SCREENSHOT_QUALITY, 72, 64, 56];
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

/** Where a candidate capture is encoded before it has passed every check. */
export const STAGING_DIR = '.tmp/rollback-rehearsal/staging';

/** The staged candidate for an output path. Always under `.tmp/`. */
export function stagedCapturePath(screenshot, repoRoot = REPO_ROOT) {
	return join(resolve(repoRoot, STAGING_DIR), basename(screenshot));
}

/** Move a fully validated candidate onto the committed path. */
export function promoteStagedCapture({ staged, screenshot, repoRoot = REPO_ROOT }) {
	const finalPath = resolve(repoRoot, screenshot);
	mkdirSync(dirname(finalPath), { recursive: true });
	renameSync(resolve(repoRoot, staged), finalPath);
	return finalPath;
}

/** Drop a candidate that was never promoted. Safe when it never existed. */
export function discardStagedCapture(staged, repoRoot = REPO_ROOT) {
	rmSync(resolve(repoRoot, staged), { force: true });
}

/** Whether a capture fits the verification-artefact budget. */
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

/** Whether a request URL is the loopback report itself. */
export function isLoopbackRequestUrl(url) {
	try {
		const { hostname } = new URL(url);
		return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
	} catch {
		return false;
	}
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function citationLabel(citation) {
	const file = citation.file === RUNBOOK_PATH ? 'runbook' : citation.file;
	return `${file} · ${citation.heading}`;
}

function actionText(action) {
	switch (action.kind) {
		case 'operator-command':
			return `<code>${escapeHtml(action.command)}</code>`;
		case 'owner-procedure':
			return `<ol class="procedure">${action.procedure
				.map((entry) => `<li>${escapeHtml(entry)}</li>`)
				.join('')}</ol>`;
		case 'human-gate':
			return `<p class="gate">${escapeHtml(action.summary)}</p>`;
		case 'stop':
			return `<p class="stop">${escapeHtml(action.summary)}</p>`;
		default:
			return `<p>${escapeHtml(action.kind)}</p>`;
	}
}

function mutationLabel(mutation) {
	return mutation === 'none' ? 'read-only' : `mutates ${mutation}`;
}

/**
 * Render the verification page from the rehearsal result.
 *
 * Pure and deterministic: the same result produces the same HTML. The
 * page has no script, no external stylesheet and no web font, which is
 * what lets the capture claim zero non-loopback requests.
 */
export function renderRollbackRehearsalHtml(result) {
	const summary = result.summary;
	const tiles = [
		['Paths', String(summary.pathCount)],
		['Recorded steps', String(summary.stepCount)],
		['Owner-gated', String(summary.ownerGatedSteps)],
		['Human gates', String(summary.humanGateSteps)],
	];

	const pathCards = result.paths
		.map(
			(path, index) => `
			<article class="path" data-testid="${PATH_TEST_ID}" data-path-id="${escapeHtml(path.id)}">
				<div class="path-head">
					<span class="path-index">${String(index + 1).padStart(2, '0')}</span>
					<div class="path-title">
						<h2>${escapeHtml(path.title)}</h2>
						<p class="path-key"><code>${escapeHtml(path.id)}</code> · ${escapeHtml(path.failureClass)}</p>
					</div>
					<span class="outcome">${escapeHtml(path.outcome)}</span>
				</div>
				<div class="facts">
					<div class="fact">
						<span class="fact-label">Trigger</span>
						<p>${escapeHtml(path.trigger.observation)}</p>
					</div>
					<div class="fact">
						<span class="fact-label">Decision point</span>
						<p>${escapeHtml(path.decisionPoint.question)}</p>
						<p class="owner">${escapeHtml(OWNER_LABEL[path.decisionPoint.owner] ?? path.decisionPoint.owner)} decides</p>
					</div>
				</div>
				<ol class="steps">
					${path.steps
						.map(
							(step) => `
						<li class="step">
							<div class="step-meta">
								<span class="step-id">${escapeHtml(step.id)}</span>
								<span class="owner-chip">${escapeHtml(OWNER_LABEL[step.owner] ?? step.owner)}</span>
								<span class="mutation-chip">${escapeHtml(mutationLabel(step.action.mutates))}</span>
								<span class="recorded-chip">recorded, not executed</span>
							</div>
							<div class="step-action">${actionText(step.action)}</div>
							<p class="observation"><span>Expected observation</span> ${escapeHtml(step.observation)}</p>
							<p class="source">${escapeHtml(citationLabel(step.authority))}</p>
						</li>`,
						)
						.join('')}
				</ol>
				<div class="irreversible">
					<h3>Not reversible</h3>
					<ul>${path.notReversible.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>
				</div>
			</article>`,
		)
		.join('');

	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Rollback rehearsal — Issue #503</title>
		<style>
			:root {
				--paper: #f3efe6;
				--card: #fffdf8;
				--ink: #1c1b19;
				--muted: #6b6861;
				--line: #d8d2c5;
				--green: #0f5c4d;
				--green-soft: #e3efe9;
				--amber: #7a4a10;
				--amber-soft: #f6ead7;
				--red: #8d2f2f;
				--red-soft: #f5e2df;
				--mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
				--sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
			}
			* { box-sizing: border-box; }
			body {
				margin: 0;
				background: var(--paper);
				color: var(--ink);
				font-family: var(--sans);
				line-height: 1.5;
				-webkit-font-smoothing: antialiased;
			}
			main { max-width: 1280px; margin: 0 auto; padding: 56px 48px 72px; }
			.eyebrow {
				font-family: var(--mono);
				font-size: 12px;
				letter-spacing: 0.14em;
				text-transform: uppercase;
				color: var(--muted);
				margin-bottom: 12px;
			}
			h1 { font-size: 38px; line-height: 1.15; margin: 0 0 14px; letter-spacing: -0.02em; }
			.lede { max-width: 900px; margin: 0; color: #45423c; font-size: 16px; }
			.pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 22px; }
			.pill {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				padding: 5px 10px;
				border: 1px solid var(--line);
				border-radius: 999px;
				background: var(--card);
				font-family: var(--mono);
				font-size: 12px;
				color: var(--muted);
			}
			.pill.pass { background: var(--green); border-color: var(--green); color: #fff; font-weight: 700; letter-spacing: 0.08em; }
			.summary {
				display: grid;
				grid-template-columns: repeat(4, minmax(0, 1fr));
				gap: 12px;
				margin: 30px 0 34px;
			}
			.tile { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; }
			.tile .tile-label { font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
			.tile .tile-value { font-size: 30px; font-weight: 700; margin-top: 2px; letter-spacing: -0.03em; }
			.paths { display: grid; gap: 20px; }
			.path {
				background: var(--card);
				border: 1px solid var(--line);
				border-left: 4px solid var(--green);
				border-radius: 12px;
				padding: 22px 24px 20px;
			}
			.path-head { display: flex; align-items: flex-start; gap: 14px; }
			.path-index { font-family: var(--mono); font-size: 13px; color: var(--muted); padding-top: 4px; }
			.path-title { flex: 1; min-width: 0; }
			.path-title h2 { margin: 0; font-size: 21px; line-height: 1.25; letter-spacing: -0.01em; }
			.path-key { margin: 4px 0 0; font-size: 12px; color: var(--muted); }
			.path-key code { font-family: var(--mono); }
			.outcome {
				flex: none;
				padding: 5px 10px;
				border-radius: 6px;
				background: var(--green-soft);
				color: var(--green);
				font-family: var(--mono);
				font-size: 11px;
				font-weight: 700;
				letter-spacing: 0.05em;
				white-space: nowrap;
			}
			.facts { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin: 18px 0 8px; }
			.fact { border-top: 1px solid var(--line); padding-top: 10px; }
			.fact-label { font-family: var(--mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
			.fact p { margin: 5px 0 0; font-size: 13.5px; }
			.fact .owner { font-family: var(--mono); font-size: 12px; color: var(--green); }
			.steps { list-style: none; margin: 14px 0 0; padding: 0; border-top: 1px solid var(--line); }
			.step { padding: 14px 0 12px; border-bottom: 1px solid var(--line); }
			.step:last-child { border-bottom: 0; }
			.step-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 7px; }
			.step-id { font-family: var(--mono); font-size: 12px; font-weight: 700; }
			.owner-chip, .mutation-chip, .recorded-chip {
				font-family: var(--mono);
				font-size: 10.5px;
				padding: 2px 7px;
				border-radius: 4px;
				border: 1px solid var(--line);
				color: var(--muted);
			}
			.owner-chip { background: var(--green-soft); color: var(--green); border-color: #c7ded4; }
			.recorded-chip { background: var(--amber-soft); color: var(--amber); border-color: #e7d1ae; }
			.step-action code {
				display: block;
				font-family: var(--mono);
				font-size: 12px;
				line-height: 1.55;
				background: #f4f1e9;
				border: 1px solid var(--line);
				border-radius: 6px;
				padding: 8px 10px;
				overflow-wrap: anywhere;
			}
			.procedure { margin: 4px 0 0; padding-left: 20px; font-size: 13px; }
			.gate, .stop { margin: 2px 0 0; font-size: 13px; }
			.stop { color: var(--red); }
			.observation { margin: 8px 0 0; font-size: 13px; }
			.observation span { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin-right: 4px; }
			.source { margin: 5px 0 0; font-family: var(--mono); font-size: 10.5px; color: #8a867d; }
			.irreversible { margin-top: 14px; background: var(--red-soft); border: 1px solid #e7c8c3; border-radius: 8px; padding: 11px 14px; }
			.irreversible h3 { margin: 0 0 4px; font-size: 11px; font-family: var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--red); }
			.irreversible ul { margin: 0; padding-left: 18px; font-size: 12.5px; }
			footer { margin-top: 28px; border-top: 1px solid var(--line); padding-top: 16px; color: var(--muted); font-size: 12px; }
			footer code { font-family: var(--mono); }
			footer p { margin: 4px 0; }
		</style>
	</head>
	<body>
		<main data-testid="${PAGE_TEST_ID}">
			<header>
				<div class="eyebrow">Operations · Issue #503 · offline rehearsal</div>
				<h1>Rollback rehearsal — failed Cloudflare Workers Builds release</h1>
				<p class="lede">
					Table-driven rehearsal of the documented failure paths. Every step is an executable
					assertion in <code>scripts/rollback-rehearsal.test.mjs</code>. Commands are recorded,
					not executed; the rehearsal calls no Cloudflare API and reads no credential.
				</p>
				<div class="pills">
					<span class="pill pass">PASS</span>
					<span class="pill">${summary.executedCommands} commands executed</span>
					<span class="pill">${summary.externalRequests} external requests</span>
					<span class="pill">${summary.credentialsRead} credentials read</span>
					<span class="pill">release merge / tag / deploy: owner-only</span>
				</div>
			</header>
			<section class="summary" aria-label="Rehearsal summary">
				${tiles
					.map(
						([label, value]) =>
							`<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div></div>`,
					)
					.join('')}
			</section>
			<section class="paths" aria-label="Rehearsed paths">${pathCards}</section>
			<footer>
				<p><code>${escapeHtml(RUNBOOK_PATH)}</code> is the canonical release sequence. This rehearsal adds no deploy path and does not reorder that sequence.</p>
				<p>Release PR merge, release tag, GitHub Release publication and production deploy remain repository-owner-only (AGENTS.md §6).</p>
				<p>Regenerate: <code>pnpm run verify:rollback-rehearsal-screenshot</code></p>
			</footer>
		</main>
	</body>
</html>
`;
}

/** Content types the report server needs. */
const CONTENT_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.webp': 'image/webp',
};

/** Resolve one request path inside the served root. */
export function resolveStaticTarget(root, requestPath) {
	const base = resolve(root);
	let decoded;
	try {
		decoded = decodeURIComponent(requestPath);
	} catch {
		return { status: 400, file: null };
	}
	const candidate = resolve(base, `.${decoded}`);
	if (candidate !== base && !candidate.startsWith(`${base}/`)) {
		return { status: 403, file: null };
	}
	// A directory request (`/`, or any path that names a directory) must
	// fall through to its `index.html`. Serving the directory itself would
	// hand `createReadStream` a directory and fail the capture with EISDIR.
	const target =
		existsSync(candidate) && statSync(candidate).isFile()
			? candidate
			: join(candidate, 'index.html');
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

export function parseArgs(argv) {
	const options = {
		screenshot: REPORT_SCREENSHOT,
		jsonOut: '.tmp/rollback-rehearsal/report.json',
		width: 1440,
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

/** Write the generated report page (idempotent). */
export function writeReportPage(result, repoRoot = REPO_ROOT) {
	const dir = resolve(repoRoot, REPORT_DIR);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'index.html'), renderRollbackRehearsalHtml(result));
	return dir;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.capture) assertWebpOutputPath(options.screenshot);

	const result = runRollbackRehearsal();
	for (const line of formatRollbackRehearsal(result)) process.stdout.write(`${line}\n`);
	if (!result.ok) {
		throw new Error('the rehearsal table is invalid; no artefact was written');
	}

	const reportDir = writeReportPage(result);
	let capture = null;
	/** Measured, not asserted: every non-loopback URL the page requested. */
	const outboundUrls = [];
	const server = await serveDirectory(reportDir);
	try {
		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: page generated, nothing written\n');
		} else {
			const { chromium } = await import('@playwright/test');
			const sharp = (await import('sharp')).default;
			const stagedPath = stagedCapturePath(options.screenshot);
			ensureDir(stagedPath);
			const browser = await chromium.launch();
			try {
				const page = await browser.newPage({
					viewport: { width: options.width, height: 900 },
					deviceScaleFactor: 1,
				});
				page.on('request', (request) => {
					if (!isLoopbackRequestUrl(request.url())) outboundUrls.push(request.url());
				});
				await page.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle' });
				await page.waitForSelector(`[data-testid="${PAGE_TEST_ID}"]`, { timeout: 30_000 });
				const pathCards = await page.locator(`[data-testid="${PATH_TEST_ID}"]`).count();
				const png = await page.screenshot({ fullPage: true, type: 'png' });
				let encoded = null;
				for (const quality of SCREENSHOT_QUALITY_LADDER) {
					const candidate = await sharp(png)
						.resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
						.webp({ quality })
						.toBuffer();
					if (candidate.length <= SCREENSHOT_BUDGET_BYTES) {
						encoded = { buffer: candidate, quality };
						break;
					}
				}
				if (encoded === null) {
					throw new Error(
						`the capture does not fit in ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB of WebP at width ${SCREENSHOT_MAX_WIDTH} — split the rehearsal instead of committing a heavier image`,
					);
				}
				writeFileSync(stagedPath, encoded.buffer);
				const meta = await sharp(stagedPath).metadata();
				const verdict = screenshotBudgetVerdict(statSync(resolve(REPO_ROOT, stagedPath)).size);
				capture = {
					artefact: options.screenshot,
					viewport: { width: options.width, height: 900 },
					deviceScaleFactor: 1,
					pathsRendered: pathCards,
					width: meta.width ?? null,
					height: meta.height ?? null,
					quality: encoded.quality,
					...verdict,
				};
				if (pathCards !== result.summary.pathCount) {
					throw new Error(
						`expected ${result.summary.pathCount} rendered paths, found ${pathCards}`,
					);
				}
				if (!verdict.withinBudget) {
					throw new Error(
						`capture is ${verdict.kb} kB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB budget`,
					);
				}
				if (outboundUrls.length > 0) {
					throw new Error(
						`the report is fixture-only but issued ${outboundUrls.length} non-loopback request(s): ${outboundUrls.join(', ')}`,
					);
				}
				promoteStagedCapture({ staged: stagedPath, screenshot: options.screenshot });
				process.stdout.write(
					`[capture] wrote ${options.screenshot} (${capture.width}x${capture.height}, ${capture.pathsRendered} paths, ${verdict.kb} kB)\n`,
				);
			} finally {
				await browser.close();
				discardStagedCapture(stagedPath);
			}
		}
	} finally {
		await server.close();
	}

	const report = {
		issue: '#503',
		generatedBy: 'scripts/capture-rollback-rehearsal.mjs',
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
		rehearsal: {
			ok: result.ok,
			summary: result.summary,
			paths: result.paths.map((path) => ({
				id: path.id,
				failureClass: path.failureClass,
				outcome: path.outcome,
				steps: path.steps.length,
				notReversible: path.notReversible.length,
			})),
			errors: result.errors,
		},
		// Observed over Playwright request events, not asserted: `null`
		// on a `--no-capture` run, where no browser ever opened.
		outboundRequests: capture === null ? null : outboundUrls.length,
		outboundRequestUrls: outboundUrls,
		policy: {
			executedCommands: 0,
			credentialsRead: 0,
			webpOnly: true,
			maxWidth: SCREENSHOT_MAX_WIDTH,
			quality: capture === null ? null : capture.quality,
			qualityLadder: SCREENSHOT_QUALITY_LADDER,
			budgetBytes: SCREENSHOT_BUDGET_BYTES,
			stagingDir: STAGING_DIR,
			issuePathSubstituted:
				'docs/verification/ops/rollback-rehearsal.png -> .webp (repository convention: verification artefacts are compressed WebP, never PNG)',
			reproducible:
				'the rehearsal result and the page HTML are deterministic; the browser capture is not byte-reproducible',
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
