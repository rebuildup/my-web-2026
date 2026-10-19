/**
 * R2 media URL composition for portfolio assets.
 *
 * Decision 5 (#77): portfolio media is delivered via a **public R2
 * custom domain** (e.g. `https://media.rebuildup.dev/<r2_key>`) so
 * the Cloudflare edge — not the Worker — serves every image.
 *
 * Implications:
 *
 * - No Worker request is paid per image render. The image is fetched
 *   directly from the custom-domain origin.
 * - OGP crawlers (Facebook / Twitter) see the canonical URL once and
 *   cache it; no signing round-trip.
 * - `srcset` can list multiple sizes of the same custom-domain URL.
 *
 * That same fact is the risk: **if** the custom domain is attached
 * (an R2 bucket setting in the Cloudflare account, which this
 * repository cannot verify), the edge serves **every** key in the
 * bucket, so composing a URL *is* publishing. Since #459 the
 * composition therefore goes through the R2 visibility boundary
 * (`src/cloudflare/media-visibility.ts`): only a well-formed key under
 * a declared public prefix (`portfolio/`, `reactions/`) can become a
 * URL. A WIP upload or an undeclared prefix resolves to `null` and
 * renders the placeholder, so an unpublished asset is never handed to
 * a browser and never becomes a URL an attacker could enumerate.
 * - The custom domain itself is **not** a code change — it is an R2
 *   bucket setting in the Cloudflare dashboard. Until the operator
 *   wires it, `composeMediaUrl` returns `null` and the UI renders a
 *   placeholder.
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
 * optional — the foundation ships without a public media route
 * configured, so the loaders and UI must keep working with a
 * `null` URL until the operator binds the custom domain.
 */
export interface PortfolioMediaEnv {
	MEDIA?: R2Bucket;
	/**
	 * Public base URL for the R2 custom domain (no trailing slash).
	 * E.g. `https://media.rebuildup.dev`. When absent, every
	 * `composeMediaUrl` call returns `null` and the UI renders the
	 * placeholder branch.
	 */
	MEDIA_PUBLIC_BASE_URL?: string;
}

/**
 * Compose the public URL for an R2 object. Returns `null` when:
 *
 *   - the `MEDIA` binding is not configured,
 *   - `MEDIA_PUBLIC_BASE_URL` is not configured (operator hasn't
 *     wired the R2 custom domain yet),
 *   - the supplied key fails conservative validation
 *     (defence-in-depth against accidental `..` traversal),
 *   - the key is not publicly servable under the R2 visibility
 *     boundary (#459): a private or undeclared namespace never
 *     becomes a public URL.
 *
 * When configured, the returned URL is
 * `${MEDIA_PUBLIC_BASE_URL}/${r2Key}` — the R2 custom domain serves
 * the object directly with whatever cache headers R2 emits. The UI
 * therefore needs no Worker proxy hop.
 */
export function composeMediaUrl(env: PortfolioMediaEnv, r2Key: R2Key): string | null {
	if (!env.MEDIA) return null;
	const base = env.MEDIA_PUBLIC_BASE_URL;
	if (!base) return null;
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
