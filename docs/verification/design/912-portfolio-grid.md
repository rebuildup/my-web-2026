# /portfolio 一覧のグリッド適合とサムネイル決定化の実測（Issue #912）

作成: 2026-11-05（round 1）/ 2026-11-06 追記（round 2: owner feedback 対応）
Issue: [#912](https://github.com/rebuildup/my-web-2026/issues/912)
branch: `912` / base: `release-0-8-2`
証跡: [`912-portfolio-grid/`](912-portfolio-grid/) の WebP 8 文件（quality 82）+ round 2 追加文件

## Round 2 — owner feedback「間延びしててダサい。グリッドはもっと細かく刻む。カラムを増やす」

### 何を変えたか

| 面 | round 1（1 カラム縦積み + カード内部 4/8 分割） | round 2 |
| --- | --- | --- |
| リスト (`<ol>`) | flex column・全幅縦積み | **カードグリッド: `md` 2 列 / `lg` 3 列**（tools index・home capabilities と同一宣言） |
| gutter / row beat | — | `columnGap { base: 0, md: '6' }`（24px）/ `rowGap: '10'`（40px） |
| カード高 | 行ごとに内容依存 | **`gridAutoRows: '1fr'`** — 同一行内で全カード同高（design #764 の実測 fix と同じ宣言） |
| カード内部 | cover（左 4/12）+ copy（右 8/12）の 2 列 | **コンパクト縦積み**: cover はカード上端に bleed（radius 6px + `overflow: hidden` で corner seam なし）、copy のみ `padding: '6'` |
| hairline `borderTop` | あり | **削除** — グリッドでは gutter が面を分けるので hairline は分離対象を失った。§1/§4 の「bordered box 禁止」に整合 |
| cover 枠 | 16/9 フレーム（round 1 で導入） | 変更なし（16/9・`object-fit: cover`・`width`/`height` 属性維持） |

### 実測（round 2）

| 項目 | v2 before（round 1 = 3e6910be 描画） | v2 after |
| --- | --- | --- |
| カード列 @1440 | 1 カラム（960px） | **3 列 × 304px、gutter 24px**（960 = 3×304 + 2×24） |
| カード列 @900 | 1 カラム（852px） | **2 列 × 414px、gutter 24px**（852 = 2×414 + 24） |
| カード列 @390 | 1 カラム（358px） | **1 カラム（358px）**（fallback） |
| cover 高さ @1440 | 172.48px（16/9） | **171.00px**（304 × 9/16） |
| cover 高さ @900 | 479.25px | **232.88px**（414 × 9/16） |
| cover 高さ @390 | 201.38px | **201.38px**（不変） |
| 同一行内カード高 @1440 | —（1 列のため概念なし） | **513.97px に全カード一致**（gridAutoRows 1fr） |
| 同一行内カード高 @900 | — | **554.66px に全カード一致** |
| 同一行内カード高 @390 | — | **545.16px に全カード一致** |

3 列は 12 カラム契約の 4/12 配置に相当する（tools index が 6/6 を
「documented 12-column contract の配置」と記述するのと同じ読み方）。

## 0. 結論（実測値）

| 項目 | before | after |
| --- | --- | --- |
| カード列分割 @1440 | 309.33 / 618.67px、gutter 32px、`md` から分割 | **306.66 / 613.34px、gutter 40px、`lg` から分割**（§3.1 正本 306.67 / 613.33 / 40） |
| copy 列左端 @1440 | 581.33px（正本軸から 5.34px 内側） | **586.66px（= content edge 240 + 4/12 + gutter 40 = 586.67）** |
| 768–1023px 帯 @900 | 2 列に分割（gap 32px）、copy 左端 329.33 | **1 列（gap 0）、copy 左端 24 = content edge** |
| cover ボックス高さ @1440（先頭 4 枚） | 218.55 / 309.33 / 173.98 / 258.28（natural 比依存） | **172.48 × 4（全カード 16/9、`object-fit: cover`）** |
| cover ボックス高さ @390（先頭 4 枚） | 252.94 / 358.00 / 0 / 0（未読込は 0px = 未予約） | **201.38 × 4（初回描画から inline `aspect-ratio` で予約）** |

受け入れ条件との対応:

- グリッド適合の実測値（left edge / 列幅 / gutter）→ §2.2。
- サムネイルのアスペクト・位置が全カードでグリッドに沿う → §2.2 + WebP 8 文件。
- image-CLS gate green → §4。
- `pnpm run validate:fast` green → §4。

## 1. 何を変えていないか（先に範囲を確定）

- **`src/portfolio/components/PortfolioList.tsx` は変更なし。**
  `src/editorial/layout-system.md` §3.1 は「section content は
  heading の下で full-width でよい（例として `portfolio's list` を明記）、
  ただし行が 4/8 軸を保つこと」と正本として許容している。`<ol>` の
  full-width 縦積みはこの許容内のまま、不適合は行内部（カード）の軸に
  あった（下記）。ページヘッダ（eyebrow / h1 / blurb）は
  `Container` content edge を左軸に full-width の cluster で、
  `/tools` ヘッダと同一の形であり正本 §3.1 の default cluster に適合。
- **データ / 同期 / 承認表示（#913）に触れていない。**
  `media` 行・`is_cover`・承認・同期のロジックは一切変更していない。
- **トークン / デザインシステム本体（#764 / #887）、`src/routes/tools/**` に触れていない。**
- **公開日本語 copy の変更なし。**

## 2. 実測

### 2.1 方法

- harness: `.tmp/912-measure.mjs`（**gitignored・未追跡**。Playwright
  Chromium + sharp。ページの `getBoundingClientRect()` /
  `getComputedStyle()` を読み、WebP quality 82 で撮影）。
- server: この worktree の dev server `http://localhost:15175`
  （`wt step tether` 起動、`vite dev --strictPort`）。
- データ: この worktree の local D1/R2（`.tmp/d1state/v3`）に
  **追跡済みの移行スクリプト**で投入した —
  `node scripts/migrate-portfolio-from-2025.mjs --apply --target=local`
  （60 件）+ `node scripts/migrate-legacy-media.mjs --apply --target=local`
  （130 行 / 116 object）+ `node scripts/seed-portfolio.mjs`（6 件）。
  結果 66 件中 23 件が cover を保持。production への書き込みは行っていない。
- 条件: `colorScheme: light`、`reducedMotion: reduce`、viewport
  1440×900 / 390×844（+ md 帯の数値確認のみ 900×900）、
  `networkidle` + `document.fonts.ready`。
- consent 帯は撮影直前に `[data-testid^="analytics-consent"]` を DOM から
  除去（製品コードは変更していない）。same procedure as
  `design-system-grid-0-8-1.md`。
- before は `b9930547`（変更前の HEAD）の描画、after は本ブランチの
  描画を同一 server で撮影。

### 2.2 desktop 1440×900

| 項目 | before | after | 正本（§3.1） |
| --- | --- | --- | --- |
| Container content left / width | 240 / 960 | 240 / 960 | 240 / 960 |
| カード列 | 309.33 / 618.67 | 306.66 / 613.34 | 306.67 / 613.33 |
| gutter | 32px | 40px | 40px |
| cover 左端 | 240 | 240 | content edge |
| copy 列左端 | 581.33 | 586.66 | 586.67 |
| 分割開始 | `md`（768px） | `lg`（1024px） | `lg` |
| cover 高さ（先頭 4 枚） | 218.55 / 309.33 / 173.98 / 258.28 | 172.48 × 4 | 306.66 × 9/16 = 172.49 |
| inline `aspect-ratio` / object-fit | なし / `fill` | `16 / 9` / `cover` | — |

### 2.3 md 帯 900×900（数値のみ、撮影対象外）

| 項目 | before | after |
| --- | --- | --- |
| カード列 | 273.33 / 546.67（gap 32px） | 852px の 1 列（gap 0） |
| copy 左端 | 329.33 | 24（= content edge） |

before は、サイトグリッドが 1 列に積む 768–1023px 帯でだけカードが
2 列に割れていた。after は正本どおり `lg` 未満で積む。

### 2.4 mobile 390×844

| 項目 | before | after |
| --- | --- | --- |
| content left / width | 16 / 358 | 16 / 358 |
| カード列 | 358px の 1 列 | 変化なし |
| cover 高さ（先頭 4 枚） | 252.94 / 358.00 / 0 / 0 | 201.38 × 4 |
| copy 左端 | 16 | 変化なし |

before の 0px は `loading="lazy"` で未読込の cover（ intrinsic size が
null の行）の未予約状態 — スクロール時に下段が押し下がる CLS 源。
after はサーバー描画される inline `aspect-ratio: 16 / 9` が初回描画から
枠を予約する。

## 3. 実装メモ

- `ProjectCard.tsx` の列分割を §3.1 の section grid rule を verbatim に
  採用（`lg` / `minmax(0,4fr) minmax(0,8fr)` / gap `10`）。base の
  `rowGap` はカード内縦リズムとして `4` のまま（contact の channel row
  が `rowGap { base: '2', lg: '0' }` を選んだのと同じ種類の判断 —
  rowGap はグリッド座標ではない）。
- `PortfolioMediaFigure` にオプション `frameAspectRatio` を追加。
  指定時、インライン `aspect-ratio` は FRAME 比・`object-fit: cover`
  で切り抜き、`width` / `height` 属性は intrinsic size から従来どおり
  発行。placeholder / error 分岐も同じ FRAME 比を描く。
  デフォルト経路（`frameAspectRatio` なし = detail ページ /
  design-system fixture）の挙動は不変。
- カードの cover は `frameAspectRatio="16 / 9"`（`mediaFrameStyle` の
  既定枠比と同一）。

## 4. ゲート

- image-CLS e2e（`e2e/image-cls.spec.ts`、`/design-system` 07 — Image）:
  （§記入は PR に記録）。
- `pnpm run validate:fast` / `pnpm run validate:integration`:
  （§記入は PR に記録）。

## 5. 証跡

WebP（PNG なし）:

- round 2（2026-11-06 追加）: `912-portfolio-grid-{1440,390}-v2after-full.webp` —
  グリッドの 2 行分を clip 撮影した全幅証跡（lazy cover を
  scroll-through + decode 待ちしてから撮影）。
- round 1: `912-portfolio-grid-{1440,390}-{before,after}-{top,cards}.webp`
  8 文件。

`-top` はページ先頭（ヘッダ + filter + 最初のカード）、`-cards` は
cover を持つ最初のカードから 2 枚分。

## 6. この記録が証明しないこと

- production の `/portfolio` 描画（本番 media 未移行の問題は #913 /
  #850 の範囲。本セッションの本番 GET は行っていない）。
- intrinsic size（`portfolio_media.width/height`）の充足 — ローカル移行
  行はすべて null。属性の発行は unit test（`PortfolioMedia.client.test.tsx`
  / `ProjectCard.test.tsx`）が fixture 行で pin している。
- hover / focus / 動きのある状態、Chromium 以外のブラウザ。
