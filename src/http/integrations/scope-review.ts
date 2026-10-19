/**
 * Least-privilege review for an inbound third-party OAuth / API-token
 * grant (Issue #464).
 *
 * Why this exists
 * ---------------
 * `docs/domain/integrations.md` records three connection candidates
 * (GitHub, Notion, Discord) and **none of them is promoted**: no
 * application capability owns a continuous contract with any of them,
 * so no token may be requested, stored or accepted yet. `src/server.ts`
 * dispatches `/integrations/*` to this boundary and nothing is mounted
 * there.
 *
 * The one thing every future connection has to answer *before* it is
 * published is the same three questions an inbound webhook had to answer
 * before `src/http/webhooks/` shipped (Issue #463), asked of the grant
 * instead of the request:
 *
 *   1. Did the account consent to **only** the scopes this platform
 *      needs? (least privilege)
 *   2. Does the stored token still satisfy the retention ceiling the
 *      owner approved for it?
 *   3. If not — can the caller say **why** in a code that is safe to
 *      log, to render, and to re-authorize from?
 *
 * A consent screen that asks for too much, a token that lives forever,
 * and an opaque "connection failed" are the three failures this module
 * exists to make impossible to ship silently.
 *
 * Deliberate scope: **no production route is mounted.** The adapter is
 * exercised by `scope-review.test.ts` / `fixtures.test.ts` (local
 * fixtures, frozen clock) and by `scripts/check-integration-scope.mjs`,
 * which resolves the reviewed requirements from
 * `quality/integration-scope.json`. `boundary.test.ts` asserts that
 * `/integrations/*` still answers `404`, so publishing an entry point
 * before the owner allowlist exists is a test failure rather than a
 * review opinion.
 *
 * Pure by construction
 * --------------------
 * No binding, no `Env`, no network, no clock read, no storage. `now` is
 * a parameter, so every verdict below is reproducible on any machine at
 * any time, and the same function runs in the workerd pool, in Node
 * (`--experimental-strip-types` is not even required on the supported
 * Node), and in the report generator that produces the PR screenshot.
 *
 * Fail-closed
 * -----------
 * There is no `--allow-unknown` escape hatch, because an escape hatch on
 * a scope gate is a silent-off switch with a friendly name:
 *
 *   - a grant naming an integration with no reviewed requirement is
 *     `unknown_integration`, never "probably fine";
 *   - a requirement that declares no retention ceiling cannot be
 *     satisfied by an unbounded token — the review reports the missing
 *     ceiling as `insufficient_scope`;
 *   - a grant with no issue date is `reauth_required`
 *     (`issued_at_missing`);
 *   - a connection record whose issue, revocation or expiry field is
 *     **present but unreadable** is `reauth_required`
 *     (`connection_metadata_unreadable`): an absent field and a
 *     corrupted field are different answers, and only the safe reading
 *     of a corrupted record is "reconnect". A `revoked_at` that no
 *     longer parses is NOT a live grant — it is a grant whose
 *     revocation evidence this platform can no longer read.
 */

/**
 * The decision, in a closed vocabulary.
 *
 * `approved` is the only verdict that permits a stored token to be
 * used. The other four are refusals, and each maps to a different
 * operator action — which is why they are four states and not a boolean.
 *
 *   - `unknown_integration` — nobody has reviewed this service's scopes
 *     on this platform. Owner action: review it, or revoke the grant.
 *   - `unapproved_scope` — the grant carries authority this platform
 *     never asked for and does not want. Owner action: fix the consent
 *     request and re-authorize; revoke the current token now.
 *   - `insufficient_scope` — the grant cannot do the job it was
 *     reviewed for (a required scope is missing, or the retention
 *     ceiling was never declared). Owner action: fix the request.
 *   - `reauth_required` — the grant is dead or too old to trust
 *     (revoked, expired, aged past the ceiling, or unreadable).
 *     Owner action: re-authorize.
 */
export type ScopeVerdict =
	| 'approved'
	| 'unapproved_scope'
	| 'insufficient_scope'
	| 'reauth_required'
	| 'unknown_integration';

/**
 * Why a grant has to be re-authorized rather than merely refused.
 *
 * Codes, never messages: these travel into a log record, an HTTP body
 * and a UI affordance, and an upstream error string is the one input
 * that could carry an identifier or a token fragment.
 */
export type ReauthReason =
	| 'grant_revoked'
	| 'token_expired'
	| 'token_age_exceeds_retention'
	| 'issued_at_missing'
	| 'connection_metadata_unreadable'
	| 'provider_requires_reauth';

