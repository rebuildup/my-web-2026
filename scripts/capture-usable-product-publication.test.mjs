#!/usr/bin/env node
/**
 * Capture-script contract for Issue #515.
 *
 * The verification image is only evidence if it is the SHIPPED preview
 * and if the capture fails when the preview stops matching the
 * document. These assertions cover the parts that can be decided
 * without a browser: the WebP-only output contract, the harness that
 * renders the shipped story, and the comparison that turns a
 * half-rendered checklist into a failed capture.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	usableProductAdopted,
	usableProductExamples,
	usableProductHeld,
	usableProductLead,
	usableProductOpenDecisions,
	usableProductSections,
	usableProductStages,
	usableProductTitle,
} from '../src/personal/usable-product-publication/UsableProductPublication.preview.ts';
import {
	ARTEFACT_WIDTH,
	DEFAULT_ARTEFACT_PATH,
	SCREENSHOT_BUDGET_BYTES,
	SCREENSHOT_MAX_WIDTH,
	assertWebpOutputPath,
	harnessMainTsx,
	screenshotBudgetVerdict,
	verifyRenderedPreview,
} from './capture-usable-product-publication.mjs';

/**
 * The observation a correct render produces — the fixture of "everything
 * is there".
 *
 * It is built from the preview data module, so the positive case is
 * "the DOM says exactly what the data says". Every negative control
 * below mutates ONE field of this fixture, which is what proves the
 * comparison can see that field.
 */
function completeObservation() {
	const sections = usableProductSections.map((section) => {
		const rendered = {
			id: section.id,
			heading: section.heading,
			paragraphs: [...section.paragraphs],
			items: [...section.bullets],
			cards: [],
		};
		if (section.id === 'stages') {
			rendered.cards = usableProductStages.map((stage) => ({
				stage: stage.id,
				lines: [stage.name, stage.exit, stage.judgement],
				items: [],
			}));
		}
		if (section.id === 'checklist') {
			rendered.cards = usableProductStages.map((stage) => ({
				stage: stage.id,
				lines: [stage.name],
				items: stage.items.map((item) => item.label),
			}));
		}
		if (section.kind === 'example') {
			const example = usableProductExamples.find((item) => item.id === section.exampleId);
			rendered.subject = example.subject;
			rendered.record = `${example.record}（${example.pointer}）`;
			rendered.facts = example.facts.map((fact) => `${fact.label} = ${fact.value}`);
			rendered.cards = example.notes.map((note) => {
				const stage = usableProductStages.find((item) => item.id === note.stageId);
				const lines = [stage.name, note.evidence];
				if (note.gap !== null) lines.push(note.gap);
				return { stage: note.stageId, lines, items: [] };
			});
		}
		if (section.id === 'decisions') {
			rendered.adopted = [...usableProductAdopted];
			rendered.held = [...usableProductHeld];
		}
		if (section.id === 'open') {
			rendered.items = [...usableProductOpenDecisions];
		}
		return rendered;
	});

	return {
		present: true,
		title: usableProductTitle,
		lead: usableProductLead,
		sections,
		scrollWidth: 1440,
		clientWidth: 1440,
	};
}

/** The section of a given id in an observation. */
function sectionOf(observation, id) {
	return observation.sections.find((section) => section.id === id);
}

