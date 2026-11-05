この記録は実測値であり owner 承認ではない。

# Tool first-party 同一 origin 配信 — 追補実測（Issue #825 後）

- 測定日: **2026-11-03**
- 対象: worktree `/Users/rebui/work/my-web-2026/.toolsfollowup`
  （branch `tools-verify-followup`、HEAD **`4e91f075`** = PR #869 / Issue #825 の
  merge head、base `origin/release-0-8-1`）
- 測定環境: `pnpm run build` → `node scripts/sync-cf-build-output.mjs` →
  `pnpm exec vite preview --port 4397 --strictPort`。`@playwright/test` 同梱の
  bundled Chromium（headless）、DPR 2。
- 全ページで GA4 同意バンドの「拒否する」を先に押下した。`click_to_load` の
  Tool は host の「読み込みを開始する」を押下してから iframe を測定した。
- 測定スクリプト: `.tmp/measure-followup.mjs`、`.tmp/probe-pomodoro-persist.mjs`、
  `.tmp/probe-readmark-retry.mjs`（`.tmp/` は git 管理外。リポジトリに含めない）。
- 既存記録 [`host-interaction-batch-0-8-1.md`](./host-interaction-batch-0-8-1.md)
  （sandbox 時代の基準）と [`tool-first-party-delivery.md`](./tool-first-party-delivery.md)
  （#825 の契約）は変更していない。本書はその追補である。
- `/tools/<slug>` と `/tools/<slug>/app/index.html` は、測定した全 Tool で
  最終応答 **200**（`index.html` は 307 で `/app/` に正規化される）。

## 1. A. #825 後に変わるはずだった条件

### 1.1 readmark: PDF import の再試行

| 項目 | 内容 |
| --- | --- |
| 操作 | `/tools/readmark` を開き、空ライブラリを確認。`PDF を import` に `.tmp/sample/readmark-sample.pdf` を指定する操作を **2 回**行った（1440 / 390）。 |
| 観測値 | 空表示は「**まだ文書がありません**」「import ボタンから PDF を追加してください。」「PDF を import」2 箇所。「ライブラリは空です」ではない。1 回目・2 回目とも「**取り込みに失敗しました。時間をおいて再度お試しください。**」を表示。PDF worker は `http://127.0.0.1:4397/assets/pdf.worker.min-iDqQPrd3.mjs` に解決され **404**（`net::ERR_FAILED` / `net::ERR_ABORTED`）、console に 404 error。Tool の実体は `/tools/readmark/app/assets/` 配下。 |
| 判定 | **不合格**（import は再試行しても失敗）。same-origin 化で CORS エラーは消えたが、worker URL が host root を指す解決不具合は残る。 |
| 未確認の理由 | worker が 404 のため、PDF 本文・ページ送り・読書状態の復元に到達できない。EPUB / Markdown の取り込みも未確認。 |

証跡: [desktop](./readmark-import-desktop.webp) /
[mobile](./readmark-import-mobile.webp)（取り込み失敗のインライン通知）。

### 1.2 prototype: 同意後の console error

| 項目 | 内容 |
| --- | --- |
| 操作 | `/tools/prototype` → 同意 → 「読み込みを開始する」→ `Game Start` を押下（1440 / 390）。 |
| 観測値 | frame の `window.origin` は host と同一の `http://127.0.0.1:4397`。`Game Start` 後に **2880×2400 の canvas** と `Close` が出現。console error は次の 3 件（すべて 404。CORS メッセージではない）。<br>1. `http://127.0.0.1:4397/assets/browserAll-CFss0BaY.js` → 404（`ERR_ABORTED`）<br>2. `http://127.0.0.1:4397/assets/webworkerAll-DQEawDaD.js` → 404（`ERR_ABORTED`）<br>3. `http://127.0.0.1:4397/assets/collect-CGVKdOWb.wav` → 404<br>同じ `browserAll-*` / `webworkerAll-*` は `/tools/prototype/app/assets/` では **200** を返しており、メニューとゲーム canvas は描画される。 |
| 判定 | CORS エラーは**解消**。ただし root 絶対 `/assets/*` を要求する 404 は**残存**（2 chunk + wav）。ゲーム描画自体は継続する。 |
| 未確認の理由 | タイピングゲームの開始後の入力・採点・結果、ログイン/登録、ランキング画面は未確認。third-party 要求の件数も再測していない（#825 記録の未測定項目と同じ）。 |

