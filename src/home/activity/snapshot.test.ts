import { describe, expect, it } from 'vitest';
import type { GitHubActivitySnapshot } from './contract';
import {
	activityProjectRecords,
	publicGitHubActivity,
	readGitHubActivitySnapshot,
} from './snapshot';

const base: GitHubActivitySnapshot = {
	schemaVersion: 1,
	generatedOn: '2026-11-16',
	windowDays: 30,
	sources: {
		public: { status: 'ok', observedAt: '2026-11-16T00:00:00Z' },
		private: { status: 'unconfigured' },
	},
	repos: [
		{
			id: 'rebuildup/public-a',
			kind: 'public',
			name: 'public-a',
			repoFullName: 'rebuildup/public-a',
			htmlUrl: 'https://github.com/rebuildup/public-a',
			lastActiveAt: '2026-11-15T10:00:00Z',
			activity: { events: 3, commits: 2, windowDays: 30 },
		},
		{
			id: 'private-0123456789ab',
			kind: 'private',
			name: '非公開プロジェクト',
			activity: { events: 1, windowDays: 30 },
		},
	],
	feed: [
		{
			id: '1',
			kind: 'public',
			repoId: 'rebuildup/public-a',
			type: 'PushEvent',
			at: '2026-11-15T10:00:00Z',
		},
		{
			id: '2',
			kind: 'private',
			repoId: 'private-0123456789ab',
			type: 'PushEvent',
			at: '2026-11-15T11:00:00Z',
		},
	],
};

describe('readGitHubActivitySnapshot', () => {
	it('accepts a valid snapshot', () => {
		expect(readGitHubActivitySnapshot(base)).toEqual(base);
	});
	it('rejects non-objects and wrong schema', () => {
		expect(readGitHubActivitySnapshot(null)).toBeNull();
		expect(readGitHubActivitySnapshot({ ...base, schemaVersion: 2 })).toBeNull();
	});
	it('rejects a private entry carrying a real repo identity (fail-closed)', () => {
		const leaky = {
			...base,
			repos: [{ ...base.repos[1], repoFullName: 'rebuildup/secret-name' }],
		};
		expect(readGitHubActivitySnapshot(leaky)).toBeNull();
	});
	it('rejects a private entry with a non-anonymous id', () => {
		const bad = {
			...base,
			repos: [{ ...base.repos[1], id: 'rebuildup/secret' }],
		};
		expect(readGitHubActivitySnapshot(bad)).toBeNull();
	});
	it('rejects duplicate repo ids', () => {
		const dup = { ...base, repos: [base.repos[0], base.repos[0]] };
		expect(readGitHubActivitySnapshot(dup)).toBeNull();
	});
	it('accepts a feed item carrying a well-formed ref (Issue #334)', () => {
		const snap: GitHubActivitySnapshot = {
			...base,
			feed: [
				{
					id: '3',
					kind: 'public' as const,
					repoId: 'rebuildup/public-a',
					type: 'PullRequestEvent',
					at: '2026-11-15T10:00:00Z',
					ref: { kind: 'pull' as const, number: 12, state: 'merged' as const },
				},
			],
		};
		expect(readGitHubActivitySnapshot(snap)).toEqual(snap);
	});
	it('rejects a feed item with a malformed ref — fail closed', () => {
		for (const ref of [
			{ kind: 'release', number: 1 },
			{ kind: 'issue', number: 0 },
			{ kind: 'issue', number: 1.5 },
			{ kind: 'pull', number: 3, state: 'draft' },
			'not-an-object',
		]) {
			const snap = {
				...base,
				feed: [{ ...base.feed[0], ref }],
			};
			expect(readGitHubActivitySnapshot(snap)).toBeNull();
		}
	});
});

