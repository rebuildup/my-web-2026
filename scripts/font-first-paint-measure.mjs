#!/usr/bin/env node
/**
 * font-first-paint-measure — first-visit webfont evidence for Issue #485.
 *
 * What it measures (and what it deliberately does NOT do)
 * ------------------------------------------------------
 * This is a **measurement**, not a gate. It records the real font
 * pipeline of a first visit on representative local routes:
 *
 *   - `first-contentful-paint` / `largest-contentful-paint`
 *   - the cumulative layout shift (`layout-shift`, input-excluded, with
 *     the standard 5 s session window), so the swap-induced shift is
 *     visible as a number instead of a vibe
 *   - the webfont timeline itself: how many `fonts.gstatic.com` /
 *     `fonts.googleapis.com` requests were attempted and how many
 *     actually completed (an aborted request still shows up in
 *     resource timing), their transfer size and duration, and the
 *     instant the first webfont face reported `loaded`
 *   - **fallback readability** under a blocked font origin: is there
 *     still real, visible text, and is it actually rendered by the
 *     platform fallback rather than by a webfont that slipped past the
 *     block (which would mean the scenario is invalid, not passing)
 *
 * It exits 0 on a completed measurement and non-zero only when the
 * measurement itself could not be taken (browser launch failure, a
 * navigation that did not return 2xx, an unreadable base URL). Budget
 * enforcement is explicitly **not** here: thresholds + release gate are
 * Issue #386's obligation, and Issue #384 owns the Lighthouse report
 * harness. Adding a `process.exitCode = 1` on a metric threshold here
 * would fuse "measure" with "gate" — the exact confusion #485 asks to
 * avoid.
 *
 * Scenarios (all local; nothing here touches production)
 * ------------------------------------------------------
 *   baseline   no throttling, font origin reachable when the host has
 *              network access (the report records whether it does)
 *   blocked    `fonts.googleapis.com` / `fonts.gstatic.com` aborted —
 *              the "network cut / font unavailable" condition that
 *              Issue #291's async-CSS pattern must stay readable under
 *   slow-font  CPU throttled x4 and every font-origin response delayed
 *              by `--font-delay-ms` (default 1500) — the FOUT window
 *
 * Reproducibility block
 * ---------------------
 * Every report carries the browser build, viewport, CPU throttle, font
 * delay, font-origin reachability, host CPU/OS, and the **source SHA**
 * plus dirty-tree flag. A number without those is not evidence, so they
 * are part of the artefact, not of the PR prose.
 *
 * Usage:
 *   node scripts/font-first-paint-measure.mjs [options]
 *
 *   --base-url <url>     origin to measure (default http://127.0.0.1:3000)
 *   --out <dir>          artefact directory (default .tmp/font-first-paint)
 *   --routes <list>      comma separated paths, at least one (default /,/about)
 *   --compare <file>     a previous report.json to diff against (before/after)
 *   --font-delay-ms <n>  per-response font delay in the slow-font scenario
 *   --headed             run Chromium headed (default headless)
 *   --no-screenshots     skip the per-scenario PNG captures
 *   --help
 *
 * Exit codes: 0 = measurement written, 2 = measurement impossible
 * (browser/base URL/navigation failure). Never 1 — there is no threshold
 * to fail here.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/** Hosts that carry the webfont pipeline. Blocking / delaying exactly
 *  these two is what makes "font unavailable" and "font slow"
 *  reproducible without touching any production surface. */
export const FONT_ORIGINS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

/** Playwright route patterns for the two font hosts. */
export const FONT_ORIGIN_PATTERNS = FONT_ORIGINS.map((host) => `https://${host}/**`);

/** Families whose load/swap behaviour the issue is about. */
export const WEBFONT_FAMILIES = ['Noto Sans JP', 'Zen Kaku Gothic New'];

/** Representative local routes. `/` is the Japanese-heavy home surface,
 *  `/about` is the mixed ja/en profile surface — the two documents a
 *  first visit is most likely to land on. A route that answers non-2xx
 *  fails the run instead of being skipped silently. */
export const DEFAULT_ROUTES = ['/', '/about'];

export const DEFAULT_FONT_DELAY_MS = 1500;
export const CPU_THROTTLE_RATE = 4;
export const VIEWPORT = { width: 1280, height: 800 };

/** How long the page is held still after the fonts settled, so a late
 *  layout-shift / LCP entry still lands inside the measured window. */
export const SETTLE_MS = 2000;

/** The blocked scenario never swaps, so it only needs enough settle to
 *  catch the abort fallout. */
export const BLOCKED_SETTLE_MS = 750;

/** Upper bound on waiting for the swap instant. The slow-font swap
 *  lands seconds after load; a fixed settle window that closed before
 *  it would silently under-report the very layout shift this ticket
 *  claims is deterministic. */
export const SWAP_WAIT_TIMEOUT_MS = 15000;

/* ------------------------------------------------------------------ *
 * Pure helpers (unit-tested by scripts/font-first-paint-measure.test.mjs)
 * ------------------------------------------------------------------ */

/**
 * Cumulative Layout Shift with the standard session windows: entries are
 * summed while they stay within 1 s of the previous entry and within a
 * 5 s session, and the reported value is the largest session total —
 * not the sum of every shift. Summing everything would report a user
 * scrolling for 30 s as one CLS number and make the measurement useless.
 */
export function cumulativeLayoutShift(entries) {
	const sorted = [...entries].sort((a, b) => a.startTime - b.startTime);
	const SESSION_GAP_MS = 1000;
	const SESSION_MAX_MS = 5000;
	let best = 0;
	let sessionValue = 0;
	let sessionStart = 0;
	let sessionLast = 0;
	for (const entry of sorted) {
		const continuesSession =
			sessionValue > 0 &&
			entry.startTime - sessionLast < SESSION_GAP_MS &&
			entry.startTime - sessionStart < SESSION_MAX_MS;
		if (continuesSession) {
			sessionValue += entry.value;
		} else {
			sessionValue = entry.value;
			sessionStart = entry.startTime;
		}
		sessionLast = entry.startTime;
		best = Math.max(best, sessionValue);
	}
	return {
		cls: round3(best),
		count: sorted.length,
		worst: round3(sorted.reduce((max, e) => Math.max(max, e.value), 0)),
	};
}

/** Font-origin resource timing summary. `transferSize` is 0 for
 *  cross-origin responses without Timing-Allow-Origin, which is exactly
 *  what `fonts.gstatic.com` returns today — so the count and the
 *  durations are the honest signal and the byte total may be 0.
 *
 *  A request the route handler aborted still appears in resource timing:
 *  the entry keeps a non-zero `responseEnd` but `responseStart`,
 *  `transferSize` and `encodedBodySize` are all 0 and the protocol is
 *  empty. Attempted requests are therefore counted apart from completed
 *  ones, and only completed ones carry bytes and timings. */
export function summarizeFontResources(resources) {
	const attempted = resources.filter((r) => FONT_ORIGINS.some((host) => r.name?.includes(host)));
	const completed = attempted.filter(isCompletedRequest);
	return {
		requests: completed.length,
		abortedRequests: attempted.length - completed.length,
		transferBytes: completed.reduce((sum, r) => sum + (r.transferSize || 0), 0),
		slowestMs: round3(
			completed.length ? completed.reduce((max, r) => Math.max(max, r.duration || 0), 0) : null,
		),
		lastStartMs: round3(
			completed.length ? completed.reduce((max, r) => Math.max(max, r.startTime || 0), 0) : null,
		),
	};
}

