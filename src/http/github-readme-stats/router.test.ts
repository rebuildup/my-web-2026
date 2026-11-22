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

function createMockEnv(overrides: Record<string, string | undefined> = {}) {
	return { ...mockEnv, ...overrides } as unknown as Env;
}

function createGraphQLMock(data: unknown, errors?: unknown[]) {
	return { ok: true, json: async () => ({ data, errors }) };
}

const STATS_USER = {
	name: 'Rebuildup',
	login: 'rebuildup',
	contributionsCollection: {
		totalCommitContributions: 100,
		totalPullRequestReviewContributions: 50,
	},
	repositoriesContributedTo: { totalCount: 10 },
	pullRequests: { totalCount: 20 },
	mergedPullRequests: { totalCount: 15 },
	openIssues: { totalCount: 5 },
	closedIssues: { totalCount: 3 },
	followers: { totalCount: 100 },
	repositoryDiscussions: { totalCount: 2 },
	repositoryDiscussionComments: { totalCount: 1 },
	repositories: {
		totalCount: 25,
		nodes: [
			{ name: 'repo1', stargazerCount: 10 },
			{ name: 'repo2', stargazerCount: 5 },
		],
		pageInfo: { hasNextPage: false, endCursor: null },
	},
};

function mockStatsGraphQL() {
	mockFetch.mockResolvedValue(createGraphQLMock({ user: STATS_USER }));
}

function mockTopLangsGraphQL(edges?: unknown[]) {
	mockFetch.mockResolvedValue(
		createGraphQLMock({
			user: {
				repositories: {
					nodes: [
						{
							name: 'repo1',
							languages: {
								edges: edges ?? [
									{ size: 1000, node: { name: 'TypeScript', color: '#3178c6' } },
									{ size: 500, node: { name: 'JavaScript', color: '#f1e05a' } },
								],
							},
						},
					],
				},
			},
		}),
	);
}

