# `/design-system` colour section — colour-as-surface rebuild (Issue #812)

対象: `/design-system` の 01 Color セクションを「色が主体」の構成に組み直した記録。
base: `release-0-8-1` / base head `4778028c`（#806 着地済み）。
branch: `812`。

決定事項（Issue #812 の spec §0 / summary D1–D9）は再判断していない。案 III
（色面として出す分類は `design` / `code` / `writing` の 3 系統のみ）、純白の
surface からの引退、状態の分類色借用、操作は墨、の 4 点を不変条件として
実装した。

---

## 1. 変更内容

| ファイル | 変更 |
| --- | --- |
| `src/editorial/tokens.ts` | `neutral` に `25: { value: '#fcfcfd' }` を `0` の直後に追加。`0` および他の step の値は不変。 |
| `src/editorial/semantic-tokens.ts` | `bg.canvas.value.base` を `{colors.neutral.25}` に。`_dark`（`charcoal.950`）は不変。 |
| `src/editorial/colors.md` | surface ladder を `0 → 50 → 100` から `25 → 50 → 100` に。foreground 検査の基準を `neutral.25` (`#fcfcfd`) に直し、`neutral.0` が `text.inverse` 専用になった旨を 1 文追加。light の数値表を変更した行だけ `#fcfcfd` canvas / Issue #812 の値に差し替え（表の行は削除していない）。 |
| `src/routes/design-system/DesignSystemPage.tsx` | `ColorSection()` のみ置換: `sectionStyle`（borderTop + 白地）をやめ `backgroundColor: 'bg.subtle'`、`variant="spread"` を外して `SectionHeading` の縦積みにする、`data-colour-section` を付ける。冒頭の読み順コメントの 01 行を「3 分類の色面 + 状態借用 + 操作墨 + token 台帳」に更新。他 section は不変。 |
| `src/routes/design-system/sections/ColorSwatches.tsx` | 全面書き換え。旧 `PANE` / `SwatchTile` / `SwatchPane` / `data-token-swatch` を削除。3 分類の triptych（light field の内側に dark inset）、状態を借りる 2px ルール 3 本、墨の CTA 1 つ、21 token の text 台帳。コントラスト計算（`hexToRgb` / `relativeLuminance` / `contrastRatio` / `pickInk`）は client 側に残す。 |
| `src/routes/design-system/sections/StatusAccents.tsx` | カードの chrome（border / radius / `bg.canvas`）と category の 4px 左 border を削除。状態・分類の `StateMark` を語の左に置き、色は 8px の mark だけに限定。`CATEGORY_BORDER` を `CATEGORY_MARK` に置換し、`cx` import を削除。 |
| `src/routes/__root.tsx` | light の `theme-color` を `#ffffff` → `#fcfcfd`（browser chrome を page 地色に一致）。dark の `#0a0b0e` は不変。 |

### 1.1 bundle 面の追補（CI `bundle:budget:check` 指摘への対処）

| ファイル | 変更 |
| --- | --- |
| `src/routes/design-system/tokens.ts`（新規） | semantic token の path → hex 解決を server function として持つ。browser は 24 組の hex を受け取るだけで、raw palette 全体と semantic layer 全体を受信しない。 |
| `src/routes/design-system.tsx` | route に loader を追加し、解決済みの token データを page に props として渡す。 |
| `src/routes/design-system/DesignSystemPage.tsx` | `tokenData` を受け取り `ColorSwatches` へ渡す。 |
| `src/editorial/tokens.ts` | `spacingTokens` を独立 export として追加（`rawTokens.spacing` と同じオブジェクトの projection）。spacing ruler が palette 全体を browser に載せるのを防ぐ。 |
| `src/routes/design-system/sections/SpacingRuler.tsx` | import を `rawTokens` から `spacingTokens` に変更（描画は不変）。 |
| `scripts/publication-surface.mjs` | 新規の route ディレクトリ内ファイル `src/routes/design-system/tokens.ts` を `ROUTE_DIR_INERT_FILES` に宣言。 |
| `test/integration/privacy-projection.test.ts` | 「`/design-system` has no loader」というコメントを実態に合わせる（宣言のみ）。 |

### 1.2 新しい colour section の構成

