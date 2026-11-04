この記録は実測値であり owner 承認ではない（AGENTS.md §6 / Issue #741）。

# root 絶対パス 404 の解消 — Tool 側 `base` 修正の実測（Issue #896）

- 測定日: **2026-11-04**
- 対象: Issue #896 が特定した **host root `/assets/*` の 404（readmark 1 件 / prototype 3〜4 件）** と、
  修正後の **15 Tool 全数の回帰測定**
- 測定環境: `pnpm run build` → `node scripts/sync-cf-build-output.mjs` →
  `pnpm exec vite preview --port 4401 --strictPort`（**port 4401**、
  `http://127.0.0.1:4401`）。Chromium はリポジトリ同梱の `@playwright/test` 1.63.0、
  viewport は **1440×900（desktop）** と **390×844（mobile）**、DPR 1。
- 計測スクリプトは `.tmp/measure-896.mjs`、入力サンプルは `.tmp/sample/readmark-sample.pdf` と
  `.tmp/sample/seq-01.png`〜`seq-05.png`（`.tmp/` は git 管理外。リポジトリに含めない）。
- 既存記録は**改変していない**。本書は次の2件の追補である:
  - [`functional-verification-2026-11-04.md`](./functional-verification-2026-11-04.md)
    （**修正前**の15 Tool 実測: PASS 13 / PARTIAL 1 / FAIL 1。readmark = FAIL、
    prototype = PARTIAL の根拠が本書の Before 側と一致する）
  - [`first-party-delivery-followup.md`](./first-party-delivery-followup.md)（2026-11-03、port 4397）

## 1. 採用した方式（Option 1）と、採らなかった2つの方式

`scripts/build-tools.mjs` step 5 のコメントが方針を逐語で示している:
「The Tool-side-fix policy reserves Tool repo edits to the Tool repo (e.g. changing its own
`vite.config.ts#base`). my-web-2026 owns the path that delivers a Tool into
`/tools/<slug>/app/`」。今回の欠陥は **Tool リポジトリが emit する URL の解決基準**
そのものなので、**方式1（Tool 側 `base`）を採用した**。

| 方式 | 判定 | 理由 |
| --- | --- | --- |
| **1. Tool リポジトリの `vite.config.ts` に `base: '/tools/<slug>/app/'` を設定**（本 Issue で採用） | **採用** | 解決基準を Tool 自身のビルドに持たせる。emit される index.html 参照・`?url`・アセット import・preload ヘルパーの `base + chunk` 結合がすべて同時に揃う。`build-tools.mjs` step 5 の `index.html` 書き換えは path namespace の所有権（host）と emit の正しさ（Tool）の分担であり、両者の契約に沿う。pin bump は PR diff として review される。 |
| **2. 収集時に JS チャンク内の root 絶対リテラルも書き換える** | **不採用** | ビルド済み minified チャンクへの文字列置換はヒューリスティックである。`"/assets/x"` が URL なのか、文字列・正規式・コメント・データの一部なのかを判別できず、誤爆すれば Tool の成果物を silent に壊す。成果物は Tool の build 出力と provenance（`tools:artifact:check` / `tools:provenance:check`）が検査するもので、収集時に mutation すると「Tool の pinned SHA から再現できるバイト列」という契約が崩れる。step 5 が `index.html` に限るのは偶然ではなく、この限界の表明である。 |
| **3. 配信境界で `/assets/*` を当該 Tool 名前空間へ解決する** | **不採用** | 全15 Tool がそれぞれ `assets/` を emit するため、host root の `/assets/<file>` には**どの Tool のものかを決める手がかりが無い**（15 名前空間が衝突する）。runtime 構築 URL（worker / wav）も境界側から Tool を特定できず、実装は結局方式2の判定問題に帰着する。 |

この決定は本記録と Issue #896 のコメントに記録する（ADR は書き換えない）。

## 2. Tool リポジトリ側の修正（Option 1 の実装）

### 2.1 readmark — `rebuildup/readmark`

