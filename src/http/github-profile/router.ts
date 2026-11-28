import { Hono } from 'hono';
import { currentProjectsLoader } from '../../home/current/loader';
import { PROJECT_ROSTER } from '../../home/current/roster';
import { notionProjects } from '../../portfolio/notion/reader';
import { rateLimitRead } from '../middleware/rate-limit';
import { methodNotAllowed } from '../validation';
import { renderActivityMobileSvg, renderActivitySvg } from './activity';
import {
	type BandStats,
	composeBand1Model,
	composeBand2Model,
	renderBand1Svg,
	renderBand2Svg,
	renderTopLangsSvg,
	renderVitalsSvg,
} from './bands';
import { renderProfileCardSvg } from './card';
import { renderCurrentSvg } from './current';
import { embedWorkMedia } from './media-embed';
import { composeProfileCardModel } from './model';
import { type NowStats, renderProfileNowMobileSvg, renderProfileNowSvg } from './now';
import { renderPresenceSvg } from './presence';
import { renderProfileSvg } from './profile';
import { type SnapshotRow, buildSnapshotHealth } from './snapshot-health';
import { renderStackSvg } from './stack';
import {
	avatarFromSnapshot,
	bandStatsFromSnapshot,
	nowStatsFromSnapshot,
	parseStatsSnapshot,
} from './stats-source';
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
 * Data sources (all already-public projections, ALL from D1 since
 * Issue #1244 — no request-time GitHub API call remains on this
 * router):
 *   - D1 `github_activity_snapshot` / `discord_presence_snapshot` /
 *     `github_stats_snapshot` payloads, re-validated by this
 *     boundary's own ingest schemas (`../activity/schema`,
 *     `../presence/schema`, `../stats/schema` via `./stats-source`);
 *     the stats row is written by the async
 *     `scripts/sync-github-stats.mjs --push` pipeline;
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
// The unified "now" strip mixes stats-snapshot figures with the live
// activity/presence snapshots: every input is a D1 row (Issue #1244 —
// no request-time upstream call remains), so this response revalidates
// every 5 minutes like `/status`.
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

async function readStatsPayload(db: D1Database | undefined): Promise<unknown> {
	if (!db) return null;
	try {
		// Literal table names: the D1 binding gate refuses interpolated SQL.
		const row = await db
			.prepare('SELECT payload FROM github_stats_snapshot WHERE id = 1')
			.first<{ payload: string }>();
		return typeof row?.payload === 'string' ? JSON.parse(row.payload) : null;
	} catch {
		return null;
	}
}

/**
 * Per-source snapshot freshness rows for `/snapshot-health`
 * (Issue #1254). Literal table names — the D1 binding gate refuses
 * interpolated SQL, so each spec's table is queried by name here.
 */
async function readSnapshotHealthRows(db: D1Database | undefined): Promise<SnapshotRow[]> {
	if (!db) return [];
	interface SnapshotDbRow {
		payload: string;
		received_at: string;
	}
	const read = async (
		source: string,
		statement: Promise<SnapshotDbRow | null>,
	): Promise<SnapshotRow> => {
		try {
			const row = await statement;
			return {
				source,
				receivedAt: typeof row?.received_at === 'string' ? row.received_at : null,
				payload: typeof row?.payload === 'string' ? safeJsonParse(row.payload) : null,
			};
		} catch {
			return { source, receivedAt: null, payload: null };
		}
	};
	return Promise.all([
		read(
			'github-activity',
			db
				.prepare('SELECT payload, received_at FROM github_activity_snapshot WHERE id = 1')
				.first<SnapshotDbRow>(),
		),
		read(
			'github-stats',
			db
				.prepare('SELECT payload, received_at FROM github_stats_snapshot WHERE id = 1')
				.first<SnapshotDbRow>(),
		),
		read(
			'discord-presence',
			db
				.prepare('SELECT payload, received_at FROM discord_presence_snapshot WHERE id = 1')
				.first<SnapshotDbRow>(),
		),
	]);
}

function safeJsonParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * Band 1 vitals + avatar data (Issue #1244): the `github_stats_snapshot`
 * row, written by the async `scripts/sync-github-stats.mjs --push`
 * pipeline. NO request-time GitHub call remains on this router — an
 * absent / invalid snapshot yields all-`null` fields that render the
 * honest `—` variant.
 */
async function readBandStats(
	db: D1Database | undefined,
): Promise<{ stats: BandStats; avatarDataUri: string | null }> {
	const snapshot = parseStatsSnapshot(await readStatsPayload(db));
	return {
		stats: bandStatsFromSnapshot(snapshot),
		avatarDataUri: avatarFromSnapshot(snapshot),
	};
}

/** `/now` stats half — same snapshot, narrower projection. */
async function readNowStats(db: D1Database | undefined): Promise<NowStats> {
	return nowStatsFromSnapshot(parseStatsSnapshot(await readStatsPayload(db)));
}

// The band surfaces are the README's primary visual assets: same
// freshness contract as `/now`, theme/layout selected by query.
const BANDS_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';

githubProfileRouter.get('/identity', rateLimitRead, async (c) => {
	const env = c.env as unknown as ProfileSnapshotEnv;
	const { activityPayload, presencePayload } = await readProfileSnapshots(env);
	const now = Date.now();
	const [model, band] = await Promise.all([
		Promise.resolve(
			composeProfileCardModel({
				activityPayload,
				presencePayload,
				expectedPresenceUserId: env.DISCORD_PRESENCE_USER_ID,
				now,
				projects: [],
			}),
		),
		readBandStats(env.DB),
	]);
	const theme = c.req.query('theme') === 'light' ? 'light' : 'dark';
	const mobile = c.req.query('layout') === 'mobile';
	const grid = c.req.query('grid') === '1';
	const svg = renderBand1Svg(
		composeBand1Model({
			theme,
			mobile,
			model,
			stats: band.stats,
			avatarDataUri: band.avatarDataUri,
			now,
		}),
		{ grid },
	);
	return c.body(svg, 200, {
		'Content-Type': 'image/svg+xml; charset=utf-8',
		'Cache-Control': BANDS_CACHE_CONTROL,
	});
});

/**
 * The composed profile — identity + activity + stack as ONE SVG
 * (Issue #1235 round 2): the README's visual sections share a
 * single canvas, spine and rhythm instead of stacking three
 * independent bands. The legacy `/identity` `/activity-map`
 * `/stack` endpoints keep serving their standalone fragments.
 */
githubProfileRouter.get('/profile', rateLimitRead, async (c) => {
	const env = c.env as unknown as ProfileSnapshotEnv;
	const { activityPayload, presencePayload } = await readProfileSnapshots(env);
	const now = Date.now();
	const [model, band] = await Promise.all([
		Promise.resolve(
			composeProfileCardModel({
				activityPayload,
				presencePayload,
				expectedPresenceUserId: env.DISCORD_PRESENCE_USER_ID,
				now,
				projects: [],
			}),
		),
		readBandStats(env.DB),
	]);
	const theme = c.req.query('theme') === 'light' ? 'light' : 'dark';
	const mobile = c.req.query('layout') === 'mobile';
	const grid = c.req.query('grid') === '1';
	const band1 = composeBand1Model({
		theme,
		mobile,
		model,
		stats: band.stats,
		avatarDataUri: band.avatarDataUri,
		now,
	});
	const band2 = composeBand2Model({ theme, mobile, activityPayload, now });
	const svg = renderProfileSvg({ theme, mobile, band1, band2, grid });
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
	const grid = c.req.query('grid') === '1';
	const svg = renderBand2Svg(composeBand2Model({ theme, mobile, activityPayload, now }), {
		grid,
	});
	return c.body(svg, 200, {
		'Content-Type': 'image/svg+xml; charset=utf-8',
		'Cache-Control': BANDS_CACHE_CONTROL,
	});
});

githubProfileRouter.get('/stack', rateLimitRead, async (c) => {
	const theme = c.req.query('theme') === 'light' ? 'light' : 'dark';
	const mobile = c.req.query('layout') === 'mobile';
	// `?grid=1` draws the layout contract (margins, columns, baseline,
	// type legend) onto the artifact — review/preview use only.
	const grid = c.req.query('grid') === '1';
	const svg = renderStackSvg({ theme, mobile, grid });
	return c.body(svg, 200, {
		'Content-Type': 'image/svg+xml; charset=utf-8',
		// Static committed icon set — cache longer than the data bands.
		'Cache-Control': 'public, max-age=3600, s-maxage=3600',
	});
});

/**
 * Per-domain stats surfaces (Issue #1244, contract §7): VITALS and
 * TOP LANGUAGES each render one slice of `github_stats_snapshot` on
 * their own canvas — independent cache entries, independent honest
 * degradation, and payloads small enough for a README to compose
 * selectively. Both answer 200 in every data state like the other
 * profile surfaces.
 */
githubProfileRouter.get('/vitals', rateLimitRead, async (c) => {
	const env = c.env as unknown as ProfileSnapshotEnv;
	const band = await readBandStats(env.DB);
	const theme = c.req.query('theme') === 'light' ? 'light' : 'dark';
	const mobile = c.req.query('layout') === 'mobile';
	const grid = c.req.query('grid') === '1';
	const svg = renderVitalsSvg({ theme, mobile, stats: band.stats }, { grid });
	return c.body(svg, 200, {
		'Content-Type': 'image/svg+xml; charset=utf-8',
		'Cache-Control': BANDS_CACHE_CONTROL,
	});
});

githubProfileRouter.get('/top-languages', rateLimitRead, async (c) => {
	const env = c.env as unknown as ProfileSnapshotEnv;
	const band = await readBandStats(env.DB);
	const theme = c.req.query('theme') === 'light' ? 'light' : 'dark';
	const mobile = c.req.query('layout') === 'mobile';
	const grid = c.req.query('grid') === '1';
	const svg = renderTopLangsSvg({ theme, mobile, stats: band.stats }, { grid });
	return c.body(svg, 200, {
		'Content-Type': 'image/svg+xml; charset=utf-8',
		'Cache-Control': BANDS_CACHE_CONTROL,
	});
});

githubProfileRouter.get('/now', rateLimitRead, async (c) => {
	const env = c.env as unknown as ProfileSnapshotEnv;
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
		readNowStats(env.DB),
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

githubProfileRouter.get('/snapshot-health', rateLimitRead, async (c) => {
	const env = c.env as unknown as ProfileSnapshotEnv;
	const rows = await readSnapshotHealthRows(env.DB);
	// `no-store`: this endpoint IS the freshness probe — a cached
	// answer would let a stale snapshot look fresh to the smoke.
	return c.json(buildSnapshotHealth(rows, Date.now()), 200, {
		'Cache-Control': 'no-store',
	});
});

githubProfileRouter.all('/card', methodNotAllowed(['GET']));
githubProfileRouter.all('/status', methodNotAllowed(['GET']));
githubProfileRouter.all('/now', methodNotAllowed(['GET']));
githubProfileRouter.all('/activity', methodNotAllowed(['GET']));
githubProfileRouter.all('/presence', methodNotAllowed(['GET']));
githubProfileRouter.all('/current', methodNotAllowed(['GET']));
githubProfileRouter.all('/identity', methodNotAllowed(['GET']));
githubProfileRouter.all('/profile', methodNotAllowed(['GET']));
githubProfileRouter.all('/activity-map', methodNotAllowed(['GET']));
githubProfileRouter.all('/vitals', methodNotAllowed(['GET']));
githubProfileRouter.all('/top-languages', methodNotAllowed(['GET']));
githubProfileRouter.all('/stack', methodNotAllowed(['GET']));
githubProfileRouter.all('/snapshot-health', methodNotAllowed(['GET']));
