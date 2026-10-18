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
 *   2. Is it recent (freshness window)?
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
 * Why there are two schemes
 * -------------------------
 * Senders disagree about *what is signed*, and conflating the two is
 * how an adapter ends up rejecting every real delivery of its own
 * sender:
 *
 *   - GitHub signs the **raw body alone** and puts the digest in
 *     `X-Hub-Signature-256`. A GitHub delivery carries no timestamp
 *     header at all (`X-Hub-Request-Timestamp` is not part of the
 *     documented delivery headers), so a `"<timestamp>.<body>"`
 *     check rejects 100 % of real GitHub traffic as
 *     `missing_timestamp`, and re-stamping is not detectable because
 *     there is nothing timestamped to re-stamp.
 *   - Other senders sign `"<timestamp>.<raw body>"`, which puts the
 *     timestamp inside the MAC and makes a re-stamped captured
 *     payload fail on its own.
 *
 * So the scheme states which material the sender signs
 * ({@link WebhookSignedMaterial}) instead of assuming one shape, and
 * {@link GITHUB_WEBHOOK_SCHEME} is GitHub's, exactly. The freshness
 * question is answered where the sender lets it be answered: from the
 * signed timestamp when there is one, otherwise by the delivery-id
 * claim window — which is why a `body-only` sender is refused unless a
 * replay guard is configured (`replay_guard_required`).
 *
 * Runtime shape
 * -------------
 * No Cloudflare binding, no import of `Env`, Web Crypto only. That
 * keeps the contract testable as a pure function and keeps the
 * adapter from becoming a hidden dependency of the Worker entry.
 */

/**
 * What the sender puts inside the HMAC.
 *
 * - `body-only` — the raw body, nothing else. GitHub.
 * - `timestamped-body` — `"<timestamp>.<raw body>"`.
 */
export type WebhookSignedMaterial = 'body-only' | 'timestamped-body';

/**
 * Header names for the signature scheme.
 *
 * Header lookup is case-insensitive (`Headers` is; the record path
 * lower-cases). The two shapes are discriminated on `signedMaterial`
 * so a `body-only` scheme cannot quietly ship a `timestampHeader`
 * that nothing reads.
 */
export type WebhookSignatureScheme =
	| {
			/** `sha256=<hex>` HMAC header. */
			signatureHeader: string;
			/** Sender-assigned delivery id used for replay de-duplication. */
			deliveryHeader: string;
			/** HMAC over the raw body alone. */
			signedMaterial: 'body-only';
	  }
	| {
			signatureHeader: string;
			deliveryHeader: string;
			/** HMAC over `"<timestamp>.<raw body>"`. */
			signedMaterial: 'timestamped-body';
			/** Unix **seconds** that is part of the signed material. */
			timestampHeader: string;
	  };

/**
 * GitHub's documented scheme — the default.
 *
 * `X-Hub-Signature-256` is `sha256=<hex>` HMAC-SHA256 of the raw
 * request body. There is no timestamp header in a GitHub delivery, so
 * freshness is bounded by the replay claim window instead.
 */
export const GITHUB_WEBHOOK_SCHEME = {
	signatureHeader: 'x-hub-signature-256',
	deliveryHeader: 'x-github-delivery',
	signedMaterial: 'body-only',
} satisfies WebhookSignatureScheme;

/**
 * Generic `timestamped-body` scheme, for a sender that signs
 * `"<timestamp>.<raw body>"` (a CMS, or any sender modelled on the
 * Stripe-style scheme). Header names are placeholders — a promoted
 * route names the sender's real headers.
 */
export const TIMESTAMPED_WEBHOOK_SCHEME = {
	signatureHeader: 'x-webhook-signature',
	timestampHeader: 'x-webhook-timestamp',
	deliveryHeader: 'x-webhook-delivery',
	signedMaterial: 'timestamped-body',
} satisfies WebhookSignatureScheme;

/** The timestamp header of a `timestamped-body` scheme, else `undefined`. */
export function schemeTimestampHeader(scheme: WebhookSignatureScheme): string | undefined {
	return scheme.signedMaterial === 'timestamped-body' ? scheme.timestampHeader : undefined;
}

/** The only algorithm this adapter accepts (`sha1=` is rejected). */
export const SUPPORTED_ALGORITHM = 'sha256';

