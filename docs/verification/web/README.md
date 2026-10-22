# Verification artefacts — web

Screenshots and reproduction steps that back a verification claim in a
pull request. An image alone is not evidence: every entry records the
command, the URL and the expected result so a reviewer can re-run it.

## `keyboard-page-desktop.webp` / `keyboard-page-mobile.webp`

Chromium rendering of the **real** `/keyboard` page (Issue #620), served
by the local Vite dev server (`@cloudflare/vite-plugin`) and captured by
`scripts/make-keyboard-verification-report.mjs` (Playwright `chromium`,
desktop 1440×900 and mobile 390×844, `sharp` → WebP q80, no intermediate
PNG on disk).

- Issue: #620 — the read-only keyboard-layout reference
- Paths: `docs/verification/web/keyboard-page-desktop.webp` and
  `docs/verification/web/keyboard-page-mobile.webp`
- Route / URL: `/keyboard` (canonical: `https://rebuildup.dev/keyboard`)
- Document owner: `src/keyboard/**` (the obligation that owns the
  committed snapshot, the parsers and the page), rendered through
  `src/routes/keyboard.tsx`.

What the capture shows: the page a visitor sees — the heading, the
platform / layer tabs, the key diagram with the `tap` / `hold` branches,
the hidutil base-mapping table and the provenance section (repository,
pinned ref, adoption status). The mobile capture is the narrow case:
the **document** does not scroll horizontally and the diagram keeps its
own scroll region, exactly as the page's `aria-label` says
(「横にスクロールできます」).

The page reads only the committed bytes under `src/keyboard/sources/**`,
so the capture needs no binding, no Infisical and no Cloudflare
resource — it reproduces offline.

### Reproduce

```bash
# 1. the artefact itself (the generator starts and stops its own dev server)
pnpm run verify:keyboard-screenshot
#   equivalent: node scripts/make-keyboard-verification-report.mjs

# 2. the runtime evidence behind the image
pnpm exec vitest run test/integration/keyboard-page.test.ts
pnpm exec playwright test e2e/keyboard.spec.ts
```

The generator fails closed rather than committing a worthless image: it
refuses a non-200 response, refuses a page that rendered the safe state
(「配列を表示できません」), refuses a target that is not `.webp`, and
refuses an artefact over 300 kB.

### Expected result

Both viewports render the committed snapshot (macOS 12 layers, Windows 3),
and the document width equals the viewport width at 390 px. The image is
**supporting evidence**; the authority is the integration test
(`test/integration/keyboard-page.test.ts`) and the Playwright spec
(`e2e/keyboard.spec.ts`), which assert the same facts without a
screenshot.

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