import policy from './security-headers.json' with { type: 'json' };

/**
 * Canonical response security-header policy (Issue #449).
 *
 * Obligation: decide what `X-Content-Type-Options`, `Referrer-Policy`
 * and `Permissions-Policy` say on a Worker-generated response. This
 * module is the transport-level half of the contract and knows
 * nothing about Tools, pages, or Cloudflare bindings — the caller
 * passes the per-path overrides in (see `SecurityHeaderOverrides`).
 *
 * Values live in `./security-headers.json` so that the same strings
 * can be asserted against `public/_headers` by
 * `scripts/check-security-headers.mjs` (Cloudflare documents that
 * `_headers` does NOT apply to Worker-generated responses, so the two
 * surfaces have to be kept in step by a check rather than by one
 * function). Editing one without the other fails `validate:fast`.
 *
 * Why these three headers
 * -----------------------
 *   - `X-Content-Type-Options: nosniff` — OWASP ASVS V14.1.1. The
 *     site serves user-influenced bytes (reaction payloads, uploads
 *     under `/admin/images`, PDFs under `/share/`); without nosniff a
 *     browser may re-interpret a response as HTML or script.
 *   - `Referrer-Policy` — the host baseline keeps the origin but drops
 *     the path on cross-origin requests, which is what GA4 and the
 *     Tool bundles need. A Tool artifact gets `no-referrer`: it is
 *     third-party-shaped content and has no business sending the host
 *     URL anywhere.
 *   - `Permissions-Policy` — the deny list is explicit, not
 *     deny-all. See `security-headers.json#denied_permissions` for the
 *     per-feature rationale.
 *
 * Why the grant is per-path, not host-wide
 * ----------------------------------------
 * `mic-level` needs `microphone`; nothing else on this site does. A
 * blanket deny would break that Tool, and a blanket allow would hand
 * every page a capture device it has no use for. So the baseline is
 * the deny list, and the ONLY way a feature comes back is a declared
 * grant on the response being rendered — `delivery.iframe.allow` in
 * `src/tools/manifest.json`, resolved by `toolRouteSecurityPolicy()`
 * in `src/tools/registry.ts` and passed here by `src/server.ts`. The
 * boundary owns the mechanism; the Tool Registry owns the data.
 *
 * Two-sided grant
 * ---------------
 * A Permissions-Policy grant needs BOTH halves:
 *   1. the container opts in — the host route renders
 *      `<iframe allow="microphone">` from the same manifest field;
 *   2. the framed document does not deny it in its own response —
 *      `/tools/<slug>/app/**` is Static Assets, so that half lives in
 *      `public/_headers`.
 * Neither half alone is sufficient; both are driven by one manifest
 * field so they cannot drift apart.
 */

/** Header names. Lower-cased by `Headers`, spelled here for callers. */
export const X_CONTENT_TYPE_OPTIONS = 'X-Content-Type-Options';
export const REFERRER_POLICY = 'Referrer-Policy';
export const PERMISSIONS_POLICY = 'Permissions-Policy';

/**
 * Features denied on every response unless the caller passes an
 * explicit grant. Sorted, so the emitted header string is stable and
 * can be compared byte-for-byte against `public/_headers`.
 */
export const DENIED_PERMISSIONS: readonly string[] = policy.denied_permissions;

/** Fallback `Referrer-Policy` for Worker-generated responses. */
export const HOST_REFERRER_POLICY: string = policy.referrer_policy.host;

/** `Referrer-Policy` for a Tool artifact (`/tools/<slug>/app/**`). */
export const TOOL_APP_REFERRER_POLICY: string = policy.referrer_policy.tool_app;

/** Per-response deviations from the baseline. */
export interface SecurityHeaderOverrides {
	/** Defaults to {@link HOST_REFERRER_POLICY}. */
	readonly referrerPolicy?: string;
	/**
	 * Features to opt back in, e.g. `['microphone']`. A feature that
	 * is not in {@link DENIED_PERMISSIONS} is ignored: it already has
	 * the browser default allowlist, so a grant for it would be a
	 * no-op. `scripts/check-security-headers.mjs` rejects such a grant
	 * at the manifest level instead of letting it look effective.
	 */
	readonly grantedPermissions?: readonly string[];
}

