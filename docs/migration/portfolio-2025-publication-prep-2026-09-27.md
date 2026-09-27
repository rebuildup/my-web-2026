# Portfolio publication preparation dossier (2026-09-27)

This document is the agent-side preparation packet for Issue #78 portfolio publication. **It does NOT constitute owner approval.** No `publication_overrides` entries have been written; no visibility flip from `draft` to `public` has been made.

Per operator plan 2026-09-27, the agent may:
- Survey legacy / repository primary source
- Confirm what exists vs. what needs authoring
- Identify the minimum work to publish for each candidate

The agent may NOT:
- Add `publication_overrides` entries
- Set `visibility='public'`
- Approve on behalf of the owner

## Surface summary

| Candidate | role (grounded) | period | legacy links | ext video | local media | legacy markdown body | blockers |
|---|---|---|---|---|---|---|---|
| `aulymo-v01` | Tool developer (domain.md §8) | 2024-12-13 | 2 (Booth + YT) | 1 | 0 | 195 chars | `media_missing`, `no_mappable_section` |
| `aulymo_v02` | Tool developer (same) | 2024-12-20 | 2 (Booth + YT) | 1 | 0 | 438 chars | `media_missing`, `no_mappable_section` |
| `aulymo_v03` | Tool developer (same) | 2025-08-12 | 1 (X status) | **0** | 0 | 523 chars | `media_missing`, `no_mappable_section` |
| `MultiSlicer` | Plugin developer (domain.md §8) | 2025-05-02 | 3 (Booth + X + YT) | 1 | **1 (JPEG)** | 844 chars | `media_missing`, `no_mappable_section` |

## Primary source survey — Markdown section candidates

All 4 candidates have **existing `markdown_pages.body` content** in the legacy SQLite DB. The bodies are short (195-844 chars) and have `<Html>` / `<Bookmark>` / `<Image>` tags — these are legacy-specific custom tags that would need rewriting for the 2026 Markdown renderer.

### `aulymo-v01` body

```
# Aulymo

Aeのスクリプトです　簡単にリリックモーションを作れます

<Bookmark url="https://361do.booth.pm/items/6403113" title="【After Effects Script】「Aulymo」全自動リリックモーション/AutoLyricMotion - 361doのbooth - BOOTH"></Bookmark>
```

→ 1 sentence + 1 external link. Authoring needed for fuller 2026 narrative.

### `aulymo_v02` body

```
Aeスクリプト Aulymo

Ae全自動リリックモーション「Aulymo」v2の動作説明動画です。PremiereProを初めてまともに使いました。あと、コンピュータ部のMacBookを借りました。

- https://www.youtube.com/watch?v=EbtybmiN5pM (video/youtube)
- https://361do.booth.pm/items/6403113
```

→ 2 sentences + 2 links. Has version note (v2).

### `aulymo_v03` body

```
# Aeスクリプト Aulymo

Ae全自動リリックモーション「Aulymo」v2の動作説明動画です。

## Media
<iframe src="https://www.youtube.com/embed/EbtybmiN5pM"></iframe>

## Links
- YouTube
- Booth
```

→ 1 sentence + iframe + 2 links. **Note**: the YouTube ID `EbtybmiN5pM` is the same as `aulymo_v02` — the v03 markdown body actually embeds v02's video. The link to `https://x.com/361do_sleep/status/1955248758243070349` (X status from v03 content_links) is NOT in the body. Operator may want to investigate whether v03 has its own PV.

### `MultiSlicer` body

```
# MultiSlicer

Aeで画像をスライスするエフェクトプラグインです

<iframe src="https://www.youtube.com/embed/X7XddKpTolw"></iframe>

<Bookmark url="https://youtu.be/X7XddKpTolw" title="Ae版MultiSlicer PV"></Bookmark>
<Bookmark url="https://361do.booth.pm/items/6872180" title="【Aeエフェクトプラグイン】Ae版MultiSlicer - 361doのbooth - BOOTH"></Bookmark>
<Bookmark url="https://x.com/361do_sleep/status/1918615732939575763" title="x.com"></Bookmark>
<Bookmark url="https://github.com/rebuildup/Ae_MultiSlicer" title="GitHub - rebuildup/Ae_MultiSlicer: Ae版MultiSlicerのコード"></Bookmark>
<Image src="http://localhost:3010/api/cms/media?contentId=MultiSlicer&id=media_1762437621694_rw8hkaw04&raw=1" alt=""></Image>
```

→ 1 sentence + 1 iframe + 5 external links + 1 image ref. **Richest body** of the four. The Image ref points to a legacy local media — the actual JPEG is at `/tmp/MultiSlicer-20250503_multi.jpg` (417357 bytes, valid JPEG header).

## Primary source survey — Local media

The migration classifier's `media_missing` blocker uses `localFileCount` which counts entries in `content_assets` table (NOT the legacy `media` BLOB table). For all 4 candidates, `content_assets` holds only YouTube URLs → `localFileCount = 0` → `media_missing` fires.

