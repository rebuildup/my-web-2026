import type { PortfolioLoader, PortfolioEnv } from './contract';
import {
	type ListPortfolioProjectsOptions,
	type PortfolioCursor,
	type PortfolioLink,
	type PortfolioLinkRow,
	type PortfolioListPage,
	type PortfolioMedia,
	type PortfolioMediaRow,
	type PortfolioProject,
	type PortfolioProjectRow,
	decodeCursor,
	encodeCursor,
	rowToLink,
	rowToMedia,
	rowToProject,
	VisibilitySchema,
} from './schema';
import { composeMediaUrl } from './media';

/**
 * D1-backed PortfolioLoader implementation.
 *
 * Lives in `src/portfolio/load.ts` (not `index.ts`) because:
 *   * the file pulls in D1 / R2 binding types via `PortfolioEnv`,
 *   * those imports must stay server-side (TanStack Start's
 *     import-protection plugin forbids them in client-reachable
 *     modules — see `src/home/reactions/load.ts` for the same
 *     rationale),
 *   * `src/portfolio/index.ts` re-exports a thin surface for
 *     consumers.
 *
 * DI seam: every public function takes `env` first. The
 * `createServerFn().handler()` wrappers in `public.ts` resolve
 * `env` from `cloudflare:workers` inside the handler body,
 * matching the home reactions pattern.
 *
 * Public-visibility contract:
 *   This loader is **public-only**. It filters rows to
 *   `status='published' AND visibility='public'` and refuses to
 *   surface unlisted / draft / archived rows even when the
 *   caller passes a slug directly. Admin / preview surfaces that
 *   need broader visibility must build their own loader (NOT
 *   here — this module owns the public contract only).
 */

export function createD1PortfolioLoader(env: PortfolioEnv): PortfolioLoader {
	return {
		loadPortfolioProject: (slug) => loadPortfolioProjectImpl(env, slug),
		listPortfolioProjects: (opts) => listPortfolioProjectsImpl(env, opts),
	};
}

async function loadPortfolioProjectImpl(
	env: PortfolioEnv,
	slug: string,
): Promise<PortfolioProject | null> {
	const db = env.DB;
	if (!db) return null;
	const row = await db
		.prepare(
			"SELECT * FROM portfolio_project WHERE slug = ?1 AND status = 'published' AND visibility = 'public'",
		)
		.bind(slug)
		.first<PortfolioProjectRow>();
	if (!row) return null;
	// Defence in depth: even if a future query path drops the
	// SQL filter, `isVisible` still refuses non-public rows.
	if (!isVisible(row)) return null;
	const [links, media] = await Promise.all([fetchLinks(db, row.id), fetchMedia(db, row.id)]);
	const mediaWithUrls = media.map((m) => ({
		...m,
		url: composeMediaUrl(env, m.r2Key),
	}));
	return rowToProject(row, links, mediaWithUrls);
}

async function listPortfolioProjectsImpl(
	env: PortfolioEnv,
	opts: ListPortfolioProjectsOptions = {},
): Promise<PortfolioListPage> {
	const db = env.DB;
	if (!db) return emptyPage();
	const limit = clampLimit(opts.limit);

	const cursor = decodeCursorOrNull(opts.cursor);
	// Build a parameterised SQL with the public-only filter
	// always on. SQLite caps the host-parameter count at 999 —
	// well below any realistic facet / cursor cardinality, so we
	// inline the placeholders directly.
	//
	// Stable ordering: `pinned DESC, display_order ASC, updated_at
	// DESC, id ASC`. `id` is the final tiebreaker; without it,
	// two rows that share every other key would be returned in
	// arbitrary order across pages (and could be skipped or
	// duplicated). This is the contract that `Issue #77 UI` will
	// rely on for cursor-paged navigation.
	const cursorPredicate = cursor
		? ` AND (
			pinned < ? OR
			(pinned = ? AND display_order > ?) OR
			(pinned = ? AND display_order = ? AND updated_at < ?) OR
			(pinned = ? AND display_order = ? AND updated_at = ? AND id > ?)
		)`
		: '';
	const sql = `
		SELECT * FROM portfolio_project
		WHERE status = 'published' AND visibility = 'public'${cursorPredicate}
		ORDER BY pinned DESC, display_order ASC, updated_at DESC, id ASC
		LIMIT ?
	`;

	// Fetch limit+1 so we can detect "has next page" without a
	// separate COUNT query.
	const fetchLimit = limit + 1;
	const stmt = db.prepare(sql);
	const binds: Array<string | number> = [];
	if (cursor) binds.push(...cursorBinds(cursor));
	binds.push(fetchLimit);
	const result = await stmt.bind(...binds).all<PortfolioProjectRow>();
	const rawRows = result.results ?? [];

	const pageRows = rawRows.length > limit ? rawRows.slice(0, limit) : rawRows;
	const hasMore = rawRows.length > limit;

	const facetFilter = opts.facets && opts.facets.length > 0 ? opts.facets : null;
	const filteredRows = facetFilter
		? pageRows.filter((row) => intersectsAny(row.facets, facetFilter))
		: pageRows;

	const projects: PortfolioProject[] = [];
	for (const row of filteredRows) {
		const [links, media] = await Promise.all([fetchLinks(db, row.id), fetchMedia(db, row.id)]);
		const mediaWithUrls = media.map((m) => ({
			...m,
			url: composeMediaUrl(env, m.r2Key),
		}));
		projects.push(rowToProject(row, links, mediaWithUrls));
	}

	// Build nextCursor from the LAST returned row (post-filter)
	// because facet filtering can change which row is "last" —
	// we always advance from the last row the caller actually saw.
	const lastRow = filteredRows[filteredRows.length - 1];
	const nextCursor =
		hasMore && lastRow
			? encodeCursor({
					p: lastRow.pinned,
					d: lastRow.display_order,
					u: lastRow.updated_at,
					i: lastRow.id,
				})
			: null;

	return { projects, nextCursor };
}

