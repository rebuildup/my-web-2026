/**
 * The Issue #394 capture's own unit tests.
 *
 * The capture is an assertion, not only a screenshot: `evaluateObservation`
 * decides whether an artefact may be written at all. A decision function
 * that can only fail inside Chromium is one nobody re-runs when it breaks,
 * so the pure parts are tested here — the same rule the sibling capture
 * scripts follow.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	MAX_TAB_STOPS,
	MIN_TAB_STOPS,
	PANEL_WIDTH,
	SCREENSHOT_BUDGET_BYTES,
	SCREENSHOT_MAX_WIDTH,
	WCAG_MAPPING,
	assertWebpOutputPath,
	escapeXml,
	evaluateObservation,
	evidencePanelSvg,
	headerSvg,
	isSupportingElement,
	screenshotBudgetVerdict,
	tabOrderRows,
} from './capture-a11y-keyboard-nav.mjs';

/** One healthy observation, as the browser would report it. */
function healthyObservation(overrides = {}) {
	return {
		route: '/',
		tabOrder: [
			{ tag: 'A', href: '#main', label: '本文へスキップ' },
			{ tag: 'A', href: '/about', label: '自己紹介' },
			{ tag: 'A', href: '/portfolio', label: 'ポートフォリオ' },
			{ tag: 'BUTTON', href: null, label: '許可する' },
			{ tag: 'BUTTON', href: null, label: '拒否する' },
		],
		wrapped: true,
		skipLinkFocusRingVisible: true,
		menuFocusReturnedToTrigger: true,
		dialogFocusTrapped: true,
		dialogEscapeClosed: true,
		dialogFocusReturnedToTrigger: true,
		...overrides,
	};
}

test('a healthy observation passes', () => {
	const verdict = evaluateObservation(healthyObservation());

	assert.equal(verdict.ok, true);
	assert.deepEqual(verdict.failures, []);
});

test('the first Tab stop must be the skip link', () => {
	const verdict = evaluateObservation(
		healthyObservation({
			tabOrder: [{ tag: 'A', href: '/about', label: '自己紹介' }],
		}),
	);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => failure.includes('SC 2.4.1')));
});

test('too few Tab stops fail instead of verifying a page with no keyboard path', () => {
	const verdict = evaluateObservation(
		healthyObservation({ tabOrder: healthyObservation().tabOrder.slice(0, MIN_TAB_STOPS - 1) }),
	);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => failure.includes('Tab stop')));
});

test('a focus that fell onto a supporting element fails', () => {
	const verdict = evaluateObservation(
		healthyObservation({
			tabOrder: [...healthyObservation().tabOrder, { tag: 'BODY', href: null, label: '' }],
		}),
	);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => failure.includes('supporting element')));
});

test('a walk that does not wrap fails', () => {
	const verdict = evaluateObservation(healthyObservation({ wrapped: false }));

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => failure.includes('wrap')));
});

test('an invisible skip-link focus ring fails', () => {
	const verdict = evaluateObservation(healthyObservation({ skipLinkFocusRingVisible: false }));

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => failure.includes('SC 2.4.7')));
});

test('a mobile menu that keeps the focus fails', () => {
	const verdict = evaluateObservation(healthyObservation({ menuFocusReturnedToTrigger: false }));

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => failure.includes('mobile menu')));
});

test('a dialog that lets the focus escape fails', () => {
	const verdict = evaluateObservation(healthyObservation({ dialogFocusTrapped: false }));

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => failure.includes('SC 2.1.2')));
});

test('a dialog that Escape does not close fails', () => {
	const verdict = evaluateObservation(healthyObservation({ dialogEscapeClosed: false }));

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => failure.includes('Escape')));
});

test('a dialog that does not hand the focus back fails', () => {
	const verdict = evaluateObservation(healthyObservation({ dialogFocusReturnedToTrigger: false }));

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => failure.includes('trigger')));
});

test('the capture refuses any artefact path that is not WebP inside the repo', () => {
	assert.throws(
		() => assertWebpOutputPath('docs/verification/a11y/keyboard-navigation.png'),
		/non-WebP/,
	);
	assert.throws(() => assertWebpOutputPath('../outside.webp'), /outside the repository/);
	assert.equal(
		assertWebpOutputPath('docs/verification/a11y/keyboard-navigation.webp'),
		'docs/verification/a11y/keyboard-navigation.webp',
	);
});

test('the screenshot budget is the one the Issue policy states', () => {
	assert.ok(SCREENSHOT_BUDGET_BYTES > 0);
	assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES).withinBudget, true);
	assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES + 1).withinBudget, false);
});

test('a supporting element means "the focus is not on a control"', () => {
	assert.equal(isSupportingElement('BODY'), true);
	assert.equal(isSupportingElement('HTML'), true);
	assert.equal(isSupportingElement('NONE'), true);
	assert.equal(isSupportingElement('A'), false);
	assert.equal(isSupportingElement('BUTTON'), false);
});

test('the recorded order is rendered one row per stop', () => {
	const rows = tabOrderRows(healthyObservation().tabOrder);

	assert.equal(rows.length, 5);
	assert.match(rows[0], /#main/);
	assert.match(rows[4], /拒否する/);
});

test('the header states what was and was not measured', () => {
	const header = headerSvg({ observation: healthyObservation(), width: SCREENSHOT_MAX_WIDTH });

	assert.match(header.svg, /machine-checked/);
	assert.match(header.svg, /not machine-checked/);
	assert.match(header.svg, /picker dialog keeps the focus inside/);
});

test('the evidence panel names the WCAG mapping and separates human evaluation', () => {
	const panel = evidencePanelSvg({
		observation: healthyObservation(),
		width: PANEL_WIDTH,
	});

	for (const entry of WCAG_MAPPING) {
		assert.ok(panel.svg.includes(`${entry.sc} ${entry.level}`));
	}
	assert.match(panel.svg, /machine-checked \(Issue #394\)/);
	assert.match(panel.svg, /human evaluation \(not measured here\)/);
	assert.match(panel.svg, /picker dialog keeps the focus inside/);
	assert.ok(panel.height > 100);
});

test('text drawn into an SVG band is escaped', () => {
	assert.equal(escapeXml('<script> & "x"'), '&lt;script&gt; &amp; &quot;x&quot;');
	assert.doesNotMatch(escapeXml('a < b & c'), /[<>](?!\w)/);
});

test('the walk bounds are the ones the spec uses', () => {
	assert.ok(MAX_TAB_STOPS >= MIN_TAB_STOPS);
	assert.ok(MIN_TAB_STOPS >= 5);
});
