#!/usr/bin/env node
/**
 * Contract tests for `scripts/interaction-memory-profile.mjs` (Issue #488).
 *
 * These run under `pnpm run test` (`node --test`), so they are part of
 * `validate:fast`. They do NOT run a browser: the browser leg is the
 * measurement artefact, this is the deterministic contract the measurement
 * is judged by.
 *
 * The point of the false-green guards below
 * -----------------------------------------
 * A leak detector that cannot fail is worse than no detector, because the
 * report it produces reads as evidence. Every growing series here is a
 * synthetic leak that MUST be rejected, and one of them is the exact
 * signature this ticket measured: one extra `document` listener per client
 * -side route change.
 */

import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { describe, it } from 'node:test';
import {
	DEFAULT_WARMUP_CYCLES,
	GROWTH_METRICS,
	LISTENER_GROWTH_TOLERANCE,
	LISTENER_PROBE_SOURCE,
	compareMeasurementConditions,
	describeGrowth,
	documentReloadCycles,
	documentReloadFailures,
	evaluateListenerGrowth,
	evaluateProfile,
	isLoopbackOrigin,
	parseArgs,
	screenshotBudgetVerdict,
	topEntries,
	withCompareFailure,
} from './interaction-memory-profile.mjs';

/**
 * Build a leg series. `byCycle` maps a cycle index to the listener counts
 * that cycle observed; anything absent repeats the previous cycle's values,
 * which is what a flat series looks like.
 */
function series(byCycle, cycles) {
	const out = [];
	let previous = { liveGlobal: 100, liveConnected: 20 };
	for (let cycle = 0; cycle <= cycles; cycle += 1) {
		previous = byCycle[cycle] ?? previous;
		out.push({ cycle, ...previous });
	}
	return out;
}

describe('describeGrowth', () => {
	it('reports a flat series as zero growth from the settled sample', () => {
		const growth = describeGrowth(series({}, 5), 'liveGlobal');
		assert.equal(growth.delta, 0);
		assert.equal(growth.perCycle, 0);
		assert.equal(growth.settled, 100);
		assert.equal(growth.last, 100);
		assert.equal(growth.series.length, 6);
	});

	it('does not charge the warm-up cycle to the leak', () => {
		// Cycle 1 is the first repetition: the picker chunk and the first
		// route payload are allocated once and never again.
		const growth = describeGrowth(
			series({ 1: { liveGlobal: 140, liveConnected: 30 } }, 5),
			'liveGlobal',
		);
		assert.equal(
			growth.settled,
			140,
			'settled baseline is the first repetition, not the page load',
		);
		assert.equal(growth.delta, 0, 'first-repetition allocation is warm-up, not growth');
	});

	it('divides by the intervals actually observed, not by the cycle count', () => {
		// Growth starts at repetition 3 and stops at 5; the settled
		// baseline is repetition 1, so the rate is averaged over all four
		// observed intervals, not over the two that moved. A detector that
		// divided by the moving intervals alone would report a leak twice
		// as fast as the page actually leaks.
		const growth = describeGrowth(
			series({ 3: { liveGlobal: 110 }, 4: { liveGlobal: 120 }, 5: { liveGlobal: 130 } }, 5),
			'liveGlobal',
		);
		assert.equal(growth.delta, 30);
		assert.equal(growth.perCycle, 7.5);
	});

	it('returns null for an empty series instead of throwing', () => {
		assert.equal(describeGrowth([], 'liveGlobal'), null);
	});
});

