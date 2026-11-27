import type { renderStatsCard } from '../../vendor/github-readme-stats-fast/cards/stats.ts';
import type { renderStreakCard } from '../../vendor/github-readme-stats-fast/cards/streak-card.ts';
import type { renderTopLanguages } from '../../vendor/github-readme-stats-fast/cards/top-languages.ts';
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

type StreakCardData = Parameters<typeof renderStreakCard>[1];
type TopLangsCardData = Parameters<typeof renderTopLanguages>[0];

/**
 * Streak card ← `github_stats_snapshot.streak` (Issue #1268). The
 * snapshot's streak block carries every field `StreakData` needs —
 * the card and `/vitals` can never disagree. `null` → caller degrades.
 */
export function streakCardFromSnapshot(
	snapshot: GitHubStatsSnapshotValue | null,
): StreakCardData | null {
	const s = snapshot?.streak;
	if (!s) return null;
	return {
		currentStreak: s.currentStreak,
		longestStreak: s.longestStreak,
		totalContributions: s.totalContributions,
		firstContribution: s.firstContribution,
		currentStreakStart: s.currentStreakStart,
		currentStreakEnd: s.currentStreakEnd,
		longestStreakStart: s.longestStreakStart,
		longestStreakEnd: s.longestStreakEnd,
	};
}

/**
 * Top-langs card ← `github_stats_snapshot.languages.owned` (Issue
 * #1268). The card historically showed the owner's repo language
 * mix — the owned scope is the same population, now measured by the
 * sync pipeline instead of a request-time GraphQL call. `null` or an
 * unmeasured scope → caller degrades (never an invented card).
 */
export function topLangsCardFromSnapshot(
	snapshot: GitHubStatsSnapshotValue | null,
): TopLangsCardData | null {
	const langs = snapshot?.languages?.owned;
	if (!langs || langs.length === 0) return null;
	const out: Record<string, { name: string; color: string | null; size: number; count: number }> =
		{};
	for (const l of langs) {
		out[l.name] = { name: l.name, color: l.color, size: l.size, count: l.count };
	}
	return out;
}

/** Shared D1 read for the snapshot-backed cards. Literal SQL per the
 * D1 binding gate. */
async function loadSnapshot(db: D1Database | undefined): Promise<GitHubStatsSnapshotValue | null> {
	if (!db) return null;
	try {
		const row = await db
			.prepare('SELECT payload FROM github_stats_snapshot WHERE id = 1')
			.first<{ payload: string }>();
		const payload = typeof row?.payload === 'string' ? JSON.parse(row.payload) : null;
		return parseStatsSnapshot(payload);
	} catch {
		return null;
	}
}

/** D1 read + parse for the stats card route. */
export async function loadStatsCardProjection(
	db: D1Database | undefined,
): Promise<StatsCardProjection | null> {
	return statsCardFromSnapshot(await loadSnapshot(db));
}

export async function loadStreakCardData(
	db: D1Database | undefined,
): Promise<StreakCardData | null> {
	return streakCardFromSnapshot(await loadSnapshot(db));
}

export async function loadTopLangsCardData(
	db: D1Database | undefined,
): Promise<TopLangsCardData | null> {
	return topLangsCardFromSnapshot(await loadSnapshot(db));
}
