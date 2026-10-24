/**
 * The Issue #406 capture script's own unit tests.
 *
 * The capture is an ASSERTION, not only a screenshot: it compares the
 * focus state the browser measured with the state the contract demands.
 * That comparison is pure, so it can be tested without Chromium — a rule
 * that can only fail inside a browser is a rule nobody re-runs when it
 * breaks.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	ARTEFACT,
	DEVICE_SCALE_FACTOR,
	VIEWPORT,
	WCAG_MAPPING,
	assertWebpOutputPath,
	evaluateObservation,
	evidencePanelSvg,
	headerSvg,
} from './capture-a11y-dialog-focus.mjs';

/** One healthy observation, as the browser would report it. */
function healthyObservation(overrides = {}) {
	return {
		dialogIsModal: true,
		focusTrapped: true,
		backgroundInert: true,
		escapeClosed: true,
		focusReturnedToTrigger: true,
		activeAfterEscape: { tag: 'BUTTON', testId: 'design-system-reaction-picker-open' },
		negativeControlOk: false,
		...overrides,
	};
}

test('a healthy observation passes', () => {
	const verdict = evaluateObservation(healthyObservation());

	assert.deepEqual(verdict.failures, []);
	assert.equal(verdict.ok, true);
});

test('a non-modal dialog fails the verdict', () => {
	const verdict = evaluateObservation(healthyObservation({ dialogIsModal: false }));

	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /not modal/);
});

test('a dialog that does not trap the focus fails the verdict', () => {
	const verdict = evaluateObservation(healthyObservation({ focusTrapped: false }));

	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /trapped/);
});

test('a dialog whose background is not inert fails the verdict', () => {
	const verdict = evaluateObservation(healthyObservation({ backgroundInert: false }));

	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /background is not inert/);
});

test('a dialog that Escape does not close fails the verdict', () => {
	const verdict = evaluateObservation(healthyObservation({ escapeClosed: false }));

	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /Escape did not close/);
});

test('a dialog that does not return the focus fails the verdict', () => {
	const verdict = evaluateObservation(healthyObservation({ focusReturnedToTrigger: false }));

	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /focus did not return/);
});

test('the negative control (a non-modal open) is not a healthy observation', () => {
	const verdict = evaluateObservation(
		healthyObservation({
			dialogIsModal: false,
			backgroundInert: false,
			escapeClosed: false,
			focusReturnedToTrigger: false,
		}),
	);

	assert.equal(verdict.ok, false);
});

test('the capture refuses a non-WebP artefact path', () => {
	assert.throws(
		() => assertWebpOutputPath('docs/verification/a11y/dialog-focus-return.png'),
		/WebP/,
	);
	assert.equal(
		assertWebpOutputPath('docs/verification/a11y/dialog-focus.webp'),
		'docs/verification/a11y/dialog-focus.webp',
	);
});

test('the capture refuses to write outside the repository', () => {
	assert.throws(() => assertWebpOutputPath('../escape.webp'), /outside the repository/);
});

test('the committed artefact is the WebP the Issue names', () => {
	assert.match(ARTEFACT, /\.webp$/);
	assert.equal(ARTEFACT, 'docs/verification/a11y/dialog-focus.webp');
});

test('the measured geometry is the desktop viewport the doc states', () => {
	assert.equal(VIEWPORT.width, 1280);
	assert.equal(VIEWPORT.height, 900);
	assert.equal(DEVICE_SCALE_FACTOR, 2);
});

test('the header names the WCAG mapping and separates human evaluation', () => {
	const { height, svg } = headerSvg({ observation: healthyObservation() });

	assert.ok(height > 80);
	assert.match(svg, /Issue #406/);
	assert.match(svg, /SC 2\.1\.2/);
	assert.match(svg, /not machine-checked/);
});

test('the evidence panel lists the contract and the negative control', () => {
	const panel = evidencePanelSvg({ observation: healthyObservation(), width: 700 });

	assert.match(panel.svg, /dialog is modal/);
	assert.match(panel.svg, /negative control/);
	assert.match(panel.svg, /human evaluation/);
	assert.ok(panel.height > 100);
});

test('the WCAG mapping names the three criteria the Issue fixes', () => {
	assert.deepEqual(
		WCAG_MAPPING.map((entry) => entry.sc),
		['2.1.2', '2.4.3', '2.4.7'],
	);
});
