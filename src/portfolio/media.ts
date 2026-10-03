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
 * - The custom domain itself is **not** a code change — it is an R2
 *   bucket setting in the Cloudflare dashboard. Until the operator
 *   wires it, `composeMediaUrl` returns `null` and the UI renders a
 *   placeholder.
 *
 * This module is the single entry point that materialises the URL.
 * Routes and UI must never recompose the URL themselves.
 */

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
 *     (defence-in-depth against accidental `..` traversal).
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
	if (!isValidR2Key(r2Key)) return null;
	const trimmed = base.replace(/\/+$/, '');
	return `${trimmed}/${r2Key}`;
}

/**
 * Conservative R2 key validation. Same character set as the
 * foundation loader — keeps accidental path traversal (`..`, leading
 * `/`) out of any URL the loader eventually composes.
 */
const R2_KEY_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,511}$/;

export function isValidR2Key(key: string): boolean {
	if (!key) return false;
	if (key.includes('..')) return false;
	return R2_KEY_REGEX.test(key);
}
