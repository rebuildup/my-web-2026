# Tool host interaction batch（0.8.1 / 10 Tool 実測）

- 測定日: **2026-11-03**
- 対象ブランチ: `tools-verify-081`（base `origin/release-0-8-1`）
- 測定環境: ローカル preview `http://127.0.0.1:4395`
  （`pnpm run build` → `node scripts/sync-cf-build-output.mjs` →
  `vite preview --port 4395 --strictPort`）、`@playwright/test` 同梱の
  bundled Chromium（headless）。スクリーンショットは DPR 2。
- 測定スクリプト: `.tmp/capture-tools.mjs`（**リポジトリに含めない**）。
- 全ページで GA4 同意バンドの「拒否する」を先に押下し、キャプチャから除外した。
- 外部 origin を持つ Tool は host の activation gate
  （「読み込みを開始する / Load the tool」）を押下してから iframe を測定した。

> この記録は実測値の記録である。owner 承認の記録ではない（AGENTS.md §6 / docs/runbook/issue-lifecycle.md）。

## 0. 共通の測定条件

- host route `GET /tools/<slug>` と artifact `GET /tools/<slug>/app/` は、
  各 Tool の測定セッションで個別に取得し、すべて **200** だった。
- iframe 属性は host が実際に出力した DOM の値である。以下は
  `src` がすべて `/tools/<slug>/app/index.html`、`referrerpolicy` がすべて
  `no-referrer` であることを前提に、差分のある属性だけを示す。

| slug | sandbox | allow | その他 |
| --- | --- | --- | --- |
| text-counter | `allow-scripts` | なし | — |
| qr-generator | `allow-scripts` | なし | — |
| sequential-png-preview | `allow-scripts` | なし | — |
| svg2tsx | `allow-scripts` | なし | — |
| pomodoro | `allow-scripts` | なし | activation gate あり |
| fillgen | `allow-scripts allow-downloads` | `downloads` | — |
| pi-game | `allow-scripts` | `fullscreen` | `allowfullscreen=""` |
| code-type-p5 | `allow-scripts allow-downloads` | `downloads` | activation gate あり |
| prototype | `allow-scripts` | なし | activation gate あり |
| readmark | `allow-scripts` | なし | — |

`fillgen` と `code-type-p5` の live 属性は manifest の宣言
（`sandbox: allow-scripts` のみ）より広い。ここには**実際に出力された値**を
記録し、manifest との一致は判定しない（本記録の範囲外）。

## 1. text-counter

| 項目 | 実測値 |
| --- | --- |
| `GET /tools/text-counter` | 200 |
| `GET /tools/text-counter/app/` | 200 |
| iframe `src` | `/tools/text-counter/app/index.html` |
| iframe `sandbox` | `allow-scripts` |
| iframe `allow` | （属性なし） |
| iframe `referrerpolicy` | `no-referrer` |
| ユーザー操作 | iframe 内の入力欄に `Hello world` / `こんにちは世界。テスト` を入力 |
| 観測結果 | Total Characters **23** / Words **7** / Lines **2** / Byte Size (UTF-8) **45 B** |
| 390px host 横スクロール | なし（`scrollWidth` 390 = `clientWidth` 390） |
| 390px frame 横スクロール | なし（`scrollWidth` 390 = `clientWidth` 390） |
| 1440 スクリーンショット | [text-counter-desktop.webp](./text-counter-desktop.webp)（2880×2000 / DPR 2） |
| 390 スクリーンショット | [text-counter-mobile.webp](./text-counter-mobile.webp)（780×1688 / DPR 2） |

未確認:

- `Copy Text` / `Clear` の動作。
- 設定チェックボックス（Exclude HTML / Exclude URLs / Half-width Kana）の効果。
- Target Length / Max Length を超えた場合の表示。

## 2. qr-generator