| 帯 | 中身 | 色の扱い |
| --- | --- | --- |
| triptych | `design` / `code` / `writing` の 3 枚の色面（light field ＋ 内側の dark inset） | 分類色。位置 01/02/03 と `StateMark` の形と語が分類を担い、色は第 4 チャネル |
| 状態 | Done / In progress / Failed の 3 行 | 分類色を **借りる** 2px ルール（608 px²/本）。状態の hue は足さない |
| 操作 | `Continue` 1 つ | 墨（`bg.inverse` / `text.inverse`） |
| Token 台帳 | 21 token の path と light / dark hex | 無彩色（テキストのみ） |

彩色は「面」「2px ルール」「8px mark」の 3 経路だけ。テキストに色塗りは
していない（`accent.category.*` を `color:` として使っていない）。

---

## 2. 純白の決定（tokens）

**`neutral.0` (`#ffffff`) は surface role から引退した。** `bg.canvas` の light
を新 step `neutral.25 = #fcfcfd` に移し、`neutral.0` は `text.inverse`（暗い面
の真白文字）と `src/home/mark.tsx` の icon knockout にだけ残す。surface とし
て bind する semantic token は残っていない。

`neutral.50` に移さなかった理由: `bg.canvas` と `bg.surface` が同値になり、
`bg.surface` を `neutral.100`、`bg.subtle` を新 step に落とす連鎖が要る。#804
で調整した secondary CTA の fill（`bg.subtle`）まで変わるため、本 Issue の
範囲外。

`neutral.0` の値自体を変えない理由: `text.inverse` は暗い CTA 上の文字で、
真白を維持するのが正しい。値変更では CTA 文字のコントラストが 17.85 →
17.41 に下がる（許容範囲だが、変える理由がない）。

### 2.1 light canvas の before / after（実測）

| pair | before (`#ffffff`) | after (`#fcfcfd`) |
| --- | --- | --- |
| `text.default` `#0f172a` on canvas | 17.85 | 17.41 |
| `text.muted` `#475569` on canvas | 7.58 | 7.39 |
| `border.strong` `#64748b` on canvas | 4.76 | 4.64 |
| `text.accent` `#0369a1` on canvas | 5.93 | 5.79 |
| `accent.positive` `#047857` on canvas | 5.48 | 5.35 |
| `accent.negative` `#be123c` on canvas | 6.29 | 6.13 |
| `accent.warning` `#b45309` on canvas | 5.02 | 4.90 |
| `accent.category.design` `#be185d` on canvas | 6.04 | 5.89 |
| `accent.category.code` `#0e7490` on canvas | 5.36 | 5.23 |
| `accent.category.writing` `#a16207` on canvas | 4.92 | 4.80 |
| `accent.category.tool` `#4338ca` on canvas | 7.90 | 7.71 |
| canvas vs `bg.surface` `#f8fafc` | 1.046 | 1.020 |
| canvas vs `bg.subtle` `#f1f5f9` | 1.093 | 1.068 |

**trade-off**: すべての前景 token は AA を維持する（最小 4.64 = `border.strong`、
通常テキストは 4.71 以上）。一方で canvas と surface の差は 1.046 → 1.020 に
縮む。`bg.surface` の識別は色差ではなく内容と余白が担う。カード面と page 地の
差は 1.02 : 1 しかないので、frame は border ではなく余白で組む必要がある
（本 Issue の colour section は `bg.subtle` を下地にし、中性階調で階層を作って
いる）。

---

## 3. タイル別コントラスト

「frame」= section 下地 `bg.subtle` `#f1f5f9`。「swatch」= 分類色の light field。
dark 値は light field の**内側の inset**。

| family | swatch vs frame | text vs swatch | dark inset vs light field | text vs dark inset |
| --- | --- | --- | --- | --- |
| design | 5.51 | 5.77 | 3.33 | 9.84 |
| code | 4.89 | 5.12 | 3.70 | 12.32 |
| writing | 4.49 | 4.71 | 3.73 | 13.54 |

必須値の判定（すべて満たす）:

- swatch vs frame ≥ 4.4 → 最小 4.49（writing）
- text vs swatch ≥ 4.5 → 最小 4.71（writing）
- dark inset vs light field ≥ 3.0 → 最小 3.33（design）
- text vs dark inset ≥ 4.5 → 最小 9.84（design）
- section 下地の文字: `text.default` 16.30 / `text.muted` 6.92
- 墨 CTA: `#ffffff` on `#0f172a` = 17.85

