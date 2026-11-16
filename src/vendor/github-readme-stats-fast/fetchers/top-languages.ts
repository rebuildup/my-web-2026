/**
 * Top languages fetcher for github-readme-stats-fast (Cloudflare Workers adaptation).
 *
 * Adapted from upstream:
 * https://github.com/Pranesh-2005/github-readme-stats-fast/blob/main/src/fetchers/top-languages.js
 * Commit: 8e2c76e59a9e2407f2c80f4e23704a04e8db21ad
 */

import { retryer } from '../common/retryer.ts';
import {
	CustomError,
	MissingParamError,
	logger,
	request,
	wrapTextMultiline,
} from '../common/utils.ts';

export interface TopLangData {
	[name: string]: {
		name: string;
		color: string | null;
		size: number;
		count: number;
	};
}

interface GraphQLResponse {
	data?: unknown;
	status: number;
	statusText: string;
}

interface TopLangsGraphQLResponse {
	user?: {
		repositories: {
			nodes: Array<{
				name: string;
				languages: {
					edges: Array<{
						size: number;
						node: { color: string | null; name: string };
					}>;
				};
			}>;
		};
	} | null;
	errors?: Array<{ type: string; message: string }>;
}

interface FetcherVariables {
	login: string;
}

/**
 * Top languages fetcher object.
 */
const fetcher = async (
	variables: FetcherVariables,
	token: string,
	env: Record<string, string | undefined>,
): Promise<GraphQLResponse> => {
	return request(
		{
			query: `
      query userInfo($login: String!) {
        user(login: $login) {
          # fetch only owner repos & not forks
          repositories(ownerAffiliations: OWNER, isFork: false, first: 100) {
            nodes {
              name
              languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
                edges {
                  size
                  node {
                    color
                    name
                  }
                }
              }
            }
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

/**
 * Fetch top languages for a given username.
 */
export async function fetchTopLanguages(
	username: string,
	exclude_repo: string[] = [],
	size_weight = 1,
	count_weight = 0,
	env: Record<string, string | undefined>,
): Promise<TopLangData> {
	if (!username) {
		throw new MissingParamError(['username']);
	}

	const res = await retryer<GraphQLResponse, FetcherVariables>(
		(vars, token, _env) => fetcher(vars, token, _env),
		{ login: username },
		env,
	);

	const responseData = res.data as TopLangsGraphQLResponse | undefined;

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
			'Something went wrong while trying to retrieve the language data using the GraphQL API.',
			CustomError.GRAPHQL_ERROR,
		);
	}

	let repoNodes = responseData?.user?.repositories?.nodes ?? [];
	const repoToHide: Record<string, boolean> = {};

	// populate repoToHide map for quick lookup while filtering out
	if (exclude_repo) {
		exclude_repo.forEach((repoName) => {
			repoToHide[repoName] = true;
		});
	}

	// filter out repositories to be hidden
	repoNodes = repoNodes
		.sort((a, b) => (b as any).size - (a as any).size)
		.filter((node) => !repoToHide[(node as any).name]);

	// flatten the list of language nodes
	const languages = repoNodes
		.filter((node) => (node as any).languages?.edges?.length > 0)
		.reduce((acc, curr) => (curr as any).languages.edges.concat(acc), [] as any[])
		.reduce((acc, prev) => {
			// get the size of the language (bytes)
			let langSize = prev.size;

			// if we already have the language in the accumulator
			// & the current language name is same as previous name
			// add the size to the language size and increase repoCount.
			if (acc[prev.node.name] && prev.node.name === acc[prev.node.name].name) {
				langSize = prev.size + acc[prev.node.name].size;
				acc[prev.node.name].count += 1;
			} else {
				// reset repoCount to 1
				// language must exist in at least one repo to be detected
				acc[prev.node.name] = {
					name: prev.node.name,
					color: prev.node.color,
					size: langSize,
					count: 1,
				};
			}
			return acc;
		}, {} as TopLangData);

	Object.keys(languages).forEach((name) => {
		// comparison index calculation
		languages[name].size =
			Math.pow(languages[name].size, size_weight) * Math.pow(languages[name].count, count_weight);
	});

	const topLangs = Object.keys(languages)
		.sort((a, b) => languages[b].size - languages[a].size)
		.reduce((result, key) => {
			result[key] = languages[key];
			return result;
		}, {} as TopLangData);

	return topLangs;
}
