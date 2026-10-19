/**
 * Pure seam for the R2 key-set audit (Issue #577, owner option (a)).
 *
 * The obligation this file owns
 * ----------------------------
 * A public R2 custom domain (`docs/portfolio/decisions.md` Decision 5)
 * serves **every key that exists in the bucket**, without running any
 * Worker code. The namespace allowlist in
 * `src/cloudflare/media-visibility.ts` is therefore the only thing that
 * keeps an unapproved object out of the anonymous delivery surface —
 * and code alone cannot hold it, because the object may already be in
 * the bucket (uploaded by an operator, by an aborted migration, by a
 * hand-run `cf r2 objects put`).
 *
 * So the same rule is projected onto the thing the repository actually
 * CAN observe: the bucket's key set. This module holds that projection
 * as pure functions — classify a key set, enumerate a paginated
 * listing, render a status-only verdict — so the policy is testable
 * without a bucket, without a credential, and without a network call.
 * The I/O wrapper (`scripts/check-r2-media-key-set.mjs`) supplies the
 * listing and prints the verdict.
 *
 * What this module never does
 * ---------------------------
 * It never returns, formats, or logs an object key. The audit's whole
 * value to an operator is the verdict and the COUNTS; a key name in a
 * transcript is exactly what the owner decision (2026-10-19) forbids:
 * the tool must not become a second way to enumerate the bucket for
 * whoever can read a CI log. `assertNoKeyInText` is the mechanical
 * guard for that rule, applied to this repository's own output.
 *
 * Prefixes are **injected**, never re-declared. The caller passes
 * `isPublic` (in production `isPublicMediaKey` from
 * `src/cloudflare/media-visibility.ts`), so a copy of the allowlist in
 * a script could not drift away from the code gate: one list, one
 * meaning.
 *
 * Fail-closed
 * -----------
 * An audit that cannot decide is a failed audit. Every state other
 * than "the listing was complete and every key is inside the
 * allowlist" produces a non-zero exit — a missing credential, an API
 * error, an unparseable listing, an empty production key set, a
 * truncated walk, or a paginator that ignored its cursor. There is no
 * `--allow-unknown` escape hatch, because an escape hatch on a
 * security gate is a silent-off switch with a friendly name.
 */

/** Verdict vocabulary. `OK` is the only pass. */
export const VERDICT = Object.freeze({
	ok: 'OK',
	violation: 'VIOLATION',
	undecidable: 'UNDECIDABLE',
});

/**
 * Why the audit could not decide. A code, never a message: an
 * operator needs to know the class of failure, and a raw CLI/SDK
 * error string is the one input that could carry a credential or an
 * identifier this repository must not put in a transcript.
 */
export const UNDECIDABLE_REASON = Object.freeze({
	credentialMissing: 'credential_missing',
	listingFailed: 'listing_failed',
	listingUnparseable: 'listing_unparseable',
	listingEmpty: 'listing_empty',
	listingIncomplete: 'listing_incomplete',
	inputUnreadable: 'input_unreadable',
});

/**
 * R2's ListObjects caps a page at 1000 keys, so 1000 is both the
 * maximum worth asking for and the size at which "the page came back
 * full" is a trustworthy "there may be more".
 */
export const DEFAULT_PER_PAGE = 1000;

/**
 * Shortest key the leak guard inspects. A 1-3 character "key" cannot
 * be distinguished from ordinary prose, so asserting on it would only
 * produce false alarms that train the operator to ignore the guard.
 */
export const MIN_LEAK_GUARD_KEY_LENGTH = 4;

/** @typedef {'OK' | 'VIOLATION' | 'UNDECIDABLE'} Verdict */

/**
 * @typedef {object} KeySetAudit
 * @property {Verdict} verdict
 * @property {number | null} keysTotal          `null` when undecidable.
 * @property {number | null} keysInsideAllowlist
 * @property {number | null} keysOutsideAllowlist
 * @property {string} reason                    `-` when decidable.
 * @property {number} pagesWalked
 * @property {'complete' | 'unavailable'} enumeration
 */

/** A decidable pass: every key is inside the allowlist. */
function okAudit(keysTotal, keysInside, pagesWalked) {
	return {
		verdict: VERDICT.ok,
		keysTotal,
		keysInsideAllowlist: keysInside,
		keysOutsideAllowlist: keysTotal - keysInside,
		reason: '-',
		pagesWalked,
		enumeration: 'complete',
	};
}

