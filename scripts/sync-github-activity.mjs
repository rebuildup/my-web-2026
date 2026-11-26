#!/usr/bin/env node
/**
 * sync-github-activity — produce the GitHub activity snapshot the
 * home "現在地" sections read (Issues #316 / #319 / #932).
 *
 * Usage:
 *   node scripts/sync-github-activity.mjs [--dry-run]
 *   node scripts/sync-github-activity.mjs --push [--dry-run]
 *
 * Reads (public, unauthenticated unless GITHUB_TOKEN is set):
 *   - GET /users/<owner>/events/public        (recent public activity)
 *   - GET /users/<owner>/repos?per_page=100   (public repos + pushed_at)
 *   - with GITHUB_TOKEN: GET /user/repos?visibility=private&
 *     affiliation=owner,collaborator,organization_member
 *     (private repos too — anonymised before anything is written)
 *   - with GITHUB_TOKEN: GET /user/repos?visibility=public&
 *     affiliation=owner,collaborator,organization_member — the
 *     affiliation-scoped public directory (owned + org-member +
 *     collaborator repos, data contract §2.1). Each repo carries a
 *     `scope` tag: owned / org-member / collaborator. Org
 *     MEMBERSHIP only enumerates candidates — a repo enters the
 *     snapshot solely through the same observed-signal rule as
 *     before (feed event or measured authored contribution), so
 *     belonging to an org never implies activity there.
 *   - GET /search/commits?q=author:<owner> is:public — discovers
 *     `external-public` repos OUTSIDE every affiliation (contract
 *     §2.1): unique repository full_names are collected, repo
 *     metadata fetched per repo, and the same observed-signal +
 *     per-repo search measurement applies. Bounded to 50 repos.
 *   - GET /search/commits + /search/issues    (per-repo contribution
 *     counts: authored commits / authored PRs inside the window —
 *     Issue #967. Search `total_count` is exact and needs no paging;
 *     requests are paced under the authenticated search rate limit.)
 *
 * Privacy contract (#932): private repositories are reduced to
 *   { id: 'private-<hmac12>', kind:'private', name: alias-or-generic,
 *     activity aggregates, lastActiveAt }
 * BEFORE the snapshot is serialised. The HMAC salt comes from
 * GITHUB_ACTIVITY_SALT and is never written, logged or committed.
 * There is NO fallback salt: `anonId` refuses an empty salt, and
 * `buildSnapshot` refuses to emit private entries without one, so a
 * run that lacks the secret cannot produce a predictable or
 * re-identifiable private id — it fails closed instead. No repo
 * name, owner, URL, branch, commit message, issue text or hash for a
 * private repo can appear in the output — the serializer builds
 * private entries field-by-field, never by spreading upstream data.
 *
 * Output modes:
 *   default   write the committed snapshot
 *             `src/home/activity/github-activity.json` (reviewed
 *             fallback / release seed — updates still need a commit)
 *   --push    validate the document with `checkActivitySnapshot` and
 *             PUT it to the ingest endpoint
 *             (`GITHUB_ACTIVITY_INGEST_URL`, default production
 *             `/api/v1/activity/github`) with
 *             `Authorization: Bearer $MY_WEB_2026_API_KEY`. The Worker
 *             stores it in D1 and the home reads it at request time —
 *             no commit, PR merge or site release is needed for the
 *             public surface to reflect the refresh.
 *
 * Output is status-only. Exit 0 = snapshot written/pushed/unchanged,
 * 1 = transport/validation failure (writes NOTHING), 2 = usage.
 *
 * `buildSnapshot` / `anonId` / `repoFacts` are exported for the
 * contract test (`scripts/sync-github-activity.test.mjs`); `main`
 * only runs when the file is executed directly.
 */

import { createHmac } from 'node:crypto';
import { realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkActivitySnapshot } from './check-github-activity.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(REPO_ROOT, 'src/home/activity/github-activity.json');
const OWNER = 'rebuildup';
const WINDOW_DAYS = 30;
const API = 'https://api.github.com';
const UA = 'my-web-2026-activity-sync';
const INGEST_URL =
	process.env.GITHUB_ACTIVITY_INGEST_URL ?? 'https://rebuildup.dev/api/v1/activity/github';

