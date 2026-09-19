/**
 * Reaction emoji catalog — **DB-backed source of truth** (top-level
 * `reactions/` obligation, Ticket G / branch 39).
 *
 * Module ownership was promoted from `src/http/reactions/` to the
 * top-level `src/reactions/` obligation in the architecture-boundary
 * follow-up (PR #44 review). The catalog is a shared resource between
 * the `home/` (which renders chips + the picker) and the `admin/`
 * surface (which manages the rows). The HTTP boundary itself does
 * not own the catalog — the reactions API treats the request body's
 * `value` as an opaque ≤16-char string and never reads the catalog
 * at write time. ADR-0008 §2 calls out that a resource co-owned by
 * two obligations becomes its own owner; the canonical import path
 * is `reactions/emoji-catalog` (no `http/` prefix).
 *
 * Migrated from Ticket E (branch 37, hard-coded catalog) → Ticket G
 * (branch 39, D1-backed). Slug contract (`^[a-z][a-z0-9_]*$`,
 * 1..16 chars — aligned to the reactions API's `MAX_EMOJI_LEN`) is
 * unchanged for any slug a visitor could actually emit via the
 * reactions endpoint. The DB row is keyed by `slug`; renames are
 * not supported and removing a slug does NOT retroactively rewrite
 * existing reactions — slugs are stable opaque keys.
 *
 * Design choices captured in `docs/adr/ADR-0013-emoji-catalog-db-backed.md`:
 *
 *   - `enabled = 0` hides the chip from the home widget without
 *     touching existing reactions. The reactions API continues to
 *     accept any opaque `value` it has been given (we do not enforce
 *     enabled state at write time — see ADR-0013 §3 for the
 *     rationale).
 *   - Reads are by `(slug)` PK or full-list; no cache layer is added
 *     in 0.3.0. The home loader primes the in-request catalog once.
 *   - Reads happen at SSR time via `cloudflare:workers` `env.DB`;
 *     writes happen from admin server-fn wrappers that share the
 *     same D1 binding (no HTTP boundary crossing).
 */

import { EMOJI_SLUG_REGEX, MAX_EMOJI_SLUG_LEN } from './slug-regex';
import {
	MAX_CODEPOINT_LEN,
	validateCodepoint as validateCodepointImpl,
	validateSlug as validateSlugImpl,
} from './slug-validate';

// Re-export the slug regex / length / codepoint validator so the
// single canonical import path is `reactions/emoji-catalog`.
export { EMOJI_SLUG_REGEX, MAX_EMOJI_SLUG_LEN, MAX_CODEPOINT_LEN };
export { validateCodepointImpl as validateCodepoint, validateSlugImpl as validateSlug };

/** Raw D1 row from `reaction_emoji_catalog`. */
export interface ReactionEmojiRow {
	slug: string;
	codepoint: string;
	enabled: 0 | 1;
	created_by: string | null;
	created_at: number;
	updated_at: number;
}

/** Resolved catalog entry — only what callers care about. */
export interface CatalogEntry {
	slug: string;
	codepoint: string;
	enabled: boolean;
}

/**
 * Admin-facing row including audit fields. `enabled` stays as the
 * raw `0 | 1` integer that D1 returns (D1 has no native boolean);
 * the UI converts at the DTO boundary.
 */
export interface AdminCatalogRow {
	slug: string;
	codepoint: string;
	enabled: 0 | 1;
	created_by: string | null;
	created_at: number;
	updated_at: number;
}

export interface LoadCatalogOptions {
	/** When true, returns ALL rows including disabled ones. */
	includeDisabled?: boolean;
}

/**
 * Load the active catalog (enabled rows only) sorted by slug ascending.
 * Used by the home widget.
 */
export async function loadCatalog(
	db: D1Database,
	options: LoadCatalogOptions = {},
): Promise<readonly CatalogEntry[]> {
	const sql = options.includeDisabled
		? 'SELECT slug, codepoint, enabled FROM reaction_emoji_catalog ORDER BY slug ASC'
		: 'SELECT slug, codepoint, enabled FROM reaction_emoji_catalog WHERE enabled = 1 ORDER BY slug ASC';
	const result = await db.prepare(sql).all<{
		slug: string;
		codepoint: string;
		enabled: number;
	}>();
	const rows = (result.results ?? []).map((r) => ({
		slug: r.slug,
		codepoint: r.codepoint,
		enabled: r.enabled === 1,
	}));
	return rows;
}

/**
 * Load every catalog row including disabled ones, with timestamps and
 * `created_by` so the admin UI can show audit information. Used by
 * `src/admin/emoji-catalog/load.ts`. Returns rows sorted by slug.
 */
