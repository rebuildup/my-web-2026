#!/usr/bin/env node
/**
 * Capture-script contract for Issue #522.
 *
 * The verification images are only evidence if they are the SHIPPED
 * previews and if the capture fails when the preview stops matching
 * the document. These assertions cover the parts that can be decided
 * without a browser: the PNG-only output contract, the harness that
 * renders the shipped stories, the comparison that turns a
 * half-rendered motif — a dropped chain step, a resolved candidate, a
 * missing alt text — into a failed capture, and the reduced-motion
 * verdict that proves the resting frame is what renders.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	MELTING_FACE_CHAIN,
	MELTING_FACE_COPY,
	MELTING_FACE_DOCUMENT,
	MELTING_FACE_EXPLANATIONS,
	MELTING_FACE_ICON,
	MELTING_FACE_LEGEND,
	MELTING_FACE_SECTIONS,
	meltingFaceMotifBullets,
} from '../src/personal/melting-face/MeltingFace.preview.ts';
import {
	DEFAULT_ARTEFACT_PATH,
	FALLBACK_ARTEFACT_PATH,
	PNG_BUDGET_BYTES,
	STORY_FALLBACK,
	STORY_MODULE,
	STORY_PREVIEW,
	assertPngOutputPath,
	expectedHeadings,
	harnessMainTsx,
	screenshotBudgetVerdict,
	verifyReducedMotionRender,
	verifyRenderedPreview,
} from './capture-melting-face.mjs';

/** The observation a correct PREVIEW render produces. */
function completePreviewObservation() {
	return {
		title: MELTING_FACE_DOCUMENT.title,
		headings: expectedHeadings('preview').map((text) => ({ level: 'H2', text })),
		meta: [
			MELTING_FACE_DOCUMENT.status,
			MELTING_FACE_DOCUMENT.source,
			MELTING_FACE_DOCUMENT.verification,
			MELTING_FACE_DOCUMENT.preview,
		],
		bullets: MELTING_FACE_SECTIONS.flatMap((section) => [...section.bullets]),
		chainSteps: MELTING_FACE_CHAIN.map((step) => step.label),
		copyRolesText: [
			MELTING_FACE_COPY.short,
			MELTING_FACE_COPY.long,
			MELTING_FACE_COPY.english,
		].join(' '),
		iconRoleText: MELTING_FACE_ICON.assetNote,
		explanationsText: MELTING_FACE_EXPLANATIONS.map((entry) => entry.label).join(' '),
		marks: [
			{
				motionState: 'animated',
				ariaLabel: MELTING_FACE_ICON.alt,
				dripAnimationName: 'meltingFaceDrip',
			},
		],
		fallbackCount: 0,
		fallbackText: '',
		scrollWidth: 1440,
		clientWidth: 1440,
	};
}

/** The observation a correct FALLBACK render produces. */
function completeFallbackObservation() {
	return {
		title: MELTING_FACE_DOCUMENT.title,
		headings: expectedHeadings('fallback').map((text) => ({ level: 'H2', text })),
		meta: [
			MELTING_FACE_DOCUMENT.status,
			MELTING_FACE_DOCUMENT.source,
			MELTING_FACE_DOCUMENT.verification,
			MELTING_FACE_DOCUMENT.preview,
		],
		bullets: MELTING_FACE_SECTIONS.flatMap((section) => [...section.bullets]),
		chainSteps: [],
		copyRolesText: '',
		iconRoleText: '',
		explanationsText: '',
		marks: [],
		fallbackCount: 1,
		fallbackText: [
			MELTING_FACE_ICON.fallbackText,
			MELTING_FACE_COPY.short,
			MELTING_FACE_ICON.alt,
			MELTING_FACE_ICON.assetNote,
		].join(' '),
		scrollWidth: 1440,
		clientWidth: 1440,
	};
}

