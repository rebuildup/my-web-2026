/**
 * Inbound webhook signature adapter (Issue #463).
 *
 * Why this exists
 * ---------------
 * `docs/domain/integrations.md` records that no third-party
 * integration is promoted yet, and `src/http/hono.ts` dispatches the
 * `/webhooks/*` prefix to the external boundary — where nothing is
 * mounted. The first thing that boundary will need from any sender
 * (GitHub today, a CMS later) is an answer to three questions that are
 * all cheap to get wrong and expensive to discover in production:
 *
 *   1. Is this request actually from the sender (HMAC signature)?
 *   2. Is it recent (timestamp freshness window)?
 *   3. Have we already processed this exact delivery (replay guard)?
 *
 * A signature check alone answers none of 2 and 3. A captured,
 * perfectly-signed webhook payload is replayable forever, so this
 * adapter treats the three checks as one indivisible verdict: nothing
 * downstream ever sees an unverified body.
 *
 * Deliberate scope: **no production route is mounted.** The adapter
 * is exercised only through local fixtures
 * (`src/http/webhooks/fixtures.ts`) and the contract tests
 * (`src/http/webhooks/*.test.ts`). `src/http/webhooks/boundary.test.ts`
 * asserts that `/webhooks/*` still answers `404` on the real
 * boundary, so publishing an entry point before the durability
 * questions below are answered would be a regression, not a feature.
 *
 * Why GitHub's scheme
 * -------------------
 * `sha256=<hex>` HMAC over `"<timestamp>.<raw body>"` is the scheme
 * GitHub documents, and it is the strictest of the common ones: the
 * timestamp is *inside* the signed material, so an attacker cannot
 * re-stamp a captured payload without invalidating the signature.
 * Header names are configurable so a CMS that uses a different header
 * set can reuse this adapter instead of forking it.
 *
 * Runtime shape
 * -------------
 * No Cloudflare binding, no import of `Env`, Web Crypto only. That
 * keeps the contract testable as a pure function and keeps the
 * adapter from becoming a hidden dependency of the Worker entry.
 */

/**
 * Header names for the signature scheme.
 *
 * Defaults match GitHub's documented `X-Hub-Signature-256` /
 * `X-Hub-Request-Timestamp` / `X-GitHub-Delivery` set. Header lookup
 * is case-insensitive (`Headers` is; the record path lower-cases).
 */
export interface WebhookSignatureScheme {
	/** `sha256=<hex>` HMAC header. */
	signatureHeader: string;
	/** Unix **seconds** that is part of the signed material. */
	timestampHeader: string;
	/** Sender-assigned delivery id used for replay de-duplication. */
	deliveryHeader: string;
}

/** GitHub-compatible scheme — the default. */
export const GITHUB_WEBHOOK_SCHEME: WebhookSignatureScheme = {
	signatureHeader: 'x-hub-signature-256',
	timestampHeader: 'x-hub-request-timestamp',
	deliveryHeader: 'x-github-delivery',
};

/** The only algorithm this adapter accepts (`sha1=` is rejected). */
export const SUPPORTED_ALGORITHM = 'sha256';

/** Freshness window in seconds. GitHub documents 5 minutes. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * How long a claimed delivery id stays de-duplicated.
 *
 * It must be at least as long as the freshness window, otherwise a
 * sender's legitimate retry of a payload that is still inside the
 * window would be re-accepted after the claim expired. One extra
 * window of headroom covers clock drift on both ends.
 */
export const DEFAULT_REPLAY_TTL_MS = (DEFAULT_TOLERANCE_SECONDS * 2 + 60) * 1000;

/**
 * Headers as seen by a Worker handler: either the platform `Headers`
 * or a plain record (unit tests, adapters reading from a sub-request).
 */
export type WebhookHeaderSource = Headers | Record<string, string | undefined>;

function readHeader(source: WebhookHeaderSource, name: string): string | undefined {
	if (source instanceof Headers) return source.get(name) ?? undefined;
	const target = name.toLowerCase();
	for (const [key, value] of Object.entries(source)) {
		if (key.toLowerCase() === target) return value ?? undefined;
	}
	return undefined;
}

/**
 * Replay de-duplication seam.
 *
 * `claim` MUST be atomic: two concurrent copies of the same delivery
 * must not both return `true`. The in-memory implementation below is
 * single-isolate only (see its doc comment); a promoted production
 * route needs a durable store.
 */
export interface WebhookReplayGuard {
	/**
	 * Atomically claim `deliveryId`. Resolves `true` when this call is
	 * the first claim and `false` when the delivery was already seen.
	 */
	claim(deliveryId: string, options: { nowMs: number; ttlMs: number }): Promise<boolean>;
	/**
	 * Optional: drop a claim when downstream processing failed, so the
	 * sender's retry is not permanently blocked by our own failure.
	 */
	release?(deliveryId: string): Promise<void>;
}

