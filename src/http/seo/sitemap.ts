/**
 * XML sitemap document builder — payload of `GET /sitemap.xml` and
 * `GET /robots.txt` (Issue #420).
 *
 * Ownership
 * ---------
 * The crawler-facing SEO contract lives at the external HTTP boundary
 * because that is the only layer in this deployment that can answer
 * with a non-HTML document: TanStack Start 1.168 has no raw-response
 * route primitive (see ADR-0002 §"Re-evaluation triggers" — the
 * first-class HTTP-route primitive that would change this decision
 * has not shipped yet), so the sitemap is served by the Hono router
 * in `./router.ts` and reached through the prefix list in
 * `src/server.ts`.
 *
 * Module contract
 * ---------------
 * This file is deliberately **dependency-free** (no imports at all):
 *
 *   1. it is pure, so it can be unit-tested without workerd, D1, or
 *      the Worker bundle, and
 *   2. it is importable from a plain `node --test` script, which is
 *      the only runtime in this repo that can read
 *      `src/routeTree.gen.ts` (the workerd pool sandboxes
 *      `node:fs` to the bundle, see `src/http/seo/coverage` usage in
 *      `scripts/check-sitemap-route-coverage.test.mjs`).
 *
 * Because it cannot import the portfolio schema, the slug grammar it
 * enforces is declared here and drift against
 * `SLUG_REGEX` (`src/portfolio/schema.ts`) is asserted by
 * `src/http/seo/sitemap.test.ts`.
 *
 * Publication rules (what may and may not appear in the document)
 * ----------------------------------------------------------------
 *   - Only routes that exist in `src/routeTree.gen.ts` are listed.
 *     The coverage guard (`scripts/check-sitemap-route-coverage.test.mjs`)
 *     fails the build when a route exists that this inventory does
 *     not classify, so "a new page silently missing from the sitemap"
 *     is a test failure, not a crawl-time surprise.
 *   - Only `status='published' AND visibility='public'` portfolio
 *     rows are listed. Draft / unlisted / archived projects — and any
 *     slug that 404s — never reach the document, because the filter
 *     lives in the portfolio obligation
 *     (`PortfolioLoader.listPublishedProjectIndex`), not here.
 *   - Every `<loc>` is the page's canonical URL. `SITEMAP_ENTRIES`
 *     therefore mirrors the `rel="canonical"` each route declares in
 *     its `head()`; `/` and `/tools` gained the canonical they were
 *     missing in the same ticket so that claim holds for every entry.
 *   - Routes that are intentionally absent carry an explicit reason
 *     in `SITEMAP_EXCLUSIONS` (`/admin/*` is authenticated,
 *     `/tools/$slug` declares `robots: noindex` in its own head).
 *
 * Language (多言語)
 * ------------------
 * Every public route serves one document language — `lang="ja"` in
 * `src/routes/__root.tsx` — so every entry declares exactly one
 * `xhtml:link rel="alternate" hreflang="ja"` self-reference. That is
 * the "日本語URLで単体完了" (complete on its own in Japanese) state the
 * issue asks for: when locale-prefixed routes land, an entry grows one
 * alternate per locale and the hreflang graph becomes reciprocal by
 * construction, because the alternates are derived from the same entry
 * that produced the `<loc>`.
 */

/**
 * Canonical production origin (ADR-0014). This is the only place in
 * the SEO surface that states the origin; route `head()`s carry their
 * own canonical literals today, and the coverage guard keeps the two
 * in step.
 */
export const SITEMAP_ORIGIN = 'https://rebuildup.dev';

/**
 * Document language of every public route. Mirrors
 * `<html lang="ja">` in `src/routes/__root.tsx`.
 */
export const SITEMAP_LOCALE = 'ja';

/** Path the sitemap document is served at. */
export const SITEMAP_PATH = '/sitemap.xml';

/** Path the crawler policy document is served at. */
export const ROBOTS_PATH = '/robots.txt';

/** sitemaps.org change-frequency vocabulary. */
export type SitemapChangeFreq =
	| 'always'
	| 'hourly'
	| 'daily'
	| 'weekly'
	| 'monthly'
	| 'yearly'
	| 'never';

/**
 * One public, indexable, canonical route.
 *
 * `reason` is required: a reviewer must be able to read why a page is
 * (or is not) advertised to crawlers without opening the route.
 */
export interface SitemapStaticEntry {
	/** Route path exactly as the router spells it (no trailing slash, except `/`). */
	readonly path: string;
	readonly changefreq: SitemapChangeFreq;
	/** Relative crawl priority, `0.0`–`1.0`. */
	readonly priority: number;
	/** Why this page belongs in a public sitemap. */
	readonly reason: string;
}