証跡: [desktop](./prototype-menu-desktop.webp) /
[mobile](./prototype-menu-mobile.webp)。

### 1.3 pomodoro: localStorage / sessionStorage と再読込

| 項目 | 内容 |
| --- | --- |
| 操作 | タイマーを開始して約 2.8 秒後に再読込。Settings → ウィジェット → スライダーを 240 → 270 に変更して再読込。storage への probe write も実行（1440 / 390）。 |
| 観測値 | `localStorage` keys: `pomodoro-stats` / `pomodoro-widgets` / `pomodoro-sessions` / `pomodoro-settings`（+ `my-web-2026:analytics-consent`）。`sessionStorage` keys: `pomodoro-current-step` / `pomodoro-time-left`。probe write は双方成功、**SecurityError なし**。設定は `stickyWidgetSize` が 240 → **270** に変わり、再読込後の JSON と UI（`270px`）でも 270 を確認。タイマーは `15:00.00` → **`14:57.21`**、停止ダイアログの「一時停止」後 **`14:56.81`** で安定、リセット後 **`15:00.00`**。一方、開始 2.8 秒後の `pomodoro-time-left` は **`900000` のまま**で、再読込後の表示も **`15:00.00`** に戻った。 |
| 判定 | storage の読み書きは**成功**し、**設定は再読込で残る**。カウントダウン中の残り時間は sessionStorage に更新されず、再読込で初期値に戻る（Tool 側の保存挙動であり、#825 の SecurityError とは別）。 |
| 未確認の理由 | タイマーの完走・セッション切替・通知、Note / YouTube / Theme / Settings の各機能は未確認。CSS 未適用は #868 として別途確認した。 |

証跡: [開始/停止 desktop](./pomodoro-timer-desktop.webp) /
[開始/停止 mobile](./pomodoro-timer-mobile.webp) /
[設定変更 desktop](./pomodoro-settings-persist-desktop.webp) /
[設定変更 mobile](./pomodoro-settings-persist-mobile.webp) /
[再読込後 270px desktop](./pomodoro-settings-reload-view-desktop.webp) /
[再読込後 270px mobile](./pomodoro-settings-reload-view-mobile.webp)。

### 1.4 color-palette: Generate → Copy → Save → 再読込（Issue #770）

| 項目 | 内容 |
| --- | --- |
| 操作 | `/tools/color-palette` で `Generate Colors` → 色コードの `Copy` → `Save Palette` → ページ再読込（1440 / 390）。 |
| 観測値 | 5 色を生成（例: `#069b75` / `#d40385` / `#2c548a` / `#54178e` / `#bd5c85`）。Copy 後に「**コピーしました**」。Save 後に Saved Palettes へ「**Palette 1 (5c)**」。`localStorage` の `color-palettes-v2` は再読込前後で同一値、Saved Palettes も再読込後に同じ 1 件が残った。Generated Palette 本体は再読込後は空で、残るのは Saved Palettes。 |
| 判定 | **保存パレットの再読込は合格**。sandbox 時代に保存できなかった #770 の欠落は、現構成で解消している。 |
| 未確認の理由 | Copy のクリップボード内容そのもの（通知のみ確認）、複数パレットの Load / Del、CSS / Tailwind / JSON など他 export 形式は未確認。 |

証跡: [desktop](./color-palette-reload-desktop.webp) /
[mobile](./color-palette-reload-mobile.webp)（再読込後の Saved Palettes）。

## 2. B. Issue 受け入れ操作

### 2.1 #355 qr-generator — PNG / SVG download

| 項目 | 内容 |
| --- | --- |
| 操作 | Content に `https://example.com` を入力し、`Download PNG` と `Download SVG` を押下（1440 / 390）。 |
| 観測値 | `#1: https://example.com` と **256×256 canvas**。PNG は **3482 bytes**、magic bytes **`89504e470d0a1a0a`**。SVG は **1227 bytes**、magic bytes **`3c73766720786d6c`**（`<svg xml`）、先頭は `<svg xmlns="http://www.w3.org/2000/svg" width="256" …`。 |
| 判定 | 入力 → QR 描画 → PNG / SVG download は**合格**（magic bytes とサイズで確認）。 |
| 未確認の理由 | Bulk モード、Email / Phone / WiFi の各入力型、ダウンロードファイルの保存先は未確認。 |

証跡: [desktop](./qr-generator-download-desktop.webp) /
[mobile](./qr-generator-download-mobile.webp)。

### 2.2 #356 svg2tsx — 変換と clipboard

