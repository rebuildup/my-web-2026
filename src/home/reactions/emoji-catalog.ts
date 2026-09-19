/**
 * Reaction emoji slug catalog — home-side facade over the DB-backed
 * catalog (`src/http/reactions/emoji-catalog.ts`).
 *
 * Ticket E (branch 37) shipped a 16-slug hard-coded catalog here.
 * Ticket G (branch 39) moves the source of truth into D1
 * (`reaction_emoji_catalog`) so admins can add / rebind / disable
 * slugs without a code change. This file now re-exports the
 * **contract** (slug grammar, helpers, slug→glyph resolution) from
 * the canonical `http/reactions/emoji-catalog.ts` module and keeps
 * the same public surface that branch 37's `widget.tsx` /
 * `load.ts` already consume.
 *
 * Differences from branch 37:
 *
 *   - The `validateEmojiSlug` helper now requires a **loaded**
 *     catalog argument because "is this slug in the catalog?" is
 *     no longer a static lookup. Callers must load the catalog via
 *     `getActiveCatalog(db)` first. The shape is still pure (no I/O
 *     inside the validator), which keeps it testable.
 *   - `EMOJI_CATALOG` (the synchronous `Record<slug, glyph>` map)
 *     is replaced by `resolveEmojiSlug(catalog, slug)`. The widget
 *     already calls `resolveEmojiSlug`, so the call signature
 *     update is mechanical.
 *   - The home widget receives the catalog via the loader (`data.catalog`)
 *     so it does not need to re-fetch on render.
 *
 * See ADR-0013 for the full decision record.
 */

import {
	type CatalogEntry,
	EMOJI_SLUG_REGEX,
	MAX_EMOJI_SLUG_LEN,
	resolveCodepoint as resolveCodepointImpl,
	validateSlug,
} from '../../http/reactions/emoji-catalog';

// Re-export the slug grammar so existing imports from
// `./emoji-catalog` continue to resolve (widget + load.ts both do).
export { EMOJI_SLUG_REGEX, MAX_EMOJI_SLUG_LEN };
export type { CatalogEntry };

/**
 * Slug → emoji codepoint (or `null` when the slug is not enabled in
 * the supplied catalog). Replaces the synchronous `EMOJI_CATALOG[slug]`
 * lookup that branch 37 used; the catalog is now loaded at SSR time
 * and threaded through `HomeReactionsData.catalog`.
 */
export function resolveEmojiSlug(catalog: readonly CatalogEntry[], slug: string): string | null {
	return resolveCodepointImpl(catalog, slug);
}

/**
 * Validate the slug **format and presence** against a supplied
 * catalog. Throws with a domain-specific message on any failure.
 * The caller must have loaded the catalog first (typically via
 * `loadCatalog(db)` in the SSR loader).
 */
export function validateEmojiSlug(catalog: readonly CatalogEntry[], value: unknown): string {
	const slug = validateSlug(value); // format + length
	const known = catalog.some((entry) => entry.slug === slug && entry.enabled);
	if (!known) throw new Error(`unknown emoji slug: ${slug}`);
	return slug;
}

/**
 * Compute a stable, sorted list of active slugs from a catalog.
 * Replaces the synchronous `EMOJI_SLUGS` constant from branch 37.
 */
export function listActiveSlugs(catalog: readonly CatalogEntry[]): readonly string[] {
	return catalog.filter((entry) => entry.enabled).map((entry) => entry.slug);
}

/**
 * Build a `slug → codepoint` lookup table from a loaded catalog.
 * Useful when a component needs to render many glyphs at once
 * (e.g. the widget's picker row). `null` entries indicate unknown
 * / disabled slugs and should render the inert `:slug:` text.
 */
export function buildCatalogLookup(
	catalog: readonly CatalogEntry[],
): ReadonlyMap<string, string | null> {
	const out = new Map<string, string | null>();
	for (const entry of catalog) {
		out.set(entry.slug, entry.enabled ? entry.codepoint : null);
	}
	return out;
}
