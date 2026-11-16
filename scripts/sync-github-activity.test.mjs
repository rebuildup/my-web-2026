import assert from 'node:assert/strict';
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

const privateRepoStale = { ...privateRepo, id: 111, pushed_at: OLD };

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
