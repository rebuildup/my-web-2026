# 日本語 copy のレビュー対象レポート runbook (Issue #425)

> PR で変わった日本語の **訪問者可読テキスト** を集め、原文と変更後を並べて
> レビュー対象として提示するレポートの運用手順。
> 正本は
> [`quality/japanese-copy-review-surfaces.json`](../../quality/japanese-copy-review-surfaces.json)、
> [`scripts/collect-japanese-copy-review.mjs`](../../scripts/collect-japanese-copy-review.mjs)、
> [`scripts/_copy-japanese-diff.mjs`](../../scripts/_copy-japanese-diff.mjs)。
> Cross-linked from
> [`quality/profile.yaml`](../../quality/profile.yaml#japanese_copy_review)、
> [`copy/README.md`](../../copy/README.md)、
> [`docs/development.md`](../development.md)。

## 1. このレポートは gate ではない

Issue #425 は、Issue #506 と同じ「公開日本語のレビュー」という関心の
**収集・報告** 側である。役割は 2 つに分かれている。

| 問い | 担当 | 失敗するか |
| --- | --- | --- |
| この変更は **何を** 変えたか。原文は何だったか | **#425（本レポート）** | 失敗しない。`clear` / `review` / `attention` のいずれも exit 0 |
| この変更に **owner の承認記録** があるか | **#506** (`copy:approval:check`) | 承認が無ければ exit 1 |

本レポートは **承認しない・書き換えない・draft を公開しない**。承認台帳
(`quality/copy-editorial-approvals.json`) を読まないし、書かない。並んだ
文面を人が読むための材料を出すだけである。

`--strict` を明示したローカル実行だけが `attention` を exit 1 にする。
CI は `--strict` を渡さない。つまり **未レビューの文章は CI を落とさない**。
落とすのは #506 の承認 gate だけである。

## 2. 3 つの scope

| scope | 対象 | なぜ |
| --- | --- | --- |
| `article` | 記事 Markdown。現在は `src/portfolio/seed.ts` の Markdown 本文と、`content/articles/**/*.md` / `content/blog/**/*.md` | 記事本文は訪問者が読むが、#506 の surface 宣言は `**/*.md` を除外している |
| `about` | `src/about/**` の narrative prose | About は人物・経歴の説明であり、記事に近い読み物である |
| `ui` | #506 の `quality/copy-editorial-surfaces.json` が公開 copy と宣言したファイル | 定義を 2 つに増やさないため |

`quality/japanese-copy-review-surfaces.json` は `baseDeclaration` で #506 の
surface 宣言を指す。公開 UI copy と About の glob は #506 側に 1 つだけあり、
本レポートは記事 Markdown の glob と About のラベルだけを足す。
対象外のファイルは **理由付きで** レポートに並ぶ（黙って消えない）。

## 3. 状態と exit code

| status | 意味 | exit |
| --- | --- | --- |
| `clear` | 宣言された scope で日本語テキストが 1 つも変わっていない | 0 |
| `review` | レビュー対象がある。人が読むための一覧であり、失敗ではない | 0 |
| `attention` | 数値・否定・権限のマーカーが変わった、または credential 形の行を伏せた | 0（`--strict` なら 1） |
| （入力エラー） | base ref が無い / diff を計算できない / 宣言が読めない | 2 |

`review` と `attention` を分けるのは、**意味が変わりうる変更** を
「文章が変わっただけ」の列に埋もれさせないためである。

## 4. 意味マーカーの差分

各 review target について、原文と変更後の次を比較する。

| flag | 意味 |
| --- | --- |
| `number-drift` | 数値リテラルが片側にしか無い（追加・削除した数値も表示する） |
| `negation-drift` | 日本語の否定マーカー（`ない` / `ません` / `不可` / `禁止` など）の集合が変わった |
| `permission-drift` | 権限・公開範囲マーカー（`のみ` / `だけ` / `公開` / `削除` など）の集合が変わった |
| `claim-added` | 追加された文が数値・否定・権限を主張している（比較対象が無い） |
| `claim-removed` | 削除された文が数値・否定・権限を主張していた（比較対象が無い） |

マーカーは **集合** で比べる。たとえば `管理者のみが編集できます` から
`のみ` を落としても `編集` は残るので、boolean の「権限マーカーがあるか」では
差分を検出できない。集合比較なら `permission-drift` になる。

これは **heuristic** である。マーカー一覧は
`scripts/check-copy-i18n.mjs` の `NEGATION_MARKERS.ja` / `PERMISSION_MARKERS.ja`
を共有し、判定は「人が見る場所を指す」ために行う。意味の最終判断は人にある。

## 5. 対象から外すもの

| 対象 | 除外する理由 |
| --- | --- |
| 文字列リテラル以外のコード識別子 | 訪問者は読まない。`const 見出し = 1` のような宣言行は対象外 |
| コメント（`//` / `/* */` / `<!-- -->`） | 開発者向けの文書であり、公開文面ではない |
| Markdown の fenced code / indented code | コードは文章ではない |
| inline code span | 同上 |
| リンク先 URL / raw HTML tag | 表示されるのはリンクテキストであり、URL や tag ではない |
| credential 形の値 | レポートにも CI ログにも値を出さない（AGENTS.md §4） |

secret 形の判定は `scripts/_secret-scan.mjs` の `DETECTORS` と
`looksLikeCredentialValue` を再利用する。1 行でも一致したら、その行は
**丸ごと伏せる**。レポートに残るのは path / side / 行番号 / detector id だけである。

## 6. 実行

```bash
# テキスト（既定）
pnpm run copy:diff:report -- --base=release-0-7-0

# JSON（CI artifact と機械処理向け）
pnpm run copy:diff:report -- --base=release-0-7-0 --format=json \
  --out=.tmp/japanese-copy-review-report.json

# HTML（人が読む用）
pnpm run copy:diff:report -- --base=release-0-7-0 --format=html \
  --out=.tmp/japanese-copy-review-report.html

# attention をローカルで失敗扱いにする（CI は使わない）
pnpm run copy:diff:report -- --base=release-0-7-0 --strict
```

base ref は `--base` → `COPY_REVIEW_BASE` → `GITHUB_BASE_REF`（`origin/<ref>`）
の順で解決する。どれも無ければ exit 2。既定値は無い — 誤った base に対する
「変更なし」は、変更を隠すのと同じだからである。

diff base は #506 と同じ規則で決める。

1. `git merge-base <base> HEAD`
2. 無ければ head が merge commit（parent 2 つ以上）のときの first parent
3. どちらも無ければ exit 2

二点 diff (`git diff base HEAD`) は使わない。fork 後に動いた base ブランチの
文章まで「この PR の変更」として混ざるためである。

## 7. CI

`.github/workflows/ci.yml` の `validate` ジョブに 2 つのステップがある。

- `Japanese copy review targets` — `pull_request` イベントのみ。
  base ref を fetch し、JSON と text を `.tmp/` に出す。**失敗しない**
  （入力エラーを除く）。
- `Upload Japanese copy review report` — 同じ条件で
  `japanese-copy-review-report-<sha>` artifact を 30 日保持する。

`validate:fast` には入れていない。このレポートは **差分** を読むため、
オフライン・リポジトリ状態のみを対象とする `validate:fast` の契約に合わない。
`quality/profile.yaml#japanese_copy_review` に `gate: none` と
`informational: true` を明記してある。

## 8. 既知の限界（隠さない）

- **リポジトリに無い文章は見えない。** 本番記事が D1 または Notion import
  だけに存在する場合、PR の差分には現れない。したがって本レポートの
  `article` scope は「コミットされた記事本文」に限られる。この gap は
  declaration の `policy` と本節に書いてあり、推測で埋めない。
- **抽出は行単位のテキスト走査である。** 構文解析はしない。fenced code の
  状態はファイル全体から復元するが、Markdown の完全な CommonMark parse では
  ない。曖昧な行は **非 prose 側** に倒す（誤検出より取りこぼしを選ぶ）。
- **removed / added の対応は位置対応である。** 1 文の書き換えでは正しいが、
  複数 segment の一括差し替えでは対応がずれうる。ずれても segment 自体は
  列挙されるので、読むべき文章は失われない。
- **マーカー判定は heuristic である。** 否定・権限の語彙に無い表現や、
  文脈依存の含意（皮肉・婉曲）は検出しない。だからレポートは
  「これを読め」と言うだけで、「意味が同じ」とは言わない。
- **working tree の未コミット変更は CLI の diff に含まれない。**
  CLI は `<diff base>..HEAD` を読む。ローカルで未コミットの文章を見たい場合は
  commit してから実行する（CI は常に commit 済みの head を読む）。
- **locale opt-in には触れない。** どの capability がどの言語を公開するかは
  `copy/resources.json` の決定であり、本レポートは日本語テキストだけを扱う。

## 9. 検証と再現

```bash
# レポート（base を明示する）
pnpm run copy:diff:report -- --base=release-0-7-0

# fixture による status の検証
node --test scripts/collect-japanese-copy-review.test.mjs

# 検証画像（WebP）を再生成
pnpm run verify:copy-diff-report-screenshot -- --base=origin/release-0-7-0
```

fixture は `test/fixtures/copy/japanese-diff-review/` に 4 件ある。
credential の 1 件は **実行時に組み立てる**（token 形の literal を
リポジトリに置かないため）。

| fixture | status | 何を証明するか |
| --- | --- | --- |
| `modified-ui.json` | `attention` | UI 文面に数値が増えたとき `number-drift` を出す |
| `article-markdown.json` | `review` | 記事本文を集め、fenced code・inline code・日本語 URL を除外する |
| `meaning-risk.json` | `attention` | `のみ` を落とした権限変更を `permission-drift` として出す |
| `no-change.json` | `clear` | 英語値・コメント・日本語識別子は prose ではない |
| `secret-redaction`（runtime） | `attention` | credential 形の行を伏せ、値ではなく detector id だけを出す |

検証画像: [`docs/verification/copy/japanese-diff-report.webp`](../verification/copy/japanese-diff-report.webp)
（検証記録は
[`docs/verification/copy/japanese-diff-report.md`](../verification/copy/japanese-diff-report.md)）。

## 10. 関連 Issue との境界

- **#506** (`copy:approval:check`): 公開 copy の変更に owner の承認記録が
  あるかを問う **blocking gate**。本レポートはその台帳を読まない。
  同じ `scripts/_copy-japanese-diff.mjs` の抽出関数を使うので、2 つの
  レポートが同じ diff を別の文章として読むことはない。
- **#428** (`copy:i18n:check`): locale 契約と **組版**（行頭・行末の禁則、
  full-width 残留、spacing）の機械判定。組版の finding は本レポートの
  review target ではない。本レポートは文章そのものを列挙する。
- **#433 / #432**: Unicode・slug・glyph の policy。本レポートは文字の
  出所や URL 正規化には触れない。
- **#492** (`routes:quality:check`): route roster の ledger。対象は route であり
  copy ではない。
- **#508** (`release:gate:check`): release が実行する検査の ledger。本レポートは
  PR 差分を対象にするため release gate ではなく CI の `validate` ジョブに置く。
