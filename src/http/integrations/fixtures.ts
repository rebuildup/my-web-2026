/**
 * Local connection-grant fixtures (Issue #464).
 *
 * Every value here is a **test input**, not a credential and not a
 * connection. There is no token field anywhere in this file — a grant
 * in this platform is a set of scope *names* plus timestamps, which is
 * what makes it safe to render in a committed artefact at all. The
 * requirement blocks below are **synthetic** (`local/*`): they exist to
 * pin the *mechanism* of `reviewConnection()` — precedence, denial,
 * retention, liveness — and are deliberately not the reviewed
 * requirements of any real service.
 *
 * The reviewed requirements of the three real candidates live in
 * `quality/integration-scope.json`, are owned by the repository owner,
 * and are executed by `scripts/check-integration-scope.mjs`. Keeping
 * the two apart is what stops a unit fixture from silently becoming the
 * statement of what GitHub is allowed to hold.
 *
 * The clock is frozen at {@link FIXTURE_NOW} so "fresh" and "expired"
 * are reproducible on any machine at any time. No fixture reads `env`,
 * Infisical, D1, R2, or the network, which is the "local fixture /
 * test resource, no production mutation" half of the acceptance
 * criteria: the suite cannot reach production even if a binding is
 * accidentally wired, because nothing here takes an environment or a
 * connection.
 */

import type {
	ConnectionGrant,
	ScopeRequirement,
	ScopeReview,
	ScopeVerdict,
} from './scope-review.ts';
import { SCOPE_REFUSAL_CODE, reviewConnection } from './scope-review.ts';

/** Frozen clock for every fixture in this file. */
export const FIXTURE_NOW = '2026-10-19T00:00:00.000Z';

/** The same instant as a `Date`, for callers that review directly. */
export const FIXTURE_NOW_DATE = new Date(FIXTURE_NOW);

const DAY = '2026-10-19';

/**
 * ISO instant `days` before the frozen clock. Exported so a test that
 * writes its own grant does not have to restate the epoch arithmetic.
 */
export function daysBefore(days: number): string {
	return new Date(Date.parse(FIXTURE_NOW) - days * 86_400_000).toISOString();
}

/**
 * A synthetic reviewed requirement: one required read scope, one
 * optional read scope, two denied write/administrative scopes, and a
 * 90-day retention ceiling.
 */
function readOnlyRequirement(
	id: string,
	overrides: Partial<ScopeRequirement> = {},
): ScopeRequirement {
	return {
		id,
		required: ['read:user'],
		optional: ['read:profile'],
		denied: ['workflow', 'admin:org'],
		maxAgeDays: 90,
		...overrides,
	};
}

export interface ScopeFixture {
	readonly id: string;
	/** What the fixture is meant to prove, in one line. */
	readonly title: string;
	/**
	 * The reviewed requirement, or `null` for the unknown-integration
	 * case (nobody has reviewed this service's scopes).
	 */
	readonly requirement: ScopeRequirement | null;
	readonly grant: ConnectionGrant;
	readonly expected: { readonly verdict: ScopeVerdict; readonly code: string };
}

/**
 * The mechanism matrix: one fixture per reachable verdict, plus the
 * precedence cases. Ordered as the report renders them — the two
 * approvals first, then refusals by severity.
 */
