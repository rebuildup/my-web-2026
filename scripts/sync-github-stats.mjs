#!/usr/bin/env node
/**
 * sync-github-stats — produce the GitHub stats snapshot the profile
 * Vitals / Top Languages / stats surfaces read (Issues #1244 / #1245,
 * data contract `docs/domain/github-profile-data.md`).
 *
 * Usage:
 *   node scripts/sync-github-stats.mjs [--dry-run]
 *   node scripts/sync-github-stats.mjs --push [--dry-run]
 *
 * This is the ASYNC half of the delivery separation (ADR-0027):
 * image requests never call the GitHub API; this job gathers the
 * metrics, persists them through the ingest endpoint, and the
 * delivery path reads D1 only.
 *
 * Reads (GITHUB_TOKEN required — affiliation + private visibility
 * and the search API all need auth):
 *   - GraphQL user stats: contributionsCollection (y1),
 *     repositoriesContributedTo, pullRequests, issues, followers,
 *     and the affiliated repo directory
 *     (ownerAffiliations OWNER / COLLABORATOR / ORGANIZATION_MEMBER)
 *     with per-repo stargazerCount + languages — contract §2.1/§3.
 *   - GraphQL streak: contributionYears + per-year contribution
 *     calendars (allTime, same semantics as the vendored
 *     streak-fetcher).
 *   - Search API allTime authored counts: commits / PRs / issues
 *     (`author:<login>` total_count — public search surface).
 *   - Search API `author:<login> is:public` commit discovery for
 *     `external-public` repos OUTSIDE every affiliation (contract
 *     §2.1), then ONE batched aliased GraphQL query per 25 repos for
 *     their stars/languages.
 *   - `github.com/<login>.png` avatar → data URI (contract §5.1).
 *
 * Metric semantics (contract §3 — every field name encodes its
 * window; scope is documented per section):
 *   - `*Y1` fields are the GitHub contributionsCollection 1-year
 *     window. `*AllTime` fields are genuinely all-time.
 *   - Repo-level aggregates (stars.participated, languages.*) cover
 *     PUBLIC repos only — private repo composition never enters a
 *     public-facing aggregate (contract §4).
 *   - `languages.owned` = language byte composition of owned public
 *     non-fork repos; `languages.participated` = the same over
 *     contributed-to (non-owned) + external-public repos. Repo
 *     attribute ≠ author attribute — per-author code-change volume
 *     is NOT claimed (contract §3 `languages.authoredBytes` row).
 *   - `rank.current` uses the vendored calculateRank on declared
 *     inputs; `rank.legacy` runs the pre-vendoring anuraghazra
 *     formula on the SAME inputs so the old-vs-new comparison is
 *     data, not prose (contract §3.1).
 *
 * Privacy: the document carries ONLY aggregates and public repo
 * language/star totals — no private repo names, owners, or per-repo
 * rows at all. Org membership is used for discovery only and is
 * never published.
 *
 * Output modes:
 *   default   write the document to `.tmp/github-stats-snapshot.json`
 *             for review (no committed fallback — D1 is the store)
 *   --push    validate and PUT it to the ingest endpoint
 *             (`GITHUB_STATS_INGEST_URL`, default production
 *             `/api/v1/stats/github`) with
 *             `Authorization: Bearer $MY_WEB_2026_API_KEY` — the key
 *             needs the `github_stats:write` scope.
 *
 * Output is status-only. Exit 0 = snapshot written/pushed, 1 =
 * transport/validation failure or total upstream failure (writes
 * NOTHING — LKG preserved), 2 = usage.
 *
 * `buildStatsSnapshot` / `calculateRankLegacy` are exported for the
 * contract test (`scripts/sync-github-stats.test.mjs`); `main` only
 * runs when the file is executed directly.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateRank } from '../src/vendor/github-readme-stats-fast/calculateRank.ts';
import { acquireSyncLock, pushWithRetry } from './_sync-ops.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(REPO_ROOT, '.tmp/github-stats-snapshot.json');
const OWNER = 'rebuildup';
const API = 'https://api.github.com';
const UA = 'my-web-2026-stats-sync';
const INGEST_URL =
	process.env.GITHUB_STATS_INGEST_URL ?? 'https://rebuildup.dev/api/v1/stats/github';
const EXTERNAL_DISCOVERY_LIMIT = 50;
const REPO_PAGE_CAP = 5; // 5 × 100 = 500 affiliated repos per scope
const ALIAS_BATCH = 25;

const AFFILIATIONS = '[OWNER, COLLABORATOR, ORGANIZATION_MEMBER]';

// ---------------------------------------------------------------------------
// Rank — legacy (anuraghazra/github-readme-stats) formula, kept ONLY for the
// contract §3.1 same-input comparison. `repos` is unused upstream, exactly
// like the original. Source: upstream src/calculateRank.js.
// ---------------------------------------------------------------------------

function exponentialCdf(x) {
	return 1 - 2 ** -x;
}

function logNormalCdf(x) {
	// approximation
	return x / (1 + x);
}

export function calculateRankLegacy({
	all_commits = false,
	commits,
	prs,
	issues,
	reviews,
	repos: _repos,
	stars,
	followers,
}) {
	const COMMITS_MEDIAN = all_commits ? 1000 : 250;
	const COMMITS_WEIGHT = 2;
	const PRS_MEDIAN = 50;
	const PRS_WEIGHT = 3;
	const ISSUES_MEDIAN = 25;
	const ISSUES_WEIGHT = 1;
	const REVIEWS_MEDIAN = 2;
	const REVIEWS_WEIGHT = 1;
	const STARS_MEDIAN = 50;
	const STARS_WEIGHT = 4;
	const FOLLOWERS_MEDIAN = 10;
	const FOLLOWERS_WEIGHT = 1;

	const TOTAL_WEIGHT =
		COMMITS_WEIGHT + PRS_WEIGHT + ISSUES_WEIGHT + REVIEWS_WEIGHT + STARS_WEIGHT + FOLLOWERS_WEIGHT;

	const THRESHOLDS = [1, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100];
	const LEVELS = ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C'];

	const rank =
		1 -
		(COMMITS_WEIGHT * exponentialCdf(commits / COMMITS_MEDIAN) +
			PRS_WEIGHT * exponentialCdf(prs / PRS_MEDIAN) +
			ISSUES_WEIGHT * exponentialCdf(issues / ISSUES_MEDIAN) +
			REVIEWS_WEIGHT * exponentialCdf(reviews / REVIEWS_MEDIAN) +
			STARS_WEIGHT * logNormalCdf(stars / STARS_MEDIAN) +
			FOLLOWERS_WEIGHT * logNormalCdf(followers / FOLLOWERS_MEDIAN)) /
			TOTAL_WEIGHT;

	const level = LEVELS[THRESHOLDS.findIndex((t) => rank * 100 <= t)];

	return { level, percentile: Math.round(rank * 1000) / 10 };
}

// ---------------------------------------------------------------------------
// Snapshot builder — pure: fetch results in, wire document out.
// ---------------------------------------------------------------------------

const SOURCE_OK = 'ok';
const SOURCE_FAILED = 'failed';

function langAggregate(nodes) {
	// nodes: repo nodes already filtered to public + non-fork scope.
	// Returns language entries {name,color,size,count} sorted desc.
	const acc = new Map();
	for (const repo of nodes) {
		const edges = repo?.languages?.edges ?? [];
		for (const edge of edges) {
			const name = edge?.node?.name;
			const size = edge?.size;
			if (typeof name !== 'string' || !Number.isFinite(size)) continue;
			const cur = acc.get(name) ?? { name, color: edge.node.color ?? null, size: 0, count: 0 };
			cur.size += size;
			cur.count += 1;
			acc.set(name, cur);
		}
	}
	return [...acc.values()].sort((a, b) => b.size - a.size).slice(0, 20);
}

function sumStars(nodes) {
	return nodes.reduce((sum, repo) => sum + (repo?.stargazerCount ?? 0), 0);
}

const isPublicNonFork = (repo) => repo && repo.isPrivate !== true && repo.isFork !== true;

/**
 * Build the wire document. Every upstream group may independently be
 * `null` (source failed) — the corresponding metric fields stay `null`
 * rather than collapsing to a lying zero. `sources` records which
 * upstreams actually answered.
 */
