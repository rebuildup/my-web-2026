この記録は実測値であり owner 承認ではない（AGENTS.md §6 / Issue #741）。

# `/tools/<slug>` の chrome 除去・全画面化の実測（Issue #911）

- 測定日: **2026-11-05**
- 対象: Issue #911（owner 指示 2026-11-05「各ツールはヘッダーなどをいれず、
  各ツール全画面でそれぞれ使われるようにする」）。#785（owner 決定 2026-11-01）
  が詳細ルート全状態に復元した chrome のうち、**ツールを表示する面**
  （`ToolEmbedShell` / `ToolEmbedGate`）から `PublicNav` / `Breadcrumbs` /
  `BreadcrumbJsonLd` を外し、iframe を `100dvh` にした前後の比較。
- 測定対象 URL: `/tools/prototype`（consent gate 状態 → アクティベート後の
  iframe shell 状態）。`/tools` index は chrome を維持する（#911 の対象外）。

## 1. 測定環境

| 項目 | 内容 |
| --- | --- |
| サーバ | `pnpm run build` → `node scripts/sync-cf-build-output.mjs` → `pnpm preview --strictPort` |
| before | base `b9930547`（`release-0-8-2`）の `src/routes/tools.$slug.tsx` のみを差し込んだ状態でビルド（port 4200） |
| after | branch `911` head（`cd6958ac`）でビルド（port 4300） |
| ブラウザ | リポジトリ同梱 `@playwright/test` の Chromium、DPR 1 |
| viewport | **1440×900（desktop）** / **390×844（mobile）** |
| 計測スクリプト | `.tmp/shoot-911.mjs`（`.tmp/` は git 管理外。本記録には手順のみを残す） |
| 共通条件 | `localStorage['my-web-2026:analytics-consent']='denied'` を事前設定（fixed な「解析の設定」トグル以外の fixed 面を出さないため）、アクティベート後の自動スクロールを `scrollTo(0,0)` で戻してから計測・撮影 |

Tool 成果物（`/tools/<slug>/app/**`）は before / after とも同一の
`external/*` pin からビルドしており、**差分は host 側ルートだけ**である。

## 2. 実測値

`frame box` は Playwright の `boundingBox()`（scroll 0 での viewport 座標）。
`JSON-LD` は `application/ld+json` の本数。

| 状態 | viewport | PublicNav | パンくず | JSON-LD | frame box (x, y, w×h) | document height |
| --- | --- | --- | --- | --- | --- | --- |
| before / gate | 1440×900 | **1** | **1** | **1** | — | 1244 |
| before / shell | 1440×900 | **1** | **1** | **1** | 0, 97, 1440×**803** | 948 |
| after / gate | 1440×900 | **0** | **0** | **0** | — | 1147 |
| after / shell | 1440×900 | **0** | **0** | **0** | 0, **0**, 1440×**900** | 948 |
| before / gate | 390×844 | **1** | **1** | **1** | — | 1442 |
| before / shell | 390×844 | **1** | **1** | **1** | 0, 96, 390×**748** | 892 |
| after / gate | 390×844 | **0** | **0** | **0** | — | 1346 |
| after / shell | 390×844 | **0** | **0** | **0** | 0, **0**, 390×**844** | 892 |

読み取れる事実:

1. **before の frame は `viewport - chrome` だった。** desktop は chrome が
   97px（`PublicNav` 62px + パンくず band 35px）で frame は `y=97 / h=803`、
   mobile は chrome 96px で `y=96 / h=748`。これが #911 が廃止した
   減算レイアウトである。
2. **after の frame は viewport を満たす。** 両 viewport とも
   `x=0, y=0, w=viewport, h=viewport`（`100dvh`）。chrome は 0px。
3. **gate 状態も chrome を持たない。** after の同意待ち画面は
   PublicNav / パンくず / JSON-LD すべて 0 で、文書は viewport より高い
   （desktop 1147 / mobile 1346）= コンタクト一覧と purpose が
   `min-height: 100dvh` の中に収まらず**スクロールして読める**状態。
   frame 側が `height: 100dvh` で折りたたまれる証跡でもある。
4. **文書高は before / after で不変**（desktop 948 / mobile 892 =
   viewport + 48px）。48px は fixed な「解析の設定」トグルのための
   `body` padding（`src/styles.css` の既存契約）で、#911 はこれを
   変えていない。**横スクロールは発生しない**（frame 幅 = viewport 幅）。

## 3. 証跡（WebP）

すべて `docs/verification/tools/911-fullscreen/`、1440×900 / 390×844、DPR 1。

| ファイル | 状態 |
| --- | --- |
| [before-gate-desktop.webp](./911-fullscreen/before-gate-desktop.webp) | before・同意ゲート・desktop — パンくず band の上に frame は無い |
| [before-gate-mobile.webp](./911-fullscreen/before-gate-mobile.webp) | before・同意ゲート・mobile |
| [before-shell-desktop.webp](./911-fullscreen/before-shell-desktop.webp) | before・iframe shell・desktop — **nav + パンくずの下**に frame |
| [before-shell-mobile.webp](./911-fullscreen/before-shell-mobile.webp) | before・iframe shell・mobile |
| [after-gate-desktop.webp](./911-fullscreen/after-gate-desktop.webp) | after・同意ゲート・desktop — chrome なし |
| [after-gate-mobile.webp](./911-fullscreen/after-gate-mobile.webp) | after・同意ゲート・mobile |
| [after-shell-desktop.webp](./911-fullscreen/after-shell-desktop.webp) | after・iframe shell・desktop — **frame = viewport 全面** |
| [after-shell-mobile.webp](./911-fullscreen/after-shell-mobile.webp) | after・iframe shell・mobile |

## 4. chrome を残した状態の確認（同じ preview に対する curl）

| URL | 結果 |
| --- | --- |
| `/tools`（index） | 200、`nav[aria-label="Public"]` **1**、JSON-LD **1**（#785 が維持） |
| `/tools/prototype`（after） | 200、nav **0** / パンくず **0** / JSON-LD **0** |
| `/tools/<unknown>`（404） | 404、`data-testid="tools-not-found"` 1、nav **1**、パンくず **0**（`dropOnMissingLoaderData`）、`href="/tools"` の戻りリンク有り |
| `/tools/<slug>/app/index.html` | 307 → `/tools/<slug>/app/` 200（成果物配信は不変） |

到達可能な詳細状態は shipped manifest の 15 件すべて
（`host_disabled` 0 件 / embed policy 違反 0 件）で上記 after と同一である。

## 5. 関連

- Issue #911（本記録の対象）/ #785（chrome 復元の owner 決定）/
  #288（chrome 除去、詳細面についてのみ #911 で再び部分更新）/
  #910（スタイル崩れ — 本記録の範囲外）
- 実装: `src/routes/tools.$slug.tsx`（`frameArea` / `gateArea` / `ToolChrome`）
- 契約の更新: `src/editorial/structured-data/contract.json`、
  `e2e/nav.spec.ts`、`e2e/tools-prototype.spec.ts`、
  `scripts/check-a11y-heading-landmarks.mjs`、
  `scripts/prod-smoke-routes.mjs`（コメントのみ、roster 変更なし）