ink は `pickInk()` の結果だけを使う。候補は `text.default` light (`#0f172a`)
と `bg.surface` light (`#f8fafc`) の 2 つで、light field には `#f8fafc`、
dark inset には `#0f172a` が選ばれた（実測 `data-contrast` は下表）。

---

## 4. 実測

測定: `.tmp/preview/capture-812.mjs after`（1440×900 / 390×844、light、
reducedMotion `reduce`、同意帯は DOM から除去）。section 要素のスクリーンショット
を quality 82 の WebP で保存。

### 4.1 色相（§5-2）

| viewport | `[data-coloured][data-hue]` の unique hue | 判定 |
| --- | --- | --- |
| 1440 | `design`, `code`, `writing`（3） | 3 / 3 一致 |
| 390 | `design`, `code`, `writing`（3） | 3 / 3 一致 |

`[data-coloured]` の要素数は 6（3 plate + 3 status rule）。`tool` は色面に
出ていない（token は台帳に残っている）。

### 4.2 彩色面積（§5-3）

| viewport | `[data-coloured]` の rect 合計 | section rect | 割合 |
| --- | --- | --- | --- |
| 1440 | 309,024 px² | 1,958,269 px² | 15.8 % |
| 390 | 292,094 px² | 977,412 px² | 29.9 % |

閾値なし（標本）。**5 % を超える理由**: この section の主題そのものが「色」
であり、3 枚の分類色面が画面を覆うのが設計意図である。製品画面（home 等）
が持つ 2.7 % とは別の指標で、この section の外（状態帯の説明・操作帯・token
台帳）はすべて無彩色である。台帳は 21 行のテキストだけ、状態帯の帯は 2px の
借用ルールだけ、操作帯は墨の CTA 1 つだけ。

### 4.3 pure-white 塗り面（§5-4）

| viewport | section 内の pure-white 面（computed `rgb(255,255,255)` かつ > 400px²） |
| --- | --- |
| 1440 | 0 |
| 390 | 0 |

### 4.4 raw hex の残存（§5-5）

| 対象 | 実測 |
| --- | --- |
| `grep -rn "#fff\|#ffffff" src/routes/design-system` | 0 件 |
| `src/editorial/tokens.ts` | `neutral.0` の 1 行（`0: { value: '#ffffff' }`）のみ |
| `src/editorial/tokens.stories.tsx` | 表示の 1 行（`'colors.neutral.0': '#ffffff'`）のみ |
| `src/home/mark.tsx` | `fill="#fff"`（icon knockout）を維持 |

### 4.5 page の canvas（§5-6）

`getComputedStyle(document.body).backgroundColor` = `rgb(252, 252, 253)`
（= `bg.canvas` light / `neutral.25`）。`theme-color` の light も `#fcfcfd`。

### 4.6 各 field の実測（§5-7）

`data-contrast` は DOM に発行された値。表の text 列は `pickInk()` の結果。

| family | field | bg | fg（ink） | `data-contrast` | swatch vs frame | dark inset vs light | text vs dark inset |
| --- | --- | --- | --- | --- | --- | --- | --- |
| design | light | `rgb(190, 24, 93)` | `rgb(248, 250, 252)` | 5.77 | 5.51 | 3.33 | 9.84 |
| design | dark | `rgb(249, 168, 212)` | `rgb(15, 23, 42)` | 9.84 | — | — | — |
| code | light | `rgb(14, 116, 144)` | `rgb(248, 250, 252)` | 5.12 | 4.89 | 3.70 | 12.32 |
| code | dark | `rgb(103, 232, 249)` | `rgb(15, 23, 42)` | 12.32 | — | — | — |
| writing | light | `rgb(161, 98, 7)` | `rgb(248, 250, 252)` | 4.71 | 4.49 | 3.73 | 13.54 |
| writing | dark | `rgb(253, 224, 71)` | `rgb(15, 23, 42)` | 13.54 | — | — | — |

light field の面積は 3 面とも 102,400 px²（320 × 320 = `minHeight` 20rem）、
dark inset は 8,704 px²。`accent.category.*` の light / dark 値は token から
解決したもので、raw hex の直書きはない。

### 4.7 section の高さ（§5-8）

| viewport | before (4778028c) | after |
| --- | --- | --- |
| 1440 | 1512.3 px | 1359.4 px |
| 390 | 4309.5 px | 2502.3 px |