/**
 * In-memory replay guard — fixtures and tests ONLY.
 *
 * Two properties a production route must not inherit:
 *   - state lives in one Worker isolate, so a second isolate (or a
 *     redeploy) starts with an empty map and accepts a replay;
 *   - entries are pruned by `ttlMs` on a best-effort sweep, so the
 *     map is bounded but not durable.
 *
 * It exists so the *contract* (first delivery accepted, second one
 * rejected) is provable without provisioning a store. The promotion
 * checklist in `docs/security/webhook-signature-verification.md` names
 * D1 `INSERT ... ON CONFLICT DO NOTHING` as the durable implementation.
 */
export function createMemoryReplayGuard(): WebhookReplayGuard {
	const claims = new Map<string, number>();
	return {
		async claim(deliveryId, { nowMs, ttlMs }) {
			// Sweep against each entry's OWN expiry, not the incoming
			// call's `ttlMs`: a claim stored with a long TTL must not be
			// dropped early just because a later caller passed a short
			// one.
			for (const [id, expiresAt] of claims) {
				if (expiresAt <= nowMs) claims.delete(id);
			}
			if (claims.has(deliveryId)) return false;
			claims.set(deliveryId, nowMs + ttlMs);
			return true;
		},
		async release(deliveryId) {
			claims.delete(deliveryId);
		},
	};
}

/**
 * Stable rejection codes. They are the observable contract of this
 * adapter: the status mapping below is what a future route returns.
 */
export type WebhookRejectionReason =
	/** No HMAC key configured — an operator fault, not a caller fault. */
	| 'missing_secret'
	/** Signature header absent or empty. */
	| 'missing_signature'
	/** `sha1=` / `md5=` — unsupported algorithm, never downgraded. */
	| 'unsupported_algorithm'
	/** Not `<alg>=<64 hex>` — cannot even be decoded. */
	| 'malformed_signature'
	/** Timestamp header absent or empty. */
	| 'missing_timestamp'
	/** Timestamp is not an integer number of seconds. */
	| 'malformed_timestamp'
	/** Older than the freshness window. */
	| 'stale_timestamp'
	/** Ahead of the freshness window (clock skew or forged stamp). */
	| 'future_timestamp'
	/** Well-formed but does not match — forged or tampered payload. */
	| 'signature_mismatch'
	/** Delivery id absent while a replay guard is configured. */
	| 'missing_delivery_id'
	/** Delivery id already processed. */
	| 'replayed_delivery';

export interface WebhookAcceptance {
	accepted: true;
	/** Delivery id as sent (may be undefined when no guard is used). */
	deliveryId: string | undefined;
	/** Unix seconds the signature was computed over. */
	timestamp: string;
	/** True when a replay guard actually ran for this delivery. */
	replayChecked: boolean;
}

export interface WebhookRejection {
	accepted: false;
	reason: WebhookRejectionReason;
	/**
	 * The status a route MUST return for this reason.
	 *
	 * Authentication failures share one status so a caller cannot use
	 * the response to tell "wrong secret" from "wrong body" — that
	 * difference is an oracle. `missing_secret` is separated because it
	 * is our own configuration fault and must page an operator instead
	 * of looking like a rejected caller.
	 */
	status: 400 | 401 | 409 | 500;
}

export type WebhookVerificationResult = WebhookAcceptance | WebhookRejection;

const STATUS_BY_REASON: Record<WebhookRejectionReason, WebhookRejection['status']> = {
	missing_secret: 500,
	missing_signature: 401,
	unsupported_algorithm: 401,
	malformed_signature: 401,
	missing_timestamp: 401,
	malformed_timestamp: 401,
	stale_timestamp: 401,
	future_timestamp: 401,
	signature_mismatch: 401,
	missing_delivery_id: 400,
	replayed_delivery: 409,
};

/** Exposed so a route / report can print the canonical status table. */
export function webhookRejectionStatus(reason: WebhookRejectionReason): number {
	return STATUS_BY_REASON[reason];
}

function reject(reason: WebhookRejectionReason): WebhookRejection {
	return { accepted: false, reason, status: STATUS_BY_REASON[reason] };
}

export interface VerifyWebhookOptions {
	/** Headers of the inbound request. */
	headers: WebhookHeaderSource;
	/**
	 * Raw request body, byte-exact.
	 *
	 * A re-serialized `JSON.stringify(await c.req.json())` is NOT
	 * equivalent — key order and whitespace change the bytes and the
	 * signature. Handlers must pass `await c.req.text()`.
	 */
	body: string;
	/** HMAC key from the secret store. Empty/undefined is a fault. */
	secret: string | undefined;
	/** Epoch milliseconds; injected so tests never depend on the clock. */
	nowMs?: number;
	/** Freshness window in seconds (default {@link DEFAULT_TOLERANCE_SECONDS}). */
	toleranceSeconds?: number;
	/** Optional replay de-duplication. */
	replayGuard?: WebhookReplayGuard;
	/** Override the delivery-id TTL (tests shrink it to prove expiry). */
	replayTtlMs?: number;
	/** Header names (default {@link GITHUB_WEBHOOK_SCHEME}). */
	scheme?: WebhookSignatureScheme;
}