export function anonId(repoId, salt) {
	// Fail closed: an empty salt must never produce an id. A
	// predictable HMAC key (`'unset-salt'` or `''`) would let anyone
	// recompute `private-<hmac12>` for a guessed repo id and re-link
	// the anonymous project back to the private repository.
	if (!salt) {
		throw new Error('GITHUB_ACTIVITY_SALT is required to anonymise private repositories');
	}
	return `private-${createHmac('sha256', salt).update(String(repoId)).digest('hex').slice(0, 12)}`;
}

export function repoFacts(repo, kind, salt) {
	const pushed = repo.pushed_at ?? null;
	return {
		id: kind === 'public' ? repo.full_name : anonId(repo.id, salt),
		kind,
		name: kind === 'public' ? repo.name : '非公開プロジェクト',
		...(kind === 'public' ? { repoFullName: repo.full_name, htmlUrl: repo.html_url } : {}),
		// Attribution scope (data contract §2.1): how the repo entered
		// the directory — owned / org-member / collaborator /
		// external-public. Absent on hand-built fixtures and private
		// entries (private scope never publishes an org relation).
		...(kind === 'public' && typeof repo.scope === 'string' ? { scope: repo.scope } : {}),
		...(pushed ? { lastActiveAt: pushed } : {}),
	};
}

/**
 * The publishable activity block for one repo (Issue #967).
 *
 * `events` counts public feed events inside the window; `commits` and
 * `prs` are the measured contribution counts the Search API returned
 * for this repo — authored commits (`committer-date`) and authored PRs
 * (`updated`). A count the search did not produce is ABSENT, never 0:
 * "not measured" and "zero" are different claims.
 */
function activityBlock(events, contribution, windowDays) {
	return {
		events,
		...(contribution?.commits !== undefined ? { commits: contribution.commits } : {}),
		...(contribution?.prs !== undefined ? { prs: contribution.prs } : {}),
		windowDays,
	};
}

/**
 * Whether a repo belongs in the snapshot at all (Issue #967).
 *
 * The old rule admitted every repo with a feed event OR a `pushed_at`
 * inside the window — which listed repositories the owner never
 * touched (a collaborator's push, a mirror sync). The rule now
 * requires an OBSERVED owner signal: a public feed event, or a
 * measured authored commit / PR. `pushed_at` alone no longer admits a
 * repo; it still supplies `lastActiveAt` for the ones that qualify.
 */
function hasObservedSignal(events, contribution) {
	if (events > 0) return true;
	if (!contribution) return false;
	return (contribution.commits ?? 0) > 0 || (contribution.prs ?? 0) > 0;
}

/**
 * The Issue/PR a public feed event belongs to (Issue #334 residual).
 *
 * Only the event types whose GitHub payload carries the object yield
 * a ref: `IssuesEvent` / `IssueCommentEvent` carry `payload.issue`
 * (an issue comment on a pull request has `issue.pull_request`, so
 * it is a `pull` ref), and the three pull-request event types carry
 * `payload.pull_request`. Every other type — `PushEvent`,
 * `CreateEvent`, … — has no Issue/PR to point at and gets no ref.
 *
 * `state` is published only when the payload proves it: `open` /
 * `closed` come from the object's `state`, and `merged` is derived
 * from `merged === true` / a `merged_at` timestamp on pull requests —
 * never guessed. A missing or malformed payload field yields no ref
 * at all rather than a partial claim.
 */
function eventRef(event) {
	const payload = event?.payload;
	if (!payload || typeof payload !== 'object') return undefined;

	const issueState = (issue) =>
		issue?.state === 'open' || issue?.state === 'closed' ? issue.state : undefined;
	const prState = (pr) => {
		if (pr?.merged === true || (typeof pr?.merged_at === 'string' && pr.merged_at)) {
			return 'merged';
		}
		return issueState(pr);
	};
	const ref = (kind, number, state) =>
		Number.isInteger(number) && number > 0
			? { kind, number, ...(state ? { state } : {}) }
			: undefined;

	switch (event.type) {
		case 'IssuesEvent': {
			const issue = payload.issue;
			return ref('issue', issue?.number, issueState(issue));
		}
		case 'IssueCommentEvent': {
			const issue = payload.issue;
			// A comment on a pull request arrives as an issue-shaped
			// payload with `pull_request` set — the permalink target
			// is the PR, so the ref kind follows the object.
			const kind = issue?.pull_request ? 'pull' : 'issue';
			return ref(kind, issue?.number, issueState(issue));
		}
		case 'PullRequestEvent':
		case 'PullRequestReviewEvent':
		case 'PullRequestReviewCommentEvent': {
			const pr = payload.pull_request;
			return ref('pull', pr?.number, prState(pr));
		}
		default:
			return undefined;
	}
}

