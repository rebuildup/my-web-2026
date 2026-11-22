# GitHub profile card (Issue #1170)

Runbook for the single-image GitHub profile card served at
`GET /api/v1/github-profile/card`. It is the main image of the
`rebuildup/rebuildup` profile README (rebuildup/rebuildup#3) — a
business-card surface, not a stats dashboard. Design contract:
`docs/adr/ADR-0024-github-profile-card.md`.

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
