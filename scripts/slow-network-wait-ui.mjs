#!/usr/bin/env node
/**
 * slow-network-wait-ui — measure what the visitor actually sees while a
 * page is still being fetched, under an emulated Slow 4G link and a 4x
 * CPU throttle (Issue #489).
 *
 * What this measures, and what it deliberately does not
 * ----------------------------------------------------
 * MEASURED: three things a visitor can be shown while a request is in
 * flight, on representative surfaces:
 *
 *   1. `route-pending` — client-side navigations whose route code is
 *      still being downloaded. For every navigation: how long the
 *      outlet showed NOTHING (blank), how long it showed a waiting
 *      affordance (information), and how long it kept showing the
 *      PREVIOUS page (stale) while the URL had already changed.
 *   2. `route-stall`   — the same navigation with a long stall. Same
 *      per-sample classification, plus: does the waiting surface still
 *      publish a retry control at the end of a long wait, and does
 *      following that control actually deliver the page?
 *   3. `cold-load`     — a cold document load of `/`, `/portfolio` and
 *      `/tools` (first contentful paint, and whether the destination
 *      marker ever appeared at all).
 *
 * NOT MEASURED: a Lighthouse score, a Core Web Vitals budget, or any
 * other pass/fail quality GATE. Threshold ownership is Issue #384
 * (reproducible Lighthouse command) / #385 (the release gate) / #386
 * (CWV budgets); this ticket is measurement plus ONE element fix, and
 * conflating measurement, visualisation and gate is exactly what #489
 * forbids. The command is deliberately NOT wired into `validate:*` —
 * see "Impact on quality/profile.yaml" in
 * `docs/verification/perf/slow-network-state.md`.
 *
 * Why the stall is INJECTED instead of waited for
 * -----------------------------------------------
 * The shipped page settles in a few hundred milliseconds on a loopback
 * preview, so "Slow 4G" alone produces a wait too short to sample and a
 * report that flatters the build. The harness therefore DELAYS the route
 * chunk by an explicit, recorded amount (`--chunk-delay`, default 4000
 * ms; `--stall-ms`, default 12000 ms for the stall leg) through
 * Playwright routing. The delay is reported next to the numbers, so a
 * reader always knows the wait was manufactured, not observed.
 *
 * Production is never touched: local `vite preview`, local D1 state only
 * (migrations + skeleton seed, the same pair `scripts/e2e-local-bootstrap.mjs`
 * applies before Playwright starts), no secret value read or printed,
 * nothing deployed.
 *
 * Usage:
 *   node scripts/slow-network-wait-ui.mjs [options]
 *
 *   --cycles=<n>         client-side navigations in the `route-pending` leg
 *                        (default 3)
 *   --port=<n>           preview server port (default 15952)
 *   --cpu-throttle=<n>   CDP CPU throttling rate (default 4)
 *   --chunk-delay=<ms>   injected delay on the tool-detail route chunk
 *                        (default 4000)
 *   --stall-ms=<ms>      injected delay for the `route-stall` leg
 *                        (default 12000)
 *   --base-url=<url>     measure an ALREADY RUNNING server; must be a
 *                        loopback origin unless --allow-remote is given
 *   --allow-remote       accept a non-loopback --base-url
 *   --json-out=<path>    report destination
 *                        (default .tmp/slow-network-wait-ui/report.json)
 *   --screenshot=<path>  committed capture destination
 *                        (default docs/verification/perf/slow-network-state.webp)
 *   --compare=<path>     a BEFORE report.json to render as a comparison
 *   --no-screenshot      skip the capture
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, platform as osPlatform, release as osRelease } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { applyMigrations } from './_d1.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Sampling cadence of the outlet probe, in milliseconds.
 *
 * 100 ms is fine enough that a 1 s feedback threshold cannot be crossed
 * unnoticed, and coarse enough that a 4x CPU throttle does not spend the
 * measurement inside `page.evaluate`.
 */
export const SAMPLE_INTERVAL_MS = 100;

/**
 * How long a wait may run before the visitor must be TOLD something.
 *
 * This is NOT an invented latency budget: it is the framework's own
 * `defaultPendingMs` (TanStack Router keeps the previous lane on screen
 * for that long before it offers a pending surface). Waiting longer than
 * the framework's own threshold while showing nothing is what makes a
 * slow network indistinguishable from a broken page, so the harness
 * measures against the same number the router uses.
 */
export const FEEDBACK_AFTER_MS = 1000;

/**
 * Budget for a cold document load on the emulated Slow 4G + 4x CPU
 * profile. Generous on purpose: this is a "did the page ever arrive"
 * question, not a performance budget (Issue #386 owns budgets).
 */
export const COLD_LOAD_BUDGET_MS = 30_000;

/**
 * Committed captures are WebP: width cap, quality, size budget.
 *
 * Chromium can only write PNG, and the Issue names a `.png` path, but a
 * verification artefact does not justify a large binary in the tree. The
 * capture is converted with `sharp` and the temporary PNG is deleted; the
 * committed file is the `.webp` sibling of the Issue's path (the
 * substitution is stated in the PR body and in
 * `docs/verification/perf/slow-network-state.md`).
 */
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

/**
 * How the outlet is classified for ONE sample (pure).
 *
 * The three questions a visitor can be shown while a request is in
 * flight, kept separate because they fail differently:
 *
 *   - `settled`  the destination route rendered (its marker is present)
 *   - `waiting`  a waiting surface is on screen — the visitor is told
 *     something and offered a way out
 *   - `content`  something is on screen but it is NOT the destination:
 *                the previous page under a URL that already changed
 *   - `blank`    nothing is on screen at all
 *
 * `blank` is the defect the Issue names ("画面が永続白紙にならず").
 * `content` is the second-order defect: a stale page reads as "the click
 * did nothing", which under a slow link is indistinguishable from a
 * frozen site.
 *
 * @param {{ settled: boolean, waiting: boolean, visibleContent: boolean }} sample
 * @returns {'settled' | 'waiting' | 'content' | 'blank'}
 */
export function classifySample(sample) {
	if (sample?.settled) return 'settled';
	if (sample?.waiting) return 'waiting';
	if (sample?.visibleContent) return 'content';
	return 'blank';
}

/**
 * Turn a navigation's samples into the numbers the Issue asks for
 * (pure).
 *
 * `blankMs` / `staleMs` / `feedbackMs` are the wall-clock time spent in
 * each class, measured between consecutive samples, so a 100 ms cadence
 * over a 4 s wait reports roughly 4000 ms rather than 41 samples. The
 * wait window itself runs from the click to the first `settled` sample;
 * samples after the destination appeared are not part of it, and a
 * navigation that never settled is reported as `settled: false` so it
 * cannot be averaged away.
 *
 * `uninformedAfterThresholdMs` is the acceptance-criterion number: time
 * spent inside the wait AFTER `feedbackAfterMs` during which the visitor
 * was shown neither a waiting surface nor the destination.
 *
 * @param {Array<Record<string, unknown>>} samples
 * @param {{ feedbackAfterMs?: number }} [options]
 */
