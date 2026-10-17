import { describe, expect, it } from 'vitest';
import {
	DEFAULT_REPLAY_TTL_MS,
	DEFAULT_TOLERANCE_SECONDS,
	GITHUB_WEBHOOK_SCHEME,
	type WebhookReplayGuard,
	createMemoryReplayGuard,
	signWebhookPayload,
	verifyWebhookDelivery,
} from './signature.ts';

/**
 * Unit tests for the webhook verification adapter (Issue #463).
 *
 * The fixture *table* (which delivery must be rejected) lives in
 * `fixtures.test.ts`. This file covers the mechanism underneath it:
 * the freshness boundary arithmetic, header lookup rules, the replay
 * seam's contract, and the ordering guarantee that keeps a forged
 * request from burning a legitimate delivery id.
 */

const SECRET = 'unit-test-hmac-key-not-a-credential';
const NOW_SECONDS = 1_767_225_600;
const NOW_MS = NOW_SECONDS * 1000;
const BODY = '{"entry":{"id":"entry-4711"}}';

async function signedHeaders(
	timestampSeconds: number,
	overrides: { secret?: string; body?: string } = {},
): Promise<Record<string, string>> {
	const signature = await signWebhookPayload({
		secret: overrides.secret ?? SECRET,
		timestamp: String(timestampSeconds),
		body: overrides.body ?? BODY,
	});
	return {
		[GITHUB_WEBHOOK_SCHEME.signatureHeader]: signature,
		[GITHUB_WEBHOOK_SCHEME.timestampHeader]: String(timestampSeconds),
		[GITHUB_WEBHOOK_SCHEME.deliveryHeader]: 'delivery-0001',
	};
}

describe('verifyWebhookDelivery (Issue #463)', () => {
	it('accepts a delivery signed with the same secret', async () => {
		const result = await verifyWebhookDelivery({
			headers: await signedHeaders(NOW_SECONDS),
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
		});
		expect(result).toEqual({
			accepted: true,
			deliveryId: undefined,
			timestamp: String(NOW_SECONDS),
			replayChecked: false,
		});
	});

	it('reports the freshness window inclusively at the boundary', async () => {
		// Exactly `toleranceSeconds` old is still inside the window; one
		// second more is not. An off-by-one here either widens the
		// accepted window or breaks senders at the edge of it.
		const edge = NOW_SECONDS - DEFAULT_TOLERANCE_SECONDS;
		const inside = await verifyWebhookDelivery({
			headers: await signedHeaders(edge),
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
		});
		expect(inside.accepted).toBe(true);

		const outside = await verifyWebhookDelivery({
			headers: await signedHeaders(edge - 1),
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
		});
		expect(outside).toMatchObject({ accepted: false, reason: 'stale_timestamp', status: 401 });
	});

	it('reads headers case-insensitively from a plain record', async () => {
		// Handlers that rebuild a header bag (or tests) must not have to
		// preserve the sender's casing.
		const lower = await signedHeaders(NOW_SECONDS);
		const upper = Object.fromEntries(
			Object.entries(lower).map(([key, value]) => [key.toUpperCase(), value]),
		);
		const result = await verifyWebhookDelivery({
			headers: upper,
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
		});
		expect(result.accepted).toBe(true);
	});

	it('reads headers from a Headers instance', async () => {
		const result = await verifyWebhookDelivery({
			headers: new Headers(await signedHeaders(NOW_SECONDS)),
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
		});
		expect(result.accepted).toBe(true);
	});

	it('honours a caller-supplied scheme (CMS header names)', async () => {
		const scheme = {
			signatureHeader: 'x-cms-signature',
			timestampHeader: 'x-cms-timestamp',
			deliveryHeader: 'x-cms-delivery',
		};
		const signature = await signWebhookPayload({
			secret: SECRET,
			timestamp: String(NOW_SECONDS),
			body: BODY,
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

	it('rejects when no secret is configured', async () => {
		for (const secret of [undefined, '']) {
			const result = await verifyWebhookDelivery({
				headers: await signedHeaders(NOW_SECONDS),
				body: BODY,
				secret,
				nowMs: NOW_MS,
			});
			// 500, not 401: this is our own fault and must page an
			// operator instead of looking like a rejected caller.
			expect(result).toMatchObject({ accepted: false, reason: 'missing_secret', status: 500 });
		}
	});

	it('rejects a signature that is not exactly `sha256=` + 64 hex', async () => {
		const base = await signedHeaders(NOW_SECONDS);
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
			});
			expect(result, `signature ${value}`).toMatchObject({ accepted: false, reason });
		}
	});

	it('trims surrounding whitespace but refuses a non-integer timestamp', async () => {
		const base = await signedHeaders(NOW_SECONDS);
		// Senders behind a proxy that appends a space should still be
		// accepted — the trimmed value is what gets signed, so a
		// half-normalised header would fail every real delivery.
		const padded = await verifyWebhookDelivery({
			headers: { ...base, [GITHUB_WEBHOOK_SCHEME.timestampHeader]: ` ${NOW_SECONDS} ` },
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
		});
		expect(padded).toMatchObject({ accepted: true, timestamp: String(NOW_SECONDS) });

		for (const value of ['not-a-number', '1767225600.5', '-1767225600']) {
			const result = await verifyWebhookDelivery({
				headers: { ...base, [GITHUB_WEBHOOK_SCHEME.timestampHeader]: value },
				body: BODY,
				secret: SECRET,
				nowMs: NOW_MS,
			});
			expect(result, `timestamp ${value}`).toMatchObject({
				accepted: false,
				reason: 'malformed_timestamp',
				status: 401,
			});
		}
	});

	it('does not consume a replay claim for a delivery that failed verification', async () => {
		// Ordering guarantee: claiming the id before the HMAC matched
		// would let anyone burn a delivery id with a forged request and
		// lock the sender's retry out.
		const guard = createMemoryReplayGuard();
		const forged = await signedHeaders(NOW_SECONDS, { body: `${BODY} ` });
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
			headers: await signedHeaders(NOW_SECONDS),
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
			replayGuard: guard,
		});
		expect(genuine).toMatchObject({ accepted: true, replayChecked: true });
	});

	it('rejects the second copy of an accepted delivery', async () => {
		const guard = createMemoryReplayGuard();
		const headers = await signedHeaders(NOW_SECONDS);
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

	it('requires a delivery id only when a replay guard is configured', async () => {
		const headers = await signedHeaders(NOW_SECONDS);
		const withoutGuard = await verifyWebhookDelivery({
			headers: { ...headers, [GITHUB_WEBHOOK_SCHEME.deliveryHeader]: '' },
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
		});
		expect(withoutGuard).toMatchObject({ accepted: true, replayChecked: false });

		const withGuard = await verifyWebhookDelivery({
			headers: { ...headers, [GITHUB_WEBHOOK_SCHEME.deliveryHeader]: '' },
			body: BODY,
			secret: SECRET,
			nowMs: NOW_MS,
			replayGuard: createMemoryReplayGuard(),
		});
		expect(withGuard).toMatchObject({
			accepted: false,
			reason: 'missing_delivery_id',
			status: 400,
		});
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

	it('keeps the default TTL above the freshness window', async () => {
		// If the claim expired before the freshness window closed, a
		// sender's legitimate retry would be accepted as a new delivery.
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
