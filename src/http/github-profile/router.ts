import { Hono } from 'hono';
import { currentProjectsLoader } from '../../home/current/loader';
import { PROJECT_ROSTER } from '../../home/current/roster';
import { notionProjects } from '../../portfolio/notion/reader';
import { microCache } from '../../vendor/github-readme-stats-fast/common/microCache.ts';
import { fetchStats } from '../../vendor/github-readme-stats-fast/fetchers/stats.ts';
import { fetchStreak } from '../../vendor/github-readme-stats-fast/fetchers/streak-fetcher.ts';
import { fetchTopLanguages } from '../../vendor/github-readme-stats-fast/fetchers/top-languages.ts';
import { getNextToken, stringEnv } from '../github-readme-stats/router';
import { rateLimitRead } from '../middleware/rate-limit';
import { methodNotAllowed } from '../validation';
import { renderActivityMobileSvg, renderActivitySvg } from './activity';
import {
	type BandStats,
	composeBand1Model,
	composeBand2Model,
	renderBand1Svg,
	renderBand2Svg,
} from './bands';
import { renderProfileCardSvg } from './card';
import { renderCurrentSvg } from './current';
import { embedWorkMedia } from './media-embed';
import { composeProfileCardModel } from './model';
import { type NowStats, renderProfileNowMobileSvg, renderProfileNowSvg } from './now';
import { renderPresenceSvg } from './presence';
import { renderStackSvg } from './stack';
import { renderProfileStatusSvg } from './status';

/**
 * GitHub profile router — `/api/v1/github-profile/*`
 * (Issue #1170 / #1196, ADR-0024 / ADR-0025).
 *
 * Routes:
 *   GET /api/v1/github-profile/card   the single-image "business card"
 *                                     (Issue #1170, ADR-0024).
 *                                     DEPRECATED by ADR-0025: the
 *                                     profile README no longer embeds
 *                                     it; kept serving unchanged until
 *                                     the deprecation window closes.
 *   GET /api/v1/github-profile/status the dynamic status strip the
 *                                     redesigned README's "Now"
 *                                     section embeds (Issue #1196,
 *                                     ADR-0025): GitHub activity +
 *                                     Discord presence, no raster
 *                                     media, a few KB.
 *
 * Data sources (all already-public projections):
 *   - D1 `github_activity_snapshot` / `discord_presence_snapshot`
 *     payloads, re-validated by this boundary's own ingest schemas
 *     (`../activity/schema`, `../presence/schema`);
 *   - `home/current/roster.ts` — the committed current-projects
 *     roster — for the `/now` IN PROGRESS panel only (the single
 *     file-scoped `http -> home` exception, Issue #1205);
 *   - `notionProjects()` — the committed, reviewed public portfolio
 *     snapshot — for the work covers. Covers are NOT linked: an SVG
 *     delivered through `<img>` cannot load external subresources, so
 *     `embedWorkMedia` reads the R2 objects and inlines them as
 *     `data:` URIs under a byte budget (ADR-0024 §2.3).
 *
 * Failure behaviour: the endpoint answers 200 with a card in EVERY
 * data state. Missing / invalid / stale inputs render their honest
 * "unavailable" / "stale" variants inside the image — a broken feed
 * degrades the picture, it never 5xxs the README.
 *
 * Caching: `public, max-age=300, s-maxage=300` satisfies the
 * shared-cache isolation opt-in (`../middleware/cache-policy.ts`).
 * GitHub Camo proxies this URL for README viewers; the in-image
 * observation timestamps keep a cached copy honest (ADR-0024 §2.4).
 */

export const githubProfileRouter = new Hono<{ Bindings: Env }>();

const CARD_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';
// The status strip is the README's only dynamic image: same freshness
// window, smaller payload, same honest-state contract (ADR-0025 §2.3).
const STATUS_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';
// The unified "now" strip mixes hourly GitHub stats with the live
// activity/presence snapshots: the GitHub half is cached upstream for
// an hour, this response revalidates every 5 minutes like `/status`.
const NOW_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';
// The redesign's split surfaces update on the same snapshot cadence
// as `/status` but cache independently: activity data and presence
// never share a response, so one stale source cannot stall the other.
const ACTIVITY_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';
const PRESENCE_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';
// The in-progress card is composed entirely from committed data
// (roster + git facts + committed activity projection), so it only
// revalidates on the same cadence as the other profile surfaces.
const CURRENT_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';
const NOW_OWNER_LOGIN = 'rebuildup';

interface ProfileSnapshotEnv {
	DB?: D1Database;
	MEDIA?: R2Bucket;
	DISCORD_PRESENCE_USER_ID?: string;
}

