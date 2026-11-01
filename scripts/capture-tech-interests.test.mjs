#!/usr/bin/env node
/**
 * Capture-script contract for Issue #528.
 *
 * The verification image is only evidence if it is the SHIPPED preview
 * and if the capture fails when the preview stops matching the
 * inventory. These assertions cover the parts that can be decided
 * without a browser: the WebP-only output contract, the harness that
 * renders the shipped story, and the comparison that turns a
 * half-rendered inventory into a failed capture.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	CURRENT_RECOMMENDATIONS,
	INTEREST_CATEGORY_LABELS,
	INTEREST_STATE_LABELS,
	SUPERSEDED_OBSERVATIONS,
	TECH_INTEREST_SECTIONS,
} from '../src/personal/tech-interests/TechInterests.preview.ts';
import {
	ARTEFACT_WIDTH,
	DEFAULT_ARTEFACT_PATH,
	PREVIEW_TITLE,
	SCREENSHOT_BUDGET_BYTES,
	SCREENSHOT_MAX_WIDTH,
	assertWebpOutputPath,
	harnessMainTsx,
	screenshotBudgetVerdict,
	verifyRenderedPreview,
} from './capture-tech-interests.mjs';

/** The rendered shape of one entry card (name, badges, observation date). */
function renderedEntry(entry) {
	return {
		name: entry.name,
		badges: [INTEREST_STATE_LABELS[entry.state], INTEREST_CATEGORY_LABELS[entry.category]],
		observedOn: entry.observedOn,
	};
}

/** The observation a correct render produces (the fixture of "everything is there"). */
function completeObservation() {
	return {
		present: true,
		title: PREVIEW_TITLE,
		sections: TECH_INTEREST_SECTIONS.map((section) => ({
			heading: section.heading,
			summary: section.summary,
			points: [...section.points],
			entries: section.entries.map(renderedEntry),
		})),
		current: {
			heading: `現在の推奨（${CURRENT_RECOMMENDATIONS.length} 件）`,
			entries: CURRENT_RECOMMENDATIONS.map(renderedEntry),
		},
		held: {
			heading: `保留（置き換わった観察 ${SUPERSEDED_OBSERVATIONS.length} 件）`,
			entries: SUPERSEDED_OBSERVATIONS.map(renderedEntry),
		},
		scrollWidth: 1440,
		clientWidth: 1440,
	};
}

describe('capture-tech-interests (Issue #528)', () => {
	it('refuses an output path that is not WebP', () => {
		assert.throws(
			() => assertWebpOutputPath('docs/verification/influences/tech-interests-preview.png'),
			/non-WebP/,
		);
	});

	it('refuses an output path outside the repository', () => {
		assert.throws(() => assertWebpOutputPath('../outside.webp'), /outside the repository/);
	});

	it('accepts the committed WebP path', () => {
		const resolved = assertWebpOutputPath(DEFAULT_ARTEFACT_PATH, process.cwd());
		assert.ok(resolved.endsWith('docs/verification/influences/tech-interests-preview.webp'));
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
		assert.match(main, /TechInterests\.stories\.tsx/);
		assert.match(main, /Default/);
		assert.match(main, /src\/styles\.css/);
	});

	it('passes a render that shows the whole inventory', () => {
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

	it('fails when a section is missing', () => {
		const observation = completeObservation();
		observation.sections = observation.sections.slice(0, -1);
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /section\(s\), expected/);
	});

	it('fails when a summary is missing', () => {
		const observation = completeObservation();
		observation.sections[0].summary = '別の要約';
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /the summary of/);
	});

	it('fails when a point is missing', () => {
		const observation = completeObservation();
		observation.sections[0].points = observation.sections[0].points.slice(0, -1);
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /did not render 1 of its/);
	});

	it('fails when an entry is missing', () => {
		const observation = completeObservation();
		const section = observation.sections.find((candidate) => candidate.entries.length > 0);
		section.entries = section.entries.slice(0, -1);
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /is missing from/);
	});

	it('fails when an entry loses its state label', () => {
		const observation = completeObservation();
		const section = observation.sections.find((candidate) => candidate.entries.length > 0);
		section.entries[0].badges = [];
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /does not render the state label/);
	});

	it('fails when the current-recommendation count is wrong', () => {
		const observation = completeObservation();
		observation.current.entries = observation.current.entries.slice(0, -1);
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /current-recommendation list rendered/);
	});

	it('fails when a replaced observation is shown as a current recommendation', () => {
		const observation = completeObservation();
		const replaced = SUPERSEDED_OBSERVATIONS[0];
		observation.current.entries.push(renderedEntry(replaced));
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /is rendered as a current recommendation/);
	});

	it('fails when the preview scrolls sideways', () => {
		const observation = completeObservation();
		observation.scrollWidth = 1600;
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /scrolls sideways/);
	});
});
