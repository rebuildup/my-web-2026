import { describe, expect, it } from 'vitest';
import {
	FIXTURE_NOW_SECONDS,
	FIXTURE_ROTATED_SECRET,
	FIXTURE_SECRET,
	FIXTURE_TOLERANCE_SECONDS,
	buildWebhookFixtures,
	runWebhookFixtures,
} from './fixtures.ts';
import type { WebhookRejectionReason } from './signature.ts';
import { webhookRejectionStatus } from './signature.ts';

/**
 * Webhook signature / freshness / replay contract test (Issue #463).
 *
 * The fixture table in `fixtures.ts` is the acceptance criteria made
 * executable: every entry declares the verdict it expects, and this
 * suite asserts the adapter produces it. It runs in the `unit` project
 * (Node environment, no workerd) because the adapter has no binding,
 * no I/O, and a frozen clock.
 */
describe('webhook delivery fixtures (Issue #463)', () => {
	it('every fixture observes its declared verdict', async () => {
		const outcomes = await runWebhookFixtures();
		const mismatches = outcomes
			.filter((outcome) => !outcome.matches)
			.map(
				(outcome) =>
					`${outcome.fixture.id}: expected ${JSON.stringify(outcome.fixture.expected)}, observed ${JSON.stringify(outcome.result)}`,
			);
		expect(mismatches).toEqual([]);
	});

	it('rejects unsigned / tampered / expired / replayed deliveries', async () => {
		const outcomes = await runWebhookFixtures();
		const reasons = new Set(
			outcomes
				.filter((outcome) => !outcome.result.accepted)
				.map((outcome) => (outcome.result as { reason: WebhookRejectionReason }).reason),
		);
		// The acceptance criteria name these four explicitly; the rest of
		// the table is defence in depth around the same three checks.
		expect(reasons.has('missing_signature')).toBe(true);
		expect(reasons.has('signature_mismatch')).toBe(true);
		expect(reasons.has('stale_timestamp')).toBe(true);
		expect(reasons.has('replayed_delivery')).toBe(true);
	});

	it('accepts exactly the fixtures that are meant to be accepted', async () => {
		const outcomes = await runWebhookFixtures();
		const accepted = outcomes
			.filter((outcome) => outcome.result.accepted)
			.map((outcome) => outcome.fixture.id);
		// One per shipped scheme, plus the no-false-positive control.
		expect(accepted.sort()).toEqual(['replayed_other_delivery', 'signed', 'signed_timestamped']);
	});

	it('keeps every defect-named fixture rejected', async () => {
		// Defence against a fixture silently becoming vacuous: an entry
		// declared as a defect must actually be rejected. Driven by the
		// declared expectation, so adding an accepted fixture cannot
		// silently widen the set.
		const outcomes = await runWebhookFixtures();
		const mustReject = outcomes.filter((outcome) => outcome.fixture.expected.accepted === false);
		expect(mustReject.length).toBeGreaterThan(10);
		for (const outcome of mustReject) {
			expect(outcome.result.accepted, `fixture ${outcome.fixture.id} must be rejected`).toBe(false);
		}
	});

	it('covers both shipped schemes, so neither sender is only half-pinned', async () => {
		// GitHub signs the body only; the generic scheme signs
		// `<timestamp>.<body>`. A table that pinned one of them would
		// leave the other's failure modes untested.
		const fixtures = await buildWebhookFixtures();
		const signedMaterials = new Set(
			fixtures.map((fixture) => fixture.delivery.scheme?.signedMaterial),
		);
		expect(signedMaterials).toEqual(new Set(['body-only', 'timestamped-body']));
		// The two freshness reasons can only come from a signed timestamp.
		const outcomes = await runWebhookFixtures();
		const stale = outcomes.filter(
			(outcome) => !outcome.result.accepted && outcome.result.reason === 'stale_timestamp',
		);
		expect(stale.length).toBeGreaterThan(0);
		for (const outcome of stale) {
			expect(outcome.fixture.delivery.scheme?.signedMaterial).toBe('timestamped-body');
		}
	});

	it('reports a documented status for every rejection reason', async () => {
		const outcomes = await runWebhookFixtures();
		for (const outcome of outcomes) {
			if (outcome.result.accepted) continue;
			expect(webhookRejectionStatus(outcome.result.reason)).toBe(outcome.result.status);
		}
	});

	it('captures no environment: fixtures carry no binding or connection', async () => {
		// The acceptance criteria require the fixtures to run against
		// local test resources only. If a fixture ever started taking a
		// D1 handle, an R2 bucket, or an `env`, this assertion fails and
		// the suite could no longer claim "no production mutation".
		const fixtures = await buildWebhookFixtures();
		// `scheme` declares the sender's headers / signed material,
		// `replayTtlMs` is the misconfiguration under test. Anything
		// else — an `env`, a D1 handle, a connection — is not a test
		// input and must fail here.
		const allowed = ['body', 'headers', 'replayTtlMs', 'scheme', 'secret', 'toleranceSeconds'];
		for (const fixture of fixtures) {
			for (const key of Object.keys(fixture.delivery).sort()) {
				expect(allowed, `fixture ${fixture.id} carries ${key}`).toContain(key);
			}
			expect(fixture.delivery).toHaveProperty('headers');
			expect(fixture.delivery).toHaveProperty('body');
			for (const value of Object.values(fixture.delivery.headers)) {
				expect(typeof value).toBe('string');
			}
		}
	});

	it('uses a frozen clock and literal fixture keys', async () => {
		// Both facts keep the suite reproducible: a run on any machine at
		// any time must reach the same verdicts, and the fixture keys must
		// be test inputs compiled into the repository — never something
		// read from the environment.
		const fixtures = await buildWebhookFixtures();
		const secrets = new Set(fixtures.map((fixture) => fixture.delivery.secret));
		// Every fixture verifies against the one fixture key, except the
		// `missing_secret` case which passes an empty string.
		expect(secrets).toEqual(new Set([FIXTURE_SECRET, '']));
		// The rotated key only ever *signs* the `wrong_secret` fixture —
		// it is never the key the adapter is asked to verify with, which
		// is exactly what makes that fixture a forgery.
		expect(secrets.has(FIXTURE_ROTATED_SECRET)).toBe(false);
		expect(FIXTURE_NOW_SECONDS).toBeGreaterThan(0);
		expect(FIXTURE_TOLERANCE_SECONDS).toBe(300);
	});
});