- **commit `67254a9ef7e2bfb71e85d6aebd982dda1c1956f3`**（branch `896`、PR
  [rebuildup/readmark#87](https://github.com/rebuildup/readmark/pull/87)）
  - `vite.config.ts` に `base: '/tools/readmark/app/'` を追加。
    pdf.js の worker は `src/reader/pdf/pdf-worker.ts` の `?url` が解決する URL で、
    修正前は `/assets/pdf.worker.min-iDqQPrd3.mjs`（host root）→ 404 → **PDF import 全失敗**。
  - `pdfjsSupportTables` の dev middleware が設定済み base を除去するようにした
    （`bun run dev` でも `<base>assets/pdfjs/…` が解決されることを維持）。
    unit test は `configResolved` なしでプラグインを組み立てて root 前方一致を検証しており、
    その挙動は不変。
- ローカル検証: `bun run build`（worker リテラルが
  `/tools/readmark/app/assets/pdf.worker.min-*.mjs`、chunks 内の root `/assets/` リテラル **0 件**）、
  `bun run test`（**383 passed**）、`bun run typecheck` / `bun run lint`（exit 0）、
  dev server（base 付き cmap / worker が **200**）、preview（`/` は **302** → base、base 配下 **200**）。

### 2.2 prototype — `rebuildup/ProtoType`

- **commit `4e1359771768724c0993a6ae4c7b83367a3438e6`**（branch `896`、PR
  [rebuildup/ProtoType#6](https://github.com/rebuildup/ProtoType/pull/6)）
  - `vite.config.ts` に `base: '/tools/prototype/app/'` を追加。
    修正前の4件はすべて emit 側が root を基準にしていた:
    `collect.wav` / `miss.wav` は asset import が作る `"/assets/*.wav"` リテラル、
    `browserAll-*` / `webworkerAll-*` は pixi の遅延ロードで、preload ヘルパーが
    `base + chunk` を結合する（built chunk 内は `VC = r => "/" + r`）。
  - Playwright の `webServer.url` 探針を base パスへ（preview は `/` が 302、base 配下が 200）。
- ローカル検証: `pnpm run build`（root `/assets/` リテラル **0 件**、wav と preload base が
  `/tools/prototype/app/…`）、`pnpm run lint`（exit 0）、
  `pnpm run test:e2e`（**4 passed** — spec の root goto は preview のリダイレクトで base に着地）。

### 2.3 host 側の pin bump（commit `e43db10f`）

- `src/tools/manifest.json`: readmark `889595910a` → `67254a9ef7`、
  prototype `335e0e8610` → `4e13597717`。
- `docs/tools/inventory.md`: 2 行の HEAD SHA を追随（`tools:check` rule 12）。
- `external/readmark` / `external/prototype` の gitlink を追従。
- `quality/tool-artifact-inventory.json`: `pnpm run tools:artifact:update` で
  **`pinned_sha` 2 行のみ**差分（LICENSE / lockfile の evidence hash は不変 =
  **依存セットもライセンスも変わっていない**）。
- AGENTS.md §2 への影響: `7f650a43` 以降、`package.json` / `.github/` / `scripts/` /
  `pnpm-workspace.yaml` は**無変更**。**my-web-2026 の script / workflow に Bun は追加していない**
  （`bun` は readmark の Tool リポジトリ内の commit / 既存 workflow のみ。host の
  `oven-sh/setup-bun` step は本変更以前から存在する）。

## 3. 再現手順（実行したコマンド）

```sh
# Before（修正前 build — HEAD7f650a43、旧 pin）
pnpm run build
node scripts/sync-cf-build-output.mjs
pnpm exec vite preview --port 4401 --strictPort     # background
SLUGS=readmark,prototype PHASE=before \
  OUT_DIR=docs/verification/tools/root-absolute-404-2026-11-04 \
  RESULTS=.tmp/fix-896-before.json node .tmp/measure-896.mjs

# After（修正後 build — commit e43db10f、新 pin。15 Tool 全数）
# （同 preview を再起動してから）
PHASE=after \
  OUT_DIR=docs/verification/tools/root-absolute-404-2026-11-04 \
  RESULTS=.tmp/fix-896-after.json node .tmp/measure-896.mjs
```

- port: **4401** / Before build SHA: **`7f650a43`** / After build SHA: **`e43db10f`**
- 各 Tool で主要操作を**実操作**し、console error・失敗リクエスト（path のみ）・
  HTTP 4xx/5xx・host root `/assets/*` の 404 を記録。GA4 同意バンドは「拒否する」で解除、
  `click_to_load` は「読み込みを開始する」で解除。
- prototype は `Game Start` から **menu → ゲーム選択 → モード選択 → 登録 → ゲーム画面 →
  Space 開始 →5キー入力**までを1本のフローとして操作し、各段階を WebP で撮影した。

## 4. Before / After — host root `/assets/*` 404 件数

| Tool | Before (desktop) | Before (mobile) | After (desktop) | After (mobile) |
| --- | --- | --- | --- | --- |
| `readmark` | **1**（`/assets/pdf.worker.min-iDqQPrd3.mjs`） | **1**（同左） | **0** | **0** |
| `prototype` | **4**（`/assets/browserAll-CFss0BaY.js`、`/assets/webworkerAll-DQEawDaD.js`、`/assets/collect-CGVKdOWb.wav`、`/assets/miss-CRIzsoCw.wav`） | **4**（同左） | **0** | **0** |
| 他の13 Tool | 0 | 0 | 0 | 0 |

- Issue #896 が列挙した4 URL（readmark worker + prototype3件）は **Before で全件再現**。
  prototype の `/assets/miss-CRIzsoCw.wav` は測定がキーを入力した結果生じた
  **同一クラスの追加実測**（誤入力時の miss 効果音）で、同じ `base` 修正で解消する。
- Before の該当 Tool は4件 / 1件とも **404 応答**（`404 <path>`）かつリクエスト失敗。
- **After は全30 run（15 Tool ×2 viewport）で root `/assets/*` 404 = 0、
  console error = 0、HTTP 4xx/5xx = 0、pageerror = 0。**
- console の詳細（Before → After）:
  - prototype: `Failed to load resource: …404` + `pageerror: Error: Failed to load audio`（2 件）→ **0 件**
  - readmark: `Failed to load resource: …404`（1 件）→ **0 件**

4件すべての byte 列は Tool 名前空間に実在していた
（例 `/tools/prototype/app/assets/collect-CGVKdOWb.wav`、
`/tools/readmark/app/assets/pdf.worker.min-iDqQPrd3.mjs` — 修正後はそちらが200、
root 側は無要求）。

## 5. prototype のゲーム本編到達性（Game Start → play）

**修正後: 到達可能。ブロッカーは無い。**

- 操作フロー（desktop / mobile 同一）:
  `Game Start` →（Welcome →）ゲーム選択メニュー → `Enter` → モード選択
  （スタンダード） → `Enter` → プレイヤー記録名（空で可） → `Enter` →
  ゲーム画面（「Spaceキーでスタート」） → `Space` → **ラウンド進行中** →5キー入力。
- After の到達証跡: 両 viewport とも **ラウンド進行中**を撮影
  （desktop: Rank/score と出題文「机の奥行きを調整する」+ romaji、
  mobile: score 2 と出題文「背筋を伸ばして骨盤を立てる」+ romaji、
  キーボード表示のハイライト付き）。stage WebP は
  `after-prototype-{menu,modeselect,register,game,play}-{desktop,mobile}.webp`。
- Before もラウンド自体には到達したが、その間 **root404 4 件と audio pageerror が発生**し
  （`collect.wav` / `miss.wav` が読めない = 効果音なし、preload 2 chunk が404）、
  console error 0 件ではなかった。**After は同一フローで console error 0 件、
  音声・遅延 chunk すべて名前空間内から200。**
- 補足（測定器の性質、Tool 欠陥ではない）: ゲームのキー pump は
  `getLatestKey` のワンショットリスナーで、`game_scene` の非同期 setup 完了前に押した
  `Space` は取りこぼす。Before/After とも同一条件になるよう、Space を複数回送ってから
  判定している。

## 6. 修正後の15 Tool 回帰表（同一 run、1440×900 / 390×844）

全30 run が **root404 = 0 / console error = 0 / 主要操作 ok**。viewport 間の差異なし。

| Tool | 主要操作と観測結果（両 viewport 同一） | root404 | console | 判定 |
| --- | --- | --- | --- | --- |
| `prototype` | Game Start → メニュー → モード選択 → 登録 → ゲーム画面 → Space → ラウンド進行 +5キー | 0 | 0 | **PASS** |
| `readmark` | PDF import 成功（「1 ページを取り込みました」+ ライブラリに文書1件） | 0 | 0 | **PASS** |
| `text-counter` | 23 文字入力 → Total 23 / Words 7 / Lines 2 / 45 B | 0 | 0 | **PASS** |
| `color-palette` | Generate → Copy →「コピーしました」 | 0 | 0 | **PASS** |
| `sequential-png-preview` |5枚読み込み `1 / 5` →50%で `3 / 5` | 0 | 0 | **PASS** |
| `svg2tsx` | SVG入力 →「変換完了 (20 行)」→「コピー完了」 | 0 | 0 | **PASS** |
| `business-mail-block` | ブロック DnD → composed に1件、プレースホルダ消失 | 0 | 0 | **PASS** |
| `code-type-p5` | Play → Pause、canvas 描画 | 0 | 0 | **PASS** |
| `fillgen` | 空欄2個（60px /120px）→採点 correct | 0 | 0 | **PASS** |
| `qr-generator` | `https://example.com` → QR 描画 → Download PNG3482 bytes | 0 | 0 | **PASS** |
| `pomodoro` | 開始15:00.00 → 一時停止で2秒固定 → リセット15:00.00 | 0 | 0 | **PASS** |
| `history-quiz` | 空欄入力 →採点 `blank correct` | 0 | 0 | **PASS** |
| `pi-game` | `3` → `.` → `141592653` → 誤入力 →「結果 :10桁」→「3 to Retry」 | 0 | 0 | **PASS** |
| `ae-expression` | Wiggle選択 → 正常表示 →「コピー完了」 | 0 | 0 | **PASS** |
| `mic-level` |「マイクを使用する」→ 許可成立、Meter 表示 | 0 | 0 | **PASS** |

`functional-verification-2026-11-04.md` の修正前判定（PASS13 / PARTIAL1 / FAIL1）に対し、
**修正後は15 Tool すべて PASS**。PARTIAL（prototype）と FAIL（readmark）が解消した。

## 7. 証跡（WebP、quality82、PNG なし）

`docs/verification/tools/root-absolute-404-2026-11-04/` に **54 枚**
（Before14 =対象2 Tool の最終画面4 + prototype stage10、
After40 =15 Tool ×2 viewport の最終画面30 + prototype stage10）。

- Before: `before-{readmark,prototype}-{desktop,mobile}.webp`、
  `before-prototype-{menu,modeselect,register,game,play}-{desktop,mobile}.webp`
- After: `after-<slug>-{desktop,mobile}.webp`（15 Tool 分）、
  `after-prototype-{menu,modeselect,register,game,play}-{desktop,mobile}.webp`

主な対応:

| 証跡 | 内容 |
| --- | --- |
| [`before-readmark-desktop.webp`](./root-absolute-404-2026-11-04/before-readmark-desktop.webp) | import失敗のインライン通知（Before） |
| [`after-readmark-desktop.webp`](./root-absolute-404-2026-11-04/after-readmark-desktop.webp) | import成功・ライブラリに文書1件（After） |
| [`before-prototype-play-desktop.webp`](./root-absolute-404-2026-11-04/before-prototype-play-desktop.webp) / [`after-prototype-play-desktop.webp`](./root-absolute-404-2026-11-04/after-prototype-play-desktop.webp) | ラウンド進行中の desktop |
| [`after-prototype-play-mobile.webp`](./root-absolute-404-2026-11-04/after-prototype-play-mobile.webp) | ラウンド進行中の mobile |

（Before / After とも同じ操作手順・同じ viewport で撮影。）

## 8. 品質ゲート

本記録を含む最終 commit に対して次を実行し、終了コードは PR 本文と最終報告に記録する:

- `pnpm run tools:check`
- `pnpm run tools:artifact:check`
- `pnpm run tools:provenance:check`
- `pnpm run validate:integration`

## 9. この記録で確認していないこと

- production（`https://rebuildup.dev`）での配信。すべてローカル preview の実測。
- **2つの Tool リポジトリの PR（readmark#87 / ProtoType#6）は未 merge。**
  host の pin は**そのブランチ先頭 SHA を指す**。main へは **merge commit で** merge すれば
  SHA は到達可能なままだが、**squash / rebase では SHA が孤立**し次回ビルドが壊れる
  （その場合は pin の再 bump が必要）。この制約は両 PR 本文にも記載した。
- Tool リポジトリの CI（GitHub Actions）の成否。ローカルで検証したコマンドのみを記録した。
- Playwright E2E スイート（host の `e2e/**`）と `validate:fast` / `pnpm run test` の CI 判定。
- prototype の favicon `./src/icon/icon.*`（相対参照）は修正前後とも名前空間外を指すが、
  frame内ではリクエストされない既存の Tool HTML の癖で、本 Issue の対象外。
