この記録は実測値であり owner 承認ではない（AGENTS.md §6 / Issue #741）。

# Tool 主要機能の first-party 実測（Issue #896）— 2026-11-04

- 測定日: **2026-11-04**
- 対象: 現行 pin のままの **15 個すべての `same_origin_static` Tool**
  （`host_disabled` 0 件。列挙は `src/tools/manifest.json` から取得、
  15 件以外は範囲外）
- host: 分岐 `896`、build 時 HEAD **`e1f3c858`**（base `origin/release-0-8-1`）
- 測定環境: `pnpm run build` → `node scripts/sync-cf-build-output.mjs` →
  `pnpm exec vite preview --port 4401 --strictPort`
  （**port 4401**、`http://127.0.0.1:4401`）。Chromium はリポジトリ同梱の
  `@playwright/test` 1.63.0（bundled Chromium）。viewport は
  **1440×900（desktop）** と **390×844（mobile）**、DPR 1。
- 各 Tool で 1 度ずつ、**実操作**（ページ読み込みだけではない）を行い、
  console error / 失敗リクエスト / HTTP 4xx-5xx / host root `/assets/*` の 404 を
  記録した。全ページで GA4 同意バンドの「拒否する」を先に押し、
  `click_to_load` の Tool は「読み込みを開始する」を押下してから frame を測定。
- 計測スクリプトは `.tmp/measure-896.mjs`、入力サンプルは
  `.tmp/sample/readmark-sample.pdf` と `.tmp/sample/seq-01.png`〜`seq-05.png`
  （`.tmp/` は git 管理外。リポジトリに含めない）。
- 本記録は [`first-party-delivery-followup.md`](./first-party-delivery-followup.md)
  （2026-11-03、port 4397）の**追補**であり、既存記録は変更していない。

## 1. 結果サマリ

| 判定 | Tool 数 |
| --- | --- |
| **PASS** | **13** |
| **PARTIAL** | **1**（prototype） |
| **FAIL** | **1**（readmark） |
| 合計 | 15 |

30 実行（15 Tool × 2 viewport）の内訳は PASS 26 / PARTIAL 2 / FAIL 2。
**viewport 間で判定が分かれた Tool は 1 件もない。**

## 2. 15 行の測定表

