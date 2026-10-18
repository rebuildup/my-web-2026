import { describe, expect, it } from 'vitest';
import {
	DEFAULT_REPLAY_TTL_MS,
	DEFAULT_TOLERANCE_SECONDS,
	GITHUB_WEBHOOK_SCHEME,
	TIMESTAMPED_WEBHOOK_SCHEME,
	type WebhookReplayGuard,
	createMemoryReplayGuard,
	signWebhookPayload,
	verifyWebhookDelivery,
	webhookReplayTtlMs,
} from './signature.ts';

/**
 * Unit tests for the webhook verification adapter (Issue #463).
 *
 * The fixture *table* (which delivery must be rejected) lives in
 * `fixtures.test.ts`. This file covers the mechanism underneath it:
 * the signed-material rules of each scheme, the freshness boundary
 * arithmetic, header lookup rules, the replay seam's contract, and the
 * ordering guarantee that keeps a forged request from burning a
 * legitimate delivery id.
 */

const SECRET = 'unit-test-hmac-key-not-a-credential';
const NOW_SECONDS = 1_767_225_600;
const NOW_MS = NOW_SECONDS * 1000;
const BODY = '{"entry":{"id":"entry-4711"}}';

/** GitHub-shaped: `sha256=` HMAC of the raw body, no timestamp header. */
async function githubHeaders(
	overrides: { secret?: string; body?: string } = {},
): Promise<Record<string, string>> {
	const signature = await signWebhookPayload({
		secret: overrides.secret ?? SECRET,
		body: overrides.body ?? BODY,
	});
	return {
		[GITHUB_WEBHOOK_SCHEME.signatureHeader]: signature,
		[GITHUB_WEBHOOK_SCHEME.deliveryHeader]: 'delivery-0001',
	};
}

/** `<timestamp>.<body>` sender. */
async function timestampedHeaders(
	timestampSeconds: number,
	overrides: { secret?: string; body?: string } = {},
): Promise<Record<string, string>> {
	const signature = await signWebhookPayload({
		secret: overrides.secret ?? SECRET,
		body: overrides.body ?? BODY,
		timestamp: String(timestampSeconds),
		scheme: TIMESTAMPED_WEBHOOK_SCHEME,
	});
	return {
		[TIMESTAMPED_WEBHOOK_SCHEME.signatureHeader]: signature,
		[TIMESTAMPED_WEBHOOK_SCHEME.timestampHeader]: String(timestampSeconds),
		[TIMESTAMPED_WEBHOOK_SCHEME.deliveryHeader]: 'delivery-0001',
	};
}

describe('verifyWebhookDelivery — GitHub scheme (Issue #463)', () => {
	it('accepts a body-only delivery signed with the same secret', async () => {
		const result = await verifyWebhookDelivery({
			headers: await githubHeaders(),
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
			replayGuard: createMemoryReplayGuard(),
		});
		expect(result).toEqual({
			accepted: true,
			deliveryId: 'delivery-0001',
			// GitHub signs no timestamp, so there is nothing to report.
			// Reporting the arrival time here would read as freshness.
			timestamp: undefined,
			replayChecked: true,
		});
	});

	it('does not require a timestamp header — GitHub sends none', async () => {
		// Regression guard. A GitHub delivery carries `X-Hub-Signature-256`
		// and `X-GitHub-Delivery` only; demanding a timestamp header (or
		// verifying `<timestamp>.<body>`) rejects every real delivery as
		// `missing_timestamp` / `signature_mismatch`.
		const headers = await githubHeaders();
		expect(Object.keys(headers)).not.toContain('x-hub-request-timestamp');
		const result = await verifyWebhookDelivery({
			headers,
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
			replayGuard: createMemoryReplayGuard(),
		});
		expect(result.accepted).toBe(true);
	});

	it('refuses a body-only delivery when no replay guard is configured', async () => {
		// With no signed timestamp, the claim window is the only bound on
		// how long a captured body stays acceptable. Verifying the
		// signature alone would accept a replay forever.
		const result = await verifyWebhookDelivery({
			headers: await githubHeaders(),
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
		});
		expect(result).toMatchObject({
			accepted: false,
			reason: 'replay_guard_required',
			status: 500,
		});
	});

	it('does not accept a `<timestamp>.<body>` signature as a body-only one', async () => {
		// The two signed materials must not cross: a signature computed
		// over the prefixed material cannot be replayed into the
		// body-only verifier, or the scheme flag would be decorative.
		const forged = await timestampedHeaders(NOW_SECONDS);
		const result = await verifyWebhookDelivery({
			headers: {
				[GITHUB_WEBHOOK_SCHEME.signatureHeader]: forged[TIMESTAMPED_WEBHOOK_SCHEME.signatureHeader],
				[GITHUB_WEBHOOK_SCHEME.deliveryHeader]: 'delivery-0001',
			},
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
			replayGuard: createMemoryReplayGuard(),
		});
		expect(result).toMatchObject({ accepted: false, reason: 'signature_mismatch', status: 401 });
	});

	it('rejects a signature that is not exactly `sha256=` + 64 hex', async () => {
		const base = await githubHeaders();
		const cases: Array<[string, string]> = [
			['sha256=abc', 'malformed_signature'],
			[`sha256=${'a'.repeat(63)}`, 'malformed_signature'],
			[`sha256=${'z'.repeat(64)}`, 'malformed_signature'],
			[`sha512=${'a'.repeat(64)}`, 'unsupported_algorithm'],
			[`sha1=${'a'.repeat(40)}`, 'unsupported_algorithm'],
			['deadbeef', 'malformed_signature'],
		];
		for (const [value, reason] of cases) {
			const result = await verifyWebhookDelivery({
				headers: { ...base, [GITHUB_WEBHOOK_SCHEME.signatureHeader]: value },
				body: BODY,
				secret: SECRET,
				nowMs: NOW_MS,
				replayGuard: createMemoryReplayGuard(),
			});
			expect(result, `signature ${value}`).toMatchObject({ accepted: false, reason });
		}
	});
});

