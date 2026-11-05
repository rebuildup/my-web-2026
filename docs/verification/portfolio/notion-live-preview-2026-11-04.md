# Notion 実データ表示のプレビュー証跡（2026-11-04）

Issue #889 / #765。**本番 Notion は未公開のまま**、実データで
「Notion → mapper → media ingest → snapshot → build → 公開面表示」の全経路を
証明した記録である。この記録の作成者が agent であり、**実行したことにしか
証拠はない**（AGENTS.md §6 / Issue #741）。

## 0. 結論（先に読む部分）

- 本番 Notion データソース（`6a148863-d397-417e-af26-83b628dcd982`）は
  **全69ページが `Status=Draft` / `Visibility=Draft`**（owner が投入時から
  Draft にしたまま）。したがって **commit 済みの
  `src/portfolio/notion/generated/snapshot.json` は今も 457 B の
  プレースホルダのままである**（`availability: unavailable` / `records: 0`）。
- このプレビューは、**メモリ上だけで**各ページの Status を `Published`、
  Visibility を `Public` に書き換えて（Notion には1件も送っていない）、実ページ
  ・実バイトで表示まで通ることを証明した。
- **Notion への write は1件も行っていない**（GET / query のみ。status /
  visibility / pin の変更ゼロ）。**production R2 への write もゼロ**
  （byte は local のみ）。**snapshot はバイト単位で復元済み**（§5 の sha）。

## 1. 実行した経路（すべて実コード）

ハーネス `.tmp/preview-ingest.mjs`（gitignored）は、
`scripts/_notion-transport.mjs` と `scripts/_notion-mapper.mjs`、
`scripts/sync-portfolio-notion.mjs#syncNotion` を import して使う。書き直したのは
**Status / Visibility の上書きと probe だけ**で、mapping・content-type allowlist・
sha256・dedupe・権利判定・snapshot writer はすべて production code である
（`--r2-target=local` 相当。production R2 には届かない）。

1. 実データ取得: `fetchNotionPortfolio`（本番 ingest と同じ呼び出し）。
   `preview fetched pages=69 idKind=data_source`。
2. **in-memory 上書き**: `Draft` の行を process 内だけ `Published` / `Public` に。
   API へは一切送らない。`preview overridden_in_memory=69 (Notion untouched)`。
3. probe mapping で、公開 schema を満たせない行は **Draft に戻す**。
   該当は1ページ（`flashbeat-bgm` — `Role` / `PeriodStart` / `Facets` が空、
   `empty_property` / `missing_property` ×2）。強制的に Published にすると
   公開ページの fail-closed が発動して ingest 全体が止まるため、実 ingest が
   そう扱うのと同じ（skip）に戻した。`preview reverted_to_draft=1 kept_published=68`。
4. 実 ingest: `syncNotion({ fixture, r2Target: 'local' })`。
   byte の download → content-type 判定 → sha256 →
   `portfolio/notion/<sha256>.<ext>` → local R2 upload → snapshot 書き込み。

### transport retry（ハーネス専用・production code は不変）

直前の2回の実行は、4並列ビルドの負荷下でそれぞれ**別の**1オブジェクトが
`media_download_failed detail=network`（fetch が throw、HTTP status なし）で
中断していた。ハーネスは `syncNotion({ fetchImpl })` の既存 seam（テストが使う
ものと同じ）にだけ、**URL あたり最大2回の retry・短い backoff（400 / 1200 ms）・
throw された fetch / 5xx / 429 のみ**を注入した。**4xx は経由せず、content
規則・allowlist・size 上限は一切変えていない。** 本実行では retry は0回で通過した。

## 2. 実測カウント（status-only）

ingest の最終行（verbatim）:

```
synced records=68 findings=0 skipped_draft=1 media=145 media_bytes=116515573 media_skipped=1 would_upload=129 upload_bytes=100698639 reused=16 digest=sha256:847b896abbb5… written=true
```

