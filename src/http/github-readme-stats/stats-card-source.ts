import type { renderStatsCard } from '../../vendor/github-readme-stats-fast/cards/stats.ts';
import { parseStatsSnapshot } from '../github-profile/stats-source';
import type { GitHubStatsSnapshotValue } from '../stats/schema';

/**
 * Stats card ← `github_stats_snapshot` adapter (Issue #1262, data
 * contract `docs/domain/github-profile-data.md` §7).
 *
 * The site status section's GitHub statistics card used to call the
 * vendored `fetchStats` at REQUEST time — the same upstream-call
 * pattern ADR-0027 removed from the profile surfaces. It now reads
 * the async sync pipeline's snapshot instead, so the card and the
 * `/vitals` surface can never disagree about a number.
 *
 * Honesty rules:
 * - Fields the snapshot does not measure are `hide`-listed, never
 *   rendered as zero (`prs_merged`, `reviews`, `discussions_*` are
 *   opt-in upstream and stay off).
 * - `totalCommits` is `commitsAuthoredAllTime` — genuinely all-time
 *   authored commits (search API), fixing the old card's 1-year
 *   `contributionsCollection` figure that was labelled all-time.
 *   `include_all_commits: true` drops the year suffix to match.
 * - `stars` / `commits` / `prs` / `issues` / `contribs` keep their
 *   owned/account semantics; `contributedTo` stays the affiliation
 *   count, exactly like `/vitals`.
 * - A missing or invalid snapshot returns `null` — the router maps
 *   that to the degraded 503 contract, never an invented card.
 */

type StatsCardData = Parameters<typeof renderStatsCard>[0];
type StatsCardOptions = Parameters<typeof renderStatsCard>[1];

export interface StatsCardProjection {
	readonly stats: StatsCardData;
	readonly options: StatsCardOptions;
}

/** `null` snapshot → `null` (caller degrades). Fields the snapshot
 * leaves unmeasured are hidden rather than zeroed. */
export function statsCardFromSnapshot(
	snapshot: GitHubStatsSnapshotValue | null,
): StatsCardProjection | null {
	if (!snapshot) return null;
	const m = snapshot.metrics;
	const hide: string[] = [];
	if (snapshot.stars?.owned == null) hide.push('stars');
	if (m.commitsAuthoredAllTime == null) hide.push('commits');
	if (m.prsOpenedAllTime == null) hide.push('prs');
	if (m.issuesOpenedAllTime == null) hide.push('issues');
	if (m.contributedTo == null) hide.push('contribs');
	const rank = snapshot.rank?.current ?? null;
	return {
		stats: {
			name: snapshot.owner,
			totalStars: snapshot.stars?.owned ?? 0,
			totalCommits: m.commitsAuthoredAllTime ?? 0,
			totalIssues: m.issuesOpenedAllTime ?? 0,
			totalPRs: m.prsOpenedAllTime ?? 0,
			// Opt-in upstream fields the snapshot does not carry —
			// never rendered (no `show` entries), values unused.
			totalPRsMerged: 0,
			mergedPRsPercentage: 0,
			totalReviews: 0,
			totalDiscussionsStarted: 0,
			totalDiscussionsAnswered: 0,
			contributedTo: m.contributedTo ?? 0,
			rank: rank ?? { level: '', percentile: 0 },
		},
		options: {
			disable_animations: true,
			include_all_commits: true,
			hide,
			...(rank ? {} : { hide_rank: true }),
		},
	};
}

/** D1 read + parse for the stats card route. Literal SQL per the
 * D1 binding gate. */
export async function loadStatsCardProjection(
	db: D1Database | undefined,
): Promise<StatsCardProjection | null> {
	if (!db) return null;
	try {
		const row = await db
			.prepare('SELECT payload FROM github_stats_snapshot WHERE id = 1')
			.first<{ payload: string }>();
		const payload = typeof row?.payload === 'string' ? JSON.parse(row.payload) : null;
		return statsCardFromSnapshot(parseStatsSnapshot(payload));
	} catch {
		return null;
	}
}
