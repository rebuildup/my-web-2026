/**
 * R2 media restore (Issue #462).
 *
 * The obligation this module owns
 * -------------------------------
 * `MEDIA` holds the public images the site serves. Nothing in this
 * repository re-creates them: `portfolio_media` rows point at an R2
 * key, the bucket holds the bytes, and the **retained source** (the
 * export, the original upload, the operator's own copy) is the only
 * thing that can put a deleted object back. So the question a restore
 * procedure must answer is not "can I write to R2" — it can — but
 * "can I prove the object I put back is the object that was there".
 *
 * This module is that proof, as pure logic over three injected
 * seams. It owns two rules:
 *
 *   1. **A restore never runs before the visibility gate.** The key
 *      is classified with `classifyMediaKey` — the same rule
 *      `composeMediaUrl`, `getImageStream` and
 *      `createPublicMediaDelivery` consult — and a refused key ends
 *      the run *before any write*. A restore is the one operation
 *      that can republish material on purpose, so it re-reads the
 *      gate instead of trusting the caller's list.
 *   2. **A restore is only "restored" after it is read back.** The
 *      retained source is compared against the manifest (sha256,
 *      byte length, content type) *before* the write, and the object
 *      is re-read and compared again *after* it. A truncated upload,
 *      a silent metadata drop, or a write that lands under the wrong
 *      content type is reported as a failure, never as a success.
 *
 * Fail-closed by construction
 * ---------------------------
 * Every outcome other than `restored` / `already_intact` is a
 * non-zero exit at the operator boundary, and each carries a reason
 * CODE. Three states are deliberately not "restored":
 *
 *   - `refused_key` — the key is malformed, private, or in an
 *     undeclared namespace. The write never happens, so a restore
 *     cannot move material into (or out of) a public namespace by
 *     accident.
 *   - `missing_source` — nothing was retained. There is no safe
 *     guess: re-uploading *some* image under a key that a published
 *     D1 row already points at would substitute content silently,
 *     which is worse than a missing image.
 *   - `metadata_drift` / `undecidable` — the bytes or the metadata
 *     do not match the manifest, or the store could not be read or
 *     written. "I could not check" is not "it is fine".
 *
 * Status-only by construction
 * ---------------------------
 * The result carries a verdict, a reason code, and the list of
 * checks that ran. It carries **no object key, no key fragment and
 * no namespace**: the caller supplied the key and already knows it,
 * and the bucket key set is the enumeration surface the key-set
 * audit (`scripts/check-r2-media-key-set.mjs`, Issue #577) refuses
 * to print. Nothing here can leak one because nothing here holds
 * one — the store and the source receive the key, not the result.
 *
 * What this is not
 * ----------------
 * **No production caller today.** No request path restores media,
 * and no release gate runs this yet: a real restore needs an R2 write
 * credential, which no CI workflow in this repository holds
 * (`docs/runbook/cloudflare-workers-builds.md`). The operator
 * procedure, the deletion handling, and the metadata contract are
 * documented in `docs/runbook/r2-media-restore.md`, exercised
 * against the local R2 fixture, and recorded as a residual in
 * `docs/security/r2-media-visibility.md`.
 *
 * Also note what the manifest is: the `portfolio_media` row carries
 * `r2_key` and `content_type` but **no digest and no byte length**
 * (`migrations/0007_portfolio.sql`). So the manifest that proves a
 * restore is an operator-side artefact captured *before* the
 * deletion, not something the database can be asked for today.
 * Adding the columns is a separate schema decision and is not taken
 * here.
 *
 * This module is pure: no `cloudflare:workers` import, no binding
 * access. `R2Bucket` satisfies `MediaRestoreStore` once an adapter
 * hashes the body; the local fixture in
 * `test/integration/r2-media-restore.test.ts` is that adapter.
 */

import { classifyMediaKey } from './media-visibility';

/** Verdict vocabulary. Only two of the six are a pass. */
export const RESTORE_VERDICT = Object.freeze({
	restored: 'restored',
	alreadyIntact: 'already_intact',
	refusedKey: 'refused_key',
	missingSource: 'missing_source',
	metadataDrift: 'metadata_drift',
	undecidable: 'undecidable',
} as const);

export type MediaRestoreVerdict = (typeof RESTORE_VERDICT)[keyof typeof RESTORE_VERDICT];

/**
 * Why the run ended where it did. A code, never a message: the
 * report is meant to be pasted into a PR, and a raw error string is
 * the one input that could carry a path or an identifier.
 */
export type MediaRestoreReason =
	| '-'
	| 'key_not_publicly_servable'
	| 'store_read_failed'
	| 'source_unavailable'
	| 'source_read_failed'
	| 'source_digest_mismatch'
	| 'source_size_mismatch'
	| 'source_content_type_mismatch'
	| 'store_write_failed'
	| 'object_absent_after_write'
	| 'readback_digest_mismatch'
	| 'readback_size_mismatch'
	| 'readback_content_type_mismatch';

