/**
 * Normalize query params to avoid cache-key explosion.
 * - removes undefined / empty values
 * - sorts keys
 * - stable JSON string
 *
 * Adapted from upstream:
 * https://github.com/Pranesh-2005/github-readme-stats-fast/blob/main/src/common/normalizeparam.js
 * Commit: 8e2c76e59a9e2407f2c80f4e23704a04e8db21ad
 */

export function normalizeParams(
	params: Record<string, string | number | boolean | undefined>,
): Record<string, string> {
	return Object.keys(params)
		.filter((k) => params[k] !== undefined && params[k] !== '')
		.sort()
		.reduce((acc, key) => {
			acc[key] = String(params[key]);
			return acc;
		}, {} as Record<string, string>);
}