export function describeWaitWindow(samples, { feedbackAfterMs = FEEDBACK_AFTER_MS } = {}) {
	const list = Array.isArray(samples) ? samples : [];
	if (list.length === 0) {
		return {
			samples: 0,
			settled: false,
			blankMs: 0,
			staleMs: 0,
			feedbackMs: 0,
			settledAtMs: null,
			uninformedAfterThresholdMs: 0,
			classes: [],
		};
	}
	const classes = list.map((sample) => classifySample(sample));
	const settleIndex = classes.indexOf('settled');
	const windowSamples = settleIndex === -1 ? list : list.slice(0, settleIndex + 1);
	const windowClasses = settleIndex === -1 ? classes : classes.slice(0, settleIndex + 1);
	let blankMs = 0;
	let staleMs = 0;
	let feedbackMs = 0;
	let uninformedAfterThresholdMs = 0;
	for (let index = 0; index < windowClasses.length; index += 1) {
		const state = windowClasses[index];
		// The destination marker is the end of the wait, not a state
		// the visitor sat through.
		if (state === 'settled') break;
		const elapsed = Number(windowSamples[index].elapsedMs ?? 0);
		const next =
			index + 1 < windowSamples.length
				? Number(windowSamples[index + 1].elapsedMs ?? elapsed)
				: elapsed;
		// Each sample is credited with the interval that FOLLOWS it: what
		// the visitor saw between two samples is the state observed at
		// the START of that interval. Attributing the preceding interval
		// instead would credit a state change to the interval before it,
		// and a late surface would look like it appeared earlier than it
		// did.
		const duration = Math.max(0, next - elapsed);
		if (state === 'blank') {
			blankMs += duration;
		} else if (state === 'content') {
			staleMs += duration;
		} else if (state === 'waiting') {
			feedbackMs += duration;
		}
		if (state !== 'waiting' && elapsed > feedbackAfterMs) {
			uninformedAfterThresholdMs += duration;
		}
	}
	return {
		samples: list.length,
		settled: settleIndex !== -1,
		blankMs,
		staleMs,
		feedbackMs,
		settledAtMs: settleIndex === -1 ? null : Number(list[settleIndex].elapsedMs ?? 0),
		uninformedAfterThresholdMs,
		classes: windowClasses,
	};
}

/**
 * Evaluate one navigation against the documented criteria (pure).
 *
 * Three criteria, each of which can fail on its own:
 *
 *   C1 `blankMs === 0` — the outlet must never be empty during a wait.
 *   C2 `uninformedAfterThresholdMs === 0` — once the wait passes the
 *      framework's own `pendingMs`, the visitor must be shown a waiting
 *      surface. Showing the previous page instead is C2's failure: the
 *      URL has already changed, so a stale page under a new URL is a
 *      silent failure, not continuity.
 *   C3 the navigation settled at all. A wait that never resolves is not
 *      a slow network; recording it as "0 ms of blank" would be a lie.
 *
 * Returns the failures rather than throwing so the caller can still write
 * the report — a FAIL report is the useful artefact.
 *
 * @param {Array<Record<string, unknown>>} samples
 * @param {{ label?: string, feedbackAfterMs?: number }} [options]
 */
export function evaluateWaitWindow(samples, { label = 'navigation', feedbackAfterMs } = {}) {
	const window = describeWaitWindow(samples, { feedbackAfterMs });
	const failures = [];
	if (window.samples === 0) {
		failures.push(`${label}: no samples were recorded — nothing was measured`);
	}
	if (window.samples > 0 && !window.settled) {
		failures.push(`${label}: the navigation never settled inside the measurement window`);
	}
	if (window.blankMs > 0) {
		failures.push(`${label}: the outlet was blank for ${window.blankMs}ms during the wait`);
	}
	if (window.uninformedAfterThresholdMs > 0) {
		failures.push(
			`${label}: no waiting surface for ${window.uninformedAfterThresholdMs}ms after the ${feedbackAfterMs ?? FEEDBACK_AFTER_MS}ms feedback threshold (stale previous page: ${window.staleMs}ms)`,
		);
	}
	return { pass: failures.length === 0, failures, ...window };
}

/**
 * Whether the retry control a waiting surface publishes actually
 * delivers the page (pure).
 *
 * The affordance is only a promise until it is followed, so the harness
 * records three facts after clicking it: the control existed, its href
 * was the destination the visitor asked for, and the browser ended up on
 * that destination WITH its content rendered. A control that exists but
 * cannot work is worse than no control — it teaches visitors to press
 * buttons that do nothing.
 *
 * @param {{ present: boolean, href: string | null, expectedPath: string, navigated: boolean, markerAfter: boolean }} outcome
 */
export function evaluateRetryOutcome(outcome) {
	const failures = [];
	if (!outcome?.present) {
		failures.push('the waiting surface published no retry control');
	} else if (!outcome.href) {
		failures.push('the retry control has no href');
	} else if (outcome.href !== outcome.expectedPath) {
		failures.push(
			`the retry control points at ${outcome.href}, not the destination the visitor asked for (${outcome.expectedPath})`,
		);
	}
	if (outcome?.present && outcome.href && !outcome.navigated) {
		failures.push('following the retry control did not produce a new document');
	}
	if (outcome?.navigated && !outcome.markerAfter) {
		failures.push('the retry navigation completed but the destination content never rendered');
	}
	return { ...outcome, pass: failures.length === 0, failures };
}

/**
 * Evaluate one cold document load (pure).
 *
 * The only question a browser can answer for a visitor who typed a URL:
 * did the page arrive? `painted` records that the first contentful paint
 * exists, `settled` that the destination marker rendered. Both are
 * recorded with their real numbers so a reader can see the shape of the
 * wait, not a pass/fail with no context.
 *
 * @param {{ path: string, fcpMs: number | null, markerAtMs: number | null, budgetMs: number }} load
 */