/**
 * The reviewed least-privilege requirement for one candidate
 * connection: what this platform needs, what it may optionally accept,
 * what it must never hold, and how long a token may live.
 *
 * `maxAgeDays` is **required**, not optional. A provider whose tokens do
 * not expire (GitHub OAuth app tokens and Notion OAuth tokens are both
 * long-lived until revoked) is precisely the case where a ceiling has
 * to be stated by us rather than inherited from the provider, so the
 * type has no way to say "no ceiling".
 */
export interface ScopeRequirement {
	/** Candidate id, matching `quality/integration-scope.json`. */
	readonly id: string;
	/** Scopes the connection cannot work without. */
	readonly required: readonly string[];
	/** Scopes that are acceptable but not load-bearing. */
	readonly optional?: readonly string[];
	/** Authority this platform must never request or accept. */
	readonly denied?: readonly string[];
	/** Hard retention ceiling, in days, counted from `issuedAt`. */
	readonly maxAgeDays: number;
}

/**
 * What a provider actually handed back (or what the stored connection
 * record says it holds). This is untrusted input: it is whatever the
 * token endpoint, the connection table or the operator typed.
 *
 * Only scope *names* and timestamps belong here. A token value has no
 * field in this interface on purpose — this module never receives one,
 * so it cannot leak one.
 */
export interface ConnectionGrant {
	/** Candidate id the grant claims to be for. */
	readonly integration: string;
	/** Scope names the grant carries. */
	readonly scopes: readonly string[];
	/** ISO-8601 issue timestamp. `null`/absent means "not recorded". */
	readonly issuedAt?: string | null;
	/**
	 * ISO-8601 provider expiry, when the provider has one. Absent means
	 * "the provider declares no expiry"; a value that does not parse is a
	 * refusal, not an absent field.
	 */
	readonly expiresAt?: string | null;
	/**
	 * ISO-8601 revocation timestamp, once revoked. A stored value that
	 * does not parse is `connection_metadata_unreadable`, never
	 * "not revoked".
	 */
	readonly revokedAt?: string | null;
	/** Provider told us the grant needs interactive re-authorization. */
	readonly providerRequiresReauth?: boolean;
}

/**
 * The review result. Every list is sorted and de-duplicated so the same
 * grant always renders the same report row.
 */
export interface ScopeReview {
	readonly verdict: ScopeVerdict;
	/**
	 * Machine-readable refusal code, stable for callers and for the
	 * verification report. `approved` is the only code that is not a
	 * refusal.
	 */
	readonly code: string;
	/** Candidate id as claimed by the grant. */
	readonly integration: string;
	/** Scopes the grant carries that this platform may actually use. */
	readonly usable: readonly string[];
	/** Granted scopes that are neither required nor optional. */
	readonly unapproved: readonly string[];
	/** Denied scopes present in the grant (a subset of `unapproved`). */
	readonly denied: readonly string[];
	/** Required scopes the grant does not carry. */
	readonly missing: readonly string[];
	/** Every re-authorization reason found, not only the decisive one. */
	readonly reauth: readonly ReauthReason[];
	/** Whole days between `issuedAt` and `now`, or `null` when unknown. */
	readonly ageDays: number | null;
	/** The retention ceiling that was applied. */
	readonly retentionDays: number;
}

/**
 * The fixed order re-auth reasons are reported in, most decisive first.
 * It is a constant rather than a literal inside {@link reauthCode} so
 * the report and the tests can read the same sequence.
 */
export const REAUTH_CODE_ORDER: readonly ReauthReason[] = [
	'grant_revoked',
	'token_expired',
	'token_age_exceeds_retention',
	'issued_at_missing',
	'connection_metadata_unreadable',
	'provider_requires_reauth',
];

const MS_PER_DAY = 86_400_000;

/**
 * Compare scope names **exactly** (after trimming surrounding
 * whitespace).
 *
 * RFC 6749 treats scope values as case-sensitive, and all three reviewed
 * providers define lowercase scope names, so folding case here would buy
 * nothing and would quietly accept a typo (`Read:user`) as a consent
 * match. An unexpected spelling is a consent mismatch, which is what
 * `unapproved_scope` is for.
 */
function normalizeScope(scope: string): string {
	return scope.trim();
}

function sortedUnique(values: readonly string[]): string[] {
	return [...new Set(values.map(normalizeScope).filter((scope) => scope.length > 0))].sort();
}

/** Whole days elapsed, rounded up so a partial day still counts. */
function ageInDays(issuedAtMs: number, nowMs: number): number {
	return Math.ceil((nowMs - issuedAtMs) / MS_PER_DAY);
}

/**
 * One timestamp field, read as three-valued evidence.
 *
 * `present` is the whole point. `ms: null` alone cannot tell "the
 * column is empty" from "the column holds something that is not an
 * instant", and collapsing the two is how a corrupted `revoked_at`
 * silently re-enables a revoked token: the adapter sees "no
 * revocation" and answers `approved`. Every liveness field is read
 * through this type so an unreadable value becomes
 * `connection_metadata_unreadable` instead of silence.
 */
