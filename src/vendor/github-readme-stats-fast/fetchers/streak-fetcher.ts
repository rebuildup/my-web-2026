/**
 * Streak fetcher for github-readme-stats-fast (Cloudflare Workers adaptation).
 *
 * Adapted from upstream:
 * https://github.com/Pranesh-2005/github-readme-stats-fast/blob/main/src/fetchers/streak-fetcher.js
 * Commit: 8e2c76e59a9e2407f2c80f4e23704a04e8db21ad
 */

import { request, CustomError, logger } from '../common/utils.ts';

interface ContributionYearsResponse {
	data?: {
		user?: {
			contributionsCollection: { contributionYears: number[] };
		};
		data?: {
			user?: {
				contributionsCollection: { contributionYears: number[] };
			};
		};
	};
	errors?: Array<{ type: string; message: string }>;
}

interface ContributionDay {
	date: string;
	contributionCount: number;
}

interface ContributionWeek {
	contributionDays: ContributionDay[];
}

interface ContributionCalendar {
	weeks: ContributionWeek[];
}

interface YearContributionData {
	contributionCalendar: ContributionCalendar;
}

interface ContributionCalendarResponse {
	data?: {
		user?: Record<string, YearContributionData>;
		data?: {
			user?: Record<string, YearContributionData>;
		};
	};
	errors?: Array<{ type: string; message: string }>;
}

export interface StreakData {
	currentStreak: number;
	longestStreak: number;
	totalContributions: number;
	firstContribution: string;
	currentStreakStart: string;
	currentStreakEnd: string;
	longestStreakStart: string;
	longestStreakEnd: string;
}

/**
 * Fetch all years the user has contributed.
 */
