/**
 * The Issue #400 capture's own unit tests.
 *
 * The capture is a browser-side ASSERTION, so the parts that decide
 * whether the artefact may be written have to be testable without a
 * browser: a capture that can only fail inside Chromium is a capture
 * nobody re-runs when it breaks.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	EXPECTED_CASES,
	STAGES,
	assertWebpOutputPath,
	evaluateObservation,
	harnessIndexHtml,
	overflowOf,
	resolveStaticTarget,
	screenshotBudgetVerdict,
} from './capture-a11y-reflow.mjs';

/** A synthetic browser observation that matches every expectation. */
function conformingObservation() {
	return {
		viewportWidth: 1600,
		documentWidth: 1600,
		cases: EXPECTED_CASES.flatMap((entry) =>
			STAGES.map((stage) => ({
				id: entry.id,
				stage: stage.id,
				group: entry.group,
				expectOverflow: entry.expectOverflow,
				clientWidth: 306,
				scrollWidth: entry.expectOverflow ? 720 : 306,
			})),
		),
	};
}

test('a non-WebP output path is refused', () => {
	assert.throws(
		() => assertWebpOutputPath('docs/verification/a11y/reflow-400-percent.png'),
		/refusing to write a non-WebP/,
	);
	assert.throws(() => assertWebpOutputPath('../outside.webp'), /refusing to write outside/);
});

test('the budget verdict is computed from the byte count', () => {
	assert.equal(screenshotBudgetVerdict(1024).withinBudget, true);
	assert.equal(screenshotBudgetVerdict(1024 * 1024).withinBudget, false);
});

test('every expected specimen is on the screen, in both stages, showing both sides', () => {
	const html = harnessIndexHtml();

	for (const entry of EXPECTED_CASES) {
		for (const stage of STAGES) {
			assert.ok(
				html.includes(`data-case="${entry.id}" data-stage="${stage.id}"`),
				`${entry.id} must be rendered in ${stage.id}`,
			);
		}
	}
	assert.ok(EXPECTED_CASES.some((entry) => entry.group === 'shipped contract'));
	assert.ok(EXPECTED_CASES.some((entry) => entry.group === 'reproduced defect'));
});

test('the shipped contract plus the reproduced defects satisfies the observations', () => {
	const verdict = evaluateObservation(conformingObservation());

	assert.equal(verdict.ok, true, verdict.failures.join('; '));
	assert.equal(verdict.rows.length, EXPECTED_CASES.length * STAGES.length);
});

test('a shipped-contract specimen that overflows is a failure', () => {
	const observation = conformingObservation();
	const entry = observation.cases.find((candidate) => candidate.id === 'pass-long-word');
	entry.scrollWidth = 720;

	const verdict = evaluateObservation(observation);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /pass-long-word.*overflows/.test(failure)));
});

test('a reproduced defect that stops overflowing is a failure (the negative control)', () => {
	const observation = conformingObservation();
	const entry = observation.cases.find((candidate) => candidate.id === 'fail-without-break');
	entry.scrollWidth = entry.clientWidth;

	const verdict = evaluateObservation(observation);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /fail-without-break.*fits/.test(failure)));
});

test('a missing specimen is a failure', () => {
	const verdict = evaluateObservation({ viewportWidth: 1600, documentWidth: 1600, cases: [] });

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /was not rendered/.test(failure)));
});

test('a document that scrolls horizontally is a failure', () => {
	const observation = conformingObservation();
	observation.documentWidth = 1810;

	const verdict = evaluateObservation(observation);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /scrolls horizontally/.test(failure)));
});

test('the overflow comparison has a 1 px tolerance', () => {
	assert.equal(overflowOf({ scrollWidth: 307, clientWidth: 306 }), false);
	assert.equal(overflowOf({ scrollWidth: 308, clientWidth: 306 }), true);
});

test('the static server refuses to escape its root', () => {
	assert.notEqual(resolveStaticTarget('/tmp', '/../../etc/passwd').status, 200);
});
