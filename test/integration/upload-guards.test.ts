/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { applyD1Migrations, env } from 'cloudflare:test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DELETE_REFERENCED_FAILURE, uploadReactionImageImpl } from '../../src/admin/images/load';
import {
	GENERIC_UPLOAD_FAILURE,
	describeUploadFailure,
} from '../../src/admin/images/upload-errors';
import {
	ImagePolicyError,
	ImageReferencedError,
	assertImageUploadPolicy,
	deleteImage,
	isSafeUploadFilename,
	sniffImageContentType,
	uploadImage,
} from '../../src/http/reactions/images';
import { putReaction } from '../../src/http/reactions/reactions';
import { MAX_IMAGE_BYTES } from '../../src/http/reactions/schema';
import {
	GIF89A_BYTES,
	GIF_BYTES,
	HTML_BYTES,
	JPEG_BYTES,
	PNG_BYTES,
	SVG_BOM_BYTES,
	SVG_BYTES,
	TEXT_BYTES,
	WEBP_BYTES,
	ZIP_BYTES,
	repeatTo,
	toArrayBuffer,
} from '../helpers/image-fixtures';

/**
 * Admin image-upload guard matrix (Issue #458).
 *
 * What this suite proves, against the REAL D1 / R2 bindings of the
 * local workerd pool:
 *
 *   - declared MIME must agree with the magic bytes ("偽画像" —
 *     text / HTML / ZIP / SVG renamed to `.png` is refused);
 *   - the 256 KiB cap and the empty-payload case are refused;
 *   - an unsafe client-supplied file name (traversal, control
 *     character, over-long) is refused, and a safe-but-awkward name
 *     still cannot reach the R2 key;
 *   - a refusal leaves NOTHING behind — no D1 row, no R2 object;
 *   - a genuine PNG / JPEG / WebP / GIF registers and its R2 key stays
 *     content-addressed (`reactions/<sha256>.<ext>`).
 *
 * Nothing here touches a production resource: `env.DB` / `env.MEDIA`
 * are the Miniflare bindings declared in `vitest.config.ts`, and every
 * input is a hand-written byte fixture from
 * `test/helpers/image-fixtures.ts`. That is what makes the guard
 * verifiable without shipping the unguarded path first (the Issue's
 * "外部機能 없이 adapter/test で完結する" requirement).
 *
 * The suite also PRINTS the measured matrix between the markers below.
 * `scripts/capture-image-upload-guards-report.mjs` renders exactly
 * that block into `docs/verification/security/image-upload-guards.webp`,
 * so the committed screenshot is a reproduction of these runs rather
 * than a hand-written claim.
 */

const MIGRATIONS = [
	{
		name: '0003_reactions_for_upload_guards',
		queries: [
			`CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY,
        target_key TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        principal TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('emoji', 'image')),
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (target_key, principal, actor_id, kind, value)
    )`,
			`CREATE TABLE IF NOT EXISTS reaction_images (
        id TEXT PRIMARY KEY,
        content_hash TEXT UNIQUE NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        r2_key TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL
    )`,
		],
	},
];

const D1 = () => env.DB;
const R2 = () => env.MEDIA;

const START = '<!-- image-upload-guards-matrix:start -->';
const END = '<!-- image-upload-guards-matrix:end -->';

type Verdict = 'accepted' | 'rejected';

interface MatrixRow {
	index: number;
	label: string;
	declared: string;
	detected: string;
	filename: string;
	size: string;
	verdict: Verdict;
	code: string;
	r2Key: string;
}

const measured: MatrixRow[] = [];

