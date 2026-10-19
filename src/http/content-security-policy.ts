/**
 * Content-Security-Policy in REPORT-ONLY mode (Issue #447).
 *
 * What this module owns
 * ---------------------
 * The origin inventory a Worker-generated document is allowed to load
 * subresources from, emitted as `Content-Security-Policy-Report-Only`.
 * Report-Only deliberately does not block anything: a violation is
 * reported to the browser (console + `securitypolicyviolation`), so the
 * shipped site can be measured against real traffic before an enforcing
 * policy is proposed. Moving any directive to enforcement is a separate
 * decision with its own breakage surface and is NOT taken here.
 *
 * The origins below were measured from the shipped surfaces, not copied
 * from a generic CSP template:
 *
 *   default / script / style / font / frame
 *     `'self'` — TanStack Start SSR documents, the hydration bundle,
 *     Panda CSS, the favicon, and the same-origin Tool iframe
 *     (`/tools/<slug>/app/index.html`). The Tool DOM inside the frame
 *     is a separate document owned by that Tool; the host policy only
 *     decides that the frame may be loaded.
 *   `'unsafe-inline'` (script + style)
 *     The document shell emits two inline scripts (the GA4 bootstrap
 *     and the async font-stylesheet flip) and React emits inline
 *     `style` attributes. A nonce/hash migration is the condition for
 *     removing this token; pre-declaring a stricter policy would only
 *     hide that work behind expected reports.
 *   https://www.googletagmanager.com (script)
 *     The GA4 loader in `src/editorial/analytics/GoogleAnalytics.tsx`.
 *   https://fonts.googleapis.com (style)
 *     The Noto Sans JP / Zen Kaku Gothic New stylesheet linked from
 *     `src/routes/__root.tsx`.
 *   https://fonts.gstatic.com (font)
 *     The `@font-face` files that stylesheet references.
 *   https://*.google-analytics.com, https://*.googletagmanager.com
 *     GA4 beacons (image + fetch). The exact subdomain is chosen by
 *     Google at runtime (`region1.google-analytics.com` today), so the
 *     first-party source only pins the loader.
 *   https://*.analytics.google.com (connect)
 *     GA4's collect endpoint family.
 *   the R2 public media origin (img), when configured
 *     `MEDIA_PUBLIC_BASE_URL` is a production-only var; portfolio
 *     images are served from that custom domain. It is read from `env`
 *     rather than hard-coded so local / preview stay on the unbound
 *     branch and no production origin is pinned in source.
 *
 * What is deliberately absent
 * ---------------------------
 *   - No `report-uri` / `report-to`: the repository has no collector
 *     endpoint, and inventing one would send visitor data somewhere
 *     with no owner or retention contract. Detection is the browser's
 *     native report surface (`securitypolicyviolation`), which the E2E
 *     contract observes locally.
 *   - `frame-ancestors` is not repeated: the enforcing inbound embed
 *     policy is the separate `Content-Security-Policy` header owned by
 *     `src/server.ts` (Issue #448), and the directive is ignored in
 *     Report-Only mode.
 *   - No wildcard catch-all, no `'unsafe-eval'`, and no origin that was
 *     not observed. A future resource that needs a new origin is meant
 *     to surface as a report first.
 */

/** Report-Only header name, spelled once for callers. */
export const CSP_REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only';

/** GA4's loader is a single host, unlike its runtime beacon subdomains. */
const GA_LOADER_ORIGIN = 'https://www.googletagmanager.com';

/** Google Fonts stylesheet host. */
const FONT_STYLESHEET_ORIGIN = 'https://fonts.googleapis.com';

/** Google Fonts binary host referenced by the stylesheet. */
const FONT_FILE_ORIGIN = 'https://fonts.gstatic.com';

/** GA4 image beacons. */
const GA_IMAGE_ORIGINS = [
	'https://*.google-analytics.com',
	'https://*.googletagmanager.com',
] as const;

/** GA4 fetch/beacon endpoints. */
const GA_CONNECT_ORIGINS = [
	'https://*.google-analytics.com',
	'https://*.analytics.google.com',
	'https://*.googletagmanager.com',
] as const;

/** Options accepted by the policy builder. */
export interface ContentSecurityPolicyOptions {
	/**
	 * `MEDIA_PUBLIC_BASE_URL` from the runtime env. Only the origin is
	 * used; a path or query in the configured value is ignored. An
	 * unparseable / absent value contributes nothing (the unbound media
	 * branch is the local and preview default).
	 */
	readonly mediaBaseUrl?: string | undefined;
}

/**
 * Normalise a configured base URL to a CSP host-source origin.
 *
 * Returns `null` rather than throwing so a malformed operator value
 * degrades to "no media origin", which is the same fail-closed state as
 * an unconfigured media binding. A CSP host-source has no path, so the
 * origin is the only part that can be emitted.
 */
export function mediaOriginFrom(baseUrl: string | undefined): string | null {
	if (!baseUrl) return null;
	try {
		const url = new URL(baseUrl);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
		return url.origin;
	} catch {
		return null;
	}
}

/**
 * Build the complete Report-Only policy for one response.
 *
 * Directive order is fixed so the emitted header is stable and diffable
 * in tests and reports. The media origin is appended last and deduped,
 * so a configuration that happens to name a source already present does
 * not produce an invalid repeated token.
 */
export function contentSecurityPolicyValue(options: ContentSecurityPolicyOptions = {}): string {
	const imgSrc = new Set<string>(["'self'", ...GA_IMAGE_ORIGINS]);
	const mediaOrigin = mediaOriginFrom(options.mediaBaseUrl);
	if (mediaOrigin !== null) imgSrc.add(mediaOrigin);

	return [
		"default-src 'self'",
		`script-src 'self' 'unsafe-inline' ${GA_LOADER_ORIGIN}`,
		`style-src 'self' 'unsafe-inline' ${FONT_STYLESHEET_ORIGIN}`,
		`img-src ${[...imgSrc].join(' ')}`,
		`font-src 'self' ${FONT_FILE_ORIGIN}`,
		`connect-src 'self' ${GA_CONNECT_ORIGINS.join(' ')}`,
		"frame-src 'self'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
	].join('; ');
}

/**
 * Attach the Report-Only policy to a Worker response.
 *
 * Mounted at the same single choke point as the enforcing headers in
 * `src/server.ts`, so SSR documents, redirects, server-function payloads
 * and Hono responses all carry it. An existing Report-Only header is
 * left untouched: a layer that deliberately set one outranks this
 * default, the same ownership rule the other security headers use.
 *
 * A response whose headers are sealed is returned unchanged rather than
 * failing the request. Report-Only is an observation aid; it must never
 * turn a page render into an error.
 */
export function applyContentSecurityPolicyReportOnly(
	response: Response,
	options: ContentSecurityPolicyOptions = {},
): Response {
	if (response.headers.has(CSP_REPORT_ONLY_HEADER)) return response;

	try {
		response.headers.set(CSP_REPORT_ONLY_HEADER, contentSecurityPolicyValue(options));
	} catch {
		return response;
	}
	return response;
}
