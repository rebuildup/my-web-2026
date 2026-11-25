# portfolio-assets/my-web-2026 — Issue #1224

Representative imagery for the public portfolio entry `my-web-2026`
(captured for supervisor Issue #1225). The product is the personal web
platform itself, deployed at <https://rebuildup.dev>.

## Provenance

- Captured from the **production public deployment**
  `https://rebuildup.dev` on 2026-11-25.
- Deployed version: `0.13.1`
  (`GET /api/v1/health` → `"version":"0.13.1"`).
- Source SHA: `5b3c47d8a453a10c184ed15ec94ec2a160e5700b`
  (`origin/main` HEAD, merge of `release-0-13-1`, PR #1208).
- No staging, local build, or fixture data was used; the screenshots are
  of the live public pages.

## Files

| File | Role | Source URL | Dimensions | SHA-256 |
| --- | --- | --- | --- | --- |
| `main-home.png` | main | `https://rebuildup.dev/` | 3840×2160 | `d7c81514…03f96d` |
| `supplement-portfolio.png` | supplement | `https://rebuildup.dev/portfolio` | 3840×2160 | `bc7bffb4…f199e` |

Note: the home page embeds live data (e.g. GitHub activity), so a
re-run may produce a slightly different hash; the committed file is the
authoritative capture.

Both are PNG, viewport 1920×1080 CSS px at `deviceScaleFactor: 2`,
Chromium (Playwright 1.63.0), `locale: ja-JP`, full first viewport
(non-full-page). Aspect ratio 16:9.

## Reproduction

```sh
node portfolio-assets/my-web-2026/capture.mjs
```

The script imports `playwright` from the repository's installed
dependencies (`node_modules/.pnpm/playwright@1.63.0/...`); run it from a
checkout that has run `pnpm install` and `playwright install chromium`.
It writes `main-home.png` / `supplement-portfolio.png` next to itself.
Equivalent manual capture:

```sh
pnpm exec playwright screenshot --viewport-size=1920,1080 \
  --wait-for-timeout=1500 https://rebuildup.dev/ main-home.png
```

## Alt / caption

- `main-home.png`
  - alt (ja): `my-web-2026 の公開トップページ。PERSONAL SITE の見出しとサイト案内カードが並ぶ`
  - alt (en): `Public top page of my-web-2026 showing the PERSONAL SITE hero and site-guide cards`
  - caption (ja): `my-web-2026 公開版トップページ（rebuildup.dev、v0.13.1）`
- `supplement-portfolio.png`
  - alt (ja): `my-web-2026 の公開ポートフォリオ一覧ページ。制作物カードがグリッド状に並ぶ`
  - alt (en): `Public portfolio index page of my-web-2026 showing project cards in a grid`
  - caption (ja): `my-web-2026 公開版ポートフォリオ一覧（rebuildup.dev、v0.13.1）`

## Rights / publication boundary

- The captured pages are the owner's own public website
  (`rebuildup.dev`, MIT-licensed repository `rebuildup/my-web-2026`).
- Only public, indexable pages were captured; no admin screens, private
  data, credentials, or non-public projects appear.
- Third-party content visible on the pages (e.g. GitHub avatars / stats
  if rendered) is limited to what the public site itself displays.
- Screenshots may be published as portfolio cover imagery; redistribution
  beyond that should follow the site's own licence.