function emptyPage(): PortfolioListPage {
	return { projects: [], nextCursor: null };
}

function clampLimit(input: number | undefined): number {
	if (typeof input !== 'number' || !Number.isFinite(input)) return 100;
	return Math.max(1, Math.min(500, Math.floor(input)));
}

/**
 * Decode the cursor if present. Returns `null` for absent /
 * malformed cursors so the caller falls back to the first page.
 * Malformed cursors are intentionally treated as "start over"
 * (not as an error) — the public surface prefers a fresh page
 * to a 5xx when a client ships a stale cursor.
 */
function decodeCursorOrNull(raw: string | null | undefined): PortfolioCursor | null {
	if (!raw) return null;
	return decodeCursor(raw);
}

/**
 * Expand a `PortfolioCursor` to the bind parameters for the
 * mixed-direction row-value predicate. Each key appears
 * multiple times because the predicate is a chain of ORs and
 * equality checks against the previous key.
 *
 * 10 binds total: pinned / display_order / updated_at appear in
 * both their inequality and equality slots, and `id` is the
 * final lexicographic tiebreaker (TEXT column).
 */
function cursorBinds(c: PortfolioCursor): ReadonlyArray<string | number> {
	const p = c.p;
	const d = c.d;
	const u = c.u;
	const i = c.i;
	return [
		// branch 1: pinned < ?
		p,
		// branch 2: pinned = ? AND display_order > ?
		p,
		d,
		// branch 3: pinned = ? AND display_order = ? AND updated_at < ?
		p,
		d,
		u,
		// branch 4: pinned = ? AND display_order = ? AND updated_at = ? AND id > ?
		p,
		d,
		u,
		i,
	];
}

/**
 * Decide whether a row should be served to a public caller.
 * This is the *single source of truth* for the public visibility
 * boundary: a row is visible only when `status='published'`
 * AND `visibility='public'`. Unlisted, draft, and archived
 * rows always resolve to invisible.
 *
 * Defence in depth: even if a future query path drops the SQL
 * filter, `isVisible` still refuses non-public rows.
 */
function isVisible(row: PortfolioProjectRow): boolean {
	const visibility = VisibilitySchema.safeParse(row.visibility);
	if (!visibility.success) return false;
	if (row.status !== 'published') return false;
	return visibility.data === 'public';
}

async function fetchLinks(db: D1Database, projectId: string): Promise<readonly PortfolioLink[]> {
	const result = await db
		.prepare(
			'SELECT * FROM portfolio_link WHERE project_id = ?1 ORDER BY display_order ASC, created_at ASC',
		)
		.bind(projectId)
		.all<PortfolioLinkRow>();
	const rows = result.results ?? [];
	return rows.map(rowToLink);
}

async function fetchMedia(db: D1Database, projectId: string): Promise<readonly PortfolioMedia[]> {
	const result = await db
		.prepare(
			'SELECT * FROM portfolio_media WHERE project_id = ?1 ORDER BY is_cover DESC, display_order ASC, created_at ASC',
		)
		.bind(projectId)
		.all<PortfolioMediaRow>();
	const rows = result.results ?? [];
	return rows.map(rowToMedia);
}

/**
 * Pure helper: does the JSON-encoded `facets` array contain any
 * of the requested filter values? Used by `listPortfolioProjects`
 * to filter without round-tripping to D1.
 */
export function intersectsAny(facetsJson: string, want: readonly string[]): boolean {
	let parsed: unknown;
	try {
		parsed = JSON.parse(facetsJson);
	} catch {
		return false;
	}
	if (!Array.isArray(parsed)) return false;
	const set = new Set<string>();
	for (const v of parsed) {
		if (typeof v === 'string') set.add(v);
	}
	for (const w of want) {
		if (set.has(w)) return true;
	}
	return false;
}
