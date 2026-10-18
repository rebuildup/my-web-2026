# Verification artefacts — web

Screenshots and reproduction steps that back a verification claim in a
pull request. An image alone is not evidence: every entry records the
command, the URL and the expected result so a reviewer can re-run it.

## `robots-txt-browser.webp`

Chromium rendering of the **live** `/robots.txt` served by the local
Vite dev server (`@cloudflare/vite-plugin`), captured with
`.tmp/shoot-robots.mjs` (Playwright `chromium`, 1280×900 @2x, then
`sharp` → WebP q80 at 1600px wide).

- Issue: #423 — robots.txt / secret-route index boundary
- Path: `docs/verification/web/robots-txt-browser.webp`
  (the Issue names `.png`; the committed file is WebP to keep the
  repository light — same pixels, ~68 kB instead of ~250 kB)

### Reproduce

```bash
# 1. serve the Worker locally (any port you like)
pnpm exec vite dev --port 15923 --strictPort

# 2. the artefact itself: crawl instructions + the canonical sitemap
curl -i http://localhost:15923/robots.txt
#   -> HTTP/1.1 200 OK
#   -> Content-Type: text/plain
#   -> Sitemap: https://rebuildup.dev/sitemap.xml
#   -> no "Disallow: /" anywhere (a site-wide noindex would silently
#      de-index every public page)

# 3. the browser capture (writes .tmp/robots-txt-browser.png)
node .tmp/shoot-robots.mjs http://localhost:15923/robots.txt .tmp/robots-txt-browser.png
node -e "require('sharp')('.tmp/robots-txt-browser.png').resize({width:1600,withoutEnlargement:true}).webp({quality:80}).toFile('docs/verification/web/robots-txt-browser.webp')"
```

`.tmp/shoot-robots.mjs` is intentionally **not** committed (`.tmp/` is
gitignored per AGENTS.md §9); it is 20 lines — navigate, assert the
response is 200, print `document.body.innerText`, screenshot — and is
reproduced by the three commands above.

### Expected result

The browser shows the committed file verbatim. The capture is
meaningless only if the bytes differ, so the same check runs in CI:

```bash
pnpm run index:boundary:check      # robots.txt / sitemap.xml vs the contract
node --test scripts/check-index-boundary.test.mjs
```

Expected output of the gate:

```
index boundary OK: 15 routes (7 indexable), 6 sitemap entries, 12 Disallow rules, noindex meta on /admin, … @ https://rebuildup.dev
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
- `GET /admin` and `GET /admin/keys` with a `Googlebot` User-Agent
  still 307 → `/admin/login` (robots.txt is not a gate).
- `GET /api/v1/access/count/home-page` without a key still answers 401.