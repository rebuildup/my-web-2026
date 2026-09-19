import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	insertCatalogEntry,
	listAllCatalogEntriesForAdmin,
	loadCatalog,
	rebindCatalogEntry,
	removeCatalogEntry,
	resolveCodepoint,
	setCatalogEntryEnabled,
	validateCodepoint,
	validateSlug,
} from './emoji-catalog';

/**
 * DB-backed emoji catalog tests (Ticket G, branch 39, top-level
 * `reactions/` obligation).
 *
 * Covers:
 *   - DDL applied via `migrations/0004_emoji_catalog.sql`.
 *   - Insert / rebind / enable / remove round-trips.
 *   - loadCatalog returns the active subset (no disabled rows).
 *   - listAllCatalogEntriesForAdmin returns enabled + disabled rows
 *     with audit fields.
 *   - Pure helpers (validateSlug, validateCodepoint, resolveCodepoint).
 */

const CATALOG_SQL = `
CREATE TABLE IF NOT EXISTS reaction_emoji_catalog (
    slug         TEXT    PRIMARY KEY,
    codepoint    TEXT    NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_by   TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reaction_emoji_catalog_enabled
    ON reaction_emoji_catalog(enabled);
`;

async function applySchema(): Promise<void> {
	for (const stmt of CATALOG_SQL.split(';')
		.map((s) => s.trim())
		.filter(Boolean)) {
		await env.DB.prepare(stmt).run();
	}
}

async function clearCatalog(): Promise<void> {
	await env.DB.prepare('DELETE FROM reaction_emoji_catalog').run();
}

describe('emoji-catalog — D1 round-trip', () => {
	beforeEach(async () => {
		await applySchema();
		await clearCatalog();
	});
	afterEach(async () => {
		await clearCatalog();
	});

	it('insert + loadCatalog returns the new slug in sorted order', async () => {
		await insertCatalogEntry(env.DB, { slug: 'rocket', codepoint: '🚀', created_by: null }, 1);
		await insertCatalogEntry(env.DB, { slug: 'thumbs_up', codepoint: '👍', created_by: null }, 2);
		const rows = await loadCatalog(env.DB);
		expect(rows.map((r) => r.slug)).toEqual(['rocket', 'thumbs_up']);
		expect(rows[0]).toEqual({ slug: 'rocket', codepoint: '🚀', enabled: true });
	});

	it('loadCatalog filters out disabled rows by default; includeDisabled returns them', async () => {
		await insertCatalogEntry(env.DB, { slug: 'rocket', codepoint: '🚀', created_by: null }, 1);
		await insertCatalogEntry(env.DB, { slug: 'bulb', codepoint: '💡', created_by: null }, 2);
		await setCatalogEntryEnabled(env.DB, { slug: 'bulb', enabled: false }, 3);

		const activeOnly = await loadCatalog(env.DB);
		expect(activeOnly.map((r) => r.slug)).toEqual(['rocket']);

		const all = await loadCatalog(env.DB, { includeDisabled: true });
		expect(all.map((r) => r.slug)).toEqual(['bulb', 'rocket']);
		expect(all.find((r) => r.slug === 'bulb')?.enabled).toBe(false);
	});

	it('rebind updates the codepoint and bumped updated_at', async () => {
		await insertCatalogEntry(
			env.DB,
			{ slug: 'rocket', codepoint: '🚀', created_by: 'admin-x' },
			100,
		);
		const before = await listAllCatalogEntriesForAdmin(env.DB);
		expect(before[0].codepoint).toBe('🚀');
		const createdAt = before[0].created_at;
		const updatedAtBefore = before[0].updated_at;

		const result = await rebindCatalogEntry(env.DB, { slug: 'rocket', codepoint: '🚁' }, 200);
		expect(result.updated).toBe(true);

		const after = await listAllCatalogEntriesForAdmin(env.DB);
		expect(after[0].codepoint).toBe('🚁');
		expect(after[0].updated_at).toBeGreaterThan(updatedAtBefore);
		expect(after[0].created_at).toBe(createdAt);
	});

	it('setCatalogEntryEnabled toggles enabled + bumps updated_at', async () => {
		await insertCatalogEntry(env.DB, { slug: 'rocket', codepoint: '🚀', created_by: null }, 100);
		const result = await setCatalogEntryEnabled(env.DB, { slug: 'rocket', enabled: false }, 200);
		expect(result.updated).toBe(true);
		const row = (await listAllCatalogEntriesForAdmin(env.DB))[0];
		// `AdminCatalogRow.enabled` is the raw D1 integer; the helper
		// converts it to boolean for callers (see `CatalogEntry`).
		expect(row.enabled).toBe(0);
		expect(row.updated_at).toBe(200);
	});

	it('removeCatalogEntry deletes by slug; missing slug returns removed=false', async () => {
		await insertCatalogEntry(env.DB, { slug: 'rocket', codepoint: '🚀', created_by: null }, 1);
		const result = await removeCatalogEntry(env.DB, 'rocket');
		expect(result.removed).toBe(true);
		const rows = await listAllCatalogEntriesForAdmin(env.DB);
		expect(rows).toHaveLength(0);

		const missing = await removeCatalogEntry(env.DB, 'unknown');
		expect(missing.removed).toBe(false);
	});

	it('insertCatalogEntry surfaces UNIQUE-constraint violation on duplicate slug', async () => {
		await insertCatalogEntry(env.DB, { slug: 'rocket', codepoint: '🚀', created_by: null }, 1);
		await expect(
			insertCatalogEntry(env.DB, { slug: 'rocket', codepoint: '🚁', created_by: null }, 2),
		).rejects.toThrow(/UNIQUE constraint failed: reaction_emoji_catalog\.slug/);
	});

	it('listAllCatalogEntriesForAdmin surfaces created_by + created_at + updated_at', async () => {
		await insertCatalogEntry(
			env.DB,
			{ slug: 'rocket', codepoint: '🚀', created_by: 'admin-x' },
			100,
		);
		const rows = await listAllCatalogEntriesForAdmin(env.DB);
		expect(rows).toHaveLength(1);
		expect(rows[0].created_by).toBe('admin-x');
		expect(rows[0].created_at).toBe(100);
		expect(rows[0].updated_at).toBe(100);
	});
});

