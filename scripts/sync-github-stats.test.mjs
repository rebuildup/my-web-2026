import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateRank } from '../src/vendor/github-readme-stats-fast/calculateRank.ts';
import { buildStatsSnapshot, calculateRankLegacy } from './sync-github-stats.mjs';

const NOW = new Date('2026-11-27T00:00:00.000Z');

const USER = {
	name: 'Rebuildup',
	login: 'rebuildup',
	contributionsCollection: {
		totalCommitContributions: 420,
		totalPullRequestReviewContributions: 35,
	},
	repositoriesContributedTo: { totalCount: 57 },
	pullRequests: { totalCount: 180 },
	issues: { totalCount: 90 },
	followers: { totalCount: 64 },
	ownedReposTotalCount: 48,
};

const langEdges = (entries) => ({
	edges: entries.map(([name, size]) => ({
		size,
		node: { name, color: '#aaa' },
	})),
});

const OWNED_REPOS = [
	{
		name: 'my-web-2026',
		isPrivate: false,
		isFork: false,
		stargazerCount: 12,
		languages: langEdges([
			['TypeScript', 900_000],
			['CSS', 100_000],
		]),
	},
	{
		name: 'secret-side-project',
		isPrivate: true,
		isFork: false,
		stargazerCount: 0,
		languages: langEdges([['Rust', 5_000_000]]),
	},
	{
		name: 'upstream-fork',
		isPrivate: false,
		isFork: true,
		stargazerCount: 3,
		languages: langEdges([['Go', 50_000]]),
	},
];

const CONTRIB_REPOS = [
	{
		name: 'org-tool',
		isPrivate: false,
		isFork: false,
		stargazerCount: 40,
		owner: { login: 'some-org', type: 'Organization' },
		languages: langEdges([['Python', 200_000]]),
	},
	{
		name: 'my-web-2026',
		isPrivate: false,
		isFork: false,
		stargazerCount: 12,
		owner: { login: 'rebuildup', type: 'User' },
		languages: langEdges([['TypeScript', 900_000]]),
	},
];

const EXTERNAL_REPOS = [
	{
		name: 'external-lib',
		isPrivate: false,
		isFork: false,
		stargazerCount: 200,
		owner: { login: 'other-user', type: 'User' },
		languages: langEdges([['Rust', 400_000]]),
	},
];

const SEARCH = { commits: 1500, prs: 180, issues: 95 };

const STREAK = {
	currentStreak: 5,
	longestStreak: 30,
	totalContributions: 9000,
	firstContribution: 'Mar 1, 2020',
	currentStreakStart: 'Nov 23, 2026',
	currentStreakEnd: 'Nov 27',
	longestStreakStart: 'Jan 1, 2025',
	longestStreakEnd: 'Jan 30, 2025',
};

function build(overrides = {}) {
	return buildStatsSnapshot({
		user: USER,
		ownedRepoNodes: OWNED_REPOS,
		contributedRepoNodes: CONTRIB_REPOS,
		externalRepoNodes: EXTERNAL_REPOS,
		ownedTruncated: false,
		contributedTruncated: false,
		streak: STREAK,
		searchCounts: SEARCH,
		avatarDataUri: 'data:image/png;base64,iVBORw0KGgo=',
		now: NOW,
		...overrides,
	});
}

