/**
 * Local webhook fixtures (Issue #463).
 *
 * Every value here is a **test input**, not a credential:
 *   - the secrets are literal fixture constants that exist only so a
 *     fixture can be signed and then verified;
 *   - the body is a static CMS-shaped payload;
 *   - the clock is frozen at {@link FIXTURE_NOW_SECONDS} so "fresh" and
 *     "expired" are reproducible on any machine at any time.
 *
 * No fixture reads `env`, Infisical, D1, R2, or the network. That is
 * the "local fixture / test resource, no production mutation" half of
 * the acceptance criteria: the suite cannot reach production even if a
 * binding is accidentally wired, because nothing here takes an
 * environment or a connection.
 *
 * The same builder feeds the Vitest contract test
 * (`src/http/webhooks/fixtures.test.ts`) and the verification report
 * (`scripts/webhook-signature-fixture-report.mjs`), so the screenshot
 * in the PR is generated from the exact inputs the test asserts on —
 * not from a hand-written table that can drift.
 */

import {
	type VerifyWebhookOptions,
	type WebhookRejectionReason,
	type WebhookVerificationResult,
	createMemoryReplayGuard,
	signWebhookPayload,
	verifyWebhookDelivery,
} from './signature.ts';

export const SCHEME = {
	signatureHeader: 'x-hub-signature-256',
	timestampHeader: 'x-hub-request-timestamp',
	deliveryHeader: 'x-github-delivery',
} as const;

/**
 * Fixture HMAC key. A literal that is intentionally not a credential:
 * it is compiled into the public repository and can only ever sign
 * fixture traffic.
 */
export const FIXTURE_SECRET = 'local-fixture-hmac-key-not-a-credential';

/** A second key used by the `wrong_secret` fixture (simulated rotation). */
export const FIXTURE_ROTATED_SECRET = 'local-fixture-hmac-key-after-rotation-not-a-credential';

/** Frozen clock (unix seconds) — every freshness judgement is relative to it. */
export const FIXTURE_NOW_SECONDS = 1_767_225_600;
export const FIXTURE_NOW_MS = FIXTURE_NOW_SECONDS * 1000;

/** Freshness window used by the fixtures (seconds). */
export const FIXTURE_TOLERANCE_SECONDS = 300;

const BODY = JSON.stringify({
	source: 'cms',
	action: 'published',
	entry: { id: 'entry-4711', slug: 'release-notes', revision: 12 },
});

const DELIVERY_ID = 'd0000000-0000-4000-8000-000000000001';
const OTHER_DELIVERY_ID = 'd0000000-0000-4000-8000-000000000002';

export type WebhookFixtureExpectation =
	| { accepted: true }
	| { accepted: false; reason: WebhookRejectionReason; status: number };

export interface WebhookFixture {
	id: string;
	/** What the fixture represents, one line. */
	label: string;
	/** One-line summary of the INPUT, for the verification report table. */
	input: string;
	/** Arguments handed to `verifyWebhookDelivery`. */
	delivery: VerifyWebhookOptions;
	/**
	 * Pre-claim this delivery id in the replay guard before verifying,
	 * which is how a "second copy of an already accepted delivery" is
	 * expressed as data instead of as test ordering.
	 */
	primeReplay?: { deliveryId: string };
	expected: WebhookFixtureExpectation;
}

const seconds = (deltaSeconds: number): string => String(FIXTURE_NOW_SECONDS + deltaSeconds);

/** Headers for a correctly signed, fresh delivery. */
async function signedHeaders(
	timestamp: string,
	deliveryId?: string,
): Promise<Record<string, string>> {
	const signature = await signWebhookPayload({ secret: FIXTURE_SECRET, timestamp, body: BODY });
	const headers: Record<string, string> = {
		[SCHEME.signatureHeader]: signature,
		[SCHEME.timestampHeader]: timestamp,
	};
	if (deliveryId) headers[SCHEME.deliveryHeader] = deliveryId;
	return headers;
}

/**
 * Build the fixture set. Async because signatures are computed with
 * Web Crypto; deterministic in output because every timestamp and id
 * is fixed.
 */