/**
 * Pure snapshot builder — fetch results in, serialisable snapshot
 * out. Exported so the privacy contract (private fields never
 * survive) is testable without network or credentials.
 *
 * Throws when private repositories were fetched but no salt was
 * supplied: emitting them under a missing/empty salt is exactly the
 * leak the contract forbids, so the whole build fails instead of
 * degrading to public-only output the operator did not ask for.
 */
export function buildSnapshot({
	events,
	publicRepos,
	privateRepos,
	contributions,
	now,
	salt,
	headSha,
}) {
	if (privateRepos?.length && !salt) {
		throw new Error(
			'GITHUB_ACTIVITY_SALT is required when GITHUB_TOKEN fetched private repositories',
		);
	}
	const cutoff = now.getTime() - WINDOW_DAYS * 86_400_000;
	const feed = (Array.isArray(events) ? events : [])
		.filter((e) => e.repo?.name && Date.parse(e.created_at) >= cutoff)
		.map((e) => {
			const ref = eventRef(e);
			return {
				id: `${e.id}`,
				kind: 'public',
				repoId: e.repo.name,
				type: e.type,
				at: e.created_at,
				...(ref ? { ref } : {}),
			};
		})
		.slice(0, 30);

	const counts = new Map();
	for (const item of feed) counts.set(item.repoId, (counts.get(item.repoId) ?? 0) + 1);

	const repos = [];
	for (const repo of publicRepos) {
		const contribution = contributions?.[repo.full_name];
		const n = counts.get(repo.full_name) ?? 0;
		if (hasObservedSignal(n, contribution)) {
			repos.push({
				...repoFacts(repo, 'public', salt),
				activity: activityBlock(n, contribution, WINDOW_DAYS),
			});
		}
	}
	const privateStatus = privateRepos ? 'ok' : 'unconfigured';
	if (privateRepos) {
		for (const repo of privateRepos) {
			const contribution = contributions?.[repo.full_name];
			if (hasObservedSignal(0, contribution)) {
				repos.push({
					...repoFacts(repo, 'private', salt),
					activity: activityBlock(0, contribution, WINDOW_DAYS),
				});
			}
		}
	}

	const observedAt = now.toISOString();
	return {
		schemaVersion: 1,
		generatedOn: observedAt.slice(0, 10),
		...(headSha ? { headSha } : {}),
		windowDays: WINDOW_DAYS,
		sources: {
			public: { status: 'ok', observedAt },
			private: { status: privateStatus, observedAt },
		},
		repos,
		feed,
	};
}

/**
 * Per-repo contribution counts via the Search API (Issue #967).
 *
 * Two `total_count` queries per repo — authored commits inside the
 * window and authored PRs updated inside it — paced sequentially
 * under the search rate limit (30 req/min authenticated, 10
 * unauthenticated). A repo whose queries fail keeps `undefined`
 * counts: the snapshot then carries events-only activity for it,
 * which the reader treats as "contribution not measured" rather than
 * zero. A rate-limit response aborts the remaining queries — the
 * partial map is still truthful per repo.
 *
 * Private repos are queried by `full_name` exactly like public ones;
 * the name travels only inside the request to GitHub, never into the
 * snapshot.
 */
async function fetchContributions(repos, sinceDate, token) {
	const out = {};
	const delayMs = token ? 2_500 : 6_500;
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	async function searchTotalCount(query) {
		const res = await fetch(`${API}/search/${query.path}?q=${encodeURIComponent(query.q)}`, {
			headers: {
				accept: 'application/vnd.github+json',
				'user-agent': UA,
				...(token ? { authorization: `Bearer ${token}` } : {}),
			},
			signal: AbortSignal.timeout(15_000),
		});
		if (res.status === 403 || res.status === 429) {
			const err = new Error(`github search rate limited -> ${res.status}`);
			err.rateLimited = true;
			throw err;
		}
		if (!res.ok) throw new Error(`github search -> ${res.status}`);
		const body = await res.json();
		return Number.isInteger(body.total_count) ? body.total_count : undefined;
	}

	for (const repo of repos) {
		const fullName = repo?.full_name;
		if (typeof fullName !== 'string' || fullName.length === 0) continue;
		try {
			const commits = await searchTotalCount({
				path: 'commits',
				q: `repo:${fullName} author:${OWNER} committer-date:>=${sinceDate}`,
			});
			await sleep(delayMs);
			const prs = await searchTotalCount({
				path: 'issues',
				q: `repo:${fullName} type:pr author:${OWNER} updated:>=${sinceDate}`,
			});
			out[fullName] = {
				...(commits !== undefined ? { commits } : {}),
				...(prs !== undefined ? { prs } : {}),
			};
		} catch (err) {
			if (err?.rateLimited) {
				console.error(
					'sync-github-activity: search rate limit hit — remaining repos keep unmeasured contributions',
				);
				break;
			}
			// A single repo's search failure leaves its counts absent;
			// the snapshot stays truthful (events still counted).
		}
		await sleep(delayMs);
	}
	return out;
}

