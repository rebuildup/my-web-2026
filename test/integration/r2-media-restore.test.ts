/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	type MediaRestoreManifestEntry,
	type MediaRestoreObjectState,
	type MediaRestoreStore,
	type MediaRetainedSource,
	RESTORE_VERDICT,
	restoreMediaObject,
	sha256Hex,
} from '../../src/cloudflare/media-restore';
import { createPublicMediaDelivery } from '../../src/cloudflare/media-visibility';

/**
 * R2 media restore, executed against the local workerd R2 binding
 * (Issue #462).
 *
 * The claim under test: **one deleted public image can be put back,
 * and the procedure can prove it is the same image.**
 *
 * `scripts/_r2-media-key-set.mjs` proves the bucket holds only keys in
 * a public namespace; this file proves the other half of the storage
 * story — that a deletion is recoverable, that the recovered object
 * matches the manifest captured before the deletion, and that a
 * restore which cannot be proven fails instead of reporting success.
 *
 * Everything runs against the local Miniflare R2 fixture. No
 * production bucket, no deploy, no remote mutation: `env.MEDIA` here
 * is the test-pool binding declared in `vitest.config.ts`.
 *
 * Fixture bytes are a synthetic 1×1 PNG (`makePng`). No personal
 * content, no real portfolio asset, no credential. The manifest
 * digest is computed here rather than hard-coded, because the
 * contract under test is "the stored object matches the manifest",
 * not "this repository remembers a digest".
 */

const R2 = () => env.MEDIA;

const RESTORE_KEY = 'portfolio/restore-fixture/cover.png';
const PRIVATE_RESTORE_KEY = 'private/draft/restore-fixture.png';

/** Synthetic 1×1 PNG. The boundary never decodes pixels. */
const makePng = (tint: number) =>
	new Uint8Array([
		0x89,
		0x50,
		0x4e,
		0x47,
		0x0d,
		0x0a,
		0x1a,
		0x0a,
		0x00,
		0x00,
		0x00,
		0x0d,
		0x49,
		0x48,
		0x44,
		0x52,
		0x00,
		0x00,
		0x00,
		0x01,
		0x00,
		0x00,
		0x00,
		0x01,
		0x08,
		0x06,
		0x00,
		0x00,
		0x00,
		0x1f,
		0x15,
		0xc4,
		0x89,
		0x00,
		0x00,
		0x00,
		0x0d,
		0x49,
		0x44,
		0x41,
		0x54,
		0x78,
		0x9c,
		0x63,
		tint,
		0x01,
		0x00,
		0x00,
		0x05,
		0x00,
		0x01,
		0x0d,
		0x0a,
		0x2d,
		0xb4,
		0x00,
		0x00,
		0x00,
		0x00,
		0x49,
		0x45,
		0x4e,
		0x44,
		0xae,
		0x42,
		0x60,
		0x82,
	]);

