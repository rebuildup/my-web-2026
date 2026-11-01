# 公開 article の freshness review — source inventory の運用 (Issue #723)

> 「公開 article の文言は古びるか」を問う gate（Issue #437）が、**どの article
> source を実際に読んだのか** を記録する手順。
> 契約の本文は [`../domain/content-review.md`](../domain/content-review.md)、
> owner の記録の正本は
> [`../../quality/stale-content-review.json`](../../quality/stale-content-review.json)、
> 検査は
> [`../../scripts/check-stale-content-review.mjs`](../../scripts/check-stale-content-review.mjs)。
> Issue #437 の運用手順は
> [`stale-content-review.md`](stale-content-review.md)。

## 1. 何が問題か

Issue #437 の gate は「公開 copy の surface 宣言」
（`quality/copy-editorial-surfaces.json`）が **宣言したファイルだけ** を
読んでいた。その宣言は `**/*.md` を除外し、gate の extension 表にも
Markdown が無い。

つまり:

- **article Markdown（`content/**`）は一度も読まれなかった。**
- `src/portfolio/seed.ts` のような article 相当の本文は、
  `src/portfolio/**` が surface 宣言に含まれていたから **たまたま** 読まれて
  いた（article として読まれたのではない）。
- Issue #425 の日本語 copy review 宣言は `content/articles/**` と
  `content/blog/**` を「article Markdown である」と宣言しているが、その
  宣言は **PR 差分 collector だけ** が読んでいた。

その状態で gate が緑になると、**「article の本文が 1 通も読まれなかった」**
ことを読者が「article は review 済みだ」と誤読する。

Issue #723 の答えは、**読む対象を明示的に列挙し、その差分を fail-closed で
記録する** ことである。

## 2. 2 つの review は別の質問

| | Issue #425 | Issue #437 |
| --- | --- | --- |
| 問い | この PR は文言を変えたか | この time-sensitive な主張は今も真か |
| 入力 | PR 差分 | リポジトリの状態 |
| 出力 | レビュー対象の一覧 | review date の queue と source inventory |
| 判定 | しない | しない（真偽も公開範囲も判定しない） |

**2 つの review は混ぜない。** 互いに前提にしない。#425 の宣言は #437 から
**読むだけ**（cross-check 用）で、#437 の registry は #425 から読まない。
gate が #425 の collector を起動することも、#425 の gate が #437 の registry
を書くこともない。

## 3. source inventory（gate が出す表）

