import type { ActivityTimeline } from '../../activity/contract';
import { getHomeGitHubActivity } from '../../home/public';
import { listPortfolioProjects } from '../../portfolio/public';
import type { PortfolioListPage, PortfolioProject } from '../../portfolio/schema';
import { assembleActivityTimeline } from './assemble';

/**
 * `/activity` loader data (Issue #352).
 *
 * Composes the two LIVE sources the timeline reads:
 *
 *   - GitHub — the same public projection the Home status card uses
 *     (`getHomeGitHubActivity` → committed `github-activity.json`,
 *     or the fresher D1 snapshot the sync job pushes). Only
 *     `ReleaseEvent` feed rows become items; the adapter decides.
 *   - Portfolio — EVERY public+published project, read through the
 *     same `listPortfolioProjects` server function the `/portfolio`
 *     index uses, paged to exhaustion so the timeline is not a
 *     first-page sample. `created_at` is never a date claim — the
 *     adapter dates works by authored `periodStart` / `periodLabel`.
 *
 * Failure contract: a source that cannot be read becomes `null`
 * here and `failed` in the assembled timeline — the page still
 * renders the other source and its own health line, exactly like
 * the GitHub activity card's vocabulary. Nothing is retried,
 * fabricated or interpolated.
 *
 * This module is imported by the route's `loader`, which runs on
 * the server for SSR and delegates to the server functions over
 * RPC on client navigation — the same pattern as
 * `src/routes/index.tsx`.
 */

/** `listPortfolioProjects` accepts at most 500 rows per page. */
const PORTFOLIO_PAGE_LIMIT = 500;
/**
 * Hard bound on pagination. The public catalogue is curated and
 * orders of magnitude below this; hitting the bound means the read
 * would be silently truncated, which is a `failed` source, not a
 * shorter honest list.
 */
const PORTFOLIO_MAX_PAGES = 10;

/**
 * Read every public+published project. Throws when the bound is
 * exceeded so the caller's `.catch` maps it to `failed` — a partial
 * catalogue must never be presented as the whole one.
 */
async function listAllPortfolioProjects(): Promise<PortfolioProject[]> {
	const projects: PortfolioProject[] = [];
	let cursor: string | null = null;
	for (let page = 0; page < PORTFOLIO_MAX_PAGES; page += 1) {
		const result: PortfolioListPage = await listPortfolioProjects({
			data: { limit: PORTFOLIO_PAGE_LIMIT, cursor },
		});
		projects.push(...result.projects);
		if (result.nextCursor === null) return projects;
		cursor = result.nextCursor;
	}
	throw new Error('portfolio project list exceeded the pagination bound');
}

/**
 * The assembled timeline for `/activity`. `generatedAt` is the
 * route's clock — one instant for the whole assembly so the
 * 観測日 line can never disagree with itself.
 */
export async function getActivityPageData(): Promise<ActivityTimeline> {
	const generatedAt = new Date().toISOString();
	const [github, portfolio] = await Promise.all([
		getHomeGitHubActivity({ data: {} }).catch(() => null),
		listAllPortfolioProjects().catch(() => null),
	]);
	return assembleActivityTimeline({ github, portfolio, generatedAt });
}
