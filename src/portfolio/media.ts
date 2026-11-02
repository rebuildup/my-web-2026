/**
 * R2 media URL composition for portfolio assets.
 *
 * Decision 5 (#77) originally delivered portfolio media through a
 * **public R2 custom domain** (`https://media.rebuildup.dev/<r2_key>`).
 * Issue #634 moved public delivery into the Worker
 * (`GET|HEAD /media/<key>`, `src/http/media/router.ts`): the composed
 * base URL is now `https://rebuildup.dev/media`, so every URL passes
 * the namespace and publication gates before a byte is served.
 *
 * Implications:
 *
 * - Each image request reaches the Worker once, then the edge/HTTP
 *   cache serves it for the object's freshness window.
 * - OGP crawlers (Facebook / Twitter) see the canonical URL once and
 *   cache it; no signing round-trip.
 * - `srcset` can list multiple sizes of the same URL.
 *
 * The R2 custom domain is a residual: while that attachment exists
 * (a Cloudflare account setting this repository cannot verify), the
 * edge serves **every** key in the bucket at its key, so composing a
 * URL there *is* publishing. Retiring the attachment is an operator
 * step recorded in `docs/security/r2-media-visibility.md`; pointing
 * `MEDIA_PUBLIC_BASE_URL` back at it is the documented break-glass
 * rollback.
 *
 * Since #459 the composition goes through the R2 visibility boundary
 * (`src/cloudflare/media-visibility.ts`): only a well-formed key under
 * a declared public prefix (`portfolio/`, `reactions/`) can become a
 * URL. A WIP upload or an undeclared prefix resolves to `null` and
 * renders the placeholder, so an unpublished asset is never handed to
 * a browser and never becomes a URL an attacker could enumerate.
 *
 * This module is the single entry point that materialises the URL.
 * Routes and UI must never recompose the URL themselves.
 */

import { isPublicMediaKey, isValidMediaKey } from '../cloudflare/media-visibility';

/** Object key in the `MEDIA` binding. */
export type R2Key = string;

/**
 * Minimal env shape the portfolio obligation needs from the R2
 * delivery surface. `MEDIA_PUBLIC_BASE_URL` is intentionally
 * optional — a deployment without a public media route configured
 * must keep working with a `null` URL. Production sets it to the
 * Worker media route (`https://rebuildup.dev/media`, Issue #634);
 * the R2 custom domain is no longer the delivery path.
 */
export interface PortfolioMediaEnv {
	MEDIA?: R2Bucket;
	/**
	 * Public base URL for media delivery (no trailing slash). In
	 * production this is `https://rebuildup.dev/media`. When absent,
	 * every `composeMediaUrl` call returns `null` and the UI renders
	 * the placeholder branch — unless the runtime is the DEVELOPMENT
	 * surface, which serves the same route on its own origin (see
	 * `DEVELOPMENT_MEDIA_BASE`).
	 */
	MEDIA_PUBLIC_BASE_URL?: string;
	/**
	 * The development data-source binding (Issue #377). It is declared
	 * ONLY in development, so its presence is how this module knows the
	 * runtime is the dev server rather than the deployed Worker.
	 */
	MY_WEB_2026_DATA_SOURCE?: string;
}

/**
 * Base URL the DEVELOPMENT surface uses for media (Issue #808).
 *
 * The dev server serves `GET /media/<key>` from the SAME Worker route
 * production uses (`src/http/media/router.ts`), on its own origin — and
 * its port is the operator's choice, so no absolute value is correct.
 * Without this, every portfolio cover on the verification server
 * rendered as `placeholder` even though the object was served: the URL
 * was never composed because `MEDIA_PUBLIC_BASE_URL` is declared
 * production-only (`wrangler.production.jsonc`,
 * `quality/cloudflare-config-drift.json`).
 *
 * Relative on purpose: it is origin- and port-independent, it cannot
 * point a development surface at a production delivery path, and it
 * touches neither the Wrangler configuration nor the drift record. The
 * deployed Worker never has `MY_WEB_2026_DATA_SOURCE`, so production
 * composition is unchanged.
 */
const DEVELOPMENT_MEDIA_BASE = '/media';

/**
 * The media base URL this runtime must use, or `null` when the
 * delivery surface is not configured for it.
 *
 * Order: the explicit production var wins; the development binding
 * selects the relative dev base; neither means "not configured", which
 * stays fail-closed in `composeMediaUrl`.
 */
function mediaBase(env: PortfolioMediaEnv): string | null {
	if (typeof env.MEDIA_PUBLIC_BASE_URL === 'string' && env.MEDIA_PUBLIC_BASE_URL.length > 0) {
		return env.MEDIA_PUBLIC_BASE_URL;
	}
	if (typeof env.MY_WEB_2026_DATA_SOURCE === 'string' && env.MY_WEB_2026_DATA_SOURCE.length > 0) {
		return DEVELOPMENT_MEDIA_BASE;
	}
	return null;
}

/**
 * Compose the public URL for an R2 object. Returns `null` when:
 *
 *   - the `MEDIA` binding is not configured,
 *   - no media base URL is configured for this runtime (neither
 *     `MEDIA_PUBLIC_BASE_URL` nor the development data-source binding,
 *     see `mediaBase`),
 *   - the supplied key fails conservative validation
 *     (defence-in-depth against accidental `..` traversal),
 *   - the key is not publicly servable under the R2 visibility
 *     boundary (#459): a private or undeclared namespace never
 *     becomes a public URL.
 *
 * When configured, the returned URL is `${base}/${r2Key}` — the Worker
 * media route serves the object after the namespace and publication
 * gates, with the cache policy `src/http/media/router.ts` declares.
 */
export function composeMediaUrl(env: PortfolioMediaEnv, r2Key: R2Key): string | null {
	if (!env.MEDIA) return null;
	const base = mediaBase(env);
	if (base === null) return null;
	if (!isPublicMediaKey(r2Key)) return null;
	const trimmed = base.replace(/\/+$/, '');
	return `${trimmed}/${r2Key}`;
}

/**
 * Conservative R2 key validation, kept as the portfolio-facing export
 * name. The grammar itself now lives with the visibility boundary
 * (#459) so there is exactly one definition of a valid R2 key; this
 * delegation exists so the portfolio surface keeps its historical
 * export. It answers "is this a well-formed key" — NOT "may this key
 * be served publicly", which is `isPublicMediaKey`.
 */
export function isValidR2Key(key: string): boolean {
	return isValidMediaKey(key);
}
