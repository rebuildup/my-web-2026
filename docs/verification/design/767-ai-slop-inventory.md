# Issue #767 AI Slop 棚卸し（実測）

> この記録は実測値であり owner 承認ではない。

作成: 2026-11-03
対象: `release-0-8-1` / branch `767` / base `4e91f075`
範囲: 公開面の描画確認と記録のみ。UI は変更していない。

## 1. 巡回したルートと件数

- 巡回したルート数: **11**（公開コンテンツ 10 + 公開到達可能なサインイン 1）
- 記録した項目数: **21**
- スクリーンショット: **34 WebP**（PNG はコミットしていない）

ルート一覧は `quality/route-coverage.json` の `audience: "public"` と `src/routes/**` を突き合わせ、
`/sitemap.xml` の実出力で補完した。動的ルートは route pattern ごとに 1 件を実測した。

| # | route pattern | 実測 URL | 根拠 | 撮影 |
| --- | --- | --- | --- | --- |
| 1 | `/` | `/` | `src/routes/index.tsx` | light 390 / 1440, dark 1440 |
| 2 | `/about` | `/about` | `src/routes/about.tsx` | light 390 / 1440, dark 1440 |
| 3 | `/contact` | `/contact` | `src/routes/contact.tsx` | light 390 / 1440 |
| 4 | `/projects/dotfiles` | `/projects/dotfiles` | `src/routes/projects.dotfiles.tsx` | light 390 / 1440 |
| 5 | `/portfolio` | `/portfolio` | `src/routes/portfolio/index.tsx` | light 390 / 1440, dark 1440 |
| 6 | `/portfolio/$slug` | `/portfolio/my-web-2026` | `src/routes/portfolio/$slug.tsx` | light 390 / 1440 |
| 7 | `/tools` | `/tools` | `src/routes/tools.index.tsx` | light 390 / 1440, dark 1440 |
| 8 | `/tools/$slug` | `/tools/prototype` | `src/routes/tools.$slug.tsx` | light 390 / 1440 |
| 9 | `/keyboard` | `/keyboard` | `src/routes/keyboard.tsx` | light 390 / 1440 |
| 10 | `/design-system` | `/design-system` | `src/routes/design-system.tsx` | light 390 / 1440, dark 1440 |
| 11 | `/admin/login` | `/admin/login` | `src/routes/admin.login.tsx` | light 390 / 1440 |

補足:

- `/admin/login` は `route-coverage.json` で `audience: "public"` のため巡回した。
  管理ダッシュボード（`/admin`, `/admin/keys` など）は認証必須の `audience: "admin"` なので対象外。
- `/api/v1/*` は対象外（指示どおり）。
- `/legal`、`/privacy`、`/terms`、`/security`、`/licenses` は実測で **404**。
  privacy 相当は `/` フッターの `<details>`「データと保持期間 / Data and retention」で、
  開いて全文を読んだ。`src/legal/AssetLicenseReview.tsx` は route に接続されていないため、
  legal 相当の公開ルートは存在しない。
- `/tools/$slug` の iframe 内は Tool 自身の artifact であり、host の visual language ではない。
  内部の見た目は判定対象外とした（host chrome の breadcrumb のみ確認）。

## 2. 方法

- worktree: `/Users/rebui/work/my-web-2026/.767`（branch `767`）
- `pnpm run build` → `node scripts/sync-cf-build-output.mjs` → `vite preview --port 4398 --strictPort`
- ローカル D1 に migration 0001–0010 を適用し、`scripts/seed-portfolio.mjs` で 6 件を投入。
- Playwright（Chromium）で `networkidle` + `document.fonts.ready` 後に測定。
  - viewport: 390×844 / 1440×900、`deviceScaleFactor: 2`
  - light は全 11 ルート、dark は主要 5 ルート（`/`, `/about`, `/portfolio`, `/tools`, `/design-system`）を 1440 で撮影
  - 各ページで GA4 同意の「拒否する」を先に押した。activation gate のある Tool は
    `[data-testid="tool-embed-consent-activate"]`（「読み込みを開始する」）を押した。
  - `loading="lazy"` の画像は、fullPage 撮影前にページをスクロールして読み込みを発火させた。
