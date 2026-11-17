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
});

describe('activityProjectRecords', () => {
	it('projects public repos with links and github-stamped facts', () => {
		const records = activityProjectRecords(base);
		const pub = records.find((r) => r.id === 'gh-rebuildup/public-a');
		expect(pub?.link?.href).toBe('https://github.com/rebuildup/public-a');
		expect(pub?.weight?.activity?.source).toBe('github');
	});
	it('projects private repos anonymously without any URL or real id', () => {
		const records = activityProjectRecords(base);
		const priv = records.find((r) => r.id === 'gh-private-0123456789ab');
		expect(priv).toBeDefined();
		expect(priv?.link).toBeUndefined();
		expect(JSON.stringify(priv)).not.toContain('secret');
		expect(priv?.name).not.toContain('/');
	});
});

describe('publicGitHubActivity', () => {
	it('drops private feed items and counts only anonymous ids', () => {
		const pub = publicGitHubActivity(base);
		expect(pub.feed).toHaveLength(1);
		expect(pub.repoCount).toEqual({ public: 1, private: 1 });
		expect(JSON.stringify(pub)).not.toContain('secret');
	});
});
