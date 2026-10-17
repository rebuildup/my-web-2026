/**
 * Session cookie attribute contract (Issue #438).
 *
 * What this owns
 * --------------
 * The attribute contract of the cookies Better Auth sets on a
 * successful sign-in, expressed twice: as data
 * (`SESSION_COOKIE_RULES`) and as an evaluator
 * (`evaluateSessionCookies`). It lives beside `better-auth.ts` because
 * the options in that module are the only thing that decides these
 * attributes — the contract is a projection of the auth
 * configuration, not an independent HTTP concern.
 *
 * Why the contract exists
 * -----------------------
 * ADR-0009 pinned the auth foundation's *routing* contract
 * (`basePath: '/api/v1/auth'`) and its *credential* contract
 * (sign-up disabled, 30-day sessions). Nothing pinned the attributes
 * of the cookies the deployed Worker actually emits. A Better Auth
 * upgrade, or an edit to `advanced.defaultCookieAttributes`, could
 * drop `HttpOnly`, widen `SameSite`, add a `Domain`, or stop emitting
 * the `__Secure-` name prefix with nothing failing. Those are exactly
 * the regressions OWASP ASVS V2 (Authentication) and V3 (Session
 * Management) treat as cookie-tossing / session-fixation exposure, and
 * they are invisible in review because the diff is in a dependency.
 *
 * Two profiles, no environment reads
 * ----------------------------------
 * Better Auth derives both the `Secure` attribute and the `__Secure-`
 * name prefix from the resolved base URL — see `createCookieGetter` in
 * `better-auth/dist/cookies/index.mjs`: an `https://` base URL yields
 * `Secure` + prefix, a plain-`http` one yields neither. So the
 * contract is evaluated against an explicit profile instead of
 * hard-coding one origin:
 *
 *   - `https` — the canonical production origin.
 *     `wrangler.production.jsonc#vars.BETTER_AUTH_URL` pins
 *     `https://rebuildup.dev` (ADR-0014) and
 *     `scripts/check-cloudflare-contract.mjs --build` proves the built
 *     Worker carries that value. This profile REQUIRES `Secure` and
 *     the `__Secure-` prefix.
 *   - `http` — local development and the workerd test pool, where no
 *     origin is pinned (`vitest.config.ts` deliberately leaves
 *     `BETTER_AUTH_URL` unbound). `Secure` is a VIOLATION there: a
 *     browser on a plain-http origin that is not localhost drops a
 *     `Secure` cookie, and every subsequent request comes back
 *     unauthenticated with no error anywhere.
 *
 * Nothing in this module reads an env var, sends a request, or imports
 * Better Auth. It is a pure evaluator over `Set-Cookie` strings, which
 * is what lets a forged fixture and a real Worker response be judged
 * by the same code path.
 *
 * Secret / PII invariant
 * ----------------------
 * A session token is credential material, and the compact cookie cache
 * (`session_data`) carries a signed copy of the user record — id,
 * role, email. The parsed shape therefore has nowhere to put a cookie
 * *value*: `parseSetCookie` drops it at parse time and
 * `SessionCookieObservation` has no field for one. A report can
 * therefore be logged, attached to a CI artefact, or rendered into a
 * verification screenshot without leaking either. That property is
 * asserted in `session-cookie-contract.test.ts`, not just documented.
 */

/**
 * RFC 6265bis §4.1.3.1 cookie-name prefix for cookies that carry the
 * `Secure` attribute. Better Auth emits exactly this prefix (never
 * `__Host-`), so the contract pins the one it actually uses.
 */
export const SECURE_COOKIE_PREFIX = '__Secure-';

export type SessionCookieProfileId = 'https' | 'http';

export interface SessionCookieProfile {
	/** `https` (production) or `http` (local dev / workerd pool). */
	readonly id: SessionCookieProfileId;
	/** `Secure` must be present (`true`) or absent (`false`). */
	readonly secure: boolean;
	/** Required cookie-name prefix (`''` in the http profile). */
	readonly namePrefix: string;
	/**
	 * Human-readable profile label for reports. Callers must keep this
	 * free of credentials; the production origin is public (ADR-0014)
	 * but the label is presentation, not an input to the evaluation.
	 */
	readonly label: string;
}

/**
 * Project policy for one session cookie. `suffix` is the cookie name
 * without the `__Secure-` prefix, i.e. Better Auth's
 * `advanced.cookiePrefix` default (`better-auth`) joined to its
 * internal cookie name.
 */