function mockStreakGraphQL() {
	mockFetch
		.mockResolvedValueOnce(
			createGraphQLMock({ user: { contributionsCollection: { contributionYears: [2024] } } }),
		)
		.mockResolvedValueOnce(
			createGraphQLMock({
				user: {
					y2024: {
						contributionCalendar: {
							weeks: [
								{
									contributionDays: [{ date: '2024-01-15', contributionCount: 5 }],
								},
							],
						},
					},
				},
			}),
		);
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
		it('returns the rebuildup stats SVG and ignores query params', async () => {
			mockStatsGraphQL();
			// `username` and every visual param are ignored — the card is
			// always rendered for OWNER_LOGIN with default styling.
			const req = createMockRequest('/api', {
				username: 'someone-else',
				theme: 'radical',
				locale: 'ja',
			});
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			expect(res.status).toBe(200);
			expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
			const body = await res.text();
			expect(body).toContain('<svg');
			expect(body).toContain('Rebuildup');
			expect(body).toContain('Total Stars');
			// The upstream call must target the fixed owner, not the param.
			// fetchStats passes the login as a GraphQL variable.
			const graphqlBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body ?? '{}')) as {
				variables?: { login?: string };
			};
			expect(graphqlBody.variables?.login).toBe('rebuildup');
		});

		it('opts into shared caching with a public positive lifetime', async () => {
			mockStatsGraphQL();
			const res = await githubReadmeStatsRouter.fetch(createMockRequest('/api'), createMockEnv());
			const cacheControl = res.headers.get('Cache-Control') ?? '';
			expect(cacheControl).toContain('public');
			expect(cacheControl).toContain('max-age=86400');
			expect(cacheControl).toContain('s-maxage=86400');
			expect(cacheControl).toContain('stale-while-revalidate=');
		});
	});

	describe('Top languages card: /api/top-langs/', () => {
		it('returns the compact card for rebuildup regardless of params', async () => {
			mockTopLangsGraphQL();
			const req = createMockRequest('/api/top-langs/', {
				username: 'other',
				layout: 'donut-vertical',
			});
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).toContain('<svg');
			expect(body).toContain('TypeScript');
		});

		it('bounds the compact card to the upstream default language count', async () => {
			const edges = Array.from({ length: 12 }, (_, i) => ({
				size: 1000 - i * 10,
				node: { name: `Lang${i}`, color: '#3178c6' },
			}));
			mockTopLangsGraphQL(edges);

			const res = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api/top-langs/'),
				createMockEnv(),
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
	});

	describe('Streak card: /api/streak', () => {
		it('returns SVG for the fixed owner', async () => {
			mockStreakGraphQL();
			const res = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api/streak'),
				createMockEnv(),
			);
			expect(res.status).toBe(200);
			expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
			const body = await res.text();
			expect(body).toContain('<svg');
		});

		it('returns 503 degraded response when no token configured', async () => {
			const res = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api/streak'),
				createMockEnv({
					GITHUB_TOKEN: undefined,
					GITHUB_README_STATS_PAT_1: undefined,
					GITHUB_README_STATS_PAT_2: undefined,
				}),
			);
			expect(res.status).toBe(503);
			expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
			expect(res.headers.get('Cache-Control')).toBe('max-age=60, s-maxage=60');
			const body = await res.text();
			expect(body).toContain('Service unavailable');
			expect(body).not.toContain('PAT_1');
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

		it.each([
			['/api', {}],
			['/api/top-langs/', {}],
			['/api/streak', {}],
			['/api/pin/', { repo: 'my-web-2026' }],
		])(
			'returns 503 (not an error card) when no GitHub token is configured: %s',
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

		it('returns 503 when the upstream GraphQL API fails', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: async () => ({
					data: null,
					errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }],
				}),
			});
			const res = await githubReadmeStatsRouter.fetch(createMockRequest('/api'), createMockEnv());
			expect(res.status).toBe(503);
			expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
			const body = await res.text();
			expect(body).toContain('Service unavailable');
			expect(body).not.toContain('rate limit exceeded');
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
			const res = await githubReadmeStatsRouter.fetch(createMockRequest('/api'), createMockEnv());
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
				createMockRequest('/api/top-langs/'),
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
				createMockRequest('/api/streak'),
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
			const res = await githubReadmeStatsRouter.fetch(createMockRequest('/api'), createMockEnv());
			const body = await res.text();
			expect(body).not.toContain('ECONNRESET');
			expect(body).not.toContain('internal-worker-detail');
			expect(body).toContain('Something went wrong');
		});
	});

	describe('Persistent SVG store (stale-while-revalidate, Issue #1164)', () => {
		it('serves the stored card without touching upstream on a fresh hit', async () => {
			mockStatsGraphQL();
			const first = await githubReadmeStatsRouter.fetch(createMockRequest('/api'), createMockEnv());
			expect(first.status).toBe(200);
			const firstBody = await first.text();
			const callsAfterFirst = mockFetch.mock.calls.length;
			expect(callsAfterFirst).toBeGreaterThan(0);

			// Second request: store hit → no upstream call at all.
			const second = await githubReadmeStatsRouter.fetch(
				createMockRequest('/api'),
				createMockEnv(),
			);
			expect(second.status).toBe(200);
			expect(await second.text()).toBe(firstBody);
			expect(mockFetch.mock.calls.length).toBe(callsAfterFirst);
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
			mockStatsGraphQL();

			const res = await githubReadmeStatsRouter.fetch(createMockRequest('/api'), createMockEnv());
			expect(res.status).toBe(200);
			// Response is the stale bytes; the refresh ran inline because
			// the unit env has no ExecutionContext.
			expect(await res.text()).toBe(staleSvg);
			expect(mockFetch).toHaveBeenCalled();

			// The store now holds the refreshed card: a follow-up request
			// returns the new render, not the stale marker.
			const next = await githubReadmeStatsRouter.fetch(createMockRequest('/api'), createMockEnv());
			const nextBody = await next.text();
			expect(nextBody).not.toBe(staleSvg);
			expect(nextBody).toContain('Rebuildup');
		});

		it('still returns 503 when nothing was ever stored and upstream fails', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: async () => ({
					data: null,
					errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }],
				}),
			});
			const res = await githubReadmeStatsRouter.fetch(createMockRequest('/api'), createMockEnv());
			expect(res.status).toBe(503);
		});
	});
});