| 項目 | 実測値 |
| --- | --- |
| `GET /tools/qr-generator` | 200 |
| `GET /tools/qr-generator/app/` | 200 |
| iframe `src` | `/tools/qr-generator/app/index.html` |
| iframe `sandbox` | `allow-scripts` |
| iframe `allow` | （属性なし） |
| iframe `referrerpolicy` | `no-referrer` |
| ユーザー操作 | iframe 内の Content 欄に `https://example.com` を入力 |
| 観測結果 | 生成表示 `#1: https://example.com`、`canvas` 256×256 が出現 |
| 390px host 横スクロール | なし（390 = 390） |
| 390px frame 横スクロール | 初回 **686 / 390** → 修正後 **390 / 390**（Issue #867 再測定） |
| 1440 スクリーンショット | [qr-generator-desktop.webp](./qr-generator-desktop.webp)（2880×1800、Issue #867 再取得） |
| 390 スクリーンショット | [qr-generator-mobile.webp](./qr-generator-mobile.webp)（780×1688、Issue #867 再取得） |

再測定は 2026-11-03、Tool pin を `2a7d643`（rebuildup/tool-qr-generator PR #6）へ
bump した後に行った。詳細は §12。

未確認:

- `Download PNG` / `Download SVG` のダウンロード内容。
- Bulk モード（複数 URL）。
- Email / Phone / WiFi の各入力型。

## 3. sequential-png-preview

| 項目 | 実測値 |
| --- | --- |
| `GET /tools/sequential-png-preview` | 200 |
| `GET /tools/sequential-png-preview/app/` | 200 |
| iframe `src` | `/tools/sequential-png-preview/app/index.html` |
| iframe `sandbox` | `allow-scripts` |
| iframe `allow` | （属性なし） |
| iframe `referrerpolicy` | `no-referrer` |
| ユーザー操作 | ファイル選択にサンプル PNG 2 枚（`frame-01.png` / `frame-02.png`）を指定 |
| 観測結果 | `1 / 2 フレーム` 表示、`frame-01.png`、`240 × 160px`、再生 / リセット / エクスポート / グリッド表示が出現 |
| 390px host 横スクロール | なし（390 = 390） |
| 390px frame 横スクロール | なし（390 = 390） |
| 1440 スクリーンショット | [sequential-png-preview-desktop.webp](./sequential-png-preview-desktop.webp)（2880×2000） |
| 390 スクリーンショット | [sequential-png-preview-mobile.webp](./sequential-png-preview-mobile.webp)（780×1688） |

未確認:

- `再生` / `リセット` / `エクスポート` / `グリッド表示` の動作。
- フォルダ選択・ZIP 入力。
- フレーム送り（25% / 50% / 75% / 最後）。

## 4. svg2tsx

| 項目 | 実測値 |
| --- | --- |
| `GET /tools/svg2tsx` | 200 |
| `GET /tools/svg2tsx/app/` | 200 |
| iframe `src` | `/tools/svg2tsx/app/index.html` |
| iframe `sandbox` | `allow-scripts` |
| iframe `allow` | （属性なし） |
| iframe `referrerpolicy` | `no-referrer` |
| ユーザー操作 | 「コード」タブへ切替 → SVG ソースを入力 → 「TSXコード」へ切替 |
| 観測結果 | `変換完了 (20 行)`、出力に `import React from 'react';` / `interface IconProps` / `function MyIcon(...)` が出現 |
| 390px host 横スクロール | なし（390 = 390） |
| 390px frame 横スクロール | なし（390 = 390） |
| 1440 スクリーンショット | [svg2tsx-desktop.webp](./svg2tsx-desktop.webp)（2880×2000） |
| 390 スクリーンショット | [svg2tsx-mobile.webp](./svg2tsx-mobile.webp)（780×1688） |

未確認:

- ファイル / URL からの SVG 入力。
- 最適化オプション（不要属性削除 / パス最適化 / 色の変数化 / サイズの変数化）。
- `ファイルをダウンロード` / `クリップボードにコピー` の出力。

## 5. pomodoro

| 項目 | 実測値 |
| --- | --- |
| `GET /tools/pomodoro` | 200 |
| `GET /tools/pomodoro/app/` | 200 |
| iframe `src` | `/tools/pomodoro/app/index.html` |
| iframe `sandbox` | `allow-scripts` |
| iframe `allow` | （属性なし） |
| iframe `referrerpolicy` | `no-referrer` |
| activation gate | あり。「読み込みを開始する / Load the tool」を押下後に iframe が出現 |
| ユーザー操作 | iframe 内のタイマー（`15:00.00` 表示）をクリック |
| 観測結果 | タイマー表示が `15:00.00` → `14:57.41` に減少（カウントダウン開始） |
| 390px host 横スクロール | なし（390 = 390） |
| 390px frame 横スクロール | なし（390 = 390） |
| 1440 スクリーンショット | [pomodoro-desktop.webp](./pomodoro-desktop.webp)（2880×2000） |
| 390 スクリーンショット | [pomodoro-mobile.webp](./pomodoro-mobile.webp)（780×1688） |

