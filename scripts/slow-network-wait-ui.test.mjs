#!/usr/bin/env node
/**
 * Contract tests for `scripts/slow-network-wait-ui.mjs` (Issue #489).
 *
 * These run under `pnpm run test` (`node --test`), so they are part of
 * `validate:fast`. They do NOT run a browser: the browser leg is the
 * measurement artefact, this is the deterministic contract the
 * measurement is judged by.
 *
 * The point of the false-green guards below
 * -----------------------------------------
 * A wait-UI detector that cannot fail is worse than none, because the
 * report it produces reads as evidence. Two sequences here are the exact
 * signatures this ticket measured on the pre-fix build:
 *
 *   1. the outlet keeps showing the PREVIOUS page under a URL that
 *      already changed (`content` for the whole wait) — a stale page
 *      under Slow 4G is indistinguishable from a click that did nothing;
 *   2. the wait never settles inside the window — which must not be
 *      reported as "0ms of blank, therefore fine".
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import {
	COLD_LOAD_BUDGET_MS,
	DOCUMENT_STAMP_SOURCE,
	FEEDBACK_AFTER_MS,
	FEEDBACK_TOLERANCE_MS,
	ROUTE_MARKERS,
	SAMPLE_INTERVAL_MS,
	SCREENSHOT_BUDGET_BYTES,
	TOOL_DETAIL_PATHS,
	classifySample,
	compareMeasurementConditions,
	describeWaitWindow,
	evaluateColdLoad,
	evaluateProfile,
	evaluateRetryOutcome,
	evaluateWaitWindow,
	isLoopbackOrigin,
	parseArgs,
	screenshotBudgetVerdict,
	withCompareFailure,
} from './slow-network-wait-ui.mjs';

/**
 * Build an outlet sample series. `byMs` maps an elapsed time to the
 * sample the outlet showed at that instant; anything absent repeats the
 * previous sample, which is what a constant state looks like when
 * sampled on a cadence.
 */
function samples(byMs, untilMs = 2000, stepMs = SAMPLE_INTERVAL_MS) {
	const out = [];
	let previous = { settled: false, waiting: false, visibleContent: true };
	for (let elapsedMs = 0; elapsedMs <= untilMs; elapsedMs += stepMs) {
		previous = byMs[elapsedMs] ?? previous;
		out.push({ elapsedMs, ...previous });
	}
	return out;
}

const CONTENT = { settled: false, waiting: false, visibleContent: true };
const WAITING = { settled: false, waiting: true, visibleContent: false };
const BLANK = { settled: false, waiting: false, visibleContent: false };
const SETTLED = { settled: true, waiting: false, visibleContent: true };

describe('classifySample', () => {
	it('reads a rendered destination as settled, whatever else is on screen', () => {
		assert.equal(classifySample(SETTLED), 'settled');
		assert.equal(classifySample({ ...WAITING, settled: true }), 'settled');
	});

	it('prefers the waiting surface over leftover content', () => {
		assert.equal(
			classifySample({ waiting: true, visibleContent: true, settled: false }),
			'waiting',
		);
	});

	it('separates a stale page from an empty outlet', () => {
		assert.equal(classifySample(CONTENT), 'content');
		assert.equal(classifySample(BLANK), 'blank');
	});

	it('treats a missing sample as blank rather than as healthy', () => {
		assert.equal(classifySample(undefined), 'blank');
	});
});

describe('describeWaitWindow', () => {
	it('reports an unmeasured wait as zeroed rather than as a pass signal', () => {
		const window = describeWaitWindow([]);
		assert.equal(window.samples, 0);
		assert.equal(window.settled, false);
		assert.equal(window.blankMs, 0);
		assert.deepEqual(window.classes, []);
	});

	it('accumulates the wall-clock time spent in each state', () => {
		const window = describeWaitWindow(samples({ 0: BLANK, 400: WAITING, 900: SETTLED }, 900, 100));
		assert.equal(window.settled, true);
		assert.equal(window.blankMs, 400);
		assert.equal(window.feedbackMs, 500);
		assert.equal(window.staleMs, 0);
		assert.equal(window.settledAtMs, 900);
	});

	it('stops counting at the destination marker', () => {
		const window = describeWaitWindow(samples({ 0: CONTENT, 300: SETTLED }, 1500, 100));
		assert.equal(window.staleMs, 300);
		assert.deepEqual([...new Set(window.classes)], ['content', 'settled']);
	});

	it('only counts uninformed time after the feedback threshold', () => {
		const window = describeWaitWindow(samples({ 0: CONTENT, 1600: SETTLED }, 1600, 100));
		assert.equal(window.staleMs, 1600);
		assert.equal(window.uninformedAfterThresholdMs, 500);
	});

	it('never reports a settled window as uninformed', () => {
		const window = describeWaitWindow(samples({ 0: WAITING, 600: SETTLED }, 600, 100));
		assert.equal(window.uninformedAfterThresholdMs, 0);
	});
});