| 項目 | 内容 |
| --- | --- |
| 操作 | サンプル SVG を「コード」タブへ入力し、「TSXコード」へ切替、`クリップボードにコピー` を押下（1440 / 390）。 |
| 観測値 | `変換完了 (20 行)`、出力 **499 文字**、先頭は `import React from 'react';` / `interface IconProps`。ボタンは「**コピー完了**」。クリップボードの内容は出力と**完全一致**（499 文字、`clipboardEqualsOutput: true`）。 |
| 判定 | SVG 入力 → TSX 出力 → copy は**合格**。 |
| 未確認の理由 | ファイル / URL からの SVG 入力、最適化オプション、`ファイルをダウンロード` は未確認。 |

証跡: [desktop](./svg2tsx-clipboard-desktop.webp) /
[mobile](./svg2tsx-clipboard-mobile.webp)。

### 2.3 #357 sequential-png-preview — 連番 PNG とフレーム切替

| 項目 | 内容 |
| --- | --- |
| 操作 | `seq-01.png` 〜 `seq-05.png` の 5 枚を file chooser に指定し、`25%` → `50%` → `75%` → `最後` → `最初` を押下（1440 / 390）。 |
| 観測値 | 初期 `1 / 5 フレーム` / `seq-01.png`。`25%` → `2 / 5` / `seq-02.png`、`50%` → `3 / 5` / `seq-03.png`、`75%` → `4 / 5` / `seq-04.png`、`最後` → `5 / 5` / `seq-05.png`、`最初` → `1 / 5` / `seq-01.png`。canvas は desktop **898×600**、mobile **324×243**。 |
| 判定 | 3 枚以上の連番読み込みと 25 / 50 / 75 / 最後の切替は**合格**。 |
| 未確認の理由 | フォルダ選択、ZIP 入力、`再生` / `リセット` / `エクスポート` / `グリッド表示` は未確認。 |

証跡: [desktop](./sequential-png-preview-frames-desktop.webp) /
[mobile](./sequential-png-preview-frames-mobile.webp)。

### 2.4 #358 pomodoro — 開始 / 停止 / リセット

| 項目 | 内容 |
| --- | --- |
| 操作 | タイマーを開始し、停止ダイアログで「一時停止」、再開後に再度ダイアログを開いて「リセット」を押下（1440 / 390）。 |
| 観測値 | 初期 `15:00.00` → 開始 2.6 秒後 **`14:57.41`** → 一時停止 **`14:56.81`** → 1.6 秒待っても `14:56.81` のまま（停止中） → リセット **`15:00.00`**。停止ダイアログの文言は「タイマーを停止しますか？」で、ボタンは `リセット` / `一時停止` / `スキップ`。 |
| 判定 | 開始・停止（一時停止）・リセットの数値変化は**合格**。 |
| 未確認の理由 | タイマー完走、セッション切替、通知。CSS 未適用は #868。 |

証跡: [desktop](./pomodoro-timer-desktop.webp) /
[mobile](./pomodoro-timer-mobile.webp)。

### 2.5 #359 fillgen — テキストから穴埋め問題を生成

| 項目 | 内容 |
| --- | --- |
| 操作 | エディタに `日本の首都は{{東京}}です。富士山の高さは{{3776|120}}メートルです。` を入力（1440 / 390）。 |
| 観測値 | 空欄 **2 個**、解答は `東京` / `3776`、幅は `60px` / `120px`。プレビューに「日本の首都は 東京 です。富士山の高さは 3776 メートルです。」が生成され、`このセクションを採点` / `答えを見る` / `リセット` が出現。 |
| 判定 | 文章入力 → 穴埋め問題生成は**合格**。 |
| 未確認の理由 | `HTML` / `React` 出力タブ、採点結果、ページ追加/削除、スタイル設定の反映は未確認。 |

証跡: [desktop](./fillgen-generated-desktop.webp) /
[mobile](./fillgen-generated-mobile.webp)。

### 2.6 #354 pi-game — ラウンド採点の桁数

| 項目 | 内容 |
| --- | --- |
| 操作 | `3 to Start` を押し、`3` → `.` → `1 4 1 5 9 2 6 5 3` の順に入力（1440 / 390）。 |
| 観測値 | 結果画面は **`結果 : 10桁`**、入力列は `3.1415926535`、`3 to Retry` が出現。`0桁` ではない。 |
| 判定 | ラウンド採点が入力桁数として反映されることを**確認**。旧記録の `0桁` は、`.` を入力しなかった操作に由来し、今回の正しい操作では 10 桁になった。 |
| 未確認の理由 | ゲーム完走、ベスト記録の保存、全画面ボタンは未確認。 |