/**
 * Allowlist a granted feature is scoped to.
 *
 * `self` alone is not enough for a Tool frame: the host sandboxes the
 * iframe with `allow-scripts` and no `allow-same-origin`, so the
 * framed document has an opaque origin and `self` cannot match it.
 * Naming the serving origin explicitly keeps the grant working for
 * both the shell route and the artifact, and keeps it scoped to the
 * origin that actually served the response (`http://127.0.0.1` in
 * local workerd / preview, `https://rebuildup.dev` in production)
 * rather than to a hard-coded host.
 */
export function grantedAllowlist(origin: string): string {
	return policy.granted_origin_token.replace('{origin}', origin);
}

/**
 * Render the `Permissions-Policy` value for one response.
 *
 * Denied features stay in place (so the emitted string is stable and
 * diffable against `_headers`); granted features are re-pointed at
 * {@link grantedAllowlist}.
 */
export function permissionsPolicyValue(
	origin: string,
	grantedPermissions: readonly string[] = [],
): string {
	const granted = new Set(grantedPermissions.map((feature) => feature.trim().toLowerCase()));
	const allowlist = grantedAllowlist(origin);
	return DENIED_PERMISSIONS.map((feature) =>
		granted.has(feature.toLowerCase()) ? `${feature}=${allowlist}` : `${feature}=()`,
	).join(', ');
}

/** The three headers for one response, keyed by header name. */
export function resolveSecurityHeaders(
	origin: string,
	overrides: SecurityHeaderOverrides = {},
): Record<string, string> {
	return {
		[X_CONTENT_TYPE_OPTIONS]: policy.x_content_type_options,
		[REFERRER_POLICY]: overrides.referrerPolicy ?? HOST_REFERRER_POLICY,
		[PERMISSIONS_POLICY]: permissionsPolicyValue(origin, overrides.grantedPermissions ?? []),
	};
}

/**
 * Attach the policy to a response.
 *
 * Mounted in `src/server.ts` AFTER the Hono / TanStack Start dispatch,
 * so every Worker-generated response passes through exactly one place:
 * SSR HTML, redirects, server-function payloads, `/api/v1/*` JSON and
 * errors alike.
 *
 * An existing value is never overwritten (`setIfAbsent` semantics, the
 * same rule `applyHtmlCachePolicy` uses): a handler that deliberately
 * set one of these headers outranks the default.
 *
 * A response whose header list the runtime sealed (a `Response.redirect()`
 * result, for instance) is re-created with a mutable header list rather
 * than skipped. A redirect carries no body, so the copy is free, and
 * "we could not set the header" is not an acceptable outcome for a
 * policy that claims every response carries it. If the copy itself is
 * impossible (an opaque or bodyless-status response the runtime refuses
 * to re-create), the original is returned unchanged.
 */
export function applySecurityHeaders(
	request: Request,
	response: Response,
	overrides: SecurityHeaderOverrides = {},
): Response {
	const { origin } = new URL(request.url);
	const headers = resolveSecurityHeaders(origin, overrides);
	const pending = Object.entries(headers).filter(([name]) => !response.headers.has(name));

	let target = response;
	for (const [name, value] of pending) {
		try {
			target.headers.set(name, value);
		} catch {
			// Either the header list is sealed or the runtime refuses
			// this value. Re-create the response once with a mutable
			// header list and retry; if the retry still throws, give up
			// on the remaining headers rather than failing the request.
			target = withMutableHeaders(target);
			if (target === response) break;
			try {
				target.headers.set(name, value);
			} catch {
				break;
			}
		}
	}
	return target;
}

/** Rebuild a response with a writable header list, or return it unchanged. */
function withMutableHeaders(response: Response): Response {
	try {
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: new Headers(response.headers),
		});
	} catch {
		return response;
	}
}