| Tool | pin SHA | 実行した主要操作 | 観測結果（desktop / mobile 同一、特記以外） | console / 404 サマリ | 判定 |
| --- | --- | --- | --- | --- | --- |
| `prototype` | `335e0e861009049336e581dc266dc4e2f019e5c7` | 同意 → 「読み込みを開始する」→ `Game Start` | popup が開き `Close` と **canvas（1440×1200）が出現**。ただし音声読み込みで pageerror | console error 2 件（404 + `pageerror: Error: Failed to load audio`）。**host root 404: `/assets/browserAll-CFss0BaY.js` `/assets/webworkerAll-DQEawDaD.js` `/assets/collect-CGVKdOWb.wav`** | **PARTIAL** |
| `readmark` | `889595910ae62ebfb3f6b8000d635283196f9b0e` | 「PDF を import」で `.tmp/sample/readmark-sample.pdf` を指定 | 「**取り込みに失敗しました。時間をおいて再度お試しください。**」（両 viewport、再試行も同様）。ライブラリに文書が 1 件も増えない | console error 1 件（404）。**host root 404: `/assets/pdf.worker.min-iDqQPrd3.mjs`** | **FAIL** |
| `text-counter` | `b0c7ba203df7d822a87387d367fd1415d13382e6` | `Hello world\nこんにちは世界。テスト` を入力 | Total **23** / Words **7** / Lines **2** / Byte Size **45 B**（期待値と一致） | なし | **PASS** |
| `color-palette` | `b3fed92bac4a6d32b48be21c35ad8b8239d4d5e5` | `Generate Colors` → 1 色目の `Copy` | 5 色を生成（例 desktop `#dd9969 …`）→ トースト「**コピーしました**」 | なし | **PASS** |
| `sequential-png-preview` | `ddec2729d8b244ebab3370d2eccb95be25e2a43a` | `seq-01.png`〜`seq-05.png` を file input に指定 → `50%` | `1 / 5` フレームで読み込み → `50%` で **`3 / 5`** | なし | **PASS** |
| `svg2tsx` | `6289e2c89a484c3a31bd9b8cba368d6b38c414a0` | 「コード」タブへ SVG を入力 →「TSXコード」→「クリップボードにコピー」 | 「**変換完了 (20 行)**」→「**コピー完了**」 | なし | **PASS** |
| `business-mail-block` | `1495b2e5feae6b4d38e1d985e1066b2913d39391` | 「利用可能なブロック」の先頭ブロックを「メール作成エリア」へ DnD | ドロップ成功: composed にブロック 1 件、プレースホルダ消失（両 viewport） | なし | **PASS** |
| `code-type-p5` | `2e1193111faa837d3653d72410aa0e3c97a176b3` | `Play` | ボタン `Play` → **`Pause`**、p5 canvas に描画（ink 検出） | なし | **PASS** |
| `fillgen` | `962ae889790dfe0e5288c6b1fe61ab9c4f36ae9a` | `# タイトル / ## 見出し / ### セクション / 日本の首都は{{東京}}です。…{{3776\|120}}…` を入力 → 1 空欄に「東京」→「このセクションを採点」 | **空欄 2 個**（幅 60px / 120px）、プレビューに本文出現、採点で class `blank correct` | なし | **PASS** |
| `qr-generator` | `2a7d64308e1286108c42bbe88b8d9f762e7e8fa3` | Content に `https://example.com` → `Download PNG` | QR canvas 描画（ink 検出）→ ダウンロード **3482 bytes**（従来記録と同値） | なし | **PASS** |
| `pomodoro` | `d4add8a1f19b4a4ffb3c77c745f140796120adc7` | 開始 → 停止ダイアログ → 一時停止 → 再開 → リセット | `15:00.00` → `14:59.98` で減少 → 一時停止で **2 秒間 `14:59.33` 固定** → 再開クリックで表示 `14:59.98` へ変化 → リセットで **`15:00.00`** | なし | **PASS** |
| `history-quiz` | `024676693fd3d91401ddcacb1294ea988801c6eb` | 最初の空欄に「大東亜共栄圏」→「このセクションを採点」 | class が `blank correct`（正解判定） | なし | **PASS** |
| `pi-game` | `b234aa0569ade70a885c8ee8941861fccf7a3603` | `3`(開始) → `.` → `1 4 1 5 9 2 6 5 3` → 誤入力 `0` | 入力表示 `3.141592653` → 「**結果 : 10桁**」→「**3 to Retry**」で終了 | なし | **PASS** |
| `ae-expression` | `56bbbbd6174c1baee5b542565466f8154ad633ed` | `Wiggle` を選択 → 「コピー」 | 生成コード `wiggle(…)`、「エクスプレッションは正常です」→「**コピー完了**」 | なし | **PASS** |
| `mic-level` | `9506e4619541d8912346648ced1239607acea199` | 「マイクを使用する」（fake audio device 付与） | 許可経路が通り `マイクを使用できません` が出ず、DevicePicker / Meter がマウント | なし | **PASS** |

### 判定理由（PASS 以外）

- **prototype = PARTIAL** — 主要操作（`Game Start` → popup + canvas）は成功するが、
  host root を指す `/assets/*` 404 が **3 件**残り、`Failed to load audio` の
  pageerror が出る（Issue #896 クラス）。メニューと canvas の先の
  ゲーム進行・音・入力採点は今回の操作範囲では到達していない。
- **readmark = FAIL** — 主要操作（PDF import）が両 viewport で失敗通知に終わり、
  PDF worker の root-absolute 404 が原因と一致する。import が成立しないため
  本文表示・ページ送り・読書状態の復元には到達できない。

## 3. Issue #896 クラスの host root `/assets/*` 404（実測一覧）

`scripts/build-tools.mjs` の step 5 は `index.html` の root-absolute 参照だけを
書き換える。今回の 4 件は **JS チャンクが実行時に解決する URL** であり、
書き換わりの対象外だった。4 件とも **同じバイト列が Tool 名前空間に実在する**。

| Tool | host root で 404 になった URL | 実在する正しい URL |
| --- | --- | --- |
| prototype | `/assets/browserAll-CFss0BaY.js` | `/tools/prototype/app/assets/browserAll-CFss0BaY.js` |
| prototype | `/assets/webworkerAll-DQEawDaD.js` | `/tools/prototype/app/assets/webworkerAll-DQEawDaD.js` |
| prototype | `/assets/collect-CGVKdOWb.wav` | `/tools/prototype/app/assets/collect-CGVKdOWb.wav` |
| readmark | `/assets/pdf.worker.min-iDqQPrd3.mjs` | `/tools/readmark/app/assets/pdf.worker.min-iDqQPrd3.mjs` |

