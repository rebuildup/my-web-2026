# 公開面のデータ同期 — root cause 調査記録（Issue #913）

- 日付: 2026-11-05〜06
- 対象: production `https://rebuildup.dev`（読み取り専用実測）/ `origin/release-0-8-2` の
  コミット済みデータ / `.reference/my-web-2025`（旧サイト参照クローン）
- 手順方針: Issue #913「root cause を特定する（メディア行の欠落か、承認クエリか、
  snapshot 未同期か、表示側の分岐か）」に従い、症状ごとに実測 → 突合で特定する。

---

## 0. 実測に使ったコマンド

```bash
# production の公開面
curl -s https://rebuildup.dev/portfolio -o /tmp/prod-portfolio.html
grep -o 'href="/portfolio/[a-z0-9-]*"' /tmp/prod-portfolio.html | sort -u | wc -l   # 60
grep -o '<img' /tmp/prod-portfolio.html | wc -l                                     # 25

# production D1（読み取り専用）
pnpm exec cf d1 query d761ddb7-8179-48dd-855f-c8b7b2924bad --sql "<sql>"

# production R2 key 集合
pnpm exec cf r2 objects list --bucket-name my-web-2026 --prefix portfolio/ --per-page 1000
```

## 1. 症状 (a): payload 60 件に対し SSR `<img>` が少ない

| 実測 | 値 |
| --- | --- |
| payload の slug 数 | 60 |
| SSR `<img>`（production・出現数） | **25**（Issue 記載の 8 件は行単位の count または測定時点差。root cause は同一） |
| `<img>` なし slug | **35** |

production D1 の突合:

| 事実 | 値 |
| --- | --- |
| `portfolio_project`（published+public） | 60（全件 `id LIKE 'legacy_%'`） |
| `portfolio_media` 行を持つ project | **25** |
| `portfolio_media` 行数 / `is_cover=1` | 133 / 25 |
| D1 の `r2_key` が R2 に存在しない（壊れた画像） | **0** |
| R2 に存在するが D1 行が無い object | **14**（すべて `portfolio/notion/*`、§4） |

つまり loader / card の表示分岐は正しく、**35 件は `portfolio_media` 行が 1 件も無い**
ことが `<img>` 欠落の直接原因である。

## 2. root cause (a)(d): `contents.thumbnails` を読む経路がどこにも無い

旧サイトの一覧カードの画像は `contents.thumbnails.image.src` である
（`content-m5_clock.db` の実測: `{"image":{"src":"https://yusuke-kim.com/api/cms/media?contentId=m5_clock&id=media_1765841915649_0rgq2d9f3&raw=1"}}`）。

| 事実 | 根拠 |
| --- | --- |
| `thumbnails` 列を読む script / src は **0 件** | `grep -rn thumbnails scripts/ src/` → 移行系 script に読み手なし |
| `scripts/migrate-legacy-media.mjs` の対象は `media` BLOB のみ | Issue #850（297 ファイル）。`thumbnails` は対象外 |
| `scripts/upload-portfolio-media.mjs` の対象は `content_assets` のみ | 旧 `content_assets` は 44 件すべて外部動画 URL（分類台帳 `other_asset_count=0`）。`external_other` は「報告のみ、移行しない」 |
| 60 slug の thumbnail 内訳 | **外部 URL 41**（img.youtube.com 29 / booth.pximg.net 6 / pbs.twimg.com 3 / i.ytimg.com 3）+ **media id 参照 19**（全件が旧 `media` テーブルに存在 → #850 で移行済み） |
| media 行ゼロの 35 slug | **外部 URL thumbnail の slug と一致**（BLOB media も持つ slug は既に画像が出ている） |

結論: **旧一覧カードの画像正本は `contents.thumbnails` であり、外部 URL の場合は
ingest 時に R2 へ取り込む契約（Issue #913「失効する外部 URL を正本にしない」）が
どこにも実装されていない**。結果、35 件は cover なしで公開されている。

### 修正（本 PR）

`scripts/migrate-legacy-thumbnails.mjs` を追加した。外部 URL の thumbnail バイトを
**ingest 時に取得して R2 へ格納**し（content-addressed key
`portfolio/<slug>/thumbnail/<sha256>.<ext>`）、`portfolio_media` の cover 行を
書く。既に media 行を持つ project は skip（`media_rows_exist`）— cover の差し替えは
owner 判断。production への適用は `--execute` 必須（#850 と同じ gate）。

