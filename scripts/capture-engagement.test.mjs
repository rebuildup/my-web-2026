#!/usr/bin/env node
/**
 * Capture-script contract for Issue #517.
 *
 * The verification images are only evidence if they are the SHIPPED
 * previews and if the capture fails when a preview stops matching the
 * data — or when the interactive variant stops being operable or
 * stops honouring reduced motion. These assertions cover the parts
 * that can be decided without a browser: the PNG-only output
 * contract, the harness that renders the shipped stories, the fixed
 * two-artefact capture table, the same-information comparison, the
 * operability facts, and the reduced-motion pair verdict.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	ENGAGEMENT_CRITERIA,
	ENGAGEMENT_DOCUMENT,
	ENGAGEMENT_LINKS,
	ENGAGEMENT_NOTES,
	ENGAGEMENT_SOURCES,
	ENGAGEMENT_VARIANTS,
	ENGAGEMENT_WORKS,
} from '../src/personal/engagement/Engagement.preview.ts';
import {
	CAPTURES,
	PNG_BUDGET_BYTES,
	assertPngOutputPath,
	bundleBytes,
	collapseText,
	harnessMainTsx,
	screenshotBudgetVerdict,
	verifyReducedMotionPair,
	verifyRenderedPreview,
} from './capture-engagement.mjs';

const DATA = {
	document: ENGAGEMENT_DOCUMENT,
	sources: ENGAGEMENT_SOURCES,
	works: ENGAGEMENT_WORKS,
	variants: ENGAGEMENT_VARIANTS,
	criteria: ENGAGEMENT_CRITERIA,
	links: ENGAGEMENT_LINKS,
	notes: ENGAGEMENT_NOTES,
};

/**
 * The card text a correct render produces for one work — every fact
 * the seed carries, collapsed the way the DOM reader collapses it.
 */
function cardFor(work) {
	return {
		id: work.id,
		text: collapseText(
			[work.title, work.periodLabel, work.role, work.fact, ...work.technologies].join(' '),
		),
	};
}

/** The observation a correct STATIC render produces. */
function staticObservation() {
	return {
		title: ENGAGEMENT_DOCUMENT.title,
		variant: 'static',
		meta: [
			ENGAGEMENT_DOCUMENT.status,
			ENGAGEMENT_DOCUMENT.source,
			ENGAGEMENT_DOCUMENT.verification,
			ENGAGEMENT_DOCUMENT.document,
		],
		workCards: ENGAGEMENT_WORKS.map(cardFor),
		controls: { hasPrev: false, hasNext: false, positionText: '', progressbar: false },
		notes: [...ENGAGEMENT_NOTES],
		hrefs: ENGAGEMENT_LINKS.map((link) => link.url),
		bodyText: [
			...ENGAGEMENT_WORKS.flatMap((w) => [
				w.title,
				w.periodLabel,
				w.role,
				w.fact,
				...w.technologies,
			]),
			...ENGAGEMENT_VARIANTS.flatMap((v) => [v.label, v.description, ...v.facts]),
			...ENGAGEMENT_CRITERIA.flatMap((c) => [c.label, c.question]),
			...ENGAGEMENT_SOURCES.map((s) => s.path),
		].join('\n'),
		scrollWidth: 1440,
		clientWidth: 1440,
	};
}

