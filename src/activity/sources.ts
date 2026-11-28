import type { ActivityTimelineItem } from './contract';

/**
 * Source adapters — project each source's OWN record into timeline
 * items (Issue #352).
 *
 * The inputs are narrow structural types, NOT the owner contracts:
 * `GitHubFeedItemLike` is satisfied by `HomeGitHubActivityFeedItem`
 * (`src/home/activity/contract.ts`) and `PortfolioWorkLike` by
 * `PortfolioProject` (`src/portfolio/schema.ts`) without this module
 * importing either owner. The route layer (or a later server
 * function) owns the adaptation call; the FILTER rules — which
 * records become timeline items — live here so every consumer gets
 * the same honest answer.
 *
 * What each adapter refuses to claim
 * ----------------------------------
 *   - GitHub: only `ReleaseEvent` feed rows become `release` items.
 *     Push / PR / issue events are repository activity, not releases,
 *     and the issue's scope is releases + articles + works — mixing
 *     them in would turn the timeline back into an event feed. The
 *     feed schema carries no per-event URL, so `href` is the
 *     repository URL the projection already resolved; nothing is
 *     fabricated when it is absent.
 *   - Portfolio: only `status === 'published'` AND
 *     `visibility === 'public'` rows become `work` items — the same
 *     boundary the public index uses. The date is the authored
 *     `periodStart` (a real stored value, coarse but recorded),
 *     displayed through the authored `periodLabel` when present.
 *     `created_at` is NEVER used: it is the row-creation timestamp
 *     (seed/migration time for the legacy corpus), not a publication
 *     date, and the issue forbids interpolating unknown dates.
 */

/** The slice of a GitHub activity feed item the adapter reads. */
export interface GitHubFeedItemLike {
	readonly id: string;
	readonly repoId: string;
	readonly type: string;
	readonly at: string;
	readonly href?: string;
}

/** The GitHub event type that represents a release. */
export const GITHUB_RELEASE_EVENT_TYPE = 'ReleaseEvent';

/**
 * Public GitHub release events → `release` items. Private-kind feed
 * rows must already have been filtered by the caller's public
 * projection; this adapter additionally refuses any row whose `at`
 * does not parse, because an undated item cannot be sorted honestly.
 */
export function githubReleaseItems(
	feed: readonly GitHubFeedItemLike[],
): readonly ActivityTimelineItem[] {
	const items: ActivityTimelineItem[] = [];
	for (const event of feed) {
		if (event.type !== GITHUB_RELEASE_EVENT_TYPE) continue;
		if (Number.isNaN(Date.parse(event.at))) continue;
		items.push({
			id: `github:${event.id}`,
			kind: 'release',
			source: 'github',
			title: event.repoId,
			at: event.at,
			...(event.href ? { href: event.href } : {}),
		});
	}
	return items;
}

/** The slice of a portfolio project the adapter reads. */
export interface PortfolioWorkLike {
	readonly slug: string;
	readonly title: string;
	readonly status: string;
	readonly visibility: string;
	/** Epoch milliseconds — the authored period start. */
	readonly periodStart: number;
	readonly periodLabel?: string | null;
	/**
	 * The project's published cover (Issue #1297), already resolved
	 * to a displayable URL by the caller. Absent or `null` means the
	 * work carries no usable cover — the item then renders text-only,
	 * never a placeholder frame.
	 */
	readonly cover?: {
		readonly url: string;
		readonly alt: string;
		readonly width: number | null;
		readonly height: number | null;
	} | null;
}

/**
 * Published, public portfolio works → `work` items. The detail URL is
 * the canonical `/portfolio/<slug>` route the public index already
 * publishes — a real permalink, never an external guess.
 */
export function portfolioWorkItems(
	projects: readonly PortfolioWorkLike[],
): readonly ActivityTimelineItem[] {
	const items: ActivityTimelineItem[] = [];
	for (const project of projects) {
		if (project.status !== 'published' || project.visibility !== 'public') continue;
		if (!Number.isFinite(project.periodStart) || project.periodStart <= 0) continue;
		const at = new Date(project.periodStart).toISOString();
		if (Number.isNaN(Date.parse(at))) continue;
		items.push({
			id: `portfolio:${project.slug}`,
			kind: 'work',
			source: 'portfolio',
			title: project.title,
			at,
			...(project.periodLabel ? { dateLabel: project.periodLabel } : {}),
			href: `/portfolio/${project.slug}`,
			// Issue #1297 — a cover is emitted only with a real URL;
			// the caller resolves `null` when the media domain is
			// unbound, and an empty string is not a URL.
			...(project.cover?.url ? { cover: project.cover } : {}),
		});
	}
	return items;
}