/** Did a resource-timing entry actually deliver a response?
 *  Measured against Chromium: an aborted request keeps its entry and a
 *  non-zero `responseEnd`, but no response ever started, so every
 *  response signal reads 0. `responseStatus` is NOT usable — it is 0
 *  for a delivered cross-origin response too (the status is hidden
 *  without `Timing-Allow-Origin`, and stays 0 under Playwright route
 *  interception), so it cannot separate the two cases. */
export function isCompletedRequest(entry) {
	return (
		(entry.transferSize ?? 0) > 0 ||
		(entry.encodedBodySize ?? 0) > 0 ||
		(entry.responseStart ?? 0) > 0
	);
}

/** Round to three decimals while preserving ABSENCE. `Math.round(null *
 *  1000) / 1000` is `0`, so a metric that was never observed (no
 *  webfont face ever loaded, an observer that never fired) would be
 *  serialised as a real `0` — and a blocked-font row would then report
 *  a font swap at 0 ms, which is the one thing it cannot have
 *  measured. `0` and "never observed" are different findings, so
 *  `round3` keeps them apart. */
export function round3(value) {
	if (value === null || value === undefined || !Number.isFinite(value)) return null;
	return Math.round(value * 1000) / 1000;
}

/** How a metric reaches prose and the terminal: a number prints as a
 *  number, absence prints as `n/a`. Never as `0`. */
export function formatMetric(value) {
	return typeof value === 'number' ? String(value) : 'n/a';
}

/**
 * Fallback-readability verdict for the blocked-font scenario.
 *
 * `probes` are the in-page text probes (see `collectProbeResult`).
 * Two independent failure modes are checked, and BOTH are failures:
 *
 *   - no legible text at all (empty text, zero-size box, hidden,
 *     transparent) — the page became unreadable when the font origin
 *     went away;
 *   - `webFontAvailable` true while the scenario claims the origin was
 *     blocked — the block did not take effect, so the "readable
 *     fallback" claim would be evidence for nothing. A silently
 *     ineffective block is the failure mode this catches.
 */
export function evaluateFallbackReadability({ probes, webFontAvailable, blocked }) {
	const problems = [];
	if (probes.length === 0) {
		problems.push('no text probe was found — the page exposed nothing to read');
	}
	for (const probe of probes) {
		const where = `${probe.tag}${probe.role ? `[${probe.role}]` : ''} "${probe.textSample}"`;
		if (!probe.textSample) problems.push(`${where}: empty text`);
		if (!(probe.rectWidth > 0 && probe.rectHeight > 0)) {
			problems.push(`${where}: zero-size box (${probe.rectWidth}x${probe.rectHeight})`);
		}
		if (probe.visibility === 'hidden' || probe.visibility === 'collapse') {
			problems.push(`${where}: visibility=${probe.visibility}`);
		}
		if (!(probe.opacity > 0)) problems.push(`${where}: opacity=${probe.opacity}`);
		if (!(probe.colorAlpha > 0)) problems.push(`${where}: fully transparent text color`);
	}
	if (blocked && webFontAvailable) {
		problems.push(
			'the blocked-font scenario still resolved the webfont — the block did not apply, so this row proves nothing',
		);
	}
	return { ok: problems.length === 0, problems, probes: probes.length };
}

/** Metrics rendered as the layout-shift result rather than as timing
 *  context. "Layout shift" is NOT a promise that a value repeats: a row
 *  either wraps or it does not **on the build that was measured**, and a
 *  row sitting within a hair of its wrap threshold flips between builds
 *  (the `/` baseline has been measured on both sides of it). One
 *  before/after pair is therefore a measurement of two builds, and the
 *  report says so next to the table instead of calling the column
 *  deterministic. */
export const LAYOUT_SHIFT_METRICS = ['cls', 'clsEntries', 'worstShift'];

function range(values) {
	if (values.length === 0) return 'n/a';
	const min = Math.min(...values);
	const max = Math.max(...values);
	return min === max ? String(min) : `${min}–${max}`;
}

/**
 * `route:scenario:metric`, split from the right.
 *
 * The route is caller-supplied and may contain a colon (`/docs:v2`), so
 * splitting on every colon read the route's own tail as the scenario and
 * the scenario as the metric — which moved the CLS row out of the
 * layout-shift table and attributed shift sources to the wrong run. The
 * scenario and the metric are fixed vocabularies, so the last two
 * segments are the unambiguous ones.
 */
export function parseRunKey(key) {
	const parts = key.split(':');
	const metric = parts.pop();
	const scenario = parts.pop();
	return { route: parts.join(':'), scenario, metric };
}

/**
 * Collapses the noisy half of the comparison into one row per metric,
 * as a min–max range across routes and scenarios. Reporting 45 single
 * -run rows in a PR screenshot is how a noise delta gets mistaken for a
 * result, so the HTML keeps the range and `report.json` keeps every row.
 *
 * Only rows that exist on BOTH sides are aggregated. `--compare` is
 * routinely handed two captures that did not measure the same routes,
 * and collapsing the present half of such a comparison would print a
 * before/after pairing the data never observed — an improvement or a
 * regression that did not happen. Unpaired rows stay in
 * `report.json`, and the aggregate states how many runs were paired so
 * that gap is visible instead of implied.
 */
export function aggregateComparison(comparison) {
	const byMetric = new Map();
	for (const row of comparison) {
		const metric = parseRunKey(row.key).metric;
		if (!byMetric.has(metric)) byMetric.set(metric, []);
		byMetric.get(metric).push(row);
	}
	return [...byMetric.entries()].map(([metric, rows]) => {
		const paired = rows.filter((r) => typeof r.before === 'number' && typeof r.after === 'number');
		return {
			metric,
			before: range(paired.map((r) => r.before)),
			after: range(paired.map((r) => r.after)),
			layoutShift: LAYOUT_SHIFT_METRICS.includes(metric),
			pairedRuns: paired.length,
			totalRuns: rows.length,
		};
	});
}

/**
 * before/after rows for the report's comparison table. Keyed by
 * `route:scenario:metric` so a route that changed shape between runs
 * shows as `n/a` instead of silently pairing the wrong numbers.
 *
 * The CLS row also carries the shift sources from BOTH captures. A
 * before/after number quoted from prose is only evidence if the
 * elements that moved are in the deliverable next to it — otherwise the
 * attribution lives in a scratch directory no reader can check.
 */
export function compareRuns(before, after) {
	const flat = (report) => {
		const out = new Map();
		for (const run of report.runs) {
			for (const [metric, value] of Object.entries(run.metrics)) {
				out.set(`${run.route}:${run.scenario}:${metric}`, value);
			}
		}
		return out;
	};
	const sourcesOf = (report, route, scenario) =>
		report.runs.find((run) => run.route === route && run.scenario === scenario)
			?.layoutShiftSources ?? [];
	const beforeFlat = flat(before);
	const afterFlat = flat(after);
	const keys = [...new Set([...beforeFlat.keys(), ...afterFlat.keys()])].sort();
	return keys.map((key) => {
		const b = beforeFlat.get(key);
		const a = afterFlat.get(key);
		const delta = typeof b === 'number' && typeof a === 'number' ? round3(a - b) : null;
		const row = {
			key,
			before: b ?? null,
			after: a ?? null,
			delta,
			direction: directionOf(key, delta),
		};
		if (key.endsWith(':cls')) {
			const { route, scenario } = parseRunKey(key);
			row.beforeSources = sourcesOf(before, route, scenario);
			row.afterSources = sourcesOf(after, route, scenario);
		}
		return row;
	});
}