async function readActivityPayload(db: D1Database | undefined): Promise<unknown> {
	if (!db) return null;
	try {
		// Literal table names: the D1 binding gate refuses interpolated SQL.
		const row = await db
			.prepare('SELECT payload FROM github_activity_snapshot WHERE id = 1')
			.first<{ payload: string }>();
		return typeof row?.payload === 'string' ? JSON.parse(row.payload) : null;
	} catch {
		return null;
	}
}

async function readPresencePayload(db: D1Database | undefined): Promise<unknown> {
	if (!db) return null;
	try {
		const row = await db
			.prepare('SELECT payload FROM discord_presence_snapshot WHERE id = 1')
			.first<{ payload: string }>();
		return typeof row?.payload === 'string' ? JSON.parse(row.payload) : null;
	} catch {
		return null;
	}
}

interface ProfileSnapshotRow {
	activityPayload: unknown;
	presencePayload: unknown;
}

async function readProfileSnapshots(env: ProfileSnapshotEnv): Promise<ProfileSnapshotRow> {
	const [activityPayload, presencePayload] = await Promise.all([
		readActivityPayload(env.DB),
		readPresencePayload(env.DB),
	]);
	return { activityPayload, presencePayload };
}

githubProfileRouter.get('/card', rateLimitRead, async (c) => {
	const env = c.env as unknown as ProfileSnapshotEnv;
	const { activityPayload, presencePayload } = await readProfileSnapshots(env);
	const model = composeProfileCardModel({
		activityPayload,
		presencePayload,
		expectedPresenceUserId: env.DISCORD_PRESENCE_USER_ID,
		now: Date.now(),
		projects: notionProjects(),
	});
	const works = await embedWorkMedia(model.works, env.MEDIA);
	const svg = renderProfileCardSvg({ ...model, works });
	return c.body(svg, 200, {
		'Content-Type': 'image/svg+xml; charset=utf-8',
		'Cache-Control': CARD_CACHE_CONTROL,
		// RFC 8594 deprecation signal (ADR-0025 §2.4): the README no
		// longer references this endpoint; it stays up unchanged until
		// the removal release.
		Deprecation: 'true',
	});
});

async function fetchStreakCached(env: Env) {
	const stringEnvView = stringEnv(env);
	return microCache(`now-streak:${NOW_OWNER_LOGIN}`, async () => {
		const token = getNextToken(stringEnvView);
		if (!token) return null;
		try {
			return await fetchStreak(NOW_OWNER_LOGIN, token, stringEnvView);
		} catch {
			return null;
		}
	});
}

async function fetchTopLangsCached(env: Env) {
	const stringEnvView = stringEnv(env);
	return microCache(`now-toplangs:${NOW_OWNER_LOGIN}`, async () => {
		try {
			return await fetchTopLanguages(NOW_OWNER_LOGIN, [], 1, 0, stringEnvView);
		} catch {
			return null;
		}
	});
}

async function fetchNowStats(env: Env): Promise<NowStats> {
	const [streak, topLangs] = await Promise.all([fetchStreakCached(env), fetchTopLangsCached(env)]);

	let topLanguage: NowStats['topLanguage'] = null;
	if (topLangs) {
		const entries = Object.values(topLangs);
		const total = entries.reduce((sum, entry) => sum + entry.size, 0);
		const top = entries.sort((a, b) => b.size - a.size)[0];
		if (top && total > 0) {
			topLanguage = { name: top.name, pct: Math.round((top.size / total) * 100) };
		}
	}

	return {
		totalContributions: streak?.totalContributions ?? null,
		currentStreak: streak?.currentStreak ?? null,
		longestStreak: streak?.longestStreak ?? null,
		topLanguage,
	};
}

/**
 * Band 1 vitals data (Issue #1216): streak + contributed-to + rank
 * from the vendored readme-stats fetchers, full language breakdown
 * for the ratio bar. Shares the `now-*` micro-cache keys with
 * `/now` so both surfaces hit GitHub once per window; a failed
 * upstream yields `null` fields that render the honest `—` variant.
 */