describe('evaluateWaitWindow', () => {
	it('passes a wait that informs the visitor after the threshold', () => {
		const verdict = evaluateWaitWindow(
			samples({ 0: CONTENT, 1000: WAITING, 3200: SETTLED }, 3200, 100),
		);
		assert.equal(verdict.pass, true);
		assert.deepEqual(verdict.failures, []);
	});

	it('accepts a surface observed within one sampling interval of the threshold', () => {
		const verdict = evaluateWaitWindow(
			samples({ 0: CONTENT, 1200: WAITING, 3200: SETTLED }, 3200, 100),
		);
		assert.equal(verdict.pass, true);
		assert.equal(verdict.uninformedAfterThresholdMs, FEEDBACK_TOLERANCE_MS);
	});

	it('fails when the surface appears more than one sampling interval late', () => {
		const verdict = evaluateWaitWindow(
			samples({ 0: CONTENT, 1300: WAITING, 3200: SETTLED }, 3200, 100),
		);
		assert.equal(verdict.pass, false);
		assert.match(verdict.failures.join('\n'), /no waiting surface for 200ms/);
	});

	it('rejects the pre-fix signature: the previous page under a new URL', () => {
		const verdict = evaluateWaitWindow(samples({ 0: CONTENT, 4200: SETTLED }, 4200, 100));
		assert.equal(verdict.pass, false);
		assert.match(verdict.failures.join('\n'), /no waiting surface for \d+ms after the 1000ms/);
		assert.match(verdict.failures.join('\n'), /stale previous page: 4200ms/);
	});

	it('rejects a blank outlet even for one sample interval', () => {
		const verdict = evaluateWaitWindow(samples({ 0: BLANK, 200: WAITING, 900: SETTLED }, 900, 100));
		assert.equal(verdict.pass, false);
		assert.match(verdict.failures.join('\n'), /the outlet was blank for 200ms/);
	});

	it('rejects a wait that never settles instead of calling it fast', () => {
		const verdict = evaluateWaitWindow(samples({ 0: WAITING }, 1000, 100));
		assert.equal(verdict.pass, false);
		assert.match(verdict.failures.join('\n'), /never settled/);
	});

	it('rejects an unmeasured navigation', () => {
		const verdict = evaluateWaitWindow([]);
		assert.equal(verdict.pass, false);
		assert.match(verdict.failures.join('\n'), /nothing was measured/);
	});

	it('honours an explicit feedback threshold', () => {
		const series = samples({ 0: CONTENT, 1500: SETTLED }, 1500, 100);
		assert.equal(evaluateWaitWindow(series, { feedbackAfterMs: 500 }).pass, false);
		assert.equal(evaluateWaitWindow(series, { feedbackAfterMs: 5000 }).pass, true);
	});
});

describe('evaluateRetryOutcome', () => {
	const good = {
		present: true,
		href: '/tools/prototype',
		expectedPath: '/tools/prototype',
		navigated: true,
		markerAfter: true,
	};

	it('passes a control that delivered the destination', () => {
		assert.equal(evaluateRetryOutcome(good).pass, true);
		assert.deepEqual(evaluateRetryOutcome(good).failures, []);
		// The outcome is spread into the verdict so the report and the
		// capture panel can print what was actually observed instead of
		// only "pass".
		assert.equal(evaluateRetryOutcome(good).href, '/tools/prototype');
	});

	it('fails when the surface published no control', () => {
		const verdict = evaluateRetryOutcome({ ...good, present: false });
		assert.equal(verdict.pass, false);
		assert.match(verdict.failures.join('\n'), /published no retry control/);
	});

	it('fails when the control points somewhere else', () => {
		const verdict = evaluateRetryOutcome({ ...good, href: '/' });
		assert.match(verdict.failures.join('\n'), /points at \/, not the destination/);
	});

	it('fails when following the control did not navigate', () => {
		const verdict = evaluateRetryOutcome({ ...good, navigated: false });
		assert.match(verdict.failures.join('\n'), /did not produce a new document/);
	});

	it('fails when the retry landed but never rendered the destination', () => {
		const verdict = evaluateRetryOutcome({ ...good, markerAfter: false });
		assert.match(verdict.failures.join('\n'), /never rendered/);
	});

	it('does not pile navigation failures onto a missing control', () => {
		const verdict = evaluateRetryOutcome({
			present: false,
			href: null,
			expectedPath: '/tools/prototype',
			navigated: false,
			markerAfter: false,
		});
		assert.equal(verdict.failures.length, 1);
	});
});