export function evaluateColdLoad(load) {
	const failures = [];
	const budget = load?.budgetMs ?? COLD_LOAD_BUDGET_MS;
	if (load?.fcpMs === null || load?.fcpMs === undefined) {
		failures.push(`${load?.path}: nothing was painted`);
	}
	if (load?.markerAtMs === null || load?.markerAtMs === undefined) {
		failures.push(`${load?.path}: the page never reached its settled state`);
	}
	const observed = load?.markerAtMs ?? load?.fcpMs ?? null;
	if (observed !== null && observed > budget) {
		failures.push(`${load?.path}: ${observed}ms to the marker, over the ${budget}ms budget`);
	}
	return { pass: failures.length === 0, failures, ...load };
}

/**
 * Verdict over every leg (pure).
 *
 * A leg that could not run (`skipped`, with a recorded reason) is not a
 * pass: the profile is `INCOMPLETE`, because one of the journeys the
 * Issue names was never measured. A `pageerror` during the run is a
 * failure too — a render crash must never read as a green report.
 *
 * @param {{ pending?: object, stall?: object, coldLoads?: object, pageErrors?: string[] }} legs
 */
export function evaluateProfile(legs, { pageErrors = [] } = {}) {
	const verdicts = {};
	const failures = [];
	const skipped = [];
	for (const [name, leg] of Object.entries(legs ?? {})) {
		if (leg?.skipped) {
			verdicts[name] = { pass: null, skipped: true, reason: leg.skippedReason };
			skipped.push(name);
			continue;
		}
		const legFailures = Array.isArray(leg?.failures) ? leg.failures : [];
		verdicts[name] = { pass: legFailures.length === 0, failures: legFailures };
		failures.push(...legFailures);
	}
	for (const error of pageErrors ?? []) {
		failures.push(`page error during measurement: ${error}`);
	}
	const status = failures.length > 0 ? 'FAIL' : skipped.length > 0 ? 'INCOMPLETE' : 'PASS';
	return {
		pass: status === 'PASS',
		status,
		complete: skipped.length === 0,
		failures,
		verdicts,
		skipped,
	};
}

/**
 * Add a failure to an already-computed verdict (pure).
 *
 * `evaluateProfile` runs before the comparison is read, so a broken
 * `--compare` input has to be folded into the verdict afterwards without
 * recomputing the criteria.
 *
 * @param {{ pass: boolean, status: string, failures: string[] }} verdict
 * @param {string} comparePath
 * @param {string} error
 */
export function withCompareFailure(verdict, comparePath, error) {
	const failures = [
		...verdict.failures,
		`--compare input could not be read: ${comparePath} (${error})`,
	];
	return { ...verdict, pass: false, status: 'FAIL', failures };
}

/**
 * Whether an origin is a loopback target (pure).
 *
 * The harness clicks real navigation controls against a real server, so a
 * non-loopback `--base-url` can mutate a shared or production database
 * while the report still records `productionTouched: false`. A remote
 * target is therefore an explicit opt-in, never the default.
 */