describe('verifyWebhookDelivery — timestamped scheme (Issue #463)', () => {
	it('accepts a fresh timestamped delivery and reports the signed stamp', async () => {
		const result = await verifyWebhookDelivery({
			headers: await timestampedHeaders(NOW_SECONDS),
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
			scheme: TIMESTAMPED_WEBHOOK_SCHEME,
			replayGuard: createMemoryReplayGuard(),
		});
		expect(result).toEqual({
			accepted: true,
			deliveryId: 'delivery-0001',
			timestamp: String(NOW_SECONDS),
			replayChecked: true,
		});
	});

	it('reports the freshness window inclusively at both edges', async () => {
		// Exactly `toleranceSeconds` of skew is still inside the window;
		// one second more is not, in either direction. An off-by-one here
		// either widens the accepted window or breaks senders at the edge.
		const edge = NOW_SECONDS - DEFAULT_TOLERANCE_SECONDS;
		const cases: Array<[number, string]> = [
			[edge, 'accepted'],
			[edge - 1, 'stale_timestamp'],
			[NOW_SECONDS + DEFAULT_TOLERANCE_SECONDS, 'accepted'],
			[NOW_SECONDS + DEFAULT_TOLERANCE_SECONDS + 1, 'future_timestamp'],
		];
		for (const [timestampSeconds, expected] of cases) {
			const result = await verifyWebhookDelivery({
				headers: await timestampedHeaders(timestampSeconds),
				body: BODY,
				secret: SECRET,
				nowMs: NOW_MS,
				scheme: TIMESTAMPED_WEBHOOK_SCHEME,
				replayGuard: createMemoryReplayGuard(),
			});
			expect(result, `timestamp ${timestampSeconds}`).toMatchObject(
				expected === 'accepted'
					? { accepted: true }
					: { accepted: false, reason: expected, status: 401 },
			);
		}
	});

	it('trims surrounding whitespace but refuses a non-integer timestamp', async () => {
		const base = await timestampedHeaders(NOW_SECONDS);
		// Senders behind a proxy that appends a space should still be
		// accepted — the trimmed value is what gets signed, so a
		// half-normalised header would fail every real delivery.
		const padded = await verifyWebhookDelivery({
			headers: {
				...base,
				[TIMESTAMPED_WEBHOOK_SCHEME.timestampHeader]: ` ${NOW_SECONDS} `,
			},
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
			scheme: TIMESTAMPED_WEBHOOK_SCHEME,
			replayGuard: createMemoryReplayGuard(),
		});
		expect(padded).toMatchObject({ accepted: true, timestamp: String(NOW_SECONDS) });

		for (const value of ['not-a-number', '1767225600.5', '-1767225600']) {
			const result = await verifyWebhookDelivery({
				headers: { ...base, [TIMESTAMPED_WEBHOOK_SCHEME.timestampHeader]: value },
				body: BODY,
				secret: SECRET,
				nowMs: NOW_MS,
				scheme: TIMESTAMPED_WEBHOOK_SCHEME,
				replayGuard: createMemoryReplayGuard(),
			});
			expect(result, `timestamp ${value}`).toMatchObject({
				accepted: false,
				reason: 'malformed_timestamp',
				status: 401,
			});
		}
	});

	it('rejects a delivery whose timestamp header is absent', async () => {
		const base = await timestampedHeaders(NOW_SECONDS);
		const result = await verifyWebhookDelivery({
			headers: {
				[TIMESTAMPED_WEBHOOK_SCHEME.signatureHeader]:
					base[TIMESTAMPED_WEBHOOK_SCHEME.signatureHeader],
			},
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
			scheme: TIMESTAMPED_WEBHOOK_SCHEME,
			replayGuard: createMemoryReplayGuard(),
		});
		expect(result).toMatchObject({ accepted: false, reason: 'missing_timestamp', status: 401 });
	});

	it('reads headers case-insensitively from a plain record and from Headers', async () => {
		// Handlers that rebuild a header bag (or tests) must not have to
		// preserve the sender's casing.
		const lower = await githubHeaders();
		const upper = Object.fromEntries(
			Object.entries(lower).map(([key, value]) => [key.toUpperCase(), value]),
		);
		for (const headers of [upper, new Headers(lower)]) {
			const result = await verifyWebhookDelivery({
				headers,
				body: BODY,
				secret: SECRET,
				nowMs: NOW_MS,
				replayGuard: createMemoryReplayGuard(),
			});
			expect(result.accepted).toBe(true);
		}
	});

	it('honours a caller-supplied scheme (CMS header names)', async () => {
		const scheme = {
			signatureHeader: 'x-cms-signature',
			timestampHeader: 'x-cms-timestamp',
			deliveryHeader: 'x-cms-delivery',
			signedMaterial: 'timestamped-body',
		} as const;
		const signature = await signWebhookPayload({
			secret: SECRET,
			body: BODY,
			timestamp: String(NOW_SECONDS),
			scheme,
		});
		const result = await verifyWebhookDelivery({
			headers: {
				'x-cms-signature': signature,
				'x-cms-timestamp': String(NOW_SECONDS),
				'x-cms-delivery': 'cms-0001',
			},
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
			scheme,
			replayGuard: createMemoryReplayGuard(),
		});
		expect(result).toMatchObject({ accepted: true, deliveryId: 'cms-0001' });
	});
});