async function fetchContributionYears(
	username: string,
	token: string,
	env: Record<string, string | undefined>,
): Promise<number[]> {
	const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionYears
        }
      }
    }
  `;
	const res = await request(
		{ query, variables: { login: username } },
		{ Authorization: `bearer ${token}` },
		env,
	) as ContributionYearsResponse;
	const user = res.data?.user || res.data?.data?.user;
	if (!user)
		throw new CustomError('Could not fetch user.', CustomError.USER_NOT_FOUND);
	return user.contributionsCollection.contributionYears;
}

/**
 * Fetch contribution calendars for all years in a single GraphQL query using aliases.
 * Avoids N+1 requests and drastically improves performance.
 */
async function fetchAllYearsCalendar(
	username: string,
	years: number[],
	token: string,
	env: Record<string, string | undefined>,
): Promise<Record<string, number>> {
	const fragments = years
		.map((year) => {
			const from = `${year}-01-01T00:00:00Z`;
			const to = `${year}-12-31T23:59:59Z`;
			return `
        y${year}: contributionsCollection(from: "${from}", to: "${to}") {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }`;
		})
		.join('\n');

	const query = `
    query($login: String!) {
      user(login: $login) {
        ${fragments}
      }
    }
  `;

	const res = await request(
		{ query, variables: { login: username } },
		{ Authorization: `bearer ${token}` },
		env,
	) as ContributionCalendarResponse;

	const user = res.data?.user || res.data?.data?.user;
	if (!user)
		throw new CustomError('Could not fetch user.', CustomError.USER_NOT_FOUND);

	const contributions: Record<string, number> = {};
	for (const year of years) {
		const weeks = user[`y${year}`]?.contributionCalendar?.weeks || [];
		for (const week of weeks) {
			for (const day of week.contributionDays) {
				if (day.contributionCount > 0) {
					contributions[day.date] = day.contributionCount;
				}
			}
		}
	}

	return contributions;
}

/**
 * Format a date for display (YYYY-MM-DD to "MMM D" or "MMM D, YYYY").
 */
function formatDateForDisplay(dateString: string, includeYear = false): string {
	if (!dateString) return '';
	const date = new Date(dateString);
	return date.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		...(includeYear ? { year: 'numeric' } : {}),
	});
}

/**
 * Calculate streaks and totals from all contribution days (GitHub-accurate, UTC aware).
 */
function calculateStreaks(contributions: Record<string, number>): StreakData {
	const dates = Object.keys(contributions).sort();
	if (dates.length === 0) {
		return {
			currentStreak: 0,
			longestStreak: 0,
			totalContributions: 0,
			firstContribution: '',
			currentStreakStart: '',
			currentStreakEnd: '',
			longestStreakStart: '',
			longestStreakEnd: '',
		};
	}

	let totalContributions = 0;
	let longestStreak = 0;
	let tempStreak = 0;
	let prevDate: string | null = null;
	let currentStreak = 0;

	let currentStreakStart: string | null = null;
	let currentStreakEnd: string | null = null;
	let longestStreakStart: string | null = null;
	let longestStreakEnd: string | null = null;

	// find first contribution date
	const firstContribution = dates.find((d) => contributions[d] > 0);

	// today and yesterday in UTC
	const now = new Date();
	const today = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	)
		.toISOString()
		.split('T')[0];
	const yesterday = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
	)
		.toISOString()
		.split('T')[0];

	for (const date of dates) totalContributions += contributions[date];

	// Determine current streak starting point
	const todayCount = contributions[today] || 0;
	const yesterdayCount = contributions[yesterday] || 0;
	let startDate = todayCount > 0 ? today : yesterdayCount > 0 ? yesterday : null;

	// Walk backward for current streak
	if (startDate) {
		let d = new Date(startDate + 'T00:00:00Z');
		while (true) {
			const dateStr = d.toISOString().split('T')[0];
			const count = contributions[dateStr];
			if (count && count > 0) {
				currentStreak++;
				currentStreakEnd ??= dateStr;
				currentStreakStart = dateStr;
				d.setUTCDate(d.getUTCDate() - 1);
			} else break;
		}
	}

	// longest streak
	tempStreak = 0;
	prevDate = null;
	let tempStreakStart: string | null = null;

	for (const date of dates) {
		const count = contributions[date];
		if (count > 0) {
			const gap =
				prevDate == null
					? 1
					: (new Date(date).getTime() - new Date(prevDate).getTime()) /
					  (1000 * 60 * 60 * 24);
			if (gap === 1) {
				tempStreak++;
			} else {
				tempStreak = 1;
				tempStreakStart = date;
			}

			if (tempStreak > longestStreak) {
				longestStreak = tempStreak;
				longestStreakStart = tempStreakStart || date;
				longestStreakEnd = date;
			}
		} else {
			tempStreak = 0;
		}
		prevDate = date;
	}

	const currentYear = now.getUTCFullYear();
	const longestEndIncludeYear =
		longestStreakEnd !== null &&
		longestStreakEnd !== '' &&
		new Date(longestStreakEnd).getUTCFullYear() !== currentYear;

	return {
		currentStreak,
		longestStreak,
		totalContributions,
		firstContribution: formatDateForDisplay(firstContribution ?? '', true),
		currentStreakStart: formatDateForDisplay(currentStreakStart ?? '', true),
		currentStreakEnd: formatDateForDisplay(currentStreakEnd ?? ''),
		longestStreakStart: formatDateForDisplay(longestStreakStart ?? '', true),
		longestStreakEnd: formatDateForDisplay(
			longestStreakEnd ?? '',
			longestEndIncludeYear,
		),
	};
}

/**
 * Fetch the user's all-time contribution streak data.
 * Optimized for performance (2 GraphQL calls total).
 */
export async function fetchStreak(
	username: string,
	token: string,
	env: Record<string, string | undefined>,
): Promise<StreakData> {
	if (!username) {
		throw new CustomError('Missing username parameter', CustomError.USER_NOT_FOUND);
	}

	try {
		// 1. fetch all contribution years
		const years = await fetchContributionYears(username, token, env);
		if (!years || years.length === 0) {
			return {
				currentStreak: 0,
				longestStreak: 0,
				totalContributions: 0,
				firstContribution: '',
				currentStreakStart: '',
				currentStreakEnd: '',
				longestStreakStart: '',
				longestStreakEnd: '',
			};
		}

		// 2. single query for all years (alias-based)
		const contributions = await fetchAllYearsCalendar(username, years, token, env);

		// 3. compute streaks
		return calculateStreaks(contributions);
	} catch (err) {
		logger.error(err);
		throw new CustomError(
			err instanceof Error ? err.message : 'Could not fetch streak data.',
			CustomError.GRAPHQL_ERROR,
		);
	}
}