describe('evaluateColdLoad', () => {
	it('passes a load that painted and reached its marker inside the budget', () => {
		const verdict = evaluateColdLoad({
			path: '/',
			fcpMs: 208,
			markerAtMs: 479,
			budgetMs: COLD_LOAD_BUDGET_MS,
		});
		assert.equal(verdict.pass, true);
	});

	it('fails a document that never painted', () => {
		const verdict = evaluateColdLoad({
			path: '/',
			fcpMs: null,
			markerAtMs: 500,
			budgetMs: COLD_LOAD_BUDGET_MS,
		});
		assert.match(verdict.failures.join('\n'), /nothing was painted/);
	});

	it('fails a load that never reached its marker', () => {
		const verdict = evaluateColdLoad({
			path: '/portfolio',
			fcpMs: 100,
			markerAtMs: null,
			budgetMs: COLD_LOAD_BUDGET_MS,
		});
		assert.match(verdict.failures.join('\n'), /never reached its settled state/);
	});

	it('fails a load that overshot the budget', () => {
		const verdict = evaluateColdLoad({
			path: '/tools',
			fcpMs: 100,
			markerAtMs: COLD_LOAD_BUDGET_MS + 1,
			budgetMs: COLD_LOAD_BUDGET_MS,
		});
		assert.match(verdict.failures.join('\n'), /over the 30000ms budget/);
	});
});

describe('evaluateProfile', () => {
	it('passes only when every leg passed', () => {
		const verdict = evaluateProfile({
			pending: { failures: [] },
			stall: { failures: [] },
			coldLoads: { failures: [] },
		});
		assert.equal(verdict.status, 'PASS');
		assert.equal(verdict.pass, true);
	});

	it('reports a skipped leg as INCOMPLETE rather than as a pass', () => {
		const verdict = evaluateProfile({
			pending: { skipped: true, skippedReason: 'no link in this build' },
			stall: { failures: [] },
		});
		assert.equal(verdict.status, 'INCOMPLETE');
		assert.equal(verdict.pass, false);
		assert.deepEqual(verdict.skipped, ['pending']);
	});

	it('fails a run that logged a page error', () => {
		const verdict = evaluateProfile({ pending: { failures: [] } }, { pageErrors: ['boom'] });
		assert.equal(verdict.status, 'FAIL');
		assert.match(verdict.failures.join('\n'), /page error during measurement: boom/);
	});
});

describe('withCompareFailure', () => {
	it('folds an unreadable BEFORE into the verdict', () => {
		const verdict = withCompareFailure(
			{ pass: true, status: 'PASS', failures: [] },
			'.tmp/before.json',
			'ENOENT',
		);
		assert.equal(verdict.pass, false);
		assert.equal(verdict.status, 'FAIL');
		assert.match(verdict.failures.join('\n'), /--compare input could not be read/);
	});
});

describe('isLoopbackOrigin', () => {
	it('accepts the loopback forms a developer actually uses', () => {
		for (const url of [
			'http://localhost:3000',
			'http://127.0.0.1:15952',
			'https://127.5.5.5/',
			'http://[::1]:3000',
			'http://app.localhost:3000',
		]) {
			assert.equal(isLoopbackOrigin(url), true, url);
		}
	});

	it('refuses anything that is not loopback', () => {
		for (const url of [
			'https://rebuildup.dev',
			'http://127.0.0.1.evil.example',
			'https://10.0.0.1',
			'ftp://127.0.0.1',
			'not a url',
		]) {
			assert.equal(isLoopbackOrigin(url), false, url);
		}
	});
});

describe('compareMeasurementConditions', () => {
	const environment = {
		browser: 'Chromium 143.0.0.0',
		cpuThrottlingRate: 4,
		viewport: '1280x900',
		deviceScaleFactor: 1,
		surface: 'vite preview of `pnpm run build` (not a dev server)',
		networkProfile: { label: 'Slow 4G (CDP Network.emulateNetworkConditions)' },
	};
	const report = { environment, options: { cycles: 3, chunkDelayMs: 4000, stallMs: 12000 } };

	it('treats identical conditions as comparable', () => {
		const result = compareMeasurementConditions(report, structuredClone(report));
		assert.equal(result.comparable, true);
		assert.deepEqual(result.mismatches, []);
	});

	it('refuses to compare runs whose injected delay differs', () => {
		const before = structuredClone(report);
		before.options.chunkDelayMs = 8000;
		const result = compareMeasurementConditions(report, before);
		assert.equal(result.comparable, false);
		assert.deepEqual(result.mismatches, [{ field: 'chunkDelayMs', current: 4000, before: 8000 }]);
	});

	it('refuses to compare runs whose CPU throttle or network differs', () => {
		const before = structuredClone(report);
		before.environment.cpuThrottlingRate = 6;
		before.environment.networkProfile.label = 'Fast 4G';
		const result = compareMeasurementConditions(report, before);
		assert.deepEqual(result.mismatches.map((mismatch) => mismatch.field).sort(), [
			'cpuThrottlingRate',
			'networkProfile',
		]);
	});
});

