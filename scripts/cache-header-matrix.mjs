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
 * and when they do, the disagreement is the finding. A header the
 * browser did not receive at all is the same finding in its strongest
 * form, so it fails the row too rather than passing as "nothing to
 * compare".
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
import {
	CACHE_POLICY_MATRIX,
	USER_SPECIFIC_VARY_HEADERS,
	evaluateObservation,
	parseCacheControl,
	policyById,
} from './_cache-policy.mjs';

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

/**
 * Classes `--verify` refuses to call a success without having measured.
 *
 * Every class EXCEPT `reaction-image`, which structurally needs a stored
 * R2 object that no local probe can produce. The reason this list
 * exists: an environment where the Worker answers 5xx for every dynamic
 * path while Static Assets still serve `/favicon.svg` leaves at least
 * one row MEASURED, so an "at least one row" guard would pass — while
 * the whole Worker-side contract went unverified. A run that skipped
 * the Worker classes did not verify the cache contract.
 */
const REQUIRED_MEASURED_CLASSES = [
	'immutable-build-asset',
	'mutable-static-asset',
	'personal-page',
	'admin-page',
	'api-json',
];

/** Required classes this run never managed to measure. */
export function unmeasuredRequiredClasses(rows) {
	const measured = new Set(rows.filter((row) => !row.skipped).map((row) => row.id));
	return REQUIRED_MEASURED_CLASSES.filter((id) => !measured.has(id));
}

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
	// `test/integration/reactions-images.test.ts` through the Worker
	// entry (`SELF.fetch`), because a router-level call would bypass the
	// boundary default this row has to survive.
	targets.push({
		id: 'reaction-image',
		path: null,
		note: 'needs a stored reaction image id; asserted through the Worker entry in test/integration/reactions-images.test.ts',
	});
	for (const path of PERSONAL_PAGE_PATHS) targets.push({ id: 'personal-page', path });
	targets.push({ id: 'admin-page', path: '/admin/login' });
	// The auth-gated redirect: no body, no content-type, still `no-store`.
	targets.push({ id: 'admin-page', path: '/admin' });
	for (const path of API_PATHS) targets.push({ id: 'api-json', path });
	return targets;
}

/**
 * Turn one measured row into the row's own verdict.
 *
 * Exported (and pure) so the rule that a class which OFFERS a validator
 * must also ANSWER it is unit-testable without a running server, and so
 * the pass criteria and the row verdict cannot disagree about what a
 * violation is. `evaluateObservation` sees only the headers of the
 * first response; the conditional request is the other half of the
 * contract, so it is folded in here rather than left in a display
 * column nobody fails on.
 *
 * @param {{ revalidation?: string, etag?: string|null }} row
 * @param {{ ok: boolean, problems: string[] }} headerVerdict
 */
export function assessRow(row, headerVerdict) {
	const problems = [...headerVerdict.problems];
	const answered = row.revalidation ?? 'no validator sent';
	if (row.etag && answered !== '304 Not Modified') {
		problems.push(
			`offers an ETag but If-None-Match was answered with ${answered}, not 304 — the class cannot revalidate what it advertises`,
		);
	}
	return { ok: problems.length === 0, problems };
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

	const verdict = assessRow(row, evaluateObservation(row));
	row.ok = verdict.ok;
	row.problems = verdict.problems;
	return row;
}