/**
 * Public static inventory.
 *
 * Membership rule: a page belongs here when it is (a) reachable
 * without authentication, (b) not declared `robots: noindex` by its
 * own `head()`, and (c) linked from the public nav
 * (`PUBLIC_NAV_ITEMS` in `src/editorial/nav/PublicNav.tsx`). Rule
 * (c) is asserted by `src/http/seo/sitemap.test.ts`, which is what
 * makes "a new public page silently missing from the sitemap" a test
 * failure rather than a crawl-time surprise.
 *
 * `/design-system` is a deliberate inclusion: it is a public,
 * canonical, nav-linked showcase page and hiding it only makes it an
 * orphan.
 */
export const SITEMAP_ENTRIES: readonly SitemapStaticEntry[] = [
	{
		path: '/',
		changefreq: 'weekly',
		priority: 1.0,
		reason: 'Platform entry — public, canonical, first item of the public nav.',
	},
	{
		path: '/portfolio',
		changefreq: 'weekly',
		priority: 0.9,
		reason: 'Public index of published work — the primary discovery surface.',
	},
	{
		path: '/about',
		changefreq: 'monthly',
		priority: 0.7,
		reason: 'Profile page — static narrative, public nav destination.',
	},
	{
		path: '/contact',
		changefreq: 'yearly',
		priority: 0.5,
		reason: 'Static contact channel list — public nav destination.',
	},
	{
		path: '/tools',
		changefreq: 'monthly',
		priority: 0.6,
		reason: 'Public index of integrated Tools. The per-Tool shell pages are excluded separately.',
	},
	{
		path: '/design-system',
		changefreq: 'monthly',
		priority: 0.4,
		reason: 'Public editorial-visual-language showcase — canonical, nav-linked, not noindex.',
	},
];

/**
 * A route family whose URLs are generated per entity instead of being
 * listed one by one.
 */
export interface SitemapDynamicRoute {
	/** Router template, e.g. `/portfolio/$slug`. */
	readonly template: string;
	/** Human-readable source of the segments. */
	readonly reason: string;
}

/** Route families covered dynamically, one `<url>` per entity. */
export const SITEMAP_DYNAMIC_ROUTES: readonly SitemapDynamicRoute[] = [
	{
		template: '/portfolio/$slug',
		reason: 'One <url> per public+published portfolio project, emitted from the D1 project index.',
	},
];

/** A route (or route family) deliberately kept out of the document. */
export interface SitemapExclusion {
	readonly route: string;
	/**
	 * `route` — exact router template (`/tools/$slug`).
	 * `prefix` — the route and everything below it (`/admin`).
	 */
	readonly kind: 'route' | 'prefix';
	readonly reason: string;
}

/**
 * Routes that must never appear in the document. Every entry carries a
 * reason so the exclusion is a reviewable decision, not an omission.
 */
export const SITEMAP_EXCLUSIONS: readonly SitemapExclusion[] = [
	{
		route: '/admin',
		kind: 'prefix',
		reason:
			'Authenticated admin surface (keys / images / invitations / emoji catalog). Listing it advertises an operator-only surface and every entry is a guaranteed redirect to /admin/login for anyone else.',
	},
	{
		route: '/tools/$slug',
		kind: 'route',
		reason:
			'The Tool iframe shell declares `robots: noindex` in its own route head. A sitemap entry would contradict the page it points at.',
	},
];

/**
 * Path-segment grammar for generated URLs.
 *
 * Intentionally identical to `SLUG_REGEX` in `src/portfolio/schema.ts`
 * (asserted by `src/http/seo/sitemap.test.ts`). Re-checking the
 * segment here — instead of trusting the caller — is what keeps a
 * malformed slug (and therefore a guaranteed 404) out of the
 * document even if a future query path widens.
 */
export const SITEMAP_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;

/** Minimal project reference the sitemap needs from the portfolio obligation. */
export interface SitemapProjectRef {
	readonly slug: string;
	/** Epoch milliseconds (`portfolio_project.updated_at`). */
	readonly updatedAt: number;
}

/** One `<url>` block. */
export interface SitemapUrl {
	/** Absolute canonical URL. */
	readonly loc: string;
	/** W3C datetime of the last content change, when it is known. */
	readonly lastmod?: string;
	readonly changefreq?: SitemapChangeFreq;
	readonly priority?: number;
	/** Reciprocal hreflang set for this URL. */
	readonly alternates: ReadonlyArray<{ readonly hreflang: string; readonly href: string }>;
}

/**
 * Join an origin and an absolute path. `origin` never carries a
 * trailing slash; paths always start with `/`.
 */
