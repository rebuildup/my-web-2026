/**
 * GitHub Readme Stats router for my-web-2026.
 *
 * Self-hosted implementation of Pranesh-2005/github-readme-stats-fast endpoints.
 * Provides SVG cards for: stats, top-langs, streak, pin.
 *
 * Routes:
 *   GET /api/github-readme-stats/api
 *   GET /api/github-readme-stats/api/top-langs/
 *   GET /api/github-readme-stats/api/streak
 *   GET /api/github-readme-stats/api/pin/?repo=...
 *
 * Issue #1164: the service is personal-fixed. `username` is always
 * `rebuildup`, visual/layout/locale parameters are ignored, and the
 * only accepted input is `repo` on the pin card. Rendered SVGs are
 * kept in the persistent `svg-store` (Cache API) and served
 * stale-while-revalidate: a stored card is returned immediately and a
 * background refresh replaces it, so an upstream GitHub API outage can
 * no longer surface as a broken image once a card has rendered once.
 *
 * Upstream: https://github.com/Pranesh-2005/github-readme-stats-fast
 * Commit: 8e2c76e59a9e2407f2c80f4e23704a04e8db21ad
 * License: MIT
 */

import { type Context, Hono } from 'hono';
import { renderRepoCard } from '../../vendor/github-readme-stats-fast/cards/repo.ts';
import { renderStatsCard } from '../../vendor/github-readme-stats-fast/cards/stats.ts';
import { renderStreakCard } from '../../vendor/github-readme-stats-fast/cards/streak-card.ts';
import { renderTopLanguages } from '../../vendor/github-readme-stats-fast/cards/top-languages.ts';
import { microCache } from '../../vendor/github-readme-stats-fast/common/microCache.ts';
import { svgCacheGetOrSet } from '../../vendor/github-readme-stats-fast/common/svgCache.ts';
import {
	CONSTANTS,
	CustomError,
	MissingParamError,
	renderError,
} from '../../vendor/github-readme-stats-fast/common/utils.ts';
import { fetchRepo } from '../../vendor/github-readme-stats-fast/fetchers/repo.ts';
import { fetchStats } from '../../vendor/github-readme-stats-fast/fetchers/stats.ts';
import { fetchStreak } from '../../vendor/github-readme-stats-fast/fetchers/streak-fetcher.ts';
import { fetchTopLanguages } from '../../vendor/github-readme-stats-fast/fetchers/top-languages.ts';
import { rateLimitRead } from '../middleware/rate-limit';
import { svgStoreMatch, svgStorePut } from './svg-store.ts';

/** The only GitHub login this service renders cards for (Issue #1164). */
const OWNER_LOGIN = 'rebuildup';

/** GitHub repo names are `[A-Za-z0-9._-]`; bounded so a hostile `repo`
 * value cannot become an arbitrary upstream path segment. */
const REPO_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

type HonoContext = Context<{ Bindings: Env }>;

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

/**
 * The vendored fetchers only read string env vars (`GITHUB_README_STATS_PAT_*`,
 * `GITHUB_TOKEN`, `CACHE_SECONDS`). `Env` also carries bindings (D1, R2, …)
 * that are not strings, so the router hands the vendor a plain string view.
 */
function stringEnv(env: Env): Record<string, string | undefined> {
	const out: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(env)) {
		if (typeof value === 'string') out[key] = value;
	}
	return out;
}

/**
 * CustomError types that describe a *per-request* condition (the requested
 * repo does not exist) rather than service degradation. Every other
 * CustomError — missing token, upstream API/GraphQL failure, rate-limit
 * retry exhaustion, or a dynamically-typed upstream error — means the
 * service is degraded and must surface as HTTP 503 so it is never
 * presented as a normal statistics card.
 */
const PER_REQUEST_ERROR_TYPES = new Set([CustomError.USER_NOT_FOUND]);

function isServiceUnavailable(err: unknown): boolean {
	return err instanceof CustomError && !PER_REQUEST_ERROR_TYPES.has(err.type);
}