/** A decidable failure: at least one key the allowlist does not cover. */
function violationAudit(keysTotal, keysInside, pagesWalked) {
	return {
		verdict: VERDICT.violation,
		keysTotal,
		keysInsideAllowlist: keysInside,
		keysOutsideAllowlist: keysTotal - keysInside,
		reason: '-',
		pagesWalked,
		enumeration: 'complete',
	};
}

/**
 * An undecidable outcome. Counts are `null`, never `0`: "we could not
 * look" and "we looked and found nothing" must not print the same
 * line, because only one of them is a pass.
 */
export function undecidableAudit(reason, pagesWalked = 0) {
	return {
		verdict: VERDICT.undecidable,
		keysTotal: null,
		keysInsideAllowlist: null,
		keysOutsideAllowlist: null,
		reason,
		pagesWalked,
		enumeration: 'unavailable',
	};
}

/**
 * Classify a complete key set against the shipped allowlist.
 *
 * `isPublic` is `isPublicMediaKey` in production. The audit asks the
 * same question the delivery paths ask — not a second, weaker copy of
 * it — so a key the Worker would refuse to compose a URL for is
 * exactly a key this gate refuses to accept in the bucket.
 *
 * A malformed key (empty, control characters, over the key grammar)
 * is NOT public, so it lands in the violation count rather than being
 * skipped: an unclassifiable key is an unowned key.
 *
 * @param {Iterable<string>} keys
 * @param {(key: string) => boolean} isPublic
 * @param {{ pagesWalked?: number }} [meta]
 * @returns {KeySetAudit}
 */
export function auditKeySet(keys, isPublic, meta = {}) {
	const pagesWalked = meta.pagesWalked ?? 1;
	let total = 0;
	let inside = 0;
	for (const key of keys) {
		if (typeof key !== 'string')
			return undecidableAudit(UNDECIDABLE_REASON.listingUnparseable, pagesWalked);
		total += 1;
		if (isPublic(key)) inside += 1;
	}
	return inside === total
		? okAudit(total, inside, pagesWalked)
		: violationAudit(total, inside, pagesWalked);
}

/**
 * Read the keys out of one ListObjects response.
 *
 * Two shapes are accepted, because the audit must work against whichever
 * one the driver actually returns:
 *
 *   - the bare array `cf r2 objects list` prints (verified against the
 *     local simulation), and
 *   - the S3-style envelope `{ objects: [...], truncated, cursor }`
 *     that an API-backed listing may answer with.
 *
 * Anything else — a non-JSON string, a missing `objects` field, an
 * entry without a usable key — is a parse failure, not an empty page.
 * Dropping an unexpected entry would turn a broken listing into a
 * clean verdict, which is the one outcome this gate must never have.
 *
 * `truncated` is the completeness signal. A response that says so, and
 * a page that came back exactly full, both mean "there may be more" —
 * and "there may be more" is not a pass.
 *
 * @param {unknown} page
 * @param {number} [perPage]
 * @returns {{ keys: string[], truncated: boolean } | { reason: string }}
 */
export function readPageKeys(page, perPage = DEFAULT_PER_PAGE) {
	const parsed = typeof page === 'string' ? safeJsonParse(page) : page;
	const entries = Array.isArray(parsed)
		? parsed
		: parsed && typeof parsed === 'object' && Array.isArray(parsed.objects)
			? parsed.objects
			: null;
	if (entries === null) return { reason: UNDECIDABLE_REASON.listingUnparseable };

	const keys = [];
	for (const entry of entries) {
		if (typeof entry === 'string') {
			if (entry.length === 0) return { reason: UNDECIDABLE_REASON.listingUnparseable };
			keys.push(entry);
			continue;
		}
		if (
			entry &&
			typeof entry === 'object' &&
			typeof entry.key === 'string' &&
			entry.key.length > 0
		) {
			keys.push(entry.key);
			continue;
		}
		return { reason: UNDECIDABLE_REASON.listingUnparseable };
	}

	const declaredTruncated =
		!Array.isArray(parsed) && parsed && typeof parsed === 'object' && parsed.truncated === true;
	return { keys, truncated: declaredTruncated || keys.length >= perPage };
}

/**
 * Parse without throwing. A page that is not JSON is a parse failure
 * the caller turns into an undecidable verdict — never an exception
 * that a caller might catch and mistake for "no objects".
 *
 * @param {string} text
 * @returns {unknown}
 */
