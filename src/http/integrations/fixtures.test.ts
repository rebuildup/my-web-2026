import { describe, expect, it } from 'vitest';
import { FIXTURE_NOW, SCOPE_FIXTURES, runScopeFixtures } from './fixtures.ts';
import { SCOPE_REFUSAL_CODE, type ScopeVerdict } from './scope-review.ts';

/**
 * Every local fixture must reach the verdict it claims (Issue #464).
 *
 * This is the "one connection, verified on local fixtures only" half of
 * the acceptance criteria, and it is the same function
 * `scripts/check-integration-scope.mjs` runs against the real reviewed
 * requirements, so a fixture that drifts from the adapter fails here
 * first and in the report second.
 */

const APPROVED = new Set<ScopeVerdict>(['approved']);

describe('connection-grant fixtures (Issue #464)', () => {
	it('reaches the declared verdict for every fixture', () => {
		for (const { fixture, review } of runScopeFixtures()) {
			expect(review.verdict, `${fixture.id} verdict`).toBe(fixture.expected.verdict);
			expect(review.code, `${fixture.id} code`).toBe(fixture.expected.code);
		}
	});

	it('covers every reachable verdict', () => {
		const verdicts = new Set(runScopeFixtures().map((run) => run.review.verdict));
		expect([...verdicts].sort()).toEqual([
			'approved',
			'insufficient_scope',
			'reauth_required',
			'unapproved_scope',
			'unknown_integration',
		]);
	});

	it('uses one unique id per fixture, so a report row can be named', () => {
		const ids = SCOPE_FIXTURES.map((fixture) => fixture.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('contains no credential-shaped value', () => {
		// A grant in this platform is scope names plus timestamps. If a
		// future edit adds a token-shaped literal to a fixture, the
		// fixture suite fails here instead of the secret landing in a
		// committed report row.
		for (const fixture of SCOPE_FIXTURES) {
			const serialized = JSON.stringify({ grant: fixture.grant, requirement: fixture.requirement });
			expect(serialized).not.toMatch(/gh[pousr]_[A-Za-z0-9]{16,}/);
			expect(serialized).not.toMatch(/xox[baprs]-[A-Za-z0-9-]{10,}/);
			expect(serialized).not.toMatch(/\b(secret_|ntn_)[A-Za-z0-9]{16,}/);
			expect(serialized).not.toMatch(/\b(bearer|basic)\s+\S{8,}/i);
		}
	});

	it('runs against a frozen clock, so the verdicts cannot drift with the wall clock', () => {
		expect(FIXTURE_NOW).toBe('2026-10-19T00:00:00.000Z');
		// A token that is fresh today stays fresh tomorrow.
		const tomorrow = new Date(Date.parse(FIXTURE_NOW) + 86_400_000);
		const byId = (id: string) => runScopeFixtures(tomorrow).find((r) => r.fixture.id === id);
		expect(byId('exact-approval')?.review.verdict).toBe('approved');
	});
});

describe('review codes are a closed vocabulary', () => {
	it('uses only codes the adapter publishes', () => {
		const published = new Set<string>(Object.values(SCOPE_REFUSAL_CODE));
		for (const { review } of runScopeFixtures()) {
			expect(published.has(review.code), review.code).toBe(true);
		}
	});

	it('never reports "approved" alongside a refusal list', () => {
		for (const { fixture, review } of runScopeFixtures()) {
			if (!APPROVED.has(review.verdict)) continue;
			expect(review.unapproved, fixture.id).toEqual([]);
			expect(review.denied, fixture.id).toEqual([]);
			expect(review.missing, fixture.id).toEqual([]);
			expect(review.reauth, fixture.id).toEqual([]);
		}
	});
});