| 項目 | 値 |
| --- | --- |
| 取得ページ | 69（上書き69 / probe で1件 revert / 公開扱い68） |
| `records` | **68** |
| `findings` | **0** |
| `skipped_draft` | **1**（`flashbeat-bgm`） |
| `media` | **145**（146 image ブロック中。1件は `image/svg+xml` で配信 policy が拒むため skip） |
| `media_bytes` | **116,515,573 B** |
| `media_skipped` | **1**（`media_content_type_refused detail=declared` — SVG。allowlist は広げていない） |
| `would_upload` / `upload_bytes` / `reused` | 129 / 100,698,639 B / 16 |
| 権利 | 全145件 `unrecorded`（`quality/asset-license-inventory.json` に portfolio 資産の記録が無いため。ADR-0019 / Issue #811） |

**ビルドした snapshot（このプレビューで作られた一時状態）**

| 項目 | 値 |
| --- | --- |
| bytes | 162,415 |
| sha256 | `06a0c8d6423299b96aff7611338855e4c564fc88c99e64089486684ccfb25ac3` |
| `contentDigest` | `sha256:847b896abbb5…` |
| records / media を持つ records / media 合計 | 68 / **31** / **145** |
| availability | `public` |

この sha が `pnpm run build` に埋め込まれた（build 出力の
`index-*.js` に `847b896abbb5…` を確認）。復元後の placeholder の sha は
`0cc13ca912d9f1a1bf517aa696ae5fa9f01c52b2cd3db60e81b7d7288dddc665`（457 B、§5）。

## 3. ビルドと配信の確認

- `pnpm run build` → **exit 0**（`vite build` + `build-tools`（15 tools）+
  `check-client-bundle`、259 s）。route manifest
  （`.cloudflare/output/.../_tanstack-start-manifest_v-*.js`）に
  **`portfolio/$slug`（= `/portfolio/[slug]`）と `portfolio/index.tsx`** を確認。
- `node scripts/sync-cf-build-output.mjs` → exit 0（248 files / 15 tools）。
- サーバ: `node scripts/e2e-local-bootstrap.mjs --port=4403 -- pnpm exec vite preview --port 4403 --strictPort`
  （local D1 の migrate + seed が起動前に済むこの経路が repo の正）。
  **port 4403**、`/portfolio` → **200**、SSR fallback marker 0。
- 配信: preview の `GET /media/portfolio/notion/<sha256>.png` →
  **200 `image/png` 997,807 B**（namespace gate + bundled snapshot の
  公開判定を通過。local R2 の実バイト）。

**撮像時に1点だけ origin を写像した（open に記録する）**: `vite preview` は
`ctx.mode === 'production'` で動くため、`cloudflare.config.ts` が production 専用で
宣言する `MEDIA_PUBLIC_BASE_URL=https://rebuildup.dev/media` が入り、ページの
`<img>` は本番 origin を指す。**本番には対象オブジェクトがまだ無い**（実測404。
production への byte 移行は #850 / operator step）。capture はその**1 origin のみ**
preview origin に写像し、**同じ `/media/<key>` ルート・同じ2段 gate・同じ local
バイト**に到達させた（各 capture 行の `shim=N` が件数）。HTML・URL 形状・承認判定・
保存バイト・decode はすべて実物である。

## 4. 取得した capture（11点、WebP quality 82）

`docs/verification/portfolio/notion-live-preview-2026-11-04/`（計 412 KB）。
各点とも事前に検証: **HTTP 200 / SSR fallback なし / 空状態なし /
記録の実タイトルが本文に存在 / `naturalWidth > 0` の `<img>` が1以上**。