/** The observation a correct INTERACTIVE render produces after driving. */
function interactiveObservation() {
	return {
		title: ENGAGEMENT_DOCUMENT.title,
		variant: 'interactive',
		meta: [
			ENGAGEMENT_DOCUMENT.status,
			ENGAGEMENT_DOCUMENT.source,
			ENGAGEMENT_DOCUMENT.verification,
			ENGAGEMENT_DOCUMENT.document,
		],
		workCards: [cardFor(ENGAGEMENT_WORKS[0])],
		visited: ENGAGEMENT_WORKS.map(cardFor),
		controls: {
			hasPrev: true,
			hasNext: true,
			positionText: '1 / 6',
			progressbar: true,
		},
		keyboard: { before: 6, after: 5 },
		notes: [...ENGAGEMENT_NOTES],
		hrefs: ENGAGEMENT_LINKS.map((link) => link.url),
		bodyText: [
			ENGAGEMENT_WORKS[0].title,
			ENGAGEMENT_WORKS[0].periodLabel,
			ENGAGEMENT_WORKS[0].role,
			ENGAGEMENT_WORKS[0].fact,
			...ENGAGEMENT_WORKS[0].technologies,
			...ENGAGEMENT_VARIANTS.flatMap((v) => [v.label, v.description, ...v.facts]),
			...ENGAGEMENT_CRITERIA.flatMap((c) => [c.label, c.question]),
			...ENGAGEMENT_SOURCES.map((s) => s.path),
		].join('\n'),
		scrollWidth: 1440,
		clientWidth: 1440,
	};
}