export const SCOPE_FIXTURES: readonly ScopeFixture[] = [
	{
		id: 'exact-approval',
		title: 'granted set equals the required set and the token is fresh',
		requirement: readOnlyRequirement('local/read-only'),
		grant: {
			integration: 'local/read-only',
			scopes: ['read:user'],
			issuedAt: daysBefore(30),
		},
		expected: { verdict: 'approved', code: SCOPE_REFUSAL_CODE.approved },
	},
	{
		id: 'optional-scope-accepted',
		title: 'an optional read scope does not break least privilege',
		requirement: readOnlyRequirement('local/read-only'),
		grant: {
			integration: 'local/read-only',
			scopes: ['read:user', 'read:profile'],
			issuedAt: daysBefore(1),
		},
		expected: { verdict: 'approved', code: SCOPE_REFUSAL_CODE.approved },
	},
	{
		id: 'duplicate-and-padded-scope-names',
		title: 'duplicate and whitespace-padded scope names are one scope',
		requirement: readOnlyRequirement('local/read-only'),
		grant: {
			integration: 'local/read-only',
			scopes: [' read:user ', 'read:user', ''],
			issuedAt: daysBefore(2),
		},
		expected: { verdict: 'approved', code: SCOPE_REFUSAL_CODE.approved },
	},
	{
		id: 'denied-write-scope',
		title: 'a write/administrative scope this platform never asked for is refused',
		requirement: readOnlyRequirement('local/read-only'),
		grant: {
			integration: 'local/read-only',
			scopes: ['read:user', 'workflow'],
			issuedAt: daysBefore(10),
		},
		expected: { verdict: 'unapproved_scope', code: SCOPE_REFUSAL_CODE.deniedScope },
	},
	{
		id: 'scope-outside-review',
		title: 'a scope nobody reviewed is not silently accepted',
		requirement: readOnlyRequirement('local/read-only'),
		grant: {
			integration: 'local/read-only',
			scopes: ['read:user', 'read:private'],
			issuedAt: daysBefore(10),
		},
		expected: { verdict: 'unapproved_scope', code: SCOPE_REFUSAL_CODE.scopeOutsideReview },
	},
	{
		id: 'required-scope-missing',
		title: 'a grant that cannot do the reviewed job is refused',
		requirement: readOnlyRequirement('local/read-only'),
		grant: {
			integration: 'local/read-only',
			scopes: ['read:profile'],
			issuedAt: daysBefore(10),
		},
		expected: { verdict: 'insufficient_scope', code: SCOPE_REFUSAL_CODE.requiredScopeMissing },
	},
	{
		id: 'retention-never-declared',
		title: 'no declared retention ceiling means the connection cannot be approved',
		requirement: readOnlyRequirement('local/read-only', { maxAgeDays: 0 }),
		grant: {
			integration: 'local/read-only',
			scopes: ['read:user'],
			issuedAt: daysBefore(1),
		},
		expected: { verdict: 'insufficient_scope', code: SCOPE_REFUSAL_CODE.retentionUndeclared },
	},
	{
		id: 'token-aged-past-retention',
		title: 'a token older than the approved retention ceiling needs re-authorization',
		requirement: readOnlyRequirement('local/read-only'),
		grant: {
			integration: 'local/read-only',
			scopes: ['read:user'],
			issuedAt: daysBefore(120),
		},
		expected: { verdict: 'reauth_required', code: SCOPE_REFUSAL_CODE.tokenAge },
	},
	{
		id: 'grant-revoked',
		title: 'a revoked grant is dead however well-scoped it was',
		requirement: readOnlyRequirement('local/read-only'),
		grant: {
			integration: 'local/read-only',
			scopes: ['read:user'],
			issuedAt: daysBefore(5),
			revokedAt: `${DAY}T00:00:00.000Z`,
		},
		expected: { verdict: 'reauth_required', code: SCOPE_REFUSAL_CODE.grantRevoked },
	},
	{
		id: 'token-expired',
		title: 'a provider expiry in the past needs re-authorization',
		requirement: readOnlyRequirement('local/read-only'),
		grant: {
			integration: 'local/read-only',
			scopes: ['read:user'],
			issuedAt: daysBefore(5),
			expiresAt: daysBefore(1),
		},
		expected: { verdict: 'reauth_required', code: SCOPE_REFUSAL_CODE.tokenExpired },
	},
	{
		id: 'provider-requires-reauth',
		title: 'the provider asking for interactive re-authorization is honored',
		requirement: readOnlyRequirement('local/read-only'),
		grant: {
			integration: 'local/read-only',
			scopes: ['read:user'],
			issuedAt: daysBefore(5),
			providerRequiresReauth: true,
		},
		expected: {
			verdict: 'reauth_required',
			code: SCOPE_REFUSAL_CODE.providerRequiresReauth,
		},
	},
	{
		id: 'issued-at-missing',
		title: 'a connection with no issue date cannot be shown to satisfy a retention ceiling',
		requirement: readOnlyRequirement('local/read-only'),
		grant: { integration: 'local/read-only', scopes: ['read:user'], issuedAt: null },
		expected: { verdict: 'reauth_required', code: SCOPE_REFUSAL_CODE.issuedAtMissing },
	},
	{
		id: 'connection-metadata-unreadable',
		title: 'an unparseable issue date fails closed',
		requirement: readOnlyRequirement('local/read-only'),
		grant: {
			integration: 'local/read-only',
			scopes: ['read:user'],
			issuedAt: 'whenever-it-was',
		},
		expected: { verdict: 'reauth_required', code: SCOPE_REFUSAL_CODE.metadataUnreadable },
	},
	{
		id: 'over-scoped-and-revoked',
		title:
			'least privilege outranks liveness: the scope refusal is reported, the revoke reason is kept',
		requirement: readOnlyRequirement('local/read-only'),
		grant: {
			integration: 'local/read-only',
			scopes: ['read:user', 'admin:org'],
			issuedAt: daysBefore(5),
			revokedAt: `${DAY}T00:00:00.000Z`,
		},
		expected: { verdict: 'unapproved_scope', code: SCOPE_REFUSAL_CODE.deniedScope },
	},
	{
		id: 'unknown-integration',
		title: 'a grant for a service nobody reviewed is refused, not assumed safe',
		requirement: null,
		grant: {
			integration: 'local/never-reviewed',
			scopes: ['read:user'],
			issuedAt: daysBefore(5),
		},
		expected: { verdict: 'unknown_integration', code: SCOPE_REFUSAL_CODE.unknownIntegration },
	},
];

export interface ScopeFixtureRun {
	readonly fixture: ScopeFixture;
	readonly review: ScopeReview;
}

/** Run every fixture through the real adapter at the frozen clock. */
export function runScopeFixtures(now: Date = FIXTURE_NOW_DATE): readonly ScopeFixtureRun[] {
	return SCOPE_FIXTURES.map((fixture) => ({
		fixture,
		review: reviewConnection(fixture.requirement, fixture.grant, now),
	}));
}