export function buildStatsSnapshot({
	user,
	ownedRepoNodes,
	contributedRepoNodes,
	externalRepoNodes,
	ownedTruncated,
	contributedTruncated,
	streak,
	streakFailed = false,
	searchCounts,
	avatarDataUri,
	now,
}) {
	const observedAt = now.toISOString();
	const graphqlOk = user != null;
	const searchOk = searchCounts != null;
	const sources = {
		graphql: { status: graphqlOk ? SOURCE_OK : SOURCE_FAILED, observedAt },
		// streak is a separate GraphQL workload: a calendar failure must
		// not mark the stats query failed, and an empty contribution
		// history is 'ok' with a null streak — not a failure.
		streak: { status: streakFailed ? SOURCE_FAILED : SOURCE_OK, observedAt },
		search: { status: searchOk ? SOURCE_OK : SOURCE_FAILED, observedAt },
		avatar: { status: avatarDataUri ? SOURCE_OK : 'unconfigured', observedAt },
	};

	// Owned vs participated split (contract §2.1/§3). Owned = OWNER
	// affiliation nodes; participated = contributedTo repos NOT owned
	// by the user, plus external-public discoveries.
	const ownedPublicNonFork = (ownedRepoNodes ?? []).filter(isPublicNonFork);
	const contributedNonOwned = (contributedRepoNodes ?? []).filter(
		(repo) => repo && repo.owner?.login !== OWNER,
	);
	const contributedPublicNonFork = contributedNonOwned.filter(isPublicNonFork);
	const externalPublicNonFork = (externalRepoNodes ?? []).filter(isPublicNonFork);

	const participatedLangNodes = [...contributedPublicNonFork, ...externalPublicNonFork];
	const participatedStarNodes = [
		...contributedNonOwned.filter((repo) => repo && repo.isPrivate !== true),
		...(externalRepoNodes ?? []).filter((repo) => repo && repo.isPrivate !== true),
	];

	const metrics = {
		// contributionsCollection is the GitHub 1-year window (y1).
		contributionsY1: graphqlOk
			? (user.contributionsCollection?.totalCommitContributions ?? null)
			: null,
		reviewsY1: graphqlOk
			? (user.contributionsCollection?.totalPullRequestReviewContributions ?? null)
			: null,
		// Search API allTime authored counts (public search surface).
		commitsAuthoredAllTime: searchOk ? (searchCounts.commits ?? null) : null,
		prsAuthoredAllTime: searchOk ? (searchCounts.prs ?? null) : null,
		issuesAuthoredAllTime: searchOk ? (searchCounts.issues ?? null) : null,
		// GraphQL authored totals — any repo the token can see.
		prsOpenedAllTime: graphqlOk ? (user.pullRequests?.totalCount ?? null) : null,
		issuesOpenedAllTime: graphqlOk ? (user.issues?.totalCount ?? null) : null,
		contributedTo: graphqlOk ? (user.repositoriesContributedTo?.totalCount ?? null) : null,
		followers: graphqlOk ? (user.followers?.totalCount ?? null) : null,
	};

	const repos = graphqlOk
		? {
				owned: user.ownedReposTotalCount ?? null,
				contributedTo: user.repositoriesContributedTo?.totalCount ?? null,
				// participated = contributedTo repos not owned (measured
				// over fetched nodes) + external-public discoveries.
				// `complete:false` when a directory page cap was hit —
				// the count is then a lower bound, not a lie.
				participated: contributedNonOwned.length + (externalRepoNodes ?? []).length,
				complete: !(ownedTruncated || contributedTruncated),
			}
		: null;

	const stars =
		graphqlOk || (externalRepoNodes ?? []).length > 0
			? {
					owned: graphqlOk ? sumStars(ownedRepoNodes ?? []) : null,
					participated: sumStars(participatedStarNodes),
				}
			: null;

	const languages =
		graphqlOk || (externalRepoNodes ?? []).length > 0
			? {
					owned: langAggregate(ownedPublicNonFork),
					participated: langAggregate(participatedLangNodes),
				}
			: null;

	// Rank inputs (contract §3.1 decision): commits/prs/issues use the
	// allTime AUTHORED counts (search surface, public repos — the same
	// numbers the profile may claim); reviews keep the y1 window;
	// repos/stars stay OWNED-scope (participated stars/repos are
	// reported separately, not folded into rank — v1 keeps the
	// owned-scope semantics the vendored formula was tuned on).
	const rankInputs = {
		all_commits: true,
		commits: metrics.commitsAuthoredAllTime,
		prs: metrics.prsAuthoredAllTime,
		issues: metrics.issuesAuthoredAllTime,
		reviews: metrics.reviewsY1,
		repos: repos?.owned ?? null,
		stars: stars?.owned ?? null,
		followers: metrics.followers,
	};
	const rankReady = Object.values(rankInputs).every(
		(v) => v === true || (typeof v === 'number' && Number.isFinite(v)),
	);
	const rank = rankReady
		? {
				inputs: rankInputs,
				current: calculateRank(rankInputs),
				legacy: calculateRankLegacy(rankInputs),
			}
		: null;

	return {
		schemaVersion: 1,
		generatedOn: observedAt.slice(0, 10),
		observedAt,
		owner: OWNER,
		sources,
		streak: streak ?? null,
		metrics,
		repos,
		stars,
		languages,
		rank,
		avatarDataUri: avatarDataUri ?? null,
	};
}

