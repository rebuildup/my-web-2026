/**
 * The Issue #398 capture's own unit tests.
 *
 * The capture is an ASSERTION as well as a screenshot: it reads the
 * rendered DOM back out of Chromium and applies the same five rules
 * the source gate applies. Those rules and the specimen expectations
 * are pure, so they are tested here without a browser.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectEvidence } from './check-a11y-heading-landmarks.mjs';
import {
	RULES,
	SPECIMENS,
	assertWebpOutputPath,
	evaluateObservation,
	evaluateRenderedOutline,
	evidencePanelSvg,
	harnessIndexHtml,
	screenshotBudgetVerdict,
} from './capture-a11y-heading-landmarks.mjs';

test('a conforming outline reports no rule', () => {
	assert.deepEqual(evaluateRenderedOutline({ headings: [1, 2, 3], mains: 1 }), []);
});

test('the rendered facts decide the same five rules as the source gate', () => {
	assert.deepEqual(evaluateRenderedOutline({ headings: [1, 1], mains: 1 }), ['page-multiple-h1']);
	assert.deepEqual(evaluateRenderedOutline({ headings: [2], mains: 1 }), ['page-missing-h1']);
	assert.deepEqual(evaluateRenderedOutline({ headings: [1, 3], mains: 1 }), [
		'page-heading-level-skip',
	]);
	assert.deepEqual(evaluateRenderedOutline({ headings: [1], mains: 0 }), ['page-missing-landmark']);
	assert.deepEqual(evaluateRenderedOutline({ headings: [1], mains: 2 }), ['landmark-duplicated']);
});

test('the specimens declare the facts the capture asserts', () => {
	assert.equal(SPECIMENS.length, 2);
	for (const specimen of SPECIMENS) {
		assert.deepEqual(
			evaluateRenderedOutline({
				headings: specimen.expected.headings,
				mains: specimen.expected.mains,
			}),
			specimen.expected.violations,
		);
	}
	// The two panes must not agree, or the screen compares nothing.
	assert.deepEqual(SPECIMENS[0].expected.violations, []);
	assert.ok(SPECIMENS[1].expected.violations.length > 0);
});

test('a specimen that stopped rendering what it claims fails the capture', () => {
	const verdict = evaluateObservation({
		conforming: { headings: [1, 2, 3], mains: 0 },
		violating: { headings: [1, 1, 3], mains: 0 },
	});

	assert.equal(verdict.ok, false);
	// The missing landmark is both a wrong fact and a wrong verdict, so
	// the capture reports both.
	assert.equal(verdict.failures.length, 2);
	assert.ok(verdict.failures.every((failure) => /conforming/.test(failure)));
});

test('the capture refuses a non-WebP artefact path', () => {
	assert.throws(() => assertWebpOutputPath('docs/verification/a11y/heading-landmarks.png'), /WebP/);
	assert.equal(
		assertWebpOutputPath('docs/verification/a11y/heading-landmarks.webp'),
		'docs/verification/a11y/heading-landmarks.webp',
	);
});

test('the harness renders both specimens', () => {
	const html = harnessIndexHtml();

	assert.match(html, /data-specimen="conforming"/);
	assert.match(html, /data-specimen="violating"/);
	assert.match(html, /<main/);
});

test('the capture states the artefact budget', () => {
	const verdict = screenshotBudgetVerdict(100 * 1024);

	assert.equal(verdict.withinBudget, true);
	assert.equal(screenshotBudgetVerdict(400 * 1024).withinBudget, false);
});

test('the capture speaks the gate rule names', () => {
	assert.deepEqual(RULES, [
		'page-multiple-h1',
		'page-missing-h1',
		'page-heading-level-skip',
		'page-missing-landmark',
		'landmark-duplicated',
	]);
});

test('the evidence panel prints the declared exemption with its reason', () => {
	// The artefact shows the gate's own state, so a declared
	// exemption cannot be a line only the terminal shows.
	const gate = collectEvidence();
	const panel = evidencePanelSvg({ observation: null, gate, width: 780 });

	assert.match(panel.svg, /exempted rules \(declared, with the reason\)/);
	assert.ok(gate.exemptions.length > 0);
	for (const exemption of gate.exemptions) {
		assert.ok(panel.svg.includes(exemption.reason), 'the reason must be printed');
		assert.ok(panel.svg.includes(`${exemption.unit}: ${exemption.rule}`));
	}
});