describe('verifyWebhookDelivery — configuration faults (Issue #463)', () => {
	it('rejects when no secret is configured', async () => {
		for (const secret of [undefined, '']) {
			const result = await verifyWebhookDelivery({
				headers: await githubHeaders(),
				body: BODY,
				secret,
				nowMs: NOW_MS,
				replayGuard: createMemoryReplayGuard(),
			});
			// 500, not 401: this is our own fault and must page an
			// operator instead of looking like a rejected caller.
			expect(result).toMatchObject({ accepted: false, reason: 'missing_secret', status: 500 });
		}
	});

	it('refuses a claim window shorter than the freshness window', async () => {
		// A 60 s claim under a 300 s window: at t+61s a byte-identical
		// resend of a delivery that is still inside its freshness window
		// is claimed as a new delivery, and the replay guarantee is gone.
		const short = await verifyWebhookDelivery({
			headers: await githubHeaders(),
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
			replayTtlMs: 60_000,
			replayGuard: createMemoryReplayGuard(),
		});
		expect(short).toMatchObject({
			accepted: false,
			reason: 'invalid_replay_ttl',
			status: 500,
		});

		// Shrinking the window keeps the same TTL legal — the rule is
		// "TTL >= window", not a fixed number.
		const tight = await verifyWebhookDelivery({
			headers: await githubHeaders(),
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
			toleranceSeconds: 10,
			replayTtlMs: 60_000,
			replayGuard: createMemoryReplayGuard(),
		});
		expect(tight.accepted).toBe(true);
	});

	it('derives the claim window from the freshness window actually in use', async () => {
		// A fixed default TTL is only correct for the default window: at a
		// one-hour window a 660 s claim dies long before the window closes.
		const claimed: Array<{ deliveryId: string; ttlMs: number }> = [];
		const guard: WebhookReplayGuard = {
			async claim(deliveryId, { ttlMs }) {
				claimed.push({ deliveryId, ttlMs });
				return true;
			},
		};
		const headers = await githubHeaders();
		await verifyWebhookDelivery({
			headers,
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
			replayGuard: guard,
		});
		await verifyWebhookDelivery({
			headers,
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
			toleranceSeconds: 3600,
			replayGuard: guard,
		});
		expect(claimed.map((entry) => entry.ttlMs)).toEqual([
			webhookReplayTtlMs(DEFAULT_TOLERANCE_SECONDS),
			webhookReplayTtlMs(3600),
		]);
		expect(claimed[1]?.ttlMs).toBeGreaterThanOrEqual(3600 * 1000);
	});
});