// ---------------------------------------------------------------------------
// Streak — port of the vendored streak-fetcher's allTime semantics
// (contributionYears + one aliased calendar query + day-walk). Kept
// self-contained: the script must run under plain `node`.
// ---------------------------------------------------------------------------

async function graphql(query, variables, token) {
	// Transient upstream failures (5xx, gateway timeouts, empty bodies)
	// get two retries with a short backoff; schema errors and GraphQL
	// `errors` payloads are deterministic and fail immediately.
	let lastErr;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const res = await fetch(`${API}/graphql`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/vnd.github+json',
					'user-agent': UA,
					authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({ query, variables }),
				signal: AbortSignal.timeout(20_000),
			});
			if (!res.ok) {
				const err = new Error(`github graphql -> ${res.status}`);
				if (res.status < 500) throw err;
				throw Object.assign(err, { transient: true });
			}
			const body = await res.json();
			if (body.errors?.length) {
				throw new Error(`github graphql errors: ${body.errors[0]?.message ?? 'unknown'}`);
			}
			return body.data;
		} catch (err) {
			lastErr = err;
			const transient =
				err?.transient === true || err?.name === 'TimeoutError' || err instanceof SyntaxError;
			if (!transient || attempt === 2) throw err;
			await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
		}
	}
	throw lastErr;
}

