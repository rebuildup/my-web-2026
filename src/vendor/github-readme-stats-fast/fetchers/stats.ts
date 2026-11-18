/**
 * Stats fetcher for github-readme-stats-fast (Cloudflare Workers adaptation).
 *
 * Adapted from upstream:
 * https://github.com/Pranesh-2005/github-readme-stats-fast/blob/main/src/fetchers/stats.js
 * Commit: 8e2c76e59a9e2407f2c80f4e23704a04e8db21ad
 *
 * Changes for Workers:
 * - Replaced axios with native fetch via request()
 * - Uses github-username-regex logic inline
 * - TypeScript types
 */

import { calculateRank } from '../calculateRank.ts';
import type { RankInput } from '../calculateRank.ts';
import { retryer } from '../common/retryer.ts';
import {
	CustomError,
	MissingParamError,
	getGithubToken,
	logger,
	request,
	wrapTextMultiline,
} from '../common/utils.ts';

export interface StatsData {
	name: string;
	totalPRs: number;
	totalPRsMerged: number;
	mergedPRsPercentage: number;
	totalReviews: number;
	totalCommits: number;
	totalIssues: number;
	totalStars: number;
	totalDiscussionsStarted: number;
	totalDiscussionsAnswered: number;
	contributedTo: number;
	rank: { level: string; percentile: number };
}

interface RepoNode {
	name: string;
	stargazerCount: number;
}

interface GraphQLResponse {
	data?: {
		user?: {
			name: string | null;
			login: string;
			contributionsCollection: {
				totalCommitContributions: number;
				totalPullRequestReviewContributions: number;
			};
			repositoriesContributedTo: { totalCount: number };
			pullRequests: { totalCount: number };
			mergedPullRequests?: { totalCount: number };
			openIssues: { totalCount: number };
			closedIssues: { totalCount: number };
			followers: { totalCount: number };
			repositoryDiscussions?: { totalCount: number };
			repositoryDiscussionComments?: { totalCount: number };
			repositories: {
				totalCount: number;
				nodes: RepoNode[];
				pageInfo: { hasNextPage: boolean; endCursor: string | null };
			};
		};
	};
	errors?: Array<{ type: string; message: string }>;
	status?: number;
	statusText?: string;
}

type GraphQLResponseData = NonNullable<GraphQLResponse['data']>;

// GraphQL queries.
const GRAPHQL_REPOS_FIELD = `
  repositories(first: 100, ownerAffiliations: OWNER, orderBy: {direction: DESC, field: STARGAZERS}, after: $after) {
    totalCount
    nodes {
      name
      stargazerCount
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
`;

const GRAPHQL_REPOS_QUERY = `
  query userInfo($login: String!, $after: String) {
    user(login: $login) {
      ${GRAPHQL_REPOS_FIELD}
    }
  }
`;

const GRAPHQL_STATS_QUERY = `
  query userInfo($login: String!, $after: String, $includeMergedPullRequests: Boolean!, $includeDiscussions: Boolean!, $includeDiscussionsAnswers: Boolean!) {
    user(login: $login) {
      name
      login
      contributionsCollection {
        totalCommitContributions,
        totalPullRequestReviewContributions
      }
      repositoriesContributedTo(first: 1, contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]) {
        totalCount
      }
      pullRequests(first: 1) {
        totalCount
      }
      mergedPullRequests: pullRequests(states: MERGED) @include(if: $includeMergedPullRequests) {
        totalCount
      }
      openIssues: issues(states: OPEN) {
        totalCount
      }
      closedIssues: issues(states: CLOSED) {
        totalCount
      }
      followers {
        totalCount
      }
      repositoryDiscussions @include(if: $includeDiscussions) {
        totalCount
      }
      repositoryDiscussionComments(onlyAnswers: true) @include(if: $includeDiscussionsAnswers) {
        totalCount
      }
      ${GRAPHQL_REPOS_FIELD}
    }
  }
`;

