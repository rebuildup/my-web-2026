/**
 * GitHub Readme Stats router for my-web-2026.
 *
 * Self-hosted implementation of Pranesh-2005/github-readme-stats-fast endpoints.
 * Provides SVG cards for: stats, top-langs, streak, pin.
 *
 * Routes:
 *   GET /api/github-readme-stats/api?username=...
 *   GET /api/github-readme-stats/api/top-langs/?username=...
 *   GET /api/github-readme-stats/api/streak?username=...
 *   GET /api/github-readme-stats/api/pin/?username=...&repo=...
 *
 * Upstream: https://github.com/Pranesh-2005/github-readme-stats-fast
 * Commit: 8e2c76e59a9e2407f2c80f4e23704a04e8db21ad
 * License: MIT
 */

import { Hono } from 'hono';
import { renderRepoCard } from '../../vendor/github-readme-stats-fast/cards/repo.ts';
import { renderStatsCard } from '../../vendor/github-readme-stats-fast/cards/stats.ts';
import { renderStreakCard } from '../../vendor/github-readme-stats-fast/cards/streak-card.ts';
import { renderTopLanguages } from '../../vendor/github-readme-stats-fast/cards/top-languages.ts';
import { blacklist } from '../../vendor/github-readme-stats-fast/common/blacklist.ts';
import { microCache } from '../../vendor/github-readme-stats-fast/common/microCache.ts';
import { normalizeParams } from '../../vendor/github-readme-stats-fast/common/normalizeparam.ts';
import { svgCacheGetOrSet } from '../../vendor/github-readme-stats-fast/common/svgCache.ts';
import {
	CONSTANTS,
	clampValue,
	parseArray,
	parseBoolean,
	renderError,
} from '../../vendor/github-readme-stats-fast/common/utils.ts';
import { getGithubToken } from '../../vendor/github-readme-stats-fast/common/utils.ts';
import { fetchRepo } from '../../vendor/github-readme-stats-fast/fetchers/repo.ts';
import { fetchStats } from '../../vendor/github-readme-stats-fast/fetchers/stats.ts';
import { fetchStreak } from '../../vendor/github-readme-stats-fast/fetchers/streak-fetcher.ts';
import { fetchTopLanguages } from '../../vendor/github-readme-stats-fast/fetchers/top-languages.ts';
import { isLocaleAvailable } from '../../vendor/github-readme-stats-fast/translations.ts';

// Module scope so token rotation survives across requests on a warm instance
let tokenIndex = 0;

function getNextToken(env: Record<string, string | undefined>): string | undefined {
	const tokens = Object.keys(env)
		.filter((key) => key.startsWith('GITHUB_README_STATS_PAT_'))
		.map((key) => env[key])
		.filter(Boolean) as string[];

	if (tokens.length === 0) {
		return env.GITHUB_TOKEN;
	}

	const token = tokens[tokenIndex % tokens.length];
	tokenIndex++;
	return token;
}

export const githubReadmeStatsRouter = new Hono<{
	Bindings: Env;
}>();