async function fetchStreakAllTime(token) {
	const yearsData = await graphql(
		'query($login:String!){user(login:$login){contributionsCollection{contributionYears}}}',
		{ login: OWNER },
		token,
	);
	const years = yearsData?.user?.contributionsCollection?.contributionYears ?? [];
	if (years.length === 0) return null;

	const fragments = years
		.map((year) => {
			const from = `${year}-01-01T00:00:00Z`;
			const to = `${year}-12-31T23:59:59Z`;
			return `y${year}: contributionsCollection(from:"${from}",to:"${to}"){
				contributionCalendar{weeks{contributionDays{date contributionCount}}}}`;
		})
		.join('\n');
	const calData = await graphql(
		`query($login:String!){user(login:$login){${fragments}}}`,
		{ login: OWNER },
		token,
	);
	const user = calData?.user ?? {};
	const contributions = {};
	for (const year of years) {
		const weeks = user[`y${year}`]?.contributionCalendar?.weeks ?? [];
		for (const week of weeks) {
			for (const day of week.contributionDays ?? []) {
				if (day.contributionCount > 0) contributions[day.date] = day.contributionCount;
			}
		}
	}

	// Same day-walk as the vendored calculateStreaks.
	const dates = Object.keys(contributions).sort();
	if (dates.length === 0) {
		return {
			currentStreak: 0,
			longestStreak: 0,
			totalContributions: 0,
			firstContribution: '',
			currentStreakStart: '',
			currentStreakEnd: '',
			longestStreakStart: '',
			longestStreakEnd: '',
		};
	}
	let totalContributions = 0;
	for (const d of dates) totalContributions += contributions[d];
	const firstContribution = dates.find((d) => contributions[d] > 0) ?? '';

	const now = new Date();
	const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
		.toISOString()
		.split('T')[0];
	const yesterday = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
	)
		.toISOString()
		.split('T')[0];

	let currentStreak = 0;
	let currentStreakStart = '';
	let currentStreakEnd = '';
	const startDate =
		(contributions[today] ?? 0) > 0
			? today
			: (contributions[yesterday] ?? 0) > 0
				? yesterday
				: null;
	if (startDate) {
		const d = new Date(`${startDate}T00:00:00Z`);
		while (true) {
			const dateStr = d.toISOString().split('T')[0];
			if ((contributions[dateStr] ?? 0) > 0) {
				currentStreak += 1;
				currentStreakEnd ||= dateStr;
				currentStreakStart = dateStr;
				d.setUTCDate(d.getUTCDate() - 1);
			} else break;
		}
	}

	let longestStreak = 0;
	let tempStreak = 0;
	let prevDate = null;
	let tempStreakStart = null;
	let longestStreakStart = null;
	let longestStreakEnd = null;
	for (const date of dates) {
		const count = contributions[date];
		if (count > 0) {
			const gap =
				prevDate == null
					? 1
					: (new Date(date).getTime() - new Date(prevDate).getTime()) / 86_400_000;
			if (gap === 1) tempStreak += 1;
			else {
				tempStreak = 1;
				tempStreakStart = date;
			}
			if (tempStreak > longestStreak) {
				longestStreak = tempStreak;
				longestStreakStart = tempStreakStart ?? date;
				longestStreakEnd = date;
			}
		} else {
			tempStreak = 0;
		}
		prevDate = date;
	}

	const fmt = (d, withYear = true) =>
		d
			? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
					month: 'short',
					day: 'numeric',
					...(withYear ? { year: 'numeric' } : {}),
					timeZone: 'UTC',
				})
			: '';
	const longestEndYear = longestStreakEnd
		? new Date(`${longestStreakEnd}T00:00:00Z`).getUTCFullYear() !== now.getUTCFullYear()
		: false;

	return {
		currentStreak,
		longestStreak,
		totalContributions,
		firstContribution: fmt(firstContribution, true),
		currentStreakStart: fmt(currentStreakStart, true),
		currentStreakEnd: fmt(currentStreakEnd, false),
		longestStreakStart: fmt(longestStreakStart, true),
		longestStreakEnd: fmt(longestStreakEnd, longestEndYear),
	};
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchJson(url, { token, graphql: isGraphql = false, method, body } = {}) {
	const res = await fetch(url, {
		method: method ?? 'GET',
		headers: {
			accept: 'application/vnd.github+json',
			'user-agent': UA,
			...(token ? { authorization: `Bearer ${token}` } : {}),
			...(body ? { 'content-type': 'application/json' } : {}),
		},
		...(body ? { body: JSON.stringify(body) } : {}),
		signal: AbortSignal.timeout(20_000),
	});
	if (!res.ok) throw new Error(`github ${url} -> ${res.status}`);
	return res.json();
}

