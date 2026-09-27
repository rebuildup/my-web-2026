import type {
	PortfolioProject,
	ListPortfolioProjectsOptions,
	PortfolioListPage,
	PortfolioAdjacent,
} from './schema';

/**
 * Portfolio loader contract.
 *
 * The loader is the **only** thing the rest of the codebase
 * reaches for when it needs portfolio data. It hides D1 / R2
 * behind a typed surface so routes / UI can be unit-tested
 * with a fake implementation and so the on-disk shape can
 * evolve without leaking through every consumer.
 *
 * DI seam: every impl takes the env-like object as its first
 * argument. This is the only way the loader can be exercised
 * outside the workerd pool (see [[workerd-vitest-mock-gap]]).
 *
 * Public-visibility contract:
 *   `loadPortfolioProject` returns a project only if it is
 *   `visibility='public' AND status='published'`. Unlisted /
 *   draft / archived rows always resolve to `null`.
 *   `loadPortfolioAdjacent` honours the same boundary.
 *   `listPortfolioProjects` returns only public+published
 *   rows. Admin / preview surfaces that need unlisted rows
 *   must build a separate loader / server-fn (not exposed by
 *   `src/portfolio/public.ts`).
 */
export interface PortfolioLoader {
	/** Return one project by slug, or null if not found / not visible. */
	loadPortfolioProject(slug: string): Promise<PortfolioProject | null>;

	/**
	 * Return the projects that sit immediately before and after the
	 * target in canonical sort order, or `null` when the target is
	 * not visible / not found. Both fields are independently `null`
	 * when the target is at a boundary of the visible set.
	 */
	loadPortfolioAdjacent(slug: string): Promise<PortfolioAdjacent>;

	/** Return a cursor-paged list of public+published projects. */
	listPortfolioProjects(opts?: ListPortfolioProjectsOptions): Promise<PortfolioListPage>;
}

/**
 * Minimal env surface the loader needs. Kept narrow so tests
 * can hand-construct a fake env object without dragging in
 * `cloudflare:test` or `cloudflare:workers`. Production uses
 * `env as unknown as PortfolioEnv`.
 *
 * `MEDIA_PUBLIC_BASE_URL` activates the R2 custom-domain
 * delivery (Decision 5). The value is pinned in
 * `wrangler.production.jsonc#vars` as `https://media.rebuildup.dev`
 * — production deployment always sees a non-null base URL. Local
 * dev (`wrangler.jsonc`) intentionally omits it so the placeholder
 * branch is exercised by default. When the variable is unset,
 * `composeMediaUrl` returns `null` and the UI renders the
 * placeholder; the bucket-level custom-domain attachment is a
 * separate release prerequisite (see `docs/portfolio/decisions.md` §5).
 */
export interface PortfolioEnv {
	DB?: D1Database;
	MEDIA?: R2Bucket;
	MEDIA_PUBLIC_BASE_URL?: string;
}
