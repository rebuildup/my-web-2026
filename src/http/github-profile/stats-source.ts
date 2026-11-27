import { GitHubStatsSnapshotBody, type GitHubStatsSnapshotValue } from '../stats/schema';
import type { BandLang, BandStats } from './bands';
import type { NowStats } from './now';

/**
 * Stats-snapshot → surface-model adapter (Issue #1244, data contract
 * `docs/domain/github-profile-data.md`).
 *
 * Every profile surface that used to call the vendored readme-stats
 * fetchers at REQUEST time now reads the `github_stats_snapshot`
 * D1 row instead: the async `scripts/sync-github-stats.mjs --push`
 * pipeline owns upstream freshness, and an absent / invalid snapshot
 * degrades to the honest `null` ("unmeasured") fields — never an
 * upstream call, never an invented number.
 *
 * Field mapping preserves the pre-snapshot semantics where they
 * existed (stars = owned repos, contributedTo = affiliation count,
 * rank = the vendored `calculateRank` result) and applies the #1245
 * corrections where the old code conflated windows: `totalCommits`
 * is now genuinely ALL-TIME authored commits (was the 1-year
 * contributionsCollection total rendered as "commits"), and
 * `topLangs` comes from the owned-scope language aggregation the
 * sync measured — owned public non-fork repos only, matching the
 * contract's scope rules.
 */

export function parseStatsSnapshot(payload: unknown): GitHubStatsSnapshotValue | null {
	if (payload === null || payload === undefined) return null;
	const parsed = GitHubStatsSnapshotBody.safeParse(payload);
	return parsed.success ? parsed.data : null;
}

function bandLangs(
	snapshot: GitHubStatsSnapshotValue | null,
	scope: 'owned' | 'participated',
): BandStats['topLangs'] {
	const langs = snapshot?.languages?.[scope];
	if (!langs || langs.length === 0) return null;
	const total = langs.reduce((sum, entry) => sum + entry.size, 0);
	if (total <= 0) return null;
	return langs
		.map(
			(entry): BandLang => ({
				name: entry.name,
				pct: Math.round((entry.size / total) * 1000) / 10,
				color: entry.color ?? '#8b949e',
			}),
		)
		.sort((a, b) => b.pct - a.pct)
		.slice(0, 10);
}

/**
 * Owned + participated merged into one language mix (Issue #1262
 * review): the scopes are disjoint repo sets (contract §2.1), so
 * summing bytes per language name yields the "total development
 * area" composition — still repo bytes, never the owner's personal
 * change volume. `null` unless BOTH scopes were measured, so the
 * combined bar never silently impersonates a single scope.
 */
function combinedBandLangs(snapshot: GitHubStatsSnapshotValue | null): BandStats['combinedLangs'] {
	const owned = snapshot?.languages?.owned;
	const participated = snapshot?.languages?.participated;
	if (!owned?.length || !participated?.length) return null;
	const byName = new Map<string, { size: number; count: number; color: string | null }>();
	for (const scope of [owned, participated]) {
		for (const entry of scope) {
			const prev = byName.get(entry.name);
			if (prev) {
				prev.size += entry.size;
				prev.count += entry.count;
				prev.color ??= entry.color;
			} else {
				byName.set(entry.name, {
					size: entry.size,
					count: entry.count,
					color: entry.color,
				});
			}
		}
	}
	const total = [...byName.values()].reduce((sum, e) => sum + e.size, 0);
	if (total <= 0) return null;
	return [...byName.entries()]
		.map(
			([name, e]): BandLang => ({
				name,
				pct: Math.round((e.size / total) * 1000) / 10,
				color: e.color ?? '#8b949e',
			}),
		)
		.sort((a, b) => b.pct - a.pct)
		.slice(0, 10);
}

/** `null` snapshot → every field `null` (the `—` honest variant). */
export function bandStatsFromSnapshot(snapshot: GitHubStatsSnapshotValue | null): BandStats {
	return {
		currentStreak: snapshot?.streak?.currentStreak ?? null,
		longestStreak: snapshot?.streak?.longestStreak ?? null,
		totalContributions: snapshot?.streak?.totalContributions ?? null,
		contributedTo: snapshot?.metrics.contributedTo ?? null,
		rankLevel: snapshot?.rank?.current.level ?? null,
		rankPercentile: snapshot?.rank?.current.percentile ?? null,
		topLangs: bandLangs(snapshot, 'owned'),
		participatedRepos: snapshot?.repos?.participated ?? null,
		participatedStars: snapshot?.stars?.participated ?? null,
		participatedLangs: bandLangs(snapshot, 'participated'),
		combinedLangs: combinedBandLangs(snapshot),
		totalStars: snapshot?.stars?.owned ?? null,
		totalCommits: snapshot?.metrics.commitsAuthoredAllTime ?? null,
		totalPRs: snapshot?.metrics.prsOpenedAllTime ?? null,
		totalIssues: snapshot?.metrics.issuesOpenedAllTime ?? null,
	};
}

export function nowStatsFromSnapshot(snapshot: GitHubStatsSnapshotValue | null): NowStats {
	let topLanguage: NowStats['topLanguage'] = null;
	const langs = snapshot?.languages?.owned;
	if (langs && langs.length > 0) {
		const total = langs.reduce((sum, entry) => sum + entry.size, 0);
		const top = [...langs].sort((a, b) => b.size - a.size)[0];
		if (top && total > 0) {
			topLanguage = { name: top.name, pct: Math.round((top.size / total) * 100) };
		}
	}
	return {
		totalContributions: snapshot?.streak?.totalContributions ?? null,
		currentStreak: snapshot?.streak?.currentStreak ?? null,
		longestStreak: snapshot?.streak?.longestStreak ?? null,
		topLanguage,
	};
}

export function avatarFromSnapshot(snapshot: GitHubStatsSnapshotValue | null): string | null {
	return snapshot?.avatarDataUri ?? null;
}