/**
 * The checks a run can complete, in order. The result lists the ones
 * that ran, which is how a reader tells "refused before touching the
 * bucket" apart from "wrote and then could not verify".
 */
export type MediaRestoreCheck =
	| 'key_gate'
	| 'store_read'
	| 'source_read'
	| 'source_matches_manifest'
	| 'write'
	| 'readback';

/**
 * The record a restore is verified against, captured **before** the
 * deletion. It is the operator's artefact, not a database row: see
 * the module header on why `portfolio_media` cannot supply the
 * digest today.
 */
export interface MediaRestoreManifestEntry {
	/** Object key in the `MEDIA` bucket. Never normalised. */
	key: string;
	/** Lowercase hex sha256 of the retained source bytes. */
	sha256: string;
	/** Byte length of the retained source bytes. */
	sizeBytes: number;
	/** Media type the object must carry (`image/webp`, …). */
	contentType: string;
}

/** One object as it exists in the bucket, already hashed. */
export interface MediaRestoreObjectState {
	bytes: Uint8Array;
	sizeBytes: number;
	sha256: string;
	contentType: string | null;
}

/** The bucket side of a restore. `R2Bucket` satisfies this through an adapter. */
export interface MediaRestoreStore {
	/** Current state of `key`, or `null` when the object is absent. */
	read(key: string): Promise<MediaRestoreObjectState | null>;
	/**
	 * Write `bytes` at `entry.key` with `entry.contentType` as the
	 * object's stored content type. An adapter MUST NOT silently
	 * substitute a different content type: the read-back check
	 * compares the stored value against the manifest.
	 */
	write(entry: MediaRestoreManifestEntry, bytes: Uint8Array): Promise<void>;
}

/** The retained source side: where the bytes came from before deletion. */
export interface MediaRetainedSource {
	/**
	 * The retained bytes for this entry, or `null` when nothing was
	 * retained. A throw is an I/O failure, not an absence — the two
	 * get different reason codes.
	 */
	read(
		entry: MediaRestoreManifestEntry,
	): Promise<{ bytes: Uint8Array; contentType: string | null } | null>;
}

export interface MediaRestoreResult {
	verdict: MediaRestoreVerdict;
	reason: MediaRestoreReason;
	/** Checks that ran, in order. Empty only for a usage error. */
	checks: readonly MediaRestoreCheck[];
}

/** Lowercase hex sha256. Web Crypto in workerd and in Node, one path. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const view = new Uint8Array(bytes);
	const buffer =
		view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
			? view.buffer
			: view.slice().buffer;
	const digest = await crypto.subtle.digest('SHA-256', buffer);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Compare a content type the way a store reports it. R2 returns
 * whatever was written, and an implementation may append parameters
 * (`image/webp; charset=binary`), so the comparison is on the media
 * type alone. Anything unparseable becomes `null`, which can never
 * equal a manifest value — an unknown stored type is drift, not a
 * match.
 */
export function normalizeMediaContentType(value: string | null): string | null {
	if (typeof value !== 'string') return null;
	const mediaType = value.split(';')[0]?.trim().toLowerCase() ?? '';
	return mediaType.length === 0 ? null : mediaType;
}

/**
 * Compare one object state against the manifest. `-` means "identical
 * on all three properties"; anything else names the first property
 * that differs, in digest → size → content-type order so the reason
 * is stable across runs.
 */
function mismatchReason(
	entry: MediaRestoreManifestEntry,
	actual: { sha256: string; sizeBytes: number; contentType: string | null },
	prefix: 'source' | 'readback',
): MediaRestoreReason {
	if (actual.sha256.toLowerCase() !== entry.sha256.toLowerCase()) {
		return `${prefix}_digest_mismatch` as MediaRestoreReason;
	}
	if (actual.sizeBytes !== entry.sizeBytes) return `${prefix}_size_mismatch` as MediaRestoreReason;
	if (
		normalizeMediaContentType(actual.contentType) !== normalizeMediaContentType(entry.contentType)
	) {
		return `${prefix}_content_type_mismatch` as MediaRestoreReason;
	}
	return '-';
}

function failed(
	verdict: MediaRestoreVerdict,
	reason: MediaRestoreReason,
	checks: MediaRestoreCheck[],
) {
	return { verdict, reason, checks };
}

/** `true` only for the two outcomes that mean the object is present and correct. */
export function isRestoreSuccessful(result: MediaRestoreResult): boolean {
	return (
		result.verdict === RESTORE_VERDICT.restored || result.verdict === RESTORE_VERDICT.alreadyIntact
	);
}

/**
 * Exit code for one outcome. A pass is 0; a refusal or a proven
 * mismatch is 1; "could not decide" is 2, so a caller that only
 * checks for zero cannot mistake an unreadable store for a restored
 * object.
 */
export function restoreExitCodeFor(result: MediaRestoreResult): 0 | 1 | 2 {
	if (isRestoreSuccessful(result)) return 0;
	return result.verdict === RESTORE_VERDICT.undecidable ? 2 : 1;
}