/**
 * Judge what CHROMIUM received.
 *
 * The second observer is not decoration. If the browser receives a
 * different `Cache-Control` / validator than the Node observer did, then
 * one of the two is reading a different deployment than the other — a
 * proxy, a CDN rewrite, a stale edge — and that disagreement is the
 * single most useful thing this tool can report. Printing it beside a
 * green `ok` and exiting 0 hides exactly the finding it exists to
 * surface, so the disagreement fails the row.
 *
 * @param {object} row the Node-observed row
 * @param {{ cacheControl: string|null, etag: string|null, vary: string|null } | null | undefined} observation
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function assessBrowserObservation(row, observation) {
	const problems = [];
	if (row.browserError) problems.push(`Chromium could not load this URL: ${row.browserError}`);
	// No observation and no error: `--no-browser`, a skipped row, or a
	// redirect the browser follows. Nothing was contradicted.
	if (!observation) return { ok: problems.length === 0, problems };

	const declared = policyById(row.id).cacheControl;
	const seen = String(observation.cacheControl ?? '');
	// A MISSING `Cache-Control` in the browser is a mismatch, not an
	// absence of evidence. Both observers were sent the same URL, the
	// class declares a value, and Chromium received nothing — that is
	// exactly the disagreement this function exists to surface. Skipping
	// the comparison when `seen === ''` (as an earlier revision did)
	// let the row stay green and `--verify` exit 0 on a run where the
	// browser never received the policy at all.
	if (seen === '') {
		problems.push(`Chromium received no Cache-Control, expected "${declared}"`);
		if (typeof row.cacheControl === 'string' && row.cacheControl !== '') {
			problems.push(
				`Chromium received no Cache-Control where the HTTP observer received "${row.cacheControl}" — a disagreement between the two observers`,
			);
		}
	} else if (seen.toLowerCase() !== declared.toLowerCase()) {
		problems.push(`Chromium received Cache-Control "${seen}", expected "${declared}"`);
	}
	if (
		seen !== '' &&
		typeof row.cacheControl === 'string' &&
		seen.toLowerCase() !== row.cacheControl.toLowerCase()
	) {
		problems.push(
			`Chromium received "${seen}" where the HTTP observer received "${row.cacheControl}" — a disagreement between the two observers`,
		);
	}

	const browserHasValidator = typeof observation.etag === 'string' && observation.etag !== '';
	const nodeHasValidator = typeof row.etag === 'string' && row.etag !== '';
	if (browserHasValidator !== nodeHasValidator) {
		problems.push(
			`Chromium ${browserHasValidator ? 'received' : 'did not receive'} an ETag where the HTTP observer ${nodeHasValidator ? 'did' : 'did not'}`,
		);
	}

	const parsed = parseCacheControl(observation.cacheControl);
	// Same rule as `evaluateObservation`: a user-specific `Vary` is only
	// a violation when the response is still storable by a shared cache.
	for (const value of varyValues({ vary: observation.vary })) {
		if (!USER_SPECIFIC_VARY_HEADERS.includes(value)) continue;
		if (parsed.private || parsed.noStore) continue;
		problems.push(
			`Chromium received "Vary: ${value}", which is user-specific on a response a shared cache may store`,
		);
	}
	return { ok: problems.length === 0, problems };
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
		// A redirect row cannot be observed in a browser: Chromium
		// FOLLOWS the 3xx, so the response whose headers matter never
		// reaches the page and `observed` only ever holds the redirect
		// target's entry. Reporting the target under the requested path
		// would be a measurement of a different request, so the row is
		// skipped for the browser pass with the reason stated — its
		// headers are still recorded by the Node observer above.
		if (row.status >= 300 && row.status < 400) {
			row.browserNote = `not probed in Chromium: it follows the ${row.status} redirect, so no response is observed at this URL`;
			continue;
		}
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
		// Fold the second observer into the verdict, not just the report.
		const verdict = assessBrowserObservation(row, row.browser);
		if (verdict.problems.length > 0) {
			row.problems = [...(row.problems ?? []), ...verdict.problems];
			row.ok = false;
		}
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

/** Lower-cased, trimmed `Vary` tokens of a measured row. */
function varyValues(row) {
	return String(row.vary ?? '')
		.split(',')
		.map((value) => value.trim().toLowerCase())
		.filter((value) => value !== '');
}

/** A measured response a shared cache is allowed to store without revalidating. */
function isStorable(row) {
	const parsed = parseCacheControl(row.cacheControl);
	return !parsed.noStore && !parsed.noCache && parsed.maxAge !== null && parsed.maxAge > 0;
}

/**
 * The acceptance criteria, evaluated against the rows just measured.
 *
 * Every criterion is COMPUTED from `rows` — none of them is a constant.
 * A criterion that cannot fail is not a criterion: it would print PASS
 * in a report whose whole purpose is to be checkable by a reader who
 * does not trust the author.
 */
