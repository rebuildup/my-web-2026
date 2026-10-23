/**
 * The Issue #395 capture script's own unit tests.
 *
 * The capture is an ASSERTION, not only a screenshot: it compares the
 * focus state the browser measured with the state the contract demands.
 * That comparison is pure, so it can be tested without Chromium — a rule
 * that can only fail inside a browser is a rule nobody re-runs when it
 * breaks.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	ARTEFACT,
	OFFSET_PROPERTY,
	SCREENSHOT_BUDGET_BYTES,
	SCREENSHOT_MAX_WIDTH,
	assertWebpOutputPath,
	compensationCss,
	evaluateScenarios,
	harnessHtml,
	readShippedCompensation,
	readShippedFocusRing,
} from './capture-a11y-focus-visible.mjs';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

/** A measured state, as the browser reports it. */
function state(overrides = {}) {
	return {
		activeElementId: 'focus-target',
		outlineStyle: 'solid',
		outlineWidth: '2px',
		outlineColor: 'rgb(2, 132, 199)',
		outlineOffset: '2px',
		rectTop: 548,
		rectBottom: 600,
		viewportHeight: 600,
		overlayTop: 460,
		overlayBottom: 600,
		topElementAtCentre: 'focus-overlay',
		obscured: true,
		...overrides,
	};
}

test('the capture refuses a non-WebP artefact path', () => {
	assert.throws(() => assertWebpOutputPath('docs/verification/a11y/focus-visible.png'), /WebP/);
	assert.throws(() => assertWebpOutputPath('docs/verification/a11y/focus-visible.png'), /refusing/);
	assert.equal(
		assertWebpOutputPath('docs/verification/a11y/focus-visible.webp'),
		'docs/verification/a11y/focus-visible.webp',
	);
});

test('the capture refuses to write outside the repository', () => {
	assert.throws(() => assertWebpOutputPath('../escape.webp'), /outside the repository/);
});

test('the committed artefact is the WebP the Issue names', () => {
	assert.match(ARTEFACT, /\.webp$/);
	assert.equal(ARTEFACT, 'docs/verification/a11y/focus-visible.webp');
});

test('the shipped compensation is read from the stylesheet, not from a constant', () => {
	const stylesheet = readFileSync(join(REPO_ROOT, 'src/styles.css'), 'utf8');
	const rules = readShippedCompensation(stylesheet);

	assert.ok(rules.length > 0, 'the stylesheet must declare the compensation');
	const selectors = rules.map((rule) => rule.selector);
	assert.ok(selectors.includes(':root'));
	assert.ok(selectors.includes('body'));
	for (const rule of rules) {
		const consumes = rule.declarations.some((declaration) =>
			declaration.value.includes(`var(${OFFSET_PROPERTY}`),
		);
		assert.ok(consumes, `${rule.selector} must consume the offset property`);
	}
});

test('a stylesheet without the compensation yields no rule', () => {
	const rules = readShippedCompensation('body { color: red; }');
	assert.deepEqual(rules, []);
});

test('a comment that names the compensation is not a compensation', () => {
	const rules = readShippedCompensation(
		`/* scroll-padding-bottom: var(${OFFSET_PROPERTY}, 0px); */\nbody { color: red; }`,
	);
	assert.deepEqual(rules, []);
});

test('the two states differ only by the compensation', () => {
	const rules = readShippedCompensation(readFileSync(join(REPO_ROOT, 'src/styles.css'), 'utf8'));
	const uncompensated = compensationCss(rules, { enabled: false });
	const compensated = compensationCss(rules, { enabled: true });

	assert.notEqual(uncompensated, compensated);
	assert.ok(!uncompensated.includes(`var(${OFFSET_PROPERTY}`));
	assert.ok(compensated.includes(`var(${OFFSET_PROPERTY}`));
	// The canvas declaration is part of the same shipped rule, and it
	// stays in both states — otherwise the two screenshots would differ
	// in more than the compensation.
	assert.ok(uncompensated.includes('--colors-bg-canvas'));
});

test('the focus ring is read from the shipped navigation', () => {
	const navigation = readFileSync(join(REPO_ROOT, 'src/editorial/nav/PublicNav.tsx'), 'utf8');
	const ring = readShippedFocusRing(navigation, { focusColor: '#0284c7' });

	assert.ok(ring, 'the navigation must declare a focus outline');
	assert.equal(ring.condition, '_focusVisible');
	assert.equal(ring.value, '2px solid #0284c7');
});

test('a navigation without a focus ring yields nothing', () => {
	assert.equal(
		readShippedFocusRing('export const A = () => <div />;', { focusColor: '#0284c7' }),
		null,
	);
});

test('the harness renders the element under test and the overlay', () => {
	const html = harnessHtml({
		rules: readShippedCompensation(readFileSync(join(REPO_ROOT, 'src/styles.css'), 'utf8')),
		enabled: true,
		canvas: '#ffffff',
		focusColor: '#0284c7',
		textColor: '#0f172a',
	});

	assert.match(html, /id="focus-target"/);
	assert.match(html, /id="focus-overlay"/);
	assert.match(html, /position: fixed/);
	assert.match(html, /outline: 2px solid var\(--colors-border-focus\)/);
});

test('a state that does not reproduce the defect is a failure', () => {
	const verdict = evaluateScenarios({
		states: {
			uncompensated: state({ obscured: false, topElementAtCentre: 'focus-target' }),
			compensated: state({ obscured: false, topElementAtCentre: 'focus-target' }),
		},
	});

	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /does not reproduce the defect/);
});

test('a state that stays obscured with the compensation is a failure', () => {
	const verdict = evaluateScenarios({
		states: {
			uncompensated: state(),
			compensated: state(),
		},
	});

	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /still covered by the overlay/);
});

test('an invisible focus indicator is a failure', () => {
	const verdict = evaluateScenarios({
		states: {
			uncompensated: state({ outlineStyle: 'none' }),
			compensated: state({ obscured: false, topElementAtCentre: 'focus-target' }),
		},
	});

	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /not visible/);
});

test('the two measured states that prove the contract pass', () => {
	const verdict = evaluateScenarios({
		states: {
			uncompensated: state(),
			compensated: state({
				rectTop: 408,
				rectBottom: 460,
				topElementAtCentre: 'focus-target',
				obscured: false,
			}),
		},
	});

	assert.deepEqual(verdict.failures, []);
	assert.equal(verdict.ok, true);
});

test('the artefact budget is a WebP budget', () => {
	assert.ok(SCREENSHOT_MAX_WIDTH <= 1600);
	assert.ok(SCREENSHOT_BUDGET_BYTES > 0);
});

test('the capture reads this repository, not a copy of it', () => {
	// Deliberately NOT an assertion about the DIRECTORY name: this
	// repository is worked on through `git worktree`, so the checkout
	// directory is `my-web-2026-wt/<issue>` in one machine and something
	// else in another. The package NAME is the stable identity.
	const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
	assert.equal(manifest.name, 'my-web-2026');
});
