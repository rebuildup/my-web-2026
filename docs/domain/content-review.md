# 公開 copy の review date 契約

> Status: **Canonical content-review policy**
> Visibility: public (MIT)
> Audience: contributor, agent, future-self
> 正本: [`../../quality/stale-content-review.json`](../../quality/stale-content-review.json)（owner の記録）
> 検査: [`../../scripts/check-stale-content-review.mjs`](../../scripts/check-stale-content-review.mjs)（`pnpm run copy:stale:check`）
> 運用手順: [`../runbook/stale-content-review.md`](../runbook/stale-content-review.md)
> 検証記録: [`../verification/content/stale-copy-review.md`](../verification/content/stale-copy-review.md)
> Enforced by: `pnpm run copy:stale:check`（`validate:fast` の一部）

## 1. 結論

**「今」を指す公開文言は、時間とともに古びる。** だからその文言ごとに
**owner が最後に読んだ日付**（review date）を記録し、日付が window を
越えたら **review pending** として機械的に列挙する。

ただし gate が言うのは **「まだ読まれていない」** だけである。

| | gate が言う | gate が言わない |
| --- | --- | --- |
| 古い review date | 「この文は owner が最近読んでいない」 | 「この文は誤っている」 |
| 記録が無い文 | 「この文の review date が無い」 | 「この文を消せ」 |
| locale 未 opt-in | 「この locale は見ていない」 | 「この locale は無視してよい」 |

**unpublish（公開からの除去）は owner の決定**であり、この gate はそれを
強制しない。gate は **読むべきもの** を作るだけである。

## 2. review date とは

`quality/stale-content-review.json` の 1 レコードが、公開文言 1 個に対応する。

```jsonc
{
	"id": "contact-intro-current-only",
	"path": "src/contact/page.tsx",
	"expression": "現在利用可能な、用途別の contact channel だけを掲載しています。 掲載されていない channel",
	"locale": "ja",
	"dimension": "prose",
	"reviewedAt": "2026-10-22",
	"reviewedBy": "owner",
	"note": "…何と何を確認したかを prose で…"
}
```

- **`expression`** は表示文言の **byte-exact** な文字列。gate はこの文字列で
  照合する。template 展開を含む文では、記録する文字列は **ソース上の文面**
  （`${...}` を含む）であり、描画結果は data であって copy ではない。
- **`reviewedAt`** は owner がその文を **読んだ日**（`YYYY-MM-DD`）。その日
  に「まだそう書いてある」ことを確認した日である。
- **`reviewedBy`** は読んだ人。gate はその人の同一性を **検証しない**
  （実際の権限は PR review にある。AGENTS.md §6）。
- **`note`** は **何を確認したか** の prose。file と行で裏づけられなければ
  書かない（書けないものは「確認できなかった」と書く）。
- **`dimension`** は `prose` か `typography` のどちらか。この 2 つの分離の
  根拠は [`i18n.md`](./i18n.md) §5 が所有する（**本ファイルは再述しない**）。

### 記録は「文面」に紐づく

照合キーは `path` + `expression` である。したがって:

- **文を書き換えると記録は失効する。** 書き換え後の文は `unrecorded` として
  review pending に戻る。古い記録を別の文へ流用できない。
- 同じ file 内の同じ文面 2 箇所は 1 件の記録を共有する（行番号は照合キーに
  しない。1 行挿入で全記録が失効するのを避けるため）。

## 3. freshness window

`freshnessWindowDays`（現在 **90 日**）が「最近読み直された」とみなす期間である。
これは **読む間隔** であり、**真である期間** ではない。

- 変更箇所: `quality/stale-content-review.json` の `freshnessWindowDays`。
- 判定: `daysBetween(reviewedAt, today) <= freshnessWindowDays` なら `current`、
  超えていれば `stale`。
- `today` は UTC の日付。`--today=YYYY-MM-DD` で明示できる（テストと再現用）。

window を越えたことは、**文が誤っている**ことを意味しない。**owner が
最近読んでいない** ことである。gate はその 2 つを混ぜない。

## 4. locale は opt-in

`locales` が **走査する locale** の一覧である（現在 `["ja"]`）。一覧に無い
locale は **走査しない**。ただし **黙って無視しない**: レポートはその件数を
`not-scanned` として出す。