function passCriteria(rows) {
	const measured = rows.filter((row) => !row.skipped);
	const skipped = rows.filter((row) => row.skipped);
	const assetPolicy = policyById('immutable-build-asset').cacheControl;
	const assetLeak = measured.filter(
		(row) => row.id !== 'immutable-build-asset' && row.cacheControl === assetPolicy,
	);
	// Criterion 1 is exactly what its text says — the `Cache-Control`
	// VALUE matches the table. The other halves of a row's contract
	// (validator, revalidation, `Vary`) have their own criteria below, so
	// this one never reports a failure that belongs to another row.
	const policyMismatch = measured.filter(
		(row) =>
			parseCacheControl(row.cacheControl).raw.toLowerCase() !==
			policyById(row.id).cacheControl.toLowerCase(),
	);
	const validatorRows = measured.filter((row) => policyById(row.id).validator === 'etag');
	const staleValidatorRows = validatorRows.filter((row) => row.revalidation !== '304 Not Modified');
	const dynamicRows = measured.filter((row) => policyById(row.id).validator === 'none');
	const validatorLeaks = dynamicRows.filter((row) => row.etag);
	// Criterion 4: only a response a shared cache could actually store is
	// a hazard, so the count is taken over storable rows, not all rows.
	const userSpecificOnStorable = measured.filter(
		(row) => isStorable(row) && varyValues(row).some((v) => USER_SPECIFIC_VARY_HEADERS.includes(v)),
	);
	// Criterion 5: "never silently dropped" is checkable — every skipped
	// row must carry the reason it was skipped.
	const unexplainedSkips = skipped.filter((row) => !row.note);
	const unmeasured = unmeasuredRequiredClasses(rows);
	const criteria = [
		{
			criterion: 'every measured response carries its declared Cache-Control',
			result:
				policyMismatch.length === 0
					? `PASS (${measured.length} measured)`
					: `FAIL (${policyMismatch.length} of ${measured.length})`,
			ok: policyMismatch.length === 0,
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
			result:
				validatorLeaks.length + staleValidatorRows.length === 0
					? `PASS (${dynamicRows.length} dynamic rows carry no validator, ${validatorRows.length} asset rows answered 304)`
					: `FAIL (${validatorLeaks.length} unexpected validator, ${staleValidatorRows.length} did not answer 304)`,
			ok: validatorLeaks.length + staleValidatorRows.length === 0,
		},
		{
			criterion: 'no storable response varies on Cookie / Authorization',
			result:
				userSpecificOnStorable.length === 0
					? `PASS (0 of ${measured.filter(isStorable).length} storable rows)`
					: `FAIL (${userSpecificOnStorable.length})`,
			ok: userSpecificOnStorable.length === 0,
		},
		{
			criterion: 'rows this environment cannot produce are SKIPPED, never counted as passes',
			result:
				unexplainedSkips.length === 0
					? skipped.length === 0
						? 'PASS (nothing skipped)'
						: `PASS (${skipped.length} SKIPPED, each with a reason)`
					: `FAIL (${unexplainedSkips.length} skipped without a reason)`,
			ok: unexplainedSkips.length === 0,
		},
		{
			criterion: 'every class that needs no fixture was actually measured',
			result:
				unmeasured.length === 0
					? `PASS (${REQUIRED_MEASURED_CLASSES.length} classes measured)`
					: `FAIL (not measured: ${unmeasured.join(', ')})`,
			ok: unmeasured.length === 0,
		},
	];
	// Nothing measurable means nothing verified. An empty measurement set
	// satisfies every "there are no violations of X" formulation, so
	// without this the report would print PASS lines over a run that only
	// ever talked to a wrong `--base-url`. `--verify` exits non-zero on
	// the same condition (see `main`).
	if (measured.length === 0) {
		return criteria.map((entry) => ({
			criterion: entry.criterion,
			result: 'NOT MEASURED (no row produced a response — nothing was verified)',
			ok: false,
		}));
	}
	return criteria;
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
			const notes = [row.skipped ? row.note : null, row.browserNote].filter(
				(value) => typeof value === 'string' && value !== '',
			);
			const note = notes.length > 0 ? `<div class="note">${escapeHtml(notes.join(' '))}</div>` : '';
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
<p class="verdict">A row also FAILS when Chromium received a different <code>Cache-Control</code> / validator than the HTTP observer did: the two observers reading different deployments is the finding this tool exists to surface, not a footnote.</p>
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
	const measured = rows.length - skipped.length;
	process.stdout.write(
		`[cache-headers] ${measured} measured, ${failures.length} failed, ${skipped.length} skipped\n`,
	);
	for (const row of failures) {
		for (const problem of row.problems) {
			process.stderr.write(`[cache-headers] FAIL ${row.path ?? row.id}: ${problem}\n`);
		}
	}
	// Every probe failing is the shape a wrong `--base-url` or a stopped
	// preview server takes: each exception becomes a SKIPPED row, so
	// `failures` is empty and a naive check would exit 0 having verified
	// nothing at all. An unmeasured contract is not a passing one.
	if (args.verify && measured === 0) {
		process.stderr.write(
			`[cache-headers] FAIL nothing was measured: no target of ${rows.length} produced a response at ${args.baseUrl} — check the base URL and that the server is running\n`,
		);
		return 1;
	}
	// ... and an environment where Static Assets still answer while every
	// Worker-owned class is a 5xx is the subtler version of the same
	// failure: at least one row was measured, but none of the classes
	// this tool exists to check were.
	if (args.verify) {
		const unmeasured = unmeasuredRequiredClasses(rows);
		if (unmeasured.length > 0) {
			process.stderr.write(
				`[cache-headers] FAIL required classes were not measured at ${args.baseUrl}: ${unmeasured.join(', ')} — the Worker-side cache contract was not verified\n`,
			);
			return 1;
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
