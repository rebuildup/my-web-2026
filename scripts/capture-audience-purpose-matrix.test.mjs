#!/usr/bin/env node
/**
 * Capture-script contract for Issue #516.
 *
 * The verification image is only evidence if it is the SHIPPED preview
 * and if the capture fails when the preview stops matching the policy.
 * These assertions cover the parts that can be decided without a
 * browser: the WebP-only output contract, the harness that renders the
 * shipped story, and the comparison that turns a half-rendered preview
 * into a failed capture.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUDIENCE_PURPOSE_SECTIONS } from '../src/personal/audience-purpose/AudiencePurposeMatrix.preview.ts';
import {
	assertWebpOutputPath,
	harnessMainTsx,
	screenshotBudgetVerdict,
	verifyRenderedPolicy,
} from './capture-audience-purpose-matrix.mjs';

/** The observation a correct render produces (the fixture of "everything is there"). */
function completeObservation() {
	return {
		title: '訪問者目的別の編集方針（Issue #516）',
		headings: [
			{ level: 'H1', text: '訪問者目的別の編集方針（Issue #516）' },
			...AUDIENCE_PURPOSE_SECTIONS.map((section) => ({ level: 'H2', text: section.heading })),
		],
		tables: AUDIENCE_PURPOSE_SECTIONS.filter((section) => section.matrix).map((section) => ({
			caption: section.matrix.caption,
			header: [...section.matrix.columns],
			rows: section.matrix.rows.map((row) => [...row]),
		})),
		bullets: AUDIENCE_PURPOSE_SECTIONS.flatMap((section) => [...(section.points ?? [])]),
		scrollWidth: 1440,
		clientWidth: 1440,
	};
}

describe('capture-audience-purpose-matrix (Issue #516)', () => {
	it('refuses an output path that is not WebP', () => {
		assert.throws(
			() => assertWebpOutputPath('docs/verification/vision/audience-purpose-matrix.png'),
			/non-WebP/,
		);
	});

	it('refuses an output path outside the repository', () => {
		assert.throws(() => assertWebpOutputPath('../outside.webp'), /outside the repository/);
	});

	it('accepts the committed WebP path', () => {
		const resolved = assertWebpOutputPath(
			'docs/verification/vision/audience-purpose-matrix.webp',
			process.cwd(),
		);
		assert.ok(resolved.endsWith('docs/verification/vision/audience-purpose-matrix.webp'));
	});

	it('reports the artefact budget', () => {
		assert.equal(screenshotBudgetVerdict(1024).withinBudget, true);
		assert.equal(screenshotBudgetVerdict(10 * 1024 * 1024).withinBudget, false);
	});

	it('renders the shipped story module, not a copy of it', () => {
		const main = harnessMainTsx();
		assert.match(main, /AudiencePurposeMatrix\.stories\.tsx/);
		assert.match(main, /AudiencePurposeMatrixPreview/);
		assert.match(main, /Preview/);
		assert.match(main, /src\/styles\.css/);
	});

	it('passes a render that shows the whole policy', () => {
		const verdict = verifyRenderedPolicy(completeObservation());
		assert.deepEqual(verdict.failures, []);
		assert.equal(verdict.ok, true);
	});

	it('fails when a section is missing', () => {
		const observation = completeObservation();
		observation.headings = observation.headings.slice(0, -1);
		const verdict = verifyRenderedPolicy(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /the rendered sections are/);
	});

	it('fails when a table is missing', () => {
		const observation = completeObservation();
		observation.tables = observation.tables.slice(0, 1);
		const verdict = verifyRenderedPolicy(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /rendered 1 table\(s\), expected 2/);
	});

	it('fails when a bullet is missing', () => {
		const observation = completeObservation();
		observation.bullets = observation.bullets.slice(0, -1);
		const verdict = verifyRenderedPolicy(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /bullet\(s\), expected/);
	});

	it('fails when the document scrolls sideways', () => {
		const observation = completeObservation();
		observation.scrollWidth = 1600;
		const verdict = verifyRenderedPolicy(observation);
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /scrolls sideways/);
	});
});
