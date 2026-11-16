/**
 * Retryer for github-readme-stats-fast (Cloudflare Workers adaptation).
 *
 * Adapted from upstream:
 * https://github.com/Pranesh-2005/github-readme-stats-fast/blob/main/src/common/retryer.js
 * Commit: 8e2c76e59a9e2407f2c80f4e23704a04e8db21ad
 *
 * Handles token rotation and rate limit retries.
 */

import { CustomError, logger, getGithubToken } from './utils.ts';

export interface FetchFn<T, V> {
	(variables: V, token: string, env: Record<string, string | undefined>): Promise<T>;
}

export interface RetryerOptions<V> {
	variables: V;
	env: Record<string, string | undefined>;
	maxRetries?: number;
}

/**
 * Retry a fetch function with token rotation on rate limit.
 */
export async function retryer<T, V>(
	fetchFn: FetchFn<T, V>,
	variables: V,
	env: Record<string, string | undefined>,
	maxRetries = 10,
): Promise<T> {
	// Get all available tokens
	const tokens = Object.keys(env)
		.filter((key) => key.startsWith('GITHUB_README_STATS_PAT_'))
		.map((key) => env[key])
		.filter(Boolean) as string[];

	const allTokens = tokens.length > 0 ? tokens : [env.GITHUB_TOKEN].filter(Boolean) as string[];

	if (allTokens.length === 0) {
		throw new CustomError(
			'GitHub token not configured',
			CustomError.NO_TOKENS,
		);
	}

	let retries = 0;
	let tokenIndex = 0;

	while (retries <= maxRetries) {
		const token = allTokens[tokenIndex % allTokens.length];

		try {
			const response = await fetchFn(variables, token, env);

			// Check for rate limit error
			const isRateExceeded =
				response &&
				typeof response === 'object' &&
				'data' in response &&
				response.data &&
				typeof response.data === 'object' &&
				'errors' in response.data &&
				Array.isArray(response.data.errors) &&
				response.data.errors[0]?.type === 'RATE_LIMITED';

			if (isRateExceeded) {
				logger.log(`Token ${tokenIndex + 1} rate limited, rotating...`);
				retries++;
				tokenIndex++;
				continue;
			}

			return response;
		} catch (err) {
			logger.error(err);
			throw err;
		}
	}

	throw new CustomError(
		'Maximum retries exceeded',
		CustomError.MAX_RETRY,
	);
}