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
import { rateLimitRead } from '../middleware/rate-limit';
import {
	loadStatsCardProjection,
	loadStreakCardData,
	loadTopLangsCardData,
} from './stats-card-source.ts';
import { svgStoreMatch, svgStorePut } from './svg-store.ts';

/** The only GitHub login this service renders cards for (Issue #1164). */
const OWNER_LOGIN = 'rebuildup';

/** GitHub repo names are `[A-Za-z0-9._-]`; bounded so a hostile `repo`
 * value cannot become an arbitrary upstream path segment. */
const REPO_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

type HonoContext = Context<{ Bindings: Env }>;

/**
 * The vendored fetchers only read string env vars (`GITHUB_README_STATS_PAT_*`,
 * `GITHUB_TOKEN`, `CACHE_SECONDS`). `Env` also carries bindings (D1, R2, …)
 * that are not strings, so the router hands the vendor a plain string view.
 */
export function stringEnv(env: Env): Record<string, string | undefined> {
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
 * Honest pre-sync card (Issue #1284): a valid SVG that says the
 * snapshot pipeline has not delivered its first payload yet — a
 * normal state, not an outage, so it answers 200 and is never
 * persisted to the SVG store (the next request re-renders and picks
 * up the snapshot the moment it lands). Detection of a stuck sync
 * belongs to `/snapshot-health`, not to the image status code.
 */
function unobservedCardSvg(title: string, subtitle: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="120" viewBox="0 0 495 120">
  <rect width="495" height="120" rx="4.5" fill="#fff" stroke="#d0d7de"/>
  <text x="24" y="50" font-family="Segoe UI,Ubuntu,Sans-Serif" font-size="16" font-weight="600" fill="#2f363d">${title}</text>
  <text x="24" y="72" font-family="Segoe UI,Ubuntu,Sans-Serif" font-size="12" fill="#57606a">${subtitle}</text>
</svg>`;
}

/**
 * Stale-while-revalidate over the persistent SVG store (Issue #1164).
 *
 * - Stored card present: return it immediately. When it is older than
 *   `freshSeconds`, kick off one background refresh via
 *   `executionCtx.waitUntil` (or await it when no ExecutionContext is
 *   available, e.g. unit tests) so the next request sees fresh bytes.
 * - No stored card: render live, persist, return. A render failure with
 *   no stored card falls through to the error mapping — there is
 *   nothing older to serve. Snapshot-driven cards may pass
 *   `unobservedSvg` to answer the snapshot-absent case with a valid
 *   pre-sync card instead of the degraded 503.
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
		/** Served (200, briefly cached, never stored) when the render
		 * fails with the snapshot-absent error — snapshot-driven cards
		 * only. Other degraded failures keep the 503 contract. */
		unobservedSvg?: string;
	},
): Promise<Response> {
	const { storeName, freshSeconds, render, themeParams, unobservedSvg } = options;
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
		if (
			unobservedSvg &&
			err instanceof CustomError &&
			err.type === CustomError.GITHUB_REST_API_ERROR
		) {
			c.header('Cache-Control', 'public, max-age=60, s-maxage=60');
			return c.body(unobservedSvg);
		}
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
		unobservedSvg: unobservedCardSvg(
			'Statistics not yet observed',
			'The first snapshot sync has not completed',
		),
		render: async () => {
			// Issue #1262 / ADR-0027: the card reads the async stats
			// snapshot (same source as `/api/v1/github-profile/vitals`)
			// instead of calling GitHub at request time. An absent
			// snapshot answers the honest pre-sync card (Issue #1284).
			const projection = await loadStatsCardProjection(c.env.DB);
			if (!projection) {
				throw new CustomError(
					'GitHub stats snapshot unavailable',
					CustomError.GITHUB_REST_API_ERROR,
				);
			}
			return svgCacheGetOrSet(`stats-svg:${OWNER_LOGIN}`, async () =>
				renderStatsCard(projection.stats, projection.options),
			);
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
		unobservedSvg: unobservedCardSvg(
			'Language stats not yet observed',
			'The first snapshot sync has not completed',
		),
		render: async () => {
			// Issue #1268 / ADR-0027: languages come from the async stats
			// snapshot (`languages.owned` — the same population the
			// request-time fetcher queried). An absent snapshot or an
			// unmeasured scope answers the pre-sync card (Issue #1284).
			const topLangs = await loadTopLangsCardData(c.env.DB);
			if (!topLangs) {
				throw new CustomError(
					'GitHub stats snapshot unavailable',
					CustomError.GITHUB_REST_API_ERROR,
				);
			}
			return svgCacheGetOrSet(`toplangs-svg:${OWNER_LOGIN}`, async () =>
				renderTopLanguages(topLangs, { layout: 'compact', disable_animations: true }),
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
		unobservedSvg: unobservedCardSvg(
			'Streak not yet observed',
			'The first snapshot sync has not completed',
		),
		render: async () => {
			// Issue #1268 / ADR-0027: streak comes from the async stats
			// snapshot — the same numbers `/api/v1/github-profile/vitals`
			// renders. An absent snapshot answers the pre-sync card.
			const streak = await loadStreakCardData(c.env.DB);
			if (!streak) {
				throw new CustomError(
					'GitHub stats snapshot unavailable',
					CustomError.GITHUB_REST_API_ERROR,
				);
			}
			return svgCacheGetOrSet(`streak-svg:${OWNER_LOGIN}`, async () =>
				renderStreakCard(OWNER_LOGIN, streak, { disable_animations: true }),
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
