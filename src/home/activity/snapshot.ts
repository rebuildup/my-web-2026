/**
 * GitHub activity snapshot — fail-closed reader and projections
 * (Issues #316 / #319 / #932).
 *
 * Everything here is pure: validate the committed JSON, project the
 * publishable half, derive current-project records. No fetch, no
 * clock, no binding.
 *
 * Fail-closed rules
 * -----------------
 *   - A malformed snapshot yields `null` — callers render the
 *     "unavailable" state, never a half-parsed one.
 *   - Private-kind entries MUST already carry an anonymous id
 *     (`private-<hex>`) and MUST NOT carry `repoFullName` /
 *     `htmlUrl`; a snapshot that violates this is rejected whole,
 *     because one leaked field contaminates the file.
 *   - Feed items for private repos are dropped from the public
 *     projection regardless of what the file contains.
 */

import type { CurrentProjectRecord } from '../current/types';
import type {
	ActivityFeedItem,
	ActivityRepoFacts,
	GitHubActivitySnapshot,
	HomeGitHubActivity,
	HomeGitHubActivityRepoMeasure,
} from './contract';
import { ACTIVITY_OVERRIDES } from './overrides';

const PRIVATE_ID = /^private-[0-9a-f]{12}$/;
const REPO_ID = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const WEIGHT_LEVELS = new Set(['primary', 'active', 'side', 'paused']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validSourceState(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (!['ok', 'unconfigured', 'failed'].includes(value.status as string)) return false;
	if (value.observedAt !== undefined && typeof value.observedAt !== 'string') return false;
	return true;
}

function validRepo(value: unknown): value is ActivityRepoFacts {
	if (!isRecord(value)) return false;
	if (value.kind !== 'public' && value.kind !== 'private') return false;
	if (typeof value.id !== 'string' || value.id.length === 0) return false;
	if (typeof value.name !== 'string' || value.name.trim().length === 0) return false;
	if (value.kind === 'private') {
		// The anonymisation contract, enforced on READ too: a private
		// entry that carries a real-looking id or any URL-shaped field
		// is a leak, and the whole snapshot is refused.
		if (!PRIVATE_ID.test(value.id)) return false;
		if (value.repoFullName !== undefined || value.htmlUrl !== undefined) return false;
	} else if (!REPO_ID.test(value.id)) {
		return false;
	}
	if (value.summaryJa !== undefined && typeof value.summaryJa !== 'string') return false;
	if (value.repoFullName !== undefined && typeof value.repoFullName !== 'string') return false;
	if (value.htmlUrl !== undefined && typeof value.htmlUrl !== 'string') return false;
	if (value.lastActiveAt !== undefined && typeof value.lastActiveAt !== 'string') return false;
	if (value.weightLevel !== undefined && !WEIGHT_LEVELS.has(value.weightLevel as string))
		return false;
	if (value.activity !== undefined) {
		const a = value.activity;
		if (!isRecord(a)) return false;
		if (!Number.isInteger(a.events) || (a.events as number) < 0) return false;
		if (a.commits !== undefined && (!Number.isInteger(a.commits) || (a.commits as number) < 0))
			return false;
		if (a.prs !== undefined && (!Number.isInteger(a.prs) || (a.prs as number) < 0)) return false;
		if (!Number.isInteger(a.windowDays) || (a.windowDays as number) < 1) return false;
	}
	return true;
}

const REF_KINDS = new Set(['issue', 'pull']);
const REF_STATES = new Set(['open', 'closed', 'merged']);

/**
 * The optional Issue/PR reference on a feed item (Issue #334). The
 * shape is closed: an unknown kind/state or a non-positive number
 * rejects the whole snapshot — a malformed ref is a malformed claim.
 */
function validFeedItemRef(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (!REF_KINDS.has(value.kind as string)) return false;
	if (!Number.isInteger(value.number) || (value.number as number) < 1) return false;
	if (value.state !== undefined && !REF_STATES.has(value.state as string)) return false;
	return true;
}

function validFeedItem(value: unknown): value is ActivityFeedItem {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === 'string' &&
		(value.kind === 'public' || value.kind === 'private') &&
		typeof value.repoId === 'string' &&
		typeof value.type === 'string' &&
		typeof value.at === 'string' &&
		RFC3339.test(value.at) &&
		(value.ref === undefined || validFeedItemRef(value.ref))
	);
}

/**
 * Validate the committed snapshot. Returns the typed snapshot or
 * `null` — callers treat `null` as "no GitHub data", never as an
 * empty-but-valid state.
 */
