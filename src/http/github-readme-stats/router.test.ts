/**
 * Tests for GitHub Readme Stats router (Issue #1164: personal-fixed
 * cards + persistent stale-while-revalidate SVG store).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { microCacheStore } from '../../vendor/github-readme-stats-fast/common/microCache.ts';
import { svgCache } from '../../vendor/github-readme-stats-fast/common/svgCache.ts';
import { githubReadmeStatsRouter } from './router.js';
import { svgStoreClear, svgStorePut } from './svg-store.js';

const mockEnv = {
	GITHUB_TOKEN: 'ghp_test_token_12345',
	GITHUB_README_STATS_PAT_1: 'ghp_pat_token_1',
	GITHUB_README_STATS_PAT_2: 'ghp_pat_token_2',
	// Issue #996: the routes now sit behind rateLimitRead; the unit env
	// supplies an always-allow limiter so handler behaviour stays under test.
	RATE_LIMIT_READ: { limit: async () => ({ success: true }) },
};

const mockFetch = vi.fn();
global.fetch = mockFetch;

function createMockRequest(path: string, query: Record<string, string> = {}) {
	const url = new URL(`https://rebuildup.dev${path}`);
	for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
	return new Request(url.toString(), { method: 'GET', headers: { 'User-Agent': 'test' } });
}

function createMockEnv(overrides: Record<string, unknown> = {}) {
	return { ...mockEnv, ...overrides } as unknown as Env;
}

/**
 * Issue #1262: the stats card reads `github_stats_snapshot` from D1
 * instead of calling GitHub at request time. The fake answers the
 * single-row `SELECT payload ... WHERE id = 1` read.
 */
const STATS_SNAPSHOT = {
	schemaVersion: 1,
	generatedOn: '2026-11-27',
	observedAt: '2026-11-27T00:00:00Z',
	owner: 'rebuildup',
	sources: {
		graphql: { status: 'ok', observedAt: '2026-11-27T00:00:00Z' },
		streak: { status: 'ok' },
		search: { status: 'ok' },
		avatar: { status: 'ok' },
	},
	streak: null,
	metrics: {
		contributionsY1: 800,
		reviewsY1: 5,
		commitsAuthoredAllTime: 25221,
		prsAuthoredAllTime: 900,
		issuesAuthoredAllTime: 400,
		prsOpenedAllTime: 5852,
		issuesOpenedAllTime: 5019,
		contributedTo: 28,
		followers: 20,
	},
	repos: { owned: 129, contributedTo: 28, participated: 28, complete: true },
	stars: { owned: 174, participated: 53144 },
	languages: null,
	rank: {
		inputs: {
			all_commits: true,
			commits: 25221,
			prs: 900,
			issues: 400,
			reviews: 5,
			repos: 129,
			stars: 174,
			followers: 20,
		},
		current: { level: 'B+', percentile: 40.1 },
		legacy: { level: 'A+', percentile: 10.2 },
	},
	avatarDataUri: null,
};

function fakeStatsDb(payload: unknown): D1Database {
	return {
		prepare: () => ({
			first: async () => ({ payload: JSON.stringify(payload) }),
		}),
	} as unknown as D1Database;
}

function createMockEnvWithStats(overrides: Record<string, unknown> = {}) {
	return createMockEnv({ DB: fakeStatsDb(STATS_SNAPSHOT), ...overrides });
}

const STREAK_BLOCK = {
	currentStreak: 207,
	longestStreak: 365,
	totalContributions: 36658,
	firstContribution: '2019-01-01',
	currentStreakStart: '2026-05-05',
	currentStreakEnd: '2026-11-27',
	longestStreakStart: '2025-01-01',
	longestStreakEnd: '2026-01-01',
};

function snapshotWith(overrides: Record<string, unknown>) {
	return { ...STATS_SNAPSHOT, ...overrides };
}

function langsSnapshot(langs: Array<{ name: string; size: number }>) {
	return snapshotWith({
		languages: {
			owned: langs.map((l, i) => ({
				name: l.name,
				color: '#3178c6',
				size: l.size,
				count: langs.length - i,
			})),
			participated: [],
		},
	});
}

function createGraphQLMock(data: unknown, errors?: unknown[]) {
	return { ok: true, json: async () => ({ data, errors }) };
}

