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
		if (!Number.isInteger(a.windowDays) || (a.windowDays as number) < 1) return false;
	}
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
		RFC3339.test(value.at)
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
	private: 'GitHub 上で活動が観測された非公開リポジトリ（名称・URL は非表示）。',
};

/**
 * Project the snapshot into current-project records (#316/#932).
 *
 * Every record's measured facts are stamped `github` with the
 * snapshot's `generatedOn` as `observedOn`, so the document can tell
 * a GitHub measurement from a git one or a memory. Private records
 * carry NO link — there is no publishable URL for them.
 */
export function activityProjectRecords(
	snapshot: GitHubActivitySnapshot,
): readonly CurrentProjectRecord[] {
	const records: CurrentProjectRecord[] = [];
	for (const raw of snapshot.repos) {
		const repo = applyOverride(raw);
		if (!repo) continue;
		const observedOn = snapshot.generatedOn;
		const record: CurrentProjectRecord = {
			id: `gh-${repo.id}`,
			name: repo.name,
			statusJa: repo.summaryJa ?? SAFE_DEFAULT_SUMMARY[repo.kind],
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
				...(repo.activity
					? {
							activity: {
								value: {
									commits: repo.activity.events,
									windowDays: repo.activity.windowDays,
								},
								source: 'github' as const,
								observedOn,
								evidence: `github-activity @ ${snapshot.headSha ?? snapshot.generatedOn}`,
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
	return records;
}

/**
 * The public projection for the status card (#319). Private feed
 * items and private repo counts describe ONLY the anonymous ids —
 * counts are publishable aggregates, identities are not.
 */
export function publicGitHubActivity(snapshot: GitHubActivitySnapshot): HomeGitHubActivity {
	const publicRepos = snapshot.repos.filter(
		(r) => r.kind === 'public' && !ACTIVITY_OVERRIDES[r.id]?.exclude,
	);
	const privateRepos = snapshot.repos.filter(
		(r) => r.kind === 'private' && !ACTIVITY_OVERRIDES[r.id]?.exclude,
	);
	return {
		generatedOn: snapshot.generatedOn,
		windowDays: snapshot.windowDays,
		sources: snapshot.sources,
		feed: snapshot.feed.filter((item) => item.kind === 'public'),
		repoCount: { public: publicRepos.length, private: privateRepos.length },
	};
}