export interface SessionCookieRule {
	readonly suffix: string;
	/** Whether a response under test must carry this cookie at all. */
	readonly required: boolean;
	/** Expected `Max-Age` in seconds; mirrors the configured expiry. */
	readonly maxAgeSeconds: number;
	/** What the cookie carries — documentation, never an assertion. */
	readonly contains: 'credential' | 'session-metadata';
}

/**
 * The cookies a successful sign-in sets.
 *
 * `maxAgeSeconds` mirrors `src/cloudflare/auth/better-auth.ts`:
 * `session.expiresIn` = 30 days for the token,
 * `session.cookieCache.maxAge` = 5 min for the metadata cache. A
 * drift between those options and this table fails the contract test,
 * which is the point: an unannounced session-lifetime change should be
 * a reviewed change.
 */
export const SESSION_COOKIE_RULES: readonly SessionCookieRule[] = [
	{
		suffix: 'session_token',
		required: true,
		maxAgeSeconds: 60 * 60 * 24 * 30,
		contains: 'credential',
	},
	{
		// Optional because the contract must also hold if the cookie
		// cache is ever turned off (`cookieCache.enabled: false`); the
		// test additionally asserts it IS present today, which pins
		// the current configuration separately from the policy.
		suffix: 'session_data',
		required: false,
		maxAgeSeconds: 5 * 60,
		contains: 'session-metadata',
	},
];

/**
 * Stable violation codes. Tests and verification reports assert on
 * these, so they are part of the contract, not log prose.
 */
export type SessionCookieViolationCode =
	| 'session-cookie-missing'
	| 'http-only-missing'
	| 'secure-missing'
	| 'secure-unexpected'
	| 'prefix-missing'
	| 'prefix-unexpected'
	| 'same-site-missing'
	| 'same-site-unexpected'
	| 'path-missing'
	| 'path-unexpected'
	| 'domain-unexpected'
	| 'max-age-missing'
	| 'max-age-unexpected';

export interface SessionCookieViolation {
	readonly code: SessionCookieViolationCode;
	/** Cookie name the violation belongs to, or `null` when global. */
	readonly cookie: string | null;
	/** Value-free explanation. Never contains a cookie value. */
	readonly message: string;
}

/** Whitelisted attributes only; a cookie value has no field here. */
export interface SessionCookieAttributes {
	readonly secure: boolean;
	readonly httpOnly: boolean;
	/** Lower-cased: `Lax` on the wire, `lax` in Better Auth's options. */
	readonly sameSite: string | null;
	readonly path: string | null;
	readonly domain: string | null;
	readonly maxAge: number | null;
}

export interface SessionCookieObservation {
	readonly name: string;
	/** `SESSION_COOKIE_RULES` entry this cookie was matched against. */
	readonly rule: string;
	readonly attributes: SessionCookieAttributes;
	readonly violations: readonly SessionCookieViolation[];
}

export interface SessionCookieContractReport {
	readonly profile: SessionCookieProfile;
	readonly cookies: readonly SessionCookieObservation[];
	readonly violations: readonly SessionCookieViolation[];
	readonly ok: boolean;
}

/** A parsed `Set-Cookie` field. Deliberately has no `value` member. */
interface ParsedSetCookie {
	readonly name: string;
	readonly attributes: ReadonlyMap<string, string | true>;
}

/**
 * Derive the profile Better Auth will actually use for a base URL.
 *
 * This mirrors the one upstream inference that matters here
 * (`createCookieGetter` in `better-auth/dist/cookies/index.mjs`):
 * an `https://` base URL turns on `Secure` and the `__Secure-` prefix,
 * anything else leaves both off. `undefined` models the local workerd
 * pool, where `BETTER_AUTH_URL` is deliberately unbound so the test
 * pool exercises the "no pinned origin" branch.
 */
export function sessionCookieProfileFor(
	baseUrl: string | undefined,
	label: string,
): SessionCookieProfile {
	const secure = typeof baseUrl === 'string' && baseUrl.trim().startsWith('https://');
	return {
		id: secure ? 'https' : 'http',
		secure,
		namePrefix: secure ? SECURE_COOKIE_PREFIX : '',
		label,
	};
}

/**
 * Split a possibly-joined `Set-Cookie` header into one string per
 * cookie. The split only happens on a comma that begins a new
 * `name=value` pair, so an `Expires=Wed, 21 Oct ...` date is never
 * mistaken for a cookie boundary.
 */
export function splitSetCookieHeader(joined: string): string[] {
	return joined.split(/,\s*(?=[^;,=\s]+=)/);
}

