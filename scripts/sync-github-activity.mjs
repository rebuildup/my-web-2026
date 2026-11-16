#!/usr/bin/env node
/**
 * sync-github-activity — produce the committed GitHub activity
 * snapshot the home "現在地" sections read (Issues #316 / #319 / #932).
 *
 * Usage:
 *   node scripts/sync-github-activity.mjs [--dry-run]
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
 * No repo name, owner, URL, branch, commit message, issue text or
 * hash for a private repo can appear in the output — the serializer
 * builds private entries field-by-field, never by spreading upstream
 * data.
 *
 * Output is status-only. Exit 0 = snapshot written/unchanged,
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

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(REPO_ROOT, 'src/home/activity/github-activity.json');
const OWNER = 'rebuildup';
const WINDOW_DAYS = 30;
const API = 'https://api.github.com';
const UA = 'my-web-2026-activity-sync';

export function anonId(repoId, salt) {
	return `private-${createHmac('sha256', salt || 'unset-salt')
		.update(String(repoId))
		.digest('hex')
		.slice(0, 12)}`;
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
 */
export function buildSnapshot({ events, publicRepos, privateRepos, now, salt, headSha }) {
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

async function main() {
	const token = process.env.GITHUB_TOKEN || '';
	const salt = process.env.GITHUB_ACTIVITY_SALT || '';
	const dryRun = process.argv.includes('--dry-run');

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

	const body = `${JSON.stringify(snapshot, null, '\t')}\n`;
	if (dryRun) {
		console.log(`dry-run: ${snapshot.repos.length} repos, ${snapshot.feed.length} feed items`);
		return;
	}
	writeFileSync(OUT, body);
	console.log(
		`wrote ${OUT}: ${snapshot.repos.length} repos (${snapshot.repos.filter((r) => r.kind === 'private').length} private-anon), ${snapshot.feed.length} feed`,
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