// GitHub username regex (from github-username-regex package)
const GITHUB_USERNAME_REGEX = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

interface FetcherVariables {
	login: string;
	after?: string;
	first?: number;
	includeMergedPullRequests?: boolean;
	includeDiscussions?: boolean;
	includeDiscussionsAnswers?: boolean;
	[key: string]: unknown;
}

/**
 * Stats fetcher object.
 */
const fetcher = async (
	variables: FetcherVariables,
	token: string,
	env: Record<string, string | undefined>,
): Promise<GraphQLResponse> => {
	const { after } = variables;
	const query = after ? GRAPHQL_REPOS_QUERY : GRAPHQL_STATS_QUERY;
	return request<NonNullable<GraphQLResponse['data']>>(
		{
			query,
			variables,
		},
		{
			Authorization: `bearer ${token}`,
		},
		env,
	);
};

/**
 * Fetch stats information for a given username.
 */
const statsFetcher = async (
	{
		username,
		includeMergedPullRequests,
		includeDiscussions,
		includeDiscussionsAnswers,
	}: {
		username: string;
		includeMergedPullRequests: boolean;
		includeDiscussions: boolean;
		includeDiscussionsAnswers: boolean;
	},
	env: Record<string, string | undefined>,
): Promise<GraphQLResponse> => {
	let stats: GraphQLResponse | null = null;
	let hasNextPage = true;
	let endCursor: string | null = null;

	while (hasNextPage) {
		const variables: FetcherVariables = {
			login: username,
			first: 100,
			after: endCursor ?? undefined,
			includeMergedPullRequests,
			includeDiscussions,
			includeDiscussionsAnswers,
		};
		const res = await retryer<GraphQLResponse, FetcherVariables>(
			(vars, token, _env) => fetcher(vars, token, _env),
			variables,
			env,
		);

		if (res.errors) {
			return res;
		}

		// Store stats data.
		const repoNodes = res.data?.user?.repositories?.nodes ?? [];
		if (stats) {
			stats.data!.user!.repositories.nodes.push(...repoNodes);
		} else {
			stats = res;
		}

		// Disable multi page fetching on public Vercel instance due to rate limits.
		const repoNodesWithStars = repoNodes.filter((node) => node.stargazerCount !== 0);
		hasNextPage =
			repoNodes.length === repoNodesWithStars.length &&
			res.data?.user?.repositories?.pageInfo?.hasNextPage === true;
		endCursor = res.data?.user?.repositories?.pageInfo?.endCursor ?? null;
	}

	if (!stats) {
		throw new CustomError('Could not fetch stats.', CustomError.GRAPHQL_ERROR);
	}
	return stats;
};

/**
 * Fetch all the commits for all the repositories of a given username.
 * Uses GitHub REST API search/commits.
 */
const totalCommitsFetcher = async (
	username: string,
	env: Record<string, string | undefined>,
): Promise<number> => {
	if (!GITHUB_USERNAME_REGEX.test(username)) {
		logger.log('Invalid username provided.');
		throw new Error('Invalid username provided.');
	}

	const fetchTotalCommits = async (
		variables: { login: string },
		token: string,
		_env: Record<string, string | undefined>,
	) => {
		const { login } = variables;
		const response = await fetch(`https://api.github.com/search/commits?q=author:${login}`, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/vnd.github.cloak-preview',
				Authorization: `token ${token}`,
			},
			// Issue #996: bound the upstream call; the retryer multiplies
			// whatever an unbounded fetch allows.
			signal: AbortSignal.timeout(15_000),
		});
		return {
			data: await response.json(),
			status: response.status,
			statusText: response.statusText,
		};
	};

	let res;
	try {
		res = await retryer(fetchTotalCommits, { login: username }, env);
	} catch (err) {
		logger.log(err);
		throw new Error(String(err));
	}

	const totalCount = (res.data as { total_count?: number } | undefined)?.total_count;
	if (!totalCount || Number.isNaN(totalCount)) {
		throw new CustomError('Could not fetch total commits.', CustomError.GITHUB_REST_API_ERROR);
	}
	return totalCount;
};