/**
 * Read every `Set-Cookie` header of a response as separate strings.
 * Prefers `Headers.getSetCookie()`; older runtimes get the joined
 * header split by `splitSetCookieHeader`.
 */
export function readSetCookieHeaders(headers: Headers): string[] {
	if (typeof headers.getSetCookie === 'function') {
		return headers.getSetCookie();
	}
	const joined = headers.get('set-cookie');
	if (!joined) return [];
	return splitSetCookieHeader(joined);
}

/**
 * Parse ONE `Set-Cookie` string. The value is dropped here and cannot
 * be recovered from the result — see the secret / PII invariant in
 * the module header.
 */
export function parseSetCookie(setCookie: string): ParsedSetCookie | null {
	const segments = setCookie.split(';');
	const first = segments[0] ?? '';
	const eq = first.indexOf('=');
	if (eq <= 0) return null;
	const name = first.slice(0, eq).trim();
	if (name.length === 0) return null;

	const attributes = new Map<string, string | true>();
	for (const segment of segments.slice(1)) {
		const trimmed = segment.trim();
		if (trimmed.length === 0) continue;
		const attrEq = trimmed.indexOf('=');
		if (attrEq === -1) {
			attributes.set(trimmed.toLowerCase(), true);
			continue;
		}
		const attrName = trimmed.slice(0, attrEq).trim().toLowerCase();
		const attrValue = trimmed
			.slice(attrEq + 1)
			.trim()
			.replace(/^"(.*)"$/, '$1');
		attributes.set(attrName, attrValue);
	}
	return { name, attributes };
}

function stripSecurePrefix(name: string): string {
	return name.startsWith(SECURE_COOKIE_PREFIX) ? name.slice(SECURE_COOKIE_PREFIX.length) : name;
}

/**
 * A cookie belongs to a rule when its name (secure prefix stripped) is
 * the rule suffix, optionally behind Better Auth's `cookiePrefix`
 * (`better-auth.session_token`), optionally followed by a chunk index
 * — Better Auth chunks oversized cookie-cache payloads that way
 * (`better-auth.session_data.0`), and an unvalidated chunk would be a
 * silent hole in the contract.
 */
const RULE_MATCHERS: ReadonlyMap<string, RegExp> = new Map(
	SESSION_COOKIE_RULES.map((rule) => [
		rule.suffix,
		new RegExp(`(^|\\.)${rule.suffix.replaceAll('.', '\\.')}(\\.\\d+)?$`),
	]),
);

function matchesRule(strippedName: string, rule: SessionCookieRule): boolean {
	return RULE_MATCHERS.get(rule.suffix)?.test(strippedName) === true;
}

function readStringAttribute(
	attributes: ReadonlyMap<string, string | true>,
	key: string,
): string | null {
	const raw = attributes.get(key);
	if (raw === undefined || raw === true) return null;
	return raw.length > 0 ? raw : null;
}

function readMaxAge(attributes: ReadonlyMap<string, string | true>): number | null {
	const raw = readStringAttribute(attributes, 'max-age');
	if (raw === null || !/^\d+$/.test(raw)) return null;
	return Number(raw);
}

/**
 * Valueless attributes are `Secure` / `HttpOnly`, so presence IS the
 * value — a bare `HttpOnly` and `HttpOnly=` parse the same way here.
 */
function readFlags(attributes: ReadonlyMap<string, string | true>): {
	secure: boolean;
	httpOnly: boolean;
} {
	return {
		secure: attributes.has('secure'),
		httpOnly: attributes.has('httponly'),
	};
}

/**
 * Evaluate `Set-Cookie` strings against the session cookie policy.
 *
 * Pure: no env, no request, no Better Auth import. That is what makes
 * the negative fixtures meaningful — a forged header and a real
 * Worker response travel the identical code path, so a fixture that
 * "fails" is evidence about this evaluator, not about a mock.
 */
