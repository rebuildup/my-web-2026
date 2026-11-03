# Issue #767 AI Slop 修正の実測記録

> この記録は実測値であり owner 承認ではない。数値はすべて
> `getBoundingClientRect()` / `getComputedStyle()` の実測結果で、
> 記録のために再構成した値はない。

作成: 2026-11-03
対象: `release-0-8-1` / branch `767-fix` / base `origin/release-0-8-1`
対応した修正候補: `docs/verification/design/767-ai-slop-inventory.md` §6 の 1–4

## 1. 修正した 4 点

| # | 対象 | 状態 |
| --- | --- | --- |
| 1 | `/portfolio` カード grid（§6-1, finding 3） | 修正・実測済み |
| 2 | pet と本文の衝突（§6-2, findings 1–2） | 修正・実測済み |
| 3 | `PERIOD` の null 処理 + seed（§6-3, findings 4, 7） | 修正・実測済み |
| 4 | `/portfolio/$slug` の `08` と sort 説明（§6-4, finding 6） | 修正・実測済み |

§6 の 5–8 は今回の範囲外。owner 判断を待つ。

## 2. 測定 fixture と再現手順

- worktree: `/Users/rebui/work/my-web-2026.767-fix`（branch `767-fix`）
- `pnpm run build` → `node scripts/sync-cf-build-output.mjs`
  → `pnpm exec vite preview --port 4471 --strictPort`
- ローカル D1 に migration 0001–0010 を適用し、修正版
  `node scripts/seed-portfolio.mjs` で 6 件を投入。
  修正前の測定は seed 修正前の DB（`period_label` が NULL）で行い、
  修正後は seed を再実行して label が入った状態で測った。
- Playwright（`@playwright/test` の Chromium、headless）で
  `networkidle` + `document.fonts.ready` + 待機後に測定。
  - viewport: 390×844 / 1440×900、`deviceScaleFactor: 2`
  - 各ページで GA4 同意の「拒否する」を先に押した。privacy の
    `<details>` は開いた状態でスクロール位置を測った。
- スクロール位置ごとの測定は `window.scrollTo(0, y)` の 400ms 後に
  `Range.getClientRects()` で全テキスト行の矩形を取り、pet の
  子要素矩形との交差面積を計算した。
- スクリーンショットは PNG → sharp で WebP quality 82。
  `docs/verification/design/767-fixes/` に before / after を対で置いた
  （PNG はコミットしていない）。

## 3. `/portfolio` カード grid（finding 3）

### 修正内容

`src/portfolio/components/ProjectCard.tsx` で、cover がないカードは
`grid-template-columns` を `1fr` の 1 列にし、cover がある場合だけ
既存の `4fr / 8fr` を維持する。

### 実測（`/portfolio`、1440×900）

| 項目 | 修正前 | 修正後 |
| --- | --- | --- |
| article | x=240, width=960 | x=240, width=960 |
| `grid-template-columns` | `309.328px 618.672px` | `960px` |
| 子要素数 / 幅 | 1 / 309.328px | 1 / 960px |
| 子要素の高さ | 189px | 162px |
| `h3` の幅 | 309.328px | 960px |
| `h3` の高さ / 行数 | 60px / 2 行 | 30px / 1 行 |

cover ありのカードでは 2 列が維持されることを、`portfolio_media` に
一時的な cover 行（`portfolio/tastile/cover.webp`、1600×1000、
`is_cover = 1`）を入れて確認した。画像本体はローカル R2 に無いため
placeholder 分岐で描画され、この 404 は probe の想定内である。

| 幅 | `grid-template-columns` | 子要素 |
| --- | --- | --- |
| 1440 | `309.328px 618.672px` | 309.328px + 618.672px |
| 390 | `358px` | 358px（縦積み） |

probe 行は測定後に削除した。

## 4. pet と本文の衝突（findings 1–2）

### 修正内容

- `src/editorial/pet/position.ts` に sprite の frame 寸法
  （96×104）と rest scale（0.62）を定数として公開。