describe('activityProjectRecords', () => {
	it('projects public repos with links and github-stamped facts', () => {
		const records = activityProjectRecords(base);
		const pub = records.find((r) => r.id === 'gh-rebuildup/public-a');
		expect(pub?.link?.href).toBe('https://github.com/rebuildup/public-a');
		expect(pub?.weight?.activity?.source).toBe('github');
	});
	it('projects private repos as ONE anonymous aggregate record (Issue #1297)', () => {
		const records = activityProjectRecords(base);
		const priv = records.find((r) => r.id === 'gh-private');
		expect(priv).toBeDefined();
		expect(priv?.link).toBeUndefined();
		expect(JSON.stringify(priv)).not.toContain('secret');
		expect(priv?.name).not.toContain('/');
		// The status line carries the observed COUNT — a publishable
		// aggregate, the same number `repoCount.private` reports.
		expect(priv?.statusJa).toContain('1 件');
	});

	it('aggregates private window contributions instead of listing identical rows', () => {
		const snapshot: GitHubActivitySnapshot = {
			...base,
			repos: [
				...base.repos.slice(0, 1),
				{
					id: 'private-0123456789ab',
					kind: 'private',
					name: '非公開プロジェクト',
					lastActiveAt: '2026-11-14T00:00:00Z',
					activity: { events: 1, commits: 10, prs: 2, windowDays: 30 },
				},
				{
					id: 'private-fedcba987654',
					kind: 'private',
					name: '非公開プロジェクト',
					lastActiveAt: '2026-11-15T00:00:00Z',
					activity: { events: 1, commits: 5, windowDays: 30 },
				},
			],
		};
		const records = activityProjectRecords(snapshot);
		const privateRecords = records.filter((r) => r.id === 'gh-private');
		expect(privateRecords).toHaveLength(1);
		const [aggregate] = privateRecords;
		expect(aggregate?.statusJa).toContain('2 件');
		expect(aggregate?.updatedOn?.value).toBe('2026-11-15');
		expect(aggregate?.weight?.activity?.value).toEqual({
			commits: 15,
			windowDays: 30,
			pullRequests: 2,
		});
		// The aggregate never claims a weight level.
		expect(aggregate?.weight?.level).toBeUndefined();
	});
	it('reports measured commits/PRs, never the feed events count (Issue #967)', () => {
		const records = activityProjectRecords(base);
		const pub = records.find((r) => r.id === 'gh-rebuildup/public-a');
		expect(pub?.weight?.activity?.value).toEqual({
			commits: 2,
			windowDays: 30,
		});
	});
	it('publishes no activity claim when the contribution search did not run', () => {
		const records = activityProjectRecords(base);
		const priv = records.find((r) => r.id === 'gh-private');
		expect(priv?.weight?.activity).toBeUndefined();
	});
	it('maps lastActiveAt to a github-stamped updatedOn', () => {
		const records = activityProjectRecords(base);
		const pub = records.find((r) => r.id === 'gh-rebuildup/public-a');
		expect(pub?.updatedOn).toEqual({
			value: '2026-11-15',
			source: 'github',
			observedOn: '2026-11-16',
			evidence: 'github-activity @ 2026-11-16',
		});
	});
	it('ranks by measured contribution and caps the published set', () => {
		const many = Array.from({ length: 20 }, (_, i) => ({
			id: `rebuildup/r${String(i).padStart(2, '0')}`,
			kind: 'public' as const,
			name: `r${i}`,
			repoFullName: `rebuildup/r${i}`,
			activity: {
				events: 0,
				commits: i * 2,
				...(i % 2 === 0 ? { prs: 1 } : {}),
				windowDays: 30,
			},
		}));
		const snapshot: GitHubActivitySnapshot = { ...base, repos: many };
		const records = activityProjectRecords(snapshot);
		expect(records).toHaveLength(12);
		expect(records[0]?.id).toBe('gh-rebuildup/r19');
		expect(records[0]?.weight?.activity?.value.commits).toBe(38);
		expect(records[0]?.weight?.activity?.value.pullRequests).toBeUndefined();
		expect(records[1]?.id).toBe('gh-rebuildup/r18');
		expect(records[1]?.weight?.activity?.value.pullRequests).toBe(1);
	});
});