実測した注意点:

- artifact の `index.html` は CSS を読み込まず、frame 内は**スタイル未適用**で
  描画される（巨大な円弧 + 素のテキスト。desktop の capture がその実測である）。
- sandbox の opaque origin のため `localStorage` / `sessionStorage` の読み取りが
  `SecurityError` になる（console に `pomodoro-settings` / `pomodoro-stats` /
  `pomodoro-sessions` / `pomodoro-current-step` / `pomodoro-time-left`）。
  タイマーのカウントダウン自体は継続する。

未確認:

- タイマーの完走・セッション切替・通知。
- `Note` / `YouTube` / `Theme` / `Settings` パネル。
- storage 永続化（sandbox で拒否されるため未確認）。

## 6. fillgen

| 項目 | 実測値 |
| --- | --- |
| `GET /tools/fillgen` | 200 |
| `GET /tools/fillgen/app/` | 200 |
| iframe `src` | `/tools/fillgen/app/index.html` |
| iframe `sandbox` | `allow-scripts allow-downloads` |
| iframe `allow` | `downloads` |
| iframe `referrerpolicy` | `no-referrer` |
| ユーザー操作 | プレビューの第 1 空欄に正答 `大東亜共栄圏` を入力し、「このセクションを採点」をクリック |
| 観測結果 | 空欄 class が `blank correct` / `blank incorrect` / `blank` / `blank`（正解 1・不正解 1） |
| 390px host 横スクロール | なし（390 = 390） |
| 390px frame 横スクロール | なし（390 = 390） |
| 1440 スクリーンショット | [fillgen-desktop.webp](./fillgen-desktop.webp)（2880×2000） |
| 390 スクリーンショット | [fillgen-mobile.webp](./fillgen-mobile.webp)（780×1688） |

未確認:

- `HTML` / `React` 出力タブの内容。
- ページ追加 / ページ削除。
- `答えを見る` / `リセット` の動作。
- スタイル設定（プリセット / 色 / サイズ）の反映。

## 7. pi-game

| 項目 | 実測値 |
| --- | --- |
| `GET /tools/pi-game` | 200 |
| `GET /tools/pi-game/app/` | 200 |
| iframe `src` | `/tools/pi-game/app/index.html` |
| iframe `sandbox` | `allow-scripts` |
| iframe `allow` | `fullscreen`（`allowfullscreen=""` も出力） |
| iframe `referrerpolicy` | `no-referrer` |
| ユーザー操作 | 中央の `3 to Start` キーを押して開始し、テンキーで `3 → 1 → 4` を入力 |
| 観測結果 | 結果画面に `結果 : 0桁` / `3..` / `3 to Retry` が出現 |
| 390px host 横スクロール | なし（390 = 390） |
| 390px frame 横スクロール | 初回 **422 / 390** → 修正後 **390 / 390**（Issue #867 再測定） |
| 1440 スクリーンショット | [pi-game-desktop.webp](./pi-game-desktop.webp)（2880×1800、Issue #867 再取得） |
| 390 スクリーンショット | [pi-game-mobile.webp](./pi-game-mobile.webp)（780×1688、Issue #867 再取得） |

再測定は 2026-11-03、Tool pin を `b234aa0`（rebuildup/tool-pi-game PR #6）へ
bump した後に行った。詳細は §12。

未確認:

- 正しい記憶ラウンドとしての採点（実測は `0桁` で、成功した記憶入力は未確認）。
- `全画面` ボタン。
- スコア / ベスト記録の保存。

## 8. code-type-p5

| 項目 | 実測値 |
| --- | --- |
| `GET /tools/code-type-p5` | 200 |
| `GET /tools/code-type-p5/app/` | 200 |
| iframe `src` | `/tools/code-type-p5/app/index.html` |
| iframe `sandbox` | `allow-scripts allow-downloads` |
| iframe `allow` | `downloads` |
| iframe `referrerpolicy` | `no-referrer` |
| activation gate | あり。「読み込みを開始する」を押下後に iframe が出現 |
| ユーザー操作 | iframe 内の `Play` をクリック |
| 観測結果 | ボタンが `Play` → `Pause` に変化し、p5 canvas（720×720、補助 canvas 100×100）が描画される |
| 390px host 横スクロール | なし（390 = 390） |
| 390px frame 横スクロール | なし（390 = 390） |
| 1440 スクリーンショット | [code-type-p5-desktop.webp](./code-type-p5-desktop.webp)（2880×2000） |
| 390 スクリーンショット | [code-type-p5-mobile.webp](./code-type-p5-mobile.webp)（780×1688） |