async function searchTotalCount(path, q, token) {
	const body = await fetchJson(`${API}/search/${path}?q=${encodeURIComponent(q)}&per_page=1`, {
		token,
	});
	return Number.isInteger(body.total_count) ? body.total_count : null;
}

const USER_STATS_QUERY = `
query($login:String!,$after:String){
  user(login:$login){
    name login
    contributionsCollection{totalCommitContributions totalPullRequestReviewContributions}
    repositoriesContributedTo(first:1,contributionTypes:[COMMIT,ISSUE,PULL_REQUEST,REPOSITORY]){totalCount}
    pullRequests(first:1){totalCount}
    issues(first:1){totalCount}
    followers{totalCount}
    ownedRepos: repositories(first:100,after:$after,ownerAffiliations:[OWNER],orderBy:{direction:DESC,field:STARGAZERS}){
      totalCount pageInfo{hasNextPage endCursor}
      nodes{name isPrivate isFork stargazerCount languages(first:10,orderBy:{field:SIZE,direction:DESC}){edges{size node{color name}}}}
    }
  }
}`;

const CONTRIB_REPOS_QUERY = `
query($login:String!){
  user(login:$login){
    contributedRepos: repositoriesContributedTo(first:100,contributionTypes:[COMMIT,ISSUE,PULL_REQUEST,REPOSITORY]){
      totalCount pageInfo{hasNextPage}
      nodes{name isPrivate isFork stargazerCount owner{login} languages(first:10,orderBy:{field:SIZE,direction:DESC}){edges{size node{color name}}}}
    }
  }
}`;

