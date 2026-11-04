# Notion への単発書き込み — 2026-11-04 実行記録

ADR-0018 §2.11。旧サイト `my-web-2025` の SQLite にしか存在しなかった
**ポートフォリオの画像と記事本文**を、Notion の各作品ページへ 1 回だけ投入した
operator 操作の記録である。

リポジトリ内の索引: `docs/verification/portfolio/notion-write-log.md`（1 回の実行につき 1 行）。

**この記録は操作の記録であり、作者の承認の代行ではない。**
投入後に Notion 上で何を公開するかは owner が決める（全ページ `Draft` のまま）。

## 1. 何を投入したか

| 対象 | 件数 | 出所 |
| --- | --- | --- |
| 記事本文 | 69 ページ | `markdown_pages.body`（+ `contents` メタデータ） |
| 画像 | 137 ファイル / 114,950,713 B | `media.data` BLOB |
| うち本文中の位置を保って配置 | 115 ファイル | 記事本文の `<Image>` 参照 |
| うち本文に参照が無く `Evidence > Media` に配置 | 22 ファイル | DB が所有するが本文に無い |
| 外部URL画像（DBにバイト無し） | 8 | 旧ページの hotlink（`booth.pximg.net` / `pbs.twimg.com` / `ube-k.ac.jp`） |
| 失われた画像参照（旧データに src 無し） | 2 | `test-otu-2-3q` / `test-otu-4-2q` |

旧テストフィクスチャ（`media-list-*` / `media-rt-*` の 160 ファイル / 2,840 B）は
対応する Notion ページが無いため投入しない。137 + 160 = 297、
114,950,713 + 2,840 = 114,953,553 で旧 DB の総数に一致する。

## 2. 帰属の決め方（重要）

- **画像**: `media.content_id` ではなく、その DB が持つ唯一の `contents.id`。
  25 行は `content_id` が NULL だが、DB が作品を所有している。
- **本文**: `frontmatter.slug`。旧エクスポートは 2 記事を別 DB へ重複して
  書き出しており（`prototype` → `content-ProtoType-brochure.db`、
  `aulymo-v02` → `content-aulymo_v03.db`）、ファイル位置は同一性ではない。
  その結果 `aulymo-v03` と `prototype-brochure` は**本文が存在しない**
  （メタデータと画像のみ。ページは作られ、本文は投入できていない）。

## 3. 構造の写し方

Notion は表計算ではない。各ページは次の構造を持つ記事として書かれた。

```
heading_2 Motivation
  summary（contents.summary）
heading_2 Implementation
  旧記事の見出し → heading_3（原文のまま）
  段落 / 画像（元の位置）/ 箇条書き / divider / リンク
heading_2 Evidence
  Links / Media 系の見出し配下のリンク
  本文に参照の無い画像（heading_3 Media）
```

- `<Bookmark url>` → `bookmark` ブロック（134）
- `<Spacer>` → `divider`（20）
- `<Html><iframe youtube>` → YouTube への `bookmark`（51）
- `<Html><blockquote twitter-tweet>` → ツイートへの `bookmark`（9）
- `<Image src>` → `image`（`file_upload`）を**元の段落位置**に挿入
- 冒頭段落が summary と同一の場合は 1 回に畳む（二重表示の回避）

## 4. 実行結果（`/tmp` の `notion-verify-all.json` 実測）

- 書き込み: **69 ページ**（既存 68 + 新規作成 1 = `FlashBeat-BGM`）
- 追記ブロック: **916**
- 画像ブロック: **146**（ローカル投入 138 配置 / 137 ユニークファイル、
  外部URL 8）。アップロード失敗 0。
- リンク（bookmark）ブロック: **194**（旧記事の 134 + 埋め込み 60）
- 既存スキャフォールド（`heading_2 Motivation` + summary の 2 ブロック）は
  本文の追記成功後にのみ削除した。削除は 68 ページ × 2 = **136 ブロック**。
- 各ページの書き込み前ブロックは一時領域 `notion-backup/<contentId>.json` に保存した
  （リポジトリ外・一時ファイル）。
- 空ページ 0、失敗 0。

| block 種別 | 件数 |
| --- | --- |
| heading_2 | 148 |
| paragraph | 323 |
| heading_3 | 73 |
| bookmark | 194 |
| divider | 20 |
| image | 146 |
| bulleted_list_item | 12 |

本文が旧DBに存在しない 2 記事（`aulymo-v03` / `prototype-brochure`）は、
`Motivation` + summary のみのページになった。**これは未達であり、未達として残す**
（本文を捏造しない）。`prototype-brochure` の画像 2 ファイルは
`Evidence > Media` に配置した。`aulymo-v03` は画像も持たない。

## 5. 読み込み側は未対応のまま

投入により各ページに `image` と `bookmark` ブロックが現れた。
`scripts/_notion-mapper.mjs` はこの 2 種を未対応として返すため、
`sync-portfolio-notion.mjs` は**これらのページで fail-closed する**。
これは意図した状態である（沈黙して落とさない）。読み込み対応は Issue #889。

## 6. 付随して分かったこと

- 旧DBの `markdown_pages` は 69 行、うち 2 行は重複書き出し。実記事は 67 本。
- `contents` は 149 行（うち 80 行が旧テストフィクスチャ）。
- 以前の一時領域 `notion-upload-state.json` には 2 件の「投入済み」記録が残っていたが、
  対応するブロックは存在しなかった（中断した実行の残骸）。この記録は破棄する。
