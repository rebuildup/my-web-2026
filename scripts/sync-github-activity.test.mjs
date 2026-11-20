import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { anonId, buildSnapshot, repoFacts } from './sync-github-activity.mjs';

const NOW = new Date('2026-11-16T12:00:00.000Z');
const SALT = 'test-salt-not-a-real-secret';
const OLD = new Date(NOW.getTime() - 40 * 86_400_000).toISOString(); // outside window
const RECENT = new Date(NOW.getTime() - 5 * 86_400_000).toISOString(); // inside window

const publicRepo = {
	id: 1,
	full_name: 'rebuildup/my-web-2026',
	name: 'my-web-2026',
	html_url: 'https://github.com/rebuildup/my-web-2026',
	pushed_at: RECENT,
};

// A private repo carrying every field the privacy contract forbids:
// real name, owner, URL, description, default branch, clone URL.
const privateRepo = {
	id: 987654321,
	full_name: 'rebuildup/secret-side-project',
	name: 'secret-side-project',
	html_url: 'https://github.com/rebuildup/secret-side-project',
	description: 'do not publish this',
	default_branch: 'main',
	clone_url: 'https://github.com/rebuildup/secret-side-project.git',
	pushed_at: RECENT,
};

const privateRepoStale = {
	...privateRepo,
	id: 111,
	full_name: 'rebuildup/other-private',
	pushed_at: OLD,
};

describe('anonId — no fallback salt (privacy regression)', () => {
	it('refuses an empty salt instead of deriving a predictable id', () => {
		assert.throws(() => anonId(42, ''), /GITHUB_ACTIVITY_SALT/);
		assert.throws(() => anonId(42, undefined), /GITHUB_ACTIVITY_SALT/);
		assert.throws(() => anonId(42, null), /GITHUB_ACTIVITY_SALT/);
	});
	it('never derives ids from a guessable constant', () => {
		// The removed `salt || 'unset-salt'` fallback made every
		// private-anon id recomputable by anyone who knew the repo id.
		// Assert the function output cannot equal an HMAC keyed by
		// that literal for any input.
		const predictable = `private-${createHmac('sha256', 'unset-salt')
			.update('987654321')
			.digest('hex')
			.slice(0, 12)}`;
		assert.notEqual(anonId(987654321, SALT), predictable);
	});
});

describe('anonId', () => {
	it('is stable for the same repo id + salt', () => {
		assert.equal(anonId(42, SALT), anonId(42, SALT));
	});
	it('differs across salts and repo ids', () => {
		assert.notEqual(anonId(42, SALT), anonId(42, 'other-salt'));
		assert.notEqual(anonId(42, SALT), anonId(43, SALT));
	});
	it('never contains the repo id or salt', () => {
		const id = anonId(987654321, SALT);
		assert.equal(id.includes('987654321'), false);
		assert.equal(id.includes(SALT), false);
		assert.match(id, /^private-[0-9a-f]{12}$/);
	});
});

describe('repoFacts', () => {
	it('keeps public identity fields for public repos', () => {
		const facts = repoFacts(publicRepo, 'public', SALT);
		assert.equal(facts.id, 'rebuildup/my-web-2026');
		assert.equal(facts.htmlUrl, publicRepo.html_url);
	});
	it('reduces private repos to the anonymous allowlist', () => {
		const facts = repoFacts(privateRepo, 'private', SALT);
		assert.equal(facts.kind, 'private');
		assert.equal(facts.name, '非公開プロジェクト');
		assert.equal(facts.repoFullName, undefined);
		assert.equal(facts.htmlUrl, undefined);
		assert.equal(facts.id, anonId(privateRepo.id, SALT));
	});
});