async function fetchUserStats(token) {
	// Page the owned-repo directory (stars/languages need every node);
	// the scalar fields ride along on the first page — no re-query.
	const ownedNodes = [];
	let user = null;
	let ownedTruncated = false;
	let after;
	for (let page = 0; page < REPO_PAGE_CAP; page++) {
		const data = await graphql(USER_STATS_QUERY, { login: OWNER, after }, token);
		user = data?.user ?? user;
		if (!user) throw new Error('github graphql: user not found');
		const conn = user.ownedRepos;
		ownedNodes.push(...(conn?.nodes ?? []));
		const pageInfo = conn?.pageInfo;
		if (!pageInfo?.hasNextPage || page === REPO_PAGE_CAP - 1) {
			ownedTruncated = pageInfo?.hasNextPage === true;
			break;
		}
		after = pageInfo.endCursor;
	}
	user = { ...user, ownedReposTotalCount: user.ownedRepos?.totalCount ?? null };

	const contribData = await graphql(CONTRIB_REPOS_QUERY, { login: OWNER }, token);
	const contrib = contribData?.user?.contributedRepos;
	return {
		user,
		ownedRepoNodes: ownedNodes,
		contributedRepoNodes: contrib?.nodes ?? [],
		contributedTruncated: contrib?.pageInfo?.hasNextPage === true,
		ownedTruncated,
	};
}

async function discoverExternalRepos(token) {
	const body = await fetchJson(
		`${API}/search/commits?q=${encodeURIComponent(`author:${OWNER} is:public`)}&per_page=100`,
		{ token },
	);
	const names = [
		...new Set(
			(body.items ?? [])
				.map((item) => item?.repository?.full_name)
				.filter((n) => typeof n === 'string' && n.length > 0),
		),
	].slice(0, EXTERNAL_DISCOVERY_LIMIT);
	return names;
}

function externalAliases(names) {
	// One aliased GraphQL query per ALIAS_BATCH repos — repository()
	// lookups are cheap nodes; batching keeps this to ≤2 calls.
	const batches = [];
	for (let i = 0; i < names.length; i += ALIAS_BATCH) {
		batches.push(names.slice(i, i + ALIAS_BATCH));
	}
	return batches;
}

async function fetchExternalRepoNodes(names, token) {
	const nodes = [];
	for (const batch of externalAliases(names)) {
		const fields = batch
			.map((fullName, i) => {
				const [owner, name] = fullName.split('/');
				return `r${i}: repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){
					name isPrivate isFork stargazerCount
					owner{login}
					languages(first:10,orderBy:{field:SIZE,direction:DESC}){edges{size node{color name}}}
				}`;
			})
			.join('\n');
		const data = await graphql(`query{${fields}}`, {}, token);
		for (const repo of Object.values(data ?? {})) {
			if (repo) nodes.push(repo);
		}
	}
	return nodes;
}

async function fetchAvatarDataUri(token) {
	try {
		const res = await fetch(`https://github.com/${OWNER}.png`, {
			headers: { 'user-agent': UA, ...(token ? { authorization: `Bearer ${token}` } : {}) },
			signal: AbortSignal.timeout(10_000),
			redirect: 'follow',
		});
		const type = res.headers.get('content-type') ?? '';
		if (!res.ok || !type.startsWith('image/')) return null;
		const buf = await res.arrayBuffer();
		if (buf.byteLength === 0 || buf.byteLength > 512 * 1024) return null;
		const bytes = new Uint8Array(buf);
		let bin = '';
		for (let i = 0; i < bytes.length; i += 0x8000) {
			bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
		}
		return `data:${type.split(';')[0]};base64,${btoa(bin)}`;
	} catch {
		return null;
	}
}