const AFFILIATIONS = 'owner,collaborator,organization_member';
const EXTERNAL_DISCOVERY_LIMIT = 50;

/**
 * Attribution scope for a `/user/repos?affiliation=…` result
 * (data contract §2.1). The affiliation parameter enumerates
 * candidates; it does not say WHICH affiliation matched, so scope
 * is derived from repo shape: owner login → owned, Organization
 * owner → org-member, otherwise a user-owned repo the owner merely
 * collaborates on → collaborator.
 */
function scopeForAffiliationRepo(repo) {
	if (repo?.owner?.login === OWNER) return 'owned';
	if (repo?.owner?.type === 'Organization') return 'org-member';
	return 'collaborator';
}

/**
 * `external-public` discovery (data contract §2.1): public repos
 * OUTSIDE every affiliation where the owner has authored commits.
 * One page of `search/commits` yields up to 100 items; unique repo
 * full_names are collected (capped), then each repo's metadata is
 * fetched so `pushed_at`/`html_url` behave like affiliation repos.
 * Failure degrades to an empty list — external discovery must never
 * fail the whole sync.
 */
async function discoverExternalPublicRepos(gh, token) {
	try {
		const res = await fetch(
			`${API}/search/commits?q=${encodeURIComponent(`author:${OWNER} is:public`)}&per_page=100`,
			{
				headers: {
					accept: 'application/vnd.github+json',
					'user-agent': UA,
					...(token ? { authorization: `Bearer ${token}` } : {}),
				},
				signal: AbortSignal.timeout(15_000),
			},
		);
		if (!res.ok) return [];
		const body = await res.json();
		const names = [
			...new Set(
				(body.items ?? [])
					.map((item) => item?.repository?.full_name)
					.filter((n) => typeof n === 'string' && n.length > 0),
			),
		].slice(0, EXTERNAL_DISCOVERY_LIMIT);
		const repos = [];
		for (const fullName of names) {
			try {
				const repo = await gh(`/repos/${fullName}`);
				repo.scope = 'external-public';
				repos.push(repo);
			} catch {
				// A deleted/inaccessible repo simply drops out.
			}
		}
		return repos;
	} catch {
		return [];
	}
}

