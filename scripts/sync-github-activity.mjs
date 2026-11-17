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
 *   - with GITHUB_TOKEN: GET /user/repos?visibility=private&affiliation=owner
 *     (private repos too — anonymised before anything is written)
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
		...(pushed ? { lastActiveAt: pushed } : {}),
	};
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
export function buildSnapshot({ events, publicRepos, privateRepos, now, salt, headSha }) {
	if (privateRepos?.length && !salt) {
		throw new Error(
			'GITHUB_ACTIVITY_SALT is required when GITHUB_TOKEN fetched private repositories',
		);
	}
	const cutoff = now.getTime() - WINDOW_DAYS * 86_400_000;
	const feed = (Array.isArray(events) ? events : [])
		.filter((e) => e.repo?.name && Date.parse(e.created_at) >= cutoff)
		.map((e) => ({
			id: `${e.id}`,
			kind: 'public',
			repoId: e.repo.name,
			type: e.type,
			at: e.created_at,
		}))
		.slice(0, 30);

	const counts = new Map();
	for (const item of feed) counts.set(item.repoId, (counts.get(item.repoId) ?? 0) + 1);

	const repos = [];
	for (const repo of publicRepos) {
		const facts = repoFacts(repo, 'public', salt);
		const n = counts.get(repo.full_name) ?? 0;
		if (n > 0 || (repo.pushed_at && Date.parse(repo.pushed_at) >= cutoff)) {
			repos.push({
				...facts,
				activity: { events: n, windowDays: WINDOW_DAYS },
			});
		}
	}
	const privateStatus = privateRepos ? 'ok' : 'unconfigured';
	if (privateRepos) {
		for (const repo of privateRepos) {
			const pushed = repo.pushed_at ? Date.parse(repo.pushed_at) : 0;
			if (pushed >= cutoff) {
				repos.push({
					...repoFacts(repo, 'private', salt),
					activity: { events: 0, windowDays: WINDOW_DAYS },
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

	const [events, publicRepos, privateRepos] = await Promise.all([
		gh(`/users/${OWNER}/events/public?per_page=100`),
		gh(`/users/${OWNER}/repos?per_page=100&sort=pushed`),
		token
			? gh('/user/repos?visibility=private&affiliation=owner&per_page=100')
			: Promise.resolve(null),
	]);

	const snapshot = buildSnapshot({
		events,
		publicRepos,
		privateRepos,
		now: new Date(),
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
