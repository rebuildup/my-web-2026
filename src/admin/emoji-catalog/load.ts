import { env } from 'cloudflare:workers';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
	insertCatalogEntry,
	listAllCatalogEntriesForAdmin,
	rebindCatalogEntry,
	removeCatalogEntry,
	setCatalogEntryEnabled,
} from '../../http/reactions/emoji-catalog';
import { validateCodepoint, validateSlug } from '../../http/reactions/slug-validate';
import { requireAdmin } from '../auth/require-admin';

/**
 * Admin emoji-catalog CRUD — Ticket G (branch 39).
 *
 * The catalog is the source of truth for slug → glyph mapping on the
 * home widget. Admins add new slugs (e.g. for a new emoji vocabulary),
 * rebind an existing slug's codepoint (e.g. to change a glyph without
 * breaking existing reactions), disable a slug (hides the chip
 * without deleting history), or remove a slug entirely.
 *
 * Per ADR-0008, admin operations do not cross a Hono boundary —
 * `cloudflare:workers` `env.DB` flows in directly.
 *
 * Slug + codepoint validation runs at the seam so malformed values
 * never reach D1. The slug is the PK, so duplicate inserts are
 * reported as `slug_exists`. The disabled-vs-removed distinction
 * is preserved by the admin UI: disabling is non-destructive,
 * removing is destructive (existing reactions with that slug still
 * survive in D1 but no chip renders).
 */

export interface AdminCatalogEntry {
	slug: string;
	codepoint: string;
	enabled: boolean;
	createdBy: string | null;
	createdAt: string;
	updatedAt: string;
}

const InsertInput = z.object({
	slug: z.string().min(1).max(32),
	codepoint: z.string().min(1).max(16),
});

const RebindInput = z.object({
	slug: z.string().min(1).max(32),
	codepoint: z.string().min(1).max(16),
});

const SetEnabledInput = z.object({
	slug: z.string().min(1).max(32),
	enabled: z.boolean(),
});

const RemoveInput = z.object({ slug: z.string().min(1).max(32) });

async function listImpl(): Promise<readonly AdminCatalogEntry[]> {
	const rows = await listAllCatalogEntriesForAdmin(env.DB);
	return rows.map(toAdminEntry);
}

export const listCatalog = createServerFn({ method: 'GET' })
	.validator(z.object({}).strict())
	.handler(async (): Promise<readonly AdminCatalogEntry[]> => {
		await requireAdmin();
		return listImpl();
	});

export const insertCatalogEntryFn = createServerFn({ method: 'POST' })
	.validator(InsertInput)
	.handler(async ({ data }): Promise<{ created: boolean }> => {
		const session = await requireAdmin();
		const slug = validateSlug(data.slug);
		const codepoint = validateCodepoint(data.codepoint);
		try {
			await insertCatalogEntry(
				env.DB,
				{ slug, codepoint, created_by: session.user.id },
				Date.now(),
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			// D1 surfaces PK conflicts via this exact message shape.
			if (/UNIQUE constraint failed: reaction_emoji_catalog\.slug/i.test(message)) {
				throw new Error('slug_exists');
			}
			throw err;
		}
		return { created: true };
	});

export const rebindCatalogEntryFn = createServerFn({ method: 'POST' })
	.validator(RebindInput)
	.handler(async ({ data }): Promise<{ updated: boolean }> => {
		await requireAdmin();
		const slug = validateSlug(data.slug);
		const codepoint = validateCodepoint(data.codepoint);
		const result = await rebindCatalogEntry(env.DB, { slug, codepoint }, Date.now());
		return { updated: result.updated };
	});

export const setCatalogEntryEnabledFn = createServerFn({ method: 'POST' })
	.validator(SetEnabledInput)
	.handler(async ({ data }): Promise<{ updated: boolean }> => {
		await requireAdmin();
		const slug = validateSlug(data.slug);
		const result = await setCatalogEntryEnabled(
			env.DB,
			{ slug, enabled: data.enabled },
			Date.now(),
		);
		return { updated: result.updated };
	});

export const removeCatalogEntryFn = createServerFn({ method: 'POST' })
	.validator(RemoveInput)
	.handler(async ({ data }): Promise<{ removed: boolean }> => {
		await requireAdmin();
		const slug = validateSlug(data.slug);
		const result = await removeCatalogEntry(env.DB, slug);
		return { removed: result.removed };
	});

function toAdminEntry(row: {
	slug: string;
	codepoint: string;
	enabled: boolean;
	created_by: string | null;
	created_at: number;
	updated_at: number;
}): AdminCatalogEntry {
	return {
		slug: row.slug,
		codepoint: row.codepoint,
		enabled: row.enabled,
		createdBy: row.created_by,
		createdAt: new Date(row.created_at).toISOString(),
		updatedAt: new Date(row.updated_at).toISOString(),
	};
}
