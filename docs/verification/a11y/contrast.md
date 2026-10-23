# 本文と UI の色コントラスト AA を検証する（Issue #399）

> 検証対象: 出荷しているトークン層
> （`src/editorial/tokens.ts` の raw tokens と
> `src/editorial/semantic-tokens.ts` の semantic tokens）。
> 判定の物差しは [WCAG 2.2](https://www.w3.org/TR/WCAG22/) の
> **SC 1.4.3 Contrast (Minimum)（AA）** と、
> 同じ比率を UI 部品に適用する **SC 1.4.11 Non-text Contrast（AA）**。
>
> 判定は散文ではなく **実測** である。
> `scripts/check-a11y-contrast.mjs` が 2 つの TypeScript モジュールを
> 実際に import し、`{colors.brand.700}` 形式の参照を自前で解決して
> 比率を計算する。`src/editorial/colors.md` の散文は記録であり、
> 判定の物差しではない。

## 適用対象・対象外・基準

### 適用対象（この gate が判定するもの）

| 対象 | 測る組み合わせ |
| --- | --- |
| 通常テキスト | `text.default` / `text.muted` / `text.inverse` / `text.accent` と `bg.canvas` / `bg.surface` / `bg.subtle` / `accent.surface` / `bg.accent` / `bg.inverse` の組合せ |
| ステータスの文字 | `accent.positive` / `accent.negative` / `accent.warning` を `bg.canvas` 上に |
| 識別子としての色 | `accent.category.{design,code,writing,tool}` を `bg.canvas` 上に（非テキスト基準 3:1） |
| 非テキスト UI 部品 | `border.focus`（フォーカスインジケータ）/ `border.strong`（強調の境界線）を `bg.canvas` 上に（非テキスト基準 3:1） |

**2 つの appearance を両方** 測る。light は semantic token の `base`、
dark は `_dark`。片方だけで落ちた組合せは **その appearance だけ** を違反として出す。

### 対象外（意図的に除外したもの）

| 対象 | 除外の理由 |
| --- | --- |
| `border.subtle` | 装飾的なヘアライン区切りであり、それ自体は情報を持たない。SC 1.4.3 が 3:1 を求めるのは「UI 部品を識別する境界線」に対してであり、このトークンには該当しない。**黙って除外せず**、gate の出力にも本資料にも明記する。 |
| 画像・写真・グラデーション上の文字 | トークンの組合せではなく、背景画像との合成問題である。別領域の判断。 |
| 要素レベルの不透明度（`opacity: 0.85` の「Coming soon」カード等） | 要素・合成結果の領域であり、token 対の領域ではない。既存の DOM 級監査が別途記録している。 |
| 色そのものが「意味として正しいか」 | 機械では決められない。下記「人間の評価」。 |

### 基準

| 種別 | 比率 | 根拠 |
| --- | --- | --- |
| 通常テキスト | 4.5 : 1 | WCAG 2.2 SC 1.4.3（AA） |
| 大きなテキスト（>= 24 px、または >= 18.66 px の太字） | 3 : 1 | 同上 |
| 非テキスト UI 部品（フォーカスリング・境界線・識別色） | 3 : 1 | 同上 / SC 1.4.11（AA） |

比率は WCAG の相対輝度式で計算する。

```text
L_channel = c / 12.92                              if c <= 0.03928
L_channel = ((c + 0.055) / 1.055) ^ 2.4           otherwise
L = 0.2126 * R_lin + 0.7152 * G_lin + 0.0722 * B_lin
Contrast = (L_lighter + 0.05) / (L_darker + 0.05)
```

報告する数値は **小数 2 桁で、切り捨て**。4.499 は 4.50 と印字されない。

## 全組み合わせの測定値

`pnpm run a11y:contrast:check` の出力そのまま。light / dark の両列に
「前景 / 背景」の実値と比率を記す。

| 組み合わせ | light（前景 / 背景） | 比率 | dark（前景 / 背景） | 比率 | 基準 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| `text.default on bg.canvas` | `#0f172a` / `#ffffff` | 17.85 | `#f8fafc` / `#0a0b0e` | 18.81 | 4.5 (normal) | 本文（ページ） |
| `text.default on bg.surface` | `#0f172a` / `#f8fafc` | 17.06 | `#f8fafc` / `#111317` | 17.77 | 4.5 (normal) | 本文（カード面） |
| `text.default on bg.subtle` | `#0f172a` / `#f1f5f9` | 16.30 | `#f8fafc` / `#191b21` | 16.45 | 4.5 (normal) | 本文（淡い面） |
| `text.muted on bg.canvas` | `#475569` / `#ffffff` | 7.58 | `#8b9099` / `#0a0b0e` | 6.14 | 4.5 (normal) | 補助本文（ページ） |
| `text.muted on bg.surface` | `#475569` / `#f8fafc` | 7.24 | `#8b9099` / `#111317` | 5.80 | 4.5 (normal) | 補助本文（カード面） |
| `text.muted on bg.subtle` | `#475569` / `#f1f5f9` | 6.92 | `#8b9099` / `#191b21` | 5.37 | 4.5 (normal) | 補助本文（淡い面） |
| `text.muted on accent.surface` | `#475569` / `#f0f9ff` | 7.11 | `#8b9099` / `#151b26` | 5.38 | 4.5 (normal) | 補助本文（着色された特徴領域） |
| `text.inverse on bg.accent` | `#ffffff` / `#0369a1` | 5.93 | `#ffffff` / `#0369a1` | 5.93 | 4.5 (normal) | CTA ラベル |
| `text.inverse on bg.inverse` | `#ffffff` / `#0f172a` | 17.85 | `#ffffff` / `#0f172a` | 17.85 | 4.5 (normal) | 反転パネルのラベル |
| `text.accent on bg.canvas` | `#0369a1` / `#ffffff` | 5.93 | `#0ea5e9` / `#0a0b0e` | 7.10 | 4.5 (normal) | リンク |
| `text.accent on accent.surface` | `#0369a1` / `#f0f9ff` | 5.57 | `#0ea5e9` / `#151b26` | 6.23 | 3 (large) | 大きなリンク / 見出し（着色領域上） |
| `accent.positive on bg.canvas` | `#047857` / `#ffffff` | 5.48 | `#6ee7b7` / `#0a0b0e` | 12.91 | 4.5 (normal) | ステータス文字「正常」 |
| `accent.negative on bg.canvas` | `#be123c` / `#ffffff` | 6.29 | `#fda4af` / `#0a0b0e` | 10.41 | 4.5 (normal) | ステータス文字「異常」 |
| `accent.warning on bg.canvas` | `#b45309` / `#ffffff` | 5.02 | `#fcd34d` / `#0a0b0e` | 13.65 | 4.5 (normal) | ステータス文字「劣化」 |
| `accent.category.design on bg.canvas` | `#be185d` / `#ffffff` | 6.04 | `#f9a8d4` / `#0a0b0e` | 10.85 | 3 (non-text) | design カテゴリ識別子 |
| `accent.category.code on bg.canvas` | `#0e7490` / `#ffffff` | 5.36 | `#67e8f9` / `#0a0b0e` | 13.58 | 3 (non-text) | code カテゴリ識別子 |
| `accent.category.writing on bg.canvas` | `#a16207` / `#ffffff` | 4.92 | `#fde047` / `#0a0b0e` | 14.93 | 3 (non-text) | writing カテゴリ識別子 |
| `accent.category.tool on bg.canvas` | `#4338ca` / `#ffffff` | 7.90 | `#a5b4fc` / `#0a0b0e` | 9.87 | 3 (non-text) | tool カテゴリ識別子 |
| `border.focus on bg.canvas` | `#0284c7` / `#ffffff` | 4.10 | `#7dd3fc` / `#0a0b0e` | 11.80 | 3 (non-text) | フォーカスインジケータ |
| `border.strong on bg.canvas` | `#64748b` / `#ffffff` | 4.76 | `#6f747d` / `#0a0b0e` | 4.19 | 3 (non-text) | 強調の境界線 |

20 組合せ × 2 appearance = **40 行すべて適合**。

## 何を直したか

 Issue #399 の gate を書く前は **散文だけが source of truth** だったため、
 既に 2 つの「既知のギャップ」が `src/editorial/colors.md` に散文として
 残っていた。実測して **両方とも基準未満** であることを確認したので直した。

| 組み合わせ | 修正前 | 修正後 | 判定 |
| --- | --- | --- | --- |
| `text.muted` on `bg.subtle`（light） | `neutral.500` `#64748b` → 4.34:1 | `neutral.600` `#475569` → 6.92:1 | 4.5:1 未満だった |
| `text.muted` on `accent.surface`（light） | `neutral.500` `#64748b` → 4.46:1 | `neutral.600` `#475569` → 7.11:1 | 4.5:1 未満だった |

**選び方の根拠。**

1. まず **既存 raw ramp の別 step** を探した。`text.muted` の light step は
   `neutral.500` で、この ramp には 0 / 50 / 100 / 500 / 900 しかなく、
   500 より暗い唯一の step は `neutral.900`（＝ `text.default`、本文の色）である。
   也就是说、既存 ramp の別 step では「4.5:1 を満たす補助本文」は作れなかった。
2. そこで raw tokens に **新しい step `neutral.600`（`#475569`）** を足した。
   理由は `src/editorial/tokens.ts` に **英語** でコメントとして残してある
   （`src/**` に日本語テキストを追加しないという規約のため）。
3. **hue と彩度の意図は変えていない。** 同じ slate 系で、変わるのは明度だけ。
   「控えめな補助本文」というキャラクターは保たれている。
4. dark の step は `charcoal.400` のまま。dark 側は元から
   5.37:1 / 5.38:1 で基準を満たしており、**手は入れていない**。
   （ Issue #290 の dark rework で設計し直した値なので、
   此次の修正で触るとその判断を壊す。）

## 機械検査と人間の評価の区別

本 Issue の要求どおり、**機械で決まること**と**人が評価すること**を混ぜない。

### 機械検査（`pnpm run a11y:contrast:check` / `pnpm run capture:a11y-contrast`）

| rule | 内容 |
| --- | --- |
| `contrast-below-normal` | 通常テキストの組合せが 4.5:1 を下回る |
| `contrast-below-large` | 大きなテキストの組合せが 3:1 を下回る |
| `contrast-below-non-text` | 非テキスト UI 部品の組合せが 3:1 を下回る |
| `unresolved-token-reference` | semantic token が参照する raw token が解決できない（**推測で埋めない**） |
| `fixture-expectation-mismatch` | fixture の期待と実測が食い違う |
| `fixture-contract-missing` | fixture ディレクトリが無い、または Issue が要求するファイル数に足りない |

capture は **ブラウザ実測** でもう一度確かめる。各スウォッチについて
Chromium が返した **計算済みの foreground / background** から比率を
再計算し、gate が token モジュールから測った比率と突き合わせる
（許容 0.05）。描画された色が token の値と違えば **成果物を書かずに
exit 1** になる。

### 人間の評価（機械では判定しない）

- ステータスの色が **状態表現として adequate** か（緑が「正常」と読めるか）
- 4 つのカテゴリ hue がパレット変更後も **識別可能な距離** を保つか
- 写真・グラデーション・画像の上の文字のコントラスト
- 較正されていない / 品質が低い画面での見え方

この 4 項目は gate の出力でも「not machine-checked」として明示され、
検証画像の上部にも同じ文言が印字される。

## fixture

`scripts/fixtures/a11y-contrast/` に、gate が **実際に読む** fixture を置いている。
各ファイルは自分の期待（`pass` / `fail` / `unresolved`）を宣言し、
gate はそれに従って **違反**（`pass` の_expectation を破ったとき）または
**検出**（`fail` / `unresolved` の_expectation を満たしたとき）を報告する。

| ファイル | 期待 | 内容 |
| --- | --- | --- |
| `pass/01-normal-text-pair.json` | pass | 4.5:1 を満たす通常テキストの組合せ（実値） |
| `pass/02-non-text-and-large-pairs.json` | pass | 3:1 を満たす非テキストと大きなテキスト（raw 参照で書く） |
| `fail/01-below-normal-text.json` | fail | 4.5:1 を下回る通常テキスト |
| `fail/02-below-non-text.json` | fail | 3:1 を下回る非テキスト |
| `fail/03-unresolved-reference.json` | unresolved | 存在しない raw step を参照する semantic token |

`fail/` のファイルは「検出されるのが正解」なので、gate 自体は違反に数えない。
検出漏れ（期待した failure が出なかったとき）は
`fixture-expectation-mismatch` として gate を赤にする。
`pass/` のファイルで違反が出たら `contrast-below-*` として gate を赤にする。

## スクリーンショット

`docs/verification/a11y/contrast.webp`（Issue #399 が指定する
`contrast.png` の WebP 版。PNG はリポジトリに置いていない — capture script が
`.png` を **拒否** する規約のため）。

- 生成: `pnpm run capture:a11y-contrast`
- 左: light appearance のスウォッチ列、右: dark appearance のスウォッチ列
- 各スウォッチ: 実際の前景色 / 背景色で文字を描画し、その場で
  **計測比率**（例 `7.58:1 · needs 4.5:1 · PASS`）を併記
- 上部: 検証レポート（機械検査項目・人間評価項目・除外した token・WCAG 対応）
- 失敗条件: 描画された色と gate の計測が食い違う場合、
  **成果物を書かずに exit 1**

## 検証コマンド

```bash
pnpm run a11y:contrast:check        # 機械検査（gate）
pnpm run capture:a11y-contrast      # Chromium で実測して WebP を生成
node --test scripts/check-a11y-contrast.test.mjs
```

## 機械検査が誤検知したら何をするか

比率の測定に誤検出しうるのは、**マトリクスに無い組合せ**，
または**別 appearance で測るべき組合せを混ぜた**場合である。

1. まず `pnpm run a11y:contrast:check` の出力を読み、
   該当行の `fg` / `bg` / appearance を確認する。
2. その組合せが本物なら、**token を直す**（基準を満たす step を選ぶ）。
   散文だけの直しは不可 — 散文は結果であって原因ではない。
3. 誤検知であれば、**マトリクスの宣言を直す**（`CONTRAST_PAIRS`）。
   gate 自身を緩める形での修正ではなく、
   「この組合せは対象外」という **決定** として
   `EXCLUDED_TOKENS` に理由付きで書き出す。
4. その判断は `src/editorial/colors.md` と本資料に追記する。
   黙って基準を下げない。

## 既知の制約

- **`text.muted` の light step は全ページで 1 段濃くなった。**
  hue と彩度は変えていないが、「控えめ」の度合いは変わっている。
  見た目の判断は owner のものである。
- **要素レベルの合成（祖先 `opacity`）は対象外。**
  `/tools` の "Coming soon" カード（`opacity: 0.85`）は、
  描画上 `text.muted` が 3.56:1 まで落ちる。`src/editorial/colors.md` に
  記録済みの既存の事項で、本 Issue の token 対の領域外である。
- **色の意味の適切さは人の評価。** 上記「人間の評価」のとおり。