---

## 5. baseline diff（§6）

| 項目 | before (4778028c) | prototype after（目標値） | **after（実装実測）** |
| --- | --- | --- | --- |
| swatch pane 数 | 42 | 0 | **0** |
| 異なる swatch hex | 32 | 0 | **0** |
| hue bucket（旧 swatch） | 7（30/60/150/180/210/240/330°） | 3 family | **3 family**（`design` / `code` / `writing`） |
| section 内 pure-white 面 | 45（315,144 px² @1440 / 575,892 px² @390） | 0 | **0**（@1440 / @390 とも） |
| section height @1440 | 1512.3 px | 1242.5 px | **1359.4 px**（+116.9） |
| section height @390 | 4309.5 px | 2459.6 px | **2502.3 px**（+42.7） |
| coloured elements | 0 | 6（3 plate + 3 status rule） | **6** |
| coloured area @1440 | — | 309,024 px² / 1,789,268 px² = 17.3 % | **309,024 px² / 1,958,269 px² = 15.8 %** |
| coloured area @390 | — | 298,975 px² / 959,248 px² = 31.2 % | **292,094 px² / 977,412 px² = 29.9 %** |
| field text contrast | — | light 5.77 / 5.12 / 4.71、dark 9.84 / 12.32 / 13.54 | **同値**（5.77 / 5.12 / 4.71、9.84 / 12.32 / 13.54） |

差分の読み方:

- **彩色面積の分子は prototype と一致**（@1440 309,024 px²）。plate 3 枚
  （102,400 px² ずつ）と status rule 3 本（608 px² ずつ）の幾何は一致している。
- **section の高さは prototype より 117 px（@1440）/ 43 px（@390）高い**。差は
  全て無彩色部分（見出し・ subsection 間の余白・台帳の行間）にあり、spec が
  規定していない余白の選択に由来する。spec は subsection 間の margin を定めて
  おらず、実装は編集ス케ール標準の `marginBlockStart: '10'`（40px）と
  `gap: '3'`（12px）を採用した。彩色幾何は一致しているため、色面の設計自体は
  prototype と同じである。
- 彩色面積の**分母**（section rect）が prototype より大きいため、割合は
  17.3 % → 15.8 %（@1440）、31.2 % → 29.9 %（@390）になる。

---

## 6. 変えない点

- **token の他の値**: `neutral.0` 以外の既存 step、`charcoal.*`、`brand.*`、
  `design.*` / `code.*` / `writing.*` / `tool.*`、`positive` / `negative` /
  `warning` の全値、`bg.canvas` 以外の semantic token の `base` / `_dark` は
  一切変えていない。`bg.canvas` の `_dark`（`charcoal.950`）も不変。
- **他 route**: `/home`・`/portfolio`・`/about` ほか、本 Issue が触れた
  ファイル以外の route には変更なし。
- **Material Symbols**: 変更なし。
- **#806 の他 section**: `/design-system` の 02 Typography 〜 09 table & code
  は `DesignSystemPage.tsx` 側の構造を変更していない（`sectionStyle` の
  まま）。04 Surface の `SurfaceTreatments` が `bg.canvas` を表示する階層の
  帯（`neutral.0`）は、scope 外のため spec に従い**変更していない**。
  `bg.canvas` の token 参照なので塗り自体は `neutral.25` に追従するが、
  見出しの文字列 `neutral.0` は旧値の名前のままである（後続 Issue の対象）。
- **section 06 の説明文**: `DesignSystemPage.tsx` の 06 の description は
  「left-border で識別」と書いているが、#812 で left border は
  `StateMark` に置き換わった。spec §1.4 が「他 section は触らない」と
  決めているため今回は変更していない（後続 Issue の対象）。
- **03 Spacing の描画**: `SpacingRuler.tsx` の import を `rawTokens` から
  `spacingTokens`（同じオブジェクトの別 export）に変えたが、描画・DOM・
  測定値はいずれも不変（§7.1 の bundle 対策）。
- **budget の数値**: `quality/bundle-budget.json` は変更していない
  （`/design-system` の cap は 685,000 のまま）。gate の閾値変更は owner 判断。

---

## 7. gate 結果