- 撮影は fullPage PNG → sharp で WebP quality 82。16000px を超えるページは
  16383px の WebP canvas 上限を避けるため `-partN.webp` に分割した（`/design-system`）。
  出力先は `docs/verification/design/767-inventory/`（34 ファイル、PNG はコミットしない）。
- 判定は `getBoundingClientRect()` / `getComputedStyle()` / `elementsFromPoint()` の実測値と、
  スクリーンショットの該当位置の両方で行った。

## 3. 既知のフィクスチャ制約（先に読む）

- **PERIOD の空欄**: `scripts/seed-portfolio.mjs` は `period_label` に `NULL` を書く。
  一方 `src/portfolio/seed.ts` には `2025-09 - present` などの label が存在する。
  したがって「空の `<dd>`」はローカル seed の欠落と、コンポーネント側の null 未処理の
  両方に由来する。コンポーネント側の事実は seed に依存しない（`periodLabel` は schema 上 nullable）。
- **Pinned が出ない**: 同じ seed script が `pinned = 0` を固定している。
  Pinned badge と accent facet がローカルで見えないのはデータ由来で、UI の欠落ではない。
- **cover 画像が出ない**: `src/portfolio/seed.ts` の 6 件はすべて `media: []`。
  `/portfolio` のカードが cover なしで描画されるのは shipped seed の状態であり、
  本番の media 状態はこの環境から観測できない。カードの grid 欠陥は cover なしのときに必ず出る。
- **reactions / access counter の disabled 表示**: ローカルに
  `MY_WEB_2026_CONSUMER_API_KEY` がないため、`/` に
  `reactions disabled — consumer API key not configured (run scripts/bootstrap-home-api-key.mjs)`
  と `COUNTER DISABLED` が出る。これは開発状態のメッセージであり、公開コピーの slop としては記録しない。
- **`seed-tools.mjs --execute`**: `executeSqlFile is not defined` で失敗する。
  `/tools` は `src/tools/manifest.json` から描画されるため、スクリーンショットには影響しない。
  スクリプト側の不具合として記録だけ残す。
- **fullPage の fixed 要素**: pet と「解析の設定」ボタンは `position: fixed` のため、
  fullPage 撮影では 1 つのスクロール位置にだけ描画される。fullPage 上の位置を
  そのまま重なりと読まず、390×844 の実ビューポートで再測定した（第 4 節の pet の数値）。
- **glass の誤検知**: 自動 metric が `/design-system` で `h2` を 10 件 glass と出したが、
  実体は emoji-mart の隠れた 0×0 `.epr-emoji-category-label` だった。
  ページ見出しの computed `backdrop-filter` は `none`。glass の項目は記録しない。

## 4. 観測結果

深刻度の基準:

- **高**: 公開面で本文・ラベル・値を隠す、または読み手が事実を誤解する。
- **中**: 同じ意味の要素が構造的に同格・欠落し、情報の所在が読み取りにくい。
- **低**: 情報を増やさない装飾・反復・揺れ。理解は妨げない。