- 404 を出した Tool は上記 2 個だけ。**残り 13 個は host root `/assets/*` を
  一度も要求せず、4xx / 5xx 応答も console error も 0 件**だった。
- readmark の worker URL は index チャンクに
  `"/assets/pdf.worker.min-iDqQPrd3.mjs"` という**リテラル**として入っている。
  prototype の 3 件はランタイム解決（`import()` / `new URL(…)` 系）。
- 前回記録（#825 追補、2026-11-03）で同じ 4 件が観測されており、
  **現行 pin でも未修正**である。

## 4. Issue #354 / #355 / #358 の受け入れ語彙に対する測定値

3 Issue は「配信は有効だがユーザー操作は未検証」という記録のまま残っている。
本測定がその操作面の **acceptance evidence** になる（**Issue の close は
行っていない**。close には owner 確認と AGENTS.md §6 / Issue #741 の手順が要る）。
引用は本ファイルのパスと WebP 証跡で示せる。

### #354 pi-game — 桁の入力 / 採点 / 終了

- **入力**: `3`（開始）→ `.` → `1 4 1 5 9 2 6 5 3` → 誤入力 `0`。
  表示は `3.141592653`。
- **採点**: 「**結果 : 10桁**」（入力済み 9 桁 + 現在位置の計上）。
  `0桁` ではない。
- **終了**: 「**3 to Retry**」が表示されラウンドが終わる。
- viewport: 1440×900 / 390×844 の**両方**で同じ結果。
- 証跡: [`pi-game-desktop.webp`](./2026-11-04/pi-game-desktop.webp) /
  [`pi-game-mobile.webp`](./2026-11-04/pi-game-mobile.webp)

### #355 qr-generator — 文字入力 → QR 描画 → ダウンロード

- **入力**: Content 欄に `https://example.com`。
- **描画**: QR canvas が bitmap として描画（単色まばらでない = ink 検出）。
- **ダウンロード**: `Download PNG` でダウンロードイベント成立、**3482 bytes**
  （[`first-party-delivery-followup.md`](./first-party-delivery-followup.md) の
  magic bytes 検証時と同じサイズ）。
- viewport: 1440×900 / 390×844 の**両方**で同じ結果。
- 証跡: [`qr-generator-desktop.webp`](./2026-11-04/qr-generator-desktop.webp) /
  [`qr-generator-mobile.webp`](./2026-11-04/qr-generator-mobile.webp)

### #358 pomodoro — 開始 / 停止 / リセット

- **開始**: `15:00.00` → クリック → `14:59.98` と減少（計測中も減少を確認）。
- **停止**: もう一度クリックで「タイマーを停止しますか？」ダイアログ →
  「一時停止」→ **2 秒間 `14:59.33` が動かない**（desktop。mobile は
  `14:59.16` で同様に固定）。再開クリックで表示が `14:59.98` に変化し
  タイマーが再開する。
- **リセット**: ダイアログの「リセット」→ **`15:00.00`** に復帰。
- viewport: 1440×900 / 390×844 の**両方**で同じ結果。
- 証跡: [`pomodoro-desktop.webp`](./2026-11-04/pomodoro-desktop.webp) /
  [`pomodoro-mobile.webp`](./2026-11-04/pomodoro-mobile.webp)

## 5. 証跡（WebP、quality 82、PNG なし）

`docs/verification/tools/2026-11-04/<slug>-desktop.webp` /
`<slug>-mobile.webp` の **30 枚**。撮影は主要操作の**後**の frame クリップ。