### ローカル端到端検証（2026-11-06）

local D1 / local R2 に #850 の media migration まで適用した state（production と
同等、seed 3 行を除く）で実行:

| 手順 | 実測 |
| --- | --- |
| `media:legacy:apply:local` 後の local `/portfolio` | 60 slug / `<img>` **23** |
| `migrate-legacy-thumbnails.mjs`（dry-run） | fetches **37** / skips `media_rows_exist=23` / 失敗 0 |
| `--apply --target=local` | objects uploaded **37** / rows written **37** |
| 適用後の local `/portfolio` | 60 slug / `<img>` **60**（全件） |

before / after の WebP: `before-list-*.webp`（23 枚）→ `after-list-*.webp`（60 枚）。

## 3. 症状 (b): 詳細の「権利レビュー未実施」表示

| 事実 | 根拠 |
| --- | --- |
| 全 60 行 `evidence_status='unreviewed'` | D1 実測（`GROUP BY evidence_status` → 60） |
| この値は**事実として正しい** | `docs/migration/portfolio-2025-inventory.json` `rights.recorded = 0`（151 件すべて記録なし）。migration 0010 / #811 が書いた値と一致 |
| 表示は L022 の義務 | `quality/asset-license-publication-decision.json` → `PortfolioEvidenceNotice.tsx` の marker `data-evidence-status="unreviewed"` を gate が実読。**削除・隠蔽は不可（本 Issue の硬い制約）** |
| owner の「承認がないとか無駄なこと言って」の原因 | 表示文が**軸 A（権利記録が無い）しか言わず、軸 B（公開の可否は決定・記録済み — `ownerConfirmation: "confirmed"` の決定記録がリポジトリにある）を言っていない**ため「承認がない」と読める。ADR-0019 §2.2 が分けた 2 軸を 1 文に潰しているのが表示側の問題 |

結論: 開示は**維持**したまま、`PortfolioEvidenceNotice` の表示文に軸 B の事実
（公開の可否は決定・記録済み）を足した。marker と label は変更していない。
**これは公開日本語 copy の変更である（PR body に明記 / 承認記録は作らない）。**

## 4. 症状 (c)(d): snapshot.json records 0 件 と Notion 由来画像

| 事実 | 根拠 |
| --- | --- |
| `origin/release-0-8-2` の `src/portfolio/notion/generated/snapshot.json` は `availability: "unavailable"` / `records: []` | ファイル実測 |
| 実データ snapshot（69 件 / media 145）は **#908（branch `765`）のみ** | `origin/765` の同一ファイル実測 |
| production R2 に `portfolio/notion/*` が **14 object** 存在する | R2 key 集合実測（§1 の orphan 14 件） |
| その 14 object は **404** | `curl -o /dev/null -w "%{http_code}" https://rebuildup.dev/media/portfolio/notion/<key>` → 404。`isPublishedNotionMediaKey`（`src/portfolio/notion/reader.ts`）が同梱 snapshot を読み、records 0 件なので拒否する |

結論: Notion 由来データの公開は **#908 の範囲**。本 Issue では重複実装しない
（依存は PR body に記録し、stack の判断を Supervisor に仰ぐ）。

表示側の分岐で本 Issue 範囲の欠陥が 1 件:
`src/portfolio/notion/publish.ts#recordEvidenceStatus` は
`record.media.every((m) => m.rights === 'recorded')` であり、**media 0 件の
record で `every` が空集合の真値を返し `reviewed` を名乗る**。ADR-0019 §2.5.2
（「レビュー済み」と読める表示を `reviewed` 以外の資産に出さない）の逆方向の
誤りで、#908 が着地した瞬間に media 無し record が開示を黙って消す。
本 PR で修正し、空 media → `unreviewed` を test で固定した。

## 5. 観測（本 Issue の範囲外として記録）

- 全 60 行の narrative 6 セクション（motivation〜retrospective）が**空**。
  旧 markdown の見出し（`# # タイトル` / `## ## 経緯` 形式）が
  `partitionMarkdownBySection` のキーワードに 1 件も一致しないため。
  これは分類台帳の blocker `no_mappable_section`（60 件）として記録済みの
  既知状態であり、本文の書き直しは D4（加筆禁止）の領域なので本 Issue では
  触れない。
