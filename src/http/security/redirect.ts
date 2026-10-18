/**
 * Open-redirect guard — classification of untrusted redirect targets
 * (Issue #454).
 *
 * Every `returnTo`-shaped value that crosses the external HTTP
 * boundary (`/api/v1/auth/*` today, `/oauth/*` and `/integrations/*`
 * when those surfaces exist) is attacker-controlled: it arrives in a
 * query string or a form / JSON body that anyone can craft. Feeding
 * one straight into `Location:` turns the site into an open redirect
 * ("log in at `rebuildup.dev`, land on `evil.example`"), which is the
 * phishing primitive behind most credential-harvesting links.
 *
 * The rule this module enforces is deliberately narrow:
 *
 *   **A redirect target is either an internal absolute path or
 *   nothing.**
 *
 * - Internal absolute path — starts with exactly one `/`, is not
 *   scheme-relative, and carries no scheme. Browsers resolve it
 *   against the current origin, so the user cannot leave the site.
 * - Same-origin absolute URL (`https://rebuildup.dev/admin`) — accepted
 *   only when the origin is in the caller-supplied `trustedOrigins`,
 *   and then *downgraded* to its path so downstream code only ever
 *   handles the internal form.
 * - Everything else — rejected, never rewritten. A rejection is
 *   always fail-closed: the caller falls back to a constant it owns.
 *
 * Rejection is a decision, not an exception: the caller decides
 * whether an invalid target is a `400` at an API boundary or a silent
 * fallback on a page.
 *
 * This module has **no imports** on purpose. It is pure string
 * classification so it can be unit-tested without workerd, reused by
 * the Hono middleware (`./redirect-guard.ts`) and by route loaders,
 * and copied into a report script without dragging the Worker graph
 * along.
 *
 * Encoding note: the target is percent-decoded until it stabilises
 * **before** the authority checks, and the *decoded* value is what
 * gets returned. A validator that only inspects the raw string can be
 * bypassed by any consumer that decodes later (`%2F%2Fevil.example`
 * is a path to the validator and an authority to the browser).
 * Better Auth applies the same rule for root-relative callback URLs
 * (see `isSafeRelativeURL` in `better-auth/dist/auth/trusted-origins.mjs`):
 * an encoded separator in the path is treated as hostile.
 */

/** Hard ceiling on the accepted target. `Location` headers beyond this
 *  are an attack surface, not a feature. */
export const MAX_REDIRECT_TARGET_LENGTH = 2048;

/**
 * Parameter / body-field names that carry a redirect target.
 *
 * Grouped by the surface that consumes them:
 *
 *   - `callbackURL`, `redirectTo`, `errorCallbackURL`,
 *     `newUserCallbackURL` — Better Auth's own post-auth redirect
 *     fields (validated by `originCheckMiddleware` against
 *     `trustedOrigins`; guarded here first, so the project does not
 *     depend on that list being non-empty).
 *   - `returnTo`, `return_to`, `next` — the project convention for
 *     "where the user was before they were asked to sign in"
 *     (`/admin/login?returnTo=/admin/keys`).
 *   - `redirect_uri` — the OAuth spelling, reserved for the `/oauth/*`
 *     boundary that does not exist yet (Issue #454 records the
 *     contract; the mount is left to the surface that owns it).
 */
export const REDIRECT_TARGET_PARAM_NAMES = [
	'callbackURL',
	'redirectTo',
	'errorCallbackURL',
	'newUserCallbackURL',
	'returnTo',
	'return_to',
	'next',
	'redirect_uri',
] as const;

export type RedirectTargetParamName = (typeof REDIRECT_TARGET_PARAM_NAMES)[number];

export type RedirectRejectionReason =
	/** Absent, `null`, or an empty string — "no target" is not a target. */
	| 'missing'
	/** Present but not a string (JSON number, array, object, …). */
	| 'not_a_string'
	/** Longer than `MAX_REDIRECT_TARGET_LENGTH`, before or after decoding. */
	| 'too_long'
	/** Nothing but whitespace. */
	| 'empty_after_trim'
	/** ASCII/C1 control characters, zero-width joiners, BOM, soft hyphen.
	 *  Browsers strip these before resolving a URL, so a validator that
	 *  does not see them is reading a different string than the browser. */
	| 'control_characters'
	/** Malformed percent-encoding (`%zz`), or nesting deeper than
	 *  `MAX_DECODE_ROUNDS` — i.e. the value is engineered to be read
	 *  differently by each consumer in the chain. */
	| 'decode_failed'
	/** Whitespace inside the value (a browser encodes it; a raw space in
	 *  a `Location` header is an injection attempt). */
	| 'whitespace'
	/** A backslash. Browsers normalise `\` to `/` in the authority
	 *  position, so `/\evil.example` navigates off-site. */
	| 'backslash'
	/** `javascript:`, `data:`, `vbscript:`, or any other non-http(s) scheme. */
	| 'scheme_not_allowed'
	/** `//evil.example` — scheme-relative, inherits our scheme on the
	 *  attacker's host. */
	| 'protocol_relative'
	/** An absolute http(s) URL whose origin is not trusted. */
	| 'external_origin'
	/** No leading `/` (`admin/keys`, `../admin`, `evil.example`). A
	 *  relative reference resolves against the *current* path, which
	 *  makes redirect outcomes depend on where the link was clicked. */
	| 'missing_leading_slash'
	/** Outside the caller's `allowedPrefixes`. */
	| 'path_not_allowed';