export function isLoopbackOrigin(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
	const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
	if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
	if (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') return true;
	const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
	if (!ipv4) return false;
	const octets = ipv4.slice(1).map(Number);
	if (octets.some((octet) => octet > 255)) return false;
	return octets[0] === 127;
}

/**
 * Compare the measurement conditions of the current run with a BEFORE
 * report (pure). Different browser / CPU throttle / network / viewport /
 * injected delay make a before/after pair non-comparable, so the report
 * must say so instead of drawing the two rows as if they shared a
 * baseline.
 */
export function compareMeasurementConditions(current, before) {
	const mismatches = [];
	const check = (field, currentValue, beforeValue) => {
		if (currentValue !== beforeValue) {
			mismatches.push({ field, current: currentValue ?? null, before: beforeValue ?? null });
		}
	};
	check('browser', current?.environment?.browser, before?.environment?.browser);
	check(
		'cpuThrottlingRate',
		current?.environment?.cpuThrottlingRate,
		before?.environment?.cpuThrottlingRate,
	);
	check(
		'networkProfile',
		current?.environment?.networkProfile?.label,
		before?.environment?.networkProfile?.label,
	);
	check('viewport', current?.environment?.viewport, before?.environment?.viewport);
	check(
		'deviceScaleFactor',
		current?.environment?.deviceScaleFactor,
		before?.environment?.deviceScaleFactor,
	);
	check('surface', current?.environment?.surface, before?.environment?.surface);
	check('chunkDelayMs', current?.options?.chunkDelayMs, before?.options?.chunkDelayMs);
	check('stallMs', current?.options?.stallMs, before?.options?.stallMs);
	check('cycles', current?.options?.cycles, before?.options?.cycles);
	return { comparable: mismatches.length === 0, mismatches };
}

/** Parse the documented CLI surface. Exported for unit tests. */
export function parseArgs(argv) {
	const options = {
		cycles: 3,
		port: 15952,
		cpuThrottle: 4,
		chunkDelayMs: 4000,
		stallMs: 12_000,
		baseUrl: null,
		jsonOut: '.tmp/slow-network-wait-ui/report.json',
		screenshot: 'docs/verification/perf/slow-network-state.webp',
		compare: null,
		allowRemote: false,
		noScreenshot: false,
	};
	for (const arg of argv) {
		// `pnpm run perf:wait:ui -- --cycles=3` forwards a bare `--`
		// separator; the documented invocation style uses it, so it is
		// consumed rather than rejected as an unknown option.
		if (arg === '--') continue;
		const [key, value] = arg.replace(/^--/, '').split('=');
		switch (key) {
			case 'cycles':
				options.cycles = Number(value);
				break;
			case 'port':
				options.port = Number(value);
				break;
			case 'cpu-throttle':
				options.cpuThrottle = Number(value);
				break;
			case 'chunk-delay':
				options.chunkDelayMs = Number(value);
				break;
			case 'stall-ms':
				options.stallMs = Number(value);
				break;
			case 'base-url':
				options.baseUrl = value;
				break;
			case 'json-out':
				options.jsonOut = value;
				break;
			case 'screenshot':
				options.screenshot = value;
				break;
			case 'compare':
				options.compare = value;
				break;
			case 'allow-remote':
				options.allowRemote = true;
				break;
			case 'no-screenshot':
				options.noScreenshot = true;
				break;
			default:
				throw new Error(`unknown option: ${arg}`);
		}
	}
	if (!Number.isInteger(options.cycles) || options.cycles < 1) {
		throw new Error('--cycles must be an integer >= 1 (no navigation measures nothing)');
	}
	if (!Number.isFinite(options.chunkDelayMs) || options.chunkDelayMs < 0) {
		throw new Error('--chunk-delay must be a non-negative number of milliseconds');
	}
	if (!Number.isFinite(options.stallMs) || options.stallMs <= 0) {
		throw new Error('--stall-ms must be a positive number of milliseconds');
	}
	if (options.stallMs <= FEEDBACK_AFTER_MS) {
		throw new Error(
			`--stall-ms must exceed the ${FEEDBACK_AFTER_MS}ms feedback threshold, otherwise the stall leg cannot measure a post-threshold wait`,
		);
	}
	if (options.baseUrl) {
		if (!/^https?:\/\//i.test(options.baseUrl)) {
			throw new Error('--base-url must be an http(s) URL');
		}
		if (!options.allowRemote && !isLoopbackOrigin(options.baseUrl)) {
			throw new Error(
				'--base-url must be a loopback origin (localhost / 127.0.0.0/8 / [::1]); pass --allow-remote to measure a non-loopback target explicitly',
			);
		}
	}
	return options;
}

/**
 * Representative surfaces and the marker that proves a route rendered.
 *
 * A marker is a selector that only exists once the route's own content
 * is in the document, so "settled" is never inferred from the URL. The
 * URL changes at the START of a client-side navigation, which is exactly
 * why a URL-only check would report a wait as finished.
 */
export const ROUTE_MARKERS = Object.freeze({
	'/': { selector: '#app-root h1', label: 'home hero heading' },
	'/portfolio': { selector: '#main h1', label: 'portfolio list heading' },
	'/tools': { selector: '#app-root h1', label: 'tools index heading' },
	'/tools/prototype': {
		selector: 'iframe[src*="/tools/prototype/app/"]',
		label: 'ProtoType embed frame',
	},
	'/tools/readmark': {
		selector: 'iframe[src*="/tools/readmark/app/"]',
		label: 'readmark embed frame',
	},
});

/** The tool detail routes the client-side legs navigate to, in order. */
export const TOOL_DETAIL_PATHS = Object.freeze(['/tools/prototype', '/tools/readmark']);

/**
 * The browser-side outlet probe.
 *
 * Passed to `page.evaluate` as a real function, so it is serialised by
 * Playwright rather than string-injected. It answers exactly the three
 * questions `classifySample` needs, and nothing else: what the URL says,
 * whether the destination marker rendered, whether the outlet has visible
 * content at all, and whether a waiting surface is on screen (with its
 * retry control, if it has one).
 */
async function probeOutlet(page, markerSelector) {
	return page.evaluate((selector) => {
		const visible = (element) => {
			if (!element || element.getClientRects().length === 0) return false;
			const style = window.getComputedStyle(element);
			return style.visibility !== 'hidden' && style.display !== 'none';
		};
		const outlet =
			document.getElementById('app-root') ?? document.querySelector('#main') ?? document.body;
		// The measurement panel injected for the capture is NOT site
		// content; it must never be mistaken for a waiting surface or
		// for the visitor's own page.
		const panel = document.getElementById('issue-489-measurement-panel');
		const waitingNodes = Array.from(
			document.querySelectorAll('[data-testid="waiting-state"], [role="status"]'),
		).filter((node) => !panel?.contains(node));
		const waiting = waitingNodes.some((node) => {
			if (!visible(node)) return false;
			return (node.innerText ?? '').trim().length > 0;
		});
		const retry = document.querySelector('[data-waiting-action="retry"]');
		const text = (outlet?.innerText ?? '').replace(/\s+/g, ' ').trim();
		return {
			path: location.pathname + location.search,
			settled: Boolean(document.querySelector(selector)),
			waiting,
			retryHref: retry ? retry.getAttribute('href') : null,
			waitingText: waitingNodes
				.map((node) => (node.innerText ?? '').replace(/\s+/g, ' ').trim())
				.join(' | ')
				.slice(0, 160),
			// "Something is on screen" counts elements, not just text:
			// the tool detail route renders an embed frame whose host
			// document has no text of its own.
			visibleContent:
				Boolean(outlet) &&
				visible(outlet) &&
				(text.length > 0 ||
					Array.from(outlet.querySelectorAll('iframe, img, video, main, section')).some(visible)),
			outletTextLen: text.length,
			outletChildren: outlet ? outlet.children.length : 0,
		};
	}, markerSelector);
}

/** Sample the outlet on a fixed cadence until the destination settles. */
async function sampleNavigation(page, { markerSelector, startedAt, timeoutMs, onSample }) {
	const samples = [];
	const deadline = startedAt + timeoutMs;
	// The first sample is taken synchronously after the click, so a wait
	// that is already over (a preloaded route) still records one honest
	// data point instead of an empty series.
	for (;;) {
		const elapsedMs = Math.round(performance.now() - startedAt);
		const probe = await probeOutlet(page, markerSelector);
		const sample = { elapsedMs, ...probe };
		samples.push(sample);
		if (onSample) await onSample(sample);
		// `performance.now()` on both sides: mixing it with `Date.now()`
		// would compare a monotonic origin against the epoch and end the
		// window after a single sample.
		if (probe.settled || performance.now() >= deadline) break;
		await page.waitForTimeout(SAMPLE_INTERVAL_MS);
	}
	return samples;
}

/**
 * Leg `route-pending` — N client-side navigations into a tool detail
 * route whose route chunk is delayed by `delayMs`.
 *
 * The click is a REAL mouse click on the tool card, not
 * `element.click()`: the shipped surface is a TanStack `<Link>`, and the
 * visitor's real input pipeline (hit-test, focus, router transition) is
 * what is being measured.
 */
async function runPendingLeg(page, { cycles, delayMs, chunkDelay, baseUrl }) {
	const pending = [];
	for (let cycle = 1; cycle <= cycles; cycle += 1) {
		const target = TOOL_DETAIL_PATHS[(cycle - 1) % TOOL_DETAIL_PATHS.length];
		const card = page.locator(`a[href="${target}"]`).first();
		if ((await card.count()) === 0) {
			return {
				skipped: true,
				skippedReason: `the tools index does not link to ${target} in this build`,
				series: [],
			};
		}
		chunkDelay.set({ delayMs });
		const startedAt = performance.now();
		await card.click({ timeout: 30_000 });
		const samples = await sampleNavigation(page, {
			markerSelector: ROUTE_MARKERS[target].selector,
			startedAt,
			timeoutMs: delayMs + 20_000,
		});
		pending.push({
			cycle,
			target,
			delayMs,
			samples,
			verdict: evaluateWaitWindow(samples, { label: `route-pending cycle ${cycle}` }),
		});
		// Each cycle starts from a FRESH document on purpose. Within one
		// SPA session the route module is already in the JavaScript
		// module registry, so only the first entry into a route pays the
		// download; later cycles would settle in ~40ms and would report a
		// clean wait that no visitor ever experiences. Playwright routing
		// disables the HTTP cache, so the reloaded document re-requests
		// the chunk and every cycle carries the same cold wait.
		await page.goto(`${baseUrl}/tools`, { waitUntil: 'load' });
		await waitForHydration(page);
	}
	const series = pending.flatMap((entry) => entry.samples);
	const failures = pending.flatMap((entry) => entry.verdict.failures);
	return {
		skipped: false,
		series,
		navigations: pending,
		verdict: evaluateWaitWindow(series, { label: 'route-pending' }),
		failures,
	};
}

/** Leg `route-stall` — one navigation that cannot answer for `stallMs`. */
async function runStallLeg(page, { delayMs, expectedPath, chunkDelay }) {
	chunkDelay.set({ delayMs });
	const startedAt = performance.now();
	const card = page.locator(`a[href="${expectedPath}"]`).first();
	if ((await card.count()) === 0) {
		return {
			skipped: true,
			skippedReason: `the tools index does not link to ${expectedPath} in this build`,
		};
	}
	await card.click({ timeout: 30_000 });
	let retryHref = null;
	// The stall is a plain response delay: it ends on its own after
	// `delayMs`, so the leg measures the shipped surface rather than a
	// request the harness never releases.
	const samples = await sampleNavigation(page, {
		markerSelector: ROUTE_MARKERS[expectedPath].selector,
		startedAt,
		timeoutMs: delayMs + 20_000,
		onSample: (sample) => {
			if (sample.waiting && sample.retryHref && !retryHref) retryHref = sample.retryHref;
		},
	});
	const verdict = evaluateWaitWindow(samples, { label: 'route-stall' });
	return {
		skipped: false,
		delayMs,
		target: expectedPath,
		samples,
		retryHref,
		verdict,
		failures: verdict.failures,
	};
}

/**
 * Does the retry control the waiting surface published deliver the page?
 *
 * Driven for real: a fresh stall is installed, the waiting surface is
 * allowed to appear, and the control is clicked. Because it is a plain
 * anchor, that click is a document navigation — the same thing a visitor
 * with scripting half-loaded, or no scripting at all, would get.
 */
async function verifyRetryRecovery(page, { stallMs, expectedPath, baseUrl, chunkDelay }) {
	chunkDelay.set({ delayMs: stallMs });
	await page.goto(`${baseUrl}/tools`, { waitUntil: 'load' });
	const control = page.locator('[data-waiting-action="retry"]').first();
	let outcome = {
		present: false,
		href: null,
		expectedPath,
		navigated: false,
		markerAfter: false,
	};
	try {
		const card = page.locator(`a[href="${expectedPath}"]`).first();
		await card.click({ timeout: 30_000 });
		await control.waitFor({ state: 'visible', timeout: Math.min(stallMs, 30_000) });
		const href = await control.getAttribute('href');
		outcome = { ...outcome, present: true, href };
		// A document identity, not the URL. The router has ALREADY
		// committed the destination location — that is exactly why the
		// waiting surface is up — so `page.url()` cannot tell "the retry
		// navigated" from "the URL was already this". The counter lives
		// in sessionStorage, which survives a client-side transition and
		// dies with the document, so a value above the stamp can only
		// come from a REAL document request.
		const stamp = await stampDocument(page);
		// Remove the injected delay before the click: the retry
		// re-requests the page as a document, and holding the chunk
		// would test the harness rather than the control.
		chunkDelay.set({ delayMs: 0 });
		await control.click({ timeout: 30_000 });
		await page.waitForLoadState('domcontentloaded', { timeout: 60_000 }).catch(() => {});
		outcome.navigated = (await readDocumentStamp(page)) > stamp;
		await page
			.locator(ROUTE_MARKERS[expectedPath].selector)
			.first()
			.waitFor({ state: 'visible', timeout: 30_000 })
			.catch(() => {});
		outcome.markerAfter = await page
			.locator(ROUTE_MARKERS[expectedPath].selector)
			.first()
			.isVisible()
			.catch(() => false);
	} catch (error) {
		outcome = { ...outcome, error: String(error?.message ?? error) };
	}
	return outcome;
}

/** Stamp the current document (see `verifyRetryRecovery`). */
async function stampDocument(page) {
	return page.evaluate(() =>
		Number.parseInt(sessionStorage.getItem('__slowNetworkWaitUiDocument') || '0', 10),
	);
}

/** Read the document stamp without creating a new one. */
async function readDocumentStamp(page) {
	return page.evaluate(() =>
		Number.parseInt(sessionStorage.getItem('__slowNetworkWaitUiDocument') || '0', 10),
	);
}

/**
 * Delay the tool-detail route chunk through a single route handler.
 *
 * Playwright routing also disables the HTTP cache for the context, so
 * every navigation re-requests the chunk instead of replaying it from
 * memory — the delay is therefore applied to each cycle, not only the
 * first. One handler with mutable state (rather than one registration per
 * cycle) keeps the injected delay from accumulating: Playwright stops at
 * the first handler that resolves the route, but two live registrations
 * would still make the measured wait depend on registration order.
 */
function installChunkDelay(page) {
	const state = { delayMs: 0, gate: null };
	page.route('**/assets/tools._slug-*.js', async (route) => {
		if (state.gate) await state.gate;
		if (state.delayMs > 0) await new Promise((r) => setTimeout(r, state.delayMs));
		await route.continue();
	});
	return {
		set({ delayMs }) {
			state.delayMs = delayMs;
			state.gate = null;
		},
		release() {
			state.gate = null;
		},
	};
}

/**
 * Document-identity stamp, installed before any application code runs.
 *
 * A client-side transition keeps the same `document`, and sessionStorage
 * survives it; a real document request re-runs this script, which
 * increments a counter the harness reads afterwards. That is the only
 * way to tell "the retry control delivered the page" from "the URL was
 * already this one" — the router commits the destination location BEFORE
 * it offers the waiting surface, so the URL cannot answer the question.
 */
export const DOCUMENT_STAMP_SOURCE = `(() => {
  const KEY = '__slowNetworkWaitUiDocument';
  try {
    const stored = Number.parseInt(sessionStorage.getItem(KEY) || '0', 10);
    sessionStorage.setItem(KEY, String(Number.isFinite(stored) ? stored + 1 : 1));
  } catch (error) {
    /* a blocked sessionStorage must not break the measurement */
  }
})();`;

/** A gate the chunk route handler can be parked on. */
function createGate() {
	let release = () => {};
	const promise = new Promise((resolveGate) => {
		release = resolveGate;
	});
	return { promise, release };
}

/** Leg `cold-load` — one cold document load per representative route. */
async function runColdLoads(context, { baseUrl, budgetMs, cpuThrottle, networkCondition }) {
	const loads = [];
	for (const path of ['/', '/portfolio', '/tools']) {
		const page = await context.newPage();
		// The CDP session is per-TARGET: a page created after the
		// emulation was installed on another page runs UNTHROTTLED, so
		// every cold load installs its own emulation or the leg reports
		// loopback timings under a "Slow 4G" label.
		const cdp = await context.newCDPSession(page);
		await cdp.send('Network.enable');
		await cdp.send('Network.emulateNetworkConditions', networkCondition);
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
		const startedAt = performance.now();
		try {
			// The marker is awaited ALONGSIDE the navigation, not after
			// it: `waitUntil: 'load'` also waits for the async font
			// stylesheet, so measuring the marker after `goto` would
			// report the document's load event as the moment the content
			// appeared.
			const markerAt = page
				.waitForSelector(ROUTE_MARKERS[path].selector, {
					state: 'attached',
					timeout: budgetMs,
				})
				.then(() => Math.round(performance.now() - startedAt))
				.catch(() => null);
			const response = await page.goto(`${baseUrl}${path}`, {
				waitUntil: 'load',
				timeout: budgetMs + 60_000,
			});
			const paints = await page.evaluate(() =>
				performance
					.getEntriesByType('paint')
					.map((entry) => ({ name: entry.name, startTime: Math.round(entry.startTime) })),
			);
			const fcp =
				paints.find((paint) => paint.name === 'first-contentful-paint')?.startTime ?? null;
			const navigationTiming = await page.evaluate(() => {
				const [entry] = performance.getEntriesByType('navigation');
				if (!entry) return null;
				return {
					responseStart: Math.round(entry.responseStart),
					responseEnd: Math.round(entry.responseEnd),
					domContentLoaded: Math.round(entry.domContentLoadedEventEnd),
					transferSize: entry.transferSize,
				};
			});
			const markerAtMs = await markerAt;
			loads.push(
				evaluateColdLoad({
					path,
					status: response ? response.status() : null,
					fcpMs: fcp,
					markerAtMs,
					budgetMs,
					navigationTiming,
				}),
			);
		} catch (error) {
			loads.push(
				evaluateColdLoad({
					path,
					status: null,
					fcpMs: null,
					markerAtMs: null,
					budgetMs,
					error: String(error?.message ?? error),
				}),
			);
		} finally {
			await page.close();
		}
	}
	return loads;
}

/**
 * Wait until the router owns the document.
 *
 * Hydration, not `load`: a click issued before React has hydrated is a
 * full document navigation, which measures the network and not the
 * client-side wait this ticket is about. The marker is a React prop key
 * on the tool card, which the framework attaches when the root is
 * hydrated.
 */
async function waitForHydration(page) {
	await page.waitForFunction(
		() => {
			const link = document.querySelector('a[href^="/tools/"]');
			return Boolean(link && Object.keys(link).some((key) => key.startsWith('__reactProps')));
		},
		null,
		{ timeout: 120_000 },
	);
}

async function waitForServer(url, timeoutMs = 60_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url, { redirect: 'follow' });
			if (res.ok) return true;
		} catch {
			/* not up yet */
		}
		await new Promise((r) => setTimeout(r, 400));
	}
	return false;
}

