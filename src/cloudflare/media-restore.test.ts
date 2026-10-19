import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	type MediaRestoreManifestEntry,
	type MediaRestoreObjectState,
	type MediaRestoreStore,
	type MediaRetainedSource,
	RESTORE_VERDICT,
	formatRestoreReport,
	isRestoreSuccessful,
	normalizeMediaContentType,
	restoreExitCodeFor,
	restoreMediaObject,
	sha256Hex,
} from './media-restore';

/**
 * Unit tests for the R2 media restore model (Issue #462).
 *
 * The claim under test: after one public object is deleted from
 * `MEDIA`, the procedure puts back **the object that was lost** — not
 * something that merely occupies its key — and every state in which
 * that cannot be proven fails instead of reporting success.
 *
 * The bucket side is exercised against the real workerd R2 binding in
 * `test/integration/r2-media-restore.test.ts`; this file pins the pure
 * decision logic with a stub store, so a failure names the rule that
 * broke instead of the binding.
 */

const PNG_BYTES = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
	0x42, 0x60, 0x82,
]);

/** A different valid PNG payload — the "wrong image" a drifted source would supply. */
const OTHER_BYTES = new Uint8Array([
	...PNG_BYTES.subarray(0, PNG_BYTES.length - 4),
	0x00,
	0x00,
	0x01,
	0x02,
]);

