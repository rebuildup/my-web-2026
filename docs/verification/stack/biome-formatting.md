# Issue #382 — `/stack`「コード品質・Biome」節の検証記録

> `/stack` に追加した Biome 節の**検証記録**です。gate の仕様書ではなく、
> 掲載した設定値・コードサンプルが実際の `biome.json` と実バイナリの
> 出力に基づくことの再現手順と、1 行圧縮案の採否判断を記録します。

## 範囲

- `src/routes/stack/stack.ts` に `id: 'biome'` の節を追加（セクション配列の末尾）。
- 設定値テーブルは `biome.json` を `?raw` import してリクエスト時に抽出
  （`src/routes/stack/biome-facts.ts`）。手書きの値の転記はしていない。
- before / after と圧縮案の比較は `stack.ts` 内のコミット済みサンプル
  （`BIOME_SAMPLE_*`）。「Biome 適用後」は実バイナリの stdout。

## 掲載した実設定値（`biome.json` 由来）

ページの表は `extractBiomeSettings()` が `biome.json` から抜き出す行で、
現在のファイルが宣言する値は次のとおり（`pnpm exec biome --version` = 1.9.4、
`quality/profile.yaml` の `stack.format_lint: biome@1.9.x` と一致）。

| キー | 値 |
| --- | --- |
| `formatter.enabled` / `indentStyle` / `indentWidth` / `lineWidth` / `lineEnding` | `true` / `tab` / `2` / `100` / `lf` |
| `javascript.formatter.*` | `quoteStyle: single`、`jsxQuoteStyle: double`、`semicolons: always`、`trailingCommas: all`、`arrowParentheses: always` |
| `organizeImports.enabled` | `true` |
| `linter.enabled` / `rules.recommended` | `true` / `true` |
| `linter.rules` の個別上書き | `suspicious.noExplicitAny: warn`、`complexity.noBannedTypes: error`、`style.noNonNullAssertion: warn` |

## 再現手順（formatter CLI 入力）

掲載した「変換前 → Biome 適用後」は次の入力に対する実出力。

```sh
# 入力ファイル（before）を用意して:
cat before.ts | pnpm exec biome format --stdin-file-path=sample.ts
```

- 入力: `BIOME_SAMPLE_BEFORE`（`stack.ts` にコミット済み。インデント無し・
  ダブルクォート・セミコロン無し・100 桁超の 1 行呼び出し）。
- 出力: `pnpm exec biome format` の stdout が
  `BIOME_SAMPLE_AFTER`。末尾改行を除き byte 一致。
- 確認した挙動: オブジェクト型が複数行に展開され trailing comma が付き、
  `??` の両側に空白、文字列は single quote、インデントは tab、
  文末に semicolon、100 桁を超える呼び出しは引数が 1 行 1 要素に分割される。

### build / lint 側の再現

```sh
pnpm run format:check   # biome format .（read-only。差分があれば失敗）
pnpm run lint:check     # biome lint .（read-only）
pnpm run validate:fast  # format:check を先頭工程に含む gate 一式
```

`biome.json` の `files.ignore` と `vcs.useIgnoreFile` が効くため、
検証は常に「コミット済み tree に対する `biome format .` / `biome lint .`」
の結果として再現できる。サンプルの「適用後」が `format:check` を通る
形であることも、この 2 コマンドが exit 0 であることで担保される。

## 1 行圧縮案との比較と採否

Issue #382 のユーザー案「コード読まない前提で改行・インデントを圧縮し
1 行にする」案を、同じ関数で比較した。

- **1行圧縮案**: `BIOME_SAMPLE_COMPRESSED`。シグネチャを最小化し、
  オブジェクトリテラルを 1 行に保持（呼び出し行だけで 100 桁を大きく超過）。
- **現行（lineWidth: 100）**: `BIOME_SAMPLE_AFTER`。

実測: 圧縮案を `pnpm exec biome format --stdin-file-path=sample.ts` に
通すと、幅超過のため `BIOME_SAMPLE_AFTER` と同じ形に**再展開**される
（引数名 `i` / `item` の差のみ）。つまり現行の format policy の下では
圧縮形は formatter に拒否され、`format:check` が常時 fail する。

**採否: 保留（defer）。** 理由:

1. 圧縮は formatter が維持する可読性の契約 — 折り返し位置、
   trailing comma、字下げの一貫性 — と正面から競合する。
2. `lineWidth: 100` は「幅に収まる限り 1 行」を意味し、収まらない
   コードを 1 行に潰すことを許さない。圧縮を維持するには
   `lineWidth` の撤廃か第 2 の整形パスが必要で、単一 formatter
   （`format:check` 1 本）という現在の gate 構成を壊す。
3. Issue #382 の範囲は「比較と採否理由の記録に限定し、本番全体の
   format policy を暗黙に変更しない」。採用する場合は別 Issue と
   ADR 相当の判断が必要。

## スクリーンショット

- `docs/verification/stack/biome-config.png` — 設定値テーブル部分。
- `docs/verification/stack/biome-before-after.png` — before / after と
  圧縮案比較のコードブロック部分。

撮影対象は `pnpm dev`（vite dev）で配信した `/stack` の
`[data-testid="stack-settings-biome-config"]` /
`[data-testid="stack-samples-biome-format-sample"]` /
`[data-testid="stack-samples-biome-compression-decision"]`。