/** Freshness window in seconds. GitHub documents 5 minutes. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Claim TTL for a given freshness window.
 *
 * It must be **derived from the window**, not fixed: a fixed TTL is
 * only correct for the default window. Set the window to an hour and
 * a 660 s claim dies at 11 minutes, so a byte-identical retry of a
 * delivery that is still inside its freshness window is accepted as a
 * new delivery and the replay guarantee is quietly gone. Two windows
 * of headroom cover clock drift on both ends.
 */
export function webhookReplayTtlMs(toleranceSeconds: number): number {
	return (toleranceSeconds * 2 + 60) * 1000;
}

/** Claim TTL implied by {@link DEFAULT_TOLERANCE_SECONDS}. */
export const DEFAULT_REPLAY_TTL_MS = webhookReplayTtlMs(DEFAULT_TOLERANCE_SECONDS);

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
	/**
	 * `replayTtlMs` shorter than the freshness window — an operator
	 * fault. Refused instead of clamped, so the mistake is visible.
	 */
	| 'invalid_replay_ttl'
	/**
	 * A `body-only` sender (GitHub) with no replay guard. Its signature
	 * covers no timestamp, so the claim window is the only freshness
	 * bound; without it a captured body is replayable forever.
	 */
	| 'replay_guard_required'
	/** Signature header absent or empty. */
	| 'missing_signature'
	/** `sha1=` / `md5=` — unsupported algorithm, never downgraded. */
	| 'unsupported_algorithm'
	/** Not `<alg>=<64 hex>` — cannot even be decoded. */
	| 'malformed_signature'
	/** Timestamp header absent or empty (`timestamped-body` only). */
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
	/**
	 * Unix seconds the signature was computed over.
	 *
	 * `undefined` for a `body-only` sender: it signs no timestamp, so
	 * there is nothing to report. Do not substitute the arrival time —
	 * that would read as if the delivery were fresh.
	 */
	timestamp: string | undefined;
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
	 * of looking like a rejected caller; so are `invalid_replay_ttl`
	 * and `replay_guard_required`, which are configuration faults in
	 * the same sense.
	 */
	status: 400 | 401 | 409 | 500;
}

export type WebhookVerificationResult = WebhookAcceptance | WebhookRejection;