// Stats card: /api/github-readme-stats/api
githubReadmeStatsRouter.get('/api', async (c) => {
	const {
		username,
		hide,
		hide_title,
		hide_border,
		card_width,
		hide_rank,
		show_icons,
		include_all_commits,
		line_height,
		title_color,
		ring_color,
		icon_color,
		text_color,
		text_bold,
		bg_color,
		theme,
		cache_seconds,
		exclude_repo,
		custom_title,
		locale,
		disable_animations,
		border_radius,
		number_format,
		border_color,
		rank_icon,
		show,
	} = c.req.query();

	c.header('Content-Type', 'image/svg+xml');

	if (blacklist.includes(username ?? '')) {
		return c.body(
			renderError('Something went wrong', 'This username is blacklisted', {
				title_color,
				text_color,
				bg_color,
				border_color,
				theme,
			}),
		);
	}

	if (locale && !isLocaleAvailable(locale)) {
		return c.body(
			renderError('Something went wrong', 'Language not found', {
				title_color,
				text_color,
				bg_color,
				border_color,
				theme,
			}),
		);
	}

	try {
		const showStats = parseArray(show);
		// Data key must cover every arg fetchStats receives, incl. `show`
		const dataKey = `stats:${username}:${include_all_commits}:${exclude_repo}:${showStats.join(',')}`;
		const stats = await microCache(dataKey, () =>
			fetchStats(
				username ?? '',
				parseBoolean(include_all_commits),
				parseArray(exclude_repo),
				showStats.includes('prs_merged') || showStats.includes('prs_merged_percentage'),
				showStats.includes('discussions_started'),
				showStats.includes('discussions_answered'),
				c.env,
			),
		);

		let cacheSeconds = clampValue(
			Number.parseInt(cache_seconds || String(CONSTANTS.CARD_CACHE_SECONDS), 10),
			CONSTANTS.TWELVE_HOURS,
			CONSTANTS.TWO_DAY,
		);
		cacheSeconds = c.env.CACHE_SECONDS
			? Number.parseInt(c.env.CACHE_SECONDS, 10) || cacheSeconds
			: cacheSeconds;

		c.header(
			'Cache-Control',
			`max-age=${cacheSeconds}, s-maxage=${cacheSeconds}, stale-while-revalidate=${CONSTANTS.ONE_DAY}`,
		);

		// Normalize all visual params (Layer 4)
		const normalizedParams = normalizeParams({
			hide,
			hide_title,
			hide_border,
			card_width,
			hide_rank,
			show_icons,
			include_all_commits,
			line_height,
			title_color,
			ring_color,
			icon_color,
			text_color,
			text_bold,
			bg_color,
			theme,
			custom_title,
			locale,
			disable_animations,
			border_radius,
			number_format,
			border_color,
			rank_icon,
			show,
		});

		// Stable SVG cache key (Layer 3)
		const svgKey = `stats-svg:${dataKey}:${JSON.stringify(normalizedParams)}`;

		const svg = await svgCacheGetOrSet(svgKey, () =>
			renderStatsCard(stats, {
				hide: parseArray(hide),
				show_icons: parseBoolean(show_icons),
				hide_title: parseBoolean(hide_title),
				hide_border: parseBoolean(hide_border),
				card_width: Number.parseInt(card_width ?? '', 10),
				hide_rank: parseBoolean(hide_rank),
				include_all_commits: parseBoolean(include_all_commits),
				line_height,
				title_color,
				ring_color,
				icon_color,
				text_color,
				text_bold: parseBoolean(text_bold),
				bg_color,
				theme,
				custom_title,
				border_radius,
				border_color,
				number_format,
				locale: locale ? locale.toLowerCase() : null,
				disable_animations: parseBoolean(disable_animations),
				rank_icon,
				show: parseArray(show),
			}),
		);
		return c.body(svg);
	} catch (err) {
		c.header(
			'Cache-Control',
			`max-age=${CONSTANTS.ERROR_CACHE_SECONDS / 2}, s-maxage=${CONSTANTS.ERROR_CACHE_SECONDS}, stale-while-revalidate=${CONSTANTS.ONE_DAY}`,
		);
		const error = err as Error;
		return c.body(
			renderError(error.message || 'Something went wrong', (error as any).secondaryMessage, {
				title_color,
				text_color,
				bg_color,
				border_color,
				theme,
			}),
		);
	}
});

