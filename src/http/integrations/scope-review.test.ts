import { describe, expect, it } from 'vitest';
import { FIXTURE_NOW_DATE, daysBefore } from './fixtures.ts';
import {
	type ConnectionGrant,
	SCOPE_REFUSAL_CODE,
	type ScopeRequirement,
	describeReview,
	reviewConnection,
} from './scope-review.ts';

/**
 * The contract of the least-privilege grant review (Issue #464).
 *
 * These assertions are about the *mechanism*; the reviewed requirements
 * of the three real candidates live in `quality/integration-scope.json`
 * and are executed by `scripts/check-integration-scope.mjs`. Keeping the
 * two apart is what stops a unit test from becoming the statement of what
 * GitHub / Notion / Discord are allowed to hold.
 *
 * No test here reads a binding, a secret or the network, so the whole
 * file runs against a frozen clock with no production access at all.
 */

const READ_ONLY: ScopeRequirement = {
	id: 'local/read-only',
	required: ['read:user'],
	optional: ['read:profile'],
	denied: ['workflow', 'admin:org'],
	maxAgeDays: 90,
};

const grant = (overrides: Partial<ConnectionGrant> = {}): ConnectionGrant => ({
	integration: 'local/read-only',
	scopes: ['read:user'],
	issuedAt: daysBefore(1),
	...overrides,
});

describe('reviewConnection — approvals', () => {
	it('approves a grant that carries exactly the reviewed scope set', () => {
		const review = reviewConnection(READ_ONLY, grant(), FIXTURE_NOW_DATE);
		expect(review.verdict).toBe('approved');
		expect(review.code).toBe(SCOPE_REFUSAL_CODE.approved);
		expect(review.usable).toEqual(['read:user']);
		expect(review.unapproved).toEqual([]);
		expect(review.missing).toEqual([]);
	});

	it('accepts an optional scope and reports it as usable', () => {
		const review = reviewConnection(
			READ_ONLY,
			grant({ scopes: ['read:profile', 'read:user'] }),
			FIXTURE_NOW_DATE,
		);
		expect(review.verdict).toBe('approved');
		expect(review.usable).toEqual(['read:profile', 'read:user']);
	});

	it('approves a token issued on the ceiling day itself (age == ceiling)', () => {
		const review = reviewConnection(
			READ_ONLY,
			grant({ issuedAt: daysBefore(90) }),
			FIXTURE_NOW_DATE,
		);
		expect(review.verdict).toBe('approved');
		expect(review.ageDays).toBe(90);
	});

	it('reports a missing optional scope as nothing at all', () => {
		const review = reviewConnection(READ_ONLY, grant({ scopes: [] }), FIXTURE_NOW_DATE);
		// An empty grant cannot satisfy `required`, so it is an
		// insufficient-scope refusal, never an approval by vacuity.
		expect(review.verdict).toBe('insufficient_scope');
		expect(review.missing).toEqual(['read:user']);
	});
});

describe('reviewConnection — least privilege', () => {
	it('refuses a denied scope and names it', () => {
		const review = reviewConnection(
			READ_ONLY,
			grant({ scopes: ['read:user', 'workflow'] }),
			FIXTURE_NOW_DATE,
		);
		expect(review.verdict).toBe('unapproved_scope');
		expect(review.code).toBe(SCOPE_REFUSAL_CODE.deniedScope);
		expect(review.denied).toEqual(['workflow']);
		expect(review.unapproved).toEqual(['workflow']);
		// A denied scope is never usable, even though it was granted.
		expect(review.usable).toEqual(['read:user']);
	});

	it('refuses a scope that is neither required nor optional nor denied', () => {
		const review = reviewConnection(
			READ_ONLY,
			grant({ scopes: ['read:user', 'read:private'] }),
			FIXTURE_NOW_DATE,
		);
		expect(review.verdict).toBe('unapproved_scope');
		expect(review.code).toBe(SCOPE_REFUSAL_CODE.scopeOutsideReview);
		expect(review.denied).toEqual([]);
		expect(review.unapproved).toEqual(['read:private']);
	});

	it('compares scope names exactly, so a case typo is not a consent match', () => {
		const review = reviewConnection(READ_ONLY, grant({ scopes: ['Read:User'] }), FIXTURE_NOW_DATE);
		// Folding case would accept this as the consented scope. It is
		// reported as an unreviewed scope instead, which is the failure
		// mode that keeps a typo from reading as consent.
		expect(review.verdict).toBe('unapproved_scope');
		expect(review.unapproved).toEqual(['Read:User']);
		expect(review.missing).toEqual(['read:user']);
	});

	it('de-duplicates and trims scope names before comparing them', () => {
		const review = reviewConnection(
			READ_ONLY,
			grant({ scopes: [' read:user ', 'read:user', 'read:user'] }),
			FIXTURE_NOW_DATE,
		);
		expect(review.verdict).toBe('approved');
		expect(review.usable).toEqual(['read:user']);
	});

	it('reports every unapproved scope, not only the first', () => {
		const review = reviewConnection(
			READ_ONLY,
			grant({ scopes: ['read:user', 'admin:org', 'read:private'] }),
			FIXTURE_NOW_DATE,
		);
		expect(review.unapproved).toEqual(['admin:org', 'read:private']);
		expect(review.denied).toEqual(['admin:org']);
	});
});