const STATUS_BY_REASON: Record<WebhookRejectionReason, WebhookRejection['status']> = {
	missing_secret: 500,
	invalid_replay_ttl: 500,
	replay_guard_required: 500,
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
	 *
	 * `string` is exact for UTF-8 payloads. A body that is not UTF-8
	 * has already been mangled by `c.req.text()` (U+FFFD), which fails
	 * closed rather than passing; a promoted route that must accept
	 * binary payloads should pass an `ArrayBuffer` here instead — the
	 * HMAC path is byte-oriented, only this convenience is not.
	 */
	body: string;
	/** HMAC key from the secret store. Empty/undefined is a fault. */
	secret: string | undefined;
	/** Epoch milliseconds; injected so tests never depend on the clock. */
	nowMs?: number;
	/** Freshness window in seconds (default {@link DEFAULT_TOLERANCE_SECONDS}). */
	toleranceSeconds?: number;
	/** Optional replay de-duplication; required for a `body-only` scheme. */
	replayGuard?: WebhookReplayGuard;
	/**
	 * Override the delivery-id TTL (tests shrink it to prove expiry).
	 *
	 * Must not be shorter than `toleranceSeconds`; the adapter refuses
	 * `invalid_replay_ttl` rather than silently accepting a claim
	 * window that outlives nothing.
	 */
	replayTtlMs?: number;
	/** Header names and signed material (default {@link GITHUB_WEBHOOK_SCHEME}). */
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
 * The bytes a sender actually signed.
 *
 * `body-only` sends the raw body; `timestamped-body` prefixes it with
 * `<timestamp>.`. Both sides of the contract — {@link signWebhookPayload}
 * and {@link verifyWebhookDelivery} — go through this one function, so
 * signing and verification cannot drift apart.
 */
export function webhookSignedMaterial(
	scheme: WebhookSignatureScheme,
	timestamp: string | undefined,
	body: string,
): string {
	return scheme.signedMaterial === 'body-only' ? body : `${timestamp}.${body}`;
}

/**
 * `sha256=<hex>` HMAC of {@link webhookSignedMaterial} under `secret`.
 *
 * Exported so a fixture (or a local sender in a fixture-driven test)
 * can produce the header value the adapter expects — the signing and
 * verifying sides must not drift apart, and the whole point of the
 * contract test is that they do not.
 */
export async function signWebhookPayload(input: {
	secret: string;
	body: string;
	/** Unix seconds; required by — and part of — a `timestamped-body` scheme. */
	timestamp?: string;
	/** Defaults to {@link GITHUB_WEBHOOK_SCHEME} (body-only). */
	scheme?: WebhookSignatureScheme;
}): Promise<string> {
	const scheme = input.scheme ?? GITHUB_WEBHOOK_SCHEME;
	if (scheme.signedMaterial === 'timestamped-body' && input.timestamp === undefined) {
		// A signing-side programmer fault, never reachable from a
		// request: fail loudly instead of signing `undefined.<body>`.
		throw new TypeError('signWebhookPayload: a timestamped-body scheme needs `timestamp`');
	}
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
		encoder.encode(webhookSignedMaterial(scheme, input.timestamp, input.body)),
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
 *   1. secret present                       → `missing_secret` (500)
 *   2. claim window covers the freshness window → `invalid_replay_ttl` (500)
 *   3. `body-only` sender has a replay guard  → `replay_guard_required` (500)
 *   4. signature header present             → `missing_signature`
 *   5. `sha256=` + 64 hex digits             → `unsupported_algorithm` / `malformed_signature`
 *   6. timestamp present + numeric           → `missing_timestamp` / `malformed_timestamp` (timestamped-body only)
 *   7. inside freshness window               → `stale_timestamp` / `future_timestamp` (timestamped-body only)
 *   8. HMAC matches                          → `signature_mismatch`
 *   9. delivery claimed                      → `missing_delivery_id` / `replayed_delivery`
 *
 * Steps 1-3 are our own configuration, not the caller's fault, so
 * they are checked before anything an unauthenticated caller controls
 * and all three map to `500`.
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

	const nowMs = options.nowMs ?? Date.now();
	const toleranceSeconds = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
	const toleranceMs = toleranceSeconds * 1000;
	const replayTtlMs = options.replayTtlMs ?? webhookReplayTtlMs(toleranceSeconds);
	// A claim that dies before the freshness window closes turns the
	// sender's in-window retry into an accepted "new" delivery. Refuse
	// the misconfiguration rather than silently widening the window.
	if (replayTtlMs < toleranceMs) return reject('invalid_replay_ttl');
	// GitHub signs no timestamp, so the claim window is the only thing
	// bounding how long a captured body stays acceptable. No guard, no
	// freshness — refuse instead of verifying the signature alone.
	if (scheme.signedMaterial === 'body-only' && !options.replayGuard) {
		return reject('replay_guard_required');
	}

	const rawSignature = readHeader(headers, scheme.signatureHeader)?.trim();
	if (!rawSignature) return reject('missing_signature');

	const separator = rawSignature.indexOf('=');
	if (separator < 0) return reject('malformed_signature');
	const algorithm = rawSignature.slice(0, separator);
	if (algorithm !== SUPPORTED_ALGORITHM) return reject('unsupported_algorithm');
	const digest = rawSignature.slice(separator + 1);
	if (!HEX_SIGNATURE.test(digest)) return reject('malformed_signature');

	const timestampHeader = schemeTimestampHeader(scheme);
	let rawTimestamp: string | undefined;
	if (timestampHeader) {
		rawTimestamp = readHeader(headers, timestampHeader)?.trim();
		if (!rawTimestamp) return reject('missing_timestamp');
		if (!NUMERIC_TIMESTAMP.test(rawTimestamp)) return reject('malformed_timestamp');

		const skewSeconds = (nowMs - Number(rawTimestamp) * 1000) / 1000;
		if (skewSeconds > toleranceSeconds) return reject('stale_timestamp');
		if (-skewSeconds > toleranceSeconds) return reject('future_timestamp');
	}

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
		encoder.encode(webhookSignedMaterial(scheme, rawTimestamp, body)),
	);
	if (!valid) return reject('signature_mismatch');

	if (!options.replayGuard) {
		return {
			accepted: true,
			deliveryId: undefined,
			timestamp: rawTimestamp,
			replayChecked: false,
		};
	}

	const deliveryId = readHeader(headers, scheme.deliveryHeader)?.trim();
	if (!deliveryId) return reject('missing_delivery_id');
	const claimed = await options.replayGuard.claim(deliveryId, { nowMs, ttlMs: replayTtlMs });
	if (!claimed) return reject('replayed_delivery');

	return { accepted: true, deliveryId, timestamp: rawTimestamp, replayChecked: true };
}
