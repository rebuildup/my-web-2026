# GitHub profile images (Issues #1170 / #1196)

Runbook for the images the `rebuildup/rebuildup` profile README
embeds. The README was redesigned from a single card into a
multi-section layout (rebuildup/rebuildup#5); the delivery contract is
`docs/adr/ADR-0025-github-profile-assets.md` and the design record is
`docs/visual/github-profile-readme.md`.

## Current surface (ADR-0025)

| Asset | URL | Kind |
|---|---|---|
| Work reel | `https://rebuildup.dev/github-profile/reel.webp` | Static Assets, committed animated WebP 560×315@4fps (Issue #1204) |
| Skill icons ×14 | `https://rebuildup.dev/github-profile/skills/<name>.svg` | Static Assets, tandpfun/skill-icons (MIT), dark/light variants |
| Work covers ×5 | `https://rebuildup.dev/github-profile/works/<slug>.webp` | Static Assets, committed WebP ≤1200px |
| Unified status | `GET /api/v1/github-profile/now` | SVG, contributions/streak/top-lang/activity/Discord, ~few KB, no raster |
| Legacy status | `GET /api/v1/github-profile/status` | SVG 2-panel strip; superseded by `/now` in the README |

Work selection lives in `src/http/github-profile/works.json`
(`hero` / `grid` roles); `works.ts` resolves slugs against the
committed portfolio snapshot fail-closed. Regenerate the images with:

```sh
node scripts/build-github-profile-works.mjs          # write
node scripts/build-github-profile-works.mjs --check  # verify freshness
```

The script only uses `isCover` raster media that `GET /media/<key>`
serves publicly — a private or unpublished key answers 403 and is
skipped, and non-cover media is never a candidate (the recorded
licence condition in `quality/asset-license-inventory.json` is
cover-only). After processing the manifest it sweeps
`public/github-profile/works/`: any `.webp` this run did not produce
(slug removed from `works.json`, project left the published+public
snapshot, or no servable cover) is deleted in build mode and reported
as a failure in `--check` mode — Static Assets serves `public/`
verbatim, so a leftover derivative would keep publishing bytes for a
work that is no longer public (Issue #1199).

The reel asset (`public/github-profile/reel.webp`) is regenerated
separately — its sources are the public YouTube videos linked from the
same snapshot, not `/media` covers:

```sh
pnpm run profile:reel:build   # yt-dlp + ffmpeg + sharp; fails closed
                              # when a reel.json slug leaves the
                              # published+public set or a segment's
                              # first frame fails the luma gate
```

Segment picks live in `src/http/github-profile/reel.json` (`at`
fraction, `duration`, `fit: crop|blur`); review first frames with
`--review` (dumps PNGs to `.tmp/reel-review/`) before committing a new
build.

## Deprecated surface (ADR-0024 → ADR-0025 §2.4)

`GET /api/v1/github-profile/card` — the v0.11.3 single-image card —
**still serves unchanged** but carries `Deprecation: true` and is
scheduled for removal in the next minor release after the README
switch is verified in production. Do not extend it; `/status` reuses
its panel renderers.

---

## Legacy card reference (pre-removal)

The sections below document `/card` as shipped in v0.11.3. They stay
accurate until the endpoint is removed.

## What the card contains

- **Work covers** — up to 4 tiles (`WORK_TILE_COUNT`) picked from the
  committed portfolio snapshot by `selectShowcaseWorks`
  (`src/http/github-profile/model.ts`): `FEATURED_SLUGS` first, then
  the remaining published projects with a servable raster cover,
  newest `periodStart` first. Covers are **embedded as `data:` URIs**
  by `embedWorkMedia` (`src/http/github-profile/media-embed.ts`)
  because an SVG loaded through `<img>` (which is how GitHub/Camo
  renders README images) cannot fetch external subresources — remote
  `<image href="https://…">` would render blank. Only R2 keys passing
  `isPublicMediaKey` are read; content types are limited to
  png / jpeg / webp.
- **GitHub activity** — counts and the latest *public* feed item from
  the D1 `github_activity_snapshot` row. Private-kind entries may
  contribute counts only; identities never reach the SVG.
- **Discord presence** — the D1 `discord_presence_snapshot` row,
  validated against `DISCORD_PRESENCE_USER_ID` and the 15-minute
  freshness window owned by `src/home/presence/`.
- **Honest degradation** — missing, stale, malformed, or
  identity-mismatched inputs render explicit `unavailable` / `stale`
  states inside the SVG. The route always answers 200; there is no
  path that invents a status.

## Response contract

| Property | Value |
|---|---|
| Method | `GET` only (`405` otherwise) |
| Rate limit | `RATE_LIMIT_READ` |
| Status | always `200` |
| Content-Type | `image/svg+xml; charset=utf-8` |
| Cache-Control | `public, max-age=300, s-maxage=300` |
| Size | ~1.2–2 MB typical with 4 embedded covers (raw media budget 1.5 MB → ~2 MB base64); ~10 KB with none |

## Cost model

Per request the route performs two D1 point reads
(`id = 1` rows), up to 4 `head`+`get` pairs against R2 (bounded by
`MAX_COVER_BYTES` per cover and `MAX_TOTAL_MEDIA_BYTES` overall), plus
synchronous composition over the committed portfolio snapshot. No
upstream GitHub or Discord calls happen at request time — freshness is
owned by the existing ingest jobs (`github-activity-sync`, Discord
presence push). Because covers are inlined, the response is larger
than the old URL-reference design (~1.2–2 MB vs ~5 KB); the shared
cache and Camo absorb repeat fetches, and the byte budgets cap the
worst case.

## Camo / GitHub profile notes

GitHub proxies external images through Camo. The card is a single
URL, so README edits are not needed to refresh content — only Camo's
own cache window applies. If the profile shows a stale card after a
data update, check `Cache-Control` at the origin first (it is a
positive `max-age`, which Camo honours), then allow the observed
Camo TTL (~hours, not contractually fixed) before suspecting the
endpoint. Do **not** add cache-busting query parameters to the README
URL unless the Camo delay proves unacceptable — a stable URL keeps
GitHub's markdown simple.

## Failure modes

- **D1 unreachable / row absent** → `unavailable` panels, still 200.
- **Presence snapshot stale (>15 min) or userId mismatch** → `stale`
  / `unavailable` panel; never rendered as online.
- **No servable cover** → fewer than 4 tiles; the card still renders.
- **MEDIA binding absent or object missing / oversized** → that tile
  renders the text-only placeholder; the rest of the card (including
  other covers) is unaffected. There is no fallback to remote URLs —
  they cannot render inside an `<img>`-loaded SVG.