| 通し番号 | ルート | パターン番号 | 観測した事実（セレクタ / スクショ位置） | 深刻度 | 該当するコンポーネントファイル |
| --- | --- | --- | --- | --- | --- |
| 1 | `/` | 6 | `img[data-motion]` の pet（fixed, z-index 30, 390 で 60×64px, box 306–366 × 708–772）が、NOW セクション lead `p`（box 16–374 × 704–781）の右下 2 行の右端に重なる。初期ビューポートで「最後に動いた日・そこに入れている量です。」の右端が隠れる（390×844 の実ビューポート再測定）。 | 高 | `src/editorial/pet/PetSprite.tsx`, `src/home/composer.tsx` |
| 2 | `/about` | 6 | 同じ pet が Identity lead `p`（box 16–374 × 751–802）の 1 行目の末尾に重なる（pet 306–366 × 708–772）。390×844 の実ビューポートで「学校・制作・開発の surface が分かれても、」の右端が pet の下に入る。 | 中 | `src/editorial/pet/PetSprite.tsx`, `src/about/components/AboutPage.tsx` |
| 3 | `/portfolio` | 9 | 1440 で `article` は 960px 幅、`grid-template-columns: 309.328px 618.672px`。cover が null のため child は 1 つだけになり、4fr 列（x=240, w=309）に置かれる。残り 618px は空で、`h3` も 309px 幅に折り返す。seed 6 件はすべて `media: []`。 | 高 | `src/portfolio/components/ProjectCard.tsx`（grid 116 行、cover 123 行） |
| 4 | `/portfolio` | 7 | 各カードの `<dl>` は Role を `hasRole` で落とすが、Period は無条件。6/6 カードで `PERIOD` の `<dd>` が空（`portfolio-index-1440-light.webp` / `portfolio-index-390-light.webp`）。 | 中 | `src/portfolio/components/ProjectCard.tsx` 221–246 行 |
| 5 | `/portfolio` | 4 | 6 枚の `article` が同じ構造・同じ重みで並ぶ。facet badge は 6/6 が `Develop` 1 つだけ、Pinned badge は seed の `pinned=0` で出ず、cover もない。一覧は「pinned / featured」の差を表現できない。 | 低 | `ProjectCard.tsx`, `scripts/seed-portfolio.mjs` 88 行 |
| 6 | `/portfolio/$slug` | 7 | SectionHeading の eyebrow が裸の `08`。ページ内に 01–07 は存在しない。description は `Canonical sort 順 (pinned → display_order → updated_at → id) で隣接する project。` で、DB の列名を公開コピーに出している（`portfolio-detail-1440-light.webp` 下部）。 | 中 | `src/portfolio/components/PortfolioDetail.tsx` 391–393 行 |
| 7 | `/portfolio/$slug` | 7 | `ROLE / Solo developer` の隣に `PERIOD` の `<dt>` だけが残り、`<dd>` が空（`portfolio-detail-1440-light.webp`、`portfolio-detail-390-light.webp`）。 | 中 | `PortfolioDetail.tsx` 239–241 行 |
| 8 | `/projects/dotfiles` | 5 | hero の pill `user-level config` / `agent wiring` / `runtime secrets` が、直上の subtitle `ユーザー設定・エージェント配線・実行時 secret 注入` を英訳して並べている。同じ情報が同じ面に 2 回出る。 | 低 | `src/projects/DotfilesIntroductionPage.tsx` hero |
| 9 | `/projects/dotfiles` | 7 | README 5 節のそれぞれが `02.N — README` の eyebrow と `README の「…」を読む` のリンクを持ち、README という語が各節で 2 回反復する（hero の blockquote と provenance を除いても 10 回）。 | 低 | `DotfilesIntroductionPage.tsx` 545, 646 行 |
| 10 | `/projects/dotfiles` | 2 | 境界セクションの 2 枚の `<article>` が `borderWidth: 1px` + `borderRadius: lg`。FreshnessNotice も `borderWidth: 1px` + `borderRadius: md` + `bg.surface`。`src/routes/tools.index.tsx` のコメントは「`layout-system.md` §1/§4 は公開面の bordered box を禁じる」と明記しており、同じ公開面で扱いが揃っていない。 | 低 | `DotfilesIntroductionPage.tsx` 439–442, 469–472, 673–676 行 |
| 11 | `/projects/dotfiles` | 9 | README 各節は `paddingBlock: { base: '10', lg: '16' }` を上下に持ち、さらに 1px の top border で区切る。1440 で節間は約 200px、節内の段落間は 16px。border と padding が同じ境界を二重に離している。 | 低 | `DotfilesIntroductionPage.tsx` 532–542 行 |
| 12 | `/keyboard` | 5 | platform tablist は `borderRadius: full` + `minHeight: 11`、layer tablist は `borderRadius: sm` + `minHeight: 10`。どちらも単一選択の tablist なのに、1440 のスクショでは `macOS 12 layers` が pill、`ベース / HUB / 記号` が矩形。 | 低 | `src/keyboard/components/KeyboardPage.tsx` 224–232, 274–279 行 |
| 13 | `/keyboard` | 2 | `statusStripStyle` が border + radius の箱で、`flowCardStyle` が同じ箱を 2 枚（macOS / Windows）に繰り返す。ページ内で唯一の bordered box 群。 | 低 | `KeyboardPage.tsx` 131–164 行 |
| 14 | `/keyboard` | 5 | hero の pill `大西配列 + QWERTY` / `macOS: hidutil + Kanata` / `Windows: Kanata` が、直上の lead（大西配列、macOS、hidutil、Kanata、Windows）を短く言い直している。 | 低 | `KeyboardPage.tsx` hero |
| 15 | `/tools` | 3 | 15 枚のカードが title の左に MaterialSymbol を 1 つずつ持つ（`TOOL_ICONS`）。`code-type-p5` → movie、`sequential-png-preview` → motion、`svg2tsx` → code のようにカテゴリ近似もあり、title と summary がすでに意味を持っている。 | 低 | `src/routes/tools.index.tsx` `TOOL_ICONS` |
| 16 | `/tools` | 4 | 15 件すべてが同じ `repeat(2, minmax(0, 1fr))` の grid と同じカード recipe で、特定の Tool だけ大きい slot を持つことはない。いまは 15 件すべて `same_origin_static` で `host_disabled` が 0 件のため、available / planned の節分けも画面には出ない。 | 低 | `src/routes/tools.index.tsx` grid |
| 17 | `/tools` | 7 | section description が `このページから開けます。カードを選ぶとツールが開きます。`。hero の「開けるものと準備中のものに分けて並べています」に続けて、同じ操作を 2 文で言い直している。 | 低 | `src/routes/tools.index.tsx` |
| 18 | `/contact` | 7 | 掲載 gate が hero の `掲載されていない channel は現在 re-verified されていないため、ここには載せていません。` と section description の `Channel は 30 日以内に deploy-time で再検証されたものだけを掲載しています。` に二重に出る。hero 内でも 掲載 / 載せ が 2 文連続する。 | 低 | `src/contact/page.tsx` 107, 140 行 |
| 19 | `/` | 7 | footer が `05 — Contact` の後に `04 — Edition` と大きな `04` を出す（`home-1440-light.webp` 最下部）。section 見出しと同じ mono / uppercase の番号付き eyebrow 形式なので、05 の後に 2 つ目の 04 が来たように読める。文字列は `aria-hidden` だが、視覚的な並びは残る。 | 低 | `src/home/footer.tsx` 65–81 行 |
| 20 | `/design-system` | 1 | `div.h_220vh` が `repeating-linear-gradient(45deg, {colors.bg.subtle} 0 12px, transparent 12px 24px)` を 220vh にわたって敷く。公開セットで唯一の gradient で、1440 の part2 では対角線の帯が画面の大部分を占める。コメントどおり Issue #486 の CLS fixture であり、製品の装飾ではない。 | 低 | `src/routes/design-system/sections/ImageCls.tsx` 130–133 行 |
| 21 | `/admin/login` | 7 | `00 — ADMIN` の番号付き eyebrow が、他に番号付きセクションを持たない単一画面の左上に出る（`admin-login-1440-light.webp`）。00 が属する系列が画面上にない。 | 低 | `src/routes/admin.login.tsx` |