describe('buildSnapshot — privacy contract (#932)', () => {
	const snapshot = buildSnapshot({
		events: [
			{
				id: 'e1',
				repo: { name: 'rebuildup/my-web-2026' },
				type: 'PushEvent',
				created_at: RECENT,
			},
		],
		publicRepos: [publicRepo],
		privateRepos: [privateRepo, privateRepoStale],
		// Issue #967 — inclusion now requires an OBSERVED owner signal:
		// the recent private repo has measured commits; the stale one
		// has none (its pushed_at alone no longer admits it).
		contributions: {
			'rebuildup/secret-side-project': { commits: 4, prs: 1 },
		},
		now: NOW,
		salt: SALT,
		headSha: 'abc123',
	});
	const serialized = JSON.stringify(snapshot);

	it('marks the private source ok and includes recent private repos anonymously', () => {
		assert.equal(snapshot.sources.private.status, 'ok');
		const privateEntries = snapshot.repos.filter((r) => r.kind === 'private');
		assert.equal(privateEntries.length, 1); // stale one excluded
		assert.equal(privateEntries[0].id, anonId(privateRepo.id, SALT));
	});

	it('no private identifier survives anywhere in the output', () => {
		for (const forbidden of [
			'secret-side-project',
			'secret_side',
			'987654321',
			'do not publish this',
			'private-side',
			SALT,
		]) {
			assert.equal(serialized.includes(forbidden), false, `leaked: ${forbidden}`);
		}
	});

	it('keeps public repo identity and event feed', () => {
		const pub = snapshot.repos.find((r) => r.id === 'rebuildup/my-web-2026');
		assert.ok(pub);
		assert.equal(pub.activity.events, 1);
		assert.equal(snapshot.feed[0].repoId, 'rebuildup/my-web-2026');
		assert.equal(snapshot.headSha, 'abc123');
	});

	it('carries no ref on event types without an Issue/PR payload (Issue #334)', () => {
		assert.equal(snapshot.feed[0].ref, undefined);
	});

	it('publishes measured contribution counts, not events, as commits (Issue #967)', () => {
		const priv = snapshot.repos.find((r) => r.kind === 'private');
		assert.equal(priv.activity.commits, 4);
		assert.equal(priv.activity.prs, 1);
		assert.equal(priv.activity.events, 0);
	});

	it('fails closed when private repos were fetched without a salt', () => {
		// Token present + salt absent must NOT degrade to public-only
		// or predictable-id output — the whole build refuses.
		assert.throws(
			() =>
				buildSnapshot({
					events: [],
					publicRepos: [publicRepo],
					privateRepos: [privateRepo],
					now: NOW,
					salt: '',
				}),
			/GITHUB_ACTIVITY_SALT/,
		);
	});

	it('still builds the public half when no token was used', () => {
		const snap = buildSnapshot({
			events: [],
			publicRepos: [publicRepo],
			privateRepos: null,
			now: NOW,
			salt: '',
		});
		assert.equal(snap.sources.private.status, 'unconfigured');
		assert.equal(snap.repos.filter((r) => r.kind === 'private').length, 0);
	});

	it('reports private source unconfigured when no token was used', () => {
		const noToken = buildSnapshot({
			events: [],
			publicRepos: [publicRepo],
			privateRepos: null,
			now: NOW,
			salt: SALT,
		});
		assert.equal(noToken.sources.private.status, 'unconfigured');
		assert.equal(noToken.repos.filter((r) => r.kind === 'private').length, 0);
	});
});

describe('buildSnapshot — feed item refs (Issue #334)', () => {
	const feedFor = (events) =>
		buildSnapshot({ events, publicRepos: [], privateRepos: null, now: NOW, salt: '' }).feed;

	it('derives an issue ref with state from IssuesEvent', () => {
		const [item] = feedFor([
			{
				id: 'e1',
				repo: { name: 'rebuildup/my-web-2026' },
				type: 'IssuesEvent',
				created_at: RECENT,
				payload: { issue: { number: 42, state: 'open' } },
			},
		]);
		assert.deepEqual(item.ref, { kind: 'issue', number: 42, state: 'open' });
	});

	it('derives a merged pull ref from PullRequestEvent', () => {
		const [item] = feedFor([
			{
				id: 'e2',
				repo: { name: 'rebuildup/my-web-2026' },
				type: 'PullRequestEvent',
				created_at: RECENT,
				payload: {
					pull_request: {
						number: 7,
						state: 'closed',
						merged: true,
						merged_at: RECENT,
					},
				},
			},
		]);
		assert.deepEqual(item.ref, { kind: 'pull', number: 7, state: 'merged' });
	});

	it('keeps an unmerged closed PR as closed, never merged', () => {
		const [item] = feedFor([
			{
				id: 'e3',
				repo: { name: 'rebuildup/my-web-2026' },
				type: 'PullRequestReviewEvent',
				created_at: RECENT,
				payload: { pull_request: { number: 8, state: 'closed', merged: false } },
			},
		]);
		assert.deepEqual(item.ref, { kind: 'pull', number: 8, state: 'closed' });
	});

	it('classifies an IssueCommentEvent on a PR as a pull ref', () => {
		const [item] = feedFor([
			{
				id: 'e4',
				repo: { name: 'rebuildup/my-web-2026' },
				type: 'IssueCommentEvent',
				created_at: RECENT,
				payload: {
					issue: { number: 9, state: 'open', pull_request: { url: 'x' } },
				},
			},
		]);
		assert.deepEqual(item.ref, { kind: 'pull', number: 9, state: 'open' });
	});

	it('emits no ref when the payload lacks the object or the number', () => {
		const feed = feedFor([
			{
				id: 'e5',
				repo: { name: 'rebuildup/my-web-2026' },
				type: 'IssuesEvent',
				created_at: RECENT,
				payload: {},
			},
			{
				id: 'e6',
				repo: { name: 'rebuildup/my-web-2026' },
				type: 'PullRequestEvent',
				created_at: RECENT,
				payload: { pull_request: { state: 'open' } },
			},
			{
				id: 'e7',
				repo: { name: 'rebuildup/my-web-2026' },
				type: 'PushEvent',
				created_at: RECENT,
				payload: { issue: { number: 1, state: 'open' } },
			},
		]);
		assert.equal(feed.length, 3);
		for (const item of feed) assert.equal(item.ref, undefined);
	});
});