// Top languages card: /api/github-readme-stats/api/top-langs/
githubReadmeStatsRouter.get('/api/top-langs/', async (c) => {
	const {
		username,
		hide,
		hide_title,
		hide_border,
		card_width,
		title_color,
		text_color,
		bg_color,
		theme,
		cache_seconds,
		layout,
		langs_count,
		exclude_repo,
		size_weight,
		count_weight,
		custom_title,
		locale,
		border_radius,
		border_color,
		disable_animations,
		hide_progress,
	} = c.req.query();

	c.header('Content-Type', 'image/svg+xml');

	if (blacklist.includes(username ?? '')) {
		return c.body(
			renderError('Something went wrong', 'This username is blacklisted', {
				title_color,
				text_color,
				bg_color,
				border_color,
				theme,
			}),
		);
	}

	if (locale && !isLocaleAvailable(locale)) {
		return c.body(renderError('Something went wrong', 'Locale not found'));
	}

	if (
		layout !== undefined &&
		(typeof layout !== 'string' ||
			!['compact', 'normal', 'donut', 'donut-vertical', 'pie'].includes(layout))
	) {
		return c.body(renderError('Something went wrong', 'Incorrect layout input'));
	}

	try {
		// Data key must cover every arg fetchTopLanguages receives
		const dataKey = `toplangs:${username}:${exclude_repo}:${size_weight}:${count_weight}`;
		const topLangs = await microCache(dataKey, () =>
			fetchTopLanguages(
				username ?? '',
				parseArray(exclude_repo),
				Number.parseInt(size_weight ?? '', 10) || 1,
				Number.parseInt(count_weight ?? '', 10) || 0,
				c.env,
			),
		);

		let cacheSeconds = clampValue(
			Number.parseInt(cache_seconds || String(CONSTANTS.TOP_LANGS_CACHE_SECONDS), 10),
			CONSTANTS.TWO_DAY,
			CONSTANTS.TEN_DAY,
		);
		cacheSeconds = c.env.CACHE_SECONDS
			? Number.parseInt(c.env.CACHE_SECONDS, 10) || cacheSeconds
			: cacheSeconds;

		c.header(
			'Cache-Control',
			`max-age=${86400}, s-maxage=${86400}, stale-while-revalidate=${86400}`,
		);

		// Normalize visual params (prevents cache explosion)
		const normalizedParams = normalizeParams({
			hide,
			hide_title,
			hide_border,
			card_width,
			title_color,
			text_color,
			bg_color,
			theme,
			layout,
			langs_count,
			custom_title,
			locale,
			border_radius,
			border_color,
			disable_animations,
			hide_progress,
		});
		const svgKey = `toplangs-svg:${dataKey}:${JSON.stringify(normalizedParams)}`;
		const svg = await svgCacheGetOrSet(svgKey, () =>
			renderTopLanguages(topLangs, {
				custom_title,
				hide_title: parseBoolean(hide_title),
				hide_border: parseBoolean(hide_border),
				card_width: Number.parseInt(card_width ?? '', 10),
				hide: parseArray(hide),
				title_color,
				text_color,
				bg_color,
				theme,
				layout,
				langs_count: Number.parseInt(langs_count ?? '', 10),
				border_radius,
				border_color,
				locale: locale ? locale.toLowerCase() : null,
				disable_animations: parseBoolean(disable_animations),
				hide_progress: parseBoolean(hide_progress),
			}),
		);

		return c.body(svg);
	} catch (err) {
		c.header(
			'Cache-Control',
			`max-age=${CONSTANTS.ERROR_CACHE_SECONDS * 60}, s-maxage=${CONSTANTS.ERROR_CACHE_SECONDS}, stale-while-revalidate=${CONSTANTS.ONE_DAY}`,
		);
		const error = err as Error;
		return c.body(
			renderError(error.message || 'Something went wrong', (error as any).secondaryMessage, {
				title_color,
				text_color,
				bg_color,
				border_color,
				theme,
			}),
		);
	}
});