describe('verifyWebhookDelivery — replay ordering (Issue #463)', () => {
	it('does not consume a replay claim for a delivery that failed verification', async () => {
		// Ordering guarantee: claiming the id before the HMAC matched
		// would let anyone burn a delivery id with a forged request and
		// lock the sender's retry out.
		const guard = createMemoryReplayGuard();
		const forged = await githubHeaders({ body: `${BODY} ` });
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const result = await verifyWebhookDelivery({
				headers: forged,
				body: BODY,
				secret: SECRET,
				nowMs: NOW_MS,
				replayGuard: guard,
			});
			expect(result).toMatchObject({ accepted: false, reason: 'signature_mismatch' });
		}

		const genuine = await verifyWebhookDelivery({
			headers: await githubHeaders(),
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
			replayGuard: guard,
		});
		expect(genuine).toMatchObject({ accepted: true, replayChecked: true });
	});

	it('rejects the second copy of an accepted delivery', async () => {
		const guard = createMemoryReplayGuard();
		const headers = await githubHeaders();
		const first = await verifyWebhookDelivery({
			headers,
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
			replayGuard: guard,
		});
		expect(first).toMatchObject({ accepted: true, deliveryId: 'delivery-0001' });

		const second = await verifyWebhookDelivery({
			headers,
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
			replayGuard: guard,
		});
		expect(second).toMatchObject({ accepted: false, reason: 'replayed_delivery', status: 409 });
	});

	it('requires a delivery id once a replay guard is configured', async () => {
		const result = await verifyWebhookDelivery({
			headers: { ...(await githubHeaders()), [GITHUB_WEBHOOK_SCHEME.deliveryHeader]: '' },
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
			replayGuard: createMemoryReplayGuard(),
		});
		expect(result).toMatchObject({
			accepted: false,
			reason: 'missing_delivery_id',
			status: 400,
		});
	});
});

describe('signWebhookPayload (Issue #463)', () => {
	it('refuses to sign a timestamped scheme without a timestamp', async () => {
		// A signing-side fault must be loud, not a signature over
		// `undefined.<body>` that every delivery then fails.
		await expect(
			signWebhookPayload({ secret: SECRET, body: BODY, scheme: TIMESTAMPED_WEBHOOK_SCHEME }),
		).rejects.toThrow(/timestamp/);
	});

	it('defaults to the GitHub scheme (body-only)', async () => {
		const implicit = await signWebhookPayload({ secret: SECRET, body: BODY });
		const explicit = await signWebhookPayload({
			secret: SECRET,
			body: BODY,
			scheme: GITHUB_WEBHOOK_SCHEME,
		});
		expect(implicit).toBe(explicit);
	});
});

describe('createMemoryReplayGuard (Issue #463)', () => {
	it('claims once and then reports the replay', async () => {
		const guard = createMemoryReplayGuard();
		const options = { nowMs: NOW_MS, ttlMs: DEFAULT_REPLAY_TTL_MS };
		expect(await guard.claim('a', options)).toBe(true);
		expect(await guard.claim('a', options)).toBe(false);
		expect(await guard.claim('b', options)).toBe(true);
	});

	it('forgets a claim once its TTL has passed', async () => {
		// A permanent store would make the id unreplayable forever and
		// grow without bound; TTL bounds both. The sweep uses each entry's
		// own expiry, so a later caller with a shorter TTL cannot cut a
		// long-lived claim short.
		const guard = createMemoryReplayGuard();
		expect(await guard.claim('a', { nowMs: NOW_MS, ttlMs: 10_000 })).toBe(true);
		expect(await guard.claim('a', { nowMs: NOW_MS + 5_000, ttlMs: 1 })).toBe(false);
		expect(await guard.claim('a', { nowMs: NOW_MS + 10_000, ttlMs: 1_000 })).toBe(true);
	});

	it('releases a claim so the sender can retry after our own failure', async () => {
		const guard = createMemoryReplayGuard();
		const options = { nowMs: NOW_MS, ttlMs: DEFAULT_REPLAY_TTL_MS };
		expect(await guard.claim('a', options)).toBe(true);
		await guard.release?.('a');
		expect(await guard.claim('a', options)).toBe(true);
	});

	it('keeps the default TTL above the default freshness window', async () => {
		// If the claim expired before the freshness window closed, a
		// sender's legitimate retry would be accepted as a new delivery.
		expect(DEFAULT_REPLAY_TTL_MS).toBe(webhookReplayTtlMs(DEFAULT_TOLERANCE_SECONDS));
		expect(DEFAULT_REPLAY_TTL_MS).toBeGreaterThan(DEFAULT_TOLERANCE_SECONDS * 1000);
	});
});

describe('WebhookReplayGuard contract', () => {
	it('is satisfiable by a durable store without touching this adapter', async () => {
		// A promoted production route swaps in a D1-backed guard; the
		// adapter only sees this interface.
		const durable: WebhookReplayGuard = {
			async claim(deliveryId, { ttlMs }) {
				return `durable:${deliveryId}:${ttlMs > 0}` !== 'never';
			},
		};
		expect(await durable.claim('x', { nowMs: NOW_MS, ttlMs: 1_000 })).toBe(true);
	});
});
