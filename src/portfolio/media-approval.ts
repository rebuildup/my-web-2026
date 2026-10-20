/**
 * Portfolio media publication approval for Worker delivery (Issue #634).
 *
 * The namespace gate (`src/cloudflare/media-visibility.ts`) answers
 * "may this class of key ever be public". This module answers the
 * second half for portfolio assets: **is this particular object
 * published right now**. The answer lives in D1 — a media row whose
 * project is `status = 'published' AND visibility = 'public'` — and
 * nowhere else. A key that no row names is not approved, so an object
 * left in the bucket after a project is unpublished stops being
 * servable the moment the row stops matching.
 *
 * Why a separate module instead of a server function
 * --------------------------------------------------
 * `src/portfolio/public.ts` is the public server-function surface and
 * imports `cloudflare:workers` at module scope. The media delivery
 * router runs on the Hono boundary, which must not take a dependency
 * on the server-function runtime just to ask one SQL question. This
 * module is plain D1 access with no binding import, so both callers
 * can share the rule and `src/http/media/**` stays testable with a
 * fake DB.
 *
 * The query is deliberately narrow: it returns a boolean, never a
 * row, so a caller cannot accidentally serialise a draft project's
 * title or slug into a delivery response.
 */

/**
 * True only when `key` names a media row of a published, public
 * project. Returns false for any key outside `portfolio/` — the
 * namespace gate refuses those anyway, and a second positive answer
 * here would be a bug, not a broader contract.
 */
export async function isPublishedPortfolioMediaKey(db: D1Database, key: string): Promise<boolean> {
	if (!key.startsWith('portfolio/')) return false;
	const row = await db
		.prepare(
			`SELECT 1 AS one
			 FROM portfolio_media AS media
			 INNER JOIN portfolio_project AS project ON project.id = media.project_id
			 WHERE media.r2_key = ?1
			   AND project.status = 'published'
			   AND project.visibility = 'public'
			 LIMIT 1`,
		)
		.bind(key)
		.first<{ one: number }>();
	return row?.one === 1;
}