export async function buildWebhookFixtures(): Promise<WebhookFixture[]> {
	const now = seconds(0);
	const fresh = await signedHeaders(now, DELIVERY_ID);

	return [
		{
			id: 'signed',
			label: 'correctly signed, fresh, first delivery',
			input: `valid sha256 HMAC over "${now}.<body>", delivery id present`,
			delivery: { headers: fresh, body: BODY, secret: FIXTURE_SECRET },
			expected: { accepted: true },
		},
		{
			id: 'unsigned',
			label: 'no signature header at all',
			input: 'signature header removed, timestamp + delivery id intact',
			delivery: {
				headers: { [SCHEME.timestampHeader]: now, [SCHEME.deliveryHeader]: DELIVERY_ID },
				body: BODY,
				secret: FIXTURE_SECRET,
			},
			expected: { accepted: false, reason: 'missing_signature', status: 401 },
		},
		{
			id: 'blank_signature',
			label: 'signature header present but empty',
			input: 'signature header = "" (sender bug / proxy stripping)',
			delivery: {
				headers: {
					...fresh,
					[SCHEME.signatureHeader]: '   ',
				},
				body: BODY,
				secret: FIXTURE_SECRET,
			},
			expected: { accepted: false, reason: 'missing_signature', status: 401 },
		},
		{
			id: 'tampered_body',
			label: 'body modified after signing',
			input: 'valid signature, body byte changed (extra " " appended)',
			delivery: { headers: fresh, body: `${BODY} `, secret: FIXTURE_SECRET },
			expected: { accepted: false, reason: 'signature_mismatch', status: 401 },
		},
		{
			id: 'tampered_timestamp',
			label: 'timestamp header re-stamped after signing',
			input: 'signature computed over an older timestamp, header claims a fresh one',
			delivery: {
				headers: { ...fresh, [SCHEME.timestampHeader]: seconds(1) },
				body: BODY,
				secret: FIXTURE_SECRET,
			},
			expected: { accepted: false, reason: 'signature_mismatch', status: 401 },
		},
		{
			id: 'wrong_secret',
			label: 'signed with a rotated / foreign key',
			input: 'valid shape, HMAC computed under a different secret',
			delivery: {
				headers: {
					...fresh,
					[SCHEME.signatureHeader]: await signWebhookPayload({
						secret: FIXTURE_ROTATED_SECRET,
						timestamp: now,
						body: BODY,
					}),
				},
				body: BODY,
				secret: FIXTURE_SECRET,
			},
			expected: { accepted: false, reason: 'signature_mismatch', status: 401 },
		},
		{
			id: 'expired',
			label: 'correctly signed but one hour old',
			input: `timestamp = now - 3600s, tolerance = ${FIXTURE_TOLERANCE_SECONDS}s`,
			delivery: {
				headers: await signedHeaders(seconds(-3600)),
				body: BODY,
				secret: FIXTURE_SECRET,
			},
			expected: { accepted: false, reason: 'stale_timestamp', status: 401 },
		},
		{
			id: 'future_stamp',
			label: 'timestamp one hour in the future',
			input: 'timestamp = now + 3600s (clock skew or forged stamp)',
			delivery: {
				headers: await signedHeaders(seconds(3600)),
				body: BODY,
				secret: FIXTURE_SECRET,
			},
			expected: { accepted: false, reason: 'future_timestamp', status: 401 },
		},
		{
			id: 'missing_timestamp',
			label: 'signature without a timestamp header',
			input: 'valid signature, timestamp header removed',
			delivery: {
				headers: { [SCHEME.signatureHeader]: fresh[SCHEME.signatureHeader] },
				body: BODY,
				secret: FIXTURE_SECRET,
			},
			expected: { accepted: false, reason: 'missing_timestamp', status: 401 },
		},
		{
			id: 'malformed_timestamp',
			label: 'non-numeric timestamp',
			input: 'timestamp header = "not-a-number"',
			delivery: {
				headers: { ...fresh, [SCHEME.timestampHeader]: 'not-a-number' },
				body: BODY,
				secret: FIXTURE_SECRET,
			},
			expected: { accepted: false, reason: 'malformed_timestamp', status: 401 },
		},
		{
			id: 'weak_algorithm',
			label: 'sha1 signature downgrade attempt',
			input: 'sha1=<40 hex> instead of sha256=<64 hex>',
			delivery: {
				headers: { ...fresh, [SCHEME.signatureHeader]: `sha1=${'a'.repeat(40)}` },
				body: BODY,
				secret: FIXTURE_SECRET,
			},
			expected: { accepted: false, reason: 'unsupported_algorithm', status: 401 },
		},
		{
			id: 'truncated_signature',
			label: 'truncated digest',
			input: 'sha256=abcd (not 64 hex characters)',
			delivery: {
				headers: { ...fresh, [SCHEME.signatureHeader]: 'sha256=abcd' },
				body: BODY,
				secret: FIXTURE_SECRET,
			},
			expected: { accepted: false, reason: 'malformed_signature', status: 401 },
		},
		{
			id: 'replayed',
			label: 'byte-identical second copy of an accepted delivery',
			input: 'same headers + body as `signed`, delivery id already claimed',
			delivery: { headers: fresh, body: BODY, secret: FIXTURE_SECRET },
			primeReplay: { deliveryId: DELIVERY_ID },
			expected: { accepted: false, reason: 'replayed_delivery', status: 409 },
		},
		{
			id: 'missing_delivery_id',
			label: 'signed delivery without a delivery id',
			input: 'valid signature + timestamp, delivery header removed',
			delivery: {
				headers: {
					[SCHEME.signatureHeader]: fresh[SCHEME.signatureHeader],
					[SCHEME.timestampHeader]: now,
				},
				body: BODY,
				secret: FIXTURE_SECRET,
			},
			expected: { accepted: false, reason: 'missing_delivery_id', status: 400 },
		},
		{
			id: 'missing_secret',
			label: 'no HMAC key configured on our side',
			input: 'secret = "" (operator fault — must never be reachable in production)',
			delivery: { headers: fresh, body: BODY, secret: '' },
			expected: { accepted: false, reason: 'missing_secret', status: 500 },
		},
		{
			id: 'replayed_other_delivery',
			label: 'second delivery is not confused with the first one',
			input: 'same body, different delivery id than the primed one',
			delivery: {
				headers: await signedHeaders(now, OTHER_DELIVERY_ID),
				body: BODY,
				secret: FIXTURE_SECRET,
			},
			primeReplay: { deliveryId: DELIVERY_ID },
			expected: { accepted: true },
		},
	];
}