async function fetchBandStats(env: Env): Promise<BandStats> {
	const stringEnvView = stringEnv(env);
	const [streak, stats, topLangs] = await Promise.all([
		fetchStreakCached(env),
		microCache(`band-stats:${NOW_OWNER_LOGIN}`, async () => {
			try {
				return await fetchStats(NOW_OWNER_LOGIN, false, [], false, false, false, stringEnvView);
			} catch {
				return null;
			}
		}),
		fetchTopLangsCached(env),
	]);

	let langs: BandStats['topLangs'] = null;
	if (topLangs) {
		const entries = Object.values(topLangs);
		const total = entries.reduce((sum, entry) => sum + entry.size, 0);
		if (total > 0) {
			langs = entries
				.map((entry) => ({
					name: entry.name,
					pct: Math.round((entry.size / total) * 1000) / 10,
					color: entry.color ?? '#8b949e',
				}))
				.sort((a, b) => b.pct - a.pct)
				.slice(0, 10);
		}
	}

	return {
		currentStreak: streak?.currentStreak ?? null,
		longestStreak: streak?.longestStreak ?? null,
		totalContributions: streak?.totalContributions ?? null,
		contributedTo: stats?.contributedTo ?? null,
		rankLevel: stats?.rank.level ?? null,
		rankPercentile: stats?.rank.percentile ?? null,
		topLangs: langs,
		totalStars: stats?.totalStars ?? null,
		totalCommits: stats?.totalCommits ?? null,
		totalPRs: stats?.totalPRs ?? null,
		totalIssues: stats?.totalIssues ?? null,
	};
}

// The band surfaces are the README's primary visual assets: same
// freshness contract as `/now`, theme/layout selected by query.
const BANDS_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';

/**
 * The owner's GitHub avatar, inlined as a `data:` URI for the Band 1
 * identity header and presence card. `github.com/<login>.png`
 * resolves to the current avatar (redirect to avatars.githubusercontent);
 * any failure yields `null` and the band renders without a portrait —
 * never a placeholder glyph.
 */
async function fetchAvatarDataUri(env: Env): Promise<string | null> {
	return microCache(`band-avatar:${NOW_OWNER_LOGIN}`, async () => {
		try {
			const res = await fetch(`https://github.com/${NOW_OWNER_LOGIN}.png`, {
				signal: AbortSignal.timeout(5000),
			});
			const type = res.headers.get('content-type') ?? '';
			if (!res.ok || !type.startsWith('image/')) return null;
			const buf = await res.arrayBuffer();
			if (buf.byteLength === 0 || buf.byteLength > 512 * 1024) return null;
			const bytes = new Uint8Array(buf);
			let bin = '';
			for (let i = 0; i < bytes.length; i += 0x8000) {
				bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
			}
			return `data:${type.split(';')[0]};base64,${btoa(bin)}`;
		} catch {
			return null;
		}
	});
}

githubProfileRouter.get('/identity', rateLimitRead, async (c) => {
	const env = c.env as unknown as ProfileSnapshotEnv & Env;
	const { activityPayload, presencePayload } = await readProfileSnapshots(env);
	const now = Date.now();
	const [model, stats, avatarDataUri] = await Promise.all([
		Promise.resolve(
			composeProfileCardModel({
				activityPayload,
				presencePayload,
				expectedPresenceUserId: env.DISCORD_PRESENCE_USER_ID,
				now,
				projects: [],
			}),
		),
		fetchBandStats(env),
		fetchAvatarDataUri(env),
	]);
	const theme = c.req.query('theme') === 'light' ? 'light' : 'dark';
	const mobile = c.req.query('layout') === 'mobile';
	const svg = renderBand1Svg(
		composeBand1Model({
			theme,
			mobile,
			model,
			stats,
			avatarDataUri,
			now,
		}),
	);
	return c.body(svg, 200, {
		'Content-Type': 'image/svg+xml; charset=utf-8',
		'Cache-Control': BANDS_CACHE_CONTROL,
	});
});

githubProfileRouter.get('/activity-map', rateLimitRead, async (c) => {
	const env = c.env as unknown as ProfileSnapshotEnv;
	const activityPayload = await readActivityPayload(env.DB);
	const now = Date.now();
	const theme = c.req.query('theme') === 'light' ? 'light' : 'dark';
	const mobile = c.req.query('layout') === 'mobile';
	const svg = renderBand2Svg(composeBand2Model({ theme, mobile, activityPayload, now }));
	return c.body(svg, 200, {
		'Content-Type': 'image/svg+xml; charset=utf-8',
		'Cache-Control': BANDS_CACHE_CONTROL,
	});
});

githubProfileRouter.get('/stack', rateLimitRead, async (c) => {
	const theme = c.req.query('theme') === 'light' ? 'light' : 'dark';
	const mobile = c.req.query('layout') === 'mobile';
	const svg = renderStackSvg({ theme, mobile });
	return c.body(svg, 200, {
		'Content-Type': 'image/svg+xml; charset=utf-8',
		// Static committed icon set — cache longer than the data bands.
		'Cache-Control': 'public, max-age=3600, s-maxage=3600',
	});
});

