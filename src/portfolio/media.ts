/**
 * R2 media URL composition for portfolio assets.
 *
 * The foundation does not yet wire a public media route
 * (`/api/v1/portfolio/media/<r2_key>` or similar) — that
 * belongs to Issue #77 (UI) once we decide between
 *   * signed URL per request (current Worker egress),
 *   * public R2 custom domain (long-lived cacheable URLs).
 *
 * For now the loader exposes `Media.url: null` when the
 * binding is not configured, so the UI can render a placeholder
 * without crashing. This module is the single place that
 * composes URLs once the public route ships; everything else
 * goes through `composeMediaUrl`.
 */

/** Object key in the `MEDIA` binding. */
export type R2Key = string;

/**
 * Compose the public URL for an R2 object. Returns `null` when
 * the binding is not configured so the caller can render a
 * placeholder. The default implementation returns `null` until
 * Issue #77 introduces a public media route.
 *
 * `r2Key` is validated against a conservative character set to
 * keep accidental path traversal out of the eventual URL
 * builder.
 */
export function composeMediaUrl(env: { MEDIA?: R2Bucket }, r2Key: R2Key): string | null {
	if (!env.MEDIA) return null;
	if (!isValidR2Key(r2Key)) return null;
	// Foundation: no public route yet. UI renders a placeholder.
	// Once Issue #77 ships, swap this for:
	//   return `/api/v1/portfolio/media/${encodeURIComponent(r2Key)}`;
	return null;
}

const R2_KEY_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,511}$/;

export function isValidR2Key(key: string): boolean {
	if (!key) return false;
	if (key.includes('..')) return false;
	return R2_KEY_REGEX.test(key);
}