export interface WebhookFixtureOutcome {
	fixture: WebhookFixture;
	result: WebhookVerificationResult;
	/** True when the observed verdict equals `fixture.expected`. */
	matches: boolean;
}

/**
 * Run one fixture against a fresh in-memory replay guard.
 *
 * A fresh guard per fixture is what makes the suite order-independent:
 * no fixture can pass because another one consumed a claim.
 */
export async function runWebhookFixture(fixture: WebhookFixture): Promise<WebhookFixtureOutcome> {
	const guard = createMemoryReplayGuard();
	if (fixture.primeReplay) {
		await guard.claim(fixture.primeReplay.deliveryId, {
			nowMs: FIXTURE_NOW_MS,
			ttlMs: fixture.delivery.replayTtlMs ?? 60_000,
		});
	}
	const result = await verifyWebhookDelivery({
		...fixture.delivery,
		nowMs: FIXTURE_NOW_MS,
		toleranceSeconds: fixture.delivery.toleranceSeconds ?? FIXTURE_TOLERANCE_SECONDS,
		replayGuard: guard,
	});
	const expected = fixture.expected;
	const matches =
		expected.accepted === result.accepted &&
		(expected.accepted
			? true
			: (result as { reason: WebhookRejectionReason }).reason === expected.reason &&
				(result as { status: number }).status === expected.status);
	return { fixture, result, matches };
}

/** Run every fixture in declaration order. */
export async function runWebhookFixtures(): Promise<WebhookFixtureOutcome[]> {
	const fixtures = await buildWebhookFixtures();
	const outcomes: WebhookFixtureOutcome[] = [];
	for (const fixture of fixtures) outcomes.push(await runWebhookFixture(fixture));
	return outcomes;
}
