import { createMiddleware } from 'hono/factory';

/**
 * Shared-cache isolation for the external HTTP boundary (Issue #460).
 *
 * Why this exists
 * ---------------
 * Every `/api/v1/*` response except one is a function of the caller's
 * identity:
 *
 *   - `GET /api/v1/access/count/:key` is scoped to the authenticated
 *     API key id (ADR-0012 §3) — two consumers holding different keys
 *     see different `count` values for the same URL.
 *   - `GET /api/v1/reactions?target=…&actor_id=…` returns
 *     `viewer_reactions` for the *named visitor*, resolved from the
 *     caller's `mw_actor_id` cookie. Same URL shape, different body.
 *   - `/api/v1/auth/*` returns session state for the `Cookie` that
 *     Better Auth issued (role, e-mail, session token metadata).
 *
 * Before this module those responses carried **no** `Cache-Control`
 * at all (see the header dump in `docs/security/cache-isolation.md`).
 * RFC 9111 §3 lets a shared cache store such a response, and the
 * only thing standing between "user B reads user A's role" and a
 * correct response is every intermediary in the path having exactly
 * the same idea about cookies. The contract here removes that
 * dependency: the origin states the isolation, so a misconfigured or
 * over-eager CDN cannot invent it away.
 *
 * The policy: deny by default, opt in explicitly
 * ----------------------------------------------
 *   - A response is treated as shared-cacheable ONLY when its
 *     `Cache-Control` carries `public` **and** a positive freshness
 *     lifetime (`s-maxage` / `max-age`). That is the explicit opt-in
 *     used by the one genuinely public payload on this boundary,
 *     `GET /api/v1/reaction-images/:id` (content-addressed,
 *     immutable — `src/http/reactions/images.ts`). It is left
 *     completely untouched, `Vary` included: adding `Vary: Cookie`
 *     to a public immutable asset would fragment the shared cache
 *     for every visitor and change nothing about correctness.
 *   - Everything else — no header, `no-store`, `no-cache`, a bare
 *     `max-age` — is rewritten to `private, no-store`. The rewrite is
 *     monotone: `private, no-store` is never weaker than what it
 *     replaces (`no-store` is preserved as a subset), so this can
 *     only tighten a handler's policy, never loosen it.
 *   - The isolated responses additionally carry
 *     `Vary: Cookie, Authorization`. With `no-store` this is
 *     technically redundant for a conforming cache; it is kept
 *     because it is the signal every non-conforming intermediary
 *     (corporate proxies, mobile SDK HTTP stacks, "cache
 *     everything" CDN rules) understands, and it is what makes the
 *     contract legible in a header dump.
 *
 * Failure behaviour
 * -----------------
 * Header mutation can throw: `Response.redirect()` and responses
 * produced by `fetch()` carry an immutable guard. A cache hint must
 * never be the reason a request 500s, so the whole mutation block
 * is wrapped and a sealed response is returned untouched. That is a
 * deliberate availability-over-hygiene trade: the response still
 * renders, and an intermediary that would have mis-stored it is by
 * definition not one that seals headers.
 *
 * Scope: `/api/v1/*`. The SSR document / server-function side of
 * the same contract lives in `src/server.ts` (`applyHtmlCachePolicy`),
 * which imports the vocabulary below rather than restating it, so
 * the two halves cannot drift apart.
 */

/** `Cache-Control` for a response a shared cache must never store. */
export const PRIVATE_NO_STORE = 'private, no-store';

/**
 * Request headers that select the caller's authentication context.
 * Ordered so the emitted `Vary` value is stable and diffable.
 */
export const AUTH_REQUEST_HEADERS = ['Cookie', 'Authorization'] as const;

/** Split a `Cache-Control` / `Vary` value into normalised directives. */
function directives(value: string | null | undefined): string[] {
	if (!value) return [];
	// RFC 9111 §5.2 lists directives comma-separated; §5.2.1 additionally
	// requires recipients to tolerate `;` as a separator for robustness
	// (the syntax in RFC 7234 §4.2 allowed either).
	return value
		.split(/[,;]/)
		.map((part) => part.trim().toLowerCase())
		.filter((part) => part.length > 0);
}

/** True when `name` appears as a bare directive (`no-store`, `public`). */
function hasDirective(list: readonly string[], name: string): boolean {
	return list.some((directive) => directive === name);
}

/** True when `name=value` appears **and** the value is a positive
 * number. `max-age=0` / `s-maxage=0` mean "do not serve from cache",
 * so they are not an opt-in.
 */
function hasPositiveLifetime(list: readonly string[], name: string): boolean {
	return list.some((directive) => {
		const separator = directive.indexOf('=');
		if (separator < 0) return false;
		if (directive.slice(0, separator) !== name) return false;
		const value = Number.parseInt(directive.slice(separator + 1), 10);
		return Number.isFinite(value) && value > 0;
	});
}

/** True when `name=value` appears at all, positive or not. */
function hasLifetime(list: readonly string[], name: string): boolean {
	return list.some((directive) => directive.startsWith(`${name}=`));
}

/**
 * Is this response explicitly declared shareable?
 *
 * Only `public` + a positive lifetime qualifies. `private`,
 * `no-store` and a bare `no-cache` all mean "not a shared-cache
 * candidate" for our purposes, and anything we cannot read as an
 * opt-in is denied rather than guessed at.
 */
export function isExplicitlySharedCacheable(cacheControl: string | null | undefined): boolean {
	const list = directives(cacheControl);
	if (list.length === 0) return false;
	if (hasDirective(list, 'no-store') || hasDirective(list, 'private')) return false;
	if (!hasDirective(list, 'public')) return false;
	// `s-maxage` overrides `max-age` for a shared cache (RFC 9111
	// §5.2.2.10), so `public, s-maxage=0, max-age=600` is a
	// "do not serve from cache" response, not an opt-in.
	if (hasLifetime(list, 's-maxage')) return hasPositiveLifetime(list, 's-maxage');
	return hasPositiveLifetime(list, 'max-age');
}

/**
 * Merge `Vary` field names, preserving the order already present and
 * de-duplicating case-insensitively. `Vary: *` is returned unchanged:
 * it already means "this response varies on everything", and adding
 * names to it would be meaningless.
 */
export function mergeVary(
	existing: string | null | undefined,
	additions: readonly string[] = AUTH_REQUEST_HEADERS,
): string {
	const current = (existing ?? '').trim();
	if (current === '*') return '*';
	const seen = new Set<string>();
	const merged: string[] = [];
	for (const source of [current, additions.join(',')]) {
		for (const part of source.split(',')) {
			const trimmed = part.trim();
			if (trimmed.length === 0) continue;
			const key = trimmed.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			merged.push(trimmed);
		}
	}
	return merged.join(', ');
}

/**
 * Response-header cache isolation for every `/api/v1/*` response.
 *
 * Registered FIRST in `src/http/hono.ts` so it wraps the local mock
 * gate as well as the production routers: the mock `auth.session`
 * payload is also per-context data, and a policy that only applied to
 * the production path would be a policy with a hole in dev.
 */
export const sharedCacheIsolation = createMiddleware<{ Bindings: Env }>(async (c, next) => {
	await next();
	const headers = c.res.headers;
	// Explicit shared-cache opt-in wins untouched — `Vary` included.
	if (isExplicitlySharedCacheable(headers.get('cache-control'))) return;
	try {
		headers.set('cache-control', PRIVATE_NO_STORE);
		headers.set('vary', mergeVary(headers.get('vary')));
	} catch {
		// Sealed headers (immutable guard) — a cache hint must never
		// turn a working handler into a 500. See the module docstring.
	}
});
