import { Hono } from 'hono';
import { notionProjects } from '../../portfolio/notion/reader';
import { rateLimitRead } from '../middleware/rate-limit';
import { methodNotAllowed } from '../validation';
import { renderProfileCardSvg } from './card';
import { embedWorkMedia } from './media-embed';
import { composeProfileCardModel } from './model';
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
 *     (`../activity/schema`, `../presence/schema`) — `http` never
 *     imports `src/home/**`;
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

githubProfileRouter.all('/card', methodNotAllowed(['GET']));
githubProfileRouter.all('/status', methodNotAllowed(['GET']));
