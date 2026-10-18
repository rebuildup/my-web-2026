# Verification artefacts — web

Screenshots and reproduction steps that back a verification claim in a
pull request. An image alone is not evidence: every entry records the
command, the URL and the expected result so a reviewer can re-run it.

## `robots-txt-browser.webp`

Chromium rendering of the **live** `/robots.txt` served by the local
Vite dev server (`@cloudflare/vite-plugin`), captured by
`scripts/shoot-robots-screenshot.mjs` (Playwright `chromium`,
1280×900 @2x, `sharp` → WebP q80 at 1600px wide).

- Issue: #423 — robots.txt / noindex boundary
- Path: `docs/verification/web/robots-txt-browser.webp`
  (the Issue names `.png`; the committed file is WebP to keep the
  repository light — same pixels, ~18 kB instead of ~250 kB)
- Document owner: `src/http/seo/sitemap.ts#renderRobotsTxt()` (Issue
  #420), reached at `/robots.txt` through the external HTTP boundary.
  The capture verifies the served body against that function's output,
  so the image can never show a policy the module does not produce.

### Reproduce

```bash
# 1. serve the Worker locally (any port you like)
pnpm exec vite dev --port 15923 --strictPort

# 2. the artefact itself: crawl instructions + the canonical sitemap
curl -i http://localhost:15923/robots.txt
#   -> HTTP/1.1 200 OK
#   -> Content-Type: text/plain; charset=utf-8
#   -> Sitemap: https://rebuildup.dev/sitemap.xml
#   -> no "Disallow: /" anywhere (a site-wide noindex would silently
#      de-index every public page)
#   -> no "Disallow: /admin" and no "Disallow: /tools" either: both
#      are de-indexed by the noindex meta their own pages carry, which
#      a blocked crawler could never read

# 3. the browser capture (writes the committed WebP directly)
pnpm run capture:robots
#   equivalent: node --experimental-strip-types \
#     scripts/shoot-robots-screenshot.mjs \
#     http://localhost:15923/robots.txt docs/verification/web/robots-txt-browser.webp
```

The generator refuses to write a capture that would be worthless: it
fails on a non-200 response AND when the rendered body differs from
`renderRobotsTxt()`.

### Expected result

The browser shows the rendered policy verbatim. The capture is
meaningless only if the bytes differ, so the same check runs in CI:

```bash
pnpm run index:boundary:check
node --experimental-strip-types --test scripts/check-index-boundary.test.mjs
```

Expected output of the gate:

```
index boundary OK: 15 routes (7 indexable), 6 sitemap entries, 0 Disallow rules, noindex meta on /admin, … @ https://rebuildup.dev
```

### Related runtime evidence (no image needed)

The HTML half of the boundary is asserted against the real Worker in
`test/integration/index-boundary.test.ts`:

```bash
pnpm exec vitest run test/integration/index-boundary.test.ts
```

- `GET /admin/login` (anonymous) renders
  `<meta name="robots" content="noindex, nofollow"/>`.
- `GET /contact` and `GET /design-system` render **no** `robots` meta.
- `GET /robots.txt` carries no `Disallow` for `/admin` or `/tools`,
  and one canonical `Sitemap:` line.
- `GET /sitemap.xml` advertises `/` and `/tools` and never `/admin` or
  a Tool shell.
- `GET /admin` and `GET /admin/keys` with a `Googlebot` User-Agent
  still 307 → `/admin/login` (robots.txt is not a gate).
- `GET /api/v1/access/count/home-page` without a key still answers 401.