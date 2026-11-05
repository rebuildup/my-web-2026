import type { PortfolioEnv, PortfolioLoader } from './contract';
import { composeMediaUrl } from './media';
import { compareProjects } from './notion/publish';
import { notionProjects } from './notion/reader';
import {
	type ListPortfolioProjectsOptions,
	type PortfolioAdjacent,
	type PortfolioAdjacentRef,
	type PortfolioCursor,
	type PortfolioLink,
	type PortfolioLinkRow,
	type PortfolioListPage,
	type PortfolioMedia,
	type PortfolioMediaRow,
	type PortfolioProject,
	type PortfolioProjectIndexEntry,
	type PortfolioProjectRow,
	VisibilitySchema,
	decodeCursor,
	encodeCursor,
	rowToLink,
	rowToMedia,
	rowToProject,
} from './schema';

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
 *
 * Round-trip contract (Issue #491):
 *   Every public read has a D1 statement BUDGET exported below
 *   (`PORTFOLIO_DETAIL_QUERY_BUDGET`,
 *   `portfolioListQueryBudget`). Links and media are read for a
 *   whole page in two batched statements, never per row, so the
 *   statement count does not grow linearly with the number of
 *   projects on the page. The budgets are asserted against real
 *   fixture sizes in `load.query-budget.test.ts`.
 */

/**
 * Issue #491 — D1 round-trip budget for the public read surfaces.
 *
 * These are BOUNDARY VALUES, not measurements: the N+1 detector
 * (`src/portfolio/load.query-budget.test.ts`) asserts that the
 * loader stays at or under them for every fixture size, so a
 * future change that reintroduces a per-row query fails the
 * suite instead of shipping silently.
 *
 *   detail surface (`/portfolio/<slug>`): 1 target query + 1
 *   link query + 1 media query = 3, independent of how many
 *   links / media the project owns.
 *
 *   list surface (`/portfolio`): 1 page query + one batched
 *   link query and one batched media query per id chunk, i.e.
 *   `1 + 2 * ceil(pageSize / D1_BATCH_ID_CHUNK)`.
 *
 * The list budget is sub-linear, never linear: the growth per
 * extra project on a page is `2 / D1_BATCH_ID_CHUNK` statements
 * (0.02 at the current chunk size), and exactly 0 for every page
 * that fits in one chunk.
 */
export const PORTFOLIO_DETAIL_QUERY_BUDGET = 3;

/**
 * Maximum number of bound parameters in one D1 statement.
 *
 * Cloudflare D1 documents a hard cap of 100 bound parameters per
 * query (D1 platform limits). The batched child queries below
 * bind exactly one parameter per project id and nothing else, so
 * the number of ids a single statement may carry is that cap.
 *
 * This is deliberately NOT the SQLite engine limit (32766 host
 * parameters) and not the 999 figure older SQLite builds shipped:
 * D1 rejects the statement before SQLite sees it.
 */
export const D1_BATCH_ID_CHUNK = 100;

/**
 * Maximum D1 statements `listPortfolioProjects` may issue for a
 * page of `pageSize` projects. See `PORTFOLIO_DETAIL_QUERY_BUDGET`
 * for the reasoning behind the shape.
 *
 * `cmsMerged` adds exactly one statement: the narrow `slug` projection that
 * decides which slugs the CMS may NOT contribute. A slug held by both
 * sources resolves to the D1 row in `loadPortfolioProject`, and the list has
 * to make the same choice or it renders two cards for one URL
 * (Issue #765).
 */
export function portfolioListQueryBudget(pageSize: number, cmsMerged = false): number {
	const size = Number.isFinite(pageSize) ? Math.max(0, Math.floor(pageSize)) : 0;
	const slugProjection = cmsMerged ? 1 : 0;
	if (size === 0) return 1 + slugProjection; // empty page: the page query alone
	return 1 + slugProjection + 2 * Math.ceil(size / D1_BATCH_ID_CHUNK);
}

/**
 * Loader construction options.
 *
 * `cmsProjects` exists for two reasons, and neither is a production
 * override: it is how a test reaches the merge path (the bundled snapshot
 * is empty until a Notion database is connected), and it keeps the source
 * of CMS rows at ONE place — the factory — instead of a module constant
 * every method reaches for.
 */
export interface PortfolioLoaderOptions {
	readonly cmsProjects?: readonly PortfolioProject[];
}

export function createD1PortfolioLoader(
	env: PortfolioEnv,
	options: PortfolioLoaderOptions = {},
): PortfolioLoader {
	// The CMS rows are resolved ONCE, at construction, and passed down. That
	// is what makes the merge testable: a caller (or a test) can hand in a
	// fixed list instead of the bundled snapshot, and every method then
	// exercises the same merge code the deployment runs.
	const cms = options.cmsProjects ?? notionProjects();
	return {
		loadPortfolioProject: (slug) => loadPortfolioProjectImpl(env, slug, cms),
		loadPortfolioAdjacent: (slug) => loadPortfolioAdjacentImpl(env, slug, cms),
		listPortfolioProjects: (opts) => listPortfolioProjectsImpl(env, opts ?? {}, cms),
		listPublishedProjectIndex: () => listPublishedProjectIndexImpl(env, cms),
	};
}

async function loadPortfolioProjectImpl(
	env: PortfolioEnv,
	slug: string,
	cms: readonly PortfolioProject[],
): Promise<PortfolioProject | null> {
	const db = env.DB;
	if (!db)
		return withMediaUrlsOrNull(
			env,
			cms.find((project) => project.slug === slug),
		);
	const row = await db
		.prepare(
			"SELECT * FROM portfolio_project WHERE slug = ?1 AND status = 'published' AND visibility = 'public'",
		)
		.bind(slug)
		.first<PortfolioProjectRow>();
	if (!row) {
		// CMS fallback (Issue #765). `cms` is already filtered to
		// `published` + `public` by the same rule this module enforces, so a
		// draft CMS page is not reachable through a direct slug either.
		return withMediaUrlsOrNull(
			env,
			cms.find((project) => project.slug === slug),
		);
	}
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

/**
 * Resolve the project that sits immediately above / below the
 * target in canonical sort order (`pinned DESC, display_order
 * ASC, updated_at DESC, id ASC`).
 *
 * Both predicates share the cursor-pagination row-value chain
 * shape (10 binds), but the comparison is reversed: "next" uses
 * the same forward predicate as the cursor (rows AFTER target),
 * and "prev" uses the mirrored predicate (rows BEFORE target).
 * We `LIMIT 1` each query and `ORDER BY` canonical direction so
 * we always get the IMMEDIATE neighbour, not the farthest one.
 *
 * Public-visibility boundary: both queries hardcode
 * `status='published' AND visibility='public'` so an unlisted /
 * draft / archived row can never become the prev/next of a
 * public target — even when the target itself is the boundary.
 */
async function loadPortfolioAdjacentImpl(
	env: PortfolioEnv,
	slug: string,
	cms: readonly PortfolioProject[],
): Promise<PortfolioAdjacent> {
	const db = env.DB;
	if (!db) return adjacentFromSnapshot(slug, cms);
	if (cms.length > 0) {
		// Merged path (Issue #765). Adjacency is a question about the
		// ordering, not about a table, so when the CMS contributes rows the
		// ordering has to be computed over the union. One narrow projection
		// replaces the two row-value neighbour queries; the public-visibility
		// predicate stays inline exactly as it does in every other query
		// here, so an unlisted row still cannot surface as a neighbour.
		const result = await db
			.prepare(
				`SELECT slug, title, pinned, display_order, updated_at, id FROM portfolio_project
				 WHERE status = 'published' AND visibility = 'public'`,
			)
			.all<
				Pick<
					PortfolioProjectRow,
					'slug' | 'title' | 'pinned' | 'display_order' | 'updated_at' | 'id'
				>
			>();
		const entries: OrderableEntry[] = (result.results ?? []).map((row) => ({
			slug: row.slug,
			title: row.title,
			pinned: row.pinned === 1,
			displayOrder: row.display_order,
			updatedAt: row.updated_at,
			id: row.id,
		}));
		// Issue #765 — a slug both sources hold belongs to the D1 row here
		// for the same reason it does in `loadPortfolioProject`. This query
		// has no LIMIT, so the set is complete and the ordering never
		// contains one slug twice.
		const d1Slugs = new Set(entries.map((entry) => entry.slug));
		for (const project of cms) {
			if (d1Slugs.has(project.slug)) continue;
			entries.push({
				slug: project.slug,
				title: project.title,
				pinned: project.pinned,
				displayOrder: project.displayOrder,
				updatedAt: project.updatedAt,
				id: project.id,
			});
		}
		entries.sort(compareProjects);
		const index = entries.findIndex((entry) => entry.slug === slug);
		if (index === -1) return { prev: null, next: null };
		return {
			prev: index > 0 ? toAdjacentRef(entries[index - 1]) : null,
			next: index + 1 < entries.length ? toAdjacentRef(entries[index + 1]) : null,
		};
	}
	const target = await db
		.prepare(
			"SELECT pinned, display_order, updated_at, id FROM portfolio_project WHERE slug = ?1 AND status = 'published' AND visibility = 'public'",
		)
		.bind(slug)
		.first<Pick<PortfolioProjectRow, 'pinned' | 'display_order' | 'updated_at' | 'id'>>();
	if (!target) return { prev: null, next: null };

	// "Next" — first row AFTER the target in canonical sort order.
	// ORDER BY canonical direction: the closest row in "after me" sits
	// at the top of the filtered set.
	const nextSql = `
		SELECT slug, title FROM portfolio_project
		WHERE status = 'published' AND visibility = 'public' AND (
			pinned < ?1 OR
			(pinned = ?1 AND display_order > ?2) OR
			(pinned = ?1 AND display_order = ?2 AND updated_at < ?3) OR
			(pinned = ?1 AND display_order = ?2 AND updated_at = ?3 AND id > ?4)
		)
		ORDER BY pinned DESC, display_order ASC, updated_at DESC, id ASC
		LIMIT 1
	`;
	// "Prev" — last row BEFORE the target in canonical sort order.
	// The "before me" predicate captures every row that ranks above
	// the target; to pick the IMMEDIATE neighbour we ORDER BY the
	// reverse of canonical direction so the closest row sits at the
	// top. (Ordering by canonical direction here would pick the
	// farthest row, e.g. the topmost pinned entry.)
	const prevSql = `
		SELECT slug, title FROM portfolio_project
		WHERE status = 'published' AND visibility = 'public' AND (
			pinned > ?1 OR
			(pinned = ?1 AND display_order < ?2) OR
			(pinned = ?1 AND display_order = ?2 AND updated_at > ?3) OR
			(pinned = ?1 AND display_order = ?2 AND updated_at = ?3 AND id < ?4)
		)
		ORDER BY pinned ASC, display_order DESC, updated_at ASC, id DESC
		LIMIT 1
	`;

	const [prevRow, nextRow] = await Promise.all([
		db
			.prepare(prevSql)
			.bind(target.pinned, target.display_order, target.updated_at, target.id)
			.first<Pick<PortfolioProjectRow, 'slug' | 'title'>>(),
		db
			.prepare(nextSql)
			.bind(target.pinned, target.display_order, target.updated_at, target.id)
			.first<Pick<PortfolioProjectRow, 'slug' | 'title'>>(),
	]);

	return {
		prev: prevRow ? toAdjacentRef(prevRow) : null,
		next: nextRow ? toAdjacentRef(nextRow) : null,
	};
}

function toAdjacentRef(row: Pick<PortfolioProjectRow, 'slug' | 'title'>): PortfolioAdjacentRef {
	return { slug: row.slug, title: row.title };
}

/** A row of the merged ordering: D1 and CMS rows share these six fields. */
interface OrderableEntry {
	slug: string;
	title: string;
	pinned: boolean;
	displayOrder: number;
	updatedAt: number;
	id: string;
}

/** Adjacency from the CMS alone, for the case where D1 is unbound. */
function adjacentFromSnapshot(slug: string, cms: readonly PortfolioProject[]): PortfolioAdjacent {
	const entries: OrderableEntry[] = cms.map((project) => ({
		slug: project.slug,
		title: project.title,
		pinned: project.pinned,
		displayOrder: project.displayOrder,
		updatedAt: project.updatedAt,
		id: project.id,
	}));
	entries.sort(compareProjects);
	const index = entries.findIndex((entry) => entry.slug === slug);
	if (index === -1) return { prev: null, next: null };
	return {
		prev: index > 0 ? toAdjacentRef(entries[index - 1]) : null,
		next: index + 1 < entries.length ? toAdjacentRef(entries[index + 1]) : null,
	};
}

/** Compose the media origin onto a project that did not come from D1. */
function withMediaUrls(env: PortfolioEnv, project: PortfolioProject): PortfolioProject {
	return {
		...project,
		media: project.media.map((media) => ({
			...media,
			url: composeMediaUrl(env, media.r2Key),
		})),
	};
}

/** `withMediaUrls` for a lookup that may have found nothing. */
function withMediaUrlsOrNull(
	env: PortfolioEnv,
	project: PortfolioProject | undefined,
): PortfolioProject | null {
	return project === undefined ? null : withMediaUrls(env, project);
}

async function listPortfolioProjectsImpl(
	env: PortfolioEnv,
	opts: ListPortfolioProjectsOptions,
	cms: readonly PortfolioProject[],
): Promise<PortfolioListPage> {
	const db = env.DB;
	if (!db) {
		return cms.length > 0
			? { projects: cms.map((project) => withMediaUrls(env, project)), nextCursor: null }
			: emptyPage();
	}
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
	// Fetch limit+1 so we can detect "has next page" without a
	// separate COUNT query.
	const fetchLimit = limit + 1;
	// The statement text is passed inline on purpose. `scripts/check-d1-sql-binding.mjs`
	// only reads the literal argument of `prepare()`, so assembling this into a
	// `const sql` first would hide the `${cursorPredicate}` interpolation from the gate
	// and make its `SQL_STRUCTURE_ALLOWLIST` entry dead configuration. Inline, the gate
	// sees the interpolation and holds it to the reason recorded there.
	// See `docs/security.md#d1-parameter-binding-issue-452`.
	const stmt = db.prepare(`
		SELECT * FROM portfolio_project
		WHERE status = 'published' AND visibility = 'public'${cursorPredicate}
		ORDER BY pinned DESC, display_order ASC, updated_at DESC, id ASC
		LIMIT ?
	`);
	const binds: Array<string | number> = [];
	if (cursor) binds.push(...cursorBinds(cursor));
	binds.push(fetchLimit);
	// Issue #765 — the cross-source slug rule. The narrow `slug` projection
	// is issued only when the CMS actually contributes rows, and it runs
	// concurrently with the page query, so the merge costs no extra round
	// trip. Without it the merged list would carry a slug that D1 already
	// owns: `loadPortfolioProject` answers with the D1 row, so two cards
	// would point at one URL.
	const [result, d1SlugResult] = await Promise.all([
		stmt.bind(...binds).all<PortfolioProjectRow>(),
		cms.length > 0
			? db
					.prepare(
						`SELECT slug FROM portfolio_project
						 WHERE status = 'published' AND visibility = 'public'`,
					)
					.all<Pick<PortfolioProjectRow, 'slug'>>()
			: Promise.resolve(null),
	]);
	const rawRows = result.results ?? [];
	const d1Slugs = new Set((d1SlugResult?.results ?? []).map((row) => row.slug));

	const pageRows = rawRows.length > limit ? rawRows.slice(0, limit) : rawRows;
	const hasMore = rawRows.length > limit;

	const facetFilter = opts.facets && opts.facets.length > 0 ? opts.facets : null;
	const filteredRows = facetFilter
		? pageRows.filter((row) => intersectsAny(row.facets, facetFilter))
		: pageRows;

	// N+1 BOUNDARY (Issue #491). Links and media are fetched for the
	// WHOLE page in two batched statements, then grouped in memory.
	// The previous shape issued `fetchLinks` + `fetchMedia` per row,
	// so a page of N projects cost `1 + 2N` statements — a textbook
	// N+1 that grew linearly with data the caller never asked to
	// make more expensive. Both batches are independent, so they run
	// concurrently: 3 statements for any page up to
	// `D1_BATCH_ID_CHUNK` projects.
	const [linksByProject, mediaByProject] = await Promise.all([
		fetchLinksForProjects(
			db,
			filteredRows.map((row) => row.id),
		),
		fetchMediaForProjects(
			db,
			filteredRows.map((row) => row.id),
		),
	]);

	const d1Projects: PortfolioProject[] = filteredRows.map((row) => {
		const media = mediaByProject.get(row.id) ?? [];
		return rowToProject(
			row,
			linksByProject.get(row.id) ?? [],
			media.map((m) => ({ ...m, url: composeMediaUrl(env, m.r2Key) })),
		);
	});

	// CMS merge (Issue #765, ADR-0018 §2.2). The bundled snapshot is a
	// second source of rows, not a second publication boundary: every record
	// it offers has already passed `isPublicRecord` in `notion/publish.ts`,
	// and it is ordered with the same canonical key the D1 query uses, so a
	// caller paging through the list sees one ordering rather than two.
	//
	// The D1 page was fetched with `limit + 1`, which is enough to place the
	// union's first `limit` rows: a CMS row may interleave anywhere, but a D1
	// row beyond this page cannot outrank every row already on it.
	const cursorMarker = cursor
		? { pinned: cursor.p === 1, displayOrder: cursor.d, updatedAt: cursor.u, id: cursor.i }
		: null;
	const cmsProjects = cms
		.filter((project) => !d1Slugs.has(project.slug))
		.filter((project) => cursorMarker === null || compareProjects(project, cursorMarker) > 0)
		.filter((project) => (facetFilter ? facetFilter.some((f) => project.facets.includes(f)) : true))
		.map((project) => withMediaUrls(env, project));

	const merged =
		cmsProjects.length > 0 ? [...d1Projects, ...cmsProjects].sort(compareProjects) : d1Projects;
	const projects = merged.length > limit ? merged.slice(0, limit) : merged;

	// Advance from the last row the caller actually saw. With a CMS merge the
	// last row may come from either source; both carry the same four keys.
	const lastProject = projects[projects.length - 1];
	const nextCursor =
		(hasMore || merged.length > limit) && lastProject
			? encodeCursor({
					p: lastProject.pinned ? 1 : 0,
					d: lastProject.displayOrder,
					u: lastProject.updatedAt,
					i: lastProject.id,
				})
			: null;

	return { projects, nextCursor };
}

function emptyPage(): PortfolioListPage {
	return { projects: [], nextCursor: null };
}

/**
 * Public project index (Issue #420) — the URL identity of every
 * public+published project.
 *
 * One narrow query: `slug` + `updated_at` + the two visibility
 * columns. Unlike `listPortfolioProjectsImpl` it does not fan out to
 * the per-project link / media tables, because a URL enumerator has
 * no use for them, and it does not carry a `LIMIT`: a silent cap
 * would drop real published projects from a consumer's output without
 * any signal, which is exactly the failure mode this method exists to
 * prevent. If the project count ever approaches the sitemap protocol
 * ceiling (50 000 URLs), the right fix is an explicit, logged cap —
 * not a quiet one.
 *
 * `isVisible` re-checks each row in JavaScript for the same defence in
 * depth the rest of this module applies: the SQL predicate is the fast
 * path, not the guarantee.
 */
async function listPublishedProjectIndexImpl(
	env: PortfolioEnv,
	cms: readonly PortfolioProject[],
): Promise<readonly PortfolioProjectIndexEntry[]> {
	const db = env.DB;
	if (!db) {
		return cms.map((project) => ({ slug: project.slug, updatedAt: project.updatedAt }));
	}
	const result = await db
		.prepare(
			`SELECT slug, updated_at, visibility, status FROM portfolio_project
			 WHERE status = 'published' AND visibility = 'public'
			 ORDER BY pinned DESC, display_order ASC, updated_at DESC, id ASC`,
		)
		.all<Pick<PortfolioProjectRow, 'slug' | 'updated_at' | 'visibility' | 'status'>>();
	const rows = result.results ?? [];
	const entries: PortfolioProjectIndexEntry[] = [];
	const d1Slugs = new Set<string>();
	for (const row of rows) {
		if (!isVisible(row)) continue;
		d1Slugs.add(row.slug);
		entries.push({ slug: row.slug, updatedAt: row.updated_at });
	}
	// CMS rows are part of the public URL identity too (Issue #765): a
	// sitemap that omits them would advertise a site smaller than it is.
	// A slug D1 already owns is not added again — one URL, one entry.
	for (const project of cms) {
		if (d1Slugs.has(project.slug)) continue;
		entries.push({ slug: project.slug, updatedAt: project.updatedAt });
	}
	return entries;
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
 * filter, `isVisible` still refuses non-public rows. The parameter
 * is the two-column projection it actually reads, so narrow queries
 * (the public project index) can reuse it without widening their
 * result type to the full row.
 */
function isVisible(row: Pick<PortfolioProjectRow, 'visibility' | 'status'>): boolean {
	const visibility = VisibilitySchema.safeParse(row.visibility);
	if (!visibility.success) return false;
	if (row.status !== 'published') return false;
	return visibility.data === 'public';
}

async function fetchLinks(db: D1Database, projectId: string): Promise<readonly PortfolioLink[]> {
	return (await fetchLinksForProjects(db, [projectId])).get(projectId) ?? [];
}

async function fetchMedia(db: D1Database, projectId: string): Promise<readonly PortfolioMedia[]> {
	return (await fetchMediaForProjects(db, [projectId])).get(projectId) ?? [];
}

/**
 * Fetch the links of every project on the page with ONE statement
 * per id chunk (Issue #491).
 *
 * Ordering contract: `project_id` is the leading sort key and the
 * per-project ordering (`display_order ASC, created_at ASC`) is
 * unchanged, so grouping by id in memory reproduces exactly what the
 * per-project query returned. A project with no links is simply
 * absent from the map; callers treat "absent" as "no links".
 */
async function fetchLinksForProjects(
	db: D1Database,
	projectIds: readonly string[],
): Promise<Map<string, PortfolioLink[]>> {
	const grouped = new Map<string, PortfolioLink[]>();
	for (const chunk of chunkProjectIds(projectIds)) {
		// `linkPlaceholders` is STRUCTURE, never data: it is a chain of
		// `?N` placeholders derived from the chunk's own length. Every
		// project id is bound with `.bind(...chunk)`. The static D1
		// statement-shape gate (Issue #452) sees this interpolation, so
		// the identifier is named in `SQL_STRUCTURE_ALLOWLIST`
		// (`scripts/check-d1-sql-binding.mjs`) together with that reason.
		const linkPlaceholders = chunk.map((_, i) => `?${i + 1}`).join(', ');
		const result = await db
			.prepare(
				`SELECT * FROM portfolio_link WHERE project_id IN (${linkPlaceholders}) ORDER BY project_id ASC, display_order ASC, created_at ASC`,
			)
			.bind(...chunk)
			.all<PortfolioLinkRow>();
		for (const row of result.results ?? []) {
			const bucket = grouped.get(row.project_id);
			const link = rowToLink(row);
			if (bucket) bucket.push(link);
			else grouped.set(row.project_id, [link]);
		}
	}
	return grouped;
}

/**
 * Fetch the media of every project on the page with ONE statement
 * per id chunk (Issue #491). Same ordering contract as
 * `fetchLinksForProjects`: `project_id` leads the sort, the
 * per-project order (`is_cover DESC, display_order ASC,
 * created_at ASC`) is preserved, so `media[0]` is still the cover.
 */
async function fetchMediaForProjects(
	db: D1Database,
	projectIds: readonly string[],
): Promise<Map<string, PortfolioMedia[]>> {
	const grouped = new Map<string, PortfolioMedia[]>();
	for (const chunk of chunkProjectIds(projectIds)) {
		// `mediaPlaceholders` carries the same STRUCTURE-NOT-DATA argument
		// as `linkPlaceholders` above, and is allowlisted under the same
		// Issue #452 gate.
		const mediaPlaceholders = chunk.map((_, i) => `?${i + 1}`).join(', ');
		const result = await db
			.prepare(
				`SELECT * FROM portfolio_media WHERE project_id IN (${mediaPlaceholders}) ORDER BY project_id ASC, is_cover DESC, display_order ASC, created_at ASC`,
			)
			.bind(...chunk)
			.all<PortfolioMediaRow>();
		for (const row of result.results ?? []) {
			const bucket = grouped.get(row.project_id);
			const media = rowToMedia(row);
			if (bucket) bucket.push(media);
			else grouped.set(row.project_id, [media]);
		}
	}
	return grouped;
}

/** Split ids into statement-sized batches (`D1_BATCH_ID_CHUNK` ids each). */
function chunkProjectIds(projectIds: readonly string[]): string[][] {
	const chunks: string[][] = [];
	for (let i = 0; i < projectIds.length; i += D1_BATCH_ID_CHUNK) {
		chunks.push(projectIds.slice(i, i + D1_BATCH_ID_CHUNK));
	}
	return chunks;
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