`node scripts/check-stale-content-review.mjs` は「Public article sources
(Issue #723)」の節を出す。1 source = 1 record で、次のことを全部言う。

| 項目 | 意味 |
| --- | --- |
| `id` / `kind` | source の識別子。`repository`（tree 内の glob）か `external`（repository 外） |
| `files` / `scanned` | 今のファイル数と、**gate が実際に読んだ**ファイル数 |
| `status` | `scanned` / `declared-but-absent` / `unobserved` |
| `registry` | registry のカバー状況：`covered` / `outstanding` / `not-applicable` |
| `expressions` / `recorded` / `waiting` | 時間語を含む文面数 / 記録がある数 / 記録待ちの数 |
| public surface | どの route が描画するか（`/portfolio`, `/portfolio/<slug>` …） |

### 3.1 現在の repository における inventory

| id | kind | path / glob | 存在 | offline で読める | gate が読む | status | registry |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `portfolio-seed` | repository | `src/portfolio/seed.ts` | あり（1 file） | yes | yes | `scanned` | `covered` |
| `content-articles` | repository | `content/articles/**/*.md` | **なし**（`content/` ディレクトリ自体が無い） | 該当なし | no | `declared-but-absent` | `not-applicable` |
| `content-blog` | repository | `content/blog/**/*.md` | **なし** | 該当なし | no | `declared-but-absent` | `not-applicable` |
| `portfolio-d1-rows` | external | Cloudflare D1（`env.DB`） | 不明 | **no** | no | `unobserved` | `not-applicable` |
| `notion-import` | external | Notion import | 不明 | **no** | no | `unobserved` | `not-applicable` |

**この表が言っていること:**

- 公開 portfolio route が **実際に描画する** article 本文は D1 の
  published row であり、repository にあるのは seed skeleton だけである。
  つまり **公開本文の鮮度は offline では観測できない**（`unobserved`）。
- `content/` 配下の article Markdown は **宣言はあるがファイルが無い**。
  これは repository の事実であり、**「review 済み」ではない**。
- seed の 1 文面だけは registry に記録があり `covered`。

### 3.2 fail-closed

| 状況 | inventory の status | gate の exit |
| --- | --- | --- |
| source が宣言されているがファイルが無い | `declared-but-absent` | 影響なし（ただし記録される） |
| ファイルは在るが gate が読めない型 | `unobserved`（理由つき） | 影響なし（ただし記録される） |
| repository 外の source | `unobserved` | 影響なし（ただし記録される） |
| source の宣言 JSON が壊れている | — | **exit 2** |
| registry が壊れている | — | **exit 2** |

**緑 = 「registry が、registry が覆っている surface を覆っている」** だけである。
**「article は review 済み」ではない。** gate の report はこの区別を
文で明示する（"it does NOT mean the article surfaces were audited"）。

## 4. 新しく走査する article surface の扱い

article source のファイルに owner record の無い時間語つき文面が見つかると:

- その文面は **outstanding** として **inventory と report に載る**。
- ただし **gate failure にはしない**。閉じる唯一の手段が「owner が registry に
  記録を書く」こと인데、registry を書けるのは owner だけである
  （Issue #720 の「誰が書いてよいか」は未決のまま）。
- 黙って無視もしない。件数も file:line も報告する。

public copy surface（#506 の宣言に含まれるファイル）の文面だけは
従来どおり **review queue に入り、exit 1** になる。そこは owner が既に
把握している surface だからである。

## 5. 運用

### 5.1 日常

```bash
pnpm run copy:stale:check
```

- exit 0 … review queue は空。**あわせて inventory を読むこと。**
- exit 1 … public copy surface に review pending がある。
- exit 2 … 判断できない（registry / source 宣言が壊れている）。

### 5.2 article source を増やすとき

1. `scripts/check-stale-content-review.mjs` の
   `DEFAULT_ARTICLE_SOURCES` に 1 件足す（`id`, `kind`, `globs`, `routes`,
   `description`）。
2. それが **owner decision** である理由（どの route が描くか /
   なぜ公開文言であるか）を `description` に書く。
3. `node --test scripts/check-stale-content-review.test.mjs` で
   inventory が `scanned` になることを確認する。

宣言は **gate が読むだけ** である。gate 自身は source を追加しない。

### 5.3 `content/` に article Markdown を置くとき

- `content/articles/**/*.md` は宣言済みなので、置けば自動的に走査される。
- 置いた直後は文面が `unrecorded` になる。**gate は赤にならない**
  （outstanding として報告されるだけ）。
- owner が `quality/stale-content-review.json` に record を書くと
  `covered` になる。

## 6. 対象外（宣言済みの対象外）

| 対象 | 理由 |
| --- | --- |
| PR 差分に基づく文言 review | **Issue #425 の仕事**。本 gate は差分を見ない |
| prose / typography の評価 | owner と font stack の仕事。gate は 2 つを分けて報告するだけ |
| **公開からの除去** | **owner の決定** |
| registry への record の追加 | **owner の決定**。gate は registry を書かない（どんな exit code でも書かない） |

## 7. 再現

```bash
# gate 単体（inventory つき）
pnpm run copy:stale:check

# JSON（機械可読な inventory）
node scripts/check-stale-content-review.mjs --format=json

# HTML レポート
node scripts/check-stale-content-review.mjs --format=html \
  --out=.tmp/stale-content-review.html

# fixture による inventory の検証（absent / unscanned / outstanding）
node --test scripts/check-stale-content-review.test.mjs
```

fixture は `node --test` が一時 directory に作る。**repository には fixture
file を追加しない**（gate のテストは自分の宣言を自分で壊して
fail-closed を確かめる）。

## 8. 既知の限界（隠さない）

- **D1 の published row は観測できない。** `/portfolio` が描くのは
  repository の seed ではなく D1 である。offline で分かるのは seed の
  文面だけである。
- **Notion import の中身は観測できない。** import は repository の外で
  走る。
- **article source の宣言は明示的なので、漏れると「読んでいない」まま
  緑になる。** そのため `content/**` のような新しい公開場所を作る時は
  宣言を足すこと（§5.2）。cross-check が、#425 の宣言と食い違っていない
  かを報告する。
- **Markdown の文面単位は段落（block）である。** code fence は読まない。
- **gate は「古いかどうか」を判定しない。** 判定するのは owner である。
