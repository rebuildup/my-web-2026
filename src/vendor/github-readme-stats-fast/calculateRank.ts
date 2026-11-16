/**
 * Calculate rank for github-readme-stats-fast (Cloudflare Workers adaptation).
 *
 * Adapted from upstream:
 * https://github.com/Pranesh-2005/github-readme-stats-fast/blob/main/src/calculateRank.js
 * Commit: 8e2c76e59a9e2407f2c80f4e23704a04e8db21ad
 */

export interface RankInput {
	all_commits?: boolean;
	commits: number;
	prs: number;
	reviews: number;
	issues: number;
	repos: number;
	stars: number;
	followers: number;
}

export interface RankResult {
	level: string;
	percentile: number;
}

/**
 * Calculate rank based on weighted statistics.
 * Uses exponential and log-normal distributions for percentile calculation.
 */
export function calculateRank({
	all_commits = false,
	commits,
	prs,
	reviews,
	issues,
	repos,
	stars,
	followers,
}: RankInput): RankResult {
	// Weights for each metric (from upstream)
	const weights = {
		commits: all_commits ? 10 : 5,
		prs: 5,
		reviews: 1,
		issues: 2,
		repos: 2,
		stars: 12,
		followers: 8,
	};

	// Calculate weighted score
	let score =
		commits * weights.commits +
		prs * weights.prs +
		reviews * weights.reviews +
		issues * weights.issues +
		repos * weights.repos +
		stars * weights.stars +
		followers * weights.followers;

	// Use log-normal and exponential CDF to calculate percentile
	// This matches the upstream implementation
	const mu = 5.5;
	const sigma = 1.5;
	const lambda = 0.05;

	// Log-normal CDF for repos, stars, followers
	const logNormalCDF = (x: number) => {
		if (x <= 0) return 0;
		const z = (Math.log(x) - mu) / sigma;
		return 0.5 * (1 + erf(z / Math.sqrt(2)));
	};

	// Exponential CDF for commits, prs, reviews, issues
	const expCDF = (x: number) => {
		if (x <= 0) return 0;
		return 1 - Math.exp(-lambda * x);
	};

	// Weighted percentile calculation
	const repoPercentile = logNormalCDF(repos);
	const starPercentile = logNormalCDF(stars);
	const followerPercentile = logNormalCDF(followers);
	const commitPercentile = expCDF(commits);
	const prPercentile = expCDF(prs);
	const reviewPercentile = expCDF(reviews);
	const issuePercentile = expCDF(issues);

	// Combined weighted percentile
	const totalWeight =
		weights.commits +
		weights.prs +
		weights.reviews +
		weights.issues +
		weights.repos +
		weights.stars +
		weights.followers;

	const percentile =
		(commitPercentile * weights.commits +
			prPercentile * weights.prs +
			reviewPercentile * weights.reviews +
			issuePercentile * weights.issues +
			repoPercentile * weights.repos +
			starPercentile * weights.stars +
			followerPercentile * weights.followers) /
		totalWeight;

	// Convert to 0-100 scale (lower is better)
	const finalPercentile = Math.round((1 - percentile) * 1000) / 10;

	// Determine rank level based on percentile
	let level = 'C';
	if (finalPercentile <= 1) level = 'S';
	else if (finalPercentile <= 12.5) level = 'A+';
	else if (finalPercentile <= 25) level = 'A';
	else if (finalPercentile <= 37.5) level = 'A-';
	else if (finalPercentile <= 50) level = 'B+';
	else if (finalPercentile <= 62.5) level = 'B';
	else if (finalPercentile <= 75) level = 'B-';
	else if (finalPercentile <= 87.5) level = 'C+';
	else level = 'C';

	return {
		level,
		percentile: finalPercentile,
	};
}

// Error function approximation
function erf(x: number): number {
	// Abramowitz and Stegun approximation
	const a1 = 0.254829592;
	const a2 = -0.284496736;
	const a3 = 1.421413741;
	const a4 = -1.453152027;
	const a5 = 1.061405429;
	const p = 0.3275911;

	const sign = x >= 0 ? 1 : -1;
	x = Math.abs(x);

	const t = 1 / (1 + p * x);
	const y =
		1 -
		((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
			t *
			Math.exp(-x * x);

	return sign * y;
}