- 検出器は locale ごとの token 表を持つ（`LOCALE_TOKENS`）。locale を
  opt-in するには token 表に足すだけで済む。
- locale の考え方は [`i18n.md`](./i18n.md) §6（locale は必要な機能で
  opt-in）に従う。**本ファイルは再述しない**。
- `not-scanned` の expression は review queue に入らない。owner の review が
  要求される対象ではないため。

## 5. gate がすること / しないこと

**する**（3 つだけ）:

1. 宣言された公開 copy surface の中から「今を指す」文面を抽出し、owner の
   記録と照合する。
2. review pending（`stale` / `unrecorded`）を **review queue** として出す。
3. 走査しなかった locale と、記録が失効した（orphaned）記録を報告する。

**しない**:

- **`src/**` に書かない。** 公開されるものを変えない。`--out` が `src/` を
  指す場合は拒否して exit 2。
- **「誤り」と判定しない。** 文が untrue だと宣言しない。レポートの語彙は
  `review pending` であり、断定する verdict 語(words `false` / `unpublish` /
  `outdated`)を **使わない**。
- **書き換えない。** 置換文案を提案しない。owner の入力は review date と
  reviewer と note だけ。
- **未確認の書き換えを公開しない。** 文面を書く code path が存在しない。
- **採点しない。** 校正ツール（yomiyasu および同種）は **編集補助** であり、
  自動品質保証の証明ではない。本 gate は **Python を含む新しい runtime を
  追加しない**。

判定できないときは **fail-closed** で **exit 2**（registry が読めない、
record が壊れている、日付が parse できない、review date が未来）。

## 6. 対象範囲（宣言済み）

**対象**:

- `quality/copy-editorial-surfaces.json` が宣言する公開 copy surface
  （編集レビュー承認 gate と同じ宣言。**「公開 copy」の定義はこの
  repository に 1 つだけ**）。
- その中の **time token を含む segment**。

**対象外**（いずれも **宣言されたルール** であり、偶然ではない）:

| 対象 | 理由 |
| --- | --- |
| `src/editorial/error-states/**` | runtime message（障害時に機械が出す文）であり、公開内容についての主張ではない |
| `src/home/reactions/widget.tsx` のエラー文 | 同上（実行時に生成されるメッセージ） |
| 内部文書・skills・tests・Storybook | visitor-facing copy ではない（surface 宣言の外） |
| 時間幅だけがある文（例:「30 日以内」） | detector は「今を指す語」を探すのであって、時間帯を探すのではない |
| 生の JSX テキスト（英語） | 共有の segment 抽出は日本語しか見ない。英語の文は文字列リテラルからだけ採る |
| prose / typography そのもの | 判断は owner / font stack の仕事。gate は 2 つを分けて **報告するだけ** |

registry の `excludedPaths` と `excludedExpressions` は、**除外そのもの**を
owner データとして持つ。理由（reason）が書けない除外は書けない。

## 7. 検証方法

```bash
pnpm run copy:stale:check                       # テキストレポート
pnpm run copy:stale:check -- --format=json     # 機械可読
pnpm run copy:stale:check -- --format=html --out=.tmp/stale.html
node --test scripts/check-stale-content-review.test.mjs
pnpm run verify:stale-copy-review-screenshot    # 検証画像（WebP）の再生成
```

fixture は `test/fixtures/content/stale-review/` にあり、**live tree に
依存しない**。fixture は 4 状態（`current` / `stale` / `unrecorded` /
`not-scanned`）と typography dimension と「文を書き換えると記録が失効
する」ことを、1 つの小さな公開 copy tree で証明する。

**画像はテストの代用ではない。** 4 状態の検証は
`scripts/check-stale-content-review.test.mjs` が行う。

## 8. 関連 Issue との重複回避

- **#506**（`copy:approval:check`）: PR の **差分** に対する owner の承認。
  本 gate は **差分ではなくリポジトリの状態** を見る（更新日の管理）。
- **#428**（`copy:i18n:check`）: locale 契約 — 翻訳の網羅と fallback。
- **#433 / #432**（Unicode / glyph fixture）: 文字そのものの policy。
  本 gate は文字の **出所**（誰が決めたか）を問う。
- **#492**（`routes:quality:check`）: route roster と gate coverage の ledger。
  対象は route であり copy ではない。
