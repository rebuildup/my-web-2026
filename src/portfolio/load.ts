import type { PortfolioLoader, PortfolioEnv } from './contract';
import {
	type ListPortfolioProjectsOptions,
	type PortfolioLink,
	type PortfolioLinkRow,
	type PortfolioMedia,
	type PortfolioMediaRow,
	type PortfolioProject,
	type PortfolioProjectRow,
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
		.prepare('SELECT * FROM portfolio_project WHERE slug = ?1')
		.bind(slug)
		.first<PortfolioProjectRow>();
	if (!row) return null;
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
): Promise<readonly PortfolioProject[]> {
	const db = env.DB;
	if (!db) return [];
	const limit = clampLimit(opts.limit);
	const visibility =
		opts.visibility && opts.visibility.length > 0 ? opts.visibility : (['public'] as const);

	// Build a parameterised SQL with IN-clauses. SQLite caps the
	// host-parameter count at 999 — well below any realistic
	// facet / visibility cardinality, so we inline the placeholders
	// directly. Facet filtering runs post-fetch because `facets`
	// is JSON-encoded TEXT — the page is small (< 100 rows for the
	// foundation seed), so an in-memory filter is cheaper than
	// maintaining a generated column.
	const visibilityPlaceholders = visibility.map(() => '?').join(',');
	const sql = `SELECT * FROM portfolio_project WHERE status = 'published' AND visibility IN (${visibilityPlaceholders}) ORDER BY pinned DESC, display_order ASC, updated_at DESC LIMIT ?`;

	const stmt = db.prepare(sql);
	const visibilityBinds: Array<string | number> = [...visibility, limit];
	const result = await stmt.bind(...visibilityBinds).all<PortfolioProjectRow>();
	const rows = result.results ?? [];

	// Capture into a local so TypeScript can narrow the type past
	// the existence check without `!` (lint/style/noNonNullAssertion).
	const facetFilter = opts.facets && opts.facets.length > 0 ? opts.facets : null;
	const filtered = facetFilter
		? rows.filter((row) => intersectsAny(row.facets, facetFilter))
		: rows;

	const projects: PortfolioProject[] = [];
	for (const row of filtered) {
		const [links, media] = await Promise.all([fetchLinks(db, row.id), fetchMedia(db, row.id)]);
		const mediaWithUrls = media.map((m) => ({
			...m,
			url: composeMediaUrl(env, m.r2Key),
		}));
		projects.push(rowToProject(row, links, mediaWithUrls));
	}
	return projects;
}

function clampLimit(input: number | undefined): number {
	if (typeof input !== 'number' || !Number.isFinite(input)) return 100;
	return Math.max(1, Math.min(500, Math.floor(input)));
}

/**
 * Decide whether a row should be served to a public caller.
 * Drafts and archived rows are never served through this loader.
 * `unlisted` rows are served only when explicitly requested via
 * the loader's `visibility` filter (e.g. admin / preview contexts).
 */
function isVisible(row: PortfolioProjectRow): boolean {
	const visibility = VisibilitySchema.safeParse(row.visibility);
	if (!visibility.success) return false;
	if (row.status !== 'published') return false;
	if (visibility.data === 'public') return true;
	if (visibility.data === 'unlisted') return true; // explicit loader calls only
	return false;
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
