#!/usr/bin/env node
/**
 * Unit tests for the pure verdict half of the Issue #518 capture.
 * The browser half is exercised by running the script itself.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MY_WEB_2026_PROJECT_HISTORY } from '../src/portfolio/fixtures/project-history.ts';
import {
	CAPTURES,
	KNOWN_BASES,
	REQUIRED_KINDS,
	evaluateObservation,
} from './capture-project-history.mjs';

function observation(overrides = {}) {
	return {
		scrollWidth: 1440,
		clientWidth: 1440,
		legendPresent: true,
		sourcesLabelPresent: true,
		basisLabels: ['record', 'recollection'],
		events: MY_WEB_2026_PROJECT_HISTORY.events.map((e) => ({
			id: e.id,
			kind: e.kind,
			basis: e.basis,
			sourceCount: e.sources.length,
		})),
		imageCount: 0,
		monthMarkers: MY_WEB_2026_PROJECT_HISTORY.events.filter((e) => e.precision === 'month').length,
		...overrides,
	};
}

describe('capture-project-history (Issue #518)', () => {
	it('captures the two Issue-named PNGs at desktop and mobile widths', () => {
		assert.deepEqual(
			CAPTURES.map((c) => c.artefact),
			[
				'docs/verification/portfolio/project-history-story.png',
				'docs/verification/portfolio/project-history-mobile.png',
			],
		);
		assert.deepEqual(
			CAPTURES.map((c) => c.width),
			[1440, 390],
		);
	});

	it('pins the required kind and basis vocabulary', () => {
		assert.deepEqual([...REQUIRED_KINDS], ['start', 'revision', 'publication']);
		assert.deepEqual([...KNOWN_BASES], ['record', 'recollection']);
	});

	it('accepts a complete observation', () => {
		const verdict = evaluateObservation(observation());
		assert.equal(verdict.ok, true);
		assert.deepEqual(verdict.failures, []);
	});

	it('fails when nothing rendered', () => {
		assert.equal(evaluateObservation(null).ok, false);
	});

	it('fails on horizontal scroll', () => {
		const verdict = evaluateObservation(observation({ scrollWidth: 2000, clientWidth: 390 }));
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /horizontal scroll/);
	});

	it('fails when a required kind is missing', () => {
		const events = observation().events.filter((e) => e.kind !== 'publication');
		const verdict = evaluateObservation(observation({ events }));
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /"publication"/);
	});

	it('fails when an event renders no source', () => {
		const events = observation().events.map((e, i) => (i === 0 ? { ...e, sourceCount: 0 } : e));
		const verdict = evaluateObservation(observation({ events }));
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /renders no source/);
	});

	it('fails when an image slips into the text-only timeline', () => {
		const verdict = evaluateObservation(observation({ imageCount: 1 }));
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /<img>/);
	});

	it('fails when the month markers do not match the fixture', () => {
		const verdict = evaluateObservation(observation({ monthMarkers: 0 }));
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /month markers/);
	});

	it('fails when the event count does not match the fixture', () => {
		const events = observation().events.slice(1);
		const verdict = evaluateObservation(observation({ events }));
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /rendered \d+ event/);
	});
});
