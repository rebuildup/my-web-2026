import type {
	ActivityHighlightWork,
	ActivityHighlights,
	ActivityPageModel,
	ActivityTimeline,
	ActivityTimelineItem,
	ActivityTimelineSourceState,
} from '../../activity/contract';
import { sortActivityTimelineItems } from '../../activity/merge';
import {
	type PortfolioWorkLike,
	githubReleaseItems,
	portfolioWorkItems,
} from '../../activity/sources';
import type { HomeGitHubActivity } from '../../home/activity/contract';

/**
 * `/activity` assembly — compose the per-source reads into the
 * `ActivityPageModel` the page renders (Issue #352; edited layer
 * Issue #1319).
 *
 * This module is PURE: no clock, no fetch, no binding. The route
 * loader (`load.ts`) supplies the inputs and `generatedAt` (the
 * assembly instant); everything decided here is a projection rule,
 * so it is unit-testable without workerd.
 *
 * Honest-state mapping
 * --------------------
 *   - `github === null` means the public projection could not be
 *     read at all (server-fn failure or no usable snapshot) — the
 *     source reports `failed`, never "no releases", and every
 *     GitHub-derived highlight (`windowDays`, `repoCount`,
 *     `measures`) reports `null` / empty rather than a zero.
 *   - Otherwise the GitHub source reports the PUBLIC feed source's
 *     own health (`sources.public.status` / `observedAt`): the
 *     timeline reads only public feed rows, so the private source's
 *     state is not this surface's claim.
 *   - `portfolio === null` means the public project list could not
 *     be read — `failed`. A successful read reports `ok` observed at
 *     the assembly instant: the D1 read IS the observation.
 *   - `articles` has no live source (Issue #323 owns it), so it is
 *     permanently `unconfigured` — declared, never faked.
 *
 * The edited layer (Issue #1319)
 * ------------------------------
 *   - `relatedWork`: a release item's `title` IS the feed's
 *     `repoId` (`owner/name`); when exactly the published works'
 *     recorded `repo` links name the same repository, the item
 *     gains a `relatedWork` pointer to `/portfolio/<slug>`. The
 *     join is derived, first-match-wins in catalogue order, and
 *     absent means "no provable link" — never a guessed pairing.
 *   - `highlights.releases` / `.works` are bounded slices of the
 *     SAME sorted items / selected input — the band curates, it
 *     never invents. `highlights.measures` passes the home
 *     projection's already-ranked `topRepos` through unchanged.
 *   - `selectedWorks` arrives already resolved against
 *     `SELECTED_WORK_SLUGS` by the loader (the `activity` obligation
 *     may not import `portfolio`); this module re-applies the same
 *     published+public+dated filter the archive adapter uses, so a
 *     selected slug that fell out of the public catalogue simply
 *     produces no card.
 */

/** How many release rows the highlight band carries. */
export const ACTIVITY_HIGHLIGHT_RELEASE_COUNT = 3;
/** How many selected works the highlight band carries. */
export const ACTIVITY_HIGHLIGHT_WORK_COUNT = 3;

export interface ActivityAssemblyInput {
	/** The public GitHub activity projection, or `null` when unreadable. */
	readonly github: HomeGitHubActivity | null;
	/** Public+published portfolio rows, or `null` when unreadable. */
	readonly portfolio: readonly PortfolioWorkLike[] | null;
	/**
	 * The editorially selected works (`resolveSelectedWorks` output,
	 * already mapped to the adapter's input shape), or empty when the
	 * portfolio read failed. Order is the authored selection order.
	 */
	readonly selectedWorks: readonly PortfolioWorkLike[];
	/** ISO instant the assembly ran (the route's clock). */
	readonly generatedAt: string;
}

/** The same admission rule `portfolioWorkItems` applies, for the highlight cards and the join. */
function isPublicWork(project: PortfolioWorkLike): boolean {
	return (
		project.status === 'published' &&
		project.visibility === 'public' &&
		Number.isFinite(project.periodStart) &&
		project.periodStart > 0
	);
}