/**
 * Measurement conditions that decide whether two captures may be read
 * as a before/after pair.
 *
 * `--compare` is handed a previous `report.json` by hand, so nothing
 * stops it being a capture from another host, another browser build,
 * another origin, or one where the font origin was unreachable. Copying
 * the numbers and the shift sources out of it — while the report shows
 * only THIS capture's environment — is how a platform-specific
 * fallback and a font that could not be reached at all get read as a
 * code difference. These conditions are compared, and a difference is
 * stated in the report next to the comparison.
 *
 * What is deliberately NOT compared: source SHA, branch, version and
 * timestamp. Those differ by definition (that is the point of a
 * before/after pair) and carry no measurement condition. The origin is
 * compared by host only — the capture runs on an ephemeral local port,
 * so a different port is not a different condition.
 */
const COMPARE_CONDITIONS = [
	{
		condition: 'browser',
		read: (env) =>
			`${env?.browser?.name} ${env?.browser?.version} (Playwright ${env?.browser?.playwright})`,
	},
	{ condition: 'browser mode', read: (env) => env?.browser?.mode },
	{
		condition: 'viewport',
		read: (env) =>
			env?.viewport
				? `${env.viewport.width}x${env.viewport.height} @${env.viewport.deviceScaleFactor}x`
				: null,
	},
	{ condition: 'font origin reachable', read: (env) => env?.fontOriginReachable ?? null },
	{ condition: 'font delay (slow-font)', read: (env) => env?.network?.fontDelayMs ?? null },
	{ condition: 'CPU throttle (slow-font)', read: (env) => env?.cpu?.throttleRate ?? null },
	{ condition: 'origin host', read: (env) => originHost(env?.baseUrl) },
	{
		condition: 'routes',
		read: (env) =>
			String(env?.routes ?? '')
				.split(',')
				.map((r) => r.trim())
				.filter(Boolean)
				.sort()
				.join(', ') || null,
	},
	{
		condition: 'host OS / arch',
		read: (env) => (env?.host ? `${env.host.platform} ${env.host.arch}` : null),
	},
];

/** The origin's host, without the ephemeral port. */
function originHost(baseUrl) {
	if (!baseUrl) return null;
	try {
		return new URL(baseUrl).hostname;
	} catch {
		return null;
	}
}

/**
 * Every condition under which the two captures disagree.
 *
 * An empty list means the before/after table may be read as a
 * comparison. A non-empty list is reported, never silently dropped:
 * the numbers stay in the artefact, but the report says the pair is
 * not like-for-like.
 */
export function compareConditionDifferences(beforeEnv, afterEnv) {
	return COMPARE_CONDITIONS.map(({ condition, read }) => {
		const before = read(beforeEnv);
		const after = read(afterEnv);
		return { condition, before, after, same: before === after };
	}).filter((entry) => !entry.same);
}