export function safeJsonParse(text) {
	if (typeof text !== 'string') return null;
	const trimmed = text.trim();
	if (trimmed.length === 0) return null;
	const start = trimmed.search(/[[{]/);
	if (start === -1) return null;
	try {
		return JSON.parse(trimmed.slice(start));
	} catch {
		return null;
	}
}

/**
 * Enumerate the bucket.
 *
 * One request, and the completeness rule is stated rather than
 * assumed: the walk ends at a response that is shorter than the page
 * size (and does not declare itself truncated). A FULL page is
 * `listing_incomplete` — undecidable, therefore failed.
 *
 * Continuing past a full page needs a pagination cursor, and this
 * repository has no way to obtain one: `cf r2 objects list` prints the
 * objects and nothing else, and its `--start-after` continuation flag
 * is **ignored by the local resource simulation** (verified against
 * the real CLI in this repository, which is the only place the flag can
 * be exercised without a production credential). Trusting an
 * unverifiable continuation would make a partial read look like a
 * whole bucket — the exact fail-open this gate exists to prevent — so
 * the audit refuses instead.
 *
 * The consequence is recorded rather than hidden: a bucket of 1000 or
 * more keys is out of scope for this gate until the driver can page
 * (or the bucket is split, which is owner option (b)).
 *
 * @param {{
 *   listPage: (args: { perPage: number }) => unknown,
 *   perPage?: number,
 * }} deps
 * @returns {Promise<{ keys: string[], pagesWalked: number } | { reason: string, pagesWalked: number }>}
 */
export async function collectBucketKeys({ listPage, perPage = DEFAULT_PER_PAGE }) {
	const read = readPageKeys(listPage({ perPage }), perPage);
	if ('reason' in read) return { reason: read.reason, pagesWalked: 1 };
	if (read.truncated) return { reason: UNDECIDABLE_REASON.listingIncomplete, pagesWalked: 1 };
	return { keys: read.keys, pagesWalked: 1 };
}

/**
 * Exit code for a verdict. `OK` is 0; **both** other verdicts are
 * non-zero, because an audit that cannot decide must never be the
 * same signal to a release pipeline as an audit that passed.
 *
 * @param {KeySetAudit} audit
 * @returns {0 | 1 | 2}
 */
export function exitCodeFor(audit) {
	if (audit.verdict === VERDICT.ok) return 0;
	return audit.verdict === VERDICT.violation ? 1 : 2;
}

/**
 * Render the status-only report.
 *
 * Every line is a verdict, a count, or a path the reviewer already
 * knows. No key, no key fragment, no namespace name of an offending
 * object, no credential, and no raw CLI error text — the reason codes
 * above are the whole vocabulary for "why could not this be decided".
 *
 * @param {KeySetAudit} audit
 * @param {{
 *   source: string,
 *   target: string,
 *   bucket: string,
 *   prefixCount?: number,
 *   prefixSource?: string,
 * }} meta
 * @returns {string}
 */
export function formatAuditReport(audit, meta) {
	const count = (value) => (value === null ? 'unknown' : String(value));
	const diff =
		audit.verdict === VERDICT.ok
			? 'none'
			: audit.verdict === VERDICT.violation
				? 'present'
				: 'unknown';
	const lines = [
		`[r2-key-set] source=${meta.source} target=${meta.target} bucket=${meta.bucket}`,
		`[r2-key-set] verdict=${audit.verdict}`,
		`[r2-key-set] reason=${audit.reason}`,
		`[r2-key-set] keys_total=${count(audit.keysTotal)} keys_inside_allowlist=${count(audit.keysInsideAllowlist)} keys_outside_allowlist=${count(audit.keysOutsideAllowlist)}`,
		`[r2-key-set] allowlist_prefixes=${meta.prefixCount ?? 'unknown'} prefix_source=${meta.prefixSource ?? 'unknown'}`,
		`[r2-key-set] pages_walked=${audit.pagesWalked} enumeration=${audit.enumeration}`,
		`[r2-key-set] diff=${diff}`,
		'[r2-key-set] printed=verdict,counts,reason-codes only (no object key, no key fragment, no credential)',
	];
	return `${lines.join('\n')}\n`;
}

/**
 * Mechanical enforcement of the status-only contract: the rendered
 * report must not contain any audited key. Run against the real keys
 * before writing them anywhere, so a future edit to the formatter
 * cannot start leaking the thing this repository exists not to leak.
 *
 * @param {string} text
 * @param {Iterable<string>} keys
 * @returns {void}
 */
export function assertNoKeyInText(text, keys) {
	for (const key of keys) {
		if (typeof key !== 'string' || key.length < MIN_LEAK_GUARD_KEY_LENGTH) continue;
		if (text.includes(key)) {
			throw new Error(
				'refusing to emit an audit report that contains an object key; the status-only contract is not negotiable (Issue #577).',
			);
		}
	}
}
