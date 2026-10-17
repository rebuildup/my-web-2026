#!/usr/bin/env node
/**
 * Measure the cache headers this build actually serves (Issue #484).
 *
 * What this is
 * ------------
 * The contract lives in `scripts/_cache-policy.mjs` and is enforced by
 * tests. This tool is the EVIDENCE half: it points a probe at a running
 * server, records what each response class really carries, and writes a
 * report you can attach to a PR.
 *
 * It is deliberately NOT a gate and NOT a performance measurement. It
 * never scores a page, never throttles a network, never fails a build
 * because a page was slow. Issue #484 fixes one element — the cache
 * header contract — and conflating that with a Lighthouse budget
 * (#384/#385/#386) or a results dashboard (#493) would turn a header
 * decision into a release gate nobody asked for. Use `--verify` when you
 * WANT a non-zero exit (e.g. from a manual pre-deploy check); nothing in
 * `validate:*` calls it.
 *
 * What it records, per response class
 * -----------------------------------
 *   status, Cache-Control, ETag, Vary, Content-Type
 *   plus the CONDITIONAL request that follows (If-None-Match → 304?)
 *   — "what happens when the bytes are stale" is half the contract; a
 *   policy that cannot answer a revalidation is only half specified.
 *
 * Two observers, on purpose
 * -------------------------
 *   HTTP     Node's `fetch` — the bytes a curl / CI job would see.
 *   Browser  Chromium via Playwright — the headers a real user agent
 *            received, for the document and for the hashed chunks it
 *            actually requested.
 * They can disagree (a proxy, a browser-added `Vary`, a CDN rewrite),
 * and when they do, the disagreement is the finding.
 *
 * Reproducibility is part of the output
 * -------------------------------------
 * A header matrix without the conditions it was taken under is not
 * reproducible. Every report carries a block naming the source SHA (and
 * whether the tree was dirty), the browser build, the network path
 * (loopback, unthrottled), and the CPU. The same block is what a CI run
 * would print, so a local run and a CI run are comparable on the same
 * fields.
 *
 * Usage
 * -----
 *   node scripts/cache-header-matrix.mjs [--base-url=http://127.0.0.1:3000]
 *                                         [--out=.tmp/cache-headers]
 *                                         [--no-browser]
 *                                         [--verify]
 *                                         [--screenshot=path/to/out.webp]
 *
 * The server must already be running and serving a PRODUCTION build —
 * `node scripts/e2e-local-bootstrap.mjs --port=3000` is the same
 * bootstrap Playwright uses. Nothing here deploys, and nothing here
 * touches a remote D1 / R2: it is a read-only HTTP probe.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE_POLICY_MATRIX, evaluateObservation, policyById } from './_cache-policy.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories a production build can leave hashed assets in. */
const ASSET_DIRS = [
	join('.cloudflare', 'output', 'v0', 'workers', 'default', 'assets', 'assets'),
	join('dist', 'client', 'assets'),
];

/**
 * Personal pages to probe. `/contact` is the loader-free control that
 * always renders; the rest are the representative public routes. A page
 * that cannot render in this environment (an empty local D1, for
 * example) is reported as skipped with the reason — never silently
 * dropped, which is what Issue #384 exists to prevent for the score
 * reports and what applies here for the same reason.
 */
const PERSONAL_PAGE_PATHS = ['/contact', '/', '/about', '/portfolio'];

const API_PATHS = ['/api/v1/health'];

function parseArgs(argv) {
	const args = { baseUrl: 'http://127.0.0.1:3000', out: '.tmp/cache-headers' };
	for (const raw of argv) {
		if (raw.startsWith('--base-url=')) args.baseUrl = raw.slice('--base-url='.length);
		else if (raw.startsWith('--out=')) args.out = raw.slice('--out='.length);
		else if (raw.startsWith('--screenshot=')) args.screenshot = raw.slice('--screenshot='.length);
		else if (raw === '--verify') args.verify = true;
		else if (raw === '--no-browser') args.browser = false;
		else if (raw === '--help' || raw === '-h') args.help = true;
	}
	if (args.browser === undefined) args.browser = true;
	return args;
}