export function evaluateSessionCookies(
	setCookies: readonly string[],
	profile: SessionCookieProfile,
): SessionCookieContractReport {
	const parsed = setCookies
		.map((raw) => parseSetCookie(raw))
		.filter((cookie): cookie is ParsedSetCookie => cookie !== null);

	const observations: SessionCookieObservation[] = [];
	const violations: SessionCookieViolation[] = [];

	for (const rule of SESSION_COOKIE_RULES) {
		const matched = parsed.filter((cookie) => matchesRule(stripSecurePrefix(cookie.name), rule));
		if (matched.length === 0) {
			if (rule.required) {
				violations.push({
					code: 'session-cookie-missing',
					cookie: null,
					message: `no ${rule.suffix} cookie was set; a session response must carry it`,
				});
			}
			continue;
		}

		for (const cookie of matched) {
			const flags = readFlags(cookie.attributes);
			const cookieViolations: SessionCookieViolation[] = [];

			if (!flags.httpOnly) {
				cookieViolations.push({
					code: 'http-only-missing',
					cookie: cookie.name,
					message: `${cookie.name} must carry HttpOnly (the cookie carries ${rule.contains})`,
				});
			}

			if (profile.secure && !flags.secure) {
				cookieViolations.push({
					code: 'secure-missing',
					cookie: cookie.name,
					message: `${profile.label} requires the Secure attribute on ${cookie.name}`,
				});
			}
			if (!profile.secure && flags.secure) {
				cookieViolations.push({
					code: 'secure-unexpected',
					cookie: cookie.name,
					message: `${profile.label} must not mark ${cookie.name} Secure; a plain-http browser drops the cookie and every later request is unauthenticated`,
				});
			}

			if (profile.namePrefix.length > 0 && !cookie.name.startsWith(profile.namePrefix)) {
				cookieViolations.push({
					code: 'prefix-missing',
					cookie: cookie.name,
					message: `${profile.namePrefix} requires the ${SECURE_COOKIE_PREFIX} name prefix (RFC 6265bis 4.1.3.1)`,
				});
			}
			if (profile.namePrefix.length === 0 && cookie.name.startsWith(SECURE_COOKIE_PREFIX)) {
				cookieViolations.push({
					code: 'prefix-unexpected',
					cookie: cookie.name,
					message: `${SECURE_COOKIE_PREFIX} prefix requires the Secure attribute, which ${profile.label} does not set`,
				});
			}

			const sameSite = readStringAttribute(cookie.attributes, 'samesite');
			// Normalised to lower case: a real response serialises
			// `SameSite=Lax`, while Better Auth's own option value (used
			// by the production-shape fixture) is `lax`. Both are the
			// same policy, and the comparison below is case-insensitive.
			const sameSiteNormalized = sameSite?.toLowerCase() ?? null;
			if (sameSiteNormalized === null) {
				cookieViolations.push({
					code: 'same-site-missing',
					cookie: cookie.name,
					message: `${cookie.name} must declare SameSite=Lax`,
				});
			} else if (sameSiteNormalized !== 'lax') {
				cookieViolations.push({
					code: 'same-site-unexpected',
					cookie: cookie.name,
					message: `${cookie.name} declares SameSite=${sameSite}; the policy is Lax`,
				});
			}

			const path = readStringAttribute(cookie.attributes, 'path');
			if (path === null) {
				cookieViolations.push({
					code: 'path-missing',
					cookie: cookie.name,
					message: `${cookie.name} must declare Path=/`,
				});
			} else if (path !== '/') {
				cookieViolations.push({
					code: 'path-unexpected',
					cookie: cookie.name,
					message: `${cookie.name} is scoped to Path=${path}; a narrower scope silently drops the session on /admin and /api/v1 requests`,
				});
			}

			const domain = readStringAttribute(cookie.attributes, 'domain');
			if (domain !== null) {
				cookieViolations.push({
					code: 'domain-unexpected',
					cookie: cookie.name,
					message: `${cookie.name} must stay host-only (no Domain attribute); Domain=${domain} widens it to sibling subdomains`,
				});
			}

			const maxAge = readMaxAge(cookie.attributes);
			if (maxAge === null) {
				cookieViolations.push({
					code: 'max-age-missing',
					cookie: cookie.name,
					message: `${cookie.name} must declare Max-Age=${rule.maxAgeSeconds}`,
				});
			} else if (maxAge !== rule.maxAgeSeconds) {
				cookieViolations.push({
					code: 'max-age-unexpected',
					cookie: cookie.name,
					message: `${cookie.name} declares Max-Age=${maxAge}; the configured lifetime is ${rule.maxAgeSeconds}s`,
				});
			}

			observations.push({
				name: cookie.name,
				rule: rule.suffix,
				attributes: {
					secure: flags.secure,
					httpOnly: flags.httpOnly,
					sameSite: sameSiteNormalized,
					path,
					domain,
					maxAge,
				},
				violations: cookieViolations,
			});
			violations.push(...cookieViolations);
		}
	}

	return {
		profile,
		cookies: observations,
		violations,
		ok: violations.length === 0,
	};
}
