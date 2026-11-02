# ae-expression の host 有効化 — 実測記録（Issue #773）

- 対象: `rebuildup/tool-ae-expression` @ `56bbbbd6174c1baee5b542565466f8154ad633ed`
  （standalone Vite build を追加した upstream PR の merge commit）
- host: `my-web-2026` ブランチ `773`（base `release-0-8-1`）
- 測定日: 2026-11-03
- 測定環境: ローカル preview（`pnpm run build` →
  `node scripts/sync-cf-build-output.mjs` → `vite preview --port 4394 --strictPort`、
  `http://127.0.0.1:4394`）、Chromium（`@playwright/test` の bundled Chromium）
- 測定の再現手順: 上記 preview を起動し、本記録のための計測スクリプト
  （`.tmp/verify-773.mjs`、**リポジトリには含めない**）で `/tools/ae-expression`
  を開き、iframe 内で expression を選択し、生成コードのコピーを行って 2 画面
  （1440 / 390）を撮る。

> この記録は **実測値**の記録である。owner 承認の記録ではない
> （AGENTS.md §6 / `docs/runbook/issue-lifecycle.md`）。

## 1. 成果物と配信境界

| 項目 | 実測値 |
| --- | --- |
| submodule HEAD | `56bbbbd6174c1baee5b542565466f8154ad633ed`（manifest の `source.pinned_sha` と一致） |
| `dist/client/tools/ae-expression/app/index.html` | 329 B |
| `.../app/assets/index-B-Z-xj3f.js` | 265,778 B |
| `GET /tools/ae-expression` | 200（SSR） |
| `GET /tools/ae-expression/app/` | 200 |
| iframe 属性（host 実出力） | `src="/tools/ae-expression/app/index.html"` / `sandbox="allow-scripts allow-downloads"` / `allow="downloads"` / `referrerpolicy="no-referrer"` |

`allow-downloads` は Tool のエクスポート（ファイル保存）のために宣言されており、
`allow-same-origin` は付いていない。埋め込み境界は緩めていない。

## 2. ユーザー操作の実測

同じ preview で、iframe 内を実際にマウス操作して測った。

| 操作 | 実測結果 |
| --- | --- |
| 一覧表示 | 「エクスプレッション一覧」に Wiggle / Loop Out / Time-based Rotation などが並ぶ（カテゴリ・難易度・お気に入りフィルタ付き） |
| expression 選択 | 「Wiggle」を選択 → パラメータ設定に `frequency (Hz)` / `amplitude (px)` が出る |
| 生成コード | `wiggle(2, 50)`（frequency 2 / amplitude 50）。「エクスプレッションは正常です」の正常表示 |
| コピー | コピーボタンが **「コピー完了」** に変わる（押下後の実測） |
| パラメータ入力 | `input` 要素 5 件（range / number）が実在し、初期値が反映されている |
| `next/link` 由来の nav | 残っていない（Tool 内のパンくずは `Home / Tools / After Effects Expression Helper` を静的表示するのみで、host のルートは持ち込まない） |

## 3. 視覚確認（quality-gate §19）

| 画像 | 何を示すか |
| --- | --- |
| `ae-expression-desktop.webp` | 1440×1000（DPR 2）。Wiggle 選択・パラメータ・生成コード `wiggle(2, 50)`・「コピー完了」状態 |
| `ae-expression-mobile.webp` | 390×844（DPR 2）。横スクロールなし（実測 `scrollWidth` = `clientWidth` = 390） |

入力データは Tool のサンプルのみ。

## 4. 変更ファイル

- `docs/verification/tools/ae-expression-{desktop,mobile}.webp` — 本記録の 2 画像
- 本ファイル

host 側の配線（`src/tools/manifest.json` / `.gitmodules` / `quality/*`）は
PR #858 で land 済みで、本 PR は検証記録の追加のみ。

## 5. 未確認事項

- 実機のタッチ操作（iOS Safari / Android Chrome）は未測定。本記録は Chromium の
  マウス入力のみ。
- エクスポート（`allow-downloads`）のファイル保存は、color-palette と同様の
  download イベント計測を本記録では行っていない（別途必要なら追記する）。
- 本番デプロイ後の配信確認は未実施（release 手順の領分）。
