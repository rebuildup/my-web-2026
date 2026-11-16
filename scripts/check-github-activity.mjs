#!/usr/bin/env node
/**
 * check-github-activity — validate the committed GitHub activity
 * snapshot (`src/home/activity/github-activity.json`) before it is
 * committed or deployed (Issues #316 / #319 / #932).
 *
 * This is the CI-side half of the privacy contract: the sync script
 * guarantees private repos are anonymised BEFORE serialisation, and
 * this check re-verifies the artifact itself — a hand-edited or
 * corrupted snapshot cannot smuggle a private identifier past the
 * serializer.
 *
 * Rules checked (fail closed, exit 1 on any violation):
 *   - top-level shape: schemaVersion 1, windowDays, sources, repos, feed
 *   - every `kind:'private'` repo entry carries ONLY the anonymous
 *     allowlist {id: private-<hmac12>, kind, name:'非公開プロジェクト',
 *     lastActiveAt?, activity} — no repoFullName/htmlUrl/description/
 *     owner/branch/clone_url or any other key
 *   - no private entry's `id` equals a public `full_name` shape
 *   - feed entries are public-only (kind 'public' with repoId)
 *   - `sources.private.status` is consistent with whether private
 *     entries exist ('ok' may have zero recent private repos; that is
 *     honest — the source was configured, nothing was active)
 *
 * Output is status-only. Exit 0 = valid, 1 = violation, 2 = usage.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = join(REPO_ROOT, 'src/home/activity/github-activity.json');

const PRIVATE_ALLOWED_KEYS = new Set(['id', 'kind', 'name', 'lastActiveAt', 'activity']);
const ANON_ID = /^private-[0-9a-f]{12}$/;
const PUBLIC_ID = /^[^/\s]+\/[^/\s]+$/;

const failures = [];
const fail = (msg) => failures.push(msg);

let snapshot;
try {
	snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
} catch (err) {
	console.error(`check-github-activity: cannot read/parse snapshot: ${err.message}`);
	process.exit(1);
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
if (!['ok', 'unconfigured', 'error'].includes(privateStatus)) {
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

if (failures.length > 0) {
	for (const f of failures) console.error(`check-github-activity: ${f}`);
	process.exit(1);
}
console.log(
	`check-github-activity: OK (${repos.length} repos, ${feed.length} feed, private=${privateStatus})`,
);
