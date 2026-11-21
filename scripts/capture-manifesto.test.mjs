#!/usr/bin/env node
/**
 * Capture-script contract for Issue #535.
 *
 * The verification images are only evidence if they are the SHIPPED
 * previews and if the capture fails when a preview stops matching the
 * data. These assertions cover the parts that can be decided without
 * a browser: the PNG-only output contract, the harness that renders
 * the shipped stories, the fixed four-artefact capture table, and the
 * comparison that turns a half-rendered preview — a merged question,
 * an invented link, or a sideways-scrolling narrow render — into a
 * failed capture.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	MANIFESTO_DOCUMENT,
	MANIFESTO_LINKS,
	MANIFESTO_MATERIALS,
	MANIFESTO_NOTES,
	MANIFESTO_QUESTIONS,
	MANIFESTO_SOURCES,
} from '../src/personal/manifesto/Manifesto.preview.ts';
import {
	CAPTURES,
	PNG_BUDGET_BYTES,
	assertPngOutputPath,
	collapseText,
	harnessMainTsx,
	screenshotBudgetVerdict,
	verifyRenderedPreview,
} from './capture-manifesto.mjs';

const DATA = {
	document: MANIFESTO_DOCUMENT,
	sources: MANIFESTO_SOURCES,
	materials: MANIFESTO_MATERIALS,
	questions: MANIFESTO_QUESTIONS,
	links: MANIFESTO_LINKS,
	notes: MANIFESTO_NOTES,
};

/**
 * The observation a correct render produces, for one variant.
 *
 * `bodyText` carries every string the verifier looks up outside the
 * structured fields (source paths, material labels) — the fixture of
 * "everything is there".
 */
function completeObservation(variant) {
	return {
		title: MANIFESTO_DOCUMENT.title,
		variant,
		meta: [
			MANIFESTO_DOCUMENT.status,
			MANIFESTO_DOCUMENT.source,
			MANIFESTO_DOCUMENT.verification,
			MANIFESTO_DOCUMENT.document,
		],
		questions: MANIFESTO_QUESTIONS.flatMap((q) => [q.heading, q.question]),
		miroAxes: MANIFESTO_QUESTIONS.map((q) =>
			variant === 'article' ? `miro: ${q.miroAxis}` : q.miroAxis,
		),
		notes: [...MANIFESTO_NOTES],
		hrefs: MANIFESTO_LINKS.map((link) => link.url),
		bodyText: [
			...MANIFESTO_SOURCES.map((s) => s.path),
			...MANIFESTO_MATERIALS.map((m) => m.label),
			...MANIFESTO_QUESTIONS.flatMap((q) => [q.heading, q.question]),
		].join('\n'),
		scrollWidth: 1440,
		clientWidth: 1440,
	};
}

describe('capture-manifesto (Issue #535)', () => {
	it('captures both variants at both widths, into the Issue-named PNGs', () => {
		const keys = CAPTURES.map((capture) => capture.key);
		assert.deepEqual(keys, ['article-wide', 'article-narrow', 'landing-wide', 'landing-narrow']);
		const wide = CAPTURES.filter((capture) => capture.width === 1440);
		const narrow = CAPTURES.filter((capture) => capture.width === 480);
		assert.equal(wide.length, 2);
		assert.equal(narrow.length, 2);
		assert.deepEqual(wide.map((capture) => capture.artefact).sort(), [
			'docs/verification/vision/manifesto-article.png',
			'docs/verification/vision/manifesto-landing.png',
		]);
		for (const capture of CAPTURES) {
			assert.match(capture.artefact, /\.png$/);
			assert.ok(['Article', 'Landing'].includes(capture.story));
			assert.equal(capture.variant, capture.story.toLowerCase());
		}
	});

	it('keeps the two Miro values as independent questions in the data', () => {
		// Issue #535 acceptance: at least two values stay separate
		// questions — the data module is where that is enforced.
		assert.ok(MANIFESTO_QUESTIONS.length >= 2);
		const axes = new Set(MANIFESTO_QUESTIONS.map((q) => q.miroAxis));
		assert.equal(axes.size, MANIFESTO_QUESTIONS.length);
		for (const question of MANIFESTO_QUESTIONS) {
			assert.ok(question.miroAxis.includes('哲学 >'));
			assert.ok(question.evidence.length > 0);
			assert.ok(question.open.length > 0);
		}
	});

	it('refuses an output path that is not PNG', () => {
		assert.throws(
			() => assertPngOutputPath('docs/verification/vision/manifesto-article.webp'),
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

	it('collapses whitespace runs for DOM/data comparison', () => {
		assert.equal(collapseText('a\n  b\tc'), 'a b c');
		assert.equal(collapseText(null), '');
		assert.equal(collapseText(undefined), '');
	});

	it('builds a harness that renders the named shipped story export', () => {
		const source = harnessMainTsx('Article');
		assert.match(source, /import \{ Article \} from '[^']*Manifesto\.stories\.tsx'/);
		assert.match(source, /Article\.render\?\.\(\)/);
		assert.match(source, /src\/styles\.css/);
		assert.match(harnessMainTsx('Landing'), /Landing\.render\?\.\(\)/);
	});

	it('passes a complete article render', () => {
		const verdict = verifyRenderedPreview(completeObservation('article'), 'article', DATA);
		assert.deepEqual(verdict.failures, []);
		assert.equal(verdict.ok, true);
	});

	it('passes a complete landing render, including the duplicated CTA hrefs', () => {
		const observation = completeObservation('landing');
		// The landing hero renders the same two URLs a second time.
		observation.hrefs = [...observation.hrefs, ...MANIFESTO_LINKS.map((l) => l.url)];
		const verdict = verifyRenderedPreview(observation, 'landing', DATA);
		assert.deepEqual(verdict.failures, []);
	});

	it('fails when the variant marker does not match the capture', () => {
		const verdict = verifyRenderedPreview(completeObservation('article'), 'landing', DATA);
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('variant')));
	});

	it('fails when a question is dropped — the two-values rule is a DOM fact', () => {
		const observation = completeObservation('article');
		// Remove the second question's heading + text.
		observation.questions = observation.questions.slice(0, 2);
		const verdict = verifyRenderedPreview(observation, 'article', DATA);
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('question')));
	});

	it('fails when a Miro axis citation is missing', () => {
		const observation = completeObservation('landing');
		observation.miroAxes = observation.miroAxes.slice(1);
		const verdict = verifyRenderedPreview(observation, 'landing', DATA);
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('Miro axis')));
	});

	it('fails when the preview invents a link', () => {
		const observation = completeObservation('article');
		observation.hrefs = [...observation.hrefs, 'https://example.com/invented'];
		const verdict = verifyRenderedPreview(observation, 'article', DATA);
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('undeclared link')));
	});

	it('fails when a source path is not rendered', () => {
		const observation = completeObservation('article');
		observation.bodyText = observation.bodyText.replace(MANIFESTO_SOURCES[0].path, 'redacted');
		const verdict = verifyRenderedPreview(observation, 'article', DATA);
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes(MANIFESTO_SOURCES[0].path)));
	});

	it('fails when the narrow render scrolls sideways', () => {
		const observation = completeObservation('landing');
		observation.scrollWidth = 481;
		observation.clientWidth = 480;
		const verdict = verifyRenderedPreview(observation, 'landing', DATA);
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('sideways')));
	});
});