describe('capture-melting-face (Issue #522)', () => {
	it('refuses an output path that is not PNG', () => {
		assert.throws(
			() => assertPngOutputPath('docs/verification/brand/melting-face-preview.webp'),
			/non-PNG/,
		);
	});

	it('refuses an output path outside the repository', () => {
		assert.throws(() => assertPngOutputPath('../outside.png'), /outside the repository/);
	});

	it('accepts the two committed PNG paths', () => {
		const preview = assertPngOutputPath(DEFAULT_ARTEFACT_PATH, process.cwd());
		const fallback = assertPngOutputPath(FALLBACK_ARTEFACT_PATH, process.cwd());
		assert.ok(preview.endsWith('docs/verification/brand/melting-face-preview.png'));
		assert.ok(fallback.endsWith('docs/verification/brand/melting-face-fallback.png'));
	});

	it('reports the artefact budget', () => {
		assert.equal(screenshotBudgetVerdict(1024).withinBudget, true);
		assert.equal(screenshotBudgetVerdict(PNG_BUDGET_BYTES).withinBudget, true);
		assert.equal(screenshotBudgetVerdict(PNG_BUDGET_BYTES + 1).withinBudget, false);
	});

	it('renders the shipped story module, not a copy of it', () => {
		const main = harnessMainTsx();
		assert.match(main, /MeltingFace\.stories\.tsx/);
		assert.match(main, /Default/);
		assert.match(main, /Fallback/);
		assert.equal(STORY_MODULE, 'src/personal/melting-face/MeltingFace.stories.tsx');
		assert.equal(STORY_PREVIEW, 'Default');
		assert.equal(STORY_FALLBACK, 'Fallback');
	});

	it('accepts a complete preview render', () => {
		const verdict = verifyRenderedPreview(completePreviewObservation(), 'preview');
		assert.equal(verdict.ok, true, verdict.failures.join('\n'));
	});

	it('accepts a complete fallback render', () => {
		const verdict = verifyRenderedPreview(completeFallbackObservation(), 'fallback');
		assert.equal(verdict.ok, true, verdict.failures.join('\n'));
	});

	it('fails when a chain step is dropped', () => {
		const observation = completePreviewObservation();
		observation.chainSteps = observation.chainSteps.slice(0, 3);
		const verdict = verifyRenderedPreview(observation, 'preview');
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('chain steps')));
	});

	it('fails when a copy role is missing', () => {
		const observation = completePreviewObservation();
		observation.copyRolesText = MELTING_FACE_COPY.short;
		const verdict = verifyRenderedPreview(observation, 'preview');
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('long copy')));
	});

	it('fails when the mark loses its alt text', () => {
		const observation = completePreviewObservation();
		observation.marks = [{ motionState: 'animated', ariaLabel: '', dripAnimationName: 'x' }];
		const verdict = verifyRenderedPreview(observation, 'preview');
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('aria-label')));
	});

	it('fails when an explanation candidate disappears', () => {
		const observation = completePreviewObservation();
		observation.explanationsText = '熱中 時間を惜しみなく投資';
		const verdict = verifyRenderedPreview(observation, 'preview');
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('無駄なこと')));
	});

	it('fails when the preview page carries a fallback panel', () => {
		const observation = completePreviewObservation();
		observation.fallbackCount = 1;
		const verdict = verifyRenderedPreview(observation, 'preview');
		assert.equal(verdict.ok, false);
	});

	it('fails when the fallback page renders an SVG mark', () => {
		const observation = completeFallbackObservation();
		observation.marks = [
			{ motionState: 'animated', ariaLabel: MELTING_FACE_ICON.alt, dripAnimationName: 'x' },
		];
		const verdict = verifyRenderedPreview(observation, 'fallback');
		assert.equal(verdict.ok, false);
	});

	it('fails when the fallback drops the alt description', () => {
		const observation = completeFallbackObservation();
		observation.fallbackText = `${MELTING_FACE_ICON.fallbackText} ${MELTING_FACE_COPY.short}`;
		const verdict = verifyRenderedPreview(observation, 'fallback');
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('alt description')));
	});

	it('fails on sideways scroll', () => {
		const observation = completePreviewObservation();
		observation.scrollWidth = 1500;
		const verdict = verifyRenderedPreview(observation, 'preview');
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('scrolls sideways')));
	});
});

describe('capture-melting-face reduced-motion verdict (Issue #522)', () => {
	it('accepts a reduced render that emits no animation and keeps the copy', () => {
		const observation = {
			...completePreviewObservation(),
			marks: [
				{
					motionState: 'reduced',
					ariaLabel: MELTING_FACE_ICON.alt,
					dripAnimationName: 'none',
				},
			],
		};
		const verdict = verifyReducedMotionRender(observation);
		assert.equal(verdict.ok, true, verdict.failures.join('\n'));
	});

	it('fails when the reduced render still animates', () => {
		const observation = {
			...completePreviewObservation(),
			marks: [
				{
					motionState: 'animated',
					ariaLabel: MELTING_FACE_ICON.alt,
					dripAnimationName: 'meltingFaceDrip',
				},
			],
		};
		const verdict = verifyReducedMotionRender(observation);
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('data-motion-state')));
		assert.ok(verdict.failures.some((failure) => failure.includes('animation-name')));
	});

	it('fails when the resting frame loses the copy', () => {
		const observation = {
			...completePreviewObservation(),
			copyRolesText: '',
			marks: [
				{
					motionState: 'reduced',
					ariaLabel: MELTING_FACE_ICON.alt,
					dripAnimationName: 'none',
				},
			],
		};
		const verdict = verifyReducedMotionRender(observation);
		assert.equal(verdict.ok, false);
		assert.ok(verdict.failures.some((failure) => failure.includes('short copy')));
	});
});

describe('melting-face motif bullets (Issue #522)', () => {
	it('derives the document bullets from the data, not the other way round', () => {
		const bullets = meltingFaceMotifBullets();
		assert.equal(bullets.length, MELTING_FACE_CHAIN.length + 5);
		assert.ok(bullets.some((bullet) => bullet.includes(MELTING_FACE_COPY.english)));
		assert.ok(bullets.some((bullet) => bullet.includes(MELTING_FACE_ICON.alt)));
	});
});