interface InstantEvidence {
	/** The field carried a non-empty value, whatever that value is. */
	readonly present: boolean;
	/** The parsed epoch milliseconds, or `null` when unreadable. */
	readonly ms: number | null;
}

/** Read one timestamp field as presence plus a parsed instant. */
function readInstant(value: string | null | undefined): InstantEvidence {
	if (typeof value !== 'string' || value.trim().length === 0) {
		return { present: false, ms: null };
	}
	const parsed = Date.parse(value);
	return { present: true, ms: Number.isNaN(parsed) ? null : parsed };
}

/**
 * Refusal codes. Stable vocabulary, one per actionable failure, so a
 * log record, an HTTP body and the verification report can all name the
 * same thing.
 */
export const SCOPE_REFUSAL_CODE = Object.freeze({
	approved: 'approved',
	unknownIntegration: 'unknown_integration',
	deniedScope: 'denied_scope_granted',
	scopeOutsideReview: 'scope_outside_review',
	requiredScopeMissing: 'required_scope_missing',
	retentionUndeclared: 'retention_undeclared',
	grantRevoked: 'grant_revoked',
	tokenExpired: 'token_expired',
	tokenAge: 'token_age_exceeds_retention',
	issuedAtMissing: 'issued_at_missing',
	metadataUnreadable: 'connection_metadata_unreadable',
	providerRequiresReauth: 'provider_requires_reauth',
});

/**
 * Review one granted connection against one reviewed requirement.
 *
 * Precedence, and why it is this order:
 *
 *   1. `unknown_integration` — with no reviewed requirement there is
 *      nothing to compare against, so every later question is moot.
 *   2. `unapproved_scope` — least privilege is a property of the
 *      *request*, not of the token's validity. A revoked token that was
 *      over-scoped is still an over-scoped consent, and the fix (fix the
 *      consent request) differs from "re-authorize and try again".
 *   3. `insufficient_scope` — the grant cannot do the reviewed job.
 *   4. `reauth_required` — the grant is otherwise fine but dead or old.
 *
 * The `reauth` list is populated regardless of which verdict won, so a
 * caller can surface "this also needs re-authorization" without a
 * second evaluation and without losing the reason behind precedence.
 */
export function reviewConnection(
	requirement: ScopeRequirement | null,
	grant: ConnectionGrant,
	now: Date,
): ScopeReview {
	const integration = typeof grant.integration === 'string' ? grant.integration.trim() : '';
	const granted = sortedUnique(Array.isArray(grant.scopes) ? grant.scopes : []);
	const nowMs = now.getTime();

	if (!requirement) {
		return {
			verdict: 'unknown_integration',
			code: SCOPE_REFUSAL_CODE.unknownIntegration,
			integration,
			usable: [],
			unapproved: granted,
			denied: [],
			missing: [],
			reauth: [],
			ageDays: null,
			retentionDays: 0,
		};
	}

	const required = sortedUnique(requirement.required);
	const optional = sortedUnique(requirement.optional ?? []);
	const denied = new Set(sortedUnique(requirement.denied ?? []));
	const retentionDays = requirement.maxAgeDays;

	const grantedDenied = granted.filter((scope) => denied.has(scope));
	const allowed = new Set([...required, ...optional]);
	const outsideReview = granted.filter((scope) => !allowed.has(scope));
	const unapproved = sortedUnique([...grantedDenied, ...outsideReview]);
	const missing = required.filter((scope) => !granted.includes(scope));
	const usable = granted.filter((scope) => allowed.has(scope) && !denied.has(scope));

	// Retention / liveness evidence. Every field is read through
	// `readInstant`, so "absent" and "unreadable" never collapse into the
	// same silent pass (see the Fail-closed section of this header).
	const reauth: ReauthReason[] = [];
	const addReauth = (reason: ReauthReason): void => {
		if (!reauth.includes(reason)) reauth.push(reason);
	};
	let ageDays: number | null = null;
	const issued = readInstant(grant.issuedAt);

	if (issued.present && issued.ms === null) {
		addReauth('connection_metadata_unreadable');
	} else if (issued.ms !== null) {
		ageDays = ageInDays(issued.ms, nowMs);
		// A non-positive ceiling is not a re-authorization reason: the
		// retention contract was never reviewed at all, which is an
		// `insufficient_scope` refusal below, not a dead grant.
		if (Number.isFinite(retentionDays) && retentionDays > 0 && ageDays > retentionDays) {
			addReauth('token_age_exceeds_retention');
		}
	} else {
		addReauth('issued_at_missing');
	}

	const revoked = readInstant(grant.revokedAt);
	if (revoked.present) {
		// An unreadable revocation stamp is not an absent one. Reading it
		// as "not revoked" would let a truncated or mis-migrated
		// connection row re-enable exactly the token this module exists to
		// keep disabled.
		addReauth(revoked.ms === null ? 'connection_metadata_unreadable' : 'grant_revoked');
	}

	const expires = readInstant(grant.expiresAt);
	if (expires.present) {
		// Same rule for provider expiry: unreadable is `reconnect`, not
		// "no expiry declared, so the token is fine".
		if (expires.ms === null) addReauth('connection_metadata_unreadable');
		else if (expires.ms <= nowMs) addReauth('token_expired');
	}

	if (grant.providerRequiresReauth === true) addReauth('provider_requires_reauth');

	const retentionUndeclared = !Number.isFinite(retentionDays) || retentionDays <= 0;

	if (grantedDenied.length > 0) {
		return verdict('unapproved_scope', SCOPE_REFUSAL_CODE.deniedScope, {
			integration,
			usable,
			unapproved,
			denied: grantedDenied,
			missing,
			reauth,
			ageDays,
			retentionDays,
		});
	}

	if (outsideReview.length > 0) {
		return verdict('unapproved_scope', SCOPE_REFUSAL_CODE.scopeOutsideReview, {
			integration,
			usable,
			unapproved,
			denied: grantedDenied,
			missing,
			reauth,
			ageDays,
			retentionDays,
		});
	}

	if (missing.length > 0) {
		return verdict('insufficient_scope', SCOPE_REFUSAL_CODE.requiredScopeMissing, {
			integration,
			usable,
			unapproved,
			denied: grantedDenied,
			missing,
			reauth,
			ageDays,
			retentionDays,
		});
	}

	if (retentionUndeclared) {
		return verdict('insufficient_scope', SCOPE_REFUSAL_CODE.retentionUndeclared, {
			integration,
			usable,
			unapproved,
			denied: grantedDenied,
			missing,
			reauth,
			ageDays,
			retentionDays,
		});
	}

	if (reauth.length > 0) {
		return verdict('reauth_required', reauthCode(reauth), {
			integration,
			usable,
			unapproved,
			denied: grantedDenied,
			missing,
			reauth,
			ageDays,
			retentionDays,
		});
	}

	return verdict('approved', SCOPE_REFUSAL_CODE.approved, {
		integration,
		usable,
		unapproved,
		denied: grantedDenied,
		missing,
		reauth,
		ageDays,
		retentionDays,
	});
}

