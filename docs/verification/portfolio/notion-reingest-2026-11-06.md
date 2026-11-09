# Notion 再 ingest と CMS 修復 — 2026-11-06 実行記録（Issue #913）

ADR-0018 §2.11（本文とメディアは authoring の一部）。owner 指示
「実際にデータを移行すること。Notion で my-web-2025 で記述していたポートフォリオ
全内容を再現すること」に対する実行の記録。

**この記録は操作の記録であり、作者の承認の代行ではない。**

## 0. 前提の実測（この作業の起点）

| 事実 | 値 | 根拠 |
| --- | --- | --- |
| Notion の authoring database のページ | 69（2026-11-04 の単発書き込みで本文 916 ブロック投入済み） | `notion-media-write-2026-11-04.md` |
| うち旧テストフィクスチャ（`test-otu-*`、分類台帳 `mechanical_drop` = 非作品） | **9 ページが `Published` + `Public`** | page property 実測 |
| ingest（`sync-portfolio-notion.mjs`）が fail-closed する block | `kosen-fes-2025` ページの外部 image block（www.ube-k.ac.jp）— サーバが top page へ 302 し、証明書が `*.sakura.ne.jp`（hostname 不一致）で Node の fetch は検証に失敗。**URL は恒久的に到達不能** | block 実測 + curl 実測 |
| 旧 DB にバイトが無い外部ホットリンク画像 | 8（同記録 §1）。ube-k.ac.jp の 1 件がこの block | 同 |

## 1. 操作 1 — テストフィクスチャ 9 ページを Draft へ

D5（owner 決定 2026-11-02:「作品でない行は公開しない（91 件）」）に反して
`test-otu-*` 9 ページが `Published` + `Public` になっていた。`Status` / `Visibility`
を両方 `Draft` へ変更（PATCH 200 × 9）。これで

- 公開 snapshot にフィクスチャが載らなくなる（D5 の強制）、
- ingest が draft ページの media を解決しなくなる（`mapDocuments` は skip
  ページの descriptor を返さない）。

## 2. 操作 2 — 死んだ外部 image block の修復

`kosen-fes-2025` の外部 image block（ube-k.ac.jp の画像）は到達不能で、
この 1 block が **60 ページ分の ingest 全体を fail-closed させていた**。

バイトの回収と同一性の検証:

1. Wayback Machine の copy（archived 2026-08-12, 1063x780 JPEG / 388,074 B）を取得。
2. その sha256 `5e52b10da7e366b15aaa8c29a35278f496698a390edfd4876d08f8f9f976cfb2` は、
   **2026-11-05 の ingest 自身が R2 に upload した object
   `portfolio/notion/5e52b10d….jpg` と一致**（ingest は検証済みチャネルで
   fetch して hash している）。→ Wayback copy の同一性を検証済み copy とで交叉確認。
3. そのバイトを Notion `file_upload` として送信し、死んだ block を削除 →
   **同一位置**（直前の block の `after`）へ file_upload の image block として再配置。

block の PATCH は `file_upload` source を受け付けない（実測:
`body.image.type should be not present`）ため、削除 + 同一位置への再 append で行った。
内容の欠落は 0（同一バイト・同一位置）。

## 3. 操作 3 — ingest 再実行 → committed snapshot 更新

```
$ infisical run --env=dev --path=/ -- node scripts/sync-portfolio-notion.mjs --r2-target=local
synced records=60 findings=0 skipped_draft=9 media=139 media_bytes=112383184
  media_skipped=1 would_upload=5 upload_bytes=658197 reused=134
  digest=sha256:df7b78a79f7e… written=true
```

- `records=60`（69 ページ − フィクスチャ 9）— **欠落 0**
- `media=139` / `media_skipped=1`（旧 SVG 1 件の policy skip — 配信対象外 MIME。
  行を作ると永久に壊れた画像になるため、#850 と同じ理由で skip され報告される）
- `reused=134` — バイトの大半は既存 R2 object と hash 一致（再 upload しない）
- `would_upload=5` — 修復した ube-k 画像を含む 5 object のみ新規
- R2 target は local（production R2 には 2026-11-05 の ingest が既に object を
  置いており、content-addressed key は同一なので merge 後の production は
  追加 upload 不要で配信できる）