未確認:

- `Edit Code` の編集内容と再実行。
- キー入力によるタイピング判定・スコア。
- `Pause` からの再開。

## 9. prototype

| 項目 | 実測値 |
| --- | --- |
| `GET /tools/prototype` | 200 |
| `GET /tools/prototype/app/` | 200 |
| iframe `src` | `/tools/prototype/app/index.html` |
| iframe `sandbox` | `allow-scripts` |
| iframe `allow` | （属性なし） |
| iframe `referrerpolicy` | `no-referrer` |
| activation gate | あり。「読み込みを開始する」を押下後に iframe が出現 |
| ユーザー操作 | iframe 内の `Game Start` をクリック |
| 観測結果 | `Close` ボタンが出現し、`プレイ記録` / `ゲーム選択` / `ゲーム設定` のメニューが描画される |
| 390px host 横スクロール | なし（390 = 390） |
| 390px frame 横スクロール | なし（390 = 390） |
| 1440 スクリーンショット | [prototype-desktop.webp](./prototype-desktop.webp)（2880×2000） |
| 390 スクリーンショット | [prototype-mobile.webp](./prototype-mobile.webp)（780×1688） |

実測した注意点:

- メニューは WebGL / SVG で描画され、DOM のボタン・テキストを持たない。
  そのため `ゲーム選択` 以降のゲーム開始操作は座標クリックでも確定できなかった。
- console に `browserAll-CFss0BaY.js` / `webworkerAll-DQEawDaD.js` の
  CORS 失敗（opaque origin から `/assets/*` を取得できない）を観測した。
  ログイン画面とメニュー自体は描画される。

未確認:

- タイピングゲームの開始・プレイ・結果。
- `ログイン/登録` / `ランキング` / `ゲーム設定` の各画面。
- `ゲーム選択` メニューの選択確定。

## 10. readmark

| 項目 | 実測値 |
| --- | --- |
| `GET /tools/readmark` | 200 |
| `GET /tools/readmark/app/` | 200 |
| iframe `src` | `/tools/readmark/app/index.html` |
| iframe `sandbox` | `allow-scripts` |
| iframe `allow` | （属性なし） |
| iframe `referrerpolicy` | `no-referrer` |
| ユーザー操作 | `PDF を import` をクリックし、file chooser にサンプル PDF を指定 |
| 観測結果 | `filechooser` イベント 1 件。取り込みは `取り込みに失敗しました。時間をおいて再度お試しください。` で失敗 |
| 390px host 横スクロール | なし（390 = 390） |
| 390px frame 横スクロール | なし（390 = 390） |
| 1440 スクリーンショット | [readmark-desktop.webp](./readmark-desktop.webp)（2880×2000） |
| 390 スクリーンショット | [readmark-mobile.webp](./readmark-mobile.webp)（780×1688） |

実測した注意点:

- PDF worker が `/assets/pdf.worker.min-iDqQPrd3.mjs`（Tool の実体は
  `/tools/readmark/app/assets/` 配下）へ解決され、さらに opaque origin からの
  CORS で遮断される。readmark のスクリーンショットは、この**取り込み失敗の
  インライン通知**を写した実測である（host のエラーページではない）。
- 文書を開けないため、ライブラリは空のままである。

未確認:

- PDF 本文の表示・ページ送り・読書状態の復元。
- EPUB / Markdown / テキストの取り込み。

## 11. 横スクロールのまとめ（390px）

