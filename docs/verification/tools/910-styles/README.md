> この記録は実測値であり owner 承認ではない（AGENTS.md §6 / Issue #741）。

# 15 Tool ビジュアル監査 — before（Issue #910）

- 測定日: **2026-11-05 / 2026-11-06**
- 測定環境: `pnpm run build` → `node scripts/sync-cf-build-output.mjs` →
  `pnpm exec vite preview --port 4410 --strictPort`（`http://127.0.0.1:4410`）。
  Chromium はリポジトリ同梱の `@playwright/test` 1.63.0、DPR 1、
  viewport は **1440×900（desktop）** と **390×844（mobile）**、`colorScheme: light`。
- 撮像: ホストの `/tools/<slug>` ページ全体（chrome + frame）。
  アナリティクス同意ピルは拒否、Tool 側の第三方同意は承認してから撮影。
- 計測スクリプトは `.tmp/audit910/*.mjs`（`.tmp/` は git 管理外）。
- 先行文書: [`functional-verification-2026-11-04.md`](../functional-verification-2026-11-04.md)（機能判定 15 PASS）、
  [`root-absolute-404-2026-11-04.md`](../root-absolute-404-2026-11-04.md)（#896 修正後）。
  本書は**スタイル健全性**の全数追補である。

## 1. 撮像手順で観測した事実

`pnpm run build` 直後の `vite preview` は `/tools/<slug>/app/index.html` を **404** で返した。
`scripts/sync-cf-build-output.mjs` を実行して preview を再起動すると全 15 Tool が 200 になり、
console error は 15 Tool × 2 viewport とも **0**。Cloudflare Vite Plugin 2 の成果物は
`.cloudflare/output/` 側に出るため sync を挟まないと Tool 成果物が preview に存在しない。
これは配信経路の性質であり、スタイル崩れとは別の事象（runbook 順守の確認事項）。

## 2. 定量測定

frame 内部（`<iframe>` の `<html>`）に対して測定した。

| 指標 | 測り方 |
| --- | --- |
| stylesheet 数 / rule 数 / css 文字量 | `document.styleSheets` の `cssRules` 合計 |
| class coverage | 描画要素の class token のうち rule に現れる割合 |
| 横溢れ | `html.scrollWidth - clientWidth` |
| clip | overflow hidden/auto/scroll 祖先を持ち `right > viewport` の要素 |
| 重なり | 葉テキスト要素どうしの `getBoundingClientRect()` 交差（閉じた `<details>` 内と不可視要素は除外） |

要点:

- `mic-level`: stylesheet **0 / rule 0 / cssLen 0**。`className` は 92 個あるが
  対応 rule が 1 つもない → UA 既定（Times、`<ul>` 黒点、素の button）で描画される。
- `qr-generator`: rule **4 件**（`html,body` リセット + `.qr-layout` のみ）。
  `QRCodeDisplay` の `min-h-[300px]` `bg-[#f9f9f9]` `flex` `gap-5` `border` は
  実測で `display:block` / `background: transparent` / `min-height:auto`。
- `history-quiz` mobile: `html.scrollWidth = 543 > 390`（`.input-wrapper` / `input.blank` が溢れる）。
- `code-type-p5` mobile: `canvas.p5Canvas` の `right = 753 > 390`、祖先 `overflow:hidden` で clip
  → コード行が右端で切れる（再生状態で実測）。
- `pomodoro`: スケジュール label box（192×34）が desktop で互いに 4〜19px 交差、
  mobile では **5 個の label box がタイマー ring と交差**。
- `prototype` mobile: 葉テキスト交差（`ログイン/登録` × `ProtoType` 39×30px、
  `ProtoType` × 日時 60×24px、`ゲーム` × `Game Start`）。
- `fillgen` mobile: sticky の「このセクションを採点」ボタンが次の fieldset の
  legend「スタイル設定」と 70×25px で交差。
- `pi-game`: `styles.css` に `.flex` `.flex-col` `.items-center` `.justify-start` が無く
  container が `display:block` で計測された → `gap:12px` と `self-end` が無効
  （全画面ボタンが container 左端に置かれ、表示 box の上端に接する）。

## 3. 棚卸し表（Tool × viewport × 判定 × 根因 × 修正場所）

| Tool | desktop 1440 | mobile 390 | 判定 | 根因 | 修正場所 |
| --- | --- | --- | --- | --- | --- |
| prototype | OK | **崩れ** | Tool 側 | 固定ヘッダー／左メニューが 390px でロゴ・日時・`Game Start` に重なる | Tool repo |
| readmark | OK | OK | — | — | — |
| text-counter | OK | OK | — | 全スタイルが inline style prop（意図どおり） | — |
| color-palette | OK | OK | — | 同上（min/max 2 本の range は Tool 自身の設計） | — |
| sequential-png-preview | OK | OK | — | 同上 | — |
| svg2tsx | OK | OK | — | 同上 | — |
| business-mail-block | OK | OK | — | `styles.css`（4.7KB）+ inline style で充足 | — |
| code-type-p5 | OK | **崩れ** | Tool 側 | `canvas.p5Canvas` が 753px まで伸び `overflow:hidden` 祖先で clip、コード行が右端で切れる | Tool repo |
| fillgen | OK | **崩れ** | Tool 側 | sticky の採点ボタンが次の fieldset legend に 70×25px で重なる | Tool repo |
| qr-generator | **崩れ** | **崩れ** | Tool 側 | `styles.css` がリセット + `.qr-layout` のみ。`QRCodeDisplay` の utility class が未解決（背景透明 / min-height:auto / flex 無効） | Tool repo |
| pomodoro | **崩れ** | **崩れ** | Tool 側 | `WorkflowProgressBar` の label box が互いに（mobile では ring にも）重なる | Tool repo |
| history-quiz | OK | **崩れ** | Tool 側 | blank input の `.input-wrapper` が横に溢れ `scrollWidth 543` | Tool repo |
| pi-game | **崩れ（軽微）** | **崩れ（軽微）** | Tool 側 | `styles.css` に flex 系 utility が無く container が block。`gap` / `self-end` / `items-center` が無効 | Tool repo |
| ae-expression | OK | OK | — | inline style で充足 | — |
| mic-level | **崩れ** | **崩れ** | Tool 側 | stylesheet が 1 件も無い（92 個の utility className が未解決） | Tool repo |

**host 側の崩れは検出されなかった。** `/tools/<slug>` の chrome と frame box は
Issue #911（別 worker）の変更対象であり、本 Issue では触れない。

## 4. before スクリーンショット

`before-<slug>-<viewport>.webp`（本ディレクトリ、30 枚）。
after は修正後撮影で `after-<slug>-<viewport>.webp` として追加する。