/**
 * Restore one object from its retained source, or explain why it was
 * not restored.
 *
 * Order of checks (each one short-circuits):
 *
 *   1. visibility gate on the key        → `refused_key`   (no write)
 *   2. read the current bucket state     → `undecidable` on a read failure
 *   3. state already matches the manifest → `already_intact` (no write)
 *   4. read the retained source          → `missing_source` / `undecidable`
 *   5. source matches the manifest       → `metadata_drift` (no write)
 *   6. write the bytes at the manifest content type
 *   7. read back and compare             → `metadata_drift` / `undecidable`
 *
 * Steps 5 and 7 are the same comparison on purpose: one refuses to
 * upload bytes that are not the ones that were lost, the other
 * refuses to call the object restored when what landed in the bucket
 * is not the manifest.
 */
export async function restoreMediaObject(
	store: MediaRestoreStore,
	source: MediaRetainedSource,
	entry: MediaRestoreManifestEntry,
): Promise<MediaRestoreResult> {
	const checks: MediaRestoreCheck[] = [];

	// 1. The gate runs first, before any read of a payload and long
	// before any write: a restore must not be able to move material
	// across the visibility boundary.
	if (!classifyMediaKey(entry.key).publiclyServable) {
		return failed(RESTORE_VERDICT.refusedKey, 'key_not_publicly_servable', checks);
	}
	checks.push('key_gate');

	// 2. Where the object stands now. `null` is the deletion case.
	let current: MediaRestoreObjectState | null;
	try {
		current = await store.read(entry.key);
	} catch {
		return failed(RESTORE_VERDICT.undecidable, 'store_read_failed', checks);
	}
	checks.push('store_read');

	// 3. Idempotency: an object that already matches the manifest is
	// left alone, so re-running a restore never rewrites good media.
	if (current && mismatchReason(entry, current, 'readback') === '-') {
		return { verdict: RESTORE_VERDICT.alreadyIntact, reason: '-', checks };
	}

	// 4. The retained bytes. Absent is not the same as unreadable:
	// "there is nothing to restore from" is a decision the operator
	// must make, and it is never a success.
	let retained: { bytes: Uint8Array; contentType: string | null } | null;
	try {
		retained = await source.read(entry);
	} catch {
		return failed(RESTORE_VERDICT.undecidable, 'source_read_failed', checks);
	}
	checks.push('source_read');
	if (retained === null) {
		return failed(RESTORE_VERDICT.missingSource, 'source_unavailable', checks);
	}

	// 5. Verify what we are about to upload against the manifest.
	const sourceState = {
		bytes: retained.bytes,
		sizeBytes: retained.bytes.byteLength,
		sha256: await sha256Hex(retained.bytes),
		contentType: retained.contentType,
	};
	const sourceMismatch = mismatchReason(entry, sourceState, 'source');
	if (sourceMismatch !== '-') {
		return failed(RESTORE_VERDICT.metadataDrift, sourceMismatch, checks);
	}
	checks.push('source_matches_manifest');

	// 6. Write at the manifest content type. The adapter stores
	// exactly this value; the read-back check below is what proves it.
	try {
		await store.write(entry, retained.bytes);
	} catch {
		return failed(RESTORE_VERDICT.undecidable, 'store_write_failed', checks);
	}
	checks.push('write');

	// 7. Read back. An object that did not land, or landed with other
	// bytes / other metadata, is a failed restore — reported as such
	// rather than assumed correct because the write returned.
	let readback: MediaRestoreObjectState | null;
	try {
		readback = await store.read(entry.key);
	} catch {
		return failed(RESTORE_VERDICT.undecidable, 'store_read_failed', checks);
	}
	checks.push('readback');
	if (readback === null) {
		return failed(RESTORE_VERDICT.metadataDrift, 'object_absent_after_write', checks);
	}
	const readbackMismatch = mismatchReason(entry, readback, 'readback');
	if (readbackMismatch !== '-') {
		return failed(RESTORE_VERDICT.metadataDrift, readbackMismatch, checks);
	}

	return { verdict: RESTORE_VERDICT.restored, reason: '-', checks };
}

/**
 * Render the status-only report for one run.
 *
 * Every line is a verdict, a reason code, or the checks that ran. No
 * object key, no key fragment, no namespace, no source path, no
 * credential — the same contract as the key-set audit
 * (`scripts/_r2-media-key-set.mjs`), and the reason for it is the
 * same: this text is designed to be pasted into a PR.
 */
export function formatRestoreReport(
	result: MediaRestoreResult,
	meta: { target: string; label?: string },
): string {
	const lines = [
		`[r2-restore] target=${meta.target}${meta.label ? ` case=${meta.label}` : ''}`,
		`[r2-restore] verdict=${result.verdict}`,
		`[r2-restore] reason=${result.reason}`,
		`[r2-restore] exit=${restoreExitCodeFor(result)}`,
		`[r2-restore] checks=${result.checks.length > 0 ? result.checks.join('>') : 'none'}`,
		'[r2-restore] printed=verdict,reason-codes only (no object key, no source path, no credential)',
	];
	return `${lines.join('\n')}\n`;
}
