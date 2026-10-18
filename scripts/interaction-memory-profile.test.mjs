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
import { describe, it } from 'node:test';
import {
	DEFAULT_WARMUP_CYCLES,
	GROWTH_METRICS,
	LISTENER_GROWTH_TOLERANCE,
	LISTENER_PROBE_SOURCE,
	describeGrowth,
	evaluateListenerGrowth,
	evaluateProfile,
	parseArgs,
	screenshotBudgetVerdict,
	topEntries,
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
					{ liveGlobal: 146 + cycle, liveConnected: 3 },
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
	it('keeps a skipped leg out of the verdict instead of counting it as a pass', () => {
		const profile = evaluateProfile({
			react: { skipped: true, skippedReason: 'widget disabled', series: [] },
			navigate: { skipped: false, series: series({}, 4) },
		});
		assert.equal(profile.pass, true, 'the measured leg is the one that decides');
		assert.equal(profile.verdicts.react.pass, null);
		assert.equal(profile.verdicts.react.skipped, true);
		assert.match(profile.verdicts.react.reason, /widget disabled/);
		assert.equal(profile.verdicts.navigate.pass, true);
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

	it('rejects an unknown option instead of ignoring it', () => {
		assert.throws(() => parseArgs(['--nope=1']), /unknown option: --nope=1/);
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
});