/**
 * `owner/name` → the published work that repository produced.
 * Built only from works that actually became timeline items, so a
 * draft or private project can never be joined into the record.
 */
function relatedWorkIndex(
	projects: readonly PortfolioWorkLike[],
): ReadonlyMap<string, { title: string; href: string }> {
	const index = new Map<string, { title: string; href: string }>();
	for (const project of projects) {
		if (!project.repoFullName || index.has(project.repoFullName)) continue;
		// Only works the archive adapter actually admitted may be
		// joined — re-check the same rule rather than trusting that
		// every input row became an item.
		if (!isPublicWork(project)) continue;
		index.set(project.repoFullName, {
			title: project.title,
			href: `/portfolio/${project.slug}`,
		});
	}
	return index;
}

function withRelatedWorks(
	items: readonly ActivityTimelineItem[],
	index: ReadonlyMap<string, { title: string; href: string }>,
): readonly ActivityTimelineItem[] {
	if (index.size === 0) return items;
	return items.map((item) => {
		if (item.kind !== 'release' || item.source !== 'github') return item;
		const related = index.get(item.title);
		return related ? { ...item, relatedWork: related } : item;
	});
}

function highlightWorks(selected: readonly PortfolioWorkLike[]): ActivityHighlights['works'] {
	const works: ActivityHighlightWork[] = [];
	for (const project of selected) {
		if (works.length >= ACTIVITY_HIGHLIGHT_WORK_COUNT) break;
		if (!isPublicWork(project)) continue;
		works.push({
			slug: project.slug,
			title: project.title,
			...(project.summary ? { summary: project.summary } : {}),
			...(project.periodLabel ? { periodLabel: project.periodLabel } : {}),
			...(project.cover?.url ? { cover: project.cover } : {}),
			href: `/portfolio/${project.slug}`,
		});
	}
	return works;
}

export function assembleActivityPage(input: ActivityAssemblyInput): ActivityPageModel {
	const { github, portfolio, selectedWorks, generatedAt } = input;

	const githubState: ActivityTimelineSourceState = github
		? {
				id: 'github',
				status: github.sources.public.status,
				...(github.sources.public.observedAt
					? { observedAt: github.sources.public.observedAt }
					: {}),
			}
		: { id: 'github', status: 'failed' };

	const portfolioState: ActivityTimelineSourceState = portfolio
		? { id: 'portfolio', status: 'ok', observedAt: generatedAt }
		: { id: 'portfolio', status: 'failed' };

	const sources: ActivityTimelineSourceState[] = [
		githubState,
		portfolioState,
		{ id: 'articles', status: 'unconfigured' },
	];

	const items = withRelatedWorks(
		sortActivityTimelineItems([
			...(github ? githubReleaseItems(github.feed) : []),
			...(portfolio ? portfolioWorkItems(portfolio) : []),
		]),
		portfolio ? relatedWorkIndex(portfolio) : new Map(),
	);

	const timeline: ActivityTimeline = { generatedAt, sources, items };

	const highlights: ActivityHighlights = {
		windowDays: github?.windowDays ?? null,
		repoCount: github?.repoCount ?? null,
		totals: {
			releases: items.filter((item) => item.kind === 'release').length,
			works: items.filter((item) => item.kind === 'work').length,
		},
		measures: (github?.topRepos ?? []).map((repo) => ({
			name: repo.name,
			...(repo.href ? { href: repo.href } : {}),
			commits: repo.commits,
			...(repo.pullRequests !== undefined ? { pullRequests: repo.pullRequests } : {}),
			windowDays: repo.windowDays,
		})),
		releases: items
			.filter((item) => item.kind === 'release')
			.slice(0, ACTIVITY_HIGHLIGHT_RELEASE_COUNT),
		works: highlightWorks(selectedWorks),
	};

	return { timeline, highlights };
}