async function push(snapshot) {
	const apiKey = process.env.MY_WEB_2026_API_KEY;
	if (!apiKey) {
		throw new Error(
			'MY_WEB_2026_API_KEY is required for --push (needs the github_stats:write scope — see docs/runbook/github-activity-sync.md)',
		);
	}
	const res = await pushWithRetry(
		INGEST_URL,
		{
			method: 'PUT',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${apiKey}`,
				origin: new URL(INGEST_URL).origin,
			},
			body: JSON.stringify(snapshot),
			signal: AbortSignal.timeout(15_000),
		},
		{ label: 'sync-github-stats' },
	);
	if (!res.ok) throw new Error(`ingest ${INGEST_URL} -> ${res.status}`);
}

// Minimal local validator mirroring the ingest schema's hard rules —
// the boundary re-validates; this keeps a malformed document from
// being sent at all.
function validateSnapshot(snapshot) {
	const failures = [];
	if (snapshot?.schemaVersion !== 1) failures.push('schemaVersion');
	if (typeof snapshot?.observedAt !== 'string') failures.push('observedAt');
	if (snapshot?.avatarDataUri != null && !snapshot.avatarDataUri.startsWith('data:image/')) {
		failures.push('avatarDataUri');
	}
	return failures;
}

async function main() {
	const lock = acquireSyncLock(join(REPO_ROOT, '.tmp/sync-github-stats.lock'), {
		label: 'sync-github-stats',
	});
	if (!lock) {
		console.log('sync-github-stats: another run holds the sync lock — skipping');
		return;
	}
	process.on('exit', () => lock.release());
	const token = process.env.GITHUB_TOKEN || '';
	const dryRun = process.argv.includes('--dry-run');
	const pushMode = process.argv.includes('--push');
	if (!token) {
		console.error('sync-github-stats: GITHUB_TOKEN is required');
		process.exit(2);
	}

	const now = new Date();
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	// Independent upstream groups — one failure must not sink the rest.
	const [statsResult, streakResult, searchResult, externalNames, avatarDataUri] = await Promise.all(
		[
			fetchUserStats(token).catch((err) => {
				console.error(`sync-github-stats: user stats failed (${err.message})`);
				return null;
			}),
			fetchStreakAllTime(token)
				.then((streak) => ({ streak, failed: false }))
				.catch((err) => {
					console.error(`sync-github-stats: streak failed (${err.message})`);
					return { streak: null, failed: true };
				}),
			(async () => {
				try {
					const delayMs = 2_500;
					const commits = await searchTotalCount('commits', `author:${OWNER}`, token);
					await sleep(delayMs);
					const prs = await searchTotalCount('issues', `author:${OWNER} type:pr`, token);
					await sleep(delayMs);
					const issues = await searchTotalCount('issues', `author:${OWNER} type:issue`, token);
					return { commits, prs, issues };
				} catch (err) {
					console.error(`sync-github-stats: search counts failed (${err.message})`);
					return null;
				}
			})(),
			discoverExternalRepos(token).catch((err) => {
				console.error(`sync-github-stats: external discovery failed (${err.message})`);
				return [];
			}),
			fetchAvatarDataUri(token),
		],
	);

	// External-public repo stats — only when discovery produced names
	// and the affiliated directory succeeded enough to dedup against.
	let externalRepoNodes = [];
	if (externalNames.length > 0) {
		// Dedup against every affiliated repo already in the directory
		// (owned + contributedTo), case-insensitive full_name.
		const affiliatedFull = new Set(
			[
				...(statsResult?.ownedRepoNodes ?? []).map((r) => `${OWNER}/${r.name}`),
				...(statsResult?.contributedRepoNodes ?? []).map((r) =>
					r.owner?.login ? `${r.owner.login}/${r.name}` : null,
				),
			]
				.filter(Boolean)
				.map((n) => n.toLowerCase()),
		);
		const pending = externalNames.filter((n) => !affiliatedFull.has(n.toLowerCase()));
		try {
			externalRepoNodes = await fetchExternalRepoNodes(pending, token);
		} catch (err) {
			console.error(`sync-github-stats: external repo stats failed (${err.message})`);
		}
	}

	if (!statsResult && !searchResult && !streakResult?.streak) {
		console.error('sync-github-stats: every upstream failed — keeping Last Known Good');
		process.exit(1);
	}

	const snapshot = buildStatsSnapshot({
		user: statsResult?.user ?? null,
		ownedRepoNodes: statsResult?.ownedRepoNodes ?? [],
		contributedRepoNodes: statsResult?.contributedRepoNodes ?? [],
		externalRepoNodes,
		ownedTruncated: statsResult?.ownedTruncated ?? false,
		contributedTruncated: statsResult?.contributedTruncated ?? false,
		streak: streakResult?.streak ?? null,
		streakFailed: streakResult?.failed ?? true,
		searchCounts: searchResult,
		avatarDataUri,
		now,
	});

	const failures = validateSnapshot(snapshot);
	if (failures.length > 0) {
		console.error(`sync-github-stats: snapshot failed local validation: ${failures.join(', ')}`);
		process.exit(1);
	}

	if (pushMode) {
		await push(snapshot);
		console.log('sync-github-stats: pushed github_stats_snapshot');
	} else {
		mkdirSync(dirname(OUT), { recursive: true });
		writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);
		console.log(`sync-github-stats: wrote ${OUT}`);
		if (dryRun) console.log('(dry-run: nothing pushed)');
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(`sync-github-stats: ${err.message}`);
		process.exit(1);
	});
}