const RETAINED = makePng(0x00);
const OTHER = makePng(0x7f);

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bufferOf(body: ReadableStream | null): Promise<Uint8Array> {
	return new Response(body).arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

/**
 * The `MEDIA` bucket as the restore model sees it: a hash per read,
 * because the verification contract is stated in digests rather than
 * in "the write returned".
 */
function r2Store(): MediaRestoreStore {
	return {
		read: async (key): Promise<MediaRestoreObjectState | null> => {
			const object = await R2().get(key);
			if (!object) return null;
			const bytes = await bufferOf(object.body);
			return {
				bytes,
				sizeBytes: object.size,
				sha256: await sha256Hex(bytes),
				contentType: object.httpMetadata?.contentType ?? null,
			};
		},
		write: async (entry, bytes) => {
			await R2().put(entry.key, asArrayBuffer(bytes), {
				httpMetadata: { contentType: entry.contentType },
			});
		},
	};
}

/** The retained export: bytes held outside the bucket, as an operator has them. */
function retainedSource(bytes: Uint8Array | null): MediaRetainedSource {
	return {
		read: async () => (bytes === null ? null : { bytes, contentType: 'image/png' }),
	};
}

async function manifestFor(key: string, bytes: Uint8Array): Promise<MediaRestoreManifestEntry> {
	return {
		key,
		sha256: await sha256Hex(bytes),
		sizeBytes: bytes.byteLength,
		contentType: 'image/png',
	};
}

beforeEach(async () => {
	for (const key of [RESTORE_KEY, PRIVATE_RESTORE_KEY]) await R2().delete(key);
});

describe('a deleted public image is restored from its retained source', () => {
	it('recovers the exact bytes and the manifest metadata', async () => {
		const entry = await manifestFor(RESTORE_KEY, RETAINED);

		// 1. the object is published and serving,
		await R2().put(RESTORE_KEY, asArrayBuffer(RETAINED), {
			httpMetadata: { contentType: 'image/png' },
		});
		const before = await createPublicMediaDelivery(R2()).fetch(RESTORE_KEY);
		expect(before.status).toBe(200);

		// 2. it is deleted,
		await R2().delete(RESTORE_KEY);
		expect(await R2().head(RESTORE_KEY)).toBeNull();
		const whileMissing = await createPublicMediaDelivery(R2()).fetch(RESTORE_KEY);
		expect(whileMissing.status).toBe(404);

		// 3. and restored from the retained source,
		const result = await restoreMediaObject(r2Store(), retainedSource(RETAINED), entry);
		expect(result.verdict).toBe(RESTORE_VERDICT.restored);
		expect(result.reason).toBe('-');

		// 4. byte-for-byte and metadata-for-metadata identical,
		const head = await R2().head(RESTORE_KEY);
		expect(head?.size).toBe(RETAINED.byteLength);
		expect(head?.httpMetadata?.contentType).toBe('image/png');
		const restoredObject = await R2().get(RESTORE_KEY);
		expect(restoredObject).not.toBeNull();
		expect(await sha256Hex(await bufferOf(restoredObject?.body ?? null))).toBe(entry.sha256);

		// 5. and serving again through the delivery boundary.
		const after = await createPublicMediaDelivery(R2()).fetch(RESTORE_KEY);
		expect(after.status).toBe(200);
		if (after.status !== 200) return;
		expect(after.contentType).toBe('image/png');
	});

	it('is idempotent when the same restore runs twice', async () => {
		const entry = await manifestFor(RESTORE_KEY, RETAINED);
		await R2().put(RESTORE_KEY, asArrayBuffer(RETAINED), {
			httpMetadata: { contentType: 'image/png' },
		});

		const second = await restoreMediaObject(r2Store(), retainedSource(RETAINED), entry);

		expect(second.verdict).toBe(RESTORE_VERDICT.alreadyIntact);
		expect((await R2().head(RESTORE_KEY))?.size).toBe(RETAINED.byteLength);
	});
});

describe('a restore that cannot be proven does not write', () => {
	it('leaves the bucket empty when nothing was retained', async () => {
		const entry = await manifestFor(RESTORE_KEY, RETAINED);

		const result = await restoreMediaObject(r2Store(), retainedSource(null), entry);

		expect(result.verdict).toBe(RESTORE_VERDICT.missingSource);
		expect(result.reason).toBe('source_unavailable');
		expect(await R2().head(RESTORE_KEY)).toBeNull();
	});

	it('refuses to upload different bytes under a published key', async () => {
		const entry = await manifestFor(RESTORE_KEY, RETAINED);

		const result = await restoreMediaObject(r2Store(), retainedSource(OTHER), entry);

		expect(result.verdict).toBe(RESTORE_VERDICT.metadataDrift);
		expect(result.reason).toBe('source_digest_mismatch');
		expect(await R2().head(RESTORE_KEY)).toBeNull();
	});

	it('refuses a private-namespace key without creating it', async () => {
		const entry = await manifestFor(PRIVATE_RESTORE_KEY, RETAINED);

		const result = await restoreMediaObject(r2Store(), retainedSource(RETAINED), entry);

		expect(result.verdict).toBe(RESTORE_VERDICT.refusedKey);
		expect(result.reason).toBe('key_not_publicly_servable');
		// The refusal happens before the write, so the object never
		// exists — not even privately.
		expect(await R2().head(PRIVATE_RESTORE_KEY)).toBeNull();
		expect((await R2().list()).objects.map((object) => object.key)).not.toContain(
			PRIVATE_RESTORE_KEY,
		);
	});

	it('repairs an object whose stored content type was lost', async () => {
		const entry = await manifestFor(RESTORE_KEY, RETAINED);
		// Same bytes, wrong metadata: the manifest's content type is
		// what gets restored, and the read-back is what proves it.
		await R2().put(RESTORE_KEY, asArrayBuffer(RETAINED), { httpMetadata: {} });

		const result = await restoreMediaObject(r2Store(), retainedSource(RETAINED), entry);

		expect(result.verdict).toBe(RESTORE_VERDICT.restored);
		expect((await R2().head(RESTORE_KEY))?.httpMetadata?.contentType).toBe('image/png');
	});
});
