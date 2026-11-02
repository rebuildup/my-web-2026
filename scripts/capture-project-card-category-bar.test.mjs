import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	CAPTURES,
	CATEGORY_WORD,
	CUES_TEST_ID,
	MONOCHROME_TEST_ID,
	STORY_EXPORT,
	STORY_MODULE,
	artefactPath,
	contrastRatio,
	evaluateObservation,
	harnessMainTsx,
	parseRgb,
	relativeLuminance,
} from './capture-project-card-category-bar.mjs';

/**
 * Capture-harness invariants for the Issue #794 verification artefact.
 *
 * The harness is what produces the committed before / after screenshots,
 * so what this file guards is the POLICY that makes them evidence: the
 * label must assert the state it claims (a `before` run taken from the
 * changed tree has to fail), the removed cue must be absent in `after`
 * and present in `before`, and the non-colour channel must be intact in
 * both.
 *
 * There is no Chromium here. Driving a browser is the heavy local step
 * (`node scripts/capture-project-card-category-bar.mjs --label=after`);
 * what must not regress silently is pure.
 */

/** A card row as `READ_CARDS` reports it. */
function card(category, overrides = {}) {
	return {
		category,
		className: 'bg-c_bg.surface',
		background: 'rgb(248, 250, 252)',
		borderInlineStartWidth: '0px',
		absoluteDecorations: [],
		marks: [category],
		text: `${CATEGORY_WORD[category]} A project`,
		...overrides,
	};
}

/** A compliant after-state observation for the four categories. */
function afterObservation() {
	return {
		canvas: 'rgb(255, 255, 255)',
		colorScheme: 'light',
		cards: ['design', 'code', 'tool', 'writing'].map((category) => card(category)),
	};
}

/** A compliant before-state observation: the bar and its hue are present. */
function beforeObservation() {
	return {
		canvas: 'rgb(255, 255, 255)',
		colorScheme: 'light',
		cards: ['design', 'code', 'tool', 'writing'].map((category) =>
			card(category, {
				className: '',
				background: 'rgba(0, 0, 0, 0)',
				absoluteDecorations: [{ width: 4, height: 180, className: 'bg-c_accent.category.design' }],
			}),
		),
	};
}

describe('capture-project-card-category-bar — artefact paths', () => {
	it('names every artefact after the label and the condition', () => {
		for (const condition of CAPTURES) {
			const path = artefactPath('docs/verification/portfolio', 'after', condition.id);
			assert.match(path, /^docs\/verification\/portfolio\/project-card-category-after-.+\.webp$/);
			assert.ok(path.includes(condition.id));
		}
	});

	it('keeps the before and after artefacts apart', () => {
		const before = artefactPath('docs/verification/portfolio', 'before', 'desktop-light');
		const after = artefactPath('docs/verification/portfolio', 'after', 'desktop-light');
		assert.notEqual(before, after);
	});
});

describe('capture-project-card-category-bar — colour maths', () => {
	it('reads rgb and rgba values', () => {
		assert.deepEqual(parseRgb('rgb(248, 250, 252)'), { r: 248, g: 250, b: 252, a: 1 });
		assert.deepEqual(parseRgb('rgba(0, 0, 0, 0)'), { r: 0, g: 0, b: 0, a: 0 });
		assert.equal(parseRgb('transparent'), null);
	});

	it('computes the WCAG extremes', () => {
		assert.equal(contrastRatio('rgb(255, 255, 255)', 'rgb(0, 0, 0)'), 21);
		assert.equal(contrastRatio('rgb(255, 255, 255)', 'rgb(255, 255, 255)'), 1);
		assert.ok(
			relativeLuminance({ r: 255, g: 255, b: 255 }) > relativeLuminance({ r: 0, g: 0, b: 0 }),
		);
	});

	it('refuses to score a transparent plane', () => {
		// A card with no fill of its own has no plane to compare; returning a
		// number here would manufacture the very evidence the capture exists
		// to collect.
		assert.equal(contrastRatio('rgba(0, 0, 0, 0)', 'rgb(255, 255, 255)'), null);
	});
});

describe('capture-project-card-category-bar — label contract', () => {
	it('accepts an after capture with the bar gone and a fill in its place', () => {
		const verdict = evaluateObservation({
			label: 'after',
			observations: { 'desktop-light': afterObservation() },
		});
		assert.deepEqual(verdict.failures, []);
		assert.equal(verdict.ok, true);
		assert.match(verdict.summary.join('\n'), /plane rgb\(248, 250, 252\) vs canvas/);
	});

	it('accepts a before capture that still has the absolute bar and its hue', () => {
		const verdict = evaluateObservation({
			label: 'before',
			observations: { 'desktop-light': beforeObservation() },
		});
		assert.deepEqual(verdict.failures, []);
	});

	it('rejects a before capture that was really taken after the change', () => {
		const verdict = evaluateObservation({
			label: 'before',
			observations: { 'desktop-light': afterObservation() },
		});
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((line) => /expected the 1 baseline bar/.test(line)));
	});

	it('rejects an after capture that still carries the bar', () => {
		const verdict = evaluateObservation({
			label: 'after',
			observations: { 'desktop-light': beforeObservation() },
		});
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((line) => /absolutely positioned decoration/.test(line)));
	});

	it('rejects a card that moved the category hue onto the surface itself', () => {
		// Removing the bar but painting the hue on the card would satisfy the
		// letter of "no left rule" while restoring the hue-only channel the
		// owner's decision removes.
		const observation = afterObservation();
		observation.cards[0].className = 'bg-c_bg.surface bg-c_accent.category.design';
		const verdict = evaluateObservation({ label: 'after', observations: { x: observation } });
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((line) => /still paints accent\.category\.\*/.test(line)));
	});

	it('rejects a card whose fill is the canvas colour', () => {
		const observation = afterObservation();
		observation.cards[0].background = 'rgba(0, 0, 0, 0)';
		const verdict = evaluateObservation({ label: 'after', observations: { x: observation } });
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((line) => /no opaque fill of its own/.test(line)));
	});

	it('rejects an inline-start border as the replacement for the bar', () => {
		const observation = afterObservation();
		observation.cards[1].borderInlineStartWidth = '4px';
		const verdict = evaluateObservation({ label: 'after', observations: { x: observation } });
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((line) => /border-inline-start is 4px/.test(line)));
	});

	it('rejects collapsed silhouettes even when the bar is gone', () => {
		const observation = afterObservation();
		for (const entry of observation.cards) entry.marks = ['code'];
		const verdict = evaluateObservation({ label: 'after', observations: { x: observation } });
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((line) => /four distinct marks/.test(line)));
	});

	it('rejects a card that lost its category word', () => {
		const observation = afterObservation();
		observation.cards[2].text = 'A project';
		const verdict = evaluateObservation({ label: 'after', observations: { x: observation } });
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((line) => /category word "Video" is missing/.test(line)));
	});

	it('refuses an unknown label', () => {
		assert.throws(() => evaluateObservation({ label: 'mid', observations: {} }), /unknown label/);
	});
});

describe('capture-project-card-category-bar — harness', () => {
	it('renders the shipped story, not a copy of the card', () => {
		const entry = harnessMainTsx();
		assert.ok(entry.includes(STORY_MODULE));
		assert.ok(entry.includes(STORY_EXPORT));
		assert.ok(entry.includes(CUES_TEST_ID));
		assert.ok(entry.includes(MONOCHROME_TEST_ID));
	});
});