async function push(snapshot) {
	const apiKey = process.env.MY_WEB_2026_API_KEY;
	if (!apiKey) {
		throw new Error(
			'MY_WEB_2026_API_KEY is required for --push (the github_activity:write ingest key — see docs/runbook/github-activity-sync.md)',
		);
	}
	const res = await fetch(INGEST_URL, {
		method: 'PUT',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${apiKey}`,
			// The boundary CSRF guard fails closed on a write with no
			// origin evidence; this is a first-party server-to-server
			// caller, so it declares its own origin.
			origin: new URL(INGEST_URL).origin,
		},
		body: JSON.stringify(snapshot),
		signal: AbortSignal.timeout(15_000),
	});
	if (!res.ok) {
		throw new Error(`ingest ${INGEST_URL} -> ${res.status}`);
	}
}

async function main() {
	const token = process.env.GITHUB_TOKEN || '';
	const salt = process.env.GITHUB_ACTIVITY_SALT || '';
	const dryRun = process.argv.includes('--dry-run');
	const pushMode = process.argv.includes('--push');

	// Fail fast BEFORE any network call: a token without the salt
	// would fetch private repositories and then have no lawful way to
	// name them — refuse the run instead of fetching-then-failing.
	if (token && !salt) {
		console.error(
			'sync-github-activity: GITHUB_TOKEN is set but GITHUB_ACTIVITY_SALT is not — refusing to fetch private repositories without the anonymisation secret',
		);
		process.exit(2);
	}

	async function gh(path) {
		const res = await fetch(`${API}${path}`, {
			headers: {
				accept: 'application/vnd.github+json',
				'user-agent': UA,
				...(token ? { authorization: `Bearer ${token}` } : {}),
			},
			signal: AbortSignal.timeout(15_000),
		});
		if (!res.ok) throw new Error(`github ${path} -> ${res.status}`);
		return res.json();
	}

	const [events, legacyPublicRepos, affiliationRepos, privateRepos, externalRepos] =
		await Promise.all([
			gh(`/users/${OWNER}/events/public?per_page=100`),
			gh(`/users/${OWNER}/repos?per_page=100&sort=pushed`),
			token
				? gh(`/user/repos?visibility=public&affiliation=${AFFILIATIONS}&per_page=100`).catch(
						(err) => {
							console.error(
								`sync-github-activity: affiliation public fetch failed (${err.message}) — falling back to owned repos`,
							);
							return null;
						},
					)
				: Promise.resolve(null),
			token
				? gh(`/user/repos?visibility=private&affiliation=${AFFILIATIONS}&per_page=100`).catch(
						(err) => {
							console.error(
								`sync-github-activity: affiliation private fetch failed (${err.message}) — private repos skipped`,
							);
							return null;
						},
					)
				: Promise.resolve(null),
			discoverExternalPublicRepos(gh, token),
		]);

	// Public directory: affiliation-scoped when a token is present
	// (owned + org-member + collaborator), else the legacy owned-only
	// listing. Deduped by full_name with affiliation winning over
	// external-public discovery (contract §2.1).
	const publicByName = new Map();
	const affiliationPublic = affiliationRepos ?? legacyPublicRepos ?? [];
	for (const repo of affiliationPublic) {
		if (typeof repo?.full_name !== 'string') continue;
		repo.scope = affiliationRepos ? scopeForAffiliationRepo(repo) : 'owned';
		publicByName.set(repo.full_name.toLowerCase(), repo);
	}
	for (const repo of externalRepos ?? []) {
		if (typeof repo?.full_name !== 'string') continue;
		if (!publicByName.has(repo.full_name.toLowerCase())) {
			publicByName.set(repo.full_name.toLowerCase(), repo);
		}
	}
	const publicRepos = [...publicByName.values()];

	const now = new Date();
	const sinceDate = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
	const contributions = await fetchContributions(
		[...publicRepos, ...(privateRepos ?? [])],
		sinceDate,
		token,
	);

	const snapshot = buildSnapshot({
		events,
		publicRepos,
		privateRepos,
		contributions,
		now,
		salt,
		headSha: process.env.GITHUB_SHA || undefined,
	});

	const privateCount = snapshot.repos.filter((r) => r.kind === 'private').length;
	if (pushMode) {
		// The same gate the committed file passes through — run it on
		// the in-memory document so a bad snapshot is never sent.
		const failures = checkActivitySnapshot(snapshot);
		if (failures.length > 0) {
			for (const f of failures) console.error(`sync-github-activity: ${f}`);
			process.exit(1);
		}
		if (dryRun) {
			console.log(
				`dry-run: ${snapshot.repos.length} repos (${privateCount} private-anon), ${snapshot.feed.length} feed items — not pushed`,
			);
			return;
		}
		await push(snapshot);
		console.log(
			`pushed ${INGEST_URL}: ${snapshot.repos.length} repos (${privateCount} private-anon), ${snapshot.feed.length} feed`,
		);
		return;
	}

	const body = `${JSON.stringify(snapshot, null, '\t')}\n`;
	if (dryRun) {
		console.log(`dry-run: ${snapshot.repos.length} repos, ${snapshot.feed.length} feed items`);
		return;
	}
	writeFileSync(OUT, body);
	console.log(
		`wrote ${OUT}: ${snapshot.repos.length} repos (${privateCount} private-anon), ${snapshot.feed.length} feed`,
	);
}

// Compare REAL paths: on macOS temp dirs live under /var →
// /private/var, so import.meta.url and argv[1] can differ textually
// while naming the same file — a textual compare silently skips main.
const isMain =
	process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
	main().catch((err) => {
		console.error(`sync-github-activity failed: ${err.message}`);
		process.exit(1);
	});
}