## 4. 内容の突合（欠落 0 の検証）

旧サイトの本文（`markdown_pages.body`、published+public 60 件）と新 snapshot の
sections を突合した（script: 正規化 = markdown escape の復元 / 空白圧縮 /
構造タグ・見出し行の除外）:

| 項目 | 実測 |
| --- | --- |
| 本文を持つ published+public 項目 | 60 / 60 が snapshot に存在（欠落 0） |
| 本文テキスト行 | **全行が sections に存在**（57 件は verbatim、後述 3 件は記録済みの変換） |
| 変換の内訳 | `aulymo-v03` / `prototype-brochure` — 旧 DB の本文は**別記事の重複書き出し**であり、本文は最初から存在しない（`notion-media-write-2026-11-04.md` §2 の未達のまま。捏造しない）。`prototype` — 冒頭の題名行（本文中に 2 回出現）が page title へ畳まれた（11-04 書き込みの記録済みルール「冒頭段落が summary と同一の場合は 1 回に畳む」） |
| 旧 `<Image>` 参照 → snapshot media | 119 参照 + Evidence>Media 配置 + 外部 URL → **media 139 行**（うち 1 件は SVG の policy skip） |
| 構造変換 | `<Bookmark>` → bookmark/link、`<iframe youtube>` → bookmark、`<Spacer>` → divider（11-04 記録の §3 のとおり） |

## 5. 読み取り側（同一 PR で修正）

committed snapshot が実データになった結果、loader の merge が効くようになる。
ただし衝突規則（D1 が勝つ、ADR-0018 §2.7 / ADR-0019 §2.6）のままだと、60 slug は
**D1 の lossy 行（narrative 全空）が勝ち、authoring 内容が公開面に出ない**。
そこで loader は、両方の store が持つ slug について **authoring フィールド
（本文 6 セクション + media）を CMS record で満たし**、identity / 順序 / 可視性 /
evidence status / links は D1 行のまま保つ（1 slug = 1 URL = 1 カードは不変）。
`src/portfolio/load.ts#mergeCmsContent` + test。

## 6. 追補（2026-11-10）— local-only key の混入と訂正

§3 の末尾に「content-addressed key は同一なので追加 upload 不要」と書いたが、
**この記述は 3 件について誤りだった**。`planMedia` は同一バイトの既存 object を
再利用するため、local bucket に旧サムネイル移行の key
（`portfolio/<slug>/thumbnail/<sha>.jpg`）があると snapshot はその key を指す。
本番 bucket にはその 3 object が無く、公開面は 404 になるところだった。

実測（2026-11-10、読み取りのみ。`https://media.rebuildup.dev/<key>` は bucket の
全 key を返す residual 配信面なので、存在確認に使える）:

| 参照されていた key | 本番 bucket | 同一バイトの既存 key | 対応 |
| --- | --- | --- | --- |
| `portfolio/rgbdelay/thumbnail/cb630f6a….jpg` | **404** | `portfolio/notion/cb630f6a….jpg` = 200 | key を既存側へ訂正 |
| `portfolio/foldlayers/thumbnail/f14bb0cd….jpg` | **404** | `portfolio/notion/f14bb0cd….jpg` = 200 | key を既存側へ訂正 |
| `portfolio/baramoji/thumbnail/02f697a7….jpg` | **404** | `portfolio/notion/02f697a7….jpg` = 200 | key を既存側へ訂正 |

- snapshot が参照する unique key 123 件を全数 HEAD し、404 は上記 3 件のみ。
- `contentDigest` は shipped な records から再計算した（`62d9423a…`）。ingest 実行時に記録した `df7b78a7…` は local-only key が混在した時点の値で、本文件の shipped 内容とは別物として扱う。
  訂正後は 123/123 が 200（バイトは同一 sha256 なので内容の欠落は 0）。
- 再発防止は runbook §6.1（commit 前の全 key 存在確認）に手順として記録した。
  根本原因は「local target の取り込み結果をそのまま commit できる」ことであり、
  ingest 側の target 契約は未決事項として残す（この PR では snapshot の値を
  実在する key に合わせるところまで）。
