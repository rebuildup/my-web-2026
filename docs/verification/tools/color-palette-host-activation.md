# color-palette の host 有効化 — 実測記録（Issue #770）

- 対象: `rebuildup/tool-color-palette` @ `b3fed92bac4a6d32b48be21c35ad8b8239d4d5e5`
  （standalone Vite build を追加した upstream PR #6 の merge commit）
- host: `my-web-2026` ブランチ `770`（base `release-0-8-1`）
- 測定日: 2026-11-03
- 測定環境: ローカル preview（`pnpm run build` →
  `node scripts/sync-cf-build-output.mjs` → `vite preview --port 4393 --strictPort`、
  `http://127.0.0.1:4393`）、Chromium（`@playwright/test` の bundled Chromium）
- 測定の再現手順: 上記 preview を起動し、本記録のための計測スクリプト
  （`.tmp/verify-770.mjs`、**リポジトリには含めない**）で `/tools/color-palette`
  を開き、iframe 内で「Generate Colors」→「Copy」→「Save Palette」を操作し、
  再読込後の状態と 2 画面（1440 / 390）を測る。

> この記録は **実測値**の記録である。owner 承認の記録ではない
> （AGENTS.md §6 / `docs/runbook/issue-lifecycle.md`）。

## 1. 成果物と配信境界

| 項目 | 実測値 |
| --- | --- |
| submodule HEAD | `b3fed92bac4a6d32b48be21c35ad8b8239d4d5e5`（manifest の `source.pinned_sha` と一致） |
| `dist/client/tools/color-palette/app/index.html` | 397 B |
| `.../app/assets/index-zAphIY2w.js` | 209,812 B |
| `GET /tools/color-palette` | 200（SSR） |
| `GET /tools/color-palette/app/` | 200 |
| iframe 属性（host 実出力） | `src="/tools/color-palette/app/index.html"` / `sandbox="allow-scripts"` / `referrerpolicy="no-referrer"` / `allow` 属性なし |

埋め込み境界は **`allow-scripts` のみ**で、`allow-same-origin` は付いていない
（Issue #817 の制約。緩めていない）。

## 2. ユーザー操作の実測

同じ preview で、iframe 内を実際にマウス操作して測った。

| 操作 | 実測結果 |
| --- | --- |
| 初期状態 | 「Saved Palettes」= `No saved palettes.` |
| Generate Colors | 5 色を生成（この実行の実測: `#c7d13d` / `#66de65` / `#ab2b33` / `#af5bc1` / `#14cf20`）。各色に `Copy` ボタン、Export に CSS 変数が出力される |
| Copy（先頭色） | 通知は **「コピーしました」**（opaque origin のため `navigator.clipboard` ではなく Tool 側の `document.execCommand('copy')` フォールバック） |
| Save Palette | 「Saved Palettes」に `Palette 1 (5c)` が現れ、`Load` / `Del` が並ぶ。通知は「パレット "Palette 1" を保存しました」 |
| 再読込（ページ reload） | 「Saved Palettes」は **`No saved palettes.` に戻る** |

### 再読込の結果について（未達の明示）

Issue #770 の受け入れ条件には「パレット生成 → 色コードのコピー → **保存パレットの
再読み込み**をユーザー操作で確認する」がある。実測では **再読込で保存内容が残らない**。

原因は境界そのものである。`allow-scripts` のみの sandbox iframe は **opaque origin**
であり、`localStorage` へのアクセスは例外になる。Tool 側はこの例外を捕捉して
**メモリ上の状態で動作を継続する**（`src/components/ColorPaletteGenerator.tsx` の
`try` / `catch`。保存内容の永続化は行わない）。つまり:

- 生成・コピー・保存（セッション内）は成立する。
- 再読込をまたぐ永続化は、`allow-same-origin` を付けるか、Tool 側が
  storage 以外の経路（export / URL 共有など）を用意するまで成立しない。
- 境界を緩める判断は Issue #825 / ADR-0020 の領分であり、本記録では **緩めていない**。

したがって #770 は「生成・コピー・保存 UI は動作するが、再読込の永続化は
sandbox 境界により未達」であり、完了条件を満たしたとは記録しない。

## 3. 視覚確認（quality-gate §19）

| 画像 | 何を示すか |
| --- | --- |
| `color-palette-desktop.webp` | 1440×1000（DPR 2）。生成済み 5 色・各 `Copy`・`Palette 1 (5c)` の Save 済み状態・CSS 変数出力 |
| `color-palette-mobile.webp` | 390×844（DPR 2）。横スクロールなし（実測 `scrollWidth` = `clientWidth` = 390） |

入力データは Tool のサンプルのみ（実在の色名・配色指定は使っていない）。

## 4. 変更ファイル

- `docs/verification/tools/color-palette-{desktop,mobile}.webp` — 本記録の 2 画像
- 本ファイル

host 側の配線（`src/tools/manifest.json` / `.gitmodules` / `quality/*`）は
PR #848 で land 済みで、本 PR は検証記録の追加のみ。

## 5. 未確認事項

- 実機のタッチ操作（iOS Safari / Android Chrome）は未測定。本記録は Chromium の
  マウス入力のみ。
- 本番デプロイ後の配信確認は未実施（release 手順の領分）。