| slug | host `scrollWidth` / `clientWidth` | frame `scrollWidth` / `clientWidth` | frame 横スクロール |
| --- | --- | --- | --- |
| text-counter | 390 / 390 | 390 / 390 | なし |
| qr-generator | 390 / 390 | 初回 686 / 390 → **390 / 390** | なし（Issue #867 修正後） |
| sequential-png-preview | 390 / 390 | 390 / 390 | なし |
| svg2tsx | 390 / 390 | 390 / 390 | なし |
| pomodoro | 390 / 390 | 390 / 390 | なし（CSS は Issue #868 で修正。幅は元から 390） |
| fillgen | 390 / 390 | 390 / 390 | なし |
| pi-game | 390 / 390 | 初回 422 / 390 → **390 / 390** | なし（Issue #867 修正後） |
| code-type-p5 | 390 / 390 | 390 / 390 | なし |
| prototype | 390 / 390 | 390 / 390 | なし |
| readmark | 390 / 390 | 390 / 390 | なし |

host ページ自体はいずれも 390px で横スクロールしない。初回測定で
`qr-generator` と `pi-game` の **frame 内だけ**が横にはみ出していたが、
Issue #867 の Tool pin bump 後に再測定し、いずれも 390 = 390 になった（§12）。


## 12. Issue #867 再測定（qr-generator / pi-game の 390px 横スクロール）

- 再測定日: **2026-11-03**
- 対象ブランチ: `867`（base `origin/release-0-8-1`）
- 測定環境: ローカル preview `http://127.0.0.1:5181`
  （`pnpm run build` → `node scripts/sync-cf-build-output.mjs` →
  `vite preview --port 5181 --strictPort`）、`@playwright/test` 同梱の
  bundled Chromium（headless、DPR 2）
- viewport: **390×844** と **1440×900**
- 全ページで GA4 同意バンドの「拒否する」を先に押下した。
- 両 Tool とも activation gate はない（`third_party_origins` が空）。
- 測定値は iframe の `contentWindow.document.documentElement` の
  `scrollWidth` / `clientWidth`（same-origin のため直接読める）。

### Tool pin

| slug | 修正前 pin | 修正後 pin | Tool repo PR |
| --- | --- | --- | --- |
| qr-generator | `0df1a99` | `2a7d643` | rebuildup/tool-qr-generator #6 |
| pi-game | `e67d9ce` | `b234aa0` | rebuildup/tool-pi-game #6 |

### 実測値

| slug | viewport | host `scrollWidth` / `clientWidth` | frame `scrollWidth` / `clientWidth` | 判定 |
| --- | --- | --- | --- | --- |
| qr-generator | 390×844 | 390 / 390 | **390 / 390**（修正前 686 / 390） | 解消 |
| qr-generator | 1440×900 | 1440 / 1440 | 1440 / 1440 | 回帰なし |
| pi-game | 390×844 | 390 / 390 | **390 / 390**（修正前 422 / 390） | 解消 |
| pi-game | 1440×900 | 1440 / 1440 | 1440 / 1440 | 回帰なし |

- qr-generator は iframe 内の Content 欄に `https://example.com` を入力し、
  QR を生成した状態で測定した。
- pi-game は `3 → 1 → 4` を入力し、結果画面（`結果 : 0桁`）で測定した。

### 原因と修正（Tool 側）

- qr-generator: 2 カラム grid が `1fr 1fr; gap: 40px` 固定で、狭幅用の分岐が
  なかった。左カラムの min-content（約 358px）と右カラム（QR canvas 288px）の
  合計が 686px になり viewport を超えていた。`src/styles.css` を追加し、
  768px 未満で 1 カラムに stack するよう変更（desktop は 2 カラムのまま）。
- pi-game: `src/styles.css` に `box-sizing` リセットがなく、
  `mx-auto w-full px-4` の padding 32px が 100% 幅に加算されていた。
  `*, *::before, *::after { box-sizing: border-box; }` を追加。

host 側は iframe を置くだけで、`overflow: hidden` などで差分を隠す変更は
行っていない。manifest の `pinned_sha`、privacy basis、
`quality/tool-artifact-inventory.json` を gitlink と同時に更新した。

### 証跡

- [qr-generator-desktop.webp](./qr-generator-desktop.webp)（2880×1800）
- [qr-generator-mobile.webp](./qr-generator-mobile.webp)（780×1688）
- [pi-game-desktop.webp](./pi-game-desktop.webp)（2880×1800）
- [pi-game-mobile.webp](./pi-game-mobile.webp)（780×1688）

未確認:

- 390px 未満（例: 360px）での挙動。
- qr-generator の Bulk / Email / Phone / WiFi 入力型での横幅。
