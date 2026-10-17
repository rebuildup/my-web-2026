import { describe, expect, it } from 'vitest';
import { GENERIC_UPLOAD_FAILURE, describeUploadFailure } from './upload-errors';

/**
 * Safe-failure contract for the admin image library (Issue #458).
 *
 * The upload / delete server functions reject with a stable
 * `image_policy:<code>` string. This module decides what the page shows
 * for each of them. Two properties matter and are asserted here:
 *
 *   1. a KNOWN code always resolves to a fixed Japanese sentence — the
 *      admin can act on the reason;
 *   2. anything else (a stack fragment, a SQL string, a secret that
 *      reached an error message) NEVER reaches the DOM.
 */

describe('describeUploadFailure', () => {
	it.each([
		['image_policy:invalid_filename'],
		['image_policy:unsupported_content_type'],
		['image_policy:oversize'],
		['image_policy:empty_payload'],
		['image_policy:svg_not_allowed'],
		['image_policy:content_type_mismatch'],
		['image_policy:unrecognized_signature'],
		['image_referenced'],
	])('maps %s to a non-empty sentence', (code) => {
		const message = describeUploadFailure(new Error(code));
		expect(message).not.toBe('');
		expect(message).not.toBe(GENERIC_UPLOAD_FAILURE);
		// The rendered sentence must not leak the wire code back.
		expect(message).not.toContain('image_policy:');
	});

	it('accepts a bare Error, a string, and a raw object alike', () => {
		expect(describeUploadFailure(new Error('image_policy:oversize'))).toBe(
			describeUploadFailure('image_policy:oversize'),
		);
		expect(describeUploadFailure(null)).toBe(GENERIC_UPLOAD_FAILURE);
		expect(describeUploadFailure(undefined)).toBe(GENERIC_UPLOAD_FAILURE);
		expect(describeUploadFailure({ code: 'oversize' })).toBe(GENERIC_UPLOAD_FAILURE);
	});

	it('collapses an unknown policy code to the generic sentence', () => {
		expect(describeUploadFailure(new Error('image_policy:invented_later'))).toBe(
			GENERIC_UPLOAD_FAILURE,
		);
	});

	it('never renders an unrecognised message body', () => {
		const leak = 'SQLITE_ERROR: no such table: reaction_images (bucket=my-web-2026)';
		expect(describeUploadFailure(new Error(leak))).toBe(GENERIC_UPLOAD_FAILURE);
		expect(describeUploadFailure(leak)).toBe(GENERIC_UPLOAD_FAILURE);
	});
});