### 参考（AI Slop パターン外・件数に含めない）

- `/admin/login` に `<h1>` が 1 つもない（実測 `h1: []`）。見出し構造の話であり、本 Issue の
  10 パターンではないため表には含めない。
- 同意後に固定表示される `解析の設定: 無効` ボタン（116×36、bottom 12 / right 12）は、
  390 で本文の右端に重なる。`projects-dotfiles-390-light.webp` では blockquote の
  `— README, rebuildup/dotfiles` の右端、`portfolio-detail-390-light.webp` では
  `Canonical sort … で隣接する project。` の右端がボタンの下に入る。機能コントロールであり
  装飾ではないため、slop 項目には数えず、レイアウト衝突としてここに残す。

## 5. 実測で否定したもの

- **パターン 1（gradient / glass / 影）**: `/design-system` の fixture を除き、
  公開コンテンツ面の metric は `gradient: []`、`shadowCount: 0`、`glass: []`。
  `backdrop-filter` の hit は emoji-mart の隠れた 0×0 要素だけで、見出しの computed 値は `none`。
- **パターン 2（カードの入れ子）**: カードの中にカードが入る構造は観測されなかった。
  記録したのは単層の bordered box（dotfiles / keyboard）だけ。
- **パターン 6（gradient 文字 / 絵文字の装飾）**: gradient text は 0 件。
  装飾的な画像は pet sprite のみで、表 1–2 に記録した。
