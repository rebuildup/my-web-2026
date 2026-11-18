/**
 * Tests for GitHub Readme Stats router.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { githubReadmeStatsRouter } from './router.js';

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

describe('GitHub Readme Stats Router', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetch.mockReset();
	});

	describe('Stats card: /api', () => {
		it('returns error SVG for missing username', async () => {
			const req = createMockRequest('/api');
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			expect(res.status).toBe(200);
			expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
			const body = await res.text();
			expect(body).toContain('Something went wrong');
			expect(body).toContain('Missing');
		});

		it('returns SVG for valid username', async () => {
			mockFetch.mockResolvedValue(
				createGraphQLMock({
					user: {
						name: 'Test User',
						login: 'testuser',
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
					},
				}),
			);

			const req = createMockRequest('/api', { username: 'testuser' });
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			expect(res.status).toBe(200);
			expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
			const body = await res.text();
			expect(body).toContain('<svg');
			expect(body).toContain('Test User');
			expect(body).toContain('Total Stars');
		});

		it('sets cache headers', async () => {
			mockFetch.mockResolvedValue(
				createGraphQLMock({
					user: {
						name: 'Test',
						login: 'test',
						contributionsCollection: {
							totalCommitContributions: 10,
							totalPullRequestReviewContributions: 5,
						},
						repositoriesContributedTo: { totalCount: 1 },
						pullRequests: { totalCount: 2 },
						mergedPullRequests: { totalCount: 1 },
						openIssues: { totalCount: 0 },
						closedIssues: { totalCount: 0 },
						followers: { totalCount: 10 },
						repositoryDiscussions: { totalCount: 0 },
						repositoryDiscussionComments: { totalCount: 0 },
						repositories: {
							totalCount: 5,
							nodes: [{ name: 'repo1', stargazerCount: 1 }],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				}),
			);

			const req = createMockRequest('/api', { username: 'test' });
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			const cacheControl = res.headers.get('Cache-Control');
			expect(cacheControl).toContain('max-age=');
			expect(cacheControl).toContain('s-maxage=');
			expect(cacheControl).toContain('stale-while-revalidate=');
		});

		it('handles blacklisted username', async () => {
			const { blacklist } = await import(
				'../../vendor/github-readme-stats-fast/common/blacklist.ts'
			);
			blacklist.push('blacklisted-user');
			const req = createMockRequest('/api', { username: 'blacklisted-user' });
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).toContain('blacklisted');
			blacklist.pop();
		});
	});

	describe('Top languages card: /api/top-langs/', () => {
		it('returns SVG for valid username', async () => {
			mockFetch.mockResolvedValue(
				createGraphQLMock({
					user: {
						repositories: {
							nodes: [
								{
									name: 'repo1',
									languages: {
										edges: [
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

			const req = createMockRequest('/api/top-langs/', { username: 'testuser' });
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			expect(res.status).toBe(200);
			expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
			const body = await res.text();
			expect(body).toContain('<svg');
			expect(body).toContain('TypeScript');
		});

		it('validates layout parameter', async () => {
			const req = createMockRequest('/api/top-langs/', { username: 'testuser', layout: 'invalid' });
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).toContain('Incorrect layout input');
		});
	});

	describe('Streak card: /api/streak', () => {
		it('returns error SVG for missing username', async () => {
			const req = createMockRequest('/api/streak');
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).toContain('Missing `username` parameter');
		});

		it('returns SVG for valid username with token', async () => {
			mockFetch.mockResolvedValueOnce(
				createGraphQLMock({
					user: { contributionsCollection: { contributionYears: [2024, 2023] } },
				}),
			);
			mockFetch.mockResolvedValueOnce(
				createGraphQLMock({
					user: {
						y2024: {
							contributionCalendar: {
								weeks: [
									{
										contributionDays: [
											{ date: '2024-01-15', contributionCount: 5 },
											{ date: '2024-01-16', contributionCount: 3 },
										],
									},
								],
							},
						},
						y2023: {
							contributionCalendar: {
								weeks: [{ contributionDays: [{ date: '2023-12-01', contributionCount: 2 }] }],
							},
						},
					},
				}),
			);

			const req = createMockRequest('/api/streak', { username: 'testuser' });
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			expect(res.status).toBe(200);
			expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
			const body = await res.text();
			expect(body).toContain('<svg');
		});

		it('returns 503 degraded response when no token configured', async () => {
			const req = createMockRequest('/api/streak', { username: 'testuser' });
			const res = await githubReadmeStatsRouter.fetch(
				req,
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
		it('returns error SVG for missing username', async () => {
			const req = createMockRequest('/api/pin/', { repo: 'testrepo' });
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).toContain('Missing params');
		});

		it('returns error SVG for missing repo', async () => {
			const req = createMockRequest('/api/pin/', { username: 'testuser' });
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).toContain('Missing params');
		});

		it('returns SVG for valid username and repo', async () => {
			mockFetch.mockResolvedValue(
				createGraphQLMock({
					user: {
						repository: {
							name: 'testrepo',
							nameWithOwner: 'testuser/testrepo',
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

			const req = createMockRequest('/api/pin/', { username: 'testuser', repo: 'testrepo' });
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			expect(res.status).toBe(200);
			expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
			const body = await res.text();
			expect(body).toContain('<svg');
			expect(body).toContain('testrepo');
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
			['/api', { username: 'testuser' }],
			['/api/top-langs/', { username: 'testuser' }],
			['/api/pin/', { username: 'testuser', repo: 'testrepo' }],
		])(
			'returns 503 (not an error card) when no GitHub token is configured: %s',
			async (path, query) => {
				const req = createMockRequest(path, query);
				const res = await githubReadmeStatsRouter.fetch(req, envWithoutTokens());
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
			const req = createMockRequest('/api', { username: 'upstream-fail-user' });
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			expect(res.status).toBe(503);
			expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
			const body = await res.text();
			expect(body).toContain('Service unavailable');
			expect(body).not.toContain('rate limit exceeded');
		});

		it('keeps 200 error SVG for per-user failures (user not found)', async () => {
			mockFetch.mockResolvedValue(createGraphQLMock({ user: null }));
			const req = createMockRequest('/api', { username: 'nonexistent-user-xyz' });
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).toContain('Could not fetch user');
		});
	});

	describe('Security: Error sanitization', () => {
		it('does not expose tokens in error responses', async () => {
			mockFetch.mockRejectedValue(new Error('Network error'));
			const req = createMockRequest('/api', { username: 'testuser' });
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
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
			const req = createMockRequest('/api/top-langs/', { username: 'testuser' });
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			const body = await res.text();
			expect(body).not.toContain('localhost');
			expect(body).not.toContain('127.0.0.1');
			expect(body).not.toContain('internal');
			expect(body).not.toContain('worker');
		});

		it('does not expose stack traces in error responses', async () => {
			mockFetch.mockRejectedValue(new Error('Test error with stack'));
			const req = createMockRequest('/api/streak', { username: 'testuser' });
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			const body = await res.text();
			// Check for actual stack trace patterns, not incidental "at" in animation names
			expect(body).not.toMatch(/at\s+\w+\s*\(/); // "at functionName ("
			expect(body).not.toContain('.js:');
			expect(body).not.toContain('stack');
		});

		it('collapses a non-authored error message to the fixed fallback (Issue #996)', async () => {
			mockFetch.mockRejectedValue(new Error('ECONNRESET internal-worker-detail'));
			// Unique username: microCache/svgCache are in-memory, so a
			// reused login could serve an earlier test's cached card.
			const req = createMockRequest('/api', { username: 'err-leak-996' });
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			const body = await res.text();
			expect(body).not.toContain('ECONNRESET');
			expect(body).not.toContain('internal-worker-detail');
			expect(body).toContain('Something went wrong');
		});
	});

	describe('Cache behavior', () => {
		it('sets appropriate cache headers for stats card', async () => {
			mockFetch.mockResolvedValue(
				createGraphQLMock({
					user: {
						name: 'Test',
						login: 'test',
						contributionsCollection: {
							totalCommitContributions: 10,
							totalPullRequestReviewContributions: 5,
						},
						repositoriesContributedTo: { totalCount: 1 },
						pullRequests: { totalCount: 2 },
						mergedPullRequests: { totalCount: 1 },
						openIssues: { totalCount: 0 },
						closedIssues: { totalCount: 0 },
						followers: { totalCount: 10 },
						repositoryDiscussions: { totalCount: 0 },
						repositoryDiscussionComments: { totalCount: 0 },
						repositories: {
							totalCount: 5,
							nodes: [{ name: 'repo1', stargazerCount: 1 }],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				}),
			);

			const req = createMockRequest('/api', { username: 'test' });
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			const cacheControl = res.headers.get('Cache-Control');
			expect(cacheControl).toMatch(/max-age=\d+/);
			expect(cacheControl).toMatch(/s-maxage=\d+/);
			expect(cacheControl).toMatch(/stale-while-revalidate=\d+/);
		});

		it('sets 1 hour cache for streak card', async () => {
			const envWithoutCacheSeconds = createMockEnv({ CACHE_SECONDS: undefined });
			mockFetch.mockResolvedValueOnce(
				createGraphQLMock({ user: { contributionsCollection: { contributionYears: [2024] } } }),
			);
			mockFetch.mockResolvedValueOnce(
				createGraphQLMock({
					user: {
						y2024: {
							contributionCalendar: {
								weeks: [{ contributionDays: [{ date: '2024-01-15', contributionCount: 5 }] }],
							},
						},
					},
				}),
			);

			const req = createMockRequest('/api/streak', { username: 'testuser' });
			const res = await githubReadmeStatsRouter.fetch(req, envWithoutCacheSeconds);
			const cacheControl = res.headers.get('Cache-Control');
			expect(cacheControl).toContain('max-age=3600');
			expect(cacheControl).toContain('s-maxage=3600');
		});
	});

	describe('Locale support', () => {
		it('supports Japanese locale', async () => {
			mockFetch.mockResolvedValue(
				createGraphQLMock({
					user: {
						name: 'Test',
						login: 'test',
						contributionsCollection: {
							totalCommitContributions: 10,
							totalPullRequestReviewContributions: 5,
						},
						repositoriesContributedTo: { totalCount: 1 },
						pullRequests: { totalCount: 2 },
						mergedPullRequests: { totalCount: 1 },
						openIssues: { totalCount: 0 },
						closedIssues: { totalCount: 0 },
						followers: { totalCount: 10 },
						repositoryDiscussions: { totalCount: 0 },
						repositoryDiscussionComments: { totalCount: 0 },
						repositories: {
							totalCount: 5,
							nodes: [{ name: 'repo1', stargazerCount: 1 }],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				}),
			);

			const req = createMockRequest('/api', { username: 'test', locale: 'ja' });
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).toContain('<svg');
		});

		it('returns error for unsupported locale', async () => {
			const req = createMockRequest('/api', { username: 'test', locale: 'invalid-locale' });
			const res = await githubReadmeStatsRouter.fetch(req, createMockEnv());
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).toContain('Language not found');
		});
	});
});
