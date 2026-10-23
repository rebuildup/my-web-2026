/**
 * The Issue #405 capture's own unit tests.
 *
 * The capture is a browser-side ASSERTION, so the parts that decide
 * whether the artefact may be written have to be testable without a
 * browser: a capture that can only fail inside Chromium is a capture
 * nobody re-runs when it breaks.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	STEPS,
	assertWebpOutputPath,
	evaluateObservation,
	harnessIndexHtml,
	resolveStaticTarget,
	screenshotBudgetVerdict,
} from './capture-a11y-live-region.mjs';

const STATUS = {
	role: 'status',
	ariaLive: 'polite',
	ariaAtomic: 'true',
	present: true,
};
const ALERT = { role: 'alert', ariaLive: null, ariaAtomic: null, present: false, text: '' };

/**
 * A synthetic run that matches every expectation.
 *
 * `mutations` only grows when the region's content changes; the pending
 * steps do not mutate because `aria-busy` is an attribute change.
 */
function conformingObservations() {
	const row = (id, overrides = {}) => ({
		id,
		state: id,
		mutations: 0,
		status: { ...STATUS, ariaBusy: 'false', text: 'No reactions yet' },
		alert: { ...ALERT },
		...overrides,
	});
	return [
		row('idle'),
		row('pending', {
			mutations: 0,
			status: { ...STATUS, ariaBusy: 'true', text: 'No reactions yet' },
		}),
		row('success', {
			mutations: 3,
			status: { ...STATUS, ariaBusy: 'false', text: 'thumbs_up 1' },
		}),
		row('settled', {
			mutations: 3,
			status: { ...STATUS, ariaBusy: 'false', text: 'thumbs_up 1' },
		}),
		row('fail-pending', {
			mutations: 3,
			status: { ...STATUS, ariaBusy: 'true', text: 'thumbs_up 1' },
		}),
		row('fail-alert', {
			mutations: 3,
			status: { ...STATUS, ariaBusy: 'false', text: 'thumbs_up 1' },
			alert: { ...ALERT, present: true, text: 'Reaction could not be sent' },
		}),
		row('empty-pending', {
			mutations: 3,
			status: { ...STATUS, ariaBusy: 'true', text: 'thumbs_up 1' },
		}),
		row('empty-settled', {
			mutations: 5,
			status: { ...STATUS, ariaBusy: 'false', text: 'No reactions yet' },
		}),
		row('narrow', {
			mutations: 5,
			status: { ...STATUS, ariaBusy: 'false', text: 'No reactions yet' },
		}),
	];
}

test('a non-WebP output path is refused', () => {
	assert.throws(
		() => assertWebpOutputPath('docs/verification/a11y/live-region-state.png'),
		/refusing to write a non-WebP/,
	);
	assert.throws(() => assertWebpOutputPath('../outside.webp'), /refusing to write outside/);
});

test('the budget verdict is computed from the byte count', () => {
	assert.equal(screenshotBudgetVerdict(1024).withinBudget, true);
	assert.equal(screenshotBudgetVerdict(1024 * 1024).withinBudget, false);
});

test('every step is on the screen', () => {
	const html = harnessIndexHtml();

	for (const step of STEPS) {
		assert.ok(html.includes(`<code>${step.id}</code>`), `${step.id} must be rendered`);
	}
	assert.ok(html.includes('role="status"'));
	assert.ok(html.includes('role="alert"'));
});

test('the conforming run satisfies the observations', () => {
	const verdict = evaluateObservation(conformingObservations());

	assert.equal(verdict.ok, true, verdict.failures.join('; '));
	assert.equal(verdict.rows.length, STEPS.length);
});

test('an assertive status region is a failure', () => {
	const observations = conformingObservations();
	observations[0].status.ariaLive = 'assertive';

	const verdict = evaluateObservation(observations);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /assertive/.test(failure)));
});

test('a pending step without aria-busy is a failure', () => {
	const observations = conformingObservations();
	observations.find((entry) => entry.id === 'pending').status.ariaBusy = 'false';

	const verdict = evaluateObservation(observations);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /pending: aria-busy/.test(failure)));
});

test('a success that does not mutate the region is a failure', () => {
	const observations = conformingObservations();
	const success = observations.find((entry) => entry.id === 'success');
	success.mutations = 0;
	success.status.text = 'No reactions yet';

	const verdict = evaluateObservation(observations);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /success/.test(failure)));
});

test('a settled result that mutates the region again is a failure', () => {
	const observations = conformingObservations();
	observations.find((entry) => entry.id === 'settled').mutations = 4;

	const verdict = evaluateObservation(observations);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /settled: the region mutated again/.test(failure)));
});

test('a failure that is not a role="alert" is a failure', () => {
	const observations = conformingObservations();
	observations.find((entry) => entry.id === 'fail-alert').alert = {
		...ALERT,
		present: true,
		role: null,
	};

	const verdict = evaluateObservation(observations);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /not exposed as a role="alert"/.test(failure)));
});

test('a failure that changes the status region is a failure', () => {
	const observations = conformingObservations();
	const failAlert = observations.find((entry) => entry.id === 'fail-alert');
	failAlert.status.text = 'Reaction could not be sent';
	failAlert.alert = { ...ALERT, present: true, role: 'alert' };

	const verdict = evaluateObservation(observations);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /double announcement/.test(failure)));
});

test('a missing step is a failure', () => {
	const verdict = evaluateObservation([]);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /was not observed/.test(failure)));
});

test('the static server refuses to escape its root', () => {
	assert.notEqual(resolveStaticTarget('/tmp', '/../../etc/passwd').status, 200);
});