- [`2026-11-04/prototype-desktop.webp`](./2026-11-04/prototype-desktop.webp) / [mobile](./2026-11-04/prototype-mobile.webp)
- [`2026-11-04/readmark-desktop.webp`](./2026-11-04/readmark-desktop.webp) / [mobile](./2026-11-04/readmark-mobile.webp)
- [`2026-11-04/text-counter-desktop.webp`](./2026-11-04/text-counter-desktop.webp) / [mobile](./2026-11-04/text-counter-mobile.webp)
- [`2026-11-04/color-palette-desktop.webp`](./2026-11-04/color-palette-desktop.webp) / [mobile](./2026-11-04/color-palette-mobile.webp)
- [`2026-11-04/sequential-png-preview-desktop.webp`](./2026-11-04/sequential-png-preview-desktop.webp) / [mobile](./2026-11-04/sequential-png-preview-mobile.webp)
- [`2026-11-04/svg2tsx-desktop.webp`](./2026-11-04/svg2tsx-desktop.webp) / [mobile](./2026-11-04/svg2tsx-mobile.webp)
- [`2026-11-04/business-mail-block-desktop.webp`](./2026-11-04/business-mail-block-desktop.webp) / [mobile](./2026-11-04/business-mail-block-mobile.webp)
- [`2026-11-04/code-type-p5-desktop.webp`](./2026-11-04/code-type-p5-desktop.webp) / [mobile](./2026-11-04/code-type-p5-mobile.webp)
- [`2026-11-04/fillgen-desktop.webp`](./2026-11-04/fillgen-desktop.webp) / [mobile](./2026-11-04/fillgen-mobile.webp)
- [`2026-11-04/qr-generator-desktop.webp`](./2026-11-04/qr-generator-desktop.webp) / [mobile](./2026-11-04/qr-generator-mobile.webp)
- [`2026-11-04/pomodoro-desktop.webp`](./2026-11-04/pomodoro-desktop.webp) / [mobile](./2026-11-04/pomodoro-mobile.webp)
- [`2026-11-04/history-quiz-desktop.webp`](./2026-11-04/history-quiz-desktop.webp) / [mobile](./2026-11-04/history-quiz-mobile.webp)
- [`2026-11-04/pi-game-desktop.webp`](./2026-11-04/pi-game-desktop.webp) / [mobile](./2026-11-04/pi-game-mobile.webp)
- [`2026-11-04/ae-expression-desktop.webp`](./2026-11-04/ae-expression-desktop.webp) / [mobile](./2026-11-04/ae-expression-mobile.webp)
- [`2026-11-04/mic-level-desktop.webp`](./2026-11-04/mic-level-desktop.webp) / [mobile](./2026-11-04/mic-level-mobile.webp)

## 6. 再現手順（実行したコマンド）

```sh
pnpm run build
node scripts/sync-cf-build-output.mjs
pnpm exec vite preview --port 4401 --strictPort   # background
node .tmp/measure-896.mjs                          # 15 tools × 2 viewports
# 計測器の不備を直した対象だけを再実行した際は:
SLUGS=<slug>,<slug> node .tmp/measure-896.mjs      # 既存 JSON にマージ
```

- port: **4401** / build 時 HEAD: **`e1f3c858`**
- 画面遷移: `/tools/<slug>` → 同意拒否 →（必要な Tool は）読み込み開始 →
  iframe 内で操作
- 30 実行の生ログは `.tmp/measure-896-results.json`（git 管理外）

### 計測器側で確定した操作上の注意（Tool 本体の欠陥ではない）

- `business-mail-block` の DnD は `locator.dragTo` では drop せず、
  **段階的なマウス移動**（handle 中央 → zone 内の可視点、frame 座標は
  iframe オフセットで補正、390px では frame 文書を先にスクロール）で初めて
  成功した。keyboard drag（Space / 矢印 / Space）は desktop のみ成功、
  mobile では矢印移動が起きなかった。
- `code-type-p5` の mobile は、同意クリック後のホスト側スクロールで frame 上端が
  viewport 外に出た状態では `Play` がクリック不能だった。**操作前に frame を
  viewport へ揃える**と成功（本測定は全 Tool で揃えてから操作している）。
- `svg2tsx` の textarea は「コード」タブを張った後にのみ存在する。
- `fillgen` は `{{…}}` を含む段落が `### セクション`配下にあるときのみ空欄を
  生成する（parser の仕様。ヘッダなしの1 行だけでは空欄0 個）。

## 7. この記録で確認していないこと

- production（`https://rebuildup.dev`）での配信。すべてローカル preview の実測。
- Playwright E2E スイート（`e2e/**`）、`validate:fast` / `pnpm run test`
  （本タスクでは実行していない。CI が判定する）。
- 各 Tool の pinned SHA で再現可能な standalone 出力、CI の artifact 検知、
  `tools:artifact:check`、license / dependency の verified。
- prototype のゲーム本編（入力・採点・ランキング）、readmark の EPUB /
  Markdown 取り込み、mic-level の実機マイク（fake device のみ）。
- 修正判断。**fix は本 Issue の測定結果を受けて別途決定される**
  （本記録は数値の提示のみ）。