describe('screenshotBudgetVerdict', () => {
	it('accepts a capture inside the verification-artefact budget', () => {
		const verdict = screenshotBudgetVerdict(52 * 1024);
		assert.equal(verdict.withinBudget, true);
		assert.equal(verdict.kb, 52);
	});

	it('rejects a capture that would bloat the repository', () => {
		assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES + 1).withinBudget, false);
	});
});

describe('parseArgs', () => {
	it('defaults to the documented profile', () => {
		const options = parseArgs([]);
		assert.equal(options.cycles, 3);
		assert.equal(options.cpuThrottle, 4);
		assert.equal(options.chunkDelayMs, 4000);
		assert.equal(options.stallMs, 12000);
		assert.equal(options.screenshot, 'docs/verification/perf/slow-network-state.webp');
	});

	it('accepts the pnpm argument separator', () => {
		assert.equal(parseArgs(['--', '--cycles=2']).cycles, 2);
	});

	it('rejects an unknown option instead of ignoring it', () => {
		assert.throws(() => parseArgs(['--latency=150']), /unknown option/);
	});

	it('rejects a configuration that cannot measure anything', () => {
		assert.throws(() => parseArgs(['--cycles=0']), /--cycles/);
		assert.throws(() => parseArgs(['--chunk-delay=-1']), /--chunk-delay/);
		assert.throws(() => parseArgs([`--stall-ms=${FEEDBACK_AFTER_MS}`]), /--stall-ms/);
	});

	it('refuses a non-loopback --base-url unless the caller opts in', () => {
		assert.throws(() => parseArgs(['--base-url=https://rebuildup.dev']), /loopback/);
		assert.equal(
			parseArgs(['--base-url=https://rebuildup.dev', '--allow-remote']).allowRemote,
			true,
		);
	});

	it('rejects a --base-url that is not http(s)', () => {
		assert.throws(() => parseArgs(['--base-url=file:///tmp']), /http\(s\) URL/);
	});
});

describe('DOCUMENT_STAMP_SOURCE', () => {
	/**
	 * Run the init script against a fake `sessionStorage`, the way the
	 * browser runs it: no imports, no closure over Node values, one
	 * increment per DOCUMENT.
	 */
	function stamp(store) {
		vm.runInNewContext(DOCUMENT_STAMP_SOURCE, {
			sessionStorage: {
				getItem: (key) => store[key] ?? null,
				setItem: (key, value) => {
					store[key] = value;
				},
			},
		});
		return store.__slowNetworkWaitUiDocument;
	}

	it('increments once per document load', () => {
		const store = {};
		assert.equal(stamp(store), '1');
		assert.equal(stamp(store), '2');
	});

	it('is monotonic across a fresh document that inherits the value', () => {
		const store = { __slowNetworkWaitUiDocument: '7' };
		assert.equal(stamp(store), '8');
		assert.equal(Number(store.__slowNetworkWaitUiDocument) > 7, true);
	});

	it('never throws when sessionStorage is blocked', () => {
		vm.runInNewContext(DOCUMENT_STAMP_SOURCE, {
			sessionStorage: {
				getItem() {
					throw new Error('blocked');
				},
				setItem() {
					throw new Error('blocked');
				},
			},
		});
	});
});

describe('route markers', () => {
	it('names a marker for every route the legs drive', () => {
		for (const path of ['/', '/portfolio', '/tools', ...TOOL_DETAIL_PATHS]) {
			assert.ok(ROUTE_MARKERS[path], `missing marker for ${path}`);
			assert.ok(ROUTE_MARKERS[path].selector.length > 0);
			assert.ok(ROUTE_MARKERS[path].label.length > 0);
		}
	});

	it('uses different markers per tool detail route', () => {
		assert.notEqual(
			ROUTE_MARKERS['/tools/prototype'].selector,
			ROUTE_MARKERS['/tools/readmark'].selector,
		);
	});
});