describe('reviewConnection — retention and liveness', () => {
	it('asks for re-authorization once the token is older than the ceiling', () => {
		const review = reviewConnection(
			READ_ONLY,
			grant({ issuedAt: daysBefore(91) }),
			FIXTURE_NOW_DATE,
		);
		expect(review.verdict).toBe('reauth_required');
		expect(review.code).toBe(SCOPE_REFUSAL_CODE.tokenAge);
		expect(review.reauth).toEqual(['token_age_exceeds_retention']);
	});

	it('treats a revoked grant as dead', () => {
		const review = reviewConnection(
			READ_ONLY,
			grant({ revokedAt: '2026-10-18T00:00:00.000Z' }),
			FIXTURE_NOW_DATE,
		);
		expect(review.verdict).toBe('reauth_required');
		expect(review.reauth).toContain('grant_revoked');
	});

	it('treats a past provider expiry as dead but a future one as fresh', () => {
		const past = reviewConnection(
			READ_ONLY,
			grant({ expiresAt: '2026-10-18T00:00:00.000Z' }),
			FIXTURE_NOW_DATE,
		);
		expect(past.verdict).toBe('reauth_required');

		const future = reviewConnection(
			READ_ONLY,
			grant({ expiresAt: '2026-11-18T00:00:00.000Z' }),
			FIXTURE_NOW_DATE,
		);
		expect(future.verdict).toBe('approved');
	});

	it('honors a provider that asks for interactive re-authorization', () => {
		const review = reviewConnection(
			READ_ONLY,
			grant({ providerRequiresReauth: true }),
			FIXTURE_NOW_DATE,
		);
		expect(review.verdict).toBe('reauth_required');
		expect(review.code).toBe(SCOPE_REFUSAL_CODE.providerRequiresReauth);
	});

	it('fails closed when the issue date is missing or unparseable', () => {
		const missing = reviewConnection(READ_ONLY, grant({ issuedAt: null }), FIXTURE_NOW_DATE);
		expect(missing.verdict).toBe('reauth_required');
		expect(missing.reauth).toEqual(['issued_at_missing']);

		const unreadable = reviewConnection(
			READ_ONLY,
			grant({ issuedAt: 'sometime-last-week' }),
			FIXTURE_NOW_DATE,
		);
		expect(unreadable.verdict).toBe('reauth_required');
		expect(unreadable.reauth).toEqual(['connection_metadata_unreadable']);
	});

	it('fails closed on an unreadable revocation stamp instead of reading it as live', () => {
		// The direction that matters: a connection row whose `revoked_at`
		// is corrupted must NOT review as approved. Before this guard, a
		// truncated row silently re-enabled a revoked token.
		const corrupted = reviewConnection(
			READ_ONLY,
			grant({ revokedAt: 'corrupted-row' }),
			FIXTURE_NOW_DATE,
		);
		expect(corrupted.verdict).toBe('reauth_required');
		expect(corrupted.code).toBe(SCOPE_REFUSAL_CODE.metadataUnreadable);
		expect(corrupted.reauth).toContain('connection_metadata_unreadable');

		// The readable form of the same row is still `grant_revoked`, so
		// the reason an operator sees does not change with the failure.
		const revoked = reviewConnection(
			READ_ONLY,
			grant({ revokedAt: '2026-10-18T00:00:00.000Z' }),
			FIXTURE_NOW_DATE,
		);
		expect(revoked.verdict).toBe('reauth_required');
		expect(revoked.reauth).toContain('grant_revoked');

		// An absent field is still absent, so the happy path is unaffected.
		expect(reviewConnection(READ_ONLY, grant(), FIXTURE_NOW_DATE).verdict).toBe('approved');
	});

	it('fails closed on an unreadable provider expiry instead of reading it as none', () => {
		const corrupted = reviewConnection(
			READ_ONLY,
			grant({ expiresAt: 'not-a-timestamp' }),
			FIXTURE_NOW_DATE,
		);
		expect(corrupted.verdict).toBe('reauth_required');
		expect(corrupted.code).toBe(SCOPE_REFUSAL_CODE.metadataUnreadable);

		const future = reviewConnection(
			READ_ONLY,
			grant({ expiresAt: '2026-11-18T00:00:00.000Z' }),
			FIXTURE_NOW_DATE,
		);
		expect(future.verdict).toBe('approved');
	});

	it('reports one reason per failure, never a duplicate row', () => {
		const review = reviewConnection(
			READ_ONLY,
			grant({ revokedAt: 'corrupted-row', expiresAt: 'also-corrupted' }),
			FIXTURE_NOW_DATE,
		);
		expect(review.verdict).toBe('reauth_required');
		expect(review.reauth).toEqual(['connection_metadata_unreadable']);
		expect(new Set(review.reauth).size).toBe(review.reauth.length);
	});

	it('cannot approve a requirement that declares no retention ceiling', () => {
		for (const maxAgeDays of [0, -1, Number.NaN]) {
			const review = reviewConnection({ ...READ_ONLY, maxAgeDays }, grant(), FIXTURE_NOW_DATE);
			expect(review.verdict, `maxAgeDays=${maxAgeDays}`).toBe('insufficient_scope');
			expect(review.code, `maxAgeDays=${maxAgeDays}`).toBe(SCOPE_REFUSAL_CODE.retentionUndeclared);
		}
	});
});

