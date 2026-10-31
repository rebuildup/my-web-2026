#!/usr/bin/env node
/**
 * Capture-script contract for Issue #525.
 *
 * The verification image is only evidence if it is the SHIPPED preview
 * and if the capture fails when the preview stops matching the
 * reference document. These assertions cover the parts that can be
 * decided without a browser: the WebP-only output contract, the
 * harness that renders the shipped story, and the comparison that turns
 * a half-rendered preview into a failed capture.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MUSIC_CONNECTIONS } from '../src/personal/music-connections/MusicConnections.preview.ts';
import {
	DEFAULT_ARTEFACT_PATH,
	SCREENSHOT_BUDGET_BYTES,
	assertWebpOutputPath,
	harnessMainTsx,
	screenshotBudgetVerdict,
	verifyRenderedPreview,
} from './capture-music-connections.mjs';

/** The observation a correct render produces (the fixture of "everything is there"). */
function completeObservation() {
	const document_ = MUSIC_CONNECTIONS.document;
	const sections = MUSIC_CONNECTIONS.sections;
	return {
		title: document_.title,
		meta: [document_.status, document_.source, document_.verification, document_.preview],
		headings: [
			{ level: 'H1', text: document_.title },
			...sections.map((section) => ({ level: 'H2', text: section.heading })),
			...sections.flatMap((section) =>
				section.blocks
					.map((block) => block.heading)
					.filter((heading) => heading !== null)
					.map((heading) => ({ level: 'H3', text: heading })),
			),
		],
		leads: sections.map((section) => section.lead),
		bullets: sections.flatMap((section) => section.blocks.flatMap((block) => [...block.bullets])),
		scrollWidth: 1440,
		clientWidth: 1440,
	};
}

describe('capture-music-connections (Issue #525)', () => {
	it('refuses an output path that is not WebP', () => {
		assert.throws(
			() => assertWebpOutputPath('docs/verification/influences/music-connections-preview.png'),
			/non-WebP/,
		);
	});

	it('refuses an output path outside the repository', () => {
		assert.throws(() => assertWebpOutputPath('../outside.webp'), /outside the repository/);
	});

	it('accepts the committed WebP path', () => {
		const resolved = assertWebpOutputPath(DEFAULT_ARTEFACT_PATH, process.cwd());
		assert.ok(resolved.endsWith('docs/verification/influences/music-connections-preview.webp'));
	});

	it('reports the artefact budget', () => {
		assert.equal(screenshotBudgetVerdict(1024).withinBudget, true);
		assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES).withinBudget, true);
		assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES + 1).withinBudget, false);
	});

	it('renders the shipped story module, not a copy of it', () => {
		const main = harnessMainTsx();
		assert.match(main, /MusicConnections\.stories\.tsx/);
		assert.match(main, /Default/);
		assert.match(main, /src\/styles\.css/);
	});

	it('passes a render that shows the whole document', () => {
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
		const renderedSections = observation.headings.filter((heading) => heading.level === 'H2');
		const lastSection = renderedSections[renderedSections.length - 1];
		observation.headings = observation.headings.filter((heading) => heading !== lastSection);
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /the rendered sections are/);
	});

	it('fails when a bullet is missing', () => {
		const observation = completeObservation();
		observation.bullets = observation.bullets.slice(0, -1);
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /bullet\(s\), expected/);
	});

	it('fails when a lead paragraph is missing', () => {
		const observation = completeObservation();
		observation.leads = observation.leads.slice(0, -1);
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /the rendered section leads do not match/);
	});

	it('fails when a document metadata item is missing', () => {
		const observation = completeObservation();
		observation.meta = observation.meta.slice(0, -1);
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /the document metadata .* is missing/);
	});

	it('fails when the document scrolls sideways', () => {
		const observation = completeObservation();
		observation.scrollWidth = 1600;
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /scrolls sideways/);
	});
});
