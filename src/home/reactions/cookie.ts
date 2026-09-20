/**
 * Visitor identity cookie for the home surface — `mw_actor_id`.
 *
 * One anonymous, opaque, HttpOnly visitor identifier per browser. Used
 * by the home reactions widget (`src/home/reactions/widget.tsx`) and
 * the home access counter (`src/home/access/load.ts`) as the
 * `actor_id` / `session_id` field on external-boundary PUT/DELETE
 * calls so per-visitor dedup at the API is possible without leaking
 * the visitor's identity.
 *
 * Privacy:
 *   - 32 hex characters (no dashes, no version bits). The value is
 *     purely random — it carries no information about the visitor,
 *     the browser, or the network.
 *   - `HttpOnly` so client-side scripts cannot read it.
 *   - `SameSite=Lax` so cross-site GETs do not include it.
 *   - `Secure` is conditional on the request scheme (HTTPS in
 *     production; HTTP in local dev so `wrangler dev` still works).
 *   - `Path=/` so every page on the deployment can read it.
 *
 * Out of scope: consent-management, cross-domain sharing,
 * fingerprinting. Per the privacy notice in
 * `src/home/footer.tsx`, this cookie is anonymous and falls under
 * the JP Cookie Policy "minimal impact" / EU ePrivacy "anonymous"
 * exemptions.
 */

export const ACTOR_COOKIE_NAME = 'mw_actor_id';

/** Length of the random actor id, in hex chars (16 random bytes). */
export const ACTOR_COOKIE_VALUE_LEN = 32;

/** Cookie lifetime — one year, matching JP "anonymous cookie" guidance. */
export const ACTOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Parse the actor id from a `Cookie` request header. Returns `null`
 * when the cookie is absent or malformed (non-hex / wrong length).
 *
 * Pure helper — does not mutate anything.
 */
export function readActorIdFromCookieHeader(
	cookieHeader: string | null | undefined,
): string | null {
	if (!cookieHeader) return null;
	for (const segment of cookieHeader.split(';')) {
		const trimmed = segment.trim();
		const eq = trimmed.indexOf('=');
		if (eq < 0) continue;
		const name = trimmed.slice(0, eq);
		if (name !== ACTOR_COOKIE_NAME) continue;
		const value = trimmed.slice(eq + 1);
		if (!isWellFormedActorId(value)) return null;
		return value;
	}
	return null;
}

/**
 * Generate a fresh actor id. Pure (modulo `crypto.randomUUID`) — the
 * value is random and carries no information.
 */
export function generateActorId(): string {
	// `crypto.randomUUID()` is 36 chars including 4 dashes; stripping
	// dashes yields 32 lowercase hex chars. We do not need RFC-4122
	// semantics — only stable, opaque, 32-hex identity.
	return crypto.randomUUID().replace(/-/g, '');
}

/**
 * Build the `Set-Cookie` header value for a freshly-issued actor id.
 *
 * `secure` is passed in by the caller (the server-fn knows whether the
 * incoming request was HTTP or HTTPS) — we don't introspect the
 * request here because this helper is also useful in tests.
 */
export function buildActorCookieSetHeader(value: string, secure: boolean): string {
	const parts = [
		`${ACTOR_COOKIE_NAME}=${value}`,
		`Max-Age=${ACTOR_COOKIE_MAX_AGE_SECONDS}`,
		'Path=/',
		'HttpOnly',
		'SameSite=Lax',
	];
	if (secure) parts.push('Secure');
	return parts.join('; ');
}

/**
 * Validate a candidate actor id without generating a new one. Used by
 * the reactions API's `validateActorId` shape contract — keeps the
 * home cookie module self-consistent (same regex everywhere).
 */
export function isWellFormedActorId(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}
