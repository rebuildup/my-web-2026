import type { PortfolioProject, ListPortfolioProjectsOptions, PortfolioListPage } from './schema';

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
 *   `listPortfolioProjects` returns only public+published
 *   rows. Admin / preview surfaces that need unlisted rows
 *   must build a separate loader / server-fn (not exposed by
 *   `src/portfolio/public.ts`).
 */
export interface PortfolioLoader {
	/** Return one project by slug, or null if not found / not visible. */
	loadPortfolioProject(slug: string): Promise<PortfolioProject | null>;

	/** Return a cursor-paged list of public+published projects. */
	listPortfolioProjects(opts?: ListPortfolioProjectsOptions): Promise<PortfolioListPage>;
}

/**
 * Minimal env surface the loader needs. Kept narrow so tests
 * can hand-construct a fake env object without dragging in
 * `cloudflare:test` or `cloudflare:workers`. Production uses
 * `env as unknown as PortfolioEnv`.
 *
 * `MEDIA_PUBLIC_BASE_URL` is the optional `vars` entry that
 * activates the R2 custom-domain delivery (Decision 5). When
 * absent, `composeMediaUrl` returns `null` and the UI renders
 * a placeholder. The variable is **not** declared in
 * `wrangler.jsonc` yet — the operator adds it when the R2
 * custom domain is configured in the Cloudflare dashboard.
 */
export interface PortfolioEnv {
	DB?: D1Database;
	MEDIA?: R2Bucket;
	MEDIA_PUBLIC_BASE_URL?: string;
}
