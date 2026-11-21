import type {
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
 * `ActivityTimeline` read model the page renders (Issue #352).
 *
 * This module is PURE: no clock, no fetch, no binding. The route
 * loader (`load.ts`) supplies the three inputs and `generatedAt`
 * (the assembly instant); everything decided here is a projection
 * rule, so it is unit-testable without workerd.
 *
 * Honest-state mapping
 * --------------------
 *   - `github === null` means the public projection could not be
 *     read at all (server-fn failure or no usable snapshot) — the
 *     source reports `failed`, never "no releases".
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
 * Item filtering lives in `src/activity/sources.ts` — this module
 * only routes the reads through it and merges the result.
 */
export interface ActivityAssemblyInput {
	/** The public GitHub activity projection, or `null` when unreadable. */
	readonly github: HomeGitHubActivity | null;
	/** Public+published portfolio rows, or `null` when unreadable. */
	readonly portfolio: readonly PortfolioWorkLike[] | null;
	/** ISO instant the assembly ran (the route's clock). */
	readonly generatedAt: string;
}

export function assembleActivityTimeline(input: ActivityAssemblyInput): ActivityTimeline {
	const { github, portfolio, generatedAt } = input;

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

	const items: ActivityTimelineItem[] = [
		...(github ? githubReleaseItems(github.feed) : []),
		...(portfolio ? portfolioWorkItems(portfolio) : []),
	];

	return {
		generatedAt,
		sources,
		items: sortActivityTimelineItems(items),
	};
}