/**
 * Issue #996: only a CustomError's message is authored copy safe to
 * render into the public SVG. Any other throw (fetch internals, D1,
 * vendor bugs) carries an implementation message that must not reach
 * a public document, so it collapses to the fixed fallback.
 */
function publicErrorMessage(err: unknown): string {
	// CustomError and MissingParamError carry authored messages meant for
	// the card; every other throw is an internal failure whose message
	// must not reach a public document.
	if (
		(err instanceof CustomError || err instanceof MissingParamError) &&
		typeof err.message === 'string' &&
		err.message.length > 0
	) {
		return err.message;
	}
	return 'Something went wrong';
}

type CardThemeParams = {
	title_color?: string;
	text_color?: string;
	bg_color?: string;
	border_color?: string;
	theme?: string;
};

/**
 * Degraded-state contract: upstream/config failures return 503 with a
 * short-lived cache header so CDN/embed layers do not pin an outage as a
 * normal card. The body stays image/svg+xml so <img> consumers still get
 * an image-shaped response.
 */
function degradedResponse(
	c: {
		body: (body: string | null, status?: number) => Response;
		header: (name: string, value: string) => void;
	},
	params: CardThemeParams,
): Response {
	c.header('Cache-Control', 'max-age=60, s-maxage=60');
	return c.body(
		renderError('Service unavailable', 'Statistics are temporarily unavailable', params),
		503,
	);
}

/** One background refresh per card key per isolate. */
const refreshesInFlight = new Set<string>();

/**
 * Stale-while-revalidate over the persistent SVG store (Issue #1164).
 *
 * - Stored card present: return it immediately. When it is older than
 *   `freshSeconds`, kick off one background refresh via
 *   `executionCtx.waitUntil` (or await it when no ExecutionContext is
 *   available, e.g. unit tests) so the next request sees fresh bytes.
 * - No stored card: render live, persist, return. A render failure with
 *   no stored card falls through to the error mapping — there is
 *   nothing older to serve.
 *
 * `Cache-Control` carries `public` + a positive lifetime, which is the
 * explicit shared-cache opt-in `sharedCacheIsolation` honours (same
 * contract as `GET /api/v1/reaction-images/:id`), so camo and CDNs may
 * hold the card instead of re-fetching on every profile view.
 */
async function serveCard(
	c: HonoContext,
	options: {
		storeName: string;
		freshSeconds: number;
		render: () => string | Promise<string>;
		themeParams: CardThemeParams;
	},
): Promise<Response> {
	const { storeName, freshSeconds, render, themeParams } = options;
	c.header('Content-Type', 'image/svg+xml');

	const cacheControl = `public, max-age=${freshSeconds}, s-maxage=${freshSeconds}, stale-while-revalidate=${CONSTANTS.ONE_DAY}`;
	const cached = await svgStoreMatch(storeName);

	if (cached) {
		if (
			Date.now() - cached.renderedAt >= freshSeconds * 1000 &&
			!refreshesInFlight.has(storeName)
		) {
			refreshesInFlight.add(storeName);
			const refresh = (async () => {
				try {
					const svg = await render();
					await svgStorePut(storeName, svg);
				} catch {
					// Keep serving the stale card; the next request retries.
				} finally {
					refreshesInFlight.delete(storeName);
				}
			})();
			// Hono throws when the context carries no ExecutionContext
			// (unit tests call `router.fetch(req, env)` without one).
			let ctx: { waitUntil?: (p: Promise<unknown>) => void } | undefined;
			try {
				ctx = c.executionCtx as typeof ctx;
			} catch {
				ctx = undefined;
			}
			if (ctx && typeof ctx.waitUntil === 'function') {
				ctx.waitUntil(refresh);
			} else {
				await refresh;
			}
		}
		c.header('Cache-Control', cacheControl);
		return c.body(cached.svg);
	}

	try {
		const svg = await render();
		await svgStorePut(storeName, svg);
		c.header('Cache-Control', cacheControl);
		return c.body(svg);
	} catch (err) {
		if (isServiceUnavailable(err)) {
			return degradedResponse(c, themeParams);
		}
		c.header(
			'Cache-Control',
			`max-age=${CONSTANTS.ERROR_CACHE_SECONDS / 2}, s-maxage=${CONSTANTS.ERROR_CACHE_SECONDS}, stale-while-revalidate=${CONSTANTS.ONE_DAY}`,
		);
		const error = err as Error;
		return c.body(
			renderError(
				publicErrorMessage(err),
				(error as { secondaryMessage?: string }).secondaryMessage,
				themeParams,
			),
		);
	}
}