| Candidate | `content_assets` count | `content_assets` srcs | legacy `media` BLOB |
|---|---|---|---|
| aulymo-v01 | 1 | youtu.be/SewXH0Bbm-c | 0 |
| aulymo_v02 | 1 | youtube.com/EbtybmiN5pM | 0 |
| aulymo_v03 | **0** | — | 0 |
| MultiSlicer | 1 | youtu.be/X7XddKpTolw | **1 (20250503_multi.jpg, 417KB)** |

**Key observation**: MultiSlicer has 1 actual local JPEG in the legacy `media` table, but the classifier doesn't consult the `media` table. To use this asset, either:
- (Path A) operator manually uploads the JPEG to R2 via `wrangler r2 object put my-web-2026/portfolio/MultiSlicer/20250503_multi.jpg --file /tmp/MultiSlicer-20250503_multi.jpg`, then the migration script picks up the localFileCount via... actually no, the migration script reads `content_assets` not R2.
- (Path B) Add a `content_assets` row pointing to a relative path (e.g., `/media/MultiSlicer/20250503_multi.jpg`) — but this requires a manual SQLite edit on the legacy DB before re-running classification.
- (Path C) Upload JPEG to R2 + manually author a content_assets entry with the R2 URL — but R2 URLs are not "local files" per the classifier.
- (Path D) Open a separate ticket to teach the classifier that `media` BLOB rows count as local files — this is a gate refinement and requires an ADR.

**Conclusion for MultiSlicer**: the JPEG exists in primary source but is invisible to the gate without gate refinement or manual SQLite intervention.

For `aulymo-v01` / `aulymo_v02` / `aulymo_v03`: zero local media in legacy data. They have external videos only. They CANNOT satisfy `media_missing` under the current gate without a fresh local file provided by operator.

## Primary source survey — External videos

External videos (YouTube, Vimeo) are NOT local files. They satisfy `external_video` but NOT `media_missing`.

| Candidate | YouTube URL | Notes |
|---|---|---|
| aulymo-v01 | https://youtu.be/SewXH0Bbm-c | — |
| aulymo_v02 | https://www.youtube.com/watch?v=EbtybmiN5pM | — |
| aulymo_v03 | (none) | X status URL only |
| MultiSlicer | https://youtu.be/X7XddKpTolw | — |

`aulymo_v03` has NO YouTube PV — its primary surface is the X status update. Operator may want to either skip v03 from publication OR consider what visual asset represents v03.

## Minimum work to publish per candidate (proposed)

### `MultiSlicer` (closest to publishable)

1. **Markdown section author**: rewrite the body in 2026 markdown dialect (replace `<Html>` / `<Bookmark>` with proper markdown embeds; replace localhost Image with R2 URL once bucket attached)
2. **Local media**: decide between Path A (manual R2 upload + gate refinement) or Path B (SQLite content_assets row) — currently **blocked by gate**
3. **publication_overrides**: owner adds entry with `publication: "approved"`, `publication_visibility: "public"`

### `aulymo-v01` / `aulymo_v02`

1. **Markdown section author**: expand the body (currently 1-2 sentences)
2. **Local media**: NONE in legacy data — operator must provide fresh local file OR open gate-refinement ticket to allow ext_video to satisfy media_missing
3. **publication_overrides**: same as above

### `aulymo_v03`

1. **Markdown section author**: expand body (currently duplicates v02 content); consider whether v03 deserves a separate page or should be merged with v02
2. **Local media**: NONE; no YouTube PV — weakest candidate
3. **publication_overrides**: same

## Recommendation

Given the gate constraints (legacy `media` BLOB not consulted by classifier, no local files for 3 of 4 candidates), the cleanest path for #82 release gate (≥3 public projects) is one of:

- **Path A** (operator-supplied local files): operator provides 1 fresh local media file per candidate (3 candidates minimum). Upload to R2 via `scripts/upload-portfolio-media.mjs` or manual `wrangler r2 object put`. Then add `publication_overrides` + Markdown sections.
- **Path B** (gate refinement via ADR): separate ticket to teach the classifier that `media` BLOB rows count as local files for video-led Tool/Plugin candidates. Only MultiSlicer benefits under current legacy data.
- **Path C** (defer to 0.6.0): ship 0.5.0 with 0 public portfolio entries; close #82 via Tools + /about + /contact surfaces alone.

Path A is the lowest-friction for the 0.5.0 release gate but requires operator to source/produce 3 fresh local files.

## Files referenced (not modified)

- `docs/migration/portfolio-2025-to-2026-classification.json` — classification state (151 rows)
- `docs/migration/portfolio-2025-role-overrides.json` — 4 grounded-role entries; `publication_overrides: []`
- `docs/migration/portfolio-2025-owner-review.md` — existing owner-review prose
- `scripts/classify-portfolio-from-2025.mjs` — gate logic (`localFileCount` derived from `content_assets` only)
- `scripts/migrate-portfolio-from-2025.mjs` — UPSERT pipeline
- `scripts/verify-portfolio.mjs` — verifier (8/8 PASS on local D1 seed)
- `.reference/my-web-2025/data/contents/content-*.db` — legacy SQLite primary source

## Primary source extracted (preview)

- `/tmp/MultiSlicer-20250503_multi.jpg` — 417357 bytes JPEG, extracted from legacy BLOB. **Not uploaded to R2.** Owner can use as a starting point if operator decides to publish MultiSlicer.