- `src/editorial/pet/safe-area.ts`（新規）が、固定 overlay の
  右下 footprint（rest 59.52px + margin 24px + clearance 8px = 92px）を
  ページ本文側で確保する `petSafeAreaStyle` を提供する。
  `Container` の page padding 16 / 24 / 32px を差し引き、
  base / md / lg で 76 / 68 / 60px、xl で 0px を inline-end に予約する。
- `src/home/composer.tsx` と `src/about/components/AboutPage.tsx` の
  ページ wrapper にこの style を適用。
- `src/editorial/pet/PetSprite.tsx` は、`xl` 未満では active pose でも
  rest scale（0.62）に留め、`xl` 以上でのみ 1.0 に拡大する。
  reduced-motion の既存挙動は変更していない。
- `src/editorial/pet/safe-area.test.ts` が 92 / 76 / 68 / 60 / 0 の
  数値を geometry 定数から再導出し、literal の drift を防ぐ。

### 実測: `/` 390×844

修正前は scroll 0 で rest 59.52×64.48、scroll 600 以降は active
96×104（left 270）だった。修正後は全スクロール位置で rest
59.52×64.48（left 306.48）に固定される。

| scrollY | 修正前 交差行 / 面積 | 修正後 交差行 / 面積 |
| --- | --- | --- |
| 0 | 3 / 2438.95px² | 0 / 0px² |
| 600 | 2 / 1904.55px² | 0 / 0px² |
| 1200 | 2 / 532.23px² | 0 / 0px² |
| 2400 | 2 / 2294.12px² | 0 / 0px² |
| max (5057 → 5637) | 5 / 5158.18px² | 0 / 0px² |

付随して NOW lead の幅が 358px → 282px になり、折り返しが増えたため
lead の top は 704.38 → 824.36 に下がった。本文の右端は 374 → 298 となり、
pet の左端 306.48 との間に 8.48px の clearance がある。

### 実測: `/about` 390×844

| scrollY | 修正前 交差行 / 面積 | 修正後 交差行 / 面積 |
| --- | --- | --- |
| 0 | 1 / 520.34px² | 0 / 0px² |
| 600 | 2 / 4521px² | 0 / 0px² |
| 1200 | 3 / 5036.63px² | 0 / 0px² |
| 2400 | 2 / 1185.98px² | 0 / 0px² |
| max (4402 → 5118) | 0 / 0px² | 0 / 0px² |

Identity lead の幅は 358px → 282px、右端 374 → 298。pet は
306.48–366 × 707.52–772 に残り、削除も縮小もしていない。

### 実測: `/` 1440×900

pet は 1356.48–1416 × 763.52–828（59.52×64.48）で修正前後とも同じ。
交差行は 0 / 0px²。xl 以上では本文列が中央にあり、予約は 0px で足りる。

## 5. `PERIOD` の null 処理と seed（findings 4, 7）

### 修正内容

- `src/portfolio/components/ProjectCard.tsx` と
  `src/portfolio/components/PortfolioDetail.tsx` で、`periodLabel` が
  null または空白のみのとき `<dt>Period</dt>/<dd>` を描画しない
  （`Role` と同じ扱い）。
- 別 commit で `scripts/seed-portfolio.mjs` が `src/portfolio/seed.ts` の
  `periodLabel` を `period_label` に書くようにした。

### 実測（1440×900）

修正前、`/portfolio` の 6 カードすべてが `dt: ["Role", "Period"]` /
`dd: ["Solo developer", ""]` で、空の Period 行を表示していた。
修正後の 6 カードは次の label を表示する。

| カード | 修正前 Period | 修正後 Period |
| --- | --- | --- |
| MultiSlicer | （空） | `2023 - present` |
| project-init | （空） | `2025-06 - present` |
| ScienceArts / OPTiM | （空） | `2026 夏 (Summer 2026)` |
| Tastile | （空） | `2024-06 - present` |
| Aulymo | （空） | `2022 - present` |
| my-web-2026 | （空） | `2025-09 - present` |

`/portfolio/my-web-2026` の metadata も
`Period: ""` → `Period: "2025-09 - present"`。

null 分岐そのものは、ローカル D1 の Tastile の `period_label` を
一時的に NULL にして確認した。カードも detail も `dt: ["Role"]` /
`dd: ["Solo developer"]` となり、Period の pair は消える。
測定後に label を戻し、`period_label IS NULL` の行が 0 件であることを
確認した。