`validate:fast`（`node scripts/run-quality-gates.mjs fast`、spec §5-9 の
`.tmp/supervisor/bin/vfast` は本 worktree に存在しないため、同じ plan を
実行する npm script を直接実行した）。

| 項目 | 値 |
| --- | --- |
| 実行 | `pnpm run validate:fast` |
| step 数 | 67 |
| exit code | 0 |

失敗・skip なし。

### 7.1 bundle budget（`pnpm run bundle:budget:check`）

CI の `validate` ジョブ（run 41374365319 / step 71/80）が、この変更で
`/design-system` の initial JS が cap 685,000 を超えたと報告した。budget の
数値は変更していない（owner 判断）。以下は内訳と対処の記録。

#### 内訳（すべて同じ tree の `pnpm exec vite build` 実測）

| 項目 | 実測 |
| --- | --- |
| base head `4778028c` の route chunk | 39,506 B |
| 色セクション実装後（commit `530fba02`）の route chunk | 44,043 B（**+4,537 B**） |
| うち `ColorSwatches.tsx` 単体の差（base 版と差し替え測定） | **+4,789 B** |
| entry shell（entry chunk）の差 | ±0 B（token 変更は entry に影響しない） |
| route chunk 内の token palette + semantic layer + resolver（stub 化で測定） | 3,580 B |

つまり増えた 3.5 KiB は **新しい colour section 自身のコード**（表示データ・
コントラスト計算・JSX・Panda の utility オブジェクト）であり、story / fixture
の巻き込みや無関係なモジュールの混入ではない。route chunk は issue 実装前
(base head) の 39,506 B に対して 44,043 B まで増えて cap を超えた。

#### 対処（見た目を変えない削減）

1. **token の hex 解決をサーバーへ移した**（`src/routes/design-system/tokens.ts`）。
   route chunk から raw palette 全体・semantic layer 全体・resolver 群
   （実測 3,580 B）が消えた。ブラウザは 24 組の hex を受け取るだけ。
   コントラスト計算（`pickInk` ほか）は描画判断なので client 側に残す。
2. **spacing ramp を独立 export にした**（`spacingTokens`）。spacing ruler が
   `rawTokens` 全体を import していたため、palette の全 color ramp が browser
   に載っていた。切替後、**palette の hex は route chunk のどこにも含まれない**
   （`#be185d` 等の実測で 0 件）。
3. **Panda の `css()` utility を module level の共通定数に寄せた**（`cx` で
   合成）。同じ utility オブジェクトの重複表記をなくした。
4. **未使用データを削除した**（台帳の `label` 列など）。

#### 結果

| 項目 | 修正前 | 修正後 | cap |
| --- | --- | --- | --- |
| `/design-system` initial JS | 688,632 B | **683,899 B** | 685,000 B（余裕 1,101 B） |
| `/design-system` route chunk | 44,043 B | **39,183 B** | — |
| entry shell | 633,211 B | 633,338 B（server fn の stub +127 B） | — |

他の 17 route もすべて cap 内（最も余裕の小さいのは `/keyboard` の 562 B、
`/admin/keys` の 718 B — base からの持ち越しで、本変更による加重は
server fn stub の +127 B のみ）。

#### 見た目が変わっていないことの証明

- SSR HTML の差分: colour section の markup は **class 属性の順序のみ**が
  異なる（`cx` 合成による）。要素・属性・テキスト・style 宣言は同一。
- スクリーンショット 2 枚は再取得なしで **バイト同一**
  （`design-system-colour-surface-{1440,390}-after.webp` と再生成分の比較）。
- §4 の測定値（section height 1359.4 / 2502.3、彩色面積 309,024 / 292,094 px²、
  unique hue 3、pure-white 面 0、field contrast 5.77 / 5.12 / 4.71 と
  9.84 / 12.32 / 13.54）がすべて同一。

### 7.2 スクリーンショット

| ファイル | 内容 |
| --- | --- |
| `docs/verification/design/design-system-colour-surface-1440-before.webp` | 1440px、base head 4778028c |
| `docs/verification/design/design-system-colour-surface-390-before.webp` | 390px、base head 4778028c |
| `docs/verification/design/design-system-colour-surface-1440-after.webp` | 1440px、本 Issue の実装 |
| `docs/verification/design/design-system-colour-surface-390-after.webp` | 390px、本 Issue の実装 |

すべて WebP（quality 82）。PNG は保存していない。