type ReviewFields = Omit<ScopeReview, 'verdict' | 'code'>;

function verdict(name: ScopeVerdict, code: string, fields: ReviewFields): ScopeReview {
	return {
		verdict: name,
		code,
		...fields,
		usable: fields.usable,
		unapproved: [...fields.unapproved].sort(),
		denied: [...fields.denied].sort(),
		missing: [...fields.missing].sort(),
		reauth: [...fields.reauth].sort(),
	};
}

/**
 * The code for a re-auth refusal is the *first* reason in the fixed
 * order above, so the same dead grant always reports the same code
 * instead of depending on array order.
 */
const REAUTH_CODE_BY_REASON: Readonly<Record<ReauthReason, string>> = {
	grant_revoked: SCOPE_REFUSAL_CODE.grantRevoked,
	token_expired: SCOPE_REFUSAL_CODE.tokenExpired,
	token_age_exceeds_retention: SCOPE_REFUSAL_CODE.tokenAge,
	issued_at_missing: SCOPE_REFUSAL_CODE.issuedAtMissing,
	connection_metadata_unreadable: SCOPE_REFUSAL_CODE.metadataUnreadable,
	provider_requires_reauth: SCOPE_REFUSAL_CODE.providerRequiresReauth,
};

function reauthCode(reasons: readonly ReauthReason[]): string {
	for (const reason of REAUTH_CODE_ORDER) {
		if (reasons.includes(reason)) return REAUTH_CODE_BY_REASON[reason];
	}
	return SCOPE_REFUSAL_CODE.providerRequiresReauth;
}

/**
 * The single sentence an operator reads. English, because it is a log
 * line and a report cell, not UI copy: the caller renders it through
 * `docs/security/integration-token-scope.md`, which owns the Japanese
 * labels for each code.
 */
export function describeReview(review: ScopeReview): string {
	switch (review.verdict) {
		case 'approved':
			return `approved: ${review.usable.join(', ') || '(no scope required)'}`;
		case 'unknown_integration':
			return `no reviewed scope requirement for "${review.integration}"`;
		case 'unapproved_scope':
			return `refused: unapproved scope(s) ${review.unapproved.join(', ')}`;
		case 'insufficient_scope':
			return `refused: missing required scope(s) ${review.missing.join(', ') || '(retention)'}`;
		case 'reauth_required':
			return `re-authorize: ${review.reauth.join(', ')}`;
	}
}
