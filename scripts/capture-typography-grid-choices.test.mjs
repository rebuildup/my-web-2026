#!/usr/bin/env node
/**
 * Capture-script contract for Issue #527.
 *
 * The verification image is only evidence if it is the SHIPPED preview
 * and if the capture fails when the preview stops matching the
 * record. These assertions cover the parts that can be decided without
 * a browser: the WebP-only output contract, the harness that renders
 * the shipped story, and the comparison that turns a half-rendered
 * preview into a failed capture.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TYPOGRAPHY_GRID_CHOICES } from '../src/personal/typography-grid-swiss/TypographyGridChoices.preview.ts';
import {
	ARTEFACT_WIDTH,
	DEFAULT_ARTEFACT_PATH,
	SCREENSHOT_BUDGET_BYTES,
	SCREENSHOT_MAX_WIDTH,
	assertWebpOutputPath,
	harnessMainTsx,
	screenshotBudgetVerdict,
	verifyRenderedRecord,
} from './capture-typography-grid-choices.mjs';

/** The observation a correct render produces (the fixture of "everything is there"). */
function completeObservation() {
	const document_ = TYPOGRAPHY_GRID_CHOICES.document;
	const sections = TYPOGRAPHY_GRID_CHOICES.sections;
	return {
		title: document_.title,
		meta: [document_.status, document_.source, document_.verification, document_.preview],
		sections: sections.map((section) => ({
			heading: section.heading,
			lead: section.lead,
			subHeadings: section.blocks
				.map((block) => block.heading)
				.filter((heading) => heading !== null),
			bullets: section.blocks.flatMap((block) => [...block.bullets]),
		})),
		scrollWidth: 1440,
		clientWidth: 1440,
	};
}

describe('capture-typography-grid-choices (Issue #527)', () => {
	it('refuses an output path that is not WebP', () => {
		assert.throws(
			() => assertWebpOutputPath('docs/verification/influences/typography-grid-choices.png'),
			/non-WebP/,
		);
	});

	it('refuses an output path outside the repository', () => {
		assert.throws(() => assertWebpOutputPath('../outside.webp'), /outside the repository/);
	});

	it('accepts the committed WebP path', () => {
		const resolved = assertWebpOutputPath(DEFAULT_ARTEFACT_PATH, process.cwd());
		assert.ok(resolved.endsWith('docs/verification/influences/typography-grid-choices.webp'));
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
		assert.match(main, /TypographyGridChoices\.stories\.tsx/);
		assert.match(main, /Default/);
		assert.match(main, /src\/styles\.css/);
	});

	it('passes a render that shows the whole record', () => {
		const verdict = verifyRenderedRecord(completeObservation());
		assert.deepEqual(verdict.failures, []);
		assert.equal(verdict.ok, true);
	});

	it('fails when the document title is wrong', () => {
		const observation = completeObservation();
		observation.title = '別の表題';
		const verdict = verifyRenderedRecord(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /the document title is/);
	});

	it('fails when a section is missing', () => {
		const observation = completeObservation();
		observation.sections = observation.sections.slice(0, -1);
		const verdict = verifyRenderedRecord(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /section\(s\), expected/);
	});

	it('fails when a bullet is missing', () => {
		const observation = completeObservation();
		const lastSection = observation.sections[observation.sections.length - 1];
		lastSection.bullets = lastSection.bullets.slice(0, -1);
		const verdict = verifyRenderedRecord(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /bullet\(s\) in/);
	});

	it('fails when a sub-heading is missing', () => {
		const observation = completeObservation();
		const firstSection = observation.sections[0];
		firstSection.subHeadings = firstSection.subHeadings.slice(0, -1);
		const verdict = verifyRenderedRecord(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /the sub-headings of/);
	});

	it('fails when a lead paragraph is wrong', () => {
		const observation = completeObservation();
		observation.sections[0].lead = '別の導入';
		const verdict = verifyRenderedRecord(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /the lead paragraph of/);
	});

	it('fails when the document scrolls sideways', () => {
		const observation = completeObservation();
		observation.scrollWidth = 1600;
		const verdict = verifyRenderedRecord(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /scrolls sideways/);
	});
});