- **パターン 8（アニメーション過剰）**: 撮影時の `animationName` は全ページ `none`。
  pet の `petReaction` / `petRun` は `reducedMotion` が真のとき付与されない実装で、
  `src/styles.css` に reduced-motion floor がある。reduced-motion の別監査は #403 の担当。
- **パターン 10（focus / hover の一様化）**: focus は全要素で `border.focus` の 2px outline に
  統一されている（a11y の一貫性）。hover は役割ごとに違い、テキストリンクは
  underline thickness、tab は border color、カード title は underline。
  「全要素が同じ hover」による階層の平坦化は観測されなかった。

## 6. 修正候補の優先順

1. **`/portfolio` のカード grid（高）** — cover がないときに child が 4fr 列へ落ちる。
   単一 child のときは `grid-column: 1 / -1` にするか、cover の有無で
   `grid-template-columns: 1fr` に切り替える。タイトルの折り返しと 618px の空白が同時に解消する。
2. **pet の本文衝突（高 / 中）** — `/` と `/about` の 390 で、初期ビューポートの本文右端に pet が重なる。
   pet は製品意図のある装飾なので、消すかどうかは owner 判断。最低限、本文の
   `max-width` か rest position を調整し、テキストと重ならない位置に置く。
3. **`PERIOD` の null 処理（中）** — `ProjectCard` と `PortfolioDetail` の両方で、
   Role と同じく `periodLabel` が null / 空のとき `<dt>/<dd>` を落とす。
   `scripts/seed-portfolio.mjs` も `src/portfolio/seed.ts` の label を書くよう直す
   （seed の修正は UI 修正とは別の commit にする）。
4. **`/portfolio/$slug` の `08` と sort 説明（中）** — 単独の `08` を削除するか、
   ページ内の 01–07 と接続する。`display_order` / `updated_at` は読み手の語彙ではないので、
   技術メモへ移すか「並び順」の平文に置き換える。
5. **番号と反復コピーの整理（低）** — footer の `04 — Edition`、contact の掲載 gate の二重化、
   tools の操作説明、dotfiles / keyboard の hero pill の言い直し、README の反復。
   どれも情報を増やしていないので、1 つの copy 整理 PR にまとめられる。
6. **bordered box / tab 形状の統一（低）** — dotfiles の境界カード、keyboard の status strip と
   2 枚の mechanism panel、platform tab と layer tab の radius / minHeight。
   `layout-system.md` の「公開面に bordered box を置かない」に揃えるか、逆に
   この 3 画面だけの例外として明文化するかは owner 判断。
7. **`/design-system` の 220vh fixture（低）** — 計測用の fixture であることを画面上でも
   明示する（ラベル or dev-only gate）。公開 sitemap に載っているため、初見では
   読み込み失敗のように見える。
8. **固定コントロールの safe area（低）** — 「解析の設定」ボタンが 390 で本文に重なる
   スクロール位置がある。bottom-right に本文の safe area を確保する。

この PR では上記を修正しない。修正は次の PR で 1–4 から着手し、5–8 は owner の判断を待つ。