function hexOf(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

const ENTRY: MediaRestoreManifestEntry = {
	key: 'portfolio/restore-fixture/cover.png',
	sha256: hexOf(PNG_BYTES),
	sizeBytes: PNG_BYTES.byteLength,
	contentType: 'image/png',
};

interface StubOptions {
	/** Object that exists in the bucket at the start of the run. */
	existing?: { bytes: Uint8Array; contentType: string | null } | null;
	fault?: 'read' | 'write' | 'truncate';
}

/**
 * In-memory stand-in for `MEDIA`. `writeLog` records every write so a
 * test can assert the one property that matters most for a restore:
 * a refused run must not touch the bucket at all.
 */
function stubStore(options: StubOptions = {}) {
	const state = new Map<string, { bytes: Uint8Array; contentType: string | null }>();
	if (options.existing) state.set(ENTRY.key, options.existing);
	const writeLog: string[] = [];
	const store: MediaRestoreStore = {
		read: async (key) => {
			if (options.fault === 'read') throw new Error('bucket read failed');
			const found = state.get(key);
			if (!found) return null;
			return toState(found);
		},
		write: async (entry, bytes) => {
			if (options.fault === 'write') throw new Error('bucket write failed');
			writeLog.push(entry.key);
			const stored = options.fault === 'truncate' ? bytes.subarray(0, 3) : bytes;
			state.set(entry.key, { bytes: stored, contentType: entry.contentType });
		},
	};
	function toState(found: {
		bytes: Uint8Array;
		contentType: string | null;
	}): MediaRestoreObjectState {
		return {
			bytes: found.bytes,
			sizeBytes: found.bytes.byteLength,
			sha256: hexOf(found.bytes),
			contentType: found.contentType,
		};
	}
	return { store, state, writeLog };
}

function stubSource(bytes: Uint8Array | null, fault = false): MediaRetainedSource {
	return {
		read: async () => {
			if (fault) throw new Error('source read failed');
			return bytes === null ? null : { bytes, contentType: 'image/png' };
		},
	};
}

describe('restoreMediaObject — the deleted-then-restored path', () => {
	it('restores a deleted object from its retained source and verifies the read-back', async () => {
		const { store, state, writeLog } = stubStore({ existing: null });
		const result = await restoreMediaObject(store, stubSource(PNG_BYTES), ENTRY);

		expect(result.verdict).toBe(RESTORE_VERDICT.restored);
		expect(result.reason).toBe('-');
		expect(result.checks).toEqual([
			'key_gate',
			'store_read',
			'source_read',
			'source_matches_manifest',
			'write',
			'readback',
		]);
		expect(writeLog).toEqual([ENTRY.key]);
		expect(hexOf(state.get(ENTRY.key)?.bytes)).toBe(ENTRY.sha256);
		expect(state.get(ENTRY.key)?.contentType).toBe('image/png');
		expect(restoreExitCodeFor(result)).toBe(0);
	});

	it('is idempotent: an object that already matches the manifest is not rewritten', async () => {
		const { store, writeLog } = stubStore({
			existing: { bytes: PNG_BYTES, contentType: 'image/png' },
		});
		const result = await restoreMediaObject(store, stubSource(PNG_BYTES), ENTRY);

		expect(result.verdict).toBe(RESTORE_VERDICT.alreadyIntact);
		expect(writeLog).toEqual([]);
		expect(isRestoreSuccessful(result)).toBe(true);
	});

	it('overwrites an object whose bytes drifted, and repairs the content type', async () => {
		const { store, state } = stubStore({
			existing: { bytes: OTHER_BYTES, contentType: 'application/octet-stream' },
		});
		const result = await restoreMediaObject(store, stubSource(PNG_BYTES), ENTRY);

		expect(result.verdict).toBe(RESTORE_VERDICT.restored);
		expect(state.get(ENTRY.key)?.contentType).toBe('image/png');
		expect(hexOf(state.get(ENTRY.key)?.bytes)).toBe(ENTRY.sha256);
	});
});

describe('restoreMediaObject — refusals leave the bucket untouched', () => {
	it('refuses a private-namespace key before reading or writing anything', async () => {
		const { store, writeLog } = stubStore();
		const privateEntry: MediaRestoreManifestEntry = { ...ENTRY, key: 'private/draft/cover.png' };

		const result = await restoreMediaObject(store, stubSource(PNG_BYTES), privateEntry);

		expect(result.verdict).toBe(RESTORE_VERDICT.refusedKey);
		expect(result.reason).toBe('key_not_publicly_servable');
		expect(result.checks).toEqual([]);
		expect(writeLog).toEqual([]);
		expect(restoreExitCodeFor(result)).toBe(1);
	});

	it('refuses an undeclared namespace key the same way', async () => {
		const { store, writeLog } = stubStore();
		const result = await restoreMediaObject(store, stubSource(PNG_BYTES), {
			...ENTRY,
			key: 'wip/unlisted.png',
		});

		expect(result.verdict).toBe(RESTORE_VERDICT.refusedKey);
		expect(writeLog).toEqual([]);
	});

	it('reports a deletion with no retained source instead of uploading a guess', async () => {
		const { store, state, writeLog } = stubStore({ existing: null });

		const result = await restoreMediaObject(store, stubSource(null), ENTRY);

		expect(result.verdict).toBe(RESTORE_VERDICT.missingSource);
		expect(result.reason).toBe('source_unavailable');
		expect(result.checks).toEqual(['key_gate', 'store_read', 'source_read']);
		expect(writeLog).toEqual([]);
		// The bucket is still empty: a missing image is visible, a
		// silently substituted one is not.
		expect(state.size).toBe(0);
		expect(restoreExitCodeFor(result)).toBe(1);
	});
});

describe('restoreMediaObject — metadata consistency', () => {
	it('refuses to upload bytes that are not the ones the manifest records', async () => {
		const { store, writeLog } = stubStore({ existing: null });

		const result = await restoreMediaObject(store, stubSource(OTHER_BYTES), ENTRY);

		expect(result.verdict).toBe(RESTORE_VERDICT.metadataDrift);
		expect(result.reason).toBe('source_digest_mismatch');
		expect(writeLog).toEqual([]);
	});

	it('refuses a retained source whose content type disagrees with the manifest', async () => {
		const { store, writeLog } = stubStore({ existing: null });
		const source: MediaRetainedSource = {
			read: async () => ({ bytes: PNG_BYTES, contentType: 'application/octet-stream' }),
		};

		const result = await restoreMediaObject(store, source, ENTRY);

		expect(result.verdict).toBe(RESTORE_VERDICT.metadataDrift);
		expect(result.reason).toBe('source_content_type_mismatch');
		expect(writeLog).toEqual([]);
	});

	it('does not call a truncated write a restore', async () => {
		const { store } = stubStore({ existing: null, fault: 'truncate' });

		const result = await restoreMediaObject(store, stubSource(PNG_BYTES), ENTRY);

		expect(result.verdict).toBe(RESTORE_VERDICT.metadataDrift);
		expect(result.reason).toBe('readback_digest_mismatch');
		expect(result.checks).toContain('readback');
		expect(isRestoreSuccessful(result)).toBe(false);
	});

	it('reports an object that did not land after the write', async () => {
		// A store that accepts the write and stores nothing — the shape
		// a silently failed upload takes. The read-back is the only
		// step that can catch it.
		const swallowWrites: MediaRestoreStore = {
			read: async () => null,
			write: async () => {},
		};

		const result = await restoreMediaObject(swallowWrites, stubSource(PNG_BYTES), ENTRY);

		expect(result.verdict).toBe(RESTORE_VERDICT.metadataDrift);
		expect(result.reason).toBe('object_absent_after_write');
		expect(result.checks).toContain('write');
		expect(isRestoreSuccessful(result)).toBe(false);
	});
});

describe('restoreMediaObject — fail-closed on unreadable state', () => {
	it('is undecidable when the bucket cannot be read', async () => {
		const { store } = stubStore({ existing: null, fault: 'read' });

		const result = await restoreMediaObject(store, stubSource(PNG_BYTES), ENTRY);

		expect(result.verdict).toBe(RESTORE_VERDICT.undecidable);
		expect(result.reason).toBe('store_read_failed');
		// Exit 2, not 1: "could not look" must not share a signal with
		// a proven failure.
		expect(restoreExitCodeFor(result)).toBe(2);
		expect(isRestoreSuccessful(result)).toBe(false);
	});

	it('is undecidable when the retained source cannot be read', async () => {
		const { store, writeLog } = stubStore({ existing: null });

		const result = await restoreMediaObject(store, stubSource(PNG_BYTES, true), ENTRY);

		expect(result.verdict).toBe(RESTORE_VERDICT.undecidable);
		expect(result.reason).toBe('source_read_failed');
		expect(writeLog).toEqual([]);
	});

	it('is undecidable when the bucket refuses the write', async () => {
		const { store } = stubStore({ existing: null, fault: 'write' });

		const result = await restoreMediaObject(store, stubSource(PNG_BYTES), ENTRY);

		expect(result.verdict).toBe(RESTORE_VERDICT.undecidable);
		expect(result.reason).toBe('store_write_failed');
		expect(restoreExitCodeFor(result)).toBe(2);
	});
});

describe('status-only output', () => {
	it('never carries the object key into the rendered report', async () => {
		const { store } = stubStore({ existing: null });
		const result = await restoreMediaObject(store, stubSource(PNG_BYTES), ENTRY);

		const report = formatRestoreReport(result, { target: 'local-fixture', label: 'happy-path' });

		expect(report).not.toContain(ENTRY.key);
		expect(report).not.toContain('portfolio/');
		expect(report).toContain('verdict=restored');
		expect(report).toContain('exit=0');
		expect(report).toContain(
			'checks=key_gate>store_read>source_read>source_matches_manifest>write>readback',
		);
	});

	it('result objects hold no key at all, so a formatter cannot leak one', async () => {
		const { store } = stubStore({ existing: null });
		const result = await restoreMediaObject(store, stubSource(PNG_BYTES), ENTRY);

		expect(Object.values(result).flat()).not.toContain(ENTRY.key);
		expect(JSON.stringify(result)).not.toContain('cover.png');
	});
});

describe('helpers', () => {
	it('hashes bytes the same way the manifest records them', async () => {
		expect(await sha256Hex(PNG_BYTES)).toBe(hexOf(PNG_BYTES));
		// A subarray view must hash as its own bytes, not as the parent
		// buffer — a slice that aliases the original is how a digest
		// silently describes the wrong object.
		const view = PNG_BYTES.subarray(1, 9);
		expect(await sha256Hex(view)).toBe(hexOf(view));
		expect(await sha256Hex(view)).not.toBe(hexOf(PNG_BYTES));
	});

	it('compares content types by media type, ignoring parameters', () => {
		expect(normalizeMediaContentType('image/webp; charset=binary')).toBe('image/webp');
		expect(normalizeMediaContentType('IMAGE/PNG')).toBe('image/png');
		expect(normalizeMediaContentType('')).toBeNull();
		expect(normalizeMediaContentType(null)).toBeNull();
	});

	it('repairs an object whose stored content type cannot be parsed', async () => {
		// An empty stored type is not a match: it cannot equal the
		// manifest's, so the object is re-written rather than accepted.
		const { store, state } = stubStore({ existing: { bytes: PNG_BYTES, contentType: '' } });

		const result = await restoreMediaObject(store, stubSource(PNG_BYTES), ENTRY);

		expect(result.verdict).toBe(RESTORE_VERDICT.restored);
		expect(state.get(ENTRY.key)?.contentType).toBe('image/png');
	});
});