証跡: [desktop](./pi-game-score-desktop.webp) /
[mobile](./pi-game-score-mobile.webp)。

### 2.7 #353 text-counter — 再確認

| 項目 | 内容 |
| --- | --- |
| 操作 | `Hello world` / `こんにちは世界。テスト` を入力（1440 / 390）。 |
| 観測値 | **Total Characters 23 / Words 7 / Lines 2 / Byte Size (UTF-8) 45 B**。旧記録と同じ値。 |
| 判定 | 文字数・語数の実測表示は**維持**（回帰なし）。 |
| 未確認の理由 | Copy / Clear、除外オプション（HTML / URL / 半角カナ）、Target / Max Length 超過時の表示は未確認。 |

証跡: [desktop](./text-counter-recheck-desktop.webp) /
[mobile](./text-counter-recheck-mobile.webp)。

### 2.8 #361 code-type-p5 — 再確認

| 項目 | 内容 |
| --- | --- |
| 操作 | 同意 → 「読み込みを開始する」→ `Play` を押下（1440 / 390）。 |
| 観測値 | ボタンが `Play` → **`Pause`** に変化。p5 canvas **720×720** と補助 canvas **100×100** が描画。`Edit Code` が出現。 |
| 判定 | サンプル表示と再生 UI は**維持**（回帰なし）。 |
| 未確認の理由 | `Edit Code` の編集と再実行、キー入力によるタイピング判定・スコア、`Pause` からの再開は未確認。 |

証跡: [desktop](./code-type-p5-recheck-desktop.webp) /
[mobile](./code-type-p5-recheck-mobile.webp)。

## 3. C. 既知 defect の確認（修正はしていない）

### 3.1 #867 — qr-generator / pi-game の 390px frame 横スクロール

| 項目 | 内容 |
| --- | --- |
| 操作 | `/tools/qr-generator` と `/tools/pi-game` を 390px で表示し、host と frame の `scrollWidth` / `clientWidth` を測定。 |
| 観測値 | qr-generator: host **390 / 390**、frame **686 / 390**。pi-game: host **390 / 390**、frame **422 / 390**。1440px では両方 host / frame とも **1440 / 1440**。 |
| 判定 | **欠陥は残存**。frame 内だけが横スクロールする。host 側ははみ出していない。 |
| 未確認の理由 | Tool repo 側の修正と pin bump はこのタスクの範囲外（確認のみ）。#867 の受け入れ条件 4 が求める既存記録への追記は、既存記録を変更しない指示のため行わず、再測定を本書に記録した。 |

### 3.2 #868 — pomodoro の CSS 未適用

| 項目 | 内容 |
| --- | --- |
| 操作 | `/tools/pomodoro` の frame で `document.styleSheets` / stylesheet link / 計算済み style を確認し、スクリーンショットを取得。 |
| 観測値 | `styleSheets` **1**、`link[rel="stylesheet"]` **0**、`style` タグ **1**、`body` の `font-family` は **Times**、`margin` **0px**、`background-color` **rgba(0, 0, 0, 0)**。画面は巨大な円弧 + 素のテキストで、設計どおりの見た目ではない。 |
| 判定 | **欠陥は残存**。`index.html` が CSS を参照していない状態は #825 後も変わらない。 |
| 未確認の理由 | Tool repo 側の修正と pin bump は範囲外（確認のみ）。#868 の受け入れ条件 3 が求める既存記録への追記は、既存記録を変更しない指示のため行っていない。 |

## 4. Issue 受け入れ条件の判定表

「操作面」は本書で実際に操作・観測した範囲の判定である。**Issue 全体の完了判定ではない。**
AGENTS.md §6 のとおり、緑の CI・文書・本記録だけでは Issue を close できない。

