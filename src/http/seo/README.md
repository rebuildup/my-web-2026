# Crawler-facing SEO documents (`/sitemap.xml`, `/robots.txt`)

Issue #420. The public sitemap contract: **which URLs this site asks a
crawler to index, and how that set is proven.**

## Endpoints

### `GET /sitemap.xml`

`200 application/xml; charset=utf-8`,
`Cache-Control: public, max-age=300, must-revalidate`.

One `<url>` per public entry:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
	<url>
		<loc>https://rebuildup.dev/</loc>
		<changefreq>weekly</changefreq>
		<priority>1.0</priority>
		<xhtml:link rel="alternate" hreflang="ja" href="https://rebuildup.dev/"/>
	</url>
	<url>
		<loc>https://rebuildup.dev/portfolio/tastile</loc>
		<lastmod>2026-01-02T03:04:05Z</lastmod>
		<changefreq>monthly</changefreq>
		<priority>0.8</priority>
		<xhtml:link rel="alternate" hreflang="ja" href="https://rebuildup.dev/portfolio/tastile"/>
	</url>
</urlset>
```

### `GET /robots.txt`

`200 text/plain; charset=utf-8`, same cache policy.

```text
User-agent: *
Allow: /

# No Disallow rules on purpose: /admin and /tools/$slug are de-indexed
# by the `robots: noindex` meta the page itself carries, and a blocked
# page can never deliver its own noindex (Issue #423).

Sitemap: https://rebuildup.dev/sitemap.xml
```

## What may appear

| Source | Rule |
| --- | --- |
| Static entries (`SITEMAP_ENTRIES`) | public, not `noindex`, reachable from `PUBLIC_NAV_ITEMS`. |
| Portfolio detail (`SITEMAP_DYNAMIC_ROUTES`) | one `<url>` per `status='published' AND visibility='public'` row. |
| Everything else (`SITEMAP_EXCLUSIONS`) | excluded, each with a written reason. |

Draft / unlisted / archived projects never appear: the filter lives in
`PortfolioLoader.listPublishedProjectIndex` (`src/portfolio/`), so the
sitemap does not restate the SQL predicate. A slug the route grammar
would not resolve is dropped by the builder even if it reached it.

`<loc>` is always the page's canonical URL. `/` and `/tools` gained the
`rel="canonical"` they were missing in this ticket; the guard below
fails if any listed route stops declaring one.

## Language (多言語)

Every public route serves one document language (`<html lang="ja">`),
so every entry declares exactly one self-referencing
`xhtml:link rel="alternate" hreflang="ja"` — the "complete on its own
in Japanese" state the issue asks for. When locale-prefixed routes
land, an entry grows one alternate per locale; because the alternates
are derived from the same entry that produced the `<loc>`, the hreflang
graph stays reciprocal by construction.

## Guards (a sitemap must not drift silently)

| Guard | Runtime | Fails when |
| --- | --- | --- |
| `src/http/seo/sitemap.test.ts` | workerd (pure module) | the document shape, escaping, or `lastmod` derivation regresses; the slug grammar diverges from `SLUG_REGEX`; the inventory and `PUBLIC_NAV_ITEMS` disagree in either direction. |
| `src/http/seo/router.test.ts` | workerd (DI seam) | the HTTP contract (status / content type / cache / degradation) regresses. |
| `src/portfolio/load.test.ts` | workerd + real D1 | the public-visibility boundary of `listPublishedProjectIndex` regresses. |
| `scripts/check-sitemap-route-coverage.test.mjs` | `node --test` | a route exists in `src/routeTree.gen.ts` with no sitemap decision, an inventory entry is not a real route, or a listed URL is no longer the route's declared canonical. |

The last one runs in `pnpm run test` (therefore `validate:fast` and CI)
and is what makes "a new public page silently missing from the sitemap"
a build failure instead of a crawl-time surprise.
`scripts/check-test-wiring.mjs` fails if it is ever unwired.

## Why Hono serves these

TanStack Start 1.168 has no raw-response route primitive, so a route
file cannot answer with an XML body. These two paths are registered in
`EXTERNAL_BOUNDARY_PREFIXES` (`src/server.ts`) and handled by
`./router.ts` — the ADR-0002 re-evaluation trigger ("TanStack Start
ships a first-class HTTP-route primitive") is exactly when they move
back into `src/routes/`.

## Regenerating the verification screenshot

The committed screenshot has a committed, reviewable source (same
convention as Issue #452's D1 report):

```bash
pnpm run verify:sitemap-screenshot
# renders the REAL builder over the PORTFOLIO_SEED fixture, serves it
# as application/xml, and writes docs/verification/seo/sitemap-browser.webp
```

It runs offline (no `pnpm run dev`, so no Infisical dependency), reads
no secret, and touches no Cloudflare resource. Intermediate artefacts
stay in `.tmp/sitemap-verification/`; only the WebP is committed.