export function readGitHubActivitySnapshot(value: unknown): GitHubActivitySnapshot | null {
	if (!isRecord(value)) return null;
	if (value.schemaVersion !== 1) return null;
	if (typeof value.generatedOn !== 'string' || !ISO_DATE.test(value.generatedOn)) return null;
	if (!Number.isInteger(value.windowDays) || (value.windowDays as number) < 1) return null;
	if (!isRecord(value.sources)) return null;
	if (!validSourceState(value.sources.public) || !validSourceState(value.sources.private))
		return null;
	if (!Array.isArray(value.repos) || !value.repos.every(validRepo)) return null;
	if (!Array.isArray(value.feed) || !value.feed.every(validFeedItem)) return null;
	// Duplicate ids would make "which project is this" ambiguous.
	const ids = new Set<string>();
	for (const repo of value.repos as ActivityRepoFacts[]) {
		if (ids.has(repo.id)) return null;
		ids.add(repo.id);
	}
	return value as unknown as GitHubActivitySnapshot;
}

/**
 * Apply the authored overrides to one repo fact. Excluded projects
 * return `null`; everything else keeps only publishable fields.
 */
function applyOverride(repo: ActivityRepoFacts): ActivityRepoFacts | null {
	const override = ACTIVITY_OVERRIDES[repo.id];
	if (override?.exclude) return null;
	return {
		...repo,
		...(override?.name ? { name: override.name } : {}),
		...(override?.summaryJa ? { summaryJa: override.summaryJa } : {}),
		...(override?.weightLevel ? { weightLevel: override.weightLevel } : {}),
	};
}

const SAFE_DEFAULT_SUMMARY: Readonly<Record<ActivityRepoFacts['kind'], string>> = {
	public: 'GitHub 上で活動が観測された公開リポジトリ。',
	private: 'GitHub 上で活動が観測された非公開リポジトリ。',
};

/**
 * How many GitHub-observed projects the section publishes (Issue
 * #967). The snapshot still carries every repo with an observed
 * signal — the feed and the repo counts keep the full set — but the
 * project list is a RANKED selection, not an enumeration: listing
 * every repository GitHub ever saw was the pre-aggregation defect (37
 * detail rows, mostly zero-activity noise).
 */
export const MAX_GITHUB_PROJECT_RECORDS = 12;

/** The day part of an ISO instant, or `undefined` when unusable. */
function isoDay(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const day = value.slice(0, 10);
	return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}

/**
 * Rank GitHub-observed records for publication: measured contribution
 * first (commits + PRs inside the window), then recency, then id so
 * the order is total and deterministic.
 */
function contributionScore(record: CurrentProjectRecord): number {
	const activity = record.weight?.activity?.value;
	if (!activity) return -1;
	return activity.commits + (activity.pullRequests ?? 0);
}

function compareGithubRecords(a: CurrentProjectRecord, b: CurrentProjectRecord): number {
	const byScore = contributionScore(b) - contributionScore(a);
	if (byScore !== 0) return byScore;
	const aDay = a.updatedOn?.value ?? '';
	const bDay = b.updatedOn?.value ?? '';
	if (aDay !== bDay) return aDay < bDay ? 1 : -1;
	if (a.id === b.id) return 0;
	return a.id < b.id ? -1 : 1;
}

/**
 * Project the snapshot into current-project records (#316/#932/#967).
 *
 * Every record's measured facts are stamped `github` with the
 * snapshot's `generatedOn` as `observedOn`, so the document can tell
 * a GitHub measurement from a git one or a memory. Private records
 * carry NO link — there is no publishable URL for them.
 *
 * The activity fact reports the MEASURED contribution (`commits`,
 * `pullRequests`) — never the feed `events` count, which measures
 * something else (Issue #967). A repo whose contribution search did
 * not run publishes no activity claim at all rather than a
 * mislabeled one.
 */
export function activityProjectRecords(
	snapshot: GitHubActivitySnapshot,
): readonly CurrentProjectRecord[] {
	const observedOn = snapshot.generatedOn;
	const evidence = `github-activity @ ${snapshot.headSha ?? snapshot.generatedOn}`;
	const records: CurrentProjectRecord[] = [];
	for (const raw of snapshot.repos) {
		const repo = applyOverride(raw);
		if (!repo) continue;
		const updatedDay = isoDay(repo.lastActiveAt);
		const record: CurrentProjectRecord = {
			id: `gh-${repo.id}`,
			name: repo.name,
			statusJa: repo.summaryJa ?? SAFE_DEFAULT_SUMMARY[repo.kind],
			...(updatedDay
				? {
						updatedOn: {
							value: updatedDay,
							source: 'github' as const,
							observedOn,
							evidence,
						},
					}
				: {}),
			weight: {
				...(repo.weightLevel
					? {
							level: {
								value: repo.weightLevel,
								source: 'github' as const,
								observedOn,
								evidence: `overrides @ ${snapshot.generatedOn}`,
							},
						}
					: {}),
				...(repo.activity && repo.activity.commits !== undefined
					? {
							activity: {
								value: {
									commits: repo.activity.commits,
									windowDays: repo.activity.windowDays,
									...(repo.activity.prs !== undefined ? { pullRequests: repo.activity.prs } : {}),
								},
								source: 'github' as const,
								observedOn,
								evidence,
							},
						}
					: {}),
			},
			...(repo.kind === 'public' && repo.htmlUrl
				? { link: { label: 'GitHub', href: repo.htmlUrl } }
				: {}),
		};
		records.push(record);
	}
	return records.sort(compareGithubRecords).slice(0, MAX_GITHUB_PROJECT_RECORDS);
}