describe('evaluateListenerGrowth', () => {
	it('passes when both long-lived listener classes stay flat', () => {
		const verdict = evaluateListenerGrowth(series({}, 5), { label: 'navigate' });
		assert.equal(verdict.pass, true);
		assert.deepEqual(verdict.failures, []);
		assert.equal(verdict.metrics.length, GROWTH_METRICS.length);
	});

	it('FAILS on one extra document listener per route change (the measured signature)', () => {
		const leaking = series(
			Object.fromEntries(
				Array.from({ length: 6 }, (_, cycle) => [
					cycle,
					{ liveGlobal: 147 + cycle, liveConnected: 3 },
				]),
			),
			5,
		);
		const verdict = evaluateListenerGrowth(leaking, { label: 'navigate' });
		assert.equal(verdict.pass, false);
		assert.equal(verdict.failures.length, 1);
		assert.match(verdict.failures[0], /navigate: liveGlobal grew by 4 across 4 settled repetition/);
	});

	it('FAILS on element-level growth even when window/document are flat', () => {
		const leaking = series(
			Object.fromEntries(
				Array.from({ length: 6 }, (_, cycle) => [
					cycle,
					{ liveGlobal: 146, liveConnected: 3 + cycle },
				]),
			),
			5,
		);
		const verdict = evaluateListenerGrowth(leaking, { label: 'react' });
		assert.equal(verdict.pass, false);
		assert.match(verdict.failures[0], /react: liveConnected grew by 4/);
	});

	it('FAILS when there are too few samples to observe growth at all', () => {
		const verdict = evaluateListenerGrowth(series({}, 1), { label: 'navigate' });
		assert.equal(verdict.pass, false);
		assert.match(verdict.failures.join('\n'), /at least 3 are needed to observe growth/);
	});

	it('FAILS an empty series rather than reporting a vacuous pass', () => {
		const verdict = evaluateListenerGrowth([], { label: 'navigate' });
		assert.equal(verdict.pass, false);
		assert.match(verdict.failures.join('\n'), /nothing was measured/);
	});

	it('never allows a non-zero growth tolerance', () => {
		assert.equal(LISTENER_GROWTH_TOLERANCE, 0);
		assert.equal(DEFAULT_WARMUP_CYCLES, 1);
	});
});

describe('evaluateProfile', () => {
	it('marks the profile INCOMPLETE when a leg was skipped, never a pass', () => {
		const profile = evaluateProfile({
			react: { skipped: true, skippedReason: 'widget disabled', series: [] },
			navigate: { skipped: false, series: series({}, 4) },
		});
		assert.equal(profile.pass, false, 'a journey that never ran cannot be called green');
		assert.equal(profile.status, 'INCOMPLETE');
		assert.equal(profile.complete, false);
		assert.deepEqual(profile.skipped, ['react']);
		assert.equal(profile.verdicts.react.pass, null);
		assert.equal(profile.verdicts.react.skipped, true);
		assert.match(profile.verdicts.react.reason, /widget disabled/);
		assert.equal(profile.verdicts.navigate.pass, true);
	});

	it('reports PASS only when every leg ran and stayed flat', () => {
		const profile = evaluateProfile({
			react: { skipped: false, series: series({}, 4) },
			navigate: { skipped: false, series: series({}, 4) },
		});
		assert.equal(profile.pass, true);
		assert.equal(profile.status, 'PASS');
		assert.equal(profile.complete, true);
	});

	it('fails a leg that recorded its own journey failure', () => {
		const profile = evaluateProfile({
			react: {
				skipped: false,
				series: series({}, 4),
				failures: ['cycle 2: no picker emoji could be clicked'],
			},
			navigate: { skipped: false, series: series({}, 4) },
		});
		assert.equal(profile.pass, false);
		assert.equal(profile.status, 'FAIL');
		assert.match(profile.failures.join('\n'), /no picker emoji could be clicked/);
	});

	it('fails the profile on a page error even when the series is flat', () => {
		const profile = evaluateProfile(
			{
				react: { skipped: false, series: series({}, 4) },
				navigate: { skipped: false, series: series({}, 4) },
			},
			{ pageErrors: ['Error: Maximum update depth exceeded'] },
		);
		assert.equal(profile.pass, false);
		assert.equal(profile.status, 'FAIL');
		assert.match(profile.failures.join('\n'), /page error during measurement/);
	});

	it('collects the failures of every measured leg', () => {
		const profile = evaluateProfile({
			react: { skipped: false, series: series({}, 4) },
			navigate: {
				skipped: false,
				series: series(
					Object.fromEntries(
						Array.from({ length: 5 }, (_, cycle) => [
							cycle,
							{ liveGlobal: 10 + cycle, liveConnected: 1 },
						]),
					),
					4,
				),
			},
		});
		assert.equal(profile.pass, false);
		assert.equal(profile.failures.length, 1);
		assert.match(profile.failures[0], /navigate: liveGlobal/);
	});
});