describe('capture-engagement (Issue #517)', () => {
	it('captures both variants into the Issue-named PNGs', () => {
		assert.deepEqual(
			CAPTURES.map((capture) => capture.key),
			['static', 'interactive'],
		);
		assert.deepEqual(
			CAPTURES.map((capture) => capture.artefact),
			[
				'docs/verification/experience/engagement-static.png',
				'docs/verification/experience/engagement-interactive.png',
			],
		);
		for (const capture of CAPTURES) {
			assert.match(capture.artefact, /\.png$/);
			assert.equal(capture.variant, capture.story.toLowerCase());
			assert.equal(capture.width, 1440);
		}
	});

	it('keeps the same six works as the single information set', () => {
		assert.equal(ENGAGEMENT_WORKS.length, 6);
		const ids = new Set(ENGAGEMENT_WORKS.map((work) => work.id));
		assert.equal(ids.size, ENGAGEMENT_WORKS.length);
		for (const work of ENGAGEMENT_WORKS) {
			assert.ok(work.title.length > 0);
			assert.ok(work.periodLabel.length > 0);
			assert.ok(work.role.length > 0);
			assert.ok(work.fact.length > 0);
			assert.ok(work.technologies.length > 0);
			assert.ok(work.sourceIds.length > 0);
		}
	});

	it('declares both variants and all four comparison axes', () => {
		assert.deepEqual(
			ENGAGEMENT_VARIANTS.map((variant) => variant.id),
			['static', 'interactive'],
		);
		assert.deepEqual(
			ENGAGEMENT_CRITERIA.map((criterion) => criterion.id),
			['legibility', 'operability', 'loading-cost', 'reduced-motion'],
		);
	});

	it('refuses an output path that is not PNG', () => {
		assert.throws(
			() => assertPngOutputPath('docs/verification/experience/engagement-static.webp'),
			/non-PNG/,
		);
	});

	it('refuses an output path outside the repository', () => {
		assert.throws(() => assertPngOutputPath('../outside.png'), /outside the repository/);
	});

	it('accepts the committed artefact paths', () => {
		for (const capture of CAPTURES) {
			assert.ok(assertPngOutputPath(capture.artefact).endsWith(capture.artefact));
		}
	});

	it('applies the PNG budget verdict', () => {
		assert.equal(screenshotBudgetVerdict(100).withinBudget, true);
		assert.equal(screenshotBudgetVerdict(PNG_BUDGET_BYTES + 1).withinBudget, false);
	});

	it('sums bundle bytes for the loading-cost comparison', () => {
		const verdict = bundleBytes('.tmp/definitely-missing-engagement-dir');
		assert.deepEqual(verdict, { bytes: 0, files: 0 });
	});

	it('collapses whitespace runs for DOM/data comparison', () => {
		assert.equal(collapseText('a\n  b\tc'), 'a b c');
		assert.equal(collapseText(null), '');
		assert.equal(collapseText(undefined), '');
	});

	it('builds a harness that renders the named shipped story export', () => {
		const source = harnessMainTsx('Static');
		assert.match(source, /import \{ Static \} from '[^']*Engagement\.stories\.tsx'/);
		assert.match(source, /Static\.render\?\.\(\)/);
		assert.match(source, /src\/styles\.css/);
		assert.match(harnessMainTsx('Interactive'), /Interactive\.render\?\.\(\)/);
	});

	it('passes a complete static render', () => {
		const verdict = verifyRenderedPreview(staticObservation(), 'static', DATA);
		assert.deepEqual(verdict.failures, []);
		assert.equal(verdict.ok, true);
	});

	it('passes a complete interactive render after driving the deck', () => {
		const verdict = verifyRenderedPreview(interactiveObservation(), 'interactive', DATA);
		assert.deepEqual(verdict.failures, []);
	});

	it('fails when the variant marker does not match the capture', () => {
		const verdict = verifyRenderedPreview(staticObservation(), 'interactive', DATA);
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('variant')));
	});

	it('fails when the static preview drops a work — same information is a DOM fact', () => {
		const observation = staticObservation();
		observation.workCards = observation.workCards.slice(0, 5);
		const verdict = verifyRenderedPreview(observation, 'static', DATA);
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('work ids')));
	});

	it('fails when the deck never reaches a work', () => {
		const observation = interactiveObservation();
		observation.visited = observation.visited.slice(0, 4);
		const verdict = verifyRenderedPreview(observation, 'interactive', DATA);
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('visited work ids')));
	});

	it('fails when a visited card is missing a seed fact', () => {
		const observation = interactiveObservation();
		observation.visited[2].text = observation.visited[2].text.replace(ENGAGEMENT_WORKS[2].fact, '');
		const verdict = verifyRenderedPreview(observation, 'interactive', DATA);
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes(ENGAGEMENT_WORKS[2].id)));
	});

	it('fails when the interactive controls are missing', () => {
		const observation = interactiveObservation();
		observation.controls.hasNext = false;
		const verdict = verifyRenderedPreview(observation, 'interactive', DATA);
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('controls')));
	});

	it('fails when the keyboard path does not move the deck', () => {
		const observation = interactiveObservation();
		observation.keyboard = { before: 6, after: 6 };
		const verdict = verifyRenderedPreview(observation, 'interactive', DATA);
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('ArrowLeft')));
	});

	it('fails when the preview invents a link', () => {
		const observation = staticObservation();
		observation.hrefs = [...observation.hrefs, 'https://example.com/invented'];
		const verdict = verifyRenderedPreview(observation, 'static', DATA);
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('undeclared link')));
	});

	it('fails when a source path is not rendered', () => {
		const observation = staticObservation();
		observation.bodyText = observation.bodyText.replace(ENGAGEMENT_SOURCES[0].path, 'redacted');
		const verdict = verifyRenderedPreview(observation, 'static', DATA);
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes(ENGAGEMENT_SOURCES[0].path)));
	});

	it('fails when the render scrolls sideways', () => {
		const observation = staticObservation();
		observation.scrollWidth = 1441;
		observation.clientWidth = 1440;
		const verdict = verifyRenderedPreview(observation, 'static', DATA);
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('sideways')));
	});

	it('passes the reduced-motion pair: animated normally, none under reduce', () => {
		const verdict = verifyReducedMotionPair(
			{ motionState: 'animated', animationName: 'engagementStep' },
			{ motionState: 'reduced', animationName: 'none' },
		);
		assert.deepEqual(verdict.failures, []);
		assert.equal(verdict.ok, true);
	});

	it('fails the reduced-motion pair when reduce still animates', () => {
		const verdict = verifyReducedMotionPair(
			{ motionState: 'animated', animationName: 'engagementStep' },
			{ motionState: 'reduced', animationName: 'engagementStep' },
		);
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('reduce context')));
	});

	it('fails the reduced-motion pair when the normal context never animated', () => {
		const verdict = verifyReducedMotionPair(
			{ motionState: 'reduced', animationName: 'none' },
			{ motionState: 'reduced', animationName: 'none' },
		);
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('normal context')));
	});
});
