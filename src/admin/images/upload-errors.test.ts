import { describe, expect, it } from 'vitest';
import { GENERIC_UPLOAD_FAILURE, describeUploadFailure } from './upload-errors';

/**
 * Safe-failure contract for the admin image library (Issue #458).
 *
 * The admin server functions reject with stable wire strings, and
 * this module decides what the page shows for each of them. Two
 * properties matter and are asserted here:
 *
 *   1. a KNOWN code always resolves to a fixed Japanese sentence —
 *      the admin can act on the reason. The table below is the exact
 *      shape each code takes on the wire, not an idealised one;
 *   2. anything else (a stack fragment, a SQL string, a secret that
 *      reached an error message) NEVER reaches the DOM.
 *
 * Regression (#458 review): the delete path throws
 * `image_referenced: <rationale>` and an earlier revision matched the
 * bare code only, so a delete refusal rendered the generic UPLOAD
 * sentence. `test/integration/upload-guards.test.ts` asserts the same
 * contract against `DELETE_REFERENCED_FAILURE`, the constant the
 * server function really throws.
 */
const WIRE_MESSAGES: readonly (readonly [string, string])[] = [
	[
		'image_policy:invalid_filename',
		'ファイル名が使用できません。パスや「..」を含む名前は拒否されます。',
	],
	[
		'image_policy:unsupported_content_type',
		'許可されない形式です。PNG / JPEG / WebP / GIF を選択してください。',
	],
	['image_policy:oversize', 'ファイルが大きすぎます。256 KiB 以下にしてください。'],
	['image_policy:empty_payload', 'ファイルが空です。別の画像を選択してください。'],
	[
		'image_policy:svg_not_allowed',
		'SVG は受け付けません。PNG / JPEG / WebP / GIF に変換してください。',
	],
	[
		'image_policy:content_type_mismatch',
		'拡張子と中身が一致しません。実際の画像ファイルを選択してください。',
	],
	[
		'image_policy:unrecognized_signature',
		'画像ファイルとして認識できません。別の画像を選択してください。',
	],
	[
		// The literal `deleteReactionImage` throws (DELETE_REFERENCED_FAILURE).
		'image_referenced: delete referencing reactions first',
		'リアクションで参照中の画像は削除できません。先にリアクションを削除してください。',
	],
];

describe('describeUploadFailure', () => {
	it.each(WIRE_MESSAGES)('maps %s to its fixed sentence', (wire, sentence) => {
		expect(describeUploadFailure(new Error(wire))).toBe(sentence);
		expect(describeUploadFailure(wire)).toBe(sentence);
		// The rendered sentence must not leak the wire code back.
		expect(sentence).not.toContain('image_policy:');
		expect(sentence).not.toBe('');
		expect(sentence).not.toBe(GENERIC_UPLOAD_FAILURE);
	});

	it('accepts a bare Error, a string, and a raw object alike', () => {
		expect(describeUploadFailure(new Error('image_policy:oversize'))).toBe(
			describeUploadFailure('image_policy:oversize'),
		);
		expect(describeUploadFailure(null)).toBe(GENERIC_UPLOAD_FAILURE);
		expect(describeUploadFailure(undefined)).toBe(GENERIC_UPLOAD_FAILURE);
		expect(describeUploadFailure({ code: 'oversize' })).toBe(GENERIC_UPLOAD_FAILURE);
	});

	it('resolves a code whether or not the server appended a rationale', () => {
		// Both spellings of the delete refusal, and a policy code that
		// grew a rationale later, must land on the same sentence.
		expect(describeUploadFailure(new Error('image_referenced'))).toBe(
			describeUploadFailure(new Error('image_referenced: delete referencing reactions first')),
		);
		expect(describeUploadFailure(new Error('image_policy:oversize: bytes must be ≤262144'))).toBe(
			describeUploadFailure(new Error('image_policy:oversize')),
		);
	});

	it('collapses an unknown policy code to the generic sentence', () => {
		expect(describeUploadFailure(new Error('image_policy:invented_later'))).toBe(
			GENERIC_UPLOAD_FAILURE,
		);
		expect(describeUploadFailure(new Error('image_busy: try later'))).toBe(GENERIC_UPLOAD_FAILURE);
	});

	it('never resolves an inherited object member as a code', () => {
		// A plain-object map would answer `constructor` / `toString`
		// with an inherited function; the code map is a Map precisely
		// so an untrusted message cannot walk the prototype.
		expect(describeUploadFailure(new Error('image_policy:constructor'))).toBe(
			GENERIC_UPLOAD_FAILURE,
		);
		expect(describeUploadFailure(new Error('toString'))).toBe(GENERIC_UPLOAD_FAILURE);
	});

	it('never renders an unrecognised message body', () => {
		const leak = 'SQLITE_ERROR: no such table: reaction_images (bucket=my-web-2026)';
		expect(describeUploadFailure(new Error(leak))).toBe(GENERIC_UPLOAD_FAILURE);
		expect(describeUploadFailure(leak)).toBe(GENERIC_UPLOAD_FAILURE);
	});
});