describe('publicGitHubActivity', () => {
	it('drops private feed items and counts only anonymous ids', () => {
		const pub = publicGitHubActivity(base);
		expect(pub.feed).toHaveLength(1);
		expect(pub.repoCount).toEqual({ public: 1, private: 1 });
		expect(JSON.stringify(pub)).not.toContain('secret');
	});

	it('links a public feed item to the repo htmlUrl the snapshot carries (#319)', () => {
		const pub = publicGitHubActivity(base);
		expect(pub.feed[0]?.href).toBe('https://github.com/rebuildup/public-a');
	});

	it('links a feed item with ref to the specific Issue/PR permalink (#334)', () => {
		const snapshot: GitHubActivitySnapshot = {
			...base,
			feed: [
				{
					id: '10',
					kind: 'public',
					repoId: 'rebuildup/public-a',
					type: 'PullRequestEvent',
					at: '2026-11-15T10:00:00Z',
					ref: { kind: 'pull', number: 55, state: 'merged' },
				},
				{
					id: '11',
					kind: 'public',
					repoId: 'someone-else/other-repo',
					type: 'IssuesEvent',
					at: '2026-11-15T11:00:00Z',
					ref: { kind: 'issue', number: 7, state: 'open' },
				},
			],
		};
		const pub = publicGitHubActivity(snapshot);
		expect(pub.feed[0]?.href).toBe('https://github.com/rebuildup/public-a/pull/55');
		// A ref on a repo the owner does not own still resolves: the
		// permalink is built from the public events `repoId`, not from
		// the owner's repo list.
		expect(pub.feed[1]?.href).toBe('https://github.com/someone-else/other-repo/issues/7');
	});

	it('never derives a permalink for a private-kind feed item (#334)', () => {
		const snapshot: GitHubActivitySnapshot = {
			...base,
			feed: [
				{
					id: '20',
					kind: 'private',
					repoId: 'private-0123456789ab',
					type: 'PullRequestEvent',
					at: '2026-11-15T10:00:00Z',
					ref: { kind: 'pull', number: 3 },
				},
			],
		};
		const pub = publicGitHubActivity(snapshot);
		expect(pub.feed).toHaveLength(0);
	});

	it('derives no permalink when ref exists but repoId is not owner/name', () => {
		const snapshot: GitHubActivitySnapshot = {
			...base,
			feed: [
				{
					id: '30',
					kind: 'public',
					repoId: 'not a repo id',
					type: 'IssuesEvent',
					at: '2026-11-15T10:00:00Z',
					ref: { kind: 'issue', number: 4 },
				},
			],
		};
		const pub = publicGitHubActivity(snapshot);
		expect(pub.feed[0]?.href).toBeUndefined();
	});

	it('leaves href absent when the feed repo has no publishable URL', () => {
		const snapshot: GitHubActivitySnapshot = {
			...base,
			repos: [
				{
					id: 'rebuildup/no-url',
					kind: 'public',
					name: 'no-url',
					activity: { events: 1, commits: 1, windowDays: 30 },
				},
			],
			feed: [
				{
					id: '9',
					kind: 'public',
					repoId: 'rebuildup/no-url',
					type: 'PushEvent',
					at: '2026-11-15T10:00:00Z',
				},
			],
		};
		const pub = publicGitHubActivity(snapshot);
		expect(pub.feed[0]?.href).toBeUndefined();
	});

	it('projects measured commits/PRs ranked by contribution, capped (#967)', () => {
		const repos = Array.from({ length: 8 }, (_, i) => ({
			id: `rebuildup/r${i}`,
			kind: 'public' as const,
			name: `r${i}`,
			repoFullName: `rebuildup/r${i}`,
			htmlUrl: `https://github.com/rebuildup/r${i}`,
			activity: {
				events: 0,
				commits: i,
				...(i % 2 === 0 ? { prs: 2 } : {}),
				windowDays: 30,
			},
		}));
		const snapshot: GitHubActivitySnapshot = { ...base, repos, feed: [] };
		const pub = publicGitHubActivity(snapshot);
		expect(pub.topRepos).toHaveLength(5);
		// r7 (7 commits) vs r6 (6 commits + 2 PRs = 8): score wins.
		expect(pub.topRepos[0]?.id).toBe('rebuildup/r6');
		expect(pub.topRepos[0]?.commits).toBe(6);
		expect(pub.topRepos[0]?.pullRequests).toBe(2);
		expect(pub.topRepos[0]?.href).toBe('https://github.com/rebuildup/r6');
	});

	it('omits repos whose contribution was not measured — absence, not zero', () => {
		const snapshot: GitHubActivitySnapshot = {
			...base,
			repos: [
				{
					id: 'rebuildup/unmeasured',
					kind: 'public',
					name: 'unmeasured',
					activity: { events: 2, windowDays: 30 },
				},
				{
					id: 'private-0123456789ab',
					kind: 'private',
					name: '非公開プロジェクト',
					activity: { events: 1, windowDays: 30 },
				},
			],
			feed: [],
		};
		const pub = publicGitHubActivity(snapshot);
		expect(pub.topRepos).toHaveLength(0);
	});
});
