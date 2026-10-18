import { Hono } from 'hono';
import { createAuditLogger } from '../../logging/logger';
import type { PortfolioEnv, PortfolioLoader } from '../../portfolio/contract';
import { createD1PortfolioLoader } from '../../portfolio/load';
import type { PortfolioProjectIndexEntry } from '../../portfolio/schema';
import { ROBOTS_PATH, SITEMAP_PATH, renderRobotsTxt, renderSitemapXml } from './sitemap';

/**
 * Crawler-facing SEO router — `GET /sitemap.xml` and
 * `GET /robots.txt` (Issue #420).
 *
 * Why the external boundary owns this
 * -----------------------------------
 * TanStack Start 1.168 has no raw-response route primitive: every
 * route renders through the document shell, so a route file cannot
 * answer with an XML body. Hono is therefore the only layer that can,
 * and ADR-0002 §2 already models it as the Worker-entry branch that
 * answers everything the SSR pipeline cannot. `/sitemap.xml` and
 * `/robots.txt` are registered in the `EXTERNAL_BOUNDARY_PREFIXES`
 * list in `src/server.ts` (exact-match entries), so they never reach
 * the SSR handler.
 *
 * Why the project list comes from the portfolio obligation
 * --------------------------------------------------------
 * The public-visibility filter (`status='published' AND
 * visibility='public'`) belongs to `src/portfolio`. This router asks
 * the loader for the index and renders it; it never restates the SQL
 * predicate, so a draft / unlisted / archived project cannot reach the
 * document even if the sitemap's own slug check were removed.
 *
 * Degradation
 * -----------
 * If the D1 read fails, the document is still served with the static
 * inventory only (logged, not silent) rather than 500-ing: a crawler
 * that sees a 5xx may drop the sitemap from its index, and the static
 * entries remain correct. The failure is never hidden — it is written
 * to the Worker log on every request.
 */

/** Source of the published-project rows the sitemap advertises. */
export type PublishedProjectSource = (env: Env) => Promise<readonly PortfolioProjectIndexEntry[]>;

/**
 * `public, max-age=300, must-revalidate` — a sitemap is cheap to
 * regenerate but should not be cached for hours: a newly published
 * project has to reach crawlers the same day.
 */
const SITEMAP_CACHE_CONTROL = 'public, max-age=300, must-revalidate';

const seoLogger = createAuditLogger('http.seo');

/**
 * Factory (DI seam). `loadProjects` defaults to the D1-backed
 * portfolio loader; tests hand it a fixture instead, which is the
 * pattern `src/portfolio/load.ts` and `src/home/reactions/load.ts`
 * already use. The visibility filter itself is never injected — it
 * lives in the loader, so a fake here cannot weaken the contract, only
 * bypass D1.
 */
export function createSeoRouter(loadProjects: PublishedProjectSource): Hono<{ Bindings: Env }> {
	const router = new Hono<{ Bindings: Env }>();

	router.get(SITEMAP_PATH, async (c) => {
		const projects = await loadProjects(c.env).catch((error: unknown) => {
			seoLogger.error('published project index failed', error);
			return [] as readonly PortfolioProjectIndexEntry[];
		});
		return c.body(renderSitemapXml(projects), 200, {
			'content-type': 'application/xml; charset=utf-8',
			'cache-control': SITEMAP_CACHE_CONTROL,
		});
	});

	router.get(ROBOTS_PATH, (c) =>
		c.body(renderRobotsTxt(), 200, {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': SITEMAP_CACHE_CONTROL,
		}),
	);

	return router;
}

/**
 * Production wiring: the D1-backed portfolio loader, resolved from the
 * request's real `Env` on every call (the DI seam used by
 * `src/portfolio/public.ts` — the generated `Env` and the hand-written
 * `PortfolioEnv` are different shapes, hence the cast).
 */
const seoRouter = createSeoRouter(async (env) => {
	const loader: PortfolioLoader = createD1PortfolioLoader(env as unknown as PortfolioEnv);
	return loader.listPublishedProjectIndex();
});

export { seoRouter };