function directionOf(key, delta) {
	if (delta === null || delta === 0) return 'flat';
	const { metric } = parseRunKey(key);
	// Lower is better for every metric collected here: paint timings,
	// the swap instant and layout shift. The comment keeps the rule
	// honest if a future metric joins the table.
	const lowerIsBetter = ['fcpMs', 'lcpMs', 'cls', 'fontSwapMs', 'fallbackProbes'].includes(metric);
	if (!lowerIsBetter) return 'unknown';
	return delta < 0 ? 'better' : 'worse';
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

/** Self-contained HTML rendering of a report. Relative `<img>` srcs
 *  resolve against the report's own directory, so the file can be
 *  opened from disk (and screenshotted) without any bundling. */
export function renderReportHtml(report) {
	const env = report.environment;
	const row = (label, value) =>
		`<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
	const runs = report.runs
		.map((run) => {
			// A metric that was never observed renders as `n/a`. Printing
			// the raw value would print `null`, and printing a coerced
			// zero would claim a measurement that does not exist.
			const cell = (value) =>
				typeof value === 'number' ? escapeHtml(value) : '<span class="na">n/a</span>';
			const verdict = run.fallback
				? `<span class="${run.fallback.ok ? 'ok' : 'bad'}">${escapeHtml(
						run.fallback.ok ? 'readable' : 'NOT readable',
					)}</span>`
				: '—';
			// No lazy loading: the report is a static document that gets
			// screenshotted, and a capture below the fold that never
			// loaded would quietly drop the evidence for its own row.
			const shot = run.screenshot
				? `<img src="./${escapeHtml(screenshotSrcUrl(run.screenshot))}" alt="${escapeHtml(run.route)} ${escapeHtml(
						run.scenario,
					)} screenshot" />`
				: '';
			return [
				'<tr>',
				`<td>${escapeHtml(run.route)}</td>`,
				`<td>${escapeHtml(run.scenario)}</td>`,
				`<td>${cell(run.metrics.fcpMs)}</td>`,
				`<td>${cell(run.metrics.lcpMs)}</td>`,
				`<td>${cell(run.metrics.cls)}</td>`,
				`<td>${cell(run.metrics.fontSwapMs)}</td>`,
				`<td>${cell(run.metrics.fontRequests)}</td>`,
				`<td>${cell(run.metrics.fontRequestsAborted)}</td>`,
				`<td>${verdict}</td>`,
				`<td>${shot}</td>`,
				'</tr>',
			].join('');
		})
		.join('\n');

	const comparison = (() => {
		if (!report.comparison?.length) return '';
		const aggregated = aggregateComparison(report.comparison);
		const row = (a) =>
			`<tr><td>${escapeHtml(a.metric)}</td><td>${escapeHtml(a.before)}</td><td>${escapeHtml(a.after)}</td><td>${a.pairedRuns} / ${a.totalRuns}</td></tr>`;
		const table = (title, rows) =>
			[
				`<h3>${escapeHtml(title)}</h3>`,
				'<table><thead><tr><th>metric</th><th>before</th><th>after</th><th>paired runs</th></tr></thead><tbody>',
				rows.map(row).join(''),
				'</tbody></table>',
			].join('');
		return [
			'<h2>before / after</h2>',
			'<p class="note">The layout-shift table is the result column, and it is a <em>per-build</em> measurement: a row either wraps or it does not on the build that was measured. A row sitting within ~1% of its wrap threshold flips between builds — the <code>/</code> baseline has been measured on both sides of it — so one before/after pair is a measurement of two builds, not a distribution over repeated runs. The context table is SINGLE-RUN timing against a third-party font origin, shown as a min&ndash;max range across routes and scenarios — it is network and machine noise, not a result. A range only covers the runs measured on both sides; <code>paired runs</code> states how many of them there were, and a metric with no paired run reads <code>n/a</code> rather than a half-pairing. Every individual row stays in <code>report.json</code>. Read it together with the before-capture conditions above: a difference there makes this table a difference of conditions, not of builds.</p>',
			table(
				'layout shift (single run, per build)',
				aggregated.filter((a) => a.layoutShift),
			),
			table(
				'context (single-run timings — noise)',
				aggregated.filter((a) => !a.layoutShift),
			),
		].join('');
	})();

	const shiftSourcesCell = (shift) =>
		(shift.sources ?? [])
			.map(
				(source) =>
					`<div>${escapeHtml(source.tag)} &ldquo;${escapeHtml(source.text)}&rdquo; ${escapeHtml(
						source.previous,
					)} &rarr; ${escapeHtml(source.current)}</div>`,
			)
			.join('');

	const diagnosis = report.runs.some((run) => (run.layoutShiftSources ?? []).length > 0)
		? `<h2>where the shift came from</h2><p class="note">Layout-shift sources for the two largest shifts of every run. A CLS number without these is unattributable — this is the evidence that a shift is a re-wrap (a container height changes when the font swaps) rather than an image or an ad slot.</p><table><thead><tr><th>route</th><th>scenario</th><th>value</th><th>at ms</th><th>sources</th></tr></thead><tbody>${report.runs
				.flatMap((run) =>
					(run.layoutShiftSources ?? []).map(
						(shift) =>
							`<tr><td>${escapeHtml(run.route)}</td><td>${escapeHtml(run.scenario)}</td><td>${escapeHtml(
								shift.value,
							)}</td><td>${escapeHtml(shift.startTimeMs)}</td><td>${shiftSourcesCell(shift)}</td></tr>`,
					),
				)
				.join('\n')}</tbody></table>`
		: '';

	// The same attribution for the capture passed with `--compare`. It
	// lives here, in the deliverable, so that the before number quoted
	// in prose can be checked against the elements that actually moved
	// instead of against a scratch directory.
	const beforeAfterShifts = (() => {
		const rows = (report.comparison ?? []).filter(
			(row) =>
				row.key.endsWith(':cls') && (row.beforeSources?.length > 0 || row.afterSources?.length > 0),
		);
		if (rows.length === 0) return '';
		const body = rows
			.flatMap((row) => {
				const { route, scenario } = parseRunKey(row.key);
				const cells = (shifts, side) =>
					(shifts ?? [])
						.map(
							(shift) =>
								`<tr><td>${escapeHtml(route)}</td><td>${escapeHtml(scenario)}</td><td>${side}</td><td>${escapeHtml(
									shift.value,
								)}</td><td>${escapeHtml(shift.startTimeMs)}</td><td>${shiftSourcesCell(shift)}</td></tr>`,
						)
						.join('');
				return [cells(row.beforeSources, 'before'), cells(row.afterSources, 'after')];
			})
			.join('\n');
		return [
			'<h2>where the shift came from — before / after</h2>',
			'<p class="note">The same two largest shifts per run, from the capture passed with <code>--compare</code> (before) and from this capture (after). Quoting a before/after CLS number without these is quoting a number with no cause attached.</p>',
			'<table><thead><tr><th>route</th><th>scenario</th><th>side</th><th>value</th><th>at ms</th><th>sources</th></tr></thead><tbody>',
			body,
			'</tbody></table>',
		].join('');
	})();

	// The conditions of the capture passed with `--compare`. They
	// travel with the comparison: a before/after table whose before
	// side was measured on another host, another browser, another
	// origin, or without a reachable font origin is a difference of
	// conditions, and the report has to say which it is.
	const beforeConditions = (() => {
		if (!report.compare) return '';
		const env = report.compare.environment ?? {};
		const shown = (value, fallback = 'unknown') =>
			value === null || value === undefined || value === '' ? fallback : String(value);
		const rows = [
			['capture', shown(report.compare.path)],
			['captured at', shown(report.compare.capturedAt)],
			[
				'browser',
				`${shown(env.browser?.name)} ${shown(env.browser?.version)} (Playwright ${shown(env.browser?.playwright)})`,
			],
			['mode', shown(env.browser?.mode)],
			[
				'viewport',
				env.viewport
					? `${env.viewport.width}x${env.viewport.height} @${env.viewport.deviceScaleFactor}x`
					: 'unknown',
			],
			[
				'font origin',
				`reachable=${shown(env.fontOriginReachable)} (${shown(env.fontOriginStatus)})`,
			],
			[
				'slow-font scenario',
				`CPU x${shown(env.cpu?.throttleRate)}, font responses delayed ${shown(env.network?.fontDelayMs)} ms`,
			],
			[
				'host',
				env.host
					? `${shown(env.host.platform)} ${shown(env.host.arch)}, ${shown(env.host.cpuModel)} x${shown(env.host.cpuCount)}`
					: 'unknown',
			],
			['host memory', env.host ? `${shown(env.host.totalMemGB)} GB` : 'unknown'],
			['origin measured', shown(env.baseUrl)],
			['routes', shown(env.routes)],
			[
				'source SHA',
				env.source
					? `${shown(env.source.sha)}${env.source.dirty ? ' (dirty tree)' : ''}`
					: 'unknown',
			],
			[
				'branch / version',
				env.source ? `${shown(env.source.branch)} / ${shown(env.source.version)}` : 'unknown',
			],
			['command', shown(report.compare.command)],
			[
				'arguments',
				report.compare.argv?.length
					? report.compare.argv.map(shellQuote).join(' ')
					: '(none recorded)',
			],
		].map(([label, value]) => row(label, value));
		const differences = report.compareConditionDifferences ?? [];
		const warning = differences.length
			? `<p class="warn">These measurement conditions DIFFER between the before capture and this one, so the before/after tables below are NOT a like-for-like comparison of two builds:<ul>${differences
					.map(
						(d) =>
							`<li><code>${escapeHtml(d.condition)}</code>: before <code>${escapeHtml(
								d.before === null ? 'unknown' : d.before,
							)}</code> &rarr; after <code>${escapeHtml(d.after === null ? 'unknown' : d.after)}</code></li>`,
					)
					.join(
						'',
					)}</ul>A difference in <code>font origin reachable</code>, the browser build, the viewport, the host or the origin means at least one side did not measure the same thing, so a delta here must not be read as an effect of the change.</p>`
			: '<p class="note">The measurement conditions of the two captures match on every compared item, so the before/after tables below compare the same thing on both sides.</p>';
		return [
			'<h2>before capture (--compare) conditions</h2>',
			'<p class="note">The conditions the capture passed with <code>--compare</code> was measured under. They are recorded here because a before/after number is only evidence when both sides were taken the same way.</p>',
			warning,
			`<table><tbody>${rows.join('')}</tbody></table>`,
		].join('');
	})();

	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>font first-paint measurement — ${escapeHtml(report.environment.source.sha)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 24px; color: #111827; background: #ffffff; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 8px; }
  h3 { font-size: 13px; margin: 18px 0 6px; color: #374151; }
  p.note { margin: 0 0 16px; color: #4b5563; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
  th, td { border: 1px solid #d1d5db; padding: 4px 8px; text-align: left; vertical-align: top; font-size: 12px; }
  thead th { background: #f3f4f6; }
  td img { max-width: 200px; border: 1px solid #e5e7eb; display: block; }
  .ok { color: #047857; font-weight: 700; }
  .bad { color: #b91c1c; font-weight: 700; }
  .na { color: #6b7280; font-style: italic; }
  .better { color: #047857; } .worse { color: #b91c1c; } .flat { color: #6b7280; }
  .warn { background: #fef3c7; border: 1px solid #f59e0b; padding: 8px; margin: 8px 0; }
</style></head>
<body>
<h1>font first-paint measurement (Issue #485)</h1>
<p class="note">Measurement only — no threshold is enforced here. Budget + release gate: Issue #386.</p>
${env.fontOriginReachable ? '' : '<p class="warn">the webfont pipeline is NOT fully reachable from this host (the stylesheet and the face it points at are both probed) — <code>baseline</code> and <code>slow-font</code> cannot exercise a real webfont swap. The font origin is therefore aborted in EVERY scenario, so the page never waits on a third-party stylesheet that may never answer; the rows are all platform-fallback measurements and their swap timings are unavailable, not zero.</p>'}
<h2>environment (reproduction conditions)</h2>
<table><tbody>
${row('browser', `${env.browser.name} ${env.browser.version} (Playwright ${env.browser.playwright})`)}
${row('mode', env.browser.mode)}
${row('viewport', `${env.viewport.width}x${env.viewport.height} @${env.viewport.deviceScaleFactor}x`)}
${row('network', `no throttling; font-origin reachable=${env.fontOriginReachable} (${escapeHtml(env.fontOriginStatus)})${env.fontOriginAbortedInEveryScenario ? '; aborted in every scenario, so no row here measured a webfont swap' : ''}`)}
${row('slow-font scenario', `CPU x${env.cpu.throttleRate}, font responses delayed ${env.network.fontDelayMs} ms`)}
${row('host', `${env.host.platform} ${env.host.arch}, ${env.host.cpuModel} x${env.host.cpuCount}`)}
${row('host memory', `${env.host.totalMemGB} GB`)}
${row('source SHA', `${env.source.sha}${env.source.dirty ? ' (dirty tree)' : ''}`)}
${row('branch / version', `${env.source.branch} / ${env.source.version}`)}
${row('origin measured', env.baseUrl)}
${row('routes', env.routes)}
${row('compared against', env.compareSource)}
${row('captured at', report.capturedAt ?? env.capturedAt)}
${row('command', report.command)}
${report.argv?.length ? row('arguments', report.argv.map(shellQuote).join(' ')) : ''}
</tbody></table>
${beforeConditions}
<h2>metrics</h2>
<p class="note"><code>n/a</code> means the metric was never observed, not that it measured zero — a row whose font origin was aborted has no webfont face to swap to, so its swap instant does not exist. The <code>fallback</code> verdict is reported for every row that ran with the font origin aborted: the <code>blocked</code> scenario, and — when the pre-flight probe found the origin unusable — every other scenario too. <code>font-origin reqs</code> counts only font-origin requests that delivered a response; an aborted one is counted separately so it can never read as a font that was fetched. In Chromium the faces the CSS font loader fetches do not appear in this buffer at all, so the counted request is the Google Fonts stylesheet.</p>
<table><thead><tr><th>route</th><th>scenario</th><th>FCP ms</th><th>LCP ms</th><th>CLS</th><th>font swap ms</th><th>font-origin reqs</th><th>font-origin reqs aborted</th><th>fallback</th><th>screenshot</th></tr></thead>
<tbody>
${runs}
</tbody></table>
${diagnosis}
${beforeAfterShifts}
${comparison}
</body></html>
`;
}

/* ------------------------------------------------------------------ *
 * In-page collector (runs before any page script)
 * ------------------------------------------------------------------ */

function collectorScript(families) {
	window.__fontFirstPaint = {
		fcp: null,
		lcp: null,
		lcpElement: null,
		clsEntries: [],
		fontResources: [],
		fontsReadyAt: null,
		webFontSwapAt: null,
	};
	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				if (entry.name === 'first-contentful-paint') window.__fontFirstPaint.fcp = entry.startTime;
			}
		}).observe({ type: 'paint', buffered: true });
	} catch {}
	try {
		new PerformanceObserver((list) => {
			const entries = list.getEntries();
			const last = entries[entries.length - 1];
			if (last) {
				window.__fontFirstPaint.lcp = last.startTime;
				window.__fontFirstPaint.lcpElement = last.element
					? `${last.element.tagName.toLowerCase()}.${String(last.element.className || '').split(' ')[0]}`
					: null;
			}
		}).observe({ type: 'largest-contentful-paint', buffered: true });
	} catch {}
	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				if (!entry.hadRecentInput) {
					window.__fontFirstPaint.clsEntries.push({
						value: entry.value,
						startTime: entry.startTime,
						// Shift sources are the whole diagnosis: a re-wrap
						// shows up as a container whose height changes, and
						// without them a CLS number is unattributable.
						sources: (entry.sources || []).slice(0, 4).map((source) => ({
							tag: source.node ? source.node.tagName.toLowerCase() : '?',
							text: source.node
								? String(source.node.textContent || '')
										.trim()
										.slice(0, 28)
								: '',
							previous: `${Math.round(source.previousRect.width)}x${Math.round(source.previousRect.height)}`,
							current: `${Math.round(source.currentRect.width)}x${Math.round(source.currentRect.height)}`,
						})),
					});
				}
			}
		}).observe({ type: 'layout-shift', buffered: true });
	} catch {}
	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				window.__fontFirstPaint.fontResources.push({
					name: entry.name,
					startTime: entry.startTime,
					duration: entry.duration,
					// An aborted request keeps its entry with every response
					// signal at 0; see `isCompletedRequest`.
					responseStart: entry.responseStart,
					encodedBodySize: entry.encodedBodySize,
					transferSize: entry.transferSize,
				});
			}
		}).observe({ type: 'resource', buffered: true });
	} catch {}
	// `document.fonts.ready` resolves when the *currently pending* loads
	// settle — which is NOT the swap: before the Google stylesheet is
	// parsed no @font-face exists, so it resolves almost immediately and
	// would report a meaningless "swap". The swap is instead polled from
	// the FontFaceSet itself: the first instant a webfont face reports
	// `loaded` is the instant `display=swap` actually replaced the
	// fallback glyphs.
	const isWebFont = (face) => families.includes(String(face.family || '').replaceAll('"', ''));
	window.__fontFirstPaint.fontPoll = setInterval(() => {
		const now = performance.now();
		for (const face of document.fonts) {
			if (
				isWebFont(face) &&
				face.status === 'loaded' &&
				window.__fontFirstPaint.webFontSwapAt === null
			) {
				window.__fontFirstPaint.webFontSwapAt = now;
				// The first loaded webfont face IS the swap. The
				// remaining faces (614 of them once the Google sheet
				// parses) carry no further information, and walking them
				// every 50 ms is main-thread work inside the very window
				// being measured.
				clearInterval(window.__fontFirstPaint.fontPoll);
				return;
			}
		}
	}, 50);
	document.fonts.ready.then(() => {
		window.__fontFirstPaint.fontsReadyAt = performance.now();
	});
}

/** Text probes: the first text-bearing elements inside the app root, so
 *  the verdict is about what a visitor can actually read rather than
 *  about one hard-coded selector that may not exist on a surface. */
const PROBE_SELECTOR = 'h1, h2, h3, p, li, a, button';

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

export function parseArgs(argv) {
	const options = {
		baseUrl: process.env.PERF_FONT_BASE_URL ?? 'http://127.0.0.1:3000',
		outDir: '.tmp/font-first-paint',
		routes: DEFAULT_ROUTES,
		compare: null,
		fontDelayMs: DEFAULT_FONT_DELAY_MS,
		headless: true,
		screenshots: true,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		const next = () => {
			const value = argv[i + 1];
			if (value === undefined) throw new Error(`${arg} requires a value`);
			i += 1;
			return value;
		};
		if (arg === '--base-url') options.baseUrl = next();
		else if (arg === '--out') options.outDir = next();
		else if (arg === '--routes') {
			const routes = next()
				.split(',')
				.map((r) => r.trim())
				.filter(Boolean);
			// `--routes ,` and `--routes ""` leave nothing to measure. The
			// loop then never runs and the script still writes a report
			// and exits 0 — a "completed measurement" with no run in it.
			// Reject the argument instead of producing that artefact.
			if (routes.length === 0) throw new Error('--routes requires at least one non-empty route');
			options.routes = routes;
		} else if (arg === '--compare') options.compare = next();
		else if (arg === '--font-delay-ms') {
			const raw = next();
			const delay = Number(raw);
			// `Number('abc')` is NaN, and a NaN delay makes
			// `delayMs > 0` false, so the slow-font scenario would
			// install no route interception at all and still be labelled
			// `slow-font` — a mistyped flag silently producing a second
			// baseline row. Reject it instead.
			if (raw.trim() === '' || !Number.isFinite(delay) || delay < 0) {
				throw new Error(`--font-delay-ms requires a non-negative finite number, received "${raw}"`);
			}
			options.fontDelayMs = delay;
		} else if (arg === '--headed') options.headless = false;
		else if (arg === '--no-screenshots') options.screenshots = false;
		else if (arg === '--help' || arg === '-h') options.help = true;
		else throw new Error(`unknown argument: ${arg}`);
	}
	options.baseUrl = options.baseUrl.replace(/\/$/, '');
	return options;
}

const USAGE = `font-first-paint-measure — Issue #485 first-visit webfont measurement

  --base-url <url>     origin to measure (default http://127.0.0.1:3000)
  --out <dir>          artefact directory (default .tmp/font-first-paint)
  --routes <list>      comma separated paths, at least one (default /,/about)
  --compare <file>     previous report.json to diff against
  --font-delay-ms <n>  font delay in the slow-font scenario (default ${DEFAULT_FONT_DELAY_MS})
  --headed             run Chromium headed
  --no-screenshots     skip per-scenario captures
  --help
`;

function git(args) {
	try {
		return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
	} catch {
		return null;
	}
}

/** One argument as a copy-pasteable shell token: single-quoted, with
 *  embedded single quotes spliced out and back in.
 *
 *  The report is a reproduction record, so `argv.join(' ')` breaks its own
 *  contract the moment a value contains a space: `--out ".tmp/font
 *  report"` reads back as two arguments and fails as an unknown flag.
 *  `report.argv` carries the array for readers who would rather not shell
 *  out at all. */
export function shellQuote(arg) {
	return `'${arg.replaceAll("'", `'\\''`)}'`;
}

/** File name for one run's screenshot.
 *
 *  `/` becomes `_` so the name stays readable, which is only safe if the
 *  route's own underscores are escaped first: `--routes /a/b,/a_b` names
 *  two distinct routes, and a bare slash-to-underscore rewrite writes
 *  both captures to `_a_b-<scenario>.png`. The second one overwrites the
 *  first file while both runs keep pointing at it, so the report would
 *  show one route's screenshot as another route's evidence. The escaping
 *  is reversible: `__` decodes to `_`, a lone `_` to `/`. */
export function screenshotFileName(route, scenarioName) {
	const stem =
		route
			.replaceAll('_', '__')
			.replaceAll('/', '_')
			// `?`, `#` and `%` are valid in a route and survive the rewrite
			// above, which breaks the `<img src>`: `_about?variant=a.png`
			// reads as the path `_about` plus a query string, so the report
			// would point at a file that does not exist. Percent-encoding
			// covers every character a URL path cannot carry verbatim — `%`
			// included, so an encoded route cannot collide with a literal
			// one. Undo it after the underscore pass; that pass only ever
			// produces `/` and `_`, so nothing it writes is decoded here.
			.replaceAll(/[^A-Za-z0-9_.-]/gu, (c) => encodeURIComponent(c)) || '_root';
	return `${stem}-${scenarioName}.png`;
}

/** The URL the report's `<img src>` must use for one capture file.
 *
 *  `screenshotFileName` percent-encodes what a route may carry that a
 *  URL path cannot, so the file on disk is
 *  `_about%3Fvariant%3Da-baseline.png`. Repeating that string verbatim
 *  in an `src` does NOT point at the file: URL resolution decodes the
 *  path, `%3F` becomes `?`, and the browser asks for
 *  `_about?variant=a-baseline.png` — a file that does not exist, so the
 *  evidence silently renders as a broken image. The literal `%` in the
 *  file name therefore has to be encoded again (`%25`) so the decode
 *  lands back on the character the file actually carries.
 *
 *  Only characters outside the URL "unreserved" set are touched, which
 *  is the whole difference between the name on disk and the name in the
 *  attribute: `decodeURIComponent` of the result is the file name. */
export function screenshotSrcUrl(fileName) {
	return String(fileName).replaceAll(/[^A-Za-z0-9._~-]/gu, (c) => encodeURIComponent(c));
}

/** The face URL a Google Fonts stylesheet points at, or null. */
export function fontFaceUrl(css) {
	return css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)?.[1] ?? null;
}

const FONT_STYLESHEET =
	'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400&display=swap';

/** Deadline for the reachability probe itself. The probe runs before the
 *  browser launches and carries no page-level timeout, so a network that
 *  accepts the connection and never finishes the response (a half-open
 *  connection to Google Fonts or a proxy in between) would stall the
 *  whole measurement on Node's default fetch timeout instead of producing
 *  the report this script promises: "the origin is not usable, here is the
 *  measurement anyway". */
export const ORIGIN_PROBE_TIMEOUT_MS = 10_000;

/** `fetch` with an explicit deadline, so no probe can outlive it. */
export async function fetchWithDeadline(url, init = {}, timeoutMs = ORIGIN_PROBE_TIMEOUT_MS) {
	return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

/**
 * Is the webfont pipeline actually usable from this host?
 *
 * Both hosts are checked, not just the stylesheet one. A network that
 * lets `fonts.googleapis.com` through while blocking `fonts.gstatic.com`
 * answers "reachable" for the CSS alone, and then `baseline` and
 * `slow-font` would be recorded as real swap measurements while the page
 * is really running on the platform fallback — and the wait for a swap
 * would burn its whole budget on every run. So the probe follows the
 * stylesheet to the face it references and asks for that too.
 *
 * Both requests carry the probe deadline, so an origin that accepts the
 * connection and never answers is reported as unreachable instead of
 * hanging the measurement.
 */
async function fontOriginReachable() {
	try {
		const css = await fetchWithDeadline(FONT_STYLESHEET, {
			method: 'GET',
			redirect: 'follow',
		});
		if (!css.ok) return { reachable: false, status: `stylesheet HTTP ${css.status}` };
		const face = fontFaceUrl(await css.text());
		if (!face) {
			return { reachable: false, status: 'stylesheet exposed no fonts.gstatic.com face URL' };
		}
		const faceResponse = await fetchWithDeadline(face, {
			method: 'HEAD',
			redirect: 'follow',
		});
		if (!faceResponse.ok) return { reachable: false, status: `face HTTP ${faceResponse.status}` };
		return {
			reachable: true,
			status: `stylesheet HTTP ${css.status} + face HTTP ${faceResponse.status}`,
		};
	} catch (error) {
		const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
		return {
			reachable: false,
			status: timedOut ? `probe timed out after ${ORIGIN_PROBE_TIMEOUT_MS}ms` : error.message,
		};
	}
}

function hostInfo() {
	const list = cpus();
	return {
		platform: platform(),
		arch: arch(),
		kernel: release(),
		cpuModel: list[0]?.model ?? 'unknown',
		cpuCount: list.length,
		totalMemGB: Math.round(totalmem() / 1024 / 1024 / 1024),
	};
}

async function sourceInfo() {
	const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
	return {
		sha: git(['rev-parse', 'HEAD']),
		branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
		dirty: (git(['status', '--porcelain']) ?? '') !== '',
		version: pkg.version,
	};
}

const SCENARIOS = [
	{ name: 'baseline', blocked: false, delayMs: 0, cpuThrottle: 1 },
	{ name: 'blocked', blocked: true, delayMs: 0, cpuThrottle: 1 },
	{ name: 'slow-font', blocked: false, delayMs: null, cpuThrottle: CPU_THROTTLE_RATE },
];

async function main(argv) {
	const options = parseArgs(argv);
	if (options.help) {
		process.stdout.write(USAGE);
		return 0;
	}
	const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
	const origin = await fontOriginReachable();
	const outDir = resolve(repoRoot, options.outDir);
	await mkdir(outDir, { recursive: true });

	if (!origin.reachable) {
		process.stderr.write(
			`[font-first-paint] WARNING: ${origin.status} — the webfont pipeline is not fully reachable from this host.\n  baseline / slow-font rows will report the platform fallback, not a real webfont swap, and the font origin is aborted in EVERY scenario so no navigation waits on a stylesheet that may never answer.\n`,
		);
	}

	const browser = await chromium.launch({ headless: options.headless });
	const runs = [];
	try {
		for (const route of options.routes) {
			for (const scenario of SCENARIOS) {
				runs.push(
					await measureRun({
						browser,
						baseUrl: options.baseUrl,
						route,
						scenario,
						options,
						outDir,
						// When the origin is unreachable no swap can ever
						// happen, so waiting for one would only add the
						// timeout to every run.
						expectSwap: origin.reachable && !scenario.blocked,
						// An unusable origin aborts every scenario, not
						// only `blocked`: the page would otherwise wait on
						// a third-party stylesheet that may never answer
						// and never reach the fallback report its warning
						// promises.
						originReachable: origin.reachable,
					}),
				);
			}
		}
	} finally {
		await browser.close();
	}

	const report = {
		tool: 'scripts/font-first-paint-measure.mjs',
		issue: '#485',
		// The real invocation, not a canned string: an artefact that
		// does not say which origin, which routes and which
		// `--compare` input it came from cannot be told apart from
		// another run of the same command on another port.
		command: `pnpm run perf:fonts:measure${argv.length > 0 ? ` -- ${argv.map(shellQuote).join(' ')}` : ''}`,
		argv: [...argv],
		generatedAtNote:
			'Measurement only. No threshold is enforced here; budget + release gate belong to Issue #386.',
		capturedAt: new Date().toISOString(),
		environment: {
			baseUrl: options.baseUrl,
			routes: options.routes.join(', '),
			compareSource: options.compare ?? '— (no --compare)',
			browser: {
				name: 'chromium',
				version: browser.version ? browser.version() : 'unknown',
				playwright: pkg.devDependencies?.['@playwright/test'] ?? 'unknown',
				mode: options.headless ? 'headless' : 'headed',
			},
			viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
			fontOriginReachable: origin.reachable,
			fontOriginStatus: origin.status,
			// True when every run aborted the font origin because the
			// probe failed, so a reader knows the swap timings are absent
			// by construction rather than by chance.
			fontOriginAbortedInEveryScenario: !origin.reachable,
			network: {
				throttling: 'none (default Chromium) except the slow-font scenario font delay',
				fontDelayMs: options.fontDelayMs,
			},
			cpu: { throttleRate: CPU_THROTTLE_RATE },
			host: hostInfo(),
			source: await sourceInfo(),
		},
		runs,
	};

	if (options.compare) {
		const before = JSON.parse(await readFile(resolve(repoRoot, options.compare), 'utf8'));
		report.comparison = compareRuns(before, report);
		// The comparison carries the before capture's own conditions and
		// invocation, so a pair measured under different conditions can
		// be told apart from a pair measured the same way twice.
		report.compare = {
			path: options.compare,
			capturedAt: before.capturedAt ?? null,
			command: before.command ?? null,
			argv: Array.isArray(before.argv) ? before.argv : [],
			environment: before.environment ?? null,
		};
		report.compareConditionDifferences = compareConditionDifferences(
			before.environment,
			report.environment,
		);
		for (const difference of report.compareConditionDifferences) {
			process.stderr.write(
				`[font-first-paint] WARNING: the --compare capture was measured under different conditions — ${difference.condition}: before ${difference.before ?? 'unknown'}, after ${difference.after ?? 'unknown'}. The before/after numbers are not a like-for-like comparison.\n`,
			);
		}
	}

	const jsonPath = join(outDir, 'report.json');
	const htmlPath = join(outDir, 'report.html');
	await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
	await writeFile(htmlPath, renderReportHtml(report));

	for (const run of runs) {
		// `n/a` never gets a `ms` suffix: "n/ams" would read as a value.
		const ms = (value) => {
			const text = formatMetric(value);
			return text === 'n/a' ? text : `${text}ms`;
		};
		const verdict = run.fallback ? (run.fallback.ok ? 'readable' : 'NOT readable') : '—';
		process.stdout.write(
			`${run.route.padEnd(10)} ${run.scenario.padEnd(10)} ${ms(run.metrics.fcpMs).padStart(9)} ` +
				`${ms(run.metrics.lcpMs).padStart(9)} CLS=${formatMetric(run.metrics.cls)} ` +
				`${ms(run.metrics.fontSwapMs).padStart(10)} reqs=${run.metrics.fontRequests} ` +
				`aborted=${run.metrics.fontRequestsAborted} fallback=${verdict}\n`,
		);
		if (run.fallback && !run.fallback.ok) {
			for (const problem of run.fallback.problems) {
				process.stderr.write(`  [${run.route} ${run.scenario}] ${problem}\n`);
			}
		}
	}
	process.stdout.write(`\nreport: ${jsonPath}\nreport: ${htmlPath}\n`);
	return 0;
}

async function measureRun({
	browser,
	baseUrl,
	route,
	scenario,
	options,
	outDir,
	expectSwap,
	originReachable,
}) {
	const context = await browser.newContext({
		viewport: VIEWPORT,
		deviceScaleFactor: 1,
	});
	const page = await context.newPage();
	await page.addInitScript(collectorScript, WEBFONT_FAMILIES);

	const requestedDelayMs = scenario.name === 'slow-font' ? options.fontDelayMs : scenario.delayMs;
	const plan = fontOriginPlan({
		blocked: scenario.blocked,
		reachable: originReachable,
		delayMs: requestedDelayMs,
	});
	const delayMs = plan.delayMs;
	if (plan.abort || delayMs > 0) {
		await page.route(FONT_ORIGIN_PATTERNS[0], async (route) => {
			if (plan.abort) return route.abort('failed');
			await sleep(delayMs);
			return route.continue();
		});
		await page.route(FONT_ORIGIN_PATTERNS[1], async (route) => {
			if (plan.abort) return route.abort('failed');
			await sleep(delayMs);
			return route.continue();
		});
	}

	const cdp = await context.newCDPSession(page);
	if (scenario.cpuThrottle > 1) {
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: scenario.cpuThrottle });
	}

	const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'load', timeout: 60_000 });
	if (!response || !response.ok()) {
		const status = response ? response.status() : 'no response';
		await context.close();
		throw new Error(
			`font-first-paint-measure: GET ${baseUrl}${route} returned ${status} — the measurement is impossible, refusing to report a fallback for an unrenderable page`,
		);
	}

	// Let fonts settle (resolves immediately when the origin was blocked
	// or unreachable), then hold the page still long enough for a late
	// layout-shift / LCP entry to land. The settle window opens only
	// once the swap instant is known: in `slow-font` the swap lands
	// ~3.8 s in, and a fixed window that closed before it would drop
	// the shift the swap caused.
	await page.evaluate(
		// `document.fonts.ready` never settles if a font request hangs
		// (a half-open connection to the origin), so the wait itself
		// carries the budget. Without it the run would stall before it
		// ever reached the point where it can report the swap as
		// absent.
		(timeoutMs) =>
			Promise.race([
				document.fonts.ready,
				new Promise((resolve) => setTimeout(resolve, timeoutMs)),
			]),
		SWAP_WAIT_TIMEOUT_MS,
	);
	if (expectSwap) {
		await page
			.waitForFunction(() => (window.__fontFirstPaint?.webFontSwapAt ?? null) !== null, null, {
				timeout: SWAP_WAIT_TIMEOUT_MS,
				polling: 50,
			})
			.catch(() => {
				// The swap never landed inside the budget. `fontSwapMs`
				// stays absent (`null`, rendered as `n/a`) rather than
				// being invented, and the run still reports what it did
				// observe.
			});
	}
	await page.waitForTimeout(plan.abort ? BLOCKED_SETTLE_MS : SETTLE_MS);

	const observed = await page.evaluate(
		([selector, families]) => {
			const root = document.querySelector('#app-root') || document.body;
			const probes = [];
			for (const el of root.querySelectorAll(selector)) {
				if (probes.length >= 8) break;
				const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
				if (!text) continue;
				const rect = el.getBoundingClientRect();
				const style = getComputedStyle(el);
				// `display: none` — on the element OR on any ancestor — is
				// chrome hidden BY DESIGN at this viewport (the closed
				// mobile panel, the mobile-only menu button on desktop).
				// It is not a readability failure, so it is not probed at
				// all. `checkVisibility()` is the ancestor-aware test; a
				// *rendered* element with a zero-size box still is a
				// failure and `evaluateFallbackReadability` fails it.
				if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) continue;
				const colorMatch = style.color.match(/rgba?\(([^)]+)\)/);
				const parts = colorMatch
					? colorMatch[1].split(',').map((n) => Number(n.trim()))
					: [0, 0, 0, 0];
				probes.push({
					tag: el.tagName.toLowerCase(),
					textSample: text.slice(0, 40),
					rectWidth: Math.round(rect.width),
					rectHeight: Math.round(rect.height),
					display: style.display,
					visibility: style.visibility,
					opacity: Number(style.opacity),
					color: style.color,
					colorAlpha: parts.length > 3 ? parts[3] : 1,
					fontFamily: style.fontFamily.split(',')[0].replaceAll('"', ''),
				});
			}
			const state = window.__fontFirstPaint ?? {};
			if (state.fontPoll) clearInterval(state.fontPoll);
			// `document.fonts.check()` answers for SYSTEM fonts too, so it
			// returns `true` even when no @font-face was ever parsed — it
			// cannot tell "webfont loaded" from "no webfont requested".
			// The FontFaceSet can: a webfont face that exists and is
			// `loaded` is a webfont that arrived.
			const faces = [...document.fonts].map((face) => ({
				family: String(face.family || '').replaceAll('"', ''),
				weight: face.weight,
				status: face.status,
			}));
			return {
				probes,
				fontStatus: document.fonts.status,
				fontFaceCount: faces.length,
				webFaceCount: faces.filter((f) => families.includes(f.family)).length,
				loadedWebFaceCount: faces.filter(
					(f) => families.includes(f.family) && f.status === 'loaded',
				).length,
				webFontAvailable: faces.some((f) => families.includes(f.family) && f.status === 'loaded'),
				fcp: state.fcp,
				lcp: state.lcp,
				lcpElement: state.lcpElement,
				fontsReadyAt: state.fontsReadyAt,
				webFontSwapAt: state.webFontSwapAt,
				clsEntries: state.clsEntries,
				fontResources: state.fontResources,
			};
		},
		[PROBE_SELECTOR, WEBFONT_FAMILIES],
	);

	const shift = cumulativeLayoutShift(observed.clsEntries ?? []);
	const fonts = summarizeFontResources(observed.fontResources ?? []);
	const fallback = plan.abort
		? evaluateFallbackReadability({
				probes: observed.probes ?? [],
				webFontAvailable: observed.webFontAvailable,
				blocked: true,
			})
		: null;

	let screenshot = null;
	if (options.screenshots) {
		const file = screenshotFileName(route, scenario.name);
		await page.screenshot({ path: join(outDir, file), fullPage: false });
		screenshot = file;
	}
	await context.close();

	return {
		route,
		scenario: scenario.name,
		conditions: {
			// True for the `blocked` scenario AND for every scenario when
			// the pre-flight probe found the origin unusable, so the row
			// says which of the two it was.
			fontOriginBlocked: plan.abort,
			fontOriginBlockedBy: plan.reason,
			fontDelayMs: delayMs,
			cpuThrottleRate: scenario.cpuThrottle,
			fontStatus: observed.fontStatus,
			webFontAvailable: observed.webFontAvailable,
			webFontFaces: observed.webFaceCount,
			loadedWebFontFaces: observed.loadedWebFaceCount,
		},
		metrics: {
			fcpMs: round3(observed.fcp ?? null),
			lcpMs: round3(observed.lcp ?? null),
			lcpElement: observed.lcpElement ?? null,
			cls: shift.cls,
			clsEntries: shift.count,
			worstShift: shift.worst,
			fontSwapMs: round3(observed.webFontSwapAt ?? null),
			fontRequests: fonts.requests,
			fontRequestsAborted: fonts.abortedRequests,
			fontTransferBytes: fonts.transferBytes,
			slowestFontResponseMs: fonts.slowestMs,
		},
		layoutShiftSources: (observed.clsEntries ?? [])
			.sort((a, b) => b.value - a.value)
			.slice(0, 2)
			.map((entry) => ({
				value: round3(entry.value),
				startTimeMs: round3(entry.startTime),
				sources: entry.sources ?? [],
			})),
		fallback,
		screenshot,
	};
}

/**
 * Whether one run aborts the font origin, and how long a delivered
 * response is held instead.
 *
 * `blocked` is the scenario that asks for it. `reachable: false` is the
 * pre-flight probe's verdict, and it has to abort in EVERY scenario:
 * the page's async stylesheet is `media="print"`, which does not block
 * rendering but does keep the document's `load` event pending, so an
 * origin that accepts the connection and never answers makes
 * `page.goto(..., { waitUntil: 'load' })` run into its 60 s timeout
 * before the bounded `document.fonts.ready` wait — the code path that
 * reports a swap as unavailable — is ever reached. The warning the
 * script prints for an unreachable origin therefore promises a
 * platform-fallback report; aborting is what makes that report exist
 * instead of an exception.
 *
 * `delayMs` is the per-response hold for the `slow-font` scenario, which
 * is meaningless once the request is aborted.
 */
export function fontOriginPlan({ blocked, reachable, delayMs }) {
	if (blocked) return { abort: true, delayMs: 0, reason: 'scenario' };
	if (!reachable) return { abort: true, delayMs: 0, reason: 'unreachable-probe' };
	return { abort: false, delayMs: delayMs > 0 ? delayMs : 0, reason: null };
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

// ESM main-module guard: importing this file for unit tests must not
// launch a browser (same pattern as scripts/check-release-assets.mjs).
if (import.meta.url === `file://${process.argv[1]}`) {
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(error) => {
			process.stderr.write(`[font-first-paint] FAIL: ${error.message}\n`);
			process.exit(2);
		},
	);
}