export interface RedirectPolicy {
	/**
	 * Origins allowed to appear as an absolute URL. Matched against
	 * `new URL(value).origin`, lower-cased. An accepted absolute URL
	 * is downgraded to its path — the caller never sees a host.
	 *
	 * Deliberately opt-in: with an empty list, every absolute URL is
	 * rejected, which is the correct behaviour when the canonical
	 * origin is unknown (a mis-provisioned `BETTER_AUTH_URL` must fail
	 * closed, not fail open).
	 */
	trustedOrigins?: readonly string[];
	/**
	 * Allow-list of internal path prefixes, e.g. `['/admin']` for the
	 * admin login screen. Prefix match, not segment match, so
	 * `/admin/keys` passes while `/administrator` does too — pair with
	 * a trailing-slash form (`['/admin/']`) when that matters.
	 */
	allowedPrefixes?: readonly string[];
	/** Overrides `MAX_REDIRECT_TARGET_LENGTH`. */
	maxLength?: number;
}

export type RedirectDecision =
	| { ok: true; redirect: string }
	| { ok: false; reason: RedirectRejectionReason };

/** Origin of a non-http(s) URL must never be compared against the
 *  trusted list, so the allow-list is resolved to bare origins once. */
const PARSER_BASE = 'https://redirect-guard.invalid';

/** `[A-Za-z][A-Za-z0-9+.-]*:` — RFC 3986 scheme production. */
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** Characters a browser silently drops (or a router treats as a
 *  separator) before it resolves the URL. C0 + C1 controls, soft
 *  hyphen, zero-width space/joiners/non-joiner, bidi marks, BOM, and
 *  the two Unicode line separators. */
const INVISIBLE_RE =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are the subject of this regex, not an accident — it is the detector for them.
	/[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/;

/**
 * Percent-decoding rounds before the value is declared hostile.
 * Four layers of encoding is already past anything a legitimate
 * client produces; a value that keeps changing at this depth is
 * probing for a consumer that decodes a different number of times.
 */
const MAX_DECODE_ROUNDS = 4;

function reject(reason: RedirectRejectionReason): RedirectDecision {
	return { ok: false, reason };
}

/** Resolve an origin string to its comparable form. */
function normalizeOrigin(value: string): string | null {
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;
	try {
		return new URL(trimmed).origin.toLowerCase();
	} catch {
		return null;
	}
}

/**
 * Percent-decode until stable. Returns `null` when the value is
 * malformed or does not stabilise within `MAX_DECODE_ROUNDS`.
 */
function decodeToFixedPoint(value: string): string | null {
	let current = value;
	for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
		let decoded: string;
		try {
			decoded = decodeURIComponent(current);
		} catch {
			return null;
		}
		if (decoded === current) return current;
		current = decoded;
	}
	// One more round would still change the value: the caller cannot
	// know how many times its consumer decodes.
	return null;
}

/**
 * `https://rebuildup.dev/admin?x=1#y` → `/admin?x=1#y`, but only when
 * the origin is trusted. Returns `null` for anything else.
 */
function downgradeTrustedAbsoluteUrl(
	value: string,
	trustedOrigins: readonly string[] | undefined,
): string | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	const origin = url.origin.toLowerCase();
	const trusted = (trustedOrigins ?? []).some((candidate) => {
		const normalized = normalizeOrigin(candidate);
		return normalized !== null && normalized === origin;
	});
	if (!trusted) return null;
	const relative = `${url.pathname}${url.search}${url.hash}`;
	return relative.length > 0 ? relative : '/';
}

/**
 * Classify an untrusted redirect target.
 *
 * Returns the internal path to redirect to, or the reason it was
 * refused. The reason is a stable vocabulary (see
 * `RedirectRejectionReason`) — it is safe to surface in a `400` body
 * and in logs; the offending value never is.
 */