/** Human-readable byte size for the report (`4 B`, `256.0 KiB`). */
function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(1)} KiB`;
}

function describeBytes(bytes: Uint8Array): string {
	const detected = sniffImageContentType(bytes);
	return detected ?? 'none';
}

async function countImages(): Promise<number> {
	const row = await D1()
		.prepare('SELECT COUNT(*) AS n FROM reaction_images')
		.first<{ n: number }>();
	return row?.n ?? 0;
}

async function countObjects(): Promise<number> {
	const listed = await R2().list({ prefix: 'reactions/' });
	return listed.objects.length;
}

/**
 * Run one hostile-or-benign upload through the real admin path and
 * record what actually happened. Every row of the report comes from
 * this function's measured return values.
 */
async function measure(input: {
	label: string;
	declared: string;
	bytes: Uint8Array;
	filename?: string;
	base64?: string;
}): Promise<MatrixRow> {
	const before = { rows: await countImages(), objects: await countObjects() };
	const row: MatrixRow = {
		index: measured.length + 1,
		label: input.label,
		declared: input.declared,
		detected: describeBytes(input.bytes),
		filename: input.filename ?? '(なし)',
		size: formatSize(input.bytes.byteLength),
		verdict: 'rejected',
		code: '—',
		r2Key: '—',
	};
	try {
		const result = await uploadReactionImageImpl({
			contentType: input.declared as 'image/png',
			filename: input.filename,
			bytes: input.base64 ?? toBase64(input.bytes),
			uploadedBy: 'guard-tester',
		});
		row.verdict = 'accepted';
		row.code = result.referenced ? 'referenced' : 'stored';
		row.r2Key = result.r2Key;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		row.code = message.startsWith('image_policy:')
			? message.slice('image_policy:'.length)
			: message;
	}
	const after = { rows: await countImages(), objects: await countObjects() };
	if (row.verdict === 'rejected') {
		// A refusal must be inert: nothing new in D1, nothing new in R2.
		expect(after.rows).toBe(before.rows);
		expect(after.objects).toBe(before.objects);
	}
	measured.push(row);
	return row;
}

/**
 * Escape a value for a Markdown table cell. Control characters are
 * rendered as `\uXXXX` escapes — a literal newline would otherwise
 * split the cell and break the rendered report.
 */
function cell(value: string): string {
	let out = '';
	for (const char of value) {
		const code = char.codePointAt(0) ?? 0;
		out += code < 0x20 || code === 0x7f ? `\\u${code.toString(16).padStart(4, '0')}` : char;
	}
	return out;
}

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

beforeAll(async () => {
	await applyD1Migrations(D1(), MIGRATIONS);
});

beforeEach(async () => {
	await D1().prepare('DELETE FROM reaction_images').run();
	const listed = await R2().list({ prefix: 'reactions/' });
	await Promise.all(listed.objects.map((o) => R2().delete(o.key)));
});

afterAll(() => {
	const lines = [
		START,
		'| # | 入力 | 宣言 MIME | 実体(署名) | ファイル名 | サイズ | 結果 | コード | R2 key |',
		'| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
		...measured.map(
			(r) =>
				`| ${r.index} | ${r.label} | \`${cell(r.declared)}\` | \`${cell(r.detected)}\` | \`${cell(r.filename)}\` | ${r.size} | ${r.verdict} | \`${cell(r.code)}\` | ${r.r2Key === '—' ? '—' : `\`${cell(r.r2Key.replace(/[0-9a-f]{64}/, '<sha256>'))}\``} |`,
		),
		END,
	];
	process.stdout.write(`\n${lines.join('\n')}\n`);
});

describe('upload guards — genuine images register', () => {
	it('accepts a real PNG and stores it under a content-addressed key', async () => {
		const row = await measure({
			label: '実PNG',
			declared: 'image/png',
			bytes: PNG_BYTES,
			filename: 'reaction.png',
		});
		expect(row.verdict).toBe('accepted');
		expect(row.r2Key).toMatch(/^reactions\/[0-9a-f]{64}\.png$/);
		expect(await countImages()).toBe(1);
	});

	it.each([
		['image/jpeg', JPEG_BYTES, 'photo.jpg', '実JPEG'],
		['image/webp', WEBP_BYTES, 'photo.webp', '実WebP'],
		['image/gif', GIF_BYTES, 'anim.gif', '実GIF87a'],
		['image/gif', GIF89A_BYTES, 'anim89.gif', '実GIF89a'],
	])('accepts %s', async (declared, bytes, filename, label) => {
		const row = await measure({ label, declared, bytes, filename });
		expect(row.verdict).toBe('accepted');
		expect(row.r2Key).toMatch(/^reactions\/[0-9a-f]{64}\.[a-z0-9]+$/);
	});

	it('keeps an awkward but safe name out of the R2 key', async () => {
		const row = await measure({
			label: '実PNG/日本語名',
			declared: 'image/png',
			bytes: PNG_BYTES,
			filename: 'リアクション (1).png',
		});
		expect(row.verdict).toBe('accepted');
		expect(row.r2Key).toMatch(/^reactions\/[0-9a-f]{64}\.png$/);
		expect(row.r2Key).not.toContain('リアクション');
	});
});

describe('upload guards — fake images are refused', () => {
	it.each([
		['テキスト', TEXT_BYTES],
		['HTML', HTML_BYTES],
		['ZIP', ZIP_BYTES],
	])('refuses %s bytes declared as image/png', async (label, bytes) => {
		const row = await measure({
			label: `${label}→png`,
			declared: 'image/png',
			bytes,
			filename: 'fake.png',
		});
		expect(row.verdict).toBe('rejected');
		expect(row.code).toBe('unrecognized_signature');
	});

	it('refuses a GIF declared as image/png (signature disagrees with declaration)', async () => {
		const row = await measure({
			label: 'GIF→png',
			declared: 'image/png',
			bytes: GIF_BYTES,
			filename: 'mismatch.png',
		});
		expect(row.verdict).toBe('rejected');
		expect(row.code).toBe('content_type_mismatch');
	});

	it('refuses a PNG declared as image/gif', async () => {
		const row = await measure({
			label: 'PNG→gif',
			declared: 'image/gif',
			bytes: PNG_BYTES,
			filename: 'mismatch.gif',
		});
		expect(row.verdict).toBe('rejected');
		expect(row.code).toBe('content_type_mismatch');
	});

	it('refuses an unknown declared type', async () => {
		const row = await measure({
			label: '不明MIME',
			declared: 'application/octet-stream',
			bytes: PNG_BYTES,
			filename: 'whatever.bin',
		});
		expect(row.verdict).toBe('rejected');
		expect(row.code).toBe('unsupported_content_type');
	});
});

describe('upload guards — SVG is refused on the declaration AND on the bytes', () => {
	it('refuses a declared image/svg+xml', async () => {
		const row = await measure({
			label: 'SVG宣言',
			declared: 'image/svg+xml',
			bytes: SVG_BYTES,
			filename: 'vector.svg',
		});
		expect(row.verdict).toBe('rejected');
		expect(row.code).toBe('unsupported_content_type');
	});

	it('refuses SVG bytes that claim to be a PNG', async () => {
		const row = await measure({
			label: 'SVG→png',
			declared: 'image/png',
			bytes: SVG_BYTES,
			filename: 'vector.png',
		});
		expect(row.verdict).toBe('rejected');
		expect(row.code).toBe('svg_not_allowed');
	});

	it('refuses a BOM-prefixed SVG fragment that claims to be a PNG', async () => {
		const row = await measure({
			label: 'BOM+SVG→png',
			declared: 'image/png',
			bytes: SVG_BOM_BYTES,
			filename: 'fragment.png',
		});
		expect(row.verdict).toBe('rejected');
		expect(row.code).toBe('svg_not_allowed');
	});
});

describe('upload guards — size and emptiness', () => {
	it('refuses a payload one byte over the cap', async () => {
		const row = await measure({
			label: '256KiB+1',
			declared: 'image/gif',
			bytes: new Uint8Array(repeatTo(GIF_BYTES, MAX_IMAGE_BYTES + 1)),
			filename: 'huge.gif',
		});
		expect(row.verdict).toBe('rejected');
		expect(row.code).toBe('oversize');
	});

	it('accepts a payload exactly at the cap', async () => {
		const row = await measure({
			label: '256KiB境界',
			declared: 'image/gif',
			bytes: new Uint8Array(repeatTo(GIF_BYTES, MAX_IMAGE_BYTES)),
			filename: 'boundary.gif',
		});
		expect(row.verdict).toBe('accepted');
		expect(row.r2Key).toMatch(/^reactions\/[0-9a-f]{64}\.gif$/);
	});

	it('refuses an over-sized base64 body before decoding it', async () => {
		// One byte of real PNG, padded with base64 characters that decode
		// to more than the cap. The guard is on the encoded length, so
		// the body never has to be materialised as bytes.
		const oversizedBase64 = btoa('A'.repeat(MAX_IMAGE_BYTES + 16));
		await expect(
			uploadReactionImageImpl({
				contentType: 'image/png',
				bytes: oversizedBase64,
				uploadedBy: 'guard-tester',
			}),
		).rejects.toMatchObject({ message: 'image_policy:oversize' });
	});

	it('refuses an empty payload', async () => {
		const row = await measure({
			label: '空',
			declared: 'image/png',
			bytes: new Uint8Array(0),
			filename: 'empty.png',
		});
		expect(row.verdict).toBe('rejected');
		expect(row.code).toBe('empty_payload');
	});
});

describe('upload guards — file name', () => {
	it.each([
		['../../etc/passwd'],
		['..\\..\\windows\\system32\\evil.png'],
		['/etc/passwd'],
		['nested/photo.png'],
		['.'],
		['..'],
		[''],
		[' leading-space.png'],
		['photo\u0000.png'],
		['photo\n.png'],
		['photo\u007f.png'],
		['a'.repeat(256)],
	])('refuses an unsafe file name: %j', async (filename) => {
		expect(isSafeUploadFilename(filename)).toBe(false);
		const row = await measure({
			label: '不正ファイル名',
			declared: 'image/png',
			bytes: PNG_BYTES,
			filename,
		});
		expect(row.verdict).toBe('rejected');
		expect(row.code).toBe('invalid_filename');
	});

	it('accepts the names a real browser produces', () => {
		for (const name of ['photo.png', 'スクリーンショット 2026-10-18.png', 'a(1).png', '_x-.png']) {
			expect(isSafeUploadFilename(name)).toBe(true);
		}
	});
});

describe('upload guards — policy unit surface', () => {
	it('sniffs each accepted signature', () => {
		expect(sniffImageContentType(PNG_BYTES)).toBe('image/png');
		expect(sniffImageContentType(JPEG_BYTES)).toBe('image/jpeg');
		expect(sniffImageContentType(WEBP_BYTES)).toBe('image/webp');
		expect(sniffImageContentType(GIF_BYTES)).toBe('image/gif');
		expect(sniffImageContentType(GIF89A_BYTES)).toBe('image/gif');
		expect(sniffImageContentType(SVG_BYTES)).toBe('image/svg+xml');
		expect(sniffImageContentType(TEXT_BYTES)).toBeNull();
		expect(sniffImageContentType(new Uint8Array(0))).toBeNull();
	});

	it('assertImageUploadPolicy never mutates storage when it rejects', async () => {
		expect(() =>
			assertImageUploadPolicy({
				contentType: 'image/png',
				bytes: toArrayBuffer(TEXT_BYTES),
			}),
		).toThrowError(ImagePolicyError);
		expect(await countImages()).toBe(0);
		expect(await countObjects()).toBe(0);
	});

	it('treats a null file name as "no name" instead of crashing', () => {
		// The exported boundary is reachable with `filename: null` from
		// anything that is not the Zod-validated server function; it must
		// answer with a policy decision, not a bare TypeError (#458 review).
		expect(() =>
			assertImageUploadPolicy({
				contentType: 'image/png',
				bytes: toArrayBuffer(PNG_BYTES),
				filename: null,
			}),
		).not.toThrow();
	});

	it('uploadImage refuses a body whose bytes disagree with the declared type', async () => {
		await expect(
			uploadImage(D1(), R2(), {
				contentType: 'image/png',
				bytes: toArrayBuffer(HTML_BYTES),
				uploadedBy: 'guard-tester',
			}),
		).rejects.toMatchObject({ code: 'unrecognized_signature' });
	});
});

describe('delete refusal — the wire string the admin page receives', () => {
	it('resolves to the referenced sentence, not the generic upload one', async () => {
		// Regression (#458 review): the delete server function rejects
		// with `image_referenced: <rationale>`. An earlier revision of
		// `describeUploadFailure` required an exact `image_referenced`,
		// so an admin who pressed delete on an image another client had
		// just referenced was shown the generic UPLOAD failure sentence.
		// The constant below is the server's own, not a copy of it.
		const upload = await uploadReactionImageImpl({
			contentType: 'image/png',
			bytes: toBase64(PNG_BYTES),
			filename: 'reaction.png',
			uploadedBy: 'guard-tester',
		});
		await putReaction(D1(), {
			target_key: 'home-page',
			actor_id: 'visitor',
			principal: 'guard-tester',
			kind: 'image',
			value: upload.id,
		});
		await expect(deleteImage(D1(), R2(), upload.id)).rejects.toBeInstanceOf(ImageReferencedError);

		const sentence = describeUploadFailure(new Error(DELETE_REFERENCED_FAILURE));
		expect(sentence).not.toBe(GENERIC_UPLOAD_FAILURE);
		expect(sentence).toBe(describeUploadFailure(new Error('image_referenced')));
		expect(sentence).toContain('削除できません');
	});
});