/**
 * How many measured repos the card lists (#967). The card is a
 * summary surface, not the ranked project list — five rows carry
 * the "where the measured work is" signal without re-enumerating
 * the snapshot.
 */
export const MAX_ACTIVITY_TOP_REPOS = 5;

function measureScore(measure: HomeGitHubActivityRepoMeasure): number {
	return measure.commits + (measure.pullRequests ?? 0);
}

function compareMeasures(
	a: HomeGitHubActivityRepoMeasure,
	b: HomeGitHubActivityRepoMeasure,
): number {
	const byScore = measureScore(b) - measureScore(a);
	if (byScore !== 0) return byScore;
	const byCommits = b.commits - a.commits;
	if (byCommits !== 0) return byCommits;
	if (a.id === b.id) return 0;
	return a.id < b.id ? -1 : 1;
}

/**
 * The link target for one PUBLIC feed item (Issue #334). A `ref`
 * produces the event permalink built from `repoId` — but only when
 * `repoId` matches the `owner/name` grammar, so a malformed id can
 * never become a URL. Without a usable `ref`, the public repo's
 * `htmlUrl` is the fallback; `undefined` means "no provable link".
 */
function feedItemHref(
	item: ActivityFeedItem,
	urlByRepoId: ReadonlyMap<string, string>,
): string | undefined {
	if (item.ref && REPO_ID.test(item.repoId)) {
		const segment = item.ref.kind === 'pull' ? 'pull' : 'issues';
		return `https://github.com/${item.repoId}/${segment}/${item.ref.number}`;
	}
	return urlByRepoId.get(item.repoId);
}

/**
 * The public projection for the status card (#319 / #967).
 *
 * Private feed items and private repo counts describe ONLY the
 * anonymous ids — counts are publishable aggregates, identities are
 * not. Feed items gain `href` from data the snapshot can prove
 * (Issue #334): when the item carries `ref`, the permalink is built
 * from the `owner/name` `repoId` the public events API returned —
 * `…/issues/<n>` or `…/pull/<n>` — which also covers event repos the
 * owner does not own; otherwise the link falls back to the PUBLIC
 * repo's `htmlUrl`. A private-kind item is filtered before any href
 * is derived, and `repoId` must match the `owner/name` grammar before
 * it is interpolated into a URL — nothing is fabricated.
 * `topRepos` carries the measured
 * authored commits / PRs per public repo, ranked by contribution —
 * the semantic aggregate the card leads with.
 */
export function publicGitHubActivity(snapshot: GitHubActivitySnapshot): HomeGitHubActivity {
	const visibleRepos = snapshot.repos.filter((r) => !ACTIVITY_OVERRIDES[r.id]?.exclude);
	const publicRepos = visibleRepos.filter((r) => r.kind === 'public');
	const privateRepos = visibleRepos.filter((r) => r.kind === 'private');
	const urlByRepoId = new Map<string, string>();
	for (const repo of publicRepos) {
		if (repo.htmlUrl) urlByRepoId.set(repo.id, repo.htmlUrl);
	}
	const feed = snapshot.feed
		.filter((item) => item.kind === 'public')
		.map((item) => {
			const href = feedItemHref(item, urlByRepoId);
			return href ? { ...item, href } : { ...item };
		});
	const topRepos = publicRepos
		.filter((repo) => repo.activity?.commits !== undefined)
		.map((repo): HomeGitHubActivityRepoMeasure => {
			const activity = repo.activity;
			return {
				id: repo.id,
				name: repo.name,
				...(repo.htmlUrl ? { href: repo.htmlUrl } : {}),
				commits: activity?.commits ?? 0,
				...(activity?.prs !== undefined ? { pullRequests: activity.prs } : {}),
				windowDays: activity?.windowDays ?? snapshot.windowDays,
			};
		})
		.sort(compareMeasures)
		.slice(0, MAX_ACTIVITY_TOP_REPOS);
	return {
		generatedOn: snapshot.generatedOn,
		windowDays: snapshot.windowDays,
		sources: snapshot.sources,
		feed,
		topRepos,
		repoCount: { public: publicRepos.length, private: privateRepos.length },
	};
}