describe('buildStatsSnapshot', () => {
	it('emits schemaVersion 1 with owner and observedAt', () => {
		const snap = build();
		assert.equal(snap.schemaVersion, 1);
		assert.equal(snap.owner, 'rebuildup');
		assert.equal(snap.observedAt, NOW.toISOString());
		assert.equal(snap.generatedOn, '2026-11-27');
	});

	it('splits owned vs participated languages over PUBLIC non-fork repos only', () => {
		const snap = build();
		// owned: my-web-2026 only — private repo and fork excluded.
		const owned = snap.languages.owned;
		assert.equal(owned.length, 2);
		assert.equal(owned[0].name, 'TypeScript');
		assert.equal(owned[0].size, 900_000);
		// participated: org-tool + external-lib (my-web-2026 is owned,
		// excluded from participated).
		const participated = snap.languages.participated;
		const names = participated.map((l) => l.name).sort();
		assert.deepEqual(names, ['Python', 'Rust']);
	});

	it('splits stars owned vs participated and counts repos', () => {
		const snap = build();
		// owned: 12 + 0(private) + 3(fork) — stars include forks like the
		// vendored stats fetcher (no isFork filter upstream).
		assert.equal(snap.stars.owned, 15);
		// participated: org-tool 40 + external-lib 200 (owned repo in
		// contributedTo excluded).
		assert.equal(snap.stars.participated, 240);
		// repos.participated = non-owned contributed (1) + external (1).
		assert.equal(snap.repos.participated, 2);
		assert.equal(snap.repos.owned, 48);
		assert.equal(snap.repos.contributedTo, 57);
		assert.equal(snap.repos.complete, true);
	});

	it('keeps y1 and allTime metrics distinct', () => {
		const snap = build();
		assert.equal(snap.metrics.contributionsY1, 420);
		assert.equal(snap.metrics.reviewsY1, 35);
		assert.equal(snap.metrics.commitsAuthoredAllTime, 1500);
		assert.equal(snap.metrics.prsAuthoredAllTime, 180);
		assert.equal(snap.metrics.issuesAuthoredAllTime, 95);
	});

	it('computes rank on declared inputs with BOTH formulas', () => {
		const snap = build();
		assert.ok(snap.rank);
		assert.equal(snap.rank.inputs.all_commits, true);
		assert.equal(snap.rank.inputs.commits, 1500);
		assert.equal(snap.rank.current.level, calculateRank(snap.rank.inputs).level);
		assert.equal(snap.rank.legacy.level, calculateRankLegacy(snap.rank.inputs).level);
		// Both formulas must produce a level + percentile in range.
		for (const r of [snap.rank.current, snap.rank.legacy]) {
			assert.match(r.level, /^[SABC][+-]?$/);
			assert.ok(r.percentile >= 0 && r.percentile <= 100);
		}
	});

	it('marks rank absent when any input is unmeasured — never a lying zero', () => {
		const snap = build({ searchCounts: null });
		assert.equal(snap.metrics.commitsAuthoredAllTime, null);
		assert.equal(snap.rank, null);
		assert.equal(snap.sources.search.status, 'failed');
	});

	it('marks graphql-sourced metrics null when the upstream failed', () => {
		const snap = build({ user: null, ownedRepoNodes: [], contributedRepoNodes: [] });
		assert.equal(snap.metrics.contributionsY1, null);
		assert.equal(snap.metrics.contributedTo, null);
		assert.equal(snap.repos, null);
		assert.equal(snap.sources.graphql.status, 'failed');
		// Search-sourced metrics survive independently.
		assert.equal(snap.metrics.commitsAuthoredAllTime, 1500);
		assert.equal(snap.sources.search.status, 'ok');
	});

	it('tracks streak failure independently of the stats query', () => {
		const snap = build({ streak: null, streakFailed: true });
		assert.equal(snap.streak, null);
		assert.equal(snap.sources.streak.status, 'failed');
		assert.equal(snap.sources.graphql.status, 'ok');
		// An empty contribution history is 'ok' with null streak, not failed.
		const empty = build({ streak: null, streakFailed: false });
		assert.equal(empty.sources.streak.status, 'ok');
	});

	it('flags incomplete directory pagination honestly', () => {
		const snap = build({ ownedTruncated: true });
		assert.equal(snap.repos.complete, false);
	});

	it('carries the streak block and avatar data URI through', () => {
		const snap = build();
		assert.equal(snap.streak.totalContributions, 9000);
		assert.ok(snap.avatarDataUri.startsWith('data:image/png;base64,'));
	});

	it('never emits private repo identities — aggregates only', () => {
		const snap = build();
		const json = JSON.stringify(snap);
		assert.ok(!json.includes('secret-side-project'));
		assert.ok(!json.includes('org-tool'));
		assert.ok(!json.includes('external-lib'));
	});
});
