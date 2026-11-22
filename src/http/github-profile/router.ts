import { Hono } from 'hono';
import { notionProjects } from '../../portfolio/notion/reader';
import { rateLimitRead } from '../middleware/rate-limit';
import { methodNotAllowed } from '../validation';
import { renderProfileCardSvg } from './card';
import { embedWorkMedia } from './media-embed';
import { composeProfileCardModel } from './model';

/**
 * GitHub profile card router — `/api/v1/github-profile/*`
 * (Issue #1170, ADR-0024).
 *
 * Routes:
 *   GET /api/v1/github-profile/card  the single-image "business card"
 *                                    the `rebuildup/rebuildup` profile
 *                                    README embeds. SVG, dark fixed
 *                                    surface, real portfolio covers +
 *                                    GitHub activity / Discord
 *                                    presence snapshots with their
 *                                    observation times drawn inside.
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

githubProfileRouter.get('/card', rateLimitRead, async (c) => {
	const env = c.env as unknown as ProfileSnapshotEnv;
	const [activityPayload, presencePayload] = await Promise.all([
		readActivityPayload(env.DB),
		readPresencePayload(env.DB),
	]);
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
	});
});

githubProfileRouter.all('/card', methodNotAllowed(['GET']));