describe('parseArgs', () => {
	it('applies the documented defaults', () => {
		const options = parseArgs([]);
		assert.equal(options.cycles, 5);
		assert.equal(options.cpuThrottle, 4);
		assert.equal(options.jsonOut, '.tmp/interaction-memory-profile/report.json');
		assert.equal(options.screenshot, 'docs/verification/perf/interaction-memory-profile.webp');
		assert.equal(options.noScreenshot, false);
		assert.equal(options.compare, null);
	});

	it('rejects a repetition count that cannot observe growth', () => {
		assert.throws(() => parseArgs(['--cycles=1']), /--cycles must be an integer >= 2/);
		assert.throws(() => parseArgs(['--cycles=0']), /--cycles must be an integer >= 2/);
		assert.throws(() => parseArgs(['--cycles=abc']), /--cycles must be an integer >= 2/);
	});

	it('consumes the bare `--` separator that `pnpm run <script> --` forwards', () => {
		const options = parseArgs(['--', '--cycles=3']);
		assert.equal(options.cycles, 3);
	});

	it('rejects an unknown option instead of ignoring it', () => {
		assert.throws(() => parseArgs(['--nope=1']), /unknown option: --nope=1/);
	});

	it('rejects a non-loopback --base-url unless --allow-remote is explicit', () => {
		assert.throws(
			() => parseArgs(['--base-url=https://rebuildup.dev']),
			/--base-url must be a loopback origin/,
		);
		assert.throws(() => parseArgs(['--base-url=ftp://127.0.0.1']), /must be an http\(s\) URL/);
		const allowed = parseArgs(['--base-url=https://rebuildup.dev', '--allow-remote']);
		assert.equal(allowed.baseUrl, 'https://rebuildup.dev');
		assert.equal(allowed.allowRemote, true);
	});
});

describe('isLoopbackOrigin', () => {
	it('accepts localhost, 127.0.0.0/8 and IPv6 loopback only', () => {
		for (const url of [
			'http://127.0.0.1:15951',
			'http://localhost:3000',
			'http://app.localhost:3000',
			'http://[::1]:3000',
			'https://127.9.1.2',
		]) {
			assert.equal(isLoopbackOrigin(url), true, url);
		}
		for (const url of [
			'https://rebuildup.dev',
			'http://192.168.1.10:3000',
			'http://128.0.0.1',
			'http://127.0.0.1.evil.example',
			'not-a-url',
		]) {
			assert.equal(isLoopbackOrigin(url), false, url);
		}
	});
});

describe('compareMeasurementConditions', () => {
	const current = {
		options: { cycles: 5 },
		environment: {
			browser: 'Chromium 1',
			cpuThrottlingRate: 4,
			networkProfile: { label: 'Slow 4G' },
			viewport: '1280x900',
			deviceScaleFactor: 1,
			surface: 'vite preview',
		},
	};

	it('accepts a before report measured under the same conditions', () => {
		const result = compareMeasurementConditions(current, JSON.parse(JSON.stringify(current)));
		assert.equal(result.comparable, true);
		assert.deepEqual(result.mismatches, []);
	});

	it('reports every differing condition instead of silently comparing', () => {
		const before = JSON.parse(JSON.stringify(current));
		before.environment.browser = 'Chromium 0';
		before.environment.cpuThrottlingRate = 1;
		before.options.cycles = 3;
		const result = compareMeasurementConditions(current, before);
		assert.equal(result.comparable, false);
		assert.deepEqual(
			result.mismatches.map((m) => m.field),
			['browser', 'cpuThrottlingRate', 'cycles'],
		);
	});
});