describe('validateSlug', () => {
	it('accepts well-formed slugs', () => {
		expect(validateSlug('thumbs_up')).toBe('thumbs_up');
		expect(validateSlug('rocket_v2')).toBe('rocket_v2');
		expect(validateSlug('a')).toBe('a');
	});

	it('rejects non-strings', () => {
		expect(() => validateSlug(0)).toThrow(/must be a string/);
		expect(() => validateSlug(null)).toThrow(/must be a string/);
		expect(() => validateSlug({})).toThrow(/must be a string/);
	});

	it('rejects length violations', () => {
		expect(() => validateSlug('')).toThrow(/1\.\./);
		expect(() => validateSlug('a'.repeat(17))).toThrow(/1\.\./);
	});

	it('rejects grammar violations', () => {
		expect(() => validateSlug('Thumbs_Up')).toThrow(/must match/);
		expect(() => validateSlug('1leading')).toThrow(/must match/);
		expect(() => validateSlug('with-dash')).toThrow(/must match/);
		expect(() => validateSlug('with space')).toThrow(/must match/);
	});
});

describe('validateCodepoint', () => {
	it('accepts plain emoji', () => {
		expect(validateCodepoint('👍')).toBe('👍');
		expect(validateCodepoint('🚀')).toBe('🚀');
	});

	it('accepts ZWJ sequences within the length cap', () => {
		expect(validateCodepoint('👨‍👩‍👧‍👦')).toBe('👨‍👩‍👧‍👦');
	});

	it('rejects empty / non-string', () => {
		expect(() => validateCodepoint('')).toThrow(/1\.\./);
		expect(() => validateCodepoint(0)).toThrow(/must be a string/);
		expect(() => validateCodepoint(null)).toThrow(/must be a string/);
	});

	it('rejects control chars', () => {
		expect(() => validateCodepoint('👍\n')).toThrow(/control chars/);
		expect(() => validateCodepoint('\t👍')).toThrow(/control chars/);
	});
});

describe('resolveCodepoint', () => {
	const catalog = [
		{ slug: 'thumbs_up', codepoint: '👍', enabled: true },
		{ slug: 'rocket', codepoint: '🚀', enabled: true },
		{ slug: 'bulb', codepoint: '💡', enabled: false },
	];

	it('returns the codepoint for enabled slugs', () => {
		expect(resolveCodepoint(catalog, 'thumbs_up')).toBe('👍');
		expect(resolveCodepoint(catalog, 'rocket')).toBe('🚀');
	});

	it('returns null for disabled slugs', () => {
		expect(resolveCodepoint(catalog, 'bulb')).toBeNull();
	});

	it('returns null for unknown slugs', () => {
		expect(resolveCodepoint(catalog, 'unknown')).toBeNull();
	});

	it('returns null for an empty catalog', () => {
		expect(resolveCodepoint([], 'thumbs_up')).toBeNull();
	});
});