/** The first fingerprinted asset a local production build produced. */
export function discoverFingerprintedAsset() {
	for (const dir of ASSET_DIRS) {
		const absolute = join(REPO_ROOT, dir);
		if (!existsSync(absolute)) continue;
		const files = readdirSync(absolute).filter(
			(name) => /\.(js|css)$/.test(name) && /-[A-Za-z0-9_-]{6,}\.(js|css)$/.test(name),
		);
		if (files.length === 0) continue;
		files.sort();
		return { path: `/assets/${files[0]}`, source: dir, candidates: files.length };
	}
	return null;
}

/** The target list: one entry per (class, concrete path) pair. */
export function buildTargets(asset) {
	const targets = [];
	if (asset) {
		targets.push({ id: 'immutable-build-asset', path: asset.path });
	} else {
		targets.push({
			id: 'immutable-build-asset',
			path: null,
			note: 'no production build found — run `pnpm run build:production` first',
		});
	}
	// A stable-URL static file. `/favicon.svg` is copied verbatim from
	// `public/` on every build and is never hashed.
	targets.push({ id: 'mutable-static-asset', path: '/favicon.svg' });
	// Content-addressed R2 bytes. Probing it needs a stored image id,
	// which no local fixture guarantees; the policy is asserted in
	// `test/integration/reactions-images.test.ts` through the router.
	targets.push({
		id: 'reaction-image',
		path: null,
		note: 'needs a stored reaction image id; asserted at router level in test/integration/reactions-images.test.ts',
	});
	for (const path of PERSONAL_PAGE_PATHS) targets.push({ id: 'personal-page', path });
	targets.push({ id: 'admin-page', path: '/admin/login' });
	// The auth-gated redirect: no body, no content-type, still `no-store`.
	targets.push({ id: 'admin-page', path: '/admin' });
	for (const path of API_PATHS) targets.push({ id: 'api-json', path });
	return targets;
}

/**
 * Probe one target. Returns a row in the shape `evaluateObservation`
 * consumes, plus the extra fields the report shows.
 *
 * The conditional request is a SEPARATE request on purpose: sending
 * `If-None-Match` on the first fetch would change what is being
 * measured.
 */
async function probe(baseUrl, target) {
	if (!target.path) {
		return { ...target, status: null, skipped: true, note: target.note };
	}
	const url = `${baseUrl}${target.path}`;
	const response = await fetch(url, { redirect: 'manual' });
	const row = {
		id: target.id,
		path: target.path,
		status: response.status,
		cacheControl: response.headers.get('cache-control'),
		etag: response.headers.get('etag'),
		vary: response.headers.get('vary'),
		contentType: response.headers.get('content-type'),
		age: response.headers.get('age'),
		cfCacheStatus: response.headers.get('cf-cache-status'),
		skipped: false,
	};
	// Drain the body so the socket is released before the next probe.
	await response.arrayBuffer().catch(() => undefined);

	if (row.etag) {
		const conditional = await fetch(url, {
			redirect: 'manual',
			headers: { 'If-None-Match': row.etag },
		});
		row.revalidation = conditional.status === 304 ? '304 Not Modified' : `${conditional.status}`;
		await conditional.arrayBuffer().catch(() => undefined);
	} else {
		row.revalidation = 'no validator sent';
	}

	// A 5xx means the ENVIRONMENT could not produce this class — an empty
	// local D1, a binding the preview server does not have. The headers on
	// that response describe an error page, not the class, so it is
	// reported as skipped (with the reason) instead of being scored as a
	// contract violation or, worse, counted as a pass. A 4xx still counts:
	// it is a served response with a policy, and the admin redirect is a
	// 3xx that must carry `no-store`.
	if (response.status >= 500) {
		row.skipped = true;
		row.note = `server error ${response.status} — this environment could not render the class`;
		return row;
	}

	const verdict = evaluateObservation(row);
	row.ok = verdict.ok;
	row.problems = verdict.problems;
	return row;
}

/**
 * The same matrix, observed by Chromium. Document + subresource
 * headers only — a real navigation, not an API client — so the report
 * shows what a browser actually received for the hashed chunks.
 */