export function classifyRedirectTarget(
	candidate: unknown,
	policy: RedirectPolicy = {},
): RedirectDecision {
	const maxLength = policy.maxLength ?? MAX_REDIRECT_TARGET_LENGTH;

	if (candidate === undefined || candidate === null) return reject('missing');
	if (typeof candidate !== 'string') return reject('not_a_string');
	if (candidate.length === 0) return reject('missing');
	if (candidate.length > maxLength) return reject('too_long');

	const trimmed = candidate.trim();
	if (trimmed.length === 0) return reject('empty_after_trim');
	if (INVISIBLE_RE.test(trimmed)) return reject('control_characters');

	const decoded = decodeToFixedPoint(trimmed);
	if (decoded === null) return reject('decode_failed');
	// Decoding can grow the string (`%25` → `%`), so the ceiling is
	// re-checked against the value the consumer would actually see.
	if (decoded.length > maxLength) return reject('too_long');
	if (decoded.length === 0) return reject('empty_after_trim');
	if (INVISIBLE_RE.test(decoded)) return reject('control_characters');
	if (/\s/.test(decoded)) return reject('whitespace');
	if (decoded.includes('\\')) return reject('backslash');

	let target: string;
	if (SCHEME_RE.test(decoded)) {
		// An absolute URL is only ever a *source* of a path.
		const downgraded = downgradeTrustedAbsoluteUrl(decoded, policy.trustedOrigins);
		if (downgraded === null) {
			return reject(/^https?:/i.test(decoded) ? 'external_origin' : 'scheme_not_allowed');
		}
		target = downgraded;
	} else if (decoded.startsWith('//')) {
		return reject('protocol_relative');
	} else if (!decoded.startsWith('/')) {
		return reject('missing_leading_slash');
	} else {
		target = decoded;
	}

	// Last word: resolve it against a throwaway origin. If a WHATWG
	// parser cannot keep the origin, no consumer will.
	let resolved: URL;
	try {
		resolved = new URL(target, PARSER_BASE);
	} catch {
		return reject('missing_leading_slash');
	}
	if (resolved.origin !== PARSER_BASE) return reject('external_origin');

	const prefixes = policy.allowedPrefixes;
	if (prefixes && prefixes.length > 0 && !prefixes.some((prefix) => target.startsWith(prefix))) {
		return reject('path_not_allowed');
	}

	return { ok: true, redirect: target };
}

/**
 * Fail-closed wrapper: the internal path when the target is safe,
 * otherwise `fallback` (which the caller owns and must be a constant
 * it trusts).
 */
export function resolveInternalRedirect(
	candidate: unknown,
	policy: RedirectPolicy & { fallback: string },
): string {
	const decision = classifyRedirectTarget(candidate, policy);
	return decision.ok ? decision.redirect : policy.fallback;
}

export interface RedirectCandidate {
	/** The parameter / body field the value came from. */
	param: string;
	/** Raw, untrusted value. */
	value: unknown;
	/** Where it was found. */
	source: 'query' | 'body';
}

/**
 * Every redirect target carried by a URL's query string, including
 * repeated parameters (`?callbackURL=/a&callbackURL=//evil` — the
 * consumer that reads the first one must not be the only check).
 */
export function collectRedirectCandidatesFromUrl(
	url: URL,
	params: readonly string[] = REDIRECT_TARGET_PARAM_NAMES,
): RedirectCandidate[] {
	const candidates: RedirectCandidate[] = [];
	for (const param of params) {
		for (const value of url.searchParams.getAll(param)) {
			candidates.push({ param, value, source: 'query' });
		}
	}
	return candidates;
}

/**
 * The subset of redirect targets carried by a request body.
 *
 * Only `application/json` and `application/x-www-form-urlencoded` are
 * parsed: those are the two encodings the project's own forms and
 * Better Auth's handler accept. Anything else (multipart, XML, a
 * stream the caller already consumed) yields no candidates rather
 * than a guess.
 */
export function collectRedirectCandidatesFromBody(
	bodyText: string,
	contentType: string | null,
	params: readonly string[] = REDIRECT_TARGET_PARAM_NAMES,
): RedirectCandidate[] {
	if (bodyText.length === 0) return [];
	const candidates: RedirectCandidate[] = [];

	const isForm = (contentType ?? '').includes('application/x-www-form-urlencoded');
	const isJson = (contentType ?? '').includes('application/json');
	if (!isForm && !isJson) return candidates;

	if (isForm) {
		const form = new URLSearchParams(bodyText);
		for (const param of params) {
			for (const value of form.getAll(param)) {
				candidates.push({ param, value, source: 'body' });
			}
		}
		return candidates;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(bodyText);
	} catch {
		// A malformed body is not a redirect target. The endpoint
		// that owns the body reports the syntax error.
		return candidates;
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return candidates;
	const record = parsed as Record<string, unknown>;
	for (const param of params) {
		if (!Object.hasOwn(record, param)) continue;
		candidates.push({ param, value: record[param], source: 'body' });
	}
	return candidates;
}

export interface RejectedRedirectTarget extends RedirectCandidate {
	reason: RedirectRejectionReason;
}

/**
 * First refused candidate, or `null` when every candidate is safe.
 *
 * `null` is also the answer for an empty candidate list: "no redirect
 * target was supplied" is not an attack, and the endpoint behind it
 * owns what to do next.
 */
export function firstRejectedRedirect(
	candidates: readonly RedirectCandidate[],
	policy: RedirectPolicy = {},
): RejectedRedirectTarget | null {
	for (const candidate of candidates) {
		const decision = classifyRedirectTarget(candidate.value, policy);
		if (!decision.ok) return { ...candidate, reason: decision.reason };
	}
	return null;
}