export const githubReadmeStatsRouter = new Hono<{
	Bindings: Env;
}>();

// Stats card: /api/github-readme-stats/api
githubReadmeStatsRouter.get('/api', rateLimitRead, async (c) => {
	// Issue #1164: personal-fixed — query params are ignored entirely.
	return serveCard(c, {
		storeName: 'card:stats',
		freshSeconds: CONSTANTS.CARD_CACHE_SECONDS,
		themeParams: {},
		render: async () => {
			const env = stringEnv(c.env);
			// Data fetch goes through microCache + svgCache so concurrent
			// requests share one upstream call and one render per isolate.
			const stats = await microCache(`stats:${OWNER_LOGIN}`, () =>
				fetchStats(OWNER_LOGIN, false, [], false, false, false, env),
			);
			return svgCacheGetOrSet(`stats-svg:${OWNER_LOGIN}`, async () => renderStatsCard(stats));
		},
	});
});

// Top languages card: /api/github-readme-stats/api/top-langs/
githubReadmeStatsRouter.get('/api/top-langs/', rateLimitRead, async (c) => {
	// Issue #1164: personal-fixed — the card is always the compact
	// layout the profile README embeds.
	return serveCard(c, {
		storeName: 'card:top-langs',
		freshSeconds: CONSTANTS.CARD_CACHE_SECONDS,
		themeParams: {},
		render: async () => {
			const env = stringEnv(c.env);
			const topLangs = await microCache(`toplangs:${OWNER_LOGIN}`, () =>
				fetchTopLanguages(OWNER_LOGIN, [], 1, 0, env),
			);
			return svgCacheGetOrSet(`toplangs-svg:${OWNER_LOGIN}`, async () =>
				renderTopLanguages(topLangs, { layout: 'compact' }),
			);
		},
	});
});

// Streak card: /api/github-readme-stats/api/streak
githubReadmeStatsRouter.get('/api/streak', rateLimitRead, async (c) => {
	return serveCard(c, {
		storeName: 'card:streak',
		freshSeconds: 3600,
		themeParams: {},
		render: async () => {
			const env = stringEnv(c.env);
			const token = getNextToken(env);
			if (!token) {
				throw new CustomError('GitHub token not configured', CustomError.NO_TOKENS);
			}
			const streak = await microCache(`streak:${OWNER_LOGIN}`, () =>
				fetchStreak(OWNER_LOGIN, token, env),
			);
			return svgCacheGetOrSet(`streak-svg:${OWNER_LOGIN}`, async () =>
				renderStreakCard(OWNER_LOGIN, streak),
			);
		},
	});
});

// Pin card: /api/github-readme-stats/api/pin/?repo=...
githubReadmeStatsRouter.get('/api/pin/', rateLimitRead, async (c) => {
	const { repo } = c.req.query();

	if (!repo || !REPO_NAME_PATTERN.test(repo)) {
		c.header('Content-Type', 'image/svg+xml');
		return c.body(renderError('Something went wrong', 'Missing or invalid `repo` parameter', {}));
	}

	// Issue #1164: personal-fixed — `show_owner` is always on, matching
	// the profile README embeds.
	return serveCard(c, {
		storeName: `card:pin:${repo}`,
		freshSeconds: CONSTANTS.PIN_CARD_CACHE_SECONDS,
		themeParams: {},
		render: async () => {
			const env = stringEnv(c.env);
			const repoData = await microCache(`pin:${OWNER_LOGIN}/${repo}`, () =>
				fetchRepo(OWNER_LOGIN, repo, env),
			);
			return svgCacheGetOrSet(`pin-svg:${OWNER_LOGIN}/${repo}`, async () =>
				renderRepoCard(repoData, { show_owner: true }),
			);
		},
	});
});