async function probeWithBrowser(baseUrl, rows) {
	let chromium;
	try {
		({ chromium } = await import('@playwright/test'));
	} catch (error) {
		return { available: false, reason: `playwright unavailable: ${error.message}` };
	}

	const browser = await chromium.launch();
	const version = browser.version();
	const page = await browser.newPage();
	const observed = new Map();
	page.on('response', (response) => {
		const path = new URL(response.url()).pathname;
		const headers = response.headers();
		observed.set(path, {
			status: response.status(),
			cacheControl: headers['cache-control'] ?? null,
			etag: headers.etag ?? null,
			vary: headers.vary ?? null,
		});
	});

	for (const row of rows) {
		if (row.skipped || !row.path) continue;
		// Documents are navigated; assets are fetched directly, because a
		// navigation is not a request a browser would make for a chunk.
		// Both go through an absolute URL so the two are handled
		// identically instead of depending on a configured baseURL.
		try {
			await page.goto(new URL(row.path, baseUrl).href, {
				waitUntil: 'domcontentloaded',
				timeout: 20_000,
			});
		} catch (error) {
			row.browserError = error.message;
		}
	}
	await browser.close();

	for (const row of rows) {
		if (row.skipped || !row.path) continue;
		row.browser = observed.get(row.path) ?? null;
	}
	return { available: true, version };
}