## 6. `/portfolio/$slug` の `08` と sort 説明（finding 6）

### 修正内容

`src/portfolio/components/PortfolioDetail.tsx` の隣接セクションから
`eyebrow="08"` を削除した。ページ内に 01–07 が無く、静的番号が
成立しないため。説明文は DB 列名の説明
（`Canonical sort 順 (pinned → display_order → updated_at → id) …`）
から、読み手の語彙である
`このプロジェクトの前後に並ぶ project。` に置き換えた。

### 実測（1440×900）

| 項目 | 修正前 | 修正後 |
| --- | --- | --- |
| eyebrow | `08` | `null`（要素なし） |
| h2 | `隣接 project / Adjacent` | 同じ |
| description | `Canonical sort 順 (pinned → display_order → updated_at → id) で隣接する project。` | `このプロジェクトの前後に並ぶ project。` |

この説明文の変更は公開日本語コピーの変更なので、#506 の
`copy:approval:check` では advisory の `not run`（NEEDS REVIEW）になる。
owner 承認記録は作成していない。

## 7. スクリーンショット

すべて `docs/verification/design/767-fixes/` 配下、WebP quality 82。

| 修正前 | 修正後 |
| --- | --- |
| `home-390-before.webp` | `home-390-after.webp` |
| `home-390-scroll600-before.webp` | `home-390-scroll600-after.webp` |
| `about-390-before.webp` | `about-390-after.webp` |
| `about-390-scroll1200-before.webp` | `about-390-scroll1200-after.webp` |
| `portfolio-card-1440-before.webp` | `portfolio-card-1440-after.webp` |
| `portfolio-card2-1440-before.webp` | `portfolio-card2-1440-after.webp` |
| `portfolio-detail-adjacent-1440-before.webp` | `portfolio-detail-adjacent-1440-after.webp` |
| `portfolio-detail-meta-1440-before.webp` | `portfolio-detail-meta-1440-after.webp` |

追加（修正後のみ）:

- `portfolio-card-period-null-1440-after.webp` — Period が null のカード
- `portfolio-detail-period-null-1440-after.webp` — Period が null の detail

## 8. 測っていないこと

- **ダークテーマ**: 修正は light で測定した。色・背景は変更していないが、
  safe-area と grid の dark 描画は測っていない。
- **200% zoom / 320px 幅**: 390 / 1440 のみ。320px やブラウザ zoom での
  折り返し・corridor の十分性は測っていない。
- **`prefers-reduced-motion` の実描画**: 既存実装の分岐は読んだが、
  reduced-motion を有効にしたブラウザでのスクリーンショット・交差測定は
  していない（#403 の担当範囲）。
- **pet のドラッグ後**: 訪問者が pet を移動した後の位置は測っていない。
  safe-area は初期位置の rest footprint を前提にしている。
- **`/portfolio` 390 のカード**: 390 では元から 1 列（358px）で、
  cover ありも縦積みになることだけ確認した。カード単位の before 画像は
  取得していない（1440 の before / after のみ）。
- **cover ありカードの実画像**: ローカル R2 に画像オブジェクトが無いため、
  placeholder 分岐での 2 列確認である。実画像を読み込んだ場合の高さ・
  CLS は測っていない。
- **隣接 project の端の表示**: next が無い位置では既存実装が
  `Last project →` を `aria-hidden` の span で出す。これは欠落ではなく
  既存の意図的な表示で、変更していない。
- **`display_order` が全件 100**: 隣接順の実データ依存は測っていない。
  番号を削除しただけで、並び順のロジックは変更していない。
- **Performance / Lighthouse**: 変更後の Lighthouse スコア、CLS、LCP は
  測っていない。
- **実環境**: 本番 Worker / 本番 D1 / 本番 R2 では確認していない。
  すべてローカル preview とローカル D1 の測定である。
- **#506 の owner 承認**: `このプロジェクトの前後に並ぶ project。` は
  owner 承認を受けていない。advisory gate の `not run` をそのまま残す。