| ファイル | bytes | images_loaded / max naturalWidth / shim |
| --- | --- | --- |
| `index-1280-light.webp` | 45,482 | 31 / 2667 / 31 |
| `index-390-light.webp` | 37,588 | 31 / 2667 / 31 |
| `seishun-1280-light.webp` | 43,436 | 1 / 1920 / 1 |
| `seishun-1280-dark.webp` | 38,846 | 1 / 1920 / 1 |
| `seishun-390-light.webp` | 35,224 | 1 / 1920 / 1 |
| `propose-1280-light.webp` | 36,786 | 1 / 720 / 1 |
| `propose-1280-dark.webp` | 32,806 | 1 / 720 / 1 |
| `propose-390-light.webp` | 30,376 | 1 / 720 / 1 |
| `pomodoroom-1280-light.webp` | 36,792 | 1 / 1920 / 1 |
| `pomodoroom-1280-dark.webp` | 33,468 | 1 / 1920 / 1 |
| `pomodoroom-390-light.webp` | 27,290 | 1 / 1920 / 1 |

対象3件は snapshot 内で `media` を持つ実在レコード（
`seishun` / `propose` / `pomodoroom`、いずれも cover あり）。index は
lazy 読み込みを発火させてから先頭画面を撮っている。dark は
`prefers-color-scheme: dark` エミュレーション。

## 5. 何も公開していない / snapshot は復元した

| 対象 | 状態 |
| --- | --- |
| Notion | **write 0 件**（GET / query のみ）。status / visibility / pin の変更0件。Draft のまま |
| production R2 | **write 0 件**（upload は `--r2-target=local` の local state のみ。production の `portfolio/` は3オブジェクトのまま） |
| D1 | write 0 件 |
| `src/portfolio/notion/generated/snapshot.json` | capture 後に `.tmp/snapshot-original.json` から**バイト単位で復元** |

復元の証明:

```
$ shasum -a 256 src/portfolio/notion/generated/snapshot.json
0cc13ca912d9f1a1bf517aa696ae5fa9f01c52b2cd3db60e81b7d7288dddc665
$ cmp .tmp/snapshot-original.json src/portfolio/notion/generated/snapshot.json   # identical
$ git status --porcelain src/portfolio/notion/                                  # (空)
```

プレビュー snapshot は **commit していない**。この commit に含まれるのは
本ドキュメントと WebP11点、および ingest CLI の `--flag=value` 形式受け入れ修正
のみである。

## 6. 残る owner gate（これが終わるまで本番表示はゼロ）

- **69ページを `Status=Published` / `Visibility=Public` にするかは owner の決定**
  （AGENTS.md §6 / Issue #741）。agent は Notion を公開しない。本記録は
  owner の承認の代行ではない。
- 公開後は、この記録が示したとおり
  `node scripts/sync-portfolio-notion.mjs --r2-target=local`（本番は
  `--r2-target=production`）→ snapshot commit → PR → build → 公開面、の経路が
  動く。**production R2 へ byte を移すのは #850 / operator step** であり、
  本記録は local でのみ byte を動かした。
- 権利は全件 `unrecorded` のまま。公開面はそれを `unreviewed` として示す
  （ADR-0019 / Issue #811）。記録は捏造していない。

## 7. 再現手順（status-only）

```sh
# 1. プレビュー snapshot を作る（Notion は読むだけ、R2 は local のみ）
infisical run --env=dev --path=/ -- node .tmp/preview-ingest.mjs
#    → synced records=68 findings=0 skipped_draft=1 media=145 ... written=true

# 2. build して local で配信
pnpm run build && node scripts/sync-cf-build-output.mjs
node scripts/e2e-local-bootstrap.mjs --port=4403 -- \
  pnpm exec vite preview --port 4403 --strictPort

# 3. capture（11点、検証込み）
node .tmp/capture-preview.mjs      # → captures=11 all_ok=true

# 4. snapshot を必ず戻す
cp .tmp/snapshot-original.json src/portfolio/notion/generated/snapshot.json
git status --porcelain src/portfolio/notion/    # 空であること
```

関連: `docs/runbook/notion-portfolio-sync.md`（ingest 手順）、
`docs/adr/ADR-0018-notion-as-portfolio-cms-source-of-truth.md`（build-time 取り込み）、
`docs/adr/ADR-0019-publication-authority-and-unreviewed-assets.md`（公開権限 / 権利）。