const HEX_SIGNATURE = /^[0-9a-f]{64}$/;
const NUMERIC_TIMESTAMP = /^\d{1,15}$/;

const encoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
	// Backed by an explicit ArrayBuffer (not the default pooled one) so
	// the value satisfies Web Crypto's `BufferSource` signature under
	// `lib.dom` — a plain `Uint8Array` is `ArrayBufferLike` and is
	// rejected there.
	const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
	for (let i = 0; i < bytes.length; i += 1) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

/**
 * `sha256=<hex>` HMAC of `"<timestamp>.<body>"` under `secret`.
 *
 * Exported so a fixture (or a local sender in a fixture-driven test)
 * can produce the header value the adapter expects — the signing and
 * verifying sides must not drift apart, and the whole point of the
 * contract test is that they do not.
 */
export async function signWebhookPayload(input: {
	secret: string;
	timestamp: string;
	body: string;
}): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(input.secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const mac = await crypto.subtle.sign(
		'HMAC',
		key,
		encoder.encode(`${input.timestamp}.${input.body}`),
	);
	const hex = Array.from(new Uint8Array(mac))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
	return `${SUPPORTED_ALGORITHM}=${hex}`;
}

/**
 * Verify one inbound delivery. Pure: no binding, no network, no
 * storage beyond the injected replay guard.
 *
 * Check order is part of the contract, because the *first* failing
 * check is the reported reason:
 *
 *   1. secret present            → `missing_secret` (500)
 *   2. signature header present  → `missing_signature`
 *   3. `sha256=` + 64 hex digits  → `unsupported_algorithm` / `malformed_signature`
 *   4. timestamp present + numeric→ `missing_timestamp` / `malformed_timestamp`
 *   5. inside freshness window    → `stale_timestamp` / `future_timestamp`
 *   6. HMAC matches               → `signature_mismatch`
 *   7. delivery claimed           → `missing_delivery_id` / `replayed_delivery`
 *
 * Replay comes **last** on purpose. Claiming the delivery id before
 * the HMAC matched would let anyone burn an id with a forged request
 * and lock the sender's legitimate retry out — turning an unauthenticated
 * caller into a denial of service.
 */
export async function verifyWebhookDelivery(
	options: VerifyWebhookOptions,
): Promise<WebhookVerificationResult> {
	const scheme = options.scheme ?? GITHUB_WEBHOOK_SCHEME;
	const { headers, body } = options;

	if (!options.secret) return reject('missing_secret');

	const rawSignature = readHeader(headers, scheme.signatureHeader)?.trim();
	if (!rawSignature) return reject('missing_signature');

	const separator = rawSignature.indexOf('=');
	if (separator < 0) return reject('malformed_signature');
	const algorithm = rawSignature.slice(0, separator);
	if (algorithm !== SUPPORTED_ALGORITHM) return reject('unsupported_algorithm');
	const digest = rawSignature.slice(separator + 1);
	if (!HEX_SIGNATURE.test(digest)) return reject('malformed_signature');

	const rawTimestamp = readHeader(headers, scheme.timestampHeader)?.trim();
	if (!rawTimestamp) return reject('missing_timestamp');
	if (!NUMERIC_TIMESTAMP.test(rawTimestamp)) return reject('malformed_timestamp');

	const toleranceSeconds = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
	const nowMs = options.nowMs ?? Date.now();
	const timestampMs = Number(rawTimestamp) * 1000;
	const skewSeconds = (nowMs - timestampMs) / 1000;
	if (skewSeconds > toleranceSeconds) return reject('stale_timestamp');
	if (-skewSeconds > toleranceSeconds) return reject('future_timestamp');

	// `crypto.subtle.verify` compares in constant time. A `!==` on the
	// hex strings would leak how many leading characters an attacker
	// guessed correctly, which is exactly the oracle HMAC is meant to
	// remove.
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(options.secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['verify'],
	);
	const valid = await crypto.subtle.verify(
		'HMAC',
		key,
		hexToBytes(digest),
		encoder.encode(`${rawTimestamp}.${body}`),
	);
	if (!valid) return reject('signature_mismatch');

	if (!options.replayGuard) {
		return { accepted: true, deliveryId: undefined, timestamp: rawTimestamp, replayChecked: false };
	}

	const deliveryId = readHeader(headers, scheme.deliveryHeader)?.trim();
	if (!deliveryId) return reject('missing_delivery_id');
	const claimed = await options.replayGuard.claim(deliveryId, {
		nowMs,
		ttlMs: options.replayTtlMs ?? DEFAULT_REPLAY_TTL_MS,
	});
	if (!claimed) return reject('replayed_delivery');

	return { accepted: true, deliveryId, timestamp: rawTimestamp, replayChecked: true };
}
