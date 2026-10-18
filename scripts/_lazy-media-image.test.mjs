import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	MAX_EVIDENCE_BYTES,
	MAX_EVIDENCE_WIDTH,
	assertEvidenceSize,
} from './_lazy-media-image.mjs';

describe('evidence image budget (Issue #487)', () => {
	it('states the budget the README promises', () => {
		assert.equal(MAX_EVIDENCE_BYTES, 300 * 1024);
		assert.equal(MAX_EVIDENCE_WIDTH, 1600);
	});

	it('passes an image inside the budget', () => {
		const bytes = 106 * 1024;
		assert.equal(assertEvidenceSize(bytes, 'docs/verification/perf/report.webp'), bytes);
	});

	it('accepts an image exactly at the budget', () => {
		assert.equal(assertEvidenceSize(MAX_EVIDENCE_BYTES, 'at.webp'), MAX_EVIDENCE_BYTES);
	});

	it('refuses an image over the budget instead of writing it', () => {
		assert.throws(
			() => assertEvidenceSize(MAX_EVIDENCE_BYTES + 1, 'over.webp'),
			/over the 300 KB budget/,
		);
	});

	it('refuses a size measurement it cannot trust', () => {
		// A missing field renders as `undefined` upstream; treating that
		// as "small enough" would let the cap pass on a number nobody
		// measured.
		assert.throws(() => assertEvidenceSize(undefined, 'missing.webp'), /not a usable number/);
		assert.throws(() => assertEvidenceSize(Number.NaN, 'nan.webp'), /not a usable number/);
		assert.throws(() => assertEvidenceSize(0, 'empty.webp'), /not a usable number/);
	});
});
