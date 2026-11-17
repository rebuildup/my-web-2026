/**
 * Repo fetcher for github-readme-stats-fast (Cloudflare Workers adaptation).
 *
 * Adapted from upstream:
 * https://github.com/Pranesh-2005/github-readme-stats-fast/blob/main/src/fetchers/repo.js
 * Commit: 8e2c76e59a9e2407f2c80f4e23704a04e8db21ad
 */

import { retryer } from '../common/retryer.ts';
import { MissingParamError, request } from '../common/utils.ts';

interface GraphQLResponse {
	data?: unknown;
	status: number;
	statusText: string;
}

interface RepoDataResponse {
	user?: { repository?: RepositoryData | null } | null;
	organization?: { repository?: RepositoryData | null } | null;
}

export interface RepositoryData {
	name: string;
	nameWithOwner: string;
	isPrivate: boolean;
	isArchived: boolean;
	isTemplate: boolean;
	stargazerCount: number;
	description: string | null;
	primaryLanguage: {
		color: string | null;
		id: string;
		name: string;
	} | null;
	forkCount: number;
	starCount: number;
}

/**
 * Repo data fetcher.
 */
const fetcher = async (
	variables: { login: string; repo: string },
	token: string,
	env: Record<string, string | undefined>,
): Promise<GraphQLResponse> => {
	return request(
		{
			query: `
      fragment RepoInfo on Repository {
        name
        nameWithOwner
        isPrivate
        isArchived
        isTemplate
        stargazerCount
        description
        primaryLanguage {
          color
          id
          name
        }
        forkCount
      }
      query getRepo($login: String!, $repo: String!) {
        user(login: $login) {
          repository(name: $repo) {
            ...RepoInfo
          }
        }
        organization(login: $login) {
          repository(name: $repo) {
            ...RepoInfo
          }
        }
      }
    `,
			variables,
		},
		{
			Authorization: `token ${token}`,
		},
		env,
	);
};

const urlExample = '/api/pin?username=USERNAME&repo=REPO_NAME';

/**
 * Fetch repository data.
 */
export async function fetchRepo(
	username: string,
	reponame: string,
	env: Record<string, string | undefined>,
): Promise<RepositoryData> {
	if (!username && !reponame) {
		throw new MissingParamError(['username', 'repo'], urlExample);
	}
	if (!username) {
		throw new MissingParamError(['username'], urlExample);
	}
	if (!reponame) {
		throw new MissingParamError(['repo'], urlExample);
	}

	const res = await retryer<GraphQLResponse, { login: string; repo: string }>(
		(vars, token, _env) => fetcher(vars, token, _env),
		{ login: username, repo: reponame },
		env,
	);

	// Extract repo data from the response
	const responseData = res.data as
		| (RepoDataResponse & { data?: RepoDataResponse })
		| undefined;
	const data = responseData?.data ?? responseData;

	if (!data?.user && !data?.organization) {
		throw new Error('Not found');
	}

	// Type guards for user/org data
	const userRepo = data.user?.repository ?? null;
	const orgRepo = data.organization?.repository ?? null;

	const isUser = data.organization === null && userRepo !== null;
	const isOrg = data.user === null && orgRepo !== null;

	if (isUser && userRepo) {
		if (userRepo.isPrivate) {
			throw new Error('User Repository Not found');
		}
		return {
			...userRepo,
			starCount: userRepo.stargazerCount,
		};
	}

	if (isOrg && orgRepo) {
		if (orgRepo.isPrivate) {
			throw new Error('Organization Repository Not found');
		}
		return {
			...orgRepo,
			starCount: orgRepo.stargazerCount,
		};
	}

	throw new Error('Unexpected behavior');
}