// Streak card: /api/github-readme-stats/api/streak
githubReadmeStatsRouter.get('/api/streak', async (c) => {
	const { username, theme, hide_border, title_color, text_color, bg_color, border_color } =
		c.req.query();

	c.header('Content-Type', 'image/svg+xml');

	if (!username) {
		return c.body(
			renderError('Something went wrong', 'Missing `username` parameter', {
				title_color,
				text_color,
				bg_color,
				border_color,
				theme,
			}),
		);
	}

	try {
		const token = getNextToken(c.env);
		if (!token) {
			return c.body(
				renderError('Something went wrong', 'GitHub token is not configured', {
					title_color,
					text_color,
					bg_color,
					border_color,
					theme,
				}),
			);
		}

		const dataKey = `streak:${username}`;
		const streak = await microCache(dataKey, () => fetchStreak(username, token, c.env));

		// Streaks are pinned to a fixed 1 hour CDN cache; `cache_seconds` is
		// deliberately not honoured here.
		c.header('Cache-Control', `max-age=${3600}, s-maxage=${3600}, stale-while-revalidate=${3600}`);

		const normalizedParams = normalizeParams({
			theme,
			hide_border,
			title_color,
			text_color,
			bg_color,
			border_color,
		});
		const svgKey = `streak-svg:${dataKey}:${JSON.stringify(normalizedParams)}`;
		const svg = await svgCacheGetOrSet(svgKey, () =>
			renderStreakCard(username, streak, {
				theme,
				hide_border: parseBoolean(hide_border),
				title_color,
				text_color,
				bg_color,
				border_color,
			}),
		);
		return c.body(svg);
	} catch (err) {
		c.header(
			'Cache-Control',
			`max-age=${CONSTANTS.ERROR_CACHE_SECONDS / 2}, s-maxage=${CONSTANTS.ERROR_CACHE_SECONDS}, stale-while-revalidate=${CONSTANTS.ONE_DAY}`,
		);
		const error = err as Error;
		return c.body(
			renderError(error.message || 'Something went wrong', (error as any).secondaryMessage, {
				title_color,
				text_color,
				bg_color,
				border_color,
				theme,
			}),
		);
	}
});

// Pin card: /api/github-readme-stats/api/pin/
githubReadmeStatsRouter.get('/api/pin/', async (c) => {
	const {
		username,
		repo,
		hide_border,
		title_color,
		icon_color,
		text_color,
		bg_color,
		theme,
		show_owner,
		cache_seconds,
		locale,
		border_radius,
		border_color,
		description_lines_count,
	} = c.req.query();

	c.header('Content-Type', 'image/svg+xml');

	if (blacklist.includes(username ?? '')) {
		return c.body(
			renderError('Something went wrong', 'This username is blacklisted', {
				title_color,
				text_color,
				bg_color,
				border_color,
				theme,
			}),
		);
	}

	if (locale && !isLocaleAvailable(locale)) {
		return c.body(
			renderError('Something went wrong', 'Language not found', {
				title_color,
				text_color,
				bg_color,
				border_color,
				theme,
			}),
		);
	}

	try {
		const dataKey = `pin:${username}/${repo}`;
		const repoData = await microCache(dataKey, () => fetchRepo(username ?? '', repo ?? '', c.env));

		let cacheSeconds = clampValue(
			Number.parseInt(cache_seconds || String(CONSTANTS.PIN_CARD_CACHE_SECONDS), 10),
			CONSTANTS.ONE_DAY,
			CONSTANTS.TEN_DAY,
		);
		cacheSeconds = c.env.CACHE_SECONDS
			? Number.parseInt(c.env.CACHE_SECONDS, 10) || cacheSeconds
			: cacheSeconds;

		c.header(
			'Cache-Control',
			`max-age=${604800}, s-maxage=${604800}, stale-while-revalidate=${604800}`,
		);

		const normalizedParams = normalizeParams({
			hide_border,
			title_color,
			icon_color,
			text_color,
			bg_color,
			theme,
			border_radius,
			border_color,
			show_owner,
			locale,
			description_lines_count,
		});
		const svgKey = `pin-svg:${dataKey}:${JSON.stringify(normalizedParams)}`;
		const svg = await svgCacheGetOrSet(svgKey, () =>
			renderRepoCard(repoData, {
				hide_border: parseBoolean(hide_border),
				title_color,
				icon_color,
				text_color,
				bg_color,
				theme,
				border_radius,
				border_color,
				show_owner: parseBoolean(show_owner),
				locale: locale ? locale.toLowerCase() : null,
				description_lines_count: Number.parseInt(description_lines_count ?? '', 10),
			}),
		);
		return c.body(svg);
	} catch (err) {
		c.header(
			'Cache-Control',
			`max-age=${CONSTANTS.ERROR_CACHE_SECONDS / 2}, s-maxage=${CONSTANTS.ERROR_CACHE_SECONDS}, stale-while-revalidate=${CONSTANTS.ONE_DAY}`,
		);
		const error = err as Error;
		return c.body(
			renderError(error.message, error.secondaryMessage, {
				title_color,
				text_color,
				bg_color,
				border_color,
				theme,
			}),
		);
	}
});