| Issue | 本書で確認した操作 | 操作面 | 満たさない / 未確認の理由 |
| --- | --- | --- | --- |
| #770 color-palette | 生成 → Copy → Save → 再読込 | **満たす** | Copy のクリップボード内容、複数パレットの Load / Del、license / dependencies の verified、pinned SHA 再現、`tools:artifact:check` は未評価。sandbox 条項は #825 / ADR-0020 で置換済み。 |
| #355 qr-generator | 入力 → 描画 → PNG / SVG download | **満たす** | Bulk / Email / Phone / WiFi、pinned SHA 再現、CI artifact 検知、`tools:check` / `validate:fast` / E2E は未評価。sandbox 条項は置換済み。 |
| #356 svg2tsx | SVG → TSX → copy | **満たす** | ファイル / URL 入力、最適化オプション、download、pinned SHA / CI / E2E は未評価。sandbox 条項は置換済み。 |
| #357 sequential-png-preview | 5 枚読み込み → 25/50/75/最後/最初 | **満たす** | フォルダ / ZIP、再生 / エクスポート / グリッド、pinned SHA / CI / E2E は未評価。sandbox 条項は置換済み。 |
| #358 pomodoro | 開始 → 一時停止 → リセット | **満たす**（操作面） | 完走・通知・セッション切替は未確認。CSS 未適用（#868）が残る。pinned SHA / CI / E2E は未評価。sandbox 条項は置換済み。 |
| #359 fillgen | テキスト → 穴埋め生成 | **満たす** | HTML / React 出力、採点、ページ操作、スタイルは未確認。pinned SHA / CI / E2E は未評価。sandbox 条項は置換済み。 |
| #354 pi-game | 3 → . → 9 桁 → 結果 10 桁 | **満たす**（採点） | 完走・ベスト記録・全画面は未確認。pinned SHA / CI / E2E は未評価。sandbox 条項は置換済み。 |
| #353 text-counter | 入力 → 文字数 / 語数 | **満たす**（回帰なし） | Copy / Clear、除外オプション、上限表示は未確認。pinned SHA / CI / E2E は未評価。sandbox 条項は置換済み。 |
| #361 code-type-p5 | Play → Pause、canvas 描画 | **満たす**（回帰なし） | Edit Code、タイピング判定・スコア、再開は未確認。pinned SHA / CI / E2E は未評価。sandbox 条項は置換済み。 |
| #867 qr / pi の 390px | 390px で overflow 測定 | **満たさない** | qr 686/390、pi 422/390 で欠陥が残存。修正は Tool repo + pin bump が前提で、このタスクでは未実施。 |
| #868 pomodoro CSS | frame の stylesheet / 計算済み style | **満たさない** | stylesheet link 0、Times / margin 0 のまま。修正は Tool repo + pin bump が前提で、このタスクでは未実施。 |

### 4.1 全 Issue に共通して「この記録では評価していない」条件

次の条件は repository gate / PR process の条件であり、ブラウザ実測だけでは
満たしたことにならない。**未評価であり、成功として扱わない。**

- pinned SHA で再現可能な standalone 出力を host が取得/ビルドする。
- 欠落ビルド artifact を CI が検知し、silent success にならない。
- `pnpm run tools:check` / `pnpm run tools:artifact:check` /
  `pnpm run validate:fast` と、対象 Tool のブラウザ E2E。
- 1 Issue = host 側 1 PR の運用、ライセンス / 依存の境界。
- `quality/tool-artifact-inventory.json` の license / dependencies の verified。

また、#353 / #354 / #355 / #356 / #357 / #358 / #359 / #361 / #770 の
「iframe sandbox … が維持される」という条件は、**#825 / ADR-0020 により
first-party Tool では sandbox を宣言しない**契約へ置き換わっている。
文面どおりの「sandbox 維持」は満たさないが、これは現行契約に対する
意図的な変更であり、退行ではない。

## 5. 再現方法

```sh
pnpm run build
node scripts/sync-cf-build-output.mjs
pnpm exec vite preview --port 4397 --strictPort
node .tmp/measure-followup.mjs
node .tmp/probe-pomodoro-persist.mjs
node .tmp/probe-readmark-retry.mjs
```

`measure-followup.mjs` は 1440 / 390 の各シナリオで WebP（DPR 2）を
`docs/verification/tools/` に書き出す。既存ファイルがある場合は上書きせず失敗する。

## 6. この記録で未確認のこと

- production（`https://rebuildup.dev`）への反映。すべてローカル preview の実測。
- Playwright E2E スイート（`e2e/**`）の実行。`validate:fast` の対象外。
- 各 Tool の pinned SHA / build artifact の再現性、CI の artifact 検知、
  `tools:artifact:check`、ライセンス境界の再検証。
- prototype の third-party 要求（typekit 等）の件数と成否。
- readmark の PDF 本文表示、EPUB / Markdown 取り込み。
- color-palette のクリップボード内容、複数パレット操作、他 export 形式。
