import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	KNOWN_CLAIM_CLASSES,
	REQUIRED_SECTIONS,
	evaluateObservation,
} from './capture-portfolio-case-study.mjs';

/**
 * Unit tests for the pure verdict half of the Issue #519 capture.
 * The browser half is exercised by running the script itself.
 */

function observation(overrides = {}) {
	return {
		scrollWidth: 1440,
		clientWidth: 1440,
		headings: [...REQUIRED_SECTIONS],
		legendPresent: true,
		classLabels: ['confirmed', 'period-estimate', 'current-evaluation'],
		markKinds: ['confirmed', 'period-estimate', 'current-evaluation'],
		...overrides,
	};
}

describe('evaluateObservation (#519)', () => {
	it('accepts a complete observation', () => {
		const verdict = evaluateObservation(observation());
		assert.equal(verdict.ok, true);
		assert.deepEqual(verdict.failures, []);
	});

	it('fails when nothing rendered', () => {
		const verdict = evaluateObservation(null);
		assert.equal(verdict.ok, false);
	});

	it('fails on horizontal scroll', () => {
		const verdict = evaluateObservation(observation({ scrollWidth: 1500 }));
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /horizontal scroll/);
	});

	it('fails when a required section is missing', () => {
		const verdict = evaluateObservation(observation({ headings: REQUIRED_SECTIONS.slice(0, 3) }));
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /検証結果 \/ Verification/);
	});

	it('fails on an unknown claim class', () => {
		const verdict = evaluateObservation(observation({ classLabels: ['confirmed', 'guess'] }));
		assert.equal(verdict.ok, false);
		assert.match(verdict.failures.join('\n'), /unknown claim class "guess"/);
	});

	it('reports — but does not fail — a class with no fixture entry', () => {
		const verdict = evaluateObservation(observation({ classLabels: ['confirmed'] }));
		assert.equal(verdict.ok, true);
		assert.ok(verdict.summary.some((line) => line.includes('period-estimate')));
	});

	it('pins the known class vocabulary', () => {
		assert.deepEqual(
			[...KNOWN_CLAIM_CLASSES],
			['confirmed', 'period-estimate', 'current-evaluation'],
		);
	});
});