export async function listAllCatalogEntriesForAdmin(
	db: D1Database,
): Promise<readonly AdminCatalogRow[]> {
	const result = await db
		.prepare(
			'SELECT slug, codepoint, enabled, created_by, created_at, updated_at FROM reaction_emoji_catalog ORDER BY slug ASC',
		)
		.all<AdminCatalogRow>();
	return result.results ?? [];
}

/**
 * Load a single catalog row by slug. Returns `null` when the slug is
 * not in the table. Used by the admin UI to load the rebind target.
 */
export async function getCatalogEntry(db: D1Database, slug: string): Promise<CatalogEntry | null> {
	const row = await db
		.prepare('SELECT slug, codepoint, enabled FROM reaction_emoji_catalog WHERE slug = ?1')
		.bind(slug)
		.first<{ slug: string; codepoint: string; enabled: number }>();
	if (!row) return null;
	return { slug: row.slug, codepoint: row.codepoint, enabled: row.enabled === 1 };
}

/**
 * Insert a new catalog row. Throws on UNIQUE constraint violations
 * (duplicate slug). Caller is expected to pre-validate the slug and
 * codepoint via `validateSlug` / `validateCodepoint`.
 *
 * Atomicity: D1 writes are single-statement atomic. The PK on `slug`
 * is the duplicate detector. There is no concurrent-write hazard
 * for inserts (slug is a chosen value).
 */
export async function insertCatalogEntry(
	db: D1Database,
	input: { slug: string; codepoint: string; created_by: string | null },
	now: number,
): Promise<void> {
	await db
		.prepare(
			'INSERT INTO reaction_emoji_catalog (slug, codepoint, enabled, created_by, created_at, updated_at) VALUES (?1, ?2, 1, ?3, ?4, ?4)',
		)
		.bind(input.slug, input.codepoint, input.created_by, now)
		.run();
}

/**
 * Update the codepoint of an existing slug. Admin rebind — slug is
 * the PK, codepoint is the new glyph. `now` is the updated_at
 * timestamp.
 */
export async function rebindCatalogEntry(
	db: D1Database,
	input: { slug: string; codepoint: string },
	now: number,
): Promise<{ updated: boolean }> {
	const result = await db
		.prepare('UPDATE reaction_emoji_catalog SET codepoint = ?1, updated_at = ?2 WHERE slug = ?3')
		.bind(input.codepoint, now, input.slug)
		.run();
	return { updated: (result.meta?.changes ?? 0) > 0 };
}

/**
 * Toggle the `enabled` flag for an existing slug. When disabling,
 * existing reactions with this slug are unaffected — they stay in
 * the `reactions` table, but the home widget stops showing the
 * chip and the picker.
 */
export async function setCatalogEntryEnabled(
	db: D1Database,
	input: { slug: string; enabled: boolean },
	now: number,
): Promise<{ updated: boolean }> {
	const result = await db
		.prepare('UPDATE reaction_emoji_catalog SET enabled = ?1, updated_at = ?2 WHERE slug = ?3')
		.bind(input.enabled ? 1 : 0, now, input.slug)
		.run();
	return { updated: (result.meta?.changes ?? 0) > 0 };
}

/**
 * Remove a catalog row by slug. The reactions API still accepts
 * opaque `value` strings, so historical reactions referencing a
 * removed slug keep working — they just stop rendering on the home.
 */
export async function removeCatalogEntry(
	db: D1Database,
	slug: string,
): Promise<{ removed: boolean }> {
	const result = await db
		.prepare('DELETE FROM reaction_emoji_catalog WHERE slug = ?1')
		.bind(slug)
		.run();
	return { removed: (result.meta?.changes ?? 0) > 0 };
}

/**
 * Look up the codepoint for a slug inside a loaded catalog. Returns
 * `null` when the slug is not present OR is disabled — callers
 * (home widget) render the inert `:slug:` placeholder in either
 * case. This keeps the slug → glyph resolution identical between
 * the hard-coded and DB-backed catalogs.
 */
export function resolveCodepoint(catalog: readonly CatalogEntry[], slug: string): string | null {
	const row = catalog.find((r) => r.slug === slug);
	return row?.enabled ? row.codepoint : null;
}

/**
 * Check whether a slug is in the catalog AND enabled. The home
 * widget's picker row is driven by this — disabled slugs do not
 * appear.
 */
export function isEnabled(catalog: readonly CatalogEntry[], slug: string): boolean {
	const row = catalog.find((r) => r.slug === slug);
	return row?.enabled === true;
}
