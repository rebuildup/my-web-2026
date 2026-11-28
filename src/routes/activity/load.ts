import type { ActivityPageModel } from '../../activity/contract';
import type { PortfolioWorkLike } from '../../activity/sources';
import { getHomeGitHubActivity } from '../../home/public';
import { listPortfolioProjects } from '../../portfolio/public';
import type { PortfolioLink, PortfolioListPage, PortfolioProject } from '../../portfolio/schema';
import { resolveSelectedWorks } from '../../portfolio/selected';
import { ACTIVITY_HIGHLIGHT_WORK_COUNT, assembleActivityPage } from './assemble';

/**
 * `/activity` loader data (Issue #352; edited layer Issue #1319).
 *
 * Composes the two LIVE sources the record reads:
 *
 *   - GitHub — the same public projection the Home status card uses
 *     (`getHomeGitHubActivity` → committed `github-activity.json`,
 *     or the fresher D1 snapshot the sync job pushes). Only
 *     `ReleaseEvent` feed rows become items; the adapter decides.
 *     The projection's `windowDays` / `repoCount` / `topRepos` feed
 *     the highlight band's measured summary.
 *   - Portfolio — EVERY public+published project, read through the
 *     same `listPortfolioProjects` server function the `/portfolio`
 *     index uses, paged to exhaustion so the record is not a
 *     first-page sample. `created_at` is never a date claim — the
 *     adapter dates works by authored `periodStart` / `periodLabel`.
 *     The same read also resolves the editorial selection
 *     (`SELECTED_WORK_SLUGS`) into the highlight band's work cards.
 *
 * Failure contract: a source that cannot be read becomes `null`
 * here and `failed` in the assembled record — the page still
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
 * `owner/name` for the repository a project's `repo` link points at
 * (Issue #1319), or `null`.
 *
 * The join the assembly performs is only as honest as this parse:
 * the URL must be `https://github.com/<owner>/<name>` with exactly
 * two non-empty path segments — a `…/tree/…`, a `…/releases` deep
 * link, a non-GitHub host or a malformed value all yield `null`, so
 * a release event can never be paired with a work through a URL
 * that does not name the repository root.
 */
export function repoFullNameFromLinks(links: readonly PortfolioLink[]): string | null {
	for (const link of links) {
		if (link.kind !== 'repo') continue;
		let url: URL;
		try {
			url = new URL(link.url);
		} catch {
			continue;
		}
		if (url.protocol !== 'https:' || url.hostname !== 'github.com') continue;
		const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
		if (segments.length !== 2) continue;
		const [owner, name] = segments;
		// Repo ids in the GitHub feed are `owner/name`; anything with
		// whitespace or a second slash can never equal one.
		if (/\s/.test(owner) || /\s/.test(name)) continue;
		return `${owner}/${name}`;
	}
	return null;
}

/**
 * Project a `PortfolioProject` onto the adapter's narrow input
 * (Issue #1297; extended Issue #1319). The cover is the project's
 * `isCover` media — or the first media row when none is flagged,
 * the same fallback `/portfolio/$slug` uses — resolved to its
 * composed `url`. A row whose media domain is unbound
 * (`url === null`) or whose cover has no alt text contributes NO
 * cover: the record renders the work text-only rather than a frame
 * with no accessible name.
 */
function toWorkLike(project: PortfolioProject): PortfolioWorkLike {
	const coverMedia = project.media.find((media) => media.isCover) ?? project.media[0];
	const cover =
		coverMedia?.url && coverMedia.alt
			? {
					url: coverMedia.url,
					alt: coverMedia.alt,
					width: coverMedia.width,
					height: coverMedia.height,
				}
			: null;
	return {
		slug: project.slug,
		title: project.title,
		status: project.status,
		visibility: project.visibility,
		periodStart: project.periodStart,
		periodLabel: project.periodLabel,
		summary: project.summary,
		repoFullName: repoFullNameFromLinks(project.links),
		cover,
	};
}

/**
 * The assembled record for `/activity`. `generatedAt` is the
 * route's clock — one instant for the whole assembly so the
 * 観測日 line can never disagree with itself.
 */
export async function getActivityPageData(): Promise<ActivityPageModel> {
	const generatedAt = new Date().toISOString();
	const [github, portfolio] = await Promise.all([
		getHomeGitHubActivity({ data: {} }).catch(() => null),
		listAllPortfolioProjects().catch(() => null),
	]);
	const works = portfolio?.map(toWorkLike) ?? null;
	// Issue #1319 — the highlight band's work cards read the SAME
	// editorial selection the portfolio index leads with, resolved
	// against the live catalogue (a slug that fell out of the public
	// set is skipped, never rendered as a broken slot).
	const selectedWorks = portfolio
		? resolveSelectedWorks(portfolio, ACTIVITY_HIGHLIGHT_WORK_COUNT * 2).map(toWorkLike)
		: [];
	return assembleActivityPage({
		github,
		portfolio: works,
		selectedWorks,
		generatedAt,
	});
}