function mockRepoGraphQL() {
	mockFetch.mockResolvedValue(
		createGraphQLMock({
			user: {
				repository: {
					name: 'my-web-2026',
					nameWithOwner: 'rebuildup/my-web-2026',
					isPrivate: false,
					isArchived: false,
					isTemplate: false,
					stargazerCount: 42,
					description: 'A test repository',
					primaryLanguage: { color: '#3178c6', id: '1', name: 'TypeScript' },
					forkCount: 5,
				},
			},
			organization: null,
		}),
	);
}

describe('GitHub Readme Stats Router (personal-fixed, Issue #1164)', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		mockFetch.mockReset();
		// All three cache layers are module-scoped: the persistent SVG
		// store (Cache API), the 5-minute in-memory svgCache and the
		// 5-second microCache. The login is fixed now, so a reused key
		// would otherwise leak one test's render into the next.
		await svgStoreClear();
		svgCache.clear();
		microCacheStore.clear();
	});

	describe('Stats card: /api', () => {
		it('renders the snapshot-driven stats SVG without any upstream call (Issue #1262)', async () => {
			// `username` and every visual param are ignored — the card is
			// always rendered for OWNER_LOGIN with default styling.
			const req = createMockRequest('/api', {
				username: 'someone-else',
				theme: 'radical',
				locale: 'ja',
			});
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnvWithStats());
			expect(res.status).toBe(200);
			expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
			const body = await res.text();
			expect(body).toContain('<svg');
			expect(body).toContain('rebuildup');
			expect(body).toContain('Total Stars');
			// Snapshot figures, not the retired upstream fetch: all-time
			// authored commits (25,221) and owned-scope stars (174).
			expect(body).toContain('25.2k');
			expect(body).toContain('174');
			// No GitHub API call may happen on this route anymore.
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('hides stats the snapshot did not measure instead of zeroing them', async () => {
			const partial = {
				...STATS_SNAPSHOT,
				metrics: { ...STATS_SNAPSHOT.metrics, prsOpenedAllTime: null },
			};
			const res = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api'),
				createMockEnv({ DB: fakeStatsDb(partial) }),
			);
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).not.toContain('Total PRs');
			expect(body).toContain('Total Stars');
		});

		it('opts into shared caching with a public positive lifetime', async () => {
			const res = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api'),
				createMockEnvWithStats(),
			);
			const cacheControl = res.headers.get('Cache-Control') ?? '';
			expect(cacheControl).toContain('public');
			expect(cacheControl).toContain('max-age=86400');
			expect(cacheControl).toContain('s-maxage=86400');
			expect(cacheControl).toContain('stale-while-revalidate=');
		});
	});

	describe('Top languages card: /api/top-langs/', () => {
		it('returns the compact card for rebuildup regardless of params (Issue #1268)', async () => {
			const env = createMockEnv({
				DB: fakeStatsDb(
					langsSnapshot([
						{ name: 'TypeScript', size: 1000 },
						{ name: 'JavaScript', size: 500 },
					]),
				),
			});
			const req = createMockRequest('/api/top-langs/', {
				username: 'other',
				layout: 'donut-vertical',
			});
			const res = await githubReadmeStatsRouter.fetch(req, env);
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).toContain('<svg');
			expect(body).toContain('TypeScript');
			// No upstream call may happen on this route anymore.
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('bounds the compact card to the upstream default language count', async () => {
			const langs = Array.from({ length: 12 }, (_, i) => ({
				name: `Lang${i}`,
				size: 1000 - i * 10,
			}));
			const res = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api/top-langs/'),
				createMockEnv({ DB: fakeStatsDb(langsSnapshot(langs)) }),
			);
			expect(res.status).toBe(200);
			const body = await res.text();
			// Upstream default for compact is 6 languages:
			// height = 90 + round(6 / 2) * 25 = 165, width = 300.
			expect(body).toContain('viewBox="0 0 300 165"');
			expect(body).toContain('Lang0');
			expect(body).toContain('Lang5');
			expect(body).not.toContain('Lang6');
		});

		it('serves the honest pre-sync card when the snapshot is absent or languages unmeasured (Issue #1284)', async () => {
			for (const payload of [
				STATS_SNAPSHOT, // languages: null
				snapshotWith({ languages: { owned: [], participated: [] } }),
			]) {
				const res = await githubReadmeStatsRouter.fetch(
					createMockRequest('/api/top-langs/'),
					createMockEnv({ DB: fakeStatsDb(payload) }),
				);
				expect(res.status).toBe(200);
				expect(res.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=60');
				expect(await res.text()).toContain('not yet observed');
			}
			// And with no D1 at all.
			const res = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api/top-langs/'),
				createMockEnv(),
			);
			expect(res.status).toBe(200);
			expect(await res.text()).toContain('not yet observed');
		});
	});

	describe('Streak card: /api/streak', () => {
		it('returns the snapshot streak SVG without any upstream call (Issue #1268)', async () => {
			const res = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api/streak'),
				createMockEnv({ DB: fakeStatsDb(snapshotWith({ streak: STREAK_BLOCK })) }),
			);
			expect(res.status).toBe(200);
			expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
			const body = await res.text();
			expect(body).toContain('<svg');
			expect(body).toContain('Current Streak');
			expect(body).toContain('207');
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('serves the honest pre-sync card when the snapshot is absent (Issue #1284)', async () => {
			for (const env of [
				createMockEnv(), // no D1
				createMockEnvWithStats(), // streak: null in snapshot
			]) {
				const res = await githubReadmeStatsRouter.fetch(createMockRequest('/api/streak'), env);
				expect(res.status).toBe(200);
				expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
				expect(res.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=60');
				expect(await res.text()).toContain('not yet observed');
			}
		});
	});

	describe('Pin card: /api/pin/', () => {
		it('returns error SVG when repo is missing', async () => {
			const res = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api/pin/'),
				createMockEnv(),
			);
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).toContain('repo');
		});

		it('rejects a repo name outside the GitHub name grammar', async () => {
			const res = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api/pin/', { repo: '../etc/passwd' }),
				createMockEnv(),
			);
			const body = await res.text();
			expect(body).toContain('repo');
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('returns SVG for a valid repo with owner shown', async () => {
			mockRepoGraphQL();
			const res = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api/pin/', { repo: 'my-web-2026' }),
				createMockEnv(),
			);
			expect(res.status).toBe(200);
			expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
			const body = await res.text();
			expect(body).toContain('<svg');
			expect(body).toContain('my-web-2026');
			expect(body).toContain('rebuildup');
			expect(body).toContain('TypeScript');
		});
	});

	describe('Degraded-state contract', () => {
		const envWithoutTokens = () =>
			createMockEnv({
				GITHUB_TOKEN: undefined,
				GITHUB_README_STATS_PAT_1: undefined,
				GITHUB_README_STATS_PAT_2: undefined,
			});

		it.each([['/api/pin/', { repo: 'my-web-2026' }]])(
			'returns 503 (not an error card) when the data source is unavailable: %s',
			async (path, query) => {
				const res = await githubReadmeStatsRouter.fetch(
					createMockRequest(path, query),
					envWithoutTokens(),
				);
				expect(res.status).toBe(503);
				expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
				expect(res.headers.get('Cache-Control')).toBe('max-age=60, s-maxage=60');
				const body = await res.text();
				expect(body).toContain('Service unavailable');
				expect(body).not.toContain('PAT_1');
				expect(body).not.toContain('ghp_');
			},
		);

		it('serves snapshot cards even when the network is down (Issue #1268)', async () => {
			// top-langs and streak read D1 only — a total upstream outage
			// must not degrade them.
			mockFetch.mockRejectedValue(new Error('network down'));
			const env = createMockEnv({
				DB: fakeStatsDb(
					snapshotWith({
						streak: STREAK_BLOCK,
						languages: {
							owned: [{ name: 'TypeScript', color: '#3178c6', size: 1000, count: 1 }],
							participated: [],
						},
					}),
				),
			});
			for (const path of ['/api/top-langs/', '/api/streak']) {
				const res = await githubReadmeStatsRouter.fetch(createMockRequest(path), env);
				expect(res.status).toBe(200);
				expect(await res.text()).toContain('<svg');
			}
		});

		it('keeps 200 error SVG for per-repo failures (repo not found)', async () => {
			mockFetch.mockResolvedValue(createGraphQLMock({ user: null, organization: null }));
			const res = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api/pin/', { repo: 'no-such-repo-xyz' }),
				createMockEnv(),
			);
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).toContain('Something went wrong');
		});
	});

	describe('Security: Error sanitization', () => {
		it('does not expose tokens in error responses', async () => {
			mockFetch.mockRejectedValue(new Error('Network error'));
			const res = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api/pin/', { repo: 'my-web-2026' }),
				createMockEnv(),
			);
			const body = await res.text();
			expect(body).not.toContain('ghp_test_token_12345');
			expect(body).not.toContain('ghp_pat_token_1');
			expect(body).not.toContain('ghp_pat_token_2');
			expect(body).not.toContain('token');
			expect(body).not.toContain('Authorization');
			expect(body).not.toContain('api.github.com');
		});

		it('does not expose internal URLs in error responses', async () => {
			mockFetch.mockRejectedValue(new Error('Internal error'));
			const res = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api/pin/', { repo: 'my-web-2026' }),
				createMockEnv(),
			);
			const body = await res.text();
			expect(body).not.toContain('localhost');
			expect(body).not.toContain('127.0.0.1');
			expect(body).not.toContain('internal');
			expect(body).not.toContain('worker');
		});

		it('does not expose stack traces in error responses', async () => {
			mockFetch.mockRejectedValue(new Error('Test error with stack'));
			const res = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api/pin/', { repo: 'my-web-2026' }),
				createMockEnv(),
			);
			const body = await res.text();
			// Check for actual stack trace patterns, not incidental "at" in animation names
			expect(body).not.toMatch(/at\s+\w+\s*\(/); // "at functionName ("
			expect(body).not.toContain('.js:');
			expect(body).not.toContain('stack');
		});

		it('collapses a non-authored error message to the fixed fallback (Issue #996)', async () => {
			mockFetch.mockRejectedValue(new Error('ECONNRESET internal-worker-detail'));
			const res = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api/pin/', { repo: 'my-web-2026' }),
				createMockEnv(),
			);
			const body = await res.text();
			expect(body).not.toContain('ECONNRESET');
			expect(body).not.toContain('internal-worker-detail');
			expect(body).toContain('Something went wrong');
		});
	});

	describe('Persistent SVG store (stale-while-revalidate, Issue #1164)', () => {
		it('serves the stored card without touching upstream on a fresh hit', async () => {
			const first = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api'),
				createMockEnvWithStats(),
			);
			expect(first.status).toBe(200);
			const firstBody = await first.text();

			// Second request: store hit → the snapshot is not even read
			// again, and no upstream call exists on this route.
			const second = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api'),
				createMockEnvWithStats(),
			);
			expect(second.status).toBe(200);
			expect(await second.text()).toBe(firstBody);
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('serves the stale card immediately even when upstream fails', async () => {
			// A card rendered two days ago — past every fresh TTL.
			const staleSvg = '<svg xmlns="http://www.w3.org/2000/svg"><text>STALE-CARD</text></svg>';
			await svgStorePut('card:stats', staleSvg, Date.now() - 2 * 24 * 60 * 60 * 1000);

			// Upstream is down: every fetch rejects.
			mockFetch.mockRejectedValue(new Error('upstream down'));

			const res = await githubReadmeStatsRouter.fetch(createMockRequest('/api'), createMockEnv());
			expect(res.status).toBe(200);
			expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
			// The stale card is returned verbatim — never the 503 card.
			expect(await res.text()).toBe(staleSvg);
			const cacheControl = res.headers.get('Cache-Control') ?? '';
			expect(cacheControl).toContain('public');
		});

		it('refreshes a stale entry in the background and keeps the stale body', async () => {
			const staleSvg = '<svg><text>OLD</text></svg>';
			await svgStorePut('card:stats', staleSvg, Date.now() - 2 * 24 * 60 * 60 * 1000);

			const res = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api'),
				createMockEnvWithStats(),
			);
			expect(res.status).toBe(200);
			// Response is the stale bytes; the refresh ran inline because
			// the unit env has no ExecutionContext.
			expect(await res.text()).toBe(staleSvg);

			// The store now holds the refreshed card: a follow-up request
			// returns the new render, not the stale marker.
			const next = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api'),
				createMockEnvWithStats(),
			);
			const nextBody = await next.text();
			expect(nextBody).not.toBe(staleSvg);
			expect(nextBody).toContain('rebuildup');
		});

		it('serves the pre-sync card — never stored — when nothing was ever stored and the snapshot is absent (Issue #1284)', async () => {
			const res = await githubReadmeStatsRouter.fetch(createMockRequest('/api'), createMockEnv());
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).toContain('not yet observed');
			// The unobserved card is not persisted: once the snapshot
			// lands, the very next request renders the real card.
			const next = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api'),
				createMockEnvWithStats(),
			);
			expect(next.status).toBe(200);
			expect(await next.text()).toContain('Total Stars');
		});
	});
});