describe('capture-usable-product-publication (Issue #515)', () => {
	it('refuses an output path that is not WebP', () => {
		assert.throws(
			() => assertWebpOutputPath('docs/verification/vision/usable-product-checklist.png'),
			/non-WebP/,
		);
	});

	it('refuses an output path outside the repository', () => {
		assert.throws(() => assertWebpOutputPath('../outside.webp'), /outside the repository/);
	});

	it('accepts the committed WebP path', () => {
		const resolved = assertWebpOutputPath(DEFAULT_ARTEFACT_PATH, process.cwd());
		assert.ok(resolved.endsWith('docs/verification/vision/usable-product-checklist.webp'));
	});

	it('reports the artefact budget', () => {
		assert.equal(screenshotBudgetVerdict(1024).withinBudget, true);
		assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES).withinBudget, true);
		assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES + 1).withinBudget, false);
	});

	it('encodes within the committed width cap', () => {
		assert.ok(ARTEFACT_WIDTH <= SCREENSHOT_MAX_WIDTH);
	});

	it('renders the shipped story module, not a copy of it', () => {
		const main = harnessMainTsx();
		assert.match(main, /UsableProductPublication\.stories\.tsx/);
		assert.match(main, /Checklist/);
		assert.match(main, /src\/styles\.css/);
	});

	it('fails when the preview surface is not rendered at all', () => {
		const observation = completeObservation();
		observation.present = false;
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /was not rendered/);
	});

	it('passes a render that shows the whole checklist', () => {
		const verdict = verifyRenderedPreview(completeObservation());
		assert.deepEqual(verdict.failures, []);
		assert.equal(verdict.ok, true);
	});

	it('fails when the document title is wrong', () => {
		const observation = completeObservation();
		observation.title = '別の表題';
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /the document title is/);
	});

	it('fails when the lead paragraph is wrong', () => {
		const observation = completeObservation();
		observation.lead = '別の導入';
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /the lead paragraph does not match/);
	});

	it('fails when a section is missing', () => {
		const observation = completeObservation();
		observation.sections = observation.sections.filter((section) => section.id !== 'stages');
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /section\(s\), expected/);
	});

	it('fails when a section renders the wrong heading', () => {
		const observation = completeObservation();
		sectionOf(observation, 'sources').heading = '別の見出し';
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /renders the heading/);
	});

	it('fails when a paragraph of a section is missing', () => {
		const observation = completeObservation();
		sectionOf(observation, 'sources').paragraphs = [];
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /did not render the paragraph/);
	});

	it('fails when a bullet of a section is missing', () => {
		const observation = completeObservation();
		sectionOf(observation, 'stages').items = [];
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /did not render the item/);
	});

	it('fails when a stage card is missing', () => {
		const observation = completeObservation();
		sectionOf(observation, 'stages').cards = [];
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /stage card\(s\), expected/);
	});

	it('fails when a stage loses its exit', () => {
		const observation = completeObservation();
		const card = sectionOf(observation, 'stages').cards[0];
		card.lines = card.lines.filter((line) => line !== usableProductStages[0].exit);
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /does not render its exit/);
	});

	it('fails when a stage loses its judgement', () => {
		const observation = completeObservation();
		const card = sectionOf(observation, 'stages').cards[0];
		card.lines = card.lines.filter((line) => line !== usableProductStages[0].judgement);
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /does not render its judgement/);
	});

	it('fails when a checklist card is missing', () => {
		const observation = completeObservation();
		sectionOf(observation, 'checklist').cards = [];
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /checklist section rendered/);
	});

	it('fails when a checklist item is missing', () => {
		const observation = completeObservation();
		sectionOf(observation, 'checklist').cards[0].items = [];
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /did not render the item/);
	});

	it('fails when an example section is missing', () => {
		const observation = completeObservation();
		observation.sections = observation.sections.filter(
			(section) => section.id !== 'example-readmark',
		);
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /example section\(s\), expected/);
	});

	it('fails when an example renders the wrong subject', () => {
		const observation = completeObservation();
		sectionOf(observation, 'example-readmark').subject = '別の対象';
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /renders the subject/);
	});

	it('fails when an example loses its committed record', () => {
		const observation = completeObservation();
		sectionOf(observation, 'example-readmark').record = null;
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /does not render its committed record/);
	});

	it('fails when an example loses a fact', () => {
		const observation = completeObservation();
		sectionOf(observation, 'example-readmark').facts = [];
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /did not render the fact/);
	});

	it('fails when an example loses the evidence of a stage', () => {
		const observation = completeObservation();
		const card = sectionOf(observation, 'example-readmark').cards[0];
		card.lines = card.lines.filter((line) => line !== usableProductExamples[0].notes[0].evidence);
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /does not render the evidence/);
	});

	it('fails when an example loses the gap the record does not answer', () => {
		const observation = completeObservation();
		const gap = usableProductExamples[0].notes.find((note) => note.gap !== null)?.gap;
		const card = sectionOf(observation, 'example-readmark').cards.find(
			(item) => item.stage === usableProductExamples[0].notes.find((n) => n.gap === gap)?.stageId,
		);
		card.lines = card.lines.filter((line) => line !== gap);
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /does not render the gap/);
	});

	it('fails when an adopted decision is missing', () => {
		const observation = completeObservation();
		sectionOf(observation, 'decisions').adopted = [];
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /the adopted decision/);
	});

	it('fails when a held decision is missing', () => {
		const observation = completeObservation();
		sectionOf(observation, 'decisions').held = [];
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /the held decision/);
	});

	it('fails when an open question is missing', () => {
		const observation = completeObservation();
		sectionOf(observation, 'open').items = [];
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /the open question/);
	});

	it('fails when the preview scrolls sideways', () => {
		const observation = completeObservation();
		observation.scrollWidth = 1600;
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /scrolls sideways/);
	});
});