githubProfileRouter.get('/now', rateLimitRead, async (c) => {
	const env = c.env as unknown as ProfileSnapshotEnv & Env;
	const { activityPayload, presencePayload } = await readProfileSnapshots(env);
	const [model, stats] = await Promise.all([
		Promise.resolve(
			composeProfileCardModel({
				activityPayload,
				presencePayload,
				expectedPresenceUserId: env.DISCORD_PRESENCE_USER_ID,
				now: Date.now(),
				projects: [],
			}),
		),
		fetchNowStats(env),
	]);
	const projects = PROJECT_ROSTER.map((project) => project.name);
	// `?layout=mobile` serves the stacked variant used by the README's
	// <picture><source media> swap on narrow viewports.
	const svg =
		c.req.query('layout') === 'mobile'
			? renderProfileNowMobileSvg(model, stats, projects)
			: renderProfileNowSvg(model, stats, projects);
	return c.body(svg, 200, {
		'Content-Type': 'image/svg+xml; charset=utf-8',
		'Cache-Control': NOW_CACHE_CONTROL,
	});
});

githubProfileRouter.get('/status', rateLimitRead, async (c) => {
	const env = c.env as unknown as ProfileSnapshotEnv;
	const { activityPayload, presencePayload } = await readProfileSnapshots(env);
	const model = composeProfileCardModel({
		activityPayload,
		presencePayload,
		expectedPresenceUserId: env.DISCORD_PRESENCE_USER_ID,
		now: Date.now(),
		// Works are not part of the status strip; skip the portfolio
		// projection entirely.
		projects: [],
	});
	const svg = renderProfileStatusSvg(model);
	return c.body(svg, 200, {
		'Content-Type': 'image/svg+xml; charset=utf-8',
		'Cache-Control': STATUS_CACHE_CONTROL,
	});
});

githubProfileRouter.get('/activity', rateLimitRead, async (c) => {
	const env = c.env as unknown as ProfileSnapshotEnv;
	const activityPayload = await readActivityPayload(env.DB);
	// `?layout=mobile` serves the stacked single-column variant that the
	// README's <picture><source media> swap uses on narrow viewports —
	// the 840px two-column card is unreadable at ~0.43x on a phone.
	const svg =
		c.req.query('layout') === 'mobile'
			? renderActivityMobileSvg(activityPayload)
			: renderActivitySvg(activityPayload);
	return c.body(svg, 200, {
		'Content-Type': 'image/svg+xml; charset=utf-8',
		'Cache-Control': ACTIVITY_CACHE_CONTROL,
	});
});

githubProfileRouter.get('/presence', rateLimitRead, async (c) => {
	const env = c.env as unknown as ProfileSnapshotEnv;
	const presencePayload = await readPresencePayload(env.DB);
	const model = composeProfileCardModel({
		activityPayload: null,
		presencePayload,
		expectedPresenceUserId: env.DISCORD_PRESENCE_USER_ID,
		now: Date.now(),
		projects: [],
	});
	const svg = renderPresenceSvg(model);
	return c.body(svg, 200, {
		'Content-Type': 'image/svg+xml; charset=utf-8',
		'Cache-Control': PRESENCE_CACHE_CONTROL,
	});
});

githubProfileRouter.get('/current', rateLimitRead, async (c) => {
	// Same `today` convention as the site route: the UTC calendar day
	// the derived project facts are computed against.
	const today = new Date().toISOString().slice(0, 10);
	const records = await currentProjectsLoader.loadCurrentProjects(today);
	const svg = renderCurrentSvg(records, today);
	return c.body(svg, 200, {
		'Content-Type': 'image/svg+xml; charset=utf-8',
		'Cache-Control': CURRENT_CACHE_CONTROL,
	});
});

githubProfileRouter.all('/card', methodNotAllowed(['GET']));
githubProfileRouter.all('/status', methodNotAllowed(['GET']));
githubProfileRouter.all('/now', methodNotAllowed(['GET']));
githubProfileRouter.all('/activity', methodNotAllowed(['GET']));
githubProfileRouter.all('/presence', methodNotAllowed(['GET']));
githubProfileRouter.all('/current', methodNotAllowed(['GET']));
githubProfileRouter.all('/identity', methodNotAllowed(['GET']));
githubProfileRouter.all('/activity-map', methodNotAllowed(['GET']));
githubProfileRouter.all('/stack', methodNotAllowed(['GET']));