describe('reviewConnection — unknown services and precedence', () => {
	it('refuses a grant for a service nobody reviewed', () => {
		const review = reviewConnection(
			null,
			grant({ integration: 'local/never-reviewed', scopes: ['read:user'] }),
			FIXTURE_NOW_DATE,
		);
		expect(review.verdict).toBe('unknown_integration');
		expect(review.usable).toEqual([]);
		expect(review.unapproved).toEqual(['read:user']);
	});

	it('reports least privilege before liveness, and keeps the re-auth reason visible', () => {
		const review = reviewConnection(
			READ_ONLY,
			grant({ scopes: ['read:user', 'workflow'], revokedAt: '2026-10-18T00:00:00.000Z' }),
			FIXTURE_NOW_DATE,
		);
		expect(review.verdict).toBe('unapproved_scope');
		expect(review.code).toBe(SCOPE_REFUSAL_CODE.deniedScope);
		// The reason it must be re-authorized is not lost by precedence.
		expect(review.reauth).toContain('grant_revoked');
	});

	it('reports insufficient scope before re-auth for the same grant', () => {
		const review = reviewConnection(
			READ_ONLY,
			grant({ scopes: [], revokedAt: '2026-10-18T00:00:00.000Z' }),
			FIXTURE_NOW_DATE,
		);
		expect(review.verdict).toBe('insufficient_scope');
		expect(review.reauth).toContain('grant_revoked');
	});
});

describe('determinism', () => {
	it('produces byte-identical output for the same inputs, in any input order', () => {
		const first = reviewConnection(
			READ_ONLY,
			grant({ scopes: ['read:user', 'workflow', 'read:private'] }),
			FIXTURE_NOW_DATE,
		);
		const second = reviewConnection(
			READ_ONLY,
			grant({ scopes: ['read:private', 'workflow', 'read:user'] }),
			FIXTURE_NOW_DATE,
		);
		expect(JSON.stringify(second)).toBe(JSON.stringify(first));
		expect(first.unapproved).toEqual(['read:private', 'workflow']);
	});

	it('describes every verdict without leaking a token value', () => {
		const approvals = [
			reviewConnection(READ_ONLY, grant(), FIXTURE_NOW_DATE),
			reviewConnection(READ_ONLY, grant({ scopes: ['read:user', 'workflow'] }), FIXTURE_NOW_DATE),
			reviewConnection(READ_ONLY, grant({ scopes: [] }), FIXTURE_NOW_DATE),
			reviewConnection(READ_ONLY, grant({ issuedAt: daysBefore(200) }), FIXTURE_NOW_DATE),
			reviewConnection(null, grant(), FIXTURE_NOW_DATE),
		];
		for (const review of approvals) {
			const text = describeReview(review);
			expect(text.length).toBeGreaterThan(0);
			expect(text).not.toMatch(/secret|token\s*[:=]/i);
		}
	});
});