function startPreview(port) {
	const child = spawn(
		process.execPath,
		[join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(port)],
		{ cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
	);
	child.stdout.on('data', () => {});
	child.stderr.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`));
	return child;
}

/**
 * Prepare the LOCAL D1 state the same way Playwright's bootstrap does.
 *
 * The harness must be runnable on a fresh checkout (that is what makes
 * the "CI reproduces it" claim checkable), so it applies the local
 * migrations and the portfolio skeleton seed before the preview server
 * binds. Local target only — this function never accepts a target
 * argument.
 */
function prepareLocalDatabase() {
	try {
		applyMigrations({ target: 'local', execute: true });
		execFileSync('node', ['scripts/seed-portfolio.mjs'], {
			cwd: REPO_ROOT,
			stdio: 'inherit',
			env: process.env,
		});
		return true;
	} catch (error) {
		process.stderr.write(
			`slow-network-wait-ui: WARNING — local D1 preparation failed (${error?.message ?? error}); pages that read D1 may answer with a failure surface\n`,
		);
		return false;
	}
}

function git(args) {
	try {
		return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
	} catch {
		return 'unknown';
	}
}

function playwrightVersion() {
	try {
		const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
		return pkg.devDependencies?.['@playwright/test'] ?? 'unknown';
	} catch {
		return 'unknown';
	}
}

/**
 * Paint the measurement onto the page before the screenshot.
 *
 * The Issue asks for one image that carries the browser state and the
 * numbers, so the reviewer does not have to cross-reference a second
 * artefact. The panel is injected at runtime and is not part of the site.
 */
async function renderMeasurementPanel(page, report) {
	await page.evaluate((payload) => {
		const line = (k, v) => `${k} ${v}`;
		const window = (verdict) =>
			verdict
				? `blank ${verdict.blankMs}ms · waiting ${verdict.feedbackMs}ms · stale ${verdict.staleMs}ms · settled ${verdict.settledAtMs ?? 'n/a'}ms`
				: 'n/a';
		const rows = [
			line(
				'source SHA',
				`${payload.environment.sourceSha.slice(0, 12)}${payload.environment.workingTreeDirty ? ' (dirty)' : ''}`,
			),
			line('browser', payload.environment.browser),
			line(
				'viewport / DPR',
				`${payload.environment.viewport} / ${payload.environment.deviceScaleFactor}`,
			),
			line('CPU throttle', `${payload.environment.cpuThrottlingRate}x (CDP)`),
			line('network', payload.environment.networkProfile.label),
			line(
				'injected delay',
				`route chunk +${payload.options.chunkDelayMs}ms · stall leg +${payload.options.stallMs}ms`,
			),
			line('surface', payload.environment.surface),
			'',
			line(
				'leg route-pending',
				payload.legs.pending.skipped
					? `SKIPPED — ${payload.legs.pending.skippedReason}`
					: payload.verdict.verdicts.pending?.pass
						? 'PASS'
						: 'FAIL',
			),
			line('  window', window(payload.legs.pending.verdict)),
			line(
				'leg route-stall',
				payload.legs.stall.skipped
					? 'SKIPPED'
					: payload.verdict.verdicts.stall?.pass
						? 'PASS'
						: 'FAIL',
			),
			line('  window', window(payload.legs.stall.verdict)),
			line(
				'  retry control',
				payload.legs.stall.retryHref
					? `published ${payload.legs.stall.retryHref}`
					: 'none published',
			),
			line(
				'  retry followed',
				payload.legs.stall.retry
					? `${payload.legs.stall.retry.href} → navigated=${payload.legs.stall.retry.navigated} content=${payload.legs.stall.retry.markerAfter}`
					: 'not verified',
			),
			'',
			line(
				'leg cold-load',
				payload.legs.coldLoads.map((load) => `${load.path} fcp=${load.fcpMs}ms`).join(' · '),
			),
			line(
				'cold-load marks',
				payload.legs.coldLoads.map((load) => `${load.path} ${load.markerAtMs}ms`).join(' · '),
			),
		];
		if (payload.before) {
			rows.unshift(
				line(
					'BEFORE (compare)',
					`${payload.before.sourceShaShort} · pending ${payload.before.pending}`,
				),
			);
			if (payload.before.conditions?.comparable === false) {
				rows.unshift(
					line(
						'COMPARE WARNING',
						`conditions differ: ${payload.before.conditions.mismatches
							.map((m) => `${m.field} ${m.before} -> ${m.current}`)
							.join(' · ')}`,
					),
				);
			}
			rows.unshift('');
		}
		if (payload.verdict.pass === false) {
			rows.push('', line('failures', payload.verdict.failures.join(' | ')));
		}
		const panel = document.createElement('section');
		panel.id = 'issue-489-measurement-panel';
		panel.setAttribute('role', 'note');
		panel.style.cssText = [
			'position:sticky',
			'top:0',
			'z-index:2147483647',
			'margin:0',
			'padding:14px 20px',
			'background:#0b0f14',
			'color:#e6edf3',
			'border-bottom:2px solid #2ea043',
			'font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace',
			'white-space:pre-wrap',
		].join(';');
		panel.textContent = [
			`Issue #489 — slow network / CPU throttle wait UI · ${payload.generatedAt}`,
			...rows,
		].join('\n');
		document.body.prepend(panel);
		panel.dataset.verdict = payload.verdict.status ?? (payload.verdict.pass ? 'PASS' : 'FAIL');
	}, report);
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const baseUrl = options.baseUrl ?? `http://127.0.0.1:${options.port}`;
	const baseUrlIsLoopback = isLoopbackOrigin(baseUrl);
	const preview = options.baseUrl ? null : startPreview(options.port);
	let browser = null;
	try {
		if (preview) {
			const prepared = prepareLocalDatabase();
			process.stdout.write(
				`slow-network-wait-ui: preview on ${baseUrl} (local D1 ${prepared ? 'ready' : 'NOT ready'})\n`,
			);
		}
		if (!(await waitForServer(`${baseUrl}/tools`))) {
			throw new Error(`slow-network-wait-ui: ${baseUrl} did not become ready`);
		}

		browser = await chromium.launch();
		const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
		const page = await context.newPage();

		const networkCondition = {
			offline: false,
			latency: 150,
			downloadThroughput: (1.6 * 1024 * 1024) / 8,
			uploadThroughput: (750 * 1024) / 8,
		};
		const cdp = await context.newCDPSession(page);
		await cdp.send('Network.enable');
		await cdp.send('Network.emulateNetworkConditions', networkCondition);
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: options.cpuThrottle });

		const pageErrors = [];
		page.on('pageerror', (error) => pageErrors.push(String(error)));
		await page.addInitScript(DOCUMENT_STAMP_SOURCE);

		// One route handler, retargeted by the legs. Installing it also
		// disables the HTTP cache for this page, which is what makes the
		// delay reach every navigation instead of only the first.
		const chunkDelay = installChunkDelay(page);

		// ---- leg: route-pending -------------------------------------
		const toolsResponse = await page.goto(`${baseUrl}/tools`, { waitUntil: 'load' });
		if (!toolsResponse || !toolsResponse.ok()) {
			throw new Error(
				`slow-network-wait-ui: GET /tools returned ${toolsResponse ? toolsResponse.status() : 'no response'}`,
			);
		}
		await waitForHydration(page);
		const pending = await runPendingLeg(page, {
			cycles: options.cycles,
			delayMs: options.chunkDelayMs,
			chunkDelay,
			baseUrl,
		});

		// ---- leg: route-stall ---------------------------------------
		await page.goto(`${baseUrl}/tools`, { waitUntil: 'load' });
		await waitForHydration(page);
		const stallTarget = TOOL_DETAIL_PATHS[0];
		const stall = await runStallLeg(page, {
			delayMs: options.stallMs,
			expectedPath: stallTarget,
			chunkDelay,
		});
		const retry = stall.skipped
			? null
			: evaluateRetryOutcome(
					await verifyRetryRecovery(page, {
						stallMs: Math.max(options.chunkDelayMs, FEEDBACK_AFTER_MS + 2000),
						expectedPath: stallTarget,
						baseUrl,
						chunkDelay,
					}),
				);

		// ---- leg: cold-load ----------------------------------------
		const coldLoads = await runColdLoads(context, {
			baseUrl,
			budgetMs: COLD_LOAD_BUDGET_MS,
			cpuThrottle: options.cpuThrottle,
			networkCondition,
		});

		const report = {
			issue: '#489',
			generatedAt: new Date().toISOString(),
			options: {
				cycles: options.cycles,
				cpuThrottle: options.cpuThrottle,
				chunkDelayMs: options.chunkDelayMs,
				stallMs: options.stallMs,
				baseUrl,
			},
			environment: {
				sourceSha: git(['rev-parse', 'HEAD']),
				workingTreeDirty: git(['status', '--porcelain']).length > 0,
				browser: `Chromium ${browser.version()}`,
				playwright: playwrightVersion(),
				node: process.version,
				platform: `${osPlatform()} ${arch()} ${osRelease()}`,
				viewport: '1280x900',
				deviceScaleFactor: 1,
				cpuThrottlingRate: options.cpuThrottle,
				networkProfile: {
					label: 'Slow 4G (CDP Network.emulateNetworkConditions)',
					latencyMs: networkCondition.latency,
					downloadKbps: Math.round((networkCondition.downloadThroughput * 8) / 1024),
					uploadKbps: Math.round((networkCondition.uploadThroughput * 8) / 1024),
				},
				surface: options.baseUrl
					? 'caller-supplied --base-url (not booted by this harness)'
					: 'vite preview of `pnpm run build` (not a dev server)',
				baseUrl,
				baseUrlIsLoopback,
				remoteTarget: !baseUrlIsLoopback,
				productionTouched: baseUrlIsLoopback ? false : null,
			},
			legs: {
				pending: { ...pending, retry: null },
				stall: { ...stall, retry },
				coldLoads,
			},
			pageErrors,
		};
		report.verdict = evaluateProfile(
			{
				pending: { ...report.legs.pending, failures: pending.failures ?? [] },
				stall: {
					...report.legs.stall,
					failures: [...(stall.failures ?? []), ...(retry ? retry.failures : [])],
				},
				coldLoads: {
					skipped: false,
					failures: coldLoads.flatMap((load) => load.failures),
				},
			},
			{ pageErrors },
		);

		if (!baseUrlIsLoopback) {
			process.stderr.write(
				`slow-network-wait-ui: WARNING — measuring ${baseUrl} is not a loopback target; the report records productionTouched=null\n`,
			);
		}

		if (options.compare) {
			try {
				const before = JSON.parse(readFileSync(resolve(REPO_ROOT, options.compare), 'utf8'));
				const summary = (value) =>
					value
						? `blank ${value.blankMs}ms / waiting ${value.feedbackMs}ms / stale ${value.staleMs}ms`
						: 'n/a';
				report.before = {
					path: options.compare,
					sourceSha: before?.environment?.sourceSha ?? 'unknown',
					sourceShaShort: (before?.environment?.sourceSha ?? 'unknown').slice(0, 12),
					generatedAt: before?.generatedAt ?? 'unknown',
					pending: summary(before?.legs?.pending?.verdict),
					stall: summary(before?.legs?.stall?.verdict),
					verdict: before?.verdict?.pass ?? null,
					invocation: {
						browser: before?.environment?.browser ?? null,
						cpuThrottlingRate: before?.environment?.cpuThrottlingRate ?? null,
						networkProfile: before?.environment?.networkProfile?.label ?? null,
						viewport: before?.environment?.viewport ?? null,
						deviceScaleFactor: before?.environment?.deviceScaleFactor ?? null,
						surface: before?.environment?.surface ?? null,
						cycles: before?.options?.cycles ?? null,
						chunkDelayMs: before?.options?.chunkDelayMs ?? null,
						stallMs: before?.options?.stallMs ?? null,
					},
					conditions: compareMeasurementConditions(report, before),
				};
				if (!report.before.conditions.comparable) {
					process.stderr.write(
						`slow-network-wait-ui: WARNING — --compare conditions differ: ${report.before.conditions.mismatches
							.map((m) => `${m.field} before=${m.before} now=${m.current}`)
							.join(', ')}\n`,
					);
				}
			} catch (error) {
				report.before = { path: options.compare, error: String(error?.message ?? error) };
				report.verdict = withCompareFailure(report.verdict, options.compare, report.before.error);
				process.stderr.write(
					`slow-network-wait-ui: FAILURE — --compare input could not be read: ${options.compare} (${report.before.error})\n`,
				);
			}
		}

		if (!options.noScreenshot) {
			await page.goto(`${baseUrl}/tools`, { waitUntil: 'load' });
			await page.waitForTimeout(1200);
			await renderMeasurementPanel(page, report);
			const capture = await page.evaluate(() => {
				const panel = document.getElementById('issue-489-measurement-panel');
				return {
					verdict: panel?.dataset.verdict ?? 'missing',
					panelChars: panel?.textContent?.length ?? 0,
				};
			});
			const target = resolve(REPO_ROOT, options.screenshot);
			mkdirSync(dirname(target), { recursive: true });
			const rawCapture = join(REPO_ROOT, '.tmp', 'slow-network-wait-ui', 'capture.png');
			await page.screenshot({ path: rawCapture, fullPage: false });
			try {
				const written = await sharp(rawCapture)
					.resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
					.webp({ quality: SCREENSHOT_QUALITY })
					.toFile(target);
				const budget = screenshotBudgetVerdict(written.size);
				report.screenshot = {
					path: options.screenshot,
					format: 'webp',
					viewport: '1280x900',
					maxWidth: SCREENSHOT_MAX_WIDTH,
					quality: SCREENSHOT_QUALITY,
					bytes: budget.bytes,
					kb: budget.kb,
					withinBudget: budget.withinBudget,
					...capture,
				};
				process.stdout.write(
					`slow-network-wait-ui: wrote ${options.screenshot} (${written.width}x${written.height}, ${budget.kb} kB webp, verdict=${capture.verdict})\n`,
				);
				if (!budget.withinBudget) {
					process.stderr.write(
						`slow-network-wait-ui: WARNING — capture is ${budget.kb} kB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB verification-artefact budget\n`,
					);
				}
			} finally {
				rmSync(rawCapture, { force: true });
			}
		}

		const jsonTarget = resolve(REPO_ROOT, options.jsonOut);
		mkdirSync(dirname(jsonTarget), { recursive: true });
		writeFileSync(jsonTarget, `${JSON.stringify(report, null, 2)}\n`);

		await context.close();

		process.stdout.write(
			`\nslow-network-wait-ui report (source ${report.environment.sourceSha.slice(0, 7)}, ${options.cycles} pending navigation(s))\n`,
		);
		const describe = (name, leg) => {
			if (leg?.skipped) {
				process.stdout.write(`  ${name.padEnd(13)} SKIPPED — ${leg.skippedReason}\n`);
				return;
			}
			const verdict = leg.verdict;
			process.stdout.write(
				`  ${name.padEnd(13)} blank ${verdict.blankMs}ms · waiting ${verdict.feedbackMs}ms · stale ${verdict.staleMs}ms · settled ${verdict.settledAtMs ?? 'n/a'}ms → ${verdict.pass ? 'PASS' : 'FAIL'}\n`,
			);
		};
		describe('route-pending', pending);
		describe('route-stall', stall);
		for (const load of coldLoads) {
			process.stdout.write(
				`  cold-load ${String(load.path).padEnd(9)} fcp ${String(load.fcpMs).padStart(6)}ms · marker ${String(load.markerAtMs).padStart(6)}ms → ${load.pass ? 'PASS' : 'FAIL'}\n`,
			);
		}
		if (retry) {
			process.stdout.write(
				`  retry          ${retry.href ?? 'none'} → navigated=${retry.navigated} content=${retry.markerAfter} → ${retry.pass ? 'PASS' : 'FAIL'}\n`,
			);
		}
		process.stdout.write(`  verdict        ${report.verdict.status}\n`);
		for (const failure of report.verdict.failures) process.stdout.write(`    - ${failure}\n`);
		process.stdout.write(`  report         ${options.jsonOut}\n`);

		return report.verdict.pass;
	} finally {
		if (browser) await browser.close().catch(() => {});
		if (preview) preview.kill();
	}
}

const invokedDirectly =
	process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

let exitCode = 0;
if (invokedDirectly) {
	try {
		exitCode = (await main()) ? 0 : 1;
	} catch (error) {
		process.stderr.write(`slow-network-wait-ui: ${error?.stack ?? error}\n`);
		exitCode = 2;
	}
	process.exit(exitCode);
}