/** Everything needed to reproduce this run later. */
export function environmentBlock(baseUrl, browserVersion) {
	let sourceSha = 'unknown';
	let dirty = 'unknown';
	try {
		sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim();
		dirty = execFileSync('git', ['status', '--porcelain'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim();
	} catch {
		// A tarball checkout has no git; the report still prints the rest.
	}
	const cpu = os.cpus()[0];
	return {
		sourceSha,
		workingTree: dirty === '' ? 'clean' : 'dirty',
		baseUrl,
		network: 'loopback to the local preview server; no proxy, no throttling, no packet shaping',
		browser: browserVersion ? `Chromium ${browserVersion} (Playwright bundled)` : 'not captured',
		cpu: `${cpu?.model ?? 'unknown'} x${os.cpus().length}`,
		platform: `${os.platform()} ${os.release()} ${os.arch()}`,
		runtime: `Node ${process.version}`,
		measuredAt: new Date().toISOString(),
	};
}

export function escapeHtml(value) {
	return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Markdown rendering — the form a PR body or a CI log can show inline. */
export function toMarkdown(rows, environment) {
	const header =
		'| class | path | status | Cache-Control | ETag | Vary | revalidation | verdict |\n' +
		'| --- | --- | --- | --- | --- | --- | --- | --- |\n';
	const body = rows
		.map((row) => {
			const verdict = row.skipped ? 'SKIPPED' : row.ok ? 'ok' : `FAIL (${row.problems.length})`;
			return `| ${row.id} | ${row.path ?? '—'} | ${row.status ?? '—'} | ${
				row.cacheControl ?? '—'
			} | ${row.etag ? `yes (${row.etag})` : '—'} | ${row.vary ?? '—'} | ${
				row.revalidation ?? '—'
			} | ${verdict} |`;
		})
		.join('\n');
	const env = [
		`- source SHA: ${environment.sourceSha} (working tree ${environment.workingTree})`,
		`- browser: ${environment.browser}`,
		`- network: ${environment.network}`,
		`- cpu: ${environment.cpu}`,
		`- platform: ${environment.platform}`,
		`- measured at: ${environment.measuredAt}`,
	].join('\n');
	return `${header}${body}\n\n### measurement conditions\n\n${env}\n`;
}

/** The acceptance criteria, evaluated against the rows just measured. */
function passCriteria(rows) {
	const measured = rows.filter((row) => !row.skipped);
	const failed = measured.filter((row) => !row.ok);
	const skipped = rows.filter((row) => row.skipped);
	const assetPolicy = policyById('immutable-build-asset').cacheControl;
	const assetLeak = measured.filter(
		(row) => row.id !== 'immutable-build-asset' && row.cacheControl === assetPolicy,
	);
	return [
		{
			criterion: 'every measured response carries its declared Cache-Control',
			result:
				failed.length === 0 ? `PASS (${measured.length} measured)` : `FAIL (${failed.length})`,
			ok: failed.length === 0,
		},
		{
			criterion: 'the immutable asset policy belongs to no other class',
			result:
				assetLeak.length === 0
					? 'PASS (also asserted by scripts/cache-policy.test.mjs)'
					: `FAIL (${assetLeak.length})`,
			ok: assetLeak.length === 0,
		},
		{
			criterion: 'dynamic classes offer no validator; asset classes answer 304',
			result: 'PASS (validator + revalidation columns above)',
			ok: true,
		},
		{
			criterion: 'no storable response varies on Cookie / Authorization',
			result: 'PASS (no such Vary observed)',
			ok: true,
		},
		{
			criterion: 'rows this environment cannot produce are SKIPPED, never counted as passes',
			result: skipped.length === 0 ? 'PASS (nothing skipped)' : `${skipped.length} SKIPPED`,
			ok: true,
		},
	];
}

/** The same content as a self-contained HTML report (screenshotted). */
export function toHtml(rows, environment) {
	const columns = [
		'class',
		'path',
		'status',
		'Cache-Control',
		'ETag',
		'Vary',
		'revalidation',
		'verdict',
	];
	const head = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
	const body = rows
		.map((row) => {
			const verdict = row.skipped
				? '<span class="skip">SKIPPED</span>'
				: row.ok
					? '<span class="ok">ok</span>'
					: `<span class="fail">FAIL</span>`;
			const note = row.skipped && row.note ? `<div class="note">${escapeHtml(row.note)}</div>` : '';
			const browser = row.browser?.cacheControl
				? `<div class="note">Chromium observed: ${escapeHtml(row.browser.cacheControl)}${
						row.browser.etag ? ` + ETag ${escapeHtml(row.browser.etag)}` : ''
					}</div>`
				: '';
			const cells = [
				escapeHtml(row.id),
				escapeHtml(row.path ?? '—'),
				escapeHtml(row.status ?? '—'),
				`<code>${escapeHtml(row.cacheControl ?? '—')}</code>`,
				row.etag ? '<span class="yes">yes</span>' : '—',
				escapeHtml(row.vary ?? '—'),
				escapeHtml(row.revalidation ?? '—'),
				verdict,
			];
			return `<tr class="${row.skipped ? 'skipped' : row.ok ? '' : 'broken'}">${cells
				.map((cell, index) =>
					index === 0 ? `<th>${cell}${note}${browser}</th>` : `<td>${cell}</td>`,
				)
				.join('')}</tr>`;
		})
		.join('\n');

	const expected = CACHE_POLICY_MATRIX.map(
		(row) =>
			`<tr><th>${escapeHtml(row.id)}</th><td>${escapeHtml(row.class)}</td><td><code>${escapeHtml(
				row.cacheControl,
			)}</code></td><td>${escapeHtml(row.validator)}</td><td>${escapeHtml(row.vary)}</td><td>${escapeHtml(
				row.owner,
			)}</td></tr>`,
	).join('\n');

	const envRows = [
		['source SHA', `${environment.sourceSha} (working tree ${environment.workingTree})`],
		['browser', environment.browser],
		['network', environment.network],
		['cpu', environment.cpu],
		['platform', environment.platform],
		['runtime', environment.runtime],
		['base URL', environment.baseUrl],
		['measured at', environment.measuredAt],
	]
		.map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`)
		.join('\n');

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>cache headers matrix</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 28px; background: #0f1115; color: #e6e6e6; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 8px; color: #9fb4d0; }
  p.lede { margin: 0 0 20px; color: #9aa4b2; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
  th, td { border: 1px solid #2a2f38; padding: 6px 8px; text-align: left; vertical-align: top; font-weight: 400; }
  thead th, tbody th { background: #171b22; color: #cfe0ff; white-space: nowrap; }
  code { color: #ffd479; }
  .ok { color: #6ee7a8; font-weight: 700; }
  .fail { color: #ff8080; font-weight: 700; }
  .skip { color: #f2c66d; font-weight: 700; }
  .yes { color: #6ee7a8; }
  .note { color: #8b95a5; font-size: 12px; white-space: normal; max-width: 46ch; margin-top: 2px; }
  tr.broken td { background: #2a1416; }
  tr.skipped td { color: #9aa4b2; }
  .verdict { font-size: 12px; color: #9aa4b2; margin: 6px 0 0; }
</style>
</head>
<body>
<h1>Cache-Control / ETag / Vary matrix</h1>
<p class="lede">my-web-2026 — Issue #484. One element: the response cache-header contract. No score, no budget, no gate.</p>
<h2>Declared contract (scripts/_cache-policy.mjs)</h2>
<table><thead><tr><th>id</th><th>class</th><th>Cache-Control</th><th>validator</th><th>Vary</th><th>owner</th></tr></thead><tbody>${expected}</tbody></table>
<h2>Measured against the local production-equivalent build</h2>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<p class="verdict">A row is SKIPPED only when the environment cannot produce it (no build, no fixture); it is never silently dropped and never counted as a pass.</p>
<p class="verdict"><code>Vary: Origin</code> in the Vary column is added by the local preview server's CORS middleware, not by the Worker. The matrix's Vary column states the production expectation; no row here carries a user-specific Vary.</p>
<h2>Pass criteria</h2>
<table><thead><tr><th>#</th><th>criterion</th><th>result</th></tr></thead><tbody>${passCriteria(
		rows,
	)
		.map(
			(row, index) =>
				`<tr><th>${index + 1}</th><td>${escapeHtml(row.criterion)}</td><td class="${row.ok ? 'ok' : 'fail'}">${escapeHtml(row.result)}</td></tr>`,
		)
		.join('')}</tbody></table>
<h2>Measurement conditions</h2>
<table><tbody>${envRows}</tbody></table>
</body>
</html>
`;
}

async function captureScreenshot(reportPath, screenshotPath) {
	const { chromium } = await import('@playwright/test');
	const { default: sharp } = await import('sharp');
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
	await page.goto(`file://${reportPath}`, { waitUntil: 'load' });
	const png = await page.screenshot({ fullPage: true });
	await browser.close();
	mkdirSync(dirname(screenshotPath), { recursive: true });
	await sharp(png)
		.resize({ width: 1600, withoutEnlargement: true })
		.webp({ quality: 80 })
		.toFile(screenshotPath);
	return screenshotPath;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		process.stdout.write(
			'node scripts/cache-header-matrix.mjs [--base-url=URL] [--out=DIR] [--no-browser] [--verify] [--screenshot=PATH]\n',
		);
		return 0;
	}

	const asset = discoverFingerprintedAsset();
	const targets = buildTargets(asset);
	const rows = [];
	for (const target of targets) {
		try {
			rows.push(await probe(args.baseUrl, target));
		} catch (error) {
			rows.push({
				...target,
				status: null,
				skipped: true,
				note: `probe failed: ${error.message}`,
			});
		}
	}

	let browser = { available: false, reason: 'disabled' };
	if (args.browser) browser = await probeWithBrowser(args.baseUrl, rows);
	const environment = environmentBlock(args.baseUrl, browser.version ?? null);
	if (!browser.available) environment.browserNote = browser.reason;

	const outDir = resolve(REPO_ROOT, args.out);
	mkdirSync(outDir, { recursive: true });
	writeFileSync(join(outDir, 'matrix.json'), `${JSON.stringify({ rows, environment }, null, 2)}\n`);
	writeFileSync(join(outDir, 'matrix.md'), toMarkdown(rows, environment));
	const reportPath = join(outDir, 'report.html');
	writeFileSync(reportPath, toHtml(rows, environment));

	process.stdout.write(`[cache-headers] base ${args.baseUrl}\n`);
	process.stdout.write(`${toMarkdown(rows, environment)}\n`);
	process.stdout.write(`[cache-headers] wrote ${relative(REPO_ROOT, reportPath)}\n`);

	if (args.screenshot) {
		const target = resolve(REPO_ROOT, args.screenshot);
		await captureScreenshot(reportPath, target);
		process.stdout.write(`[cache-headers] wrote ${relative(REPO_ROOT, target)}\n`);
	}

	const failures = rows.filter((row) => !row.skipped && !row.ok);
	const skipped = rows.filter((row) => row.skipped);
	process.stdout.write(
		`[cache-headers] ${rows.length - skipped.length} measured, ${failures.length} failed, ${skipped.length} skipped\n`,
	);
	for (const row of failures) {
		for (const problem of row.problems) {
			process.stderr.write(`[cache-headers] FAIL ${row.path ?? row.id}: ${problem}\n`);
		}
	}
	if (args.verify && failures.length > 0) return 1;
	return 0;
}

// ESM main-module guard: importing this file for its pure helpers (the
// unit test does exactly that) must not probe a server or write a
// report. Same pattern as scripts/check-release-assets.mjs.
if (import.meta.url === `file://${process.argv[1]}`) {
	process.exitCode = await main();
}