describe('screenshotBudgetVerdict', () => {
	it('reports bytes, kB and the budget verdict', () => {
		assert.deepEqual(screenshotBudgetVerdict(200 * 1024), {
			bytes: 200 * 1024,
			kb: 200,
			withinBudget: true,
		});
		assert.equal(screenshotBudgetVerdict(400 * 1024).withinBudget, false);
	});
});

describe('topEntries', () => {
	it('sorts by count descending and truncates', () => {
		assert.deepEqual(topEntries({ a: 1, b: 5, c: 3 }, 2), [
			{ key: 'b', count: 5 },
			{ key: 'c', count: 3 },
		]);
		assert.deepEqual(topEntries(undefined), []);
	});
});

describe('LISTENER_PROBE_SOURCE', () => {
	it('patches both registration paths before application code runs', () => {
		assert.match(LISTENER_PROBE_SOURCE, /EventTarget\.prototype\.addEventListener =/);
		assert.match(LISTENER_PROBE_SOURCE, /EventTarget\.prototype\.removeEventListener =/);
		assert.match(LISTENER_PROBE_SOURCE, /originalAdd\.call\(this, type, listener, options\)/);
		assert.match(LISTENER_PROBE_SOURCE, /originalRemove\.call\(this, type, listener, options\)/);
	});

	it('publishes exactly the fields the report panel reads', () => {
		for (const field of [
			'liveGlobal',
			'liveConnected',
			'detached',
			'domNodes',
			'heapMb',
			'added',
			'released',
			'byTarget',
			'byType',
			'headLinks',
		]) {
			assert.match(
				LISTENER_PROBE_SOURCE,
				new RegExp(`\\b${field}\\s*[,:]`),
				`the injected snapshot must publish ${field}; the Node side reads it verbatim`,
			);
		}
	});

	it('counts a registration as live only for window, document or a connected node', () => {
		// A listener on a discarded node is collected with the node; a
		// detector that called it a leak would fire on ordinary unmount.
		assert.match(LISTENER_PROBE_SOURCE, /isConnected === true/);
		assert.match(LISTENER_PROBE_SOURCE, /if \(!isConnected\) \{ detached \+= 1; continue; \}/);
	});

	it('exposes the snapshot under the name the driver calls', () => {
		assert.match(LISTENER_PROBE_SOURCE, /window\.__interactionMemoryProbe/);
		assert.match(LISTENER_PROBE_SOURCE, /snapshot\(\)/);
	});

	it('holds targets weakly so the probe cannot create the leak it measures', () => {
		assert.match(LISTENER_PROBE_SOURCE, /new WeakRef\(/);
		assert.match(LISTENER_PROBE_SOURCE, /target: weakRef\(this\)/);
		assert.doesNotMatch(LISTENER_PROBE_SOURCE, /target: this,/);
	});

	it('collapses duplicate registrations onto one ledger token', () => {
		assert.match(LISTENER_PROBE_SOURCE, /entry\.target\.deref\(\) === this/);
		assert.match(LISTENER_PROBE_SOURCE, /entry\.capture === capture/);
		// Anchored on the whole condition list, in order, with no
		// `[\s\S]*?` in between: a lazy wildcard here would match any
		// file at all, so the assertion would name a behaviour it did
		// not check. `\s*` still absorbs the source's own line breaks.
		assert.match(
			LISTENER_PROBE_SOURCE,
			/!entry\.released &&\s*entry\.target\.deref\(\) === this &&\s*entry\.type === type &&\s*entry\.capture === capture\s*\)\s*\{\s*return;/,
			'the duplicate branch must return without adding a token',
		);
	});

	it('releases once listeners and signal-aborted listeners from the ledger', () => {
		assert.match(
			LISTENER_PROBE_SOURCE,
			/const once = !!\(options && typeof options === 'object' && options\.once\)/,
		);
		assert.match(
			LISTENER_PROBE_SOURCE,
			/originalAdd\.call\(signal, 'abort', entry\.onAbort, \{ once: true \}\)/,
		);
		assert.match(
			LISTENER_PROBE_SOURCE,
			/forget\(entry\);\n {6}if \(typeof listener === 'function'\)/,
		);
	});
});

/**
 * The ledger itself, run for real against a stub DOM.
 *
 * The probe is a browser init script, but everything it touches —
 * `EventTarget.prototype`, `window`, `document.head`, `performance`,
 * `location`, `WeakRef` — is stubbable here, so the decisions it makes
 * are exercised behaviourally instead of being pattern-matched against
 * its own source text. A regex cannot tell whether a duplicate really
 * collapses to one token; the fake EventTarget can.
 */
/**
 * The stubbed `sessionStorage`, shared by every `loadProbe()` call.
 *
 * A real one survives a client-side route change and dies with the
 * browser session, which is exactly the lifetime the probe's document
 * identity needs: the same store across "documents" is what lets a
 * reload read the previous value and increment it.
 */
const sessionStorageStore = new Map();
const sessionStorageStubRef = {
	getItem: (key) => (sessionStorageStore.has(key) ? sessionStorageStore.get(key) : null),
	setItem: (key, value) => sessionStorageStore.set(key, String(value)),
	removeItem: (key) => sessionStorageStore.delete(key),
};

/** Start a new browser session (what closing the tab does). */
function resetSessionStorage() {
	sessionStorageStore.clear();
}

function loadProbe() {
	class FakeEventTarget {
		constructor() {
			this.handlers = [];
			this.isConnected = false;
			this.tagName = 'DIV';
		}
		addEventListener(type, listener, options) {
			// The ledger also binds an `abort` listener on the caller's
			// `AbortSignal`, which is a REAL EventTarget. Delegating it
			// keeps `controller.abort()` observable; a stub that swallowed
			// it would make this file's abort case vacuous.
			if (!(this instanceof FakeEventTarget)) {
				EventTarget.prototype.addEventListener.call(this, type, listener, options);
				return;
			}
			this.handlers.push({ type, listener, options });
		}
		removeEventListener(type, listener) {
			// Symmetric with addEventListener: the probe also UNBINDS its
			// own `abort` handler from the caller's AbortSignal, and a stub
			// that swallowed that would make the unbinding case vacuous.
			if (!(this instanceof FakeEventTarget)) {
				EventTarget.prototype.removeEventListener.call(this, type, listener);
				return;
			}
			this.handlers = this.handlers.filter((entry) => entry.listener !== listener);
		}
		dispatch(type, ...args) {
			for (const entry of [...this.handlers]) {
				if (entry.type !== type) continue;
				if (entry.options?.once) this.removeEventListener(type, entry.listener);
				entry.listener.apply(this, args);
			}
		}
	}
	class ConnectedNode extends FakeEventTarget {
		constructor() {
			super();
			this.isConnected = true;
			this.tagName = 'BUTTON';
		}
	}
	// `window` and `document` are targets in their own right for the
	// ledger, so they are instances of the same fake: the probe counts a
	// listener as global only by identity with these two objects.
	const windowStub = new FakeEventTarget();
	const documentStub = new FakeEventTarget();
	documentStub.head = { querySelectorAll: () => [] };
	documentStub.querySelectorAll = () => [];

	const sessionStorageStub = sessionStorageStubRef;

	const run = new Function(
		'EventTarget',
		'window',
		'document',
		'performance',
		'location',
		'sessionStorage',
		LISTENER_PROBE_SOURCE,
	);
	run(
		FakeEventTarget,
		windowStub,
		documentStub,
		{ memory: undefined },
		{ pathname: '/stub' },
		sessionStorageStub,
	);
	const probe = windowStub.__interactionMemoryProbe;
	assert.ok(probe, 'the probe must publish itself on window');
	return { probe, windowStub, documentStub, ConnectedNode };
}

describe('LISTENER_PROBE_SOURCE: ledger behaviour against a stub DOM', () => {
	it('folds a duplicate registration onto one token', () => {
		const { probe, windowStub } = loadProbe();
		const listener = () => {};
		windowStub.addEventListener('click', listener);
		windowStub.addEventListener('click', listener);
		windowStub.addEventListener('click', listener);

		const snapshot = probe.snapshot();
		assert.equal(snapshot.liveGlobal, 1, 'three identical registrations are one listener');
		assert.equal(snapshot.liveTotal, 1);
		assert.equal(snapshot.added, 3, 'the calls were seen');
		assert.equal(snapshot.byTarget['window::click'], 1);
		// The browser ignores duplicates too: the stub received one.
		assert.equal(windowStub.handlers.length, 1);
	});

	it('keeps a different capture phase as a different listener', () => {
		const { probe, windowStub } = loadProbe();
		const listener = () => {};
		windowStub.addEventListener('click', listener, false);
		windowStub.addEventListener('click', listener, true);

		const snapshot = probe.snapshot();
		assert.equal(snapshot.liveGlobal, 2);
		assert.equal(windowStub.handlers.length, 2);
	});

	it('releases the token when the application removes the listener', () => {
		const { probe, windowStub } = loadProbe();
		const listener = () => {};
		windowStub.addEventListener('click', listener);
		assert.equal(probe.snapshot().liveGlobal, 1);

		windowStub.removeEventListener('click', listener);
		const snapshot = probe.snapshot();
		assert.equal(snapshot.liveGlobal, 0);
		assert.equal(snapshot.released, 1);
		assert.equal(windowStub.handlers.length, 0, 'the underlying listener went too');
	});

	it('releases the token when a `once` listener fires', () => {
		const { probe, windowStub } = loadProbe();
		let calls = 0;
		windowStub.addEventListener(
			'click',
			() => {
				calls += 1;
			},
			{ once: true },
		);
		assert.equal(probe.snapshot().liveGlobal, 1);

		windowStub.dispatch('click');
		assert.equal(calls, 1, 'the application listener still ran');
		const snapshot = probe.snapshot();
		assert.equal(snapshot.liveGlobal, 0, 'the browser removes it, so the ledger must too');
		assert.equal(snapshot.released, 1);
	});

	it('releases the token when the AbortSignal aborts', () => {
		const { probe, windowStub } = loadProbe();
		const controller = new AbortController();
		windowStub.addEventListener('click', () => {}, { signal: controller.signal });
		assert.equal(probe.snapshot().liveGlobal, 1);

		controller.abort();
		const snapshot = probe.snapshot();
		assert.equal(snapshot.liveGlobal, 0);
		assert.equal(snapshot.released, 1);
	});

	it('never counts an aborted-signal registration as live', () => {
		const { probe, windowStub } = loadProbe();
		const controller = new AbortController();
		controller.abort();
		windowStub.addEventListener('click', () => {}, { signal: controller.signal });

		const snapshot = probe.snapshot();
		assert.equal(snapshot.liveGlobal, 0);
		assert.equal(snapshot.released, 1);
	});

	it('counts a detached node separately from a connected one', () => {
		const { probe, ConnectedNode } = loadProbe();
		const node = new ConnectedNode();
		node.addEventListener('click', () => {});
		const connected = probe.snapshot();
		assert.equal(connected.liveConnected, 1);
		assert.equal(connected.detached, 0);

		node.isConnected = false;
		const detached = probe.snapshot();
		assert.equal(detached.liveConnected, 0);
		assert.equal(detached.liveGlobal, 0);
		assert.equal(detached.detached, 1, 'an unmounted node is not a leak');
	});

	it('stamps a document identity that a reload increments and a client-side route change keeps', () => {
		resetSessionStorage();
		const first = loadProbe();
		const second = loadProbe();
		const third = loadProbe();
		assert.deepEqual(
			[first.probe, second.probe, third.probe].map((probe) => probe.snapshot().documentId),
			[1, 2, 3],
			'each fresh document increments the identity, so a reload is visible',
		);
		// The very same instance keeps its id across the samples one leg
		// takes on a single page, which is the case that must NOT fail.
		assert.equal(first.probe.snapshot().documentId, 1);
	});

	it('unbinds its own abort handler when the application removes the listener', () => {
		// A long-lived signal whose listeners the application removes one
		// by one would otherwise collect the probe handlers, which is
		// exactly the heap noise the probe exists to avoid. The count is
		// read as a DELTA because AbortSignal keeps its own internal
		// abort bookkeeping of its own.
		const { probe, windowStub } = loadProbe();
		const controller = new AbortController();
		const abortHandlers = () => getEventListeners(controller.signal, 'abort').length;
		const baseline = abortHandlers();
		for (let i = 0; i < 3; i += 1) {
			const listener = () => {};
			windowStub.addEventListener('click', listener, { signal: controller.signal });
			assert.equal(abortHandlers(), baseline + 1, 'one probe binding while it is live');
			windowStub.removeEventListener('click', listener);
			assert.equal(
				abortHandlers(),
				baseline,
				'the probe must not keep a handler on a signal it no longer accounts for',
			);
		}
		assert.equal(probe.snapshot().liveGlobal, 0);
	});

	it('replays a simulated client-side navigation without growth', () => {
		// The signature #488 measured: one extra `document` listener per
		// route change. The application here removes nothing, exactly
		// like the leaking flip script did, and the ledger must report
		// the growth so the driver can call it FAIL.
		const { probe, documentStub } = loadProbe();
		const reExecute = () => {
			const listener = () => {};
			documentStub.addEventListener('DOMContentLoaded', listener, { once: true });
		};
		assert.equal(probe.snapshot().liveGlobal, 0);
		for (let cycle = 1; cycle <= 3; cycle += 1) {
			reExecute();
			assert.equal(probe.snapshot().liveGlobal, cycle);
		}
	});
});

describe('document reload detection (a hard navigation must not read as PASS)', () => {
	it('reports every cycle whose sample came from a new document', () => {
		const reloads = documentReloadCycles([
			{ cycle: 0, documentId: 1, liveGlobal: 10 },
			{ cycle: 1, documentId: 1, liveGlobal: 12 },
			{ cycle: 2, documentId: 2, liveGlobal: 3 },
			{ cycle: 3, documentId: 2, liveGlobal: 5 },
		]);
		assert.deepEqual(reloads, [{ cycle: 2, from: 1, to: 2 }]);
		assert.deepEqual(documentReloadFailures('navigate', reloads), [
			'navigate cycle 2: the document was reloaded (documentId 1 -> 2); the ledger restarted, so this cycle measures a fresh page load and not a client-side transition',
		]);
	});

	it('reports nothing for a series that stayed in one document', () => {
		const series = [
			{ cycle: 0, documentId: 3, liveGlobal: 100 },
			{ cycle: 1, documentId: 3, liveGlobal: 102 },
			{ cycle: 2, documentId: 3, liveGlobal: 102 },
		];
		assert.deepEqual(documentReloadCycles(series), []);
		assert.deepEqual(documentReloadFailures('navigate', documentReloadCycles(series)), []);
	});

	it('treats a missing documentId as unknown, not as a reload', () => {
		assert.deepEqual(
			documentReloadCycles([
				{ cycle: 0, liveGlobal: 1 },
				{ cycle: 1, liveGlobal: 2 },
			]),
			[],
		);
	});

	it('turns a reload into a leg failure, so the verdict cannot be PASS', () => {
		const leg = {
			skipped: false,
			// Flat because every cycle started a NEW document — the exact
			// false green this case exists to reject.
			series: [
				{ cycle: 0, documentId: 1, liveGlobal: 10, liveConnected: 1 },
				{ cycle: 1, documentId: 2, liveGlobal: 10, liveConnected: 1 },
				{ cycle: 2, documentId: 3, liveGlobal: 10, liveConnected: 1 },
			],
			failures: documentReloadFailures(
				'navigate',
				documentReloadCycles([
					{ cycle: 0, documentId: 1, liveGlobal: 10, liveConnected: 1 },
					{ cycle: 1, documentId: 2, liveGlobal: 10, liveConnected: 1 },
					{ cycle: 2, documentId: 3, liveGlobal: 10, liveConnected: 1 },
				]),
			),
		};
		const verdict = evaluateProfile({ navigate: leg });
		assert.equal(verdict.status, 'FAIL');
		assert.equal(verdict.pass, false);
		assert.equal(verdict.failures.length, 2);
	});

	it('leaves a client-side series PASS (the control for the case above)', () => {
		const series = [
			{ cycle: 0, documentId: 1, liveGlobal: 10, liveConnected: 1 },
			{ cycle: 1, documentId: 1, liveGlobal: 12, liveConnected: 1 },
			{ cycle: 2, documentId: 1, liveGlobal: 12, liveConnected: 1 },
		];
		const verdict = evaluateProfile({ navigate: { skipped: false, series } });
		assert.equal(verdict.status, 'PASS');
	});
});

describe('an unreadable --compare input fails the run', () => {
	it('folds the read error into the verdict and the exit code path', () => {
		const verdict = withCompareFailure(
			{ pass: true, status: 'PASS', failures: [] },
			'.tmp/interaction-memory-profile/before.json',
			'ENOENT: no such file or directory',
		);
		assert.equal(verdict.pass, false);
		assert.equal(verdict.status, 'FAIL');
		assert.deepEqual(verdict.failures, [
			'--compare input could not be read: .tmp/interaction-memory-profile/before.json (ENOENT: no such file or directory)',
		]);
	});

	it('keeps the growth failures it already had', () => {
		const verdict = withCompareFailure(
			{ pass: false, status: 'FAIL', failures: ['navigate: liveGlobal grew'] },
			'x.json',
			'Unexpected token',
		);
		assert.deepEqual(verdict.failures, [
			'navigate: liveGlobal grew',
			'--compare input could not be read: x.json (Unexpected token)',
		]);
	});
});

describe('compareMeasurementConditions: the surface must be the real one', () => {
	const report = (overrides) => ({
		environment: {
			browser: 'Chromium 153.0.8010.12',
			cpuThrottlingRate: 4,
			networkProfile: { label: 'Slow 4G (CDP Network.emulateNetworkConditions)' },
			viewport: '1280x900',
			deviceScaleFactor: 1,
			surface: 'vite preview of `pnpm run build` (not a dev server)',
			...overrides,
		},
		options: { cycles: 5 },
	});

	it('passes for two runs of the same surface', () => {
		const result = compareMeasurementConditions(report(), report());
		assert.equal(result.comparable, true);
		assert.deepEqual(result.mismatches, []);
	});

	it('reports a caller-supplied --base-url surface as different', () => {
		// The same build served by a dev server is a different measurement;
		// recording `vite preview` for both used to make them comparable.
		const result = compareMeasurementConditions(
			report({ surface: 'caller-supplied --base-url (not booted by this harness)' }),
			report(),
		);
		assert.equal(result.comparable, false);
		assert.deepEqual(
			result.mismatches.map((mismatch) => mismatch.field),
			['surface'],
		);
	});

	it('keeps reporting the other condition mismatches', () => {
		const result = compareMeasurementConditions(report({ viewport: '390x844' }), report());
		assert.deepEqual(
			result.mismatches.map((mismatch) => mismatch.field),
			['viewport'],
		);
	});
});
