#!/usr/bin/env node
/**
 * Capture-script contract for Issue #524.
 *
 * The verification image is only evidence if it is the SHIPPED preview
 * and if the capture fails when the preview stops matching the
 * document. These assertions cover the parts that can be decided
 * without a browser: the PNG-only output contract, the harness that
 * renders the shipped story, and the comparison that turns a
 * half-rendered preview — or an invented link — into a failed capture.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	HANDLE_MAP_DOCUMENT,
	HANDLE_MAP_ENTRIES,
	HANDLE_MAP_LEGEND,
	HANDLE_MAP_SECTIONS,
} from '../src/personal/handle-map/HandleMap.preview.ts';
import {
	DEFAULT_ARTEFACT_PATH,
	PNG_BUDGET_BYTES,
	assertPngOutputPath,
	harnessMainTsx,
	screenshotBudgetVerdict,
	verifyRenderedPreview,
} from './capture-handle-map.mjs';

/** The observation a correct render produces (the fixture of "everything is there"). */
function completeObservation() {
	return {
		title: HANDLE_MAP_DOCUMENT.title,
		meta: [
			HANDLE_MAP_DOCUMENT.status,
			HANDLE_MAP_DOCUMENT.source,
			HANDLE_MAP_DOCUMENT.verification,
			HANDLE_MAP_DOCUMENT.preview,
		],
		headings: [
			...[HANDLE_MAP_LEGEND.heading, ...HANDLE_MAP_SECTIONS.map((section) => section.heading)].map(
				(text) => ({ level: 'H2', text }),
			),
			...HANDLE_MAP_ENTRIES.map((entry) => ({ level: 'H3', text: entry.name })),
		],
		entryNames: HANDLE_MAP_ENTRIES.map((entry) => entry.name),
		hrefs: HANDLE_MAP_ENTRIES.flatMap((entry) => entry.links.map((link) => link.url)),
		bullets: HANDLE_MAP_SECTIONS.flatMap((section) => [...section.bullets]),
		scrollWidth: 1440,
		clientWidth: 1440,
	};
}

describe('capture-handle-map (Issue #524)', () => {
	it('refuses an output path that is not PNG', () => {
		assert.throws(
			() => assertPngOutputPath('docs/verification/identity/handle-map-story.webp'),
			/non-PNG/,
		);
	});

	it('refuses an output path outside the repository', () => {
		assert.throws(() => assertPngOutputPath('../outside.png'), /outside the repository/);
	});

	it('accepts the committed PNG path', () => {
		const resolved = assertPngOutputPath(DEFAULT_ARTEFACT_PATH, process.cwd());
		assert.ok(resolved.endsWith('docs/verification/identity/handle-map-story.png'));
	});

	it('reports the artefact budget', () => {
		assert.equal(screenshotBudgetVerdict(1024).withinBudget, true);
		assert.equal(screenshotBudgetVerdict(PNG_BUDGET_BYTES).withinBudget, true);
		assert.equal(screenshotBudgetVerdict(PNG_BUDGET_BYTES + 1).withinBudget, false);
	});

	it('renders the shipped story module, not a copy of it', () => {
		const main = harnessMainTsx();
		assert.match(main, /HandleMap\.stories\.tsx/);
		assert.match(main, /Default/);
		assert.match(main, /src\/styles\.css/);
	});

	it('passes a render that shows the whole legend', () => {
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

	it('fails when a legend entry is missing', () => {
		const observation = completeObservation();
		observation.entryNames = observation.entryNames.slice(0, -1);
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /the rendered legend entries are/);
	});

	it('fails when a published link is missing', () => {
		const observation = completeObservation();
		observation.hrefs = observation.hrefs.slice(0, -1);
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /is missing from the preview|link\(s\), expected/);
	});

	it('fails when the page carries an undeclared link', () => {
		const observation = completeObservation();
		observation.hrefs = [...observation.hrefs, 'https://example.com/invented'];
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /link\(s\), expected/);
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

	it('fails when a note bullet is missing', () => {
		const observation = completeObservation();
		observation.bullets = observation.bullets.slice(0, -1);
		const verdict = verifyRenderedPreview(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /note bullet\(s\), expected/);
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