/**
 * Fetch stats for a given username.
 */
export async function fetchStats(
	username: string,
	include_all_commits = false,
	exclude_repo: string[] = [],
	include_merged_pull_requests = false,
	include_discussions = false,
	include_discussions_answers = false,
	env: Record<string, string | undefined>,
): Promise<StatsData> {
	if (!username) {
		throw new MissingParamError(['username']);
	}

	const stats: StatsData = {
		name: '',
		totalPRs: 0,
		totalPRsMerged: 0,
		mergedPRsPercentage: 0,
		totalReviews: 0,
		totalCommits: 0,
		totalIssues: 0,
		totalStars: 0,
		totalDiscussionsStarted: 0,
		totalDiscussionsAnswered: 0,
		contributedTo: 0,
		rank: { level: 'C', percentile: 100 },
	};

	const res = await statsFetcher(
		{
			username,
			includeMergedPullRequests: include_merged_pull_requests,
			includeDiscussions: include_discussions,
			includeDiscussionsAnswers: include_discussions_answers,
		},
		env,
	);

	// Catch GraphQL errors.
	if (res.errors) {
		logger.error(res.errors);
		if (res.errors[0].type === 'NOT_FOUND') {
			throw new CustomError(
				res.errors[0].message || 'Could not fetch user.',
				CustomError.USER_NOT_FOUND,
			);
		}
		if (res.errors[0].message) {
			throw new CustomError(
				wrapTextMultiline(res.errors[0].message, 90, 1)[0],
				res.statusText || 'GRAPHQL_ERROR',
			);
		}
		throw new CustomError(
			'Something went wrong while trying to retrieve the stats data using the GraphQL API.',
			CustomError.GRAPHQL_ERROR,
		);
	}

	const user = res.data?.user;
	if (!user) {
		throw new CustomError('Could not fetch user.', CustomError.USER_NOT_FOUND);
	}

	stats.name = user.name || user.login;

	// if include_all_commits, fetch all commits using the REST API.
	if (include_all_commits) {
		stats.totalCommits = await totalCommitsFetcher(username, env);
	} else {
		stats.totalCommits = user.contributionsCollection.totalCommitContributions;
	}

	stats.totalPRs = user.pullRequests.totalCount;
	if (include_merged_pull_requests) {
		stats.totalPRsMerged = user.mergedPullRequests?.totalCount ?? 0;
		stats.mergedPRsPercentage =
			((user.mergedPullRequests?.totalCount ?? 0) / user.pullRequests.totalCount) * 100;
	}
	stats.totalReviews = user.contributionsCollection.totalPullRequestReviewContributions;
	stats.totalIssues = user.openIssues.totalCount + user.closedIssues.totalCount;
	if (include_discussions) {
		stats.totalDiscussionsStarted = user.repositoryDiscussions?.totalCount ?? 0;
	}
	if (include_discussions_answers) {
		stats.totalDiscussionsAnswered = user.repositoryDiscussionComments?.totalCount ?? 0;
	}
	stats.contributedTo = user.repositoriesContributedTo.totalCount;

	// Retrieve stars while filtering out repositories to be hidden.
	const repoToHide = new Set(exclude_repo);

	const starredRepoNodes = user.repositories.nodes;
	stats.totalStars = starredRepoNodes
		.filter((data) => {
			return !repoToHide.has(data.name);
		})
		.reduce((prev, curr) => {
			return prev + curr.stargazerCount;
		}, 0);

	stats.rank = calculateRank({
		all_commits: include_all_commits,
		commits: stats.totalCommits,
		prs: stats.totalPRs,
		reviews: stats.totalReviews,
		issues: stats.totalIssues,
		repos: user.repositories.totalCount,
		stars: stats.totalStars,
		followers: user.followers.totalCount,
	});

	return stats;
}
