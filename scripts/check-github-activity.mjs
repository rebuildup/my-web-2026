#!/usr/bin/env node
/**
 * check-github-activity — validate the GitHub activity snapshot
 * (`src/home/activity/github-activity.json`, or the document a
 * `--push` run is about to send to the ingest endpoint) before it is
 * committed, deployed or stored (Issues #316 / #319 / #932).
 *
 * This is the CI-side half of the privacy contract: the sync script
 * guarantees private repos are anonymised BEFORE serialisation, and
 * this check re-verifies the artifact itself — a hand-edited or
 * corrupted snapshot cannot smuggle a private identifier past the
 * serializer.
 *
 * Rules checked (fail closed):
 *   - top-level shape: schemaVersion 1, windowDays, sources, repos, feed
 *   - every `kind:'private'` repo entry carries ONLY the anonymous
 *     allowlist {id: private-<hmac12>, kind, name:'非公開プロジェクト',
 *     lastActiveAt?, activity} — no repoFullName/htmlUrl/description/
 *     owner/branch/clone_url or any other key
 *   - no private entry's `id` equals a public `full_name` shape
 *   - feed entries are public-only (kind 'public' with repoId)
 *   - `sources.private.status` is a known state
 *
 * `checkActivitySnapshot` is exported so `sync-github-activity.mjs
 * --push` can run the SAME gate on the in-memory document before it
 * leaves the operator machine — the ingest boundary re-validates on
 * write, this check keeps a bad document from being sent at all.
 *
 * Output is status-only. Exit 0 = valid, 1 = violation, 2 = usage.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = join(REPO_ROOT, 'src/home/activity/github-activity.json');

const PRIVATE_ALLOWED_KEYS = new Set(['id', 'kind', 'name', 'lastActiveAt', 'activity']);
const ANON_ID = /^private-[0-9a-f]{12}$/;
const PUBLIC_ID = /^[^/\s]+\/[^/\s]+$/;
// The reader's vocabulary (`src/home/activity/contract.ts`
// `ActivitySourceState`). The gate and the reader must agree on what
// a source status may be, or a document the gate passes could be
// refused at render time.
const KNOWN_SOURCE_STATUSES = new Set(['ok', 'unconfigured', 'failed']);

/**
 * Validate one parsed snapshot document. Returns the list of
 * violations — empty means the document may be committed, deployed
 * or pushed. Pure: no I/O, no clock, no process state.
 */
export function checkActivitySnapshot(snapshot) {
	const failures = [];
	const fail = (msg) => failures.push(msg);

	if (!snapshot || typeof snapshot !== 'object') {
		return ['snapshot is not an object'];
	}
	if (snapshot.schemaVersion !== 1) fail('schemaVersion must be 1');
	if (typeof snapshot.windowDays !== 'number') fail('windowDays missing');
	if (!snapshot.sources || typeof snapshot.sources !== 'object') fail('sources missing');
	if (!Array.isArray(snapshot.repos)) fail('repos must be an array');
	if (!Array.isArray(snapshot.feed)) fail('feed must be an array');

	const repos = Array.isArray(snapshot.repos) ? snapshot.repos : [];
	const feed = Array.isArray(snapshot.feed) ? snapshot.feed : [];

	for (const [i, repo] of repos.entries()) {
		if (!repo || typeof repo !== 'object') {
			fail(`repos[${i}] is not an object`);
			continue;
		}
		if (repo.kind === 'private') {
			for (const key of Object.keys(repo)) {
				if (!PRIVATE_ALLOWED_KEYS.has(key)) {
					fail(`repos[${i}] private entry carries forbidden key '${key}'`);
				}
			}
			if (typeof repo.id !== 'string' || !ANON_ID.test(repo.id)) {
				fail(`repos[${i}] private id '${repo.id}' is not private-<hmac12>`);
			}
			if (PUBLIC_ID.test(String(repo.id))) {
				fail(`repos[${i}] private id looks like a public full_name`);
			}
			if (repo.name !== '非公開プロジェクト') {
				fail(`repos[${i}] private name is not the generic alias`);
			}
		} else if (repo.kind === 'public') {
			if (typeof repo.id !== 'string' || !PUBLIC_ID.test(repo.id)) {
				fail(`repos[${i}] public id '${repo.id}' is not owner/name`);
			}
		} else {
			fail(`repos[${i}] unknown kind '${repo.kind}'`);
		}
	}

	for (const [i, item] of feed.entries()) {
		if (!item || item.kind !== 'public' || typeof item.repoId !== 'string') {
			fail(`feed[${i}] is not a public repo reference`);
		}
	}

	const privateStatus = snapshot.sources?.private?.status;
	if (!KNOWN_SOURCE_STATUSES.has(privateStatus)) {
		fail(`sources.private.status '${privateStatus}' is not a known state`);
	}

	// Serialized-level sweep: a private repo's real name could hide in an
	// unexpected field the shape checks above do not enumerate (e.g. a
	// future key). The allowlist above already rejects unknown keys on
	// private entries; this sweep additionally asserts no `private-`
	// prefixed id collides with a public full_name and that the literal
	// string 'private-' never appears inside a public entry's id.
	for (const repo of repos) {
		if (repo?.kind === 'public' && String(repo.id).startsWith('private-')) {
			fail(`public entry id '${repo.id}' uses the private namespace`);
		}
	}

	return failures;
}

// Compare REAL paths: on macOS temp dirs live under /var →
// /private/var, so import.meta.url and argv[1] can differ textually
// while naming the same file — a textual compare silently skips main.
const isMain =
	process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);

if (isMain) {
	let snapshot;
	try {
		snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
	} catch (err) {
		console.error(`check-github-activity: cannot read/parse snapshot: ${err.message}`);
		process.exit(1);
	}

	const failures = checkActivitySnapshot(snapshot);
	if (failures.length > 0) {
		for (const f of failures) console.error(`check-github-activity: ${f}`);
		process.exit(1);
	}
	const repos = Array.isArray(snapshot.repos) ? snapshot.repos : [];
	const feed = Array.isArray(snapshot.feed) ? snapshot.feed : [];
	console.log(
		`check-github-activity: OK (${repos.length} repos, ${feed.length} feed, private=${snapshot.sources?.private?.status})`,
	);
}
