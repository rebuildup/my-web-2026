import { z } from 'zod';

/**
 * GitHub stats ingest — wire schema (Issues #1244 / #1245, data
 * contract `docs/domain/github-profile-data.md`).
 *
 * This is the HTTP boundary's contract for
 * `PUT /api/v1/stats/github`: the exact JSON document
 * `scripts/sync-github-stats.mjs --push` sends and the only shape
 * that may be stored in D1 `github_stats_snapshot`.
 *
 * The schema is deliberately STRICT and allowlisted like
 * `src/http/activity/schema.ts`: `.strict()` rejects unknown keys,
 * every field is bounded, and every metric is `null`-able — an
 * absent upstream is "not measured", never a silent zero. The
 * document carries aggregates and PUBLIC repo totals only: no
 * private repo names, owners, or per-repo rows exist in this
 * contract at all (contract §4).
 *
 * Field names encode the metric window (`*Y1` = GitHub
 * contributionsCollection 1-year window, `*AllTime` = all-time);
 * scope semantics are owned by the contract document, not repeated
 * per field.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const DATA_IMAGE_URI = /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/;

const SourceState = z
	.object({
		status: z.enum(['ok', 'unconfigured', 'failed']),
		observedAt: z.string().regex(RFC3339).max(64).optional(),
	})
	.strict();

const Streak = z
	.object({
		currentStreak: z.number().int().min(0).max(100_000),
		longestStreak: z.number().int().min(0).max(100_000),
		totalContributions: z.number().int().min(0).max(10_000_000),
		firstContribution: z.string().max(64),
		currentStreakStart: z.string().max(64),
		currentStreakEnd: z.string().max(64),
		longestStreakStart: z.string().max(64),
		longestStreakEnd: z.string().max(64),
	})
	.strict();

const Metrics = z
	.object({
		contributionsY1: z.number().int().min(0).max(10_000_000).nullable(),
		reviewsY1: z.number().int().min(0).max(1_000_000).nullable(),
		commitsAuthoredAllTime: z.number().int().min(0).max(10_000_000).nullable(),
		prsAuthoredAllTime: z.number().int().min(0).max(1_000_000).nullable(),
		issuesAuthoredAllTime: z.number().int().min(0).max(1_000_000).nullable(),
		prsOpenedAllTime: z.number().int().min(0).max(1_000_000).nullable(),
		issuesOpenedAllTime: z.number().int().min(0).max(1_000_000).nullable(),
		contributedTo: z.number().int().min(0).max(100_000).nullable(),
		followers: z.number().int().min(0).max(10_000_000).nullable(),
	})
	.strict();

const Repos = z
	.object({
		owned: z.number().int().min(0).max(100_000).nullable(),
		contributedTo: z.number().int().min(0).max(100_000).nullable(),
		participated: z.number().int().min(0).max(100_000).nullable(),
		complete: z.boolean(),
	})
	.strict();

const Stars = z
	.object({
		owned: z.number().int().min(0).max(100_000_000).nullable(),
		participated: z.number().int().min(0).max(100_000_000).nullable(),
	})
	.strict();

const LanguageEntry = z
	.object({
		name: z.string().min(1).max(64),
		color: z.string().max(16).nullable(),
		size: z.number().int().min(0).max(1_000_000_000_000),
		count: z.number().int().min(0).max(100_000),
	})
	.strict();

const Languages = z
	.object({
		owned: z.array(LanguageEntry).max(20),
		participated: z.array(LanguageEntry).max(20),
	})
	.strict();

const RankResult = z
	.object({
		level: z.string().min(1).max(8),
		percentile: z.number().min(0).max(100),
	})
	.strict();

const RankInputs = z
	.object({
		all_commits: z.literal(true),
		commits: z.number().int().min(0).max(10_000_000),
		prs: z.number().int().min(0).max(1_000_000),
		issues: z.number().int().min(0).max(1_000_000),
		reviews: z.number().int().min(0).max(1_000_000),
		repos: z.number().int().min(0).max(100_000),
		stars: z.number().int().min(0).max(100_000_000),
		followers: z.number().int().min(0).max(10_000_000),
	})
	.strict();

const Rank = z
	.object({
		inputs: RankInputs,
		current: RankResult,
		legacy: RankResult,
	})
	.strict();

export const GitHubStatsSnapshotBody = z
	.object({
		schemaVersion: z.literal(1),
		generatedOn: z.string().regex(ISO_DATE),
		observedAt: z.string().regex(RFC3339).max(64),
		owner: z.string().regex(LOGIN).max(39),
		sources: z
			.object({
				graphql: SourceState,
				streak: SourceState,
				search: SourceState,
				avatar: SourceState,
			})
			.strict(),
		streak: Streak.nullable(),
		metrics: Metrics,
		repos: Repos.nullable(),
		stars: Stars.nullable(),
		languages: Languages.nullable(),
		rank: Rank.nullable(),
		avatarDataUri: z.string().regex(DATA_IMAGE_URI).max(800_000).nullable(),
	})
	.strict();

export type GitHubStatsSnapshotValue = z.infer<typeof GitHubStatsSnapshotBody>;