export function absoluteUrl(path: string, origin: string = SITEMAP_ORIGIN): string {
	const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;
	return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * W3C datetime for an epoch-millisecond value, or `undefined` when the
 * value is not a usable timestamp. A missing / nonsensical `lastmod` is
 * omitted rather than guessed — a fabricated modification date is worse
 * than none.
 */
export function toW3cDateTime(epochMs: number): string | undefined {
	if (typeof epochMs !== 'number' || !Number.isFinite(epochMs) || epochMs < 0) return undefined;
	const iso = new Date(epochMs).toISOString();
	// W3C datetime accepts seconds + optional fractional part; drop the
	// milliseconds so the document is byte-stable across requests that
	// land in the same second.
	return iso.replace(/\.\d{3}Z$/, 'Z');
}

/** XML text / attribute escaping for the five predefined entities. */
export function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/**
 * Build the `<url>` set for the public surface.
 *
 * Static entries come first, in declared (curated) order; generated
 * portfolio entries follow, most recently updated first with the slug
 * as a deterministic tiebreaker. Duplicates collapse to the first
 * occurrence, so a hand-written static entry can never be shadowed by a
 * generated one.
 */
export function buildSitemapUrls(
	projects: readonly SitemapProjectRef[] = [],
	origin: string = SITEMAP_ORIGIN,
): SitemapUrl[] {
	const urls: SitemapUrl[] = [];
	const seen = new Set<string>();

	const push = (url: SitemapUrl) => {
		if (seen.has(url.loc)) return;
		seen.add(url.loc);
		urls.push(url);
	};

	for (const entry of SITEMAP_ENTRIES) {
		const loc = absoluteUrl(entry.path, origin);
		push({
			loc,
			changefreq: entry.changefreq,
			priority: entry.priority,
			alternates: [{ hreflang: SITEMAP_LOCALE, href: loc }],
		});
	}

	// Only slugs the route grammar accepts can resolve; anything else
	// would be a 404 in the document, so it is dropped here and the
	// caller is expected to fix the data source.
	const usable = projects
		.filter((project) => SITEMAP_SEGMENT_PATTERN.test(project.slug))
		.slice()
		.sort((a, b) => {
			if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
			return a.slug.localeCompare(b.slug);
		});

	for (const project of usable) {
		const loc = absoluteUrl(`/portfolio/${project.slug}`, origin);
		const lastmod = toW3cDateTime(project.updatedAt);
		push({
			loc,
			...(lastmod ? { lastmod } : {}),
			changefreq: 'monthly',
			priority: 0.8,
			alternates: [{ hreflang: SITEMAP_LOCALE, href: loc }],
		});
	}

	return urls;
}

/**
 * Render the sitemap document.
 *
 * Namespaces: the sitemaps.org schema plus the XHTML namespace that
 * `xhtml:link` alternates live in (Google's documented form for a
 * locale-aware sitemap).
 */
export function renderSitemapXml(
	projects: readonly SitemapProjectRef[] = [],
	origin: string = SITEMAP_ORIGIN,
): string {
	const lines: string[] = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
	];
	for (const url of buildSitemapUrls(projects, origin)) {
		lines.push('\t<url>');
		lines.push(`\t\t<loc>${escapeXml(url.loc)}</loc>`);
		if (url.lastmod) lines.push(`\t\t<lastmod>${escapeXml(url.lastmod)}</lastmod>`);
		if (url.changefreq) lines.push(`\t\t<changefreq>${escapeXml(url.changefreq)}</changefreq>`);
		if (typeof url.priority === 'number') {
			lines.push(`\t\t<priority>${url.priority.toFixed(1)}</priority>`);
		}
		for (const alternate of url.alternates) {
			lines.push(
				`\t\t<xhtml:link rel="alternate" hreflang="${escapeXml(alternate.hreflang)}" href="${escapeXml(alternate.href)}"/>`,
			);
		}
		lines.push('\t</url>');
	}
	lines.push('</urlset>');
	return `${lines.join('\n')}\n`;
}

/**
 * Render `robots.txt`.
 *
 * There is deliberately NO `Disallow` rule here.
 *
 * The admin subtree is de-indexed by the `robots: noindex, nofollow`
 * meta its own layout route declares (`src/routes/admin.tsx`), and a
 * meta is only read once the document has been FETCHED. Blocking the
 * crawl would therefore hide the `noindex` from the very crawler that
 * has to act on it: Google keeps the URL and reports "Indexed, though
 * blocked by robots.txt" — a worse outcome than either pure state. The
 * same rule keeps the `noindex` Tool shells crawlable.
 *
 * `robots.txt` is not the access control anyway: it is a public
 * document that `curl`, a browser or a scraper ignores. The admin
 * surface is protected by `requireAdmin()` in the child loaders and
 * server functions, which is also what makes a crawler fetching
 * `/admin` harmless — it gets the same redirect to `/admin/login` as
 * anyone else.
 *
 * The invariant is not just documented, it is enforced:
 * `scripts/_index-boundary.mjs` classifies every route's crawl / index
 * intent and fails the build (`noindex-blocked`,
 * `robots-overbroad-rule`, `indexable-blocked`) if a rule here ever
 * blocks a page that only its own `noindex` can de-index.
 */
export function renderRobotsTxt(origin: string = SITEMAP_ORIGIN): string {
	return [
		'User-agent: *',
		'Allow: /',
		'',
		'# No Disallow rules on purpose. /admin and /tools/$slug are',
		'# de-indexed by the `robots: noindex` meta the page itself',
		'# carries, and a blocked page can never deliver its own noindex.',
		'# This file is not access control either: requireAdmin() is.',
		'',
		`Sitemap: ${absoluteUrl(SITEMAP_PATH, origin)}`,
		'',
	].join('\n');
}
