# #887 確定デザインシステムの全公開ルート適用記録（stage 5 検証）

Issue: [#887](https://github.com/rebuildup/my-web-2026/issues/887)
base: `origin/release-0-8-1` @ **`7f650a43`**（887 の実装 PR #888 はマージ済み — merge commit `1fe278ee`。その先に #884 / #889 / #896 も着地した tip を使う）
branch: `887-verify` / 記録日: 2026-11-04
取得: **89 ルート × 390/1280 × light/dark = 356 capture**、すべて WebP（quality 82）、`docs/verification/design/887/` 配下。

> **SHA について（混在なし）**: マージ前の 887 tip（`3dc7ea67`）で撮った初回 run は本記録から**破棄**した。
> 本ドキュメントがリンクする WebP はすべて `7f650a43` の build から再取得したものである。
> `/design-system` の 4 capture は **stage-4 の着地後**（`a3a5dc48` — 3 つの暫定 status エイリアス削除を含む）に撮影されており、
> その前後で StatusAccents の構成・文章が異なることを本記録は直接検証している（§5 F1）。

---

## 1. 何を配信したか（data source）

| 項目 | 内容 |
| --- | --- |
| build | `pnpm run build`（`7f650a43` の worktree。`dist/` の手動編集なし） |
| server | `node scripts/e2e-local-bootstrap.mjs --port=17088` = ローカル D1 へマイグレーション + `scripts/seed-portfolio.mjs`（INSERT OR IGNORE）→ `pnpm preview`（vite preview が workerd で `dist` を配信） |
| port | **17088**。17052 は既に `wt` の dev server が使用中のため不使用 |
| なぜこの経路か | これが本リポジトリの local production path である（`e2e/a11y/axe-public-routes.spec.ts` の axe gate も同じ preview を使う。`scripts/run-prod-smoke-local.mjs` も preview を local production rehearsal と規定し build を先行させる）。`wrangler dev` ではなく preview を選んだ理由: step 1 の build 成果物そのものを配信し、source-bundle ではない production artifact を撮るため |
| D1 | `.tmp/d1state`（local）。`portfolio_project` 69 行のうち **public + published = 66 件**が capture 対象。残り 3 行は公開状態でないため対象外（identifier は本記録に書かない） |
| R2 | **local に存在する**（`.tmp/d1state/v3/r2/`、object 116 件、local D1 の `portfolio_media` 130 key すべてに在る）。ただし preview が配る HTML の media URL は production を指すため、ブラウザは local R2 を叩かない（§6） |
| tools | `src/tools/manifest.json` の 15 slug。preview 画像は build に同梱（`build-tools` 成果物） |

ローカル D1 は e2e と同じ state を使うため、capture は「e2e gate が見ているのと同じローカルデータ」で撮っている。production URL への代替は一切していない。

## 2. 測り方（method）

- **chromatic share**: 各ピクセルについて `chroma = max(R,G,B) − min(R,G,B)`（RGB 各 0–255）。`chroma > 12` を chromatic とし、`chromatic share = chromatic pixels ÷ total pixels`。
- 測定対象は**配信済み WebP（quality 82）そのもの**。canvas でデコードして全ピクセルを走査する（画面の見え =配信物の実測）。
- **長文書の分割**: WebP 形式は 1辺 16383px 上限のため、`scrollHeight > 16000px` の文書は `fullPage + clip` で 16000px タイルに分割して保存し、タイルを結合して集計する（該当: `/portfolio` と `/design-system` の全 capture。ファイル名の `--partN`）。
- **palette 距離**: 分類 palette 20 値（`design` / `code` / `writing` / `tool` × 50,300,500,600,700）への最短 RGB ユクリッド距離で 3 段階に分ける — `≤24` = palette 近傍、`25–80` = palette 色と地の blend / fringe、`>80` = other（palette に属さない色）。
- **hue 桶**: HSL hue を 12 × 30° に分箱（分類 hue: design ≈ 320–360°、code ≈ 165–215°、writing ≈ 35–70°）。
- **DOM census**: 各ルートで全要素の computed `background-color` / `color` を走査し chroma > 12 の値を集計、`[data-state-mark]` の数と kind を記録（ピクセル測定の「どこに色があるか」の裏取り）。
- **content**: `document.title`、`main > section` 数と `main section` 数、`document.body.innerText` 文字数、failure markers（`data-error-fallback="ssr-render"` / React の `<!--$!-->` boundary / `data-error-state=` / `not_found` / 空状態文言「ポートフォリオ準備中」）を `page.content()` から検査。
- **overflow**: 390px で `document.documentElement.scrollWidth > clientWidth`。
- **画像の取り扱い**: capture 前に全 `<img>` を `loading="eager"` 化し、読み込み完了後に **`img.decode()` を明示呼び出し**する。decode を挟まないと Chromium の fullPage screenshot はオフスクリーン画像を未デコードのまま描き、空欄になる（実測: 同一手順で 3 回中 1 回しか描画されない → decode 追加後は 3/3 描画。全 356 capture にこの手順を適用）。
- viewport height 900、`reducedMotion: reduce`、Chromium のみ（リポジトリの CI も Chromium のみ）。

## 3. マトリクス（roster）

- ルートテンプレート実体 8 + `/tools/$slug` 15 + `/portfolio/$slug` 66 = **89 ルート**、各 4 capture = **356**。
- tool slug（`src/tools/manifest.json` 15 件）: `prototype`, `readmark`, `text-counter`, `color-palette`, `sequential-png-preview`, `svg2tsx`, `business-mail-block`, `code-type-p5`, `fillgen`, `qr-generator`, `pomodoro`, `history-quiz`, `pi-game`, `ae-expression`, `mic-level`。
- portfolio slug 66 件: capture 時に配信された `/portfolio` のリンクから discovery し、seed 6 件（`my-web-2026`, `aulymo`, `multi-slicer`, `tastile`, `project-init`, `sciencearts-optim-internship-2026`）を含むことを照合。D1 の public+published 66 件と一致。
- `/admin*` は対象外（route-coverage 上も public surface ではない）。

## 4. 結果

要約（詳細は表）:

- **356/356 が HTTP 200**。`data-error-fallback` / React boundary / `data-error-state` / not_found / 空状態文言を含む capture は **0 件**（全 capture で failure markers すべて false）。
- **390px の horizontal overflow: 0 件**（全 178 件の 390 capture で `scrollWidth > clientWidth` は false）。
- すべての文書が non-empty（最小 body text 260 字、最大 15,204 字）。
- `/design-system` の DOM で chromatic な computed background / text color を持つ要素は**分類 palette 値のみ**（background 12 値すべて `design/code/writing` の ramp 値、text 4 値すべて `accent.category.*`）。他 88 ルートの chromatic DOM 色は **0 件**。

### 4.1 ルートテンプレート実体（capture ごと）

| ルート | capture | chroma share | chromatic px | 上位 chromatic hex | main 内 sections (top/all) | title | 390 overflow | img loaded/total | failure markers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | [390/light](887/index--390-light.webp) | 0.00194 | 5007 | #ffd527 (5.5%), #ffd529 (2.6%) | 4/4 | my-web-2026 — rebuildup.dev | false | 1/1 (fail 0) | なし |
| `/` | [390/dark](887/index--390-dark.webp) | 0.001848 | 4770 | #ffd527 (6.9%), #ffd728 (2.2%) | 4/4 | my-web-2026 — rebuildup.dev | false | 1/1 (fail 0) | なし |
| `/` | [1280/light](887/index--1280-light.webp) | 0.001617 | 8781 | #ffd527 (24.3%), #ffd728 (4.3%) | 4/4 | my-web-2026 — rebuildup.dev | — | 1/1 (fail 0) | なし |
| `/` | [1280/dark](887/index--1280-dark.webp) | 0.001537 | 8344 | #ffd527 (24.4%), #ffd728 (6.4%) | 4/4 | my-web-2026 — rebuildup.dev | — | 1/1 (fail 0) | なし |
| `/about` | [390/light](887/about--390-light.webp) | 0.00064 | 1559 | #f0ede2 (0.3%), #fbd864 (0.3%) | 5/5 | 木村友亮 / Yusuke Kimura — About | false | 1/1 (fail 0) | なし |
| `/about` | [390/dark](887/about--390-dark.webp) | 0.000609 | 1483 | #100c00 (0.4%), #fecc3d (0.3%) | 5/5 | 木村友亮 / Yusuke Kimura — About | false | 1/1 (fail 0) | なし |
| `/about` | [1280/light](887/about--1280-light.webp) | 0.000288 | 1596 | #f0ede2 (0.5%), #f3edd6 (0.5%) | 5/5 | 木村友亮 / Yusuke Kimura — About | — | 1/1 (fail 0) | なし |
| `/about` | [1280/dark](887/about--1280-dark.webp) | 0.000271 | 1501 | #110a00 (0.6%), #0f0b00 (0.4%) | 5/5 | 木村友亮 / Yusuke Kimura — About | — | 1/1 (fail 0) | なし |
| `/keyboard` | [390/light](887/keyboard--390-light.webp) | 0.000044 | 105 | #e0e2d5 (96.2%), #656371 (1.9%) | 1/9 | キーボード配列 — 大西配列と Kanata | false | 0/0 (fail 0) | なし |
| `/keyboard` | [390/dark](887/keyboard--390-dark.webp) | 0 | 0 | — | 1/9 | キーボード配列 — 大西配列と Kanata | false | 0/0 (fail 0) | なし |
| `/keyboard` | [1280/light](887/keyboard--1280-light.webp) | 0.000013 | 79 | #e0e2d5 (98.7%), #d9dbce (1.3%) | 1/9 | キーボード配列 — 大西配列と Kanata | — | 0/0 (fail 0) | なし |
| `/keyboard` | [1280/dark](887/keyboard--1280-dark.webp) | 0 | 0 | — | 1/9 | キーボード配列 — 大西配列と Kanata | — | 0/0 (fail 0) | なし |
| `/contact` | [390/light](887/contact--390-light.webp) | 0 | 0 | — | 1/1 | Contact — rebuildup.dev | false | 0/0 (fail 0) | なし |
| `/contact` | [390/dark](887/contact--390-dark.webp) | 0 | 0 | — | 1/1 | Contact — rebuildup.dev | false | 0/0 (fail 0) | なし |
| `/contact` | [1280/light](887/contact--1280-light.webp) | 0 | 0 | — | 1/1 | Contact — rebuildup.dev | — | 0/0 (fail 0) | なし |
| `/contact` | [1280/dark](887/contact--1280-dark.webp) | 0 | 0 | — | 1/1 | Contact — rebuildup.dev | — | 0/0 (fail 0) | なし |
| `/projects/dotfiles` | [390/light](887/projects-dotfiles--390-light.webp) | 0.000022 | 60 | #e0e2d5 (100.0%) | 10/10 | dotfiles — rebuildup.dev | false | 0/0 (fail 0) | なし |
| `/projects/dotfiles` | [390/dark](887/projects-dotfiles--390-dark.webp) | 0 | 0 | — | 10/10 | dotfiles — rebuildup.dev | false | 0/0 (fail 0) | なし |
| `/projects/dotfiles` | [1280/light](887/projects-dotfiles--1280-light.webp) | 0 | 0 | — | 10/10 | dotfiles — rebuildup.dev | — | 0/0 (fail 0) | なし |
| `/projects/dotfiles` | [1280/dark](887/projects-dotfiles--1280-dark.webp) | 0 | 0 | — | 10/10 | dotfiles — rebuildup.dev | — | 0/0 (fail 0) | なし |
| `/portfolio` | [390/light p1](887/portfolio--390-light--part1.webp) [390/light p2](887/portfolio--390-light--part2.webp) | 0.00003 | 290 | #e0e2d5 (99.7%), #e1e3d5 (0.3%) | 2/2 | Portfolio — rebuildup.dev | false | 0/21 (fail 21) | なし |
| `/portfolio` | [390/dark p1](887/portfolio--390-dark--part1.webp) [390/dark p2](887/portfolio--390-dark--part2.webp) | 0.000034 | 328 | #0e010a (0.9%), #eff2fc (0.6%) | 2/2 | Portfolio — rebuildup.dev | false | 0/23 (fail 23) | なし |
| `/portfolio` | [1280/light p1](887/portfolio--1280-light--part1.webp) [1280/light p2](887/portfolio--1280-light--part2.webp) | 0.000036 | 755 | #e0e2d5 (34.2%), #d6e4ef (0.5%) | 2/2 | Portfolio — rebuildup.dev | — | 0/22 (fail 22) | なし |
| `/portfolio` | [1280/dark p1](887/portfolio--1280-dark--part1.webp) [1280/dark p2](887/portfolio--1280-dark--part2.webp) | 0.00003 | 642 | #c4d5ed (0.5%), #ccd7f6 (0.5%) | 2/2 | Portfolio — rebuildup.dev | — | 0/23 (fail 23) | なし |
| `/tools` | [390/light](887/tools--390-light.webp) | 0.01616 | 46983 | #190404 (3.5%), #180303 (2.9%) | 0/0 | Tools — my-web-2026 | false | 15/15 (fail 0) | なし |
| `/tools` | [390/dark](887/tools--390-dark.webp) | 0.015891 | 46201 | #190404 (3.4%), #180303 (3.0%) | 0/0 | Tools — my-web-2026 | false | 15/15 (fail 0) | なし |
| `/tools` | [1280/light](887/tools--1280-light.webp) | 0.013095 | 79735 | #190404 (3.8%), #180303 (3.0%) | 0/0 | Tools — my-web-2026 | — | 15/15 (fail 0) | なし |
| `/tools` | [1280/dark](887/tools--1280-dark.webp) | 0.012955 | 78880 | #190404 (3.6%), #180303 (3.0%) | 0/0 | Tools — my-web-2026 | — | 15/15 (fail 0) | なし |
| `/design-system` | [390/light p1](887/design-system--390-light--part1.webp) [390/light p2](887/design-system--390-light--part2.webp) | 0.048874 | 506125 | #07b6d3 (14.8%), #e9b308 (14.6%) | 9/39 | Design System — rebuildup.dev | false | 3/3 (fail 0) | なし |
| `/design-system` | [390/dark p1](887/design-system--390-dark--part1.webp) [390/dark p2](887/design-system--390-dark--part2.webp) | 0.048843 | 505797 | #07b6d3 (15.1%), #e9b308 (14.5%) | 9/39 | Design System — rebuildup.dev | false | 3/3 (fail 0) | なし |
| `/design-system` | [1280/light p1](887/design-system--1280-light--part1.webp) [1280/light p2](887/design-system--1280-light--part2.webp) | 0.025504 | 615519 | #241a2e (32.4%), #e9b308 (10.9%) | 9/39 | Design System — rebuildup.dev | — | 3/3 (fail 0) | なし |
| `/design-system` | [1280/dark p1](887/design-system--1280-dark--part1.webp) [1280/dark p2](887/design-system--1280-dark--part2.webp) | 0.025672 | 619576 | #241a2e (33.8%), #e9b308 (11.0%) | 9/39 | Design System — rebuildup.dev | — | 3/3 (fail 0) | なし |

### 4.2 `/tools/$slug`（15 ルート × 4 capture の chroma share）

各セルはその capture の WebP へのリンクと chroma share。

| ルート | 390 light | 390 dark | 1280 light | 1280 dark | sections | title | img |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/tools/prototype` | [0](887/tools-prototype--390-light.webp) | [0](887/tools-prototype--390-dark.webp) | [0](887/tools-prototype--1280-light.webp) | [0](887/tools-prototype--1280-dark.webp) | 0/0 | ProtoType — my-web-2026 Tools | 0/0 (fail 0) |
| `/tools/readmark` | [0](887/tools-readmark--390-light.webp) | [0](887/tools-readmark--390-dark.webp) | [0](887/tools-readmark--1280-light.webp) | [0](887/tools-readmark--1280-dark.webp) | 0/0 | readmark — my-web-2026 Tools | 0/0 (fail 0) |
| `/tools/text-counter` | [0](887/tools-text-counter--390-light.webp) | [0](887/tools-text-counter--390-dark.webp) | [0](887/tools-text-counter--1280-light.webp) | [0](887/tools-text-counter--1280-dark.webp) | 0/0 | Text Counter — my-web-2026 Tools | 0/0 (fail 0) |
| `/tools/color-palette` | [0](887/tools-color-palette--390-light.webp) | [0](887/tools-color-palette--390-dark.webp) | [0](887/tools-color-palette--1280-light.webp) | [0](887/tools-color-palette--1280-dark.webp) | 0/0 | Color Palette — my-web-2026 Tools | 0/0 (fail 0) |
| `/tools/sequential-png-preview` | [0](887/tools-sequential-png-preview--390-light.webp) | [0](887/tools-sequential-png-preview--390-dark.webp) | [0](887/tools-sequential-png-preview--1280-light.webp) | [0](887/tools-sequential-png-preview--1280-dark.webp) | 0/0 | Sequential PNG Preview — my-web-2026 Too | 0/0 (fail 0) |
| `/tools/svg2tsx` | [0](887/tools-svg2tsx--390-light.webp) | [0](887/tools-svg2tsx--390-dark.webp) | [0](887/tools-svg2tsx--1280-light.webp) | [0](887/tools-svg2tsx--1280-dark.webp) | 0/0 | SVG to TSX — my-web-2026 Tools | 0/0 (fail 0) |
| `/tools/business-mail-block` | [0](887/tools-business-mail-block--390-light.webp) | [0](887/tools-business-mail-block--390-dark.webp) | [0](887/tools-business-mail-block--1280-light.webp) | [0](887/tools-business-mail-block--1280-dark.webp) | 0/0 | Business Mail Block — my-web-2026 Tools | 0/0 (fail 0) |
| `/tools/code-type-p5` | [0](887/tools-code-type-p5--390-light.webp) | [0](887/tools-code-type-p5--390-dark.webp) | [0](887/tools-code-type-p5--1280-light.webp) | [0](887/tools-code-type-p5--1280-dark.webp) | 0/0 | Code Type p5 — my-web-2026 Tools | 0/0 (fail 0) |
| `/tools/fillgen` | [0](887/tools-fillgen--390-light.webp) | [0](887/tools-fillgen--390-dark.webp) | [0](887/tools-fillgen--1280-light.webp) | [0](887/tools-fillgen--1280-dark.webp) | 0/0 | Fillgen — my-web-2026 Tools | 0/0 (fail 0) |
| `/tools/qr-generator` | [0](887/tools-qr-generator--390-light.webp) | [0](887/tools-qr-generator--390-dark.webp) | [0](887/tools-qr-generator--1280-light.webp) | [0](887/tools-qr-generator--1280-dark.webp) | 0/0 | QR Generator — my-web-2026 Tools | 0/0 (fail 0) |
| `/tools/pomodoro` | [0](887/tools-pomodoro--390-light.webp) | [0](887/tools-pomodoro--390-dark.webp) | [0](887/tools-pomodoro--1280-light.webp) | [0](887/tools-pomodoro--1280-dark.webp) | 0/0 | Pomodoro — my-web-2026 Tools | 0/0 (fail 0) |
| `/tools/history-quiz` | [0](887/tools-history-quiz--390-light.webp) | [0](887/tools-history-quiz--390-dark.webp) | [0](887/tools-history-quiz--1280-light.webp) | [0](887/tools-history-quiz--1280-dark.webp) | 0/0 | History Quiz — my-web-2026 Tools | 0/0 (fail 0) |
| `/tools/pi-game` | [0](887/tools-pi-game--390-light.webp) | [0](887/tools-pi-game--390-dark.webp) | [0](887/tools-pi-game--1280-light.webp) | [0](887/tools-pi-game--1280-dark.webp) | 0/0 | Pi Game — my-web-2026 Tools | 0/0 (fail 0) |
| `/tools/ae-expression` | [0](887/tools-ae-expression--390-light.webp) | [0](887/tools-ae-expression--390-dark.webp) | [0](887/tools-ae-expression--1280-light.webp) | [0](887/tools-ae-expression--1280-dark.webp) | 0/0 | AE Expression — my-web-2026 Tools | 0/0 (fail 0) |
| `/tools/mic-level` | [0](887/tools-mic-level--390-light.webp) | [0](887/tools-mic-level--390-dark.webp) | [0](887/tools-mic-level--1280-light.webp) | [0](887/tools-mic-level--1280-dark.webp) | 0/0 | Mic Level — my-web-2026 Tools | 0/0 (fail 0) |

### 4.3 `/portfolio/$slug`（66 ルート × 4 capture の chroma share）

| ルート | 390 light | 390 dark | 1280 light | 1280 dark | sections | title | img (L/F) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `aulymo` | [0](887/portfolio-aulymo--390-light.webp) | [0](887/portfolio-aulymo--390-dark.webp) | [0](887/portfolio-aulymo--1280-light.webp) | [0](887/portfolio-aulymo--1280-dark.webp) | 0/0 | Aulymo — After Effects lyric motion tool — | 0/0 (fail 0) |
| `multi-slicer` | [0](887/portfolio-multi-slicer--390-light.webp) | [0](887/portfolio-multi-slicer--390-dark.webp) | [0](887/portfolio-multi-slicer--1280-light.webp) | [0.000001](887/portfolio-multi-slicer--1280-dark.webp) | 0/0 | MultiSlicer — After Effects effect plugin  | 0/0 (fail 0) |
| `project-init` | [0](887/portfolio-project-init--390-light.webp) | [0](887/portfolio-project-init--390-dark.webp) | [0](887/portfolio-project-init--1280-light.webp) | [0](887/portfolio-project-init--1280-dark.webp) | 0/0 | project-init / design-skills — agent engin | 0/0 (fail 0) |
| `sciencearts-optim-internship-2026` | [0](887/portfolio-sciencearts-optim-internship-2026--390-light.webp) | [0](887/portfolio-sciencearts-optim-internship-2026--390-dark.webp) | [0](887/portfolio-sciencearts-optim-internship-2026--1280-light.webp) | [0.000001](887/portfolio-sciencearts-optim-internship-2026--1280-dark.webp) | 0/0 | 2026 Summer internship — ScienceArts / OPT | 0/0 (fail 0) |
| `tastile` | [0](887/portfolio-tastile--390-light.webp) | [0](887/portfolio-tastile--390-dark.webp) | [0](887/portfolio-tastile--1280-light.webp) | [0](887/portfolio-tastile--1280-dark.webp) | 0/0 | Tastile — scheduling product (multi-client | 0/0 (fail 0) |
| `my-web-2026` | [0](887/portfolio-my-web-2026--390-light.webp) | [0](887/portfolio-my-web-2026--390-dark.webp) | [0.000001](887/portfolio-my-web-2026--1280-light.webp) | [0](887/portfolio-my-web-2026--1280-dark.webp) | 0/0 | my-web-2026 — Personal Web Platform on Clo | 0/0 (fail 0) |
| `icon-tegaki-anime` | [0.000271](887/portfolio-icon-tegaki-anime--390-light.webp) | [0.000271](887/portfolio-icon-tegaki-anime--390-dark.webp) | [0.000092](887/portfolio-icon-tegaki-anime--1280-light.webp) | [0.000081](887/portfolio-icon-tegaki-anime--1280-dark.webp) | 0/0 | アイコン 手書きアニメーション — Portfolio | 0/1 (fail 1) |
| `my-sns-icon` | [0.000345](887/portfolio-my-sns-icon--390-light.webp) | [0.000311](887/portfolio-my-sns-icon--390-dark.webp) | [0.000118](887/portfolio-my-sns-icon--1280-light.webp) | [0.000101](887/portfolio-my-sns-icon--1280-dark.webp) | 0/0 | SNSアイコン — Portfolio | 0/1 (fail 1) |
| `foldlayers` | [0](887/portfolio-foldlayers--390-light.webp) | [0](887/portfolio-foldlayers--390-dark.webp) | [0](887/portfolio-foldlayers--1280-light.webp) | [0](887/portfolio-foldlayers--1280-dark.webp) | 0/1 | Aeプラグイン FoldLayers — Portfolio | 0/0 (fail 0) |
| `rgbdelay` | [0](887/portfolio-rgbdelay--390-light.webp) | [0](887/portfolio-rgbdelay--390-dark.webp) | [0](887/portfolio-rgbdelay--1280-light.webp) | [0](887/portfolio-rgbdelay--1280-dark.webp) | 0/1 | Aeエフェクトプラグイン RGBDelay — Portfolio | 0/0 (fail 0) |
| `baramoji` | [0.00002](887/portfolio-baramoji--390-light.webp) | [0](887/portfolio-baramoji--390-dark.webp) | [0](887/portfolio-baramoji--1280-light.webp) | [0.000001](887/portfolio-baramoji--1280-dark.webp) | 0/1 | Ae書式維持文字分解スクリプトBaraMoji — Portfolio | 0/0 (fail 0) |
| `seishun` | [0](887/portfolio-seishun--390-light.webp) | [0](887/portfolio-seishun--390-dark.webp) | [0.000102](887/portfolio-seishun--1280-light.webp) | [0.000095](887/portfolio-seishun--1280-dark.webp) | 0/0 | 青春コンプレックス / darupoi様 — Portfolio | 0/1 (fail 1) |
| `reel-2025` | [0](887/portfolio-reel-2025--390-light.webp) | [0](887/portfolio-reel-2025--390-dark.webp) | [0.000007](887/portfolio-reel-2025--1280-light.webp) | [0](887/portfolio-reel-2025--1280-dark.webp) | 0/0 | REEL 2025 — Portfolio | 0/0 (fail 0) |
| `m5-clock` | [0.000229](887/portfolio-m5-clock--390-light.webp) | [0.000225](887/portfolio-m5-clock--390-dark.webp) | [0.000088](887/portfolio-m5-clock--1280-light.webp) | [0.00008](887/portfolio-m5-clock--1280-dark.webp) | 0/1 | M5_Clock — Portfolio | 0/1 (fail 1) |
| `pomodoroom` | [0.000331](887/portfolio-pomodoroom--390-light.webp) | [0.000313](887/portfolio-pomodoroom--390-dark.webp) | [0.000112](887/portfolio-pomodoroom--1280-light.webp) | [0.000102](887/portfolio-pomodoroom--1280-dark.webp) | 0/0 | pomodoroom — Portfolio | 0/1 (fail 1) |
| `my-web-2025` | [0.000333](887/portfolio-my-web-2025--390-light.webp) | [0.000297](887/portfolio-my-web-2025--390-dark.webp) | [0.000111](887/portfolio-my-web-2025--1280-light.webp) | [0.000101](887/portfolio-my-web-2025--1280-dark.webp) | 0/0 | my-web-2025 — Portfolio | 0/1 (fail 1) |
| `kosen-fes2025-ending` | [0.000264](887/portfolio-kosen-fes2025-ending--390-light.webp) | [0.000269](887/portfolio-kosen-fes2025-ending--390-dark.webp) | [0.000088](887/portfolio-kosen-fes2025-ending--1280-light.webp) | [0.000085](887/portfolio-kosen-fes2025-ending--1280-dark.webp) | 0/0 | 宇部高専祭2025 エンディング — Portfolio | 0/1 (fail 1) |
| `nulloto` | [0](887/portfolio-nulloto--390-light.webp) | [0](887/portfolio-nulloto--390-dark.webp) | [0.000091](887/portfolio-nulloto--1280-light.webp) | [0.000079](887/portfolio-nulloto--1280-dark.webp) | 0/0 | NullOto ソフトウェア型ノイズキャンセリングアプリ — Portfolio | 0/1 (fail 1) |
| `bansankai` | [0.000239](887/portfolio-bansankai--390-light.webp) | [0.000194](887/portfolio-bansankai--390-dark.webp) | [0.000079](887/portfolio-bansankai--1280-light.webp) | [0.000073](887/portfolio-bansankai--1280-dark.webp) | 0/1 | 煤夜 様 - わたし晩餐会 — Portfolio | 0/1 (fail 1) |
| `tokimeki` | [0.000009](887/portfolio-tokimeki--390-light.webp) | [0](887/portfolio-tokimeki--390-dark.webp) | [0.000011](887/portfolio-tokimeki--1280-light.webp) | [0](887/portfolio-tokimeki--1280-dark.webp) | 0/0 | darupoi 様 - Tokimeki — Portfolio | 0/0 (fail 0) |
| `kosen-fes-2025` | [0.000034](887/portfolio-kosen-fes-2025--390-light.webp) | [0.000042](887/portfolio-kosen-fes-2025--390-dark.webp) | [0.000087](887/portfolio-kosen-fes-2025--1280-light.webp) | [0.000065](887/portfolio-kosen-fes-2025--1280-dark.webp) | 0/1 | 宇部高専祭ウェブサイト2025 — Portfolio | 0/1 (fail 1) |
| `kosen-procon-pv` | [0.000005](887/portfolio-kosen-procon-pv--390-light.webp) | [0](887/portfolio-kosen-procon-pv--390-dark.webp) | [0](887/portfolio-kosen-procon-pv--1280-light.webp) | [0](887/portfolio-kosen-procon-pv--1280-dark.webp) | 0/1 | 高専プロコン 非公式pv — Portfolio | 0/0 (fail 0) |
| `cclub-brochure-2025` | [0.000228](887/portfolio-cclub-brochure-2025--390-light.webp) | [0.00023](887/portfolio-cclub-brochure-2025--390-dark.webp) | [0.000068](887/portfolio-cclub-brochure-2025--1280-light.webp) | [0.000066](887/portfolio-cclub-brochure-2025--1280-dark.webp) | 0/1 | コンピュータ部 勧誘チラシ — Portfolio | 0/1 (fail 1) |
| `tegaki-anime` | [0.000221](887/portfolio-tegaki-anime--390-light.webp) | [0.000217](887/portfolio-tegaki-anime--390-dark.webp) | [0.000093](887/portfolio-tegaki-anime--1280-light.webp) | [0.000079](887/portfolio-tegaki-anime--1280-dark.webp) | 0/1 | 手書きアニメーション — Portfolio | 0/1 (fail 1) |
| `prototype` | [0.000007](887/portfolio-prototype--390-light.webp) | [0](887/portfolio-prototype--390-dark.webp) | [0.000002](887/portfolio-prototype--1280-light.webp) | [0](887/portfolio-prototype--1280-dark.webp) | 0/1 | タイピングゲーム ProtoType — Portfolio | 0/0 (fail 0) |
| `yukikate` | [0.000002](887/portfolio-yukikate--390-light.webp) | [0](887/portfolio-yukikate--390-dark.webp) | [0](887/portfolio-yukikate--1280-light.webp) | [0](887/portfolio-yukikate--1280-dark.webp) | 0/1 | 【二次創作】雪糅 文字pv — Portfolio | 0/0 (fail 0) |
| `kaben` | [0.000002](887/portfolio-kaben--390-light.webp) | [0](887/portfolio-kaben--390-dark.webp) | [0](887/portfolio-kaben--1280-light.webp) | [0](887/portfolio-kaben--1280-dark.webp) | 0/1 | 【二次創作】花弁、それにまつわる音声 文字pv — Portfolio | 0/0 (fail 0) |
| `sep-color` | [0](887/portfolio-sep-color--390-light.webp) | [0](887/portfolio-sep-color--390-dark.webp) | [0](887/portfolio-sep-color--1280-light.webp) | [0](887/portfolio-sep-color--1280-dark.webp) | 0/1 | Aeエフェクトプラグイン sep_color — Portfolio | 0/0 (fail 0) |
| `oneself` | [0](887/portfolio-oneself--390-light.webp) | [0](887/portfolio-oneself--390-dark.webp) | [0](887/portfolio-oneself--1280-light.webp) | [0](887/portfolio-oneself--1280-dark.webp) | 0/1 | ONESELF 二次創作 — Portfolio | 0/0 (fail 0) |
| `lhaplus` | [0](887/portfolio-lhaplus--390-light.webp) | [0](887/portfolio-lhaplus--390-dark.webp) | [0.000002](887/portfolio-lhaplus--1280-light.webp) | [0](887/portfolio-lhaplus--1280-dark.webp) | 0/1 | ラプラスショコラ 二次創作 — Portfolio | 0/0 (fail 0) |
| `reel-2024` | [0.000239](887/portfolio-reel-2024--390-light.webp) | [0](887/portfolio-reel-2024--390-dark.webp) | [0.000078](887/portfolio-reel-2024--1280-light.webp) | [0.000072](887/portfolio-reel-2024--1280-dark.webp) | 0/1 | reel 2024 — Portfolio | 0/1 (fail 1) |
| `aulymo-v01` | [0](887/portfolio-aulymo-v01--390-light.webp) | [0](887/portfolio-aulymo-v01--390-dark.webp) | [0](887/portfolio-aulymo-v01--1280-light.webp) | [0](887/portfolio-aulymo-v01--1280-dark.webp) | 0/1 | Aulymo — Portfolio | 0/0 (fail 0) |
| `mawaru` | [0](887/portfolio-mawaru--390-light.webp) | [0](887/portfolio-mawaru--390-dark.webp) | [0](887/portfolio-mawaru--1280-light.webp) | [0](887/portfolio-mawaru--1280-dark.webp) | 0/1 | まわる世界 文字pv — Portfolio | 0/0 (fail 0) |
| `meikai` | [0](887/portfolio-meikai--390-light.webp) | [0](887/portfolio-meikai--390-dark.webp) | [0](887/portfolio-meikai--1280-light.webp) | [0](887/portfolio-meikai--1280-dark.webp) | 0/1 | 冥界 二次創作pv — Portfolio | 0/0 (fail 0) |
| `hurahu` | [0.000005](887/portfolio-hurahu--390-light.webp) | [0](887/portfolio-hurahu--390-dark.webp) | [0.000002](887/portfolio-hurahu--1280-light.webp) | [0](887/portfolio-hurahu--1280-dark.webp) | 0/1 | フラフープハレーション 文字pv — Portfolio | 0/0 (fail 0) |
| `usoto` | [0](887/portfolio-usoto--390-light.webp) | [0](887/portfolio-usoto--390-dark.webp) | [0](887/portfolio-usoto--1280-light.webp) | [0](887/portfolio-usoto--1280-dark.webp) | 0/1 | 嘘と未来 文字pv — Portfolio | 0/0 (fail 0) |
| `prototype-brochure` | [0.000228](887/portfolio-prototype-brochure--390-light.webp) | [0.000227](887/portfolio-prototype-brochure--390-dark.webp) | [0.000087](887/portfolio-prototype-brochure--1280-light.webp) | [0.000079](887/portfolio-prototype-brochure--1280-dark.webp) | 0/1 | ProtoType パンフレット — Portfolio | 0/1 (fail 1) |
| `liteglow` | [0.000224](887/portfolio-liteglow--390-light.webp) | [0.000185](887/portfolio-liteglow--390-dark.webp) | [0.00007](887/portfolio-liteglow--1280-light.webp) | [0.000066](887/portfolio-liteglow--1280-dark.webp) | 0/1 | 【Aeエフェクトプラグイン】LiteGlow — Portfolio | 0/1 (fail 1) |
| `multislicer` | [0.00021](887/portfolio-multislicer--390-light.webp) | [0.000183](887/portfolio-multislicer--390-dark.webp) | [0.000073](887/portfolio-multislicer--1280-light.webp) | [0.000069](887/portfolio-multislicer--1280-dark.webp) | 0/1 | MultiSlicer — Portfolio | 0/1 (fail 1) |
| `ch4nge` | [0.000268](887/portfolio-ch4nge--390-light.webp) | [0.000275](887/portfolio-ch4nge--390-dark.webp) | [0.000091](887/portfolio-ch4nge--1280-light.webp) | [0.000083](887/portfolio-ch4nge--1280-dark.webp) | 0/0 | 三途くお 様「CH4NGE/Giga」 — Portfolio | 0/1 (fail 1) |
| `propose` | [0.000041](887/portfolio-propose--390-light.webp) | [0.000056](887/portfolio-propose--390-dark.webp) | [0.000087](887/portfolio-propose--1280-light.webp) | [0.000085](887/portfolio-propose--1280-dark.webp) | 0/0 | 三途くお 様「プロポーズ/可不」 — Portfolio | 0/1 (fail 1) |
| `kakumei` | [0.000199](887/portfolio-kakumei--390-light.webp) | [0.0002](887/portfolio-kakumei--390-dark.webp) | [0.000074](887/portfolio-kakumei--1280-light.webp) | [0.000069](887/portfolio-kakumei--1280-dark.webp) | 0/1 | 蝶羽ヘレナ 様 - 革命道中 — Portfolio | 0/1 (fail 1) |
| `homura` | [0.000035](887/portfolio-homura--390-light.webp) | [0.00004](887/portfolio-homura--390-dark.webp) | [0.000068](887/portfolio-homura--1280-light.webp) | [0.000057](887/portfolio-homura--1280-dark.webp) | 0/1 | ひよりひよこ 様 - アエギス 第零楽章「焔」 — Portfolio | 0/1 (fail 1) |
| `aulymo-v03` | [0](887/portfolio-aulymo-v03--390-light.webp) | [0](887/portfolio-aulymo-v03--390-dark.webp) | [0.000002](887/portfolio-aulymo-v03--1280-light.webp) | [0](887/portfolio-aulymo-v03--1280-dark.webp) | 0/1 | Aeスクリプト Aulymo_v03 — Portfolio | 0/0 (fail 0) |
| `border` | [0.000003](887/portfolio-border--390-light.webp) | [0](887/portfolio-border--390-dark.webp) | [0.000005](887/portfolio-border--1280-light.webp) | [0](887/portfolio-border--1280-dark.webp) | 0/1 | Ae縁取りエフェクト Border — Portfolio | 0/0 (fail 0) |
| `design-001` | [0.000263](887/portfolio-design-001--390-light.webp) | [0.000248](887/portfolio-design-001--390-dark.webp) | [0.000089](887/portfolio-design-001--1280-light.webp) | [0.000079](887/portfolio-design-001--1280-dark.webp) | 0/1 | デザイン練習 #001 — Portfolio | 0/1 (fail 1) |
| `code-type` | [0.000018](887/portfolio-code-type--390-light.webp) | [0](887/portfolio-code-type--390-dark.webp) | [0.000004](887/portfolio-code-type--1280-light.webp) | [0](887/portfolio-code-type--1280-dark.webp) | 0/1 | コードタイプ風映像素材 — Portfolio | 0/0 (fail 0) |
| `stretch-v02` | [0](887/portfolio-stretch-v02--390-light.webp) | [0](887/portfolio-stretch-v02--390-dark.webp) | [0](887/portfolio-stretch-v02--1280-light.webp) | [0](887/portfolio-stretch-v02--1280-dark.webp) | 0/1 | Aeエフェクトプラグイン Stretch v2 — Portfolio | 0/0 (fail 0) |
| `aulymo-v02` | [0.000033](887/portfolio-aulymo-v02--390-light.webp) | [0](887/portfolio-aulymo-v02--390-dark.webp) | [0.000001](887/portfolio-aulymo-v02--1280-light.webp) | [0](887/portfolio-aulymo-v02--1280-dark.webp) | 0/1 | Aeスクリプト Aulymo — Portfolio | 0/0 (fail 0) |
| `stretch-v01` | [0.000007](887/portfolio-stretch-v01--390-light.webp) | [0](887/portfolio-stretch-v01--390-dark.webp) | [0.000002](887/portfolio-stretch-v01--1280-light.webp) | [0](887/portfolio-stretch-v01--1280-dark.webp) | 0/1 | Aeエフェクトプラグイン Stretch — Portfolio | 0/0 (fail 0) |
| `shinkansen` | [0](887/portfolio-shinkansen--390-light.webp) | [0](887/portfolio-shinkansen--390-dark.webp) | [0.000007](887/portfolio-shinkansen--1280-light.webp) | [0](887/portfolio-shinkansen--1280-dark.webp) | 0/1 | シンカンセンスゴイカタイアイス p5js練習 — Portfolio | 0/0 (fail 0) |
| `netu` | [0.000005](887/portfolio-netu--390-light.webp) | [0](887/portfolio-netu--390-dark.webp) | [0.000002](887/portfolio-netu--1280-light.webp) | [0](887/portfolio-netu--1280-dark.webp) | 0/1 | 熱異常 テキストモーション — Portfolio | 0/0 (fail 0) |
| `moumoku` | [0](887/portfolio-moumoku--390-light.webp) | [0](887/portfolio-moumoku--390-dark.webp) | [0](887/portfolio-moumoku--1280-light.webp) | [0](887/portfolio-moumoku--1280-dark.webp) | 0/1 | 盲目の怪物 文字pv — Portfolio | 0/0 (fail 0) |
| `alice` | [0.000005](887/portfolio-alice--390-light.webp) | [0](887/portfolio-alice--390-dark.webp) | [0](887/portfolio-alice--1280-light.webp) | [0](887/portfolio-alice--1280-dark.webp) | 0/1 | Alice in 冷凍庫 文字pv — Portfolio | 0/0 (fail 0) |
| `my-first-blender` | [0](887/portfolio-my-first-blender--390-light.webp) | [0](887/portfolio-my-first-blender--390-dark.webp) | [0.000001](887/portfolio-my-first-blender--1280-light.webp) | [0](887/portfolio-my-first-blender--1280-dark.webp) | 0/1 | 初めてのBlender — Portfolio | 0/0 (fail 0) |
| `isogasii-editor` | [0.000001](887/portfolio-isogasii-editor--390-light.webp) | [0](887/portfolio-isogasii-editor--390-dark.webp) | [0.000002](887/portfolio-isogasii-editor--1280-light.webp) | [0](887/portfolio-isogasii-editor--1280-dark.webp) | 0/1 | 忙しい人のための作文エディター 完成版 — Portfolio | 0/0 (fail 0) |
| `isogasii-demo` | [0.000008](887/portfolio-isogasii-demo--390-light.webp) | [0](887/portfolio-isogasii-demo--390-dark.webp) | [0](887/portfolio-isogasii-demo--1280-light.webp) | [0](887/portfolio-isogasii-demo--1280-dark.webp) | 0/1 | 忙しい人のための作文エディター 試作 — Portfolio | 0/0 (fail 0) |
| `red-black-design` | [0.000004](887/portfolio-red-black-design--390-light.webp) | [0](887/portfolio-red-black-design--390-dark.webp) | [0.000001](887/portfolio-red-black-design--1280-light.webp) | [0.000001](887/portfolio-red-black-design--1280-dark.webp) | 0/0 | 赤と黒のデザイン — Portfolio | 0/0 (fail 0) |
| `blue-white-design` | [0.000276](887/portfolio-blue-white-design--390-light.webp) | [0.000272](887/portfolio-blue-white-design--390-dark.webp) | [0.000108](887/portfolio-blue-white-design--1280-light.webp) | [0.000103](887/portfolio-blue-white-design--1280-dark.webp) | 0/0 | 青と白のデザイン — Portfolio | 0/1 (fail 1) |
| `dounika` | [0](887/portfolio-dounika--390-light.webp) | [0](887/portfolio-dounika--390-dark.webp) | [0.000002](887/portfolio-dounika--1280-light.webp) | [0](887/portfolio-dounika--1280-dark.webp) | 0/1 | どうにかなっちゃいそう 文字pv — Portfolio | 0/0 (fail 0) |
| `cclub-brochure-2024` | [0.000034](887/portfolio-cclub-brochure-2024--390-light.webp) | [0.000047](887/portfolio-cclub-brochure-2024--390-dark.webp) | [0.000073](887/portfolio-cclub-brochure-2024--1280-light.webp) | [0.000067](887/portfolio-cclub-brochure-2024--1280-dark.webp) | 0/1 | コンピュータ部パンフレットデザイン — Portfolio | 0/1 (fail 1) |
| `ooame` | [0](887/portfolio-ooame--390-light.webp) | [0](887/portfolio-ooame--390-dark.webp) | [0.000001](887/portfolio-ooame--1280-light.webp) | [0](887/portfolio-ooame--1280-dark.webp) | 0/1 | 大雨警報発令中 — Portfolio | 0/0 (fail 0) |
| `ugoita` | [0](887/portfolio-ugoita--390-light.webp) | [0](887/portfolio-ugoita--390-dark.webp) | [0.000002](887/portfolio-ugoita--1280-light.webp) | [0](887/portfolio-ugoita--1280-dark.webp) | 0/1 | 動いたっ！ イラストアニメーション — Portfolio | 0/0 (fail 0) |
| `flashbeat-op` | [0](887/portfolio-flashbeat-op--390-light.webp) | [0](887/portfolio-flashbeat-op--390-dark.webp) | [0](887/portfolio-flashbeat-op--1280-light.webp) | [0](887/portfolio-flashbeat-op--1280-dark.webp) | 0/1 | FlashBeatオープニング — Portfolio | 0/0 (fail 0) |
| `flashbeat-bgm` | [0](887/portfolio-flashbeat-bgm--390-light.webp) | [0](887/portfolio-flashbeat-bgm--390-dark.webp) | [0](887/portfolio-flashbeat-bgm--1280-light.webp) | [0](887/portfolio-flashbeat-bgm--1280-dark.webp) | 0/1 | FlashBeatテーマ曲(BGM) — Portfolio | 0/0 (fail 0) |
| `flashbeat` | [0.000003](887/portfolio-flashbeat--390-light.webp) | [0](887/portfolio-flashbeat--390-dark.webp) | [0](887/portfolio-flashbeat--1280-light.webp) | [0](887/portfolio-flashbeat--1280-dark.webp) | 0/1 | FlashBeat — Portfolio | 0/0 (fail 0) |

### 4.4 chromatic ピクセルの帰属（hue / palette 分解、4 capture 合算）

| ルート | chromatic px（4 capture 合算） | palette に近い (≤24) | blend (25–80) | other (>80) | 上位 hue 桶 | 上位 other hex |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | 26902 | 19.2% | 73.6% | 7.2% | 30-60: 94.5%, 60-90: 3.9%, 0-30: 1.3% | #473e04 (53px), #120b00 (27px), #110a00 (23px), #0f0900 (17px) |
| `/about` | 6139 | 32.7% | 55.7% | 11.6% | 30-60: 94.6%, 60-90: 3.3%, 0-30: 1.3% | #110a00 (12px), #0f0b00 (9px), #100c00 (6px), #150d00 (4px) |
| `/keyboard` | 184 | 0.0% | 97.8% | 2.2% | 60-90: 97.8%, 240-270: 2.2% | #656371 (2px), #787684 (1px), #63616f (1px) |
| `/projects/dotfiles` | 60 | 0.0% | 100.0% | 0.0% | 60-90: 100.0% | — |
| `/portfolio` | 2015 | 4.7% | 65.8% | 29.5% | 60-90: 27.9%, 210-240: 26.0%, 90-120: 20.6% | #000e00 (5px), #0e010a (3px), #001000 (2px), #959aa6 (2px) |
| `/tools` | 251799 | 2.0% | 4.8% | 93.1% | 0-30: 56.3%, 330-360: 37.4%, 210-240: 2.5% | #190404 (9049px), #180303 (7580px), #160403 (6916px), #1a0506 (5951px) |
| `/design-system` | 2247017 | 49.1% | 6.6% | 44.4% | 270-300: 35.1%, 180-210: 25.2%, 30-60: 21.9% | #241a2e (521995px), #5c3b6d (116373px), #0f1b25 (84441px), #231b2e (20314px) |

## 5. Findings

**F1 — `/design-system` の chromatic share は 2.55–4.89%（全 surface 中で最大）。帰属は分類 specimen と fixture 画像であり、分類以外の「システムの色」は DOM に存在しない。**
palette 近傍 49.1% + blend 6.6% + other 44.4%。上位 hue は violet 35.1% / cyan 25.2% / yellow 21.9%。残る other は `#241a2e`（4 capture 合算 521,995px、実在 bbox = 1280 light の part1 内 x[528–1098] y[12100–12969]）と `#5c3b6d`（116,373px）— **Issue #486 の CLS fixture 画像（IMAGE セクションの固定データ試験体）**であり、色トークンではない（§2 の方法で crop して目視確認済み）。残りは `#0f1b25` 系（同一 fixture の別セル、84,441px）と field 端の fringe。
DOM census は chromatic background 12 値すべて分類 ramp（`#ec4899` / `#06b6d4` / `#eab308` / `#f9a8d4` / `#67e8f9` / `#fde047` / `#be185d` / `#0e7490` / `#a16207` / `#db2777` / `#ecfeff` / `#0891b2`）、chromatic text 4 値すべて `accent.category.*`（`#be185d` / `#0e7490` / `#a16207` / `#4338ca`）で、**分類以外の色はこのページの DOM に1つもない**。
**status セクションは色を広告しない**: 「状態は色では示しません…状態を示す色トークンはありません」と明記され、`accent.positive` / `accent.negative` / `accent.warning` の3エイリアスは **この base では既に削除済み**（`a3a5dc48`、stage-4）。状態は `StateMark` の形（disc / cross / triangle）と語だけが担う。エイリアス削除は別 PR で着地済みであり、本記録は削除後の状態を撮っている。

**F2 — `/tools` の chromatic share は 1.30–1.62%（1280 と 390 の双方）。** 帰属は other 93.1%、hue は red 系 56.3% + pink-red 37.4%、上位 other hex は `#190404` / `#180303` / `#160403` — **ProtoType カードの preview 画像（ツール自身のスクリーンショット、content image）**。システムの色ではない。ツール詳細 15 ルートは chroma すべて 0。

**F3 — `/` の chromatic share は 0.15–0.19%。** 上位 hex は4 capture 共通で `#ffd527`（hue 30–60° が 94.5%）— **フッターの edition ブロックのマスコット挿絵（content image）**。DOM の chromatic 色は0件。`/about` は 0.027–0.064% で、上位 hex は地色に寄り薄い fringe（`#f0ede2` 系、個数 ≤9px）— 実質ノイズ。

**F4 — それ以外の surface はすべて chroma ≤ 0.035%。** `/contact` は4 capture すべて **chroma = 0（厳密に0）**、`/keyboard` ≤ 0.0044%、`/projects/dotfiles` ≤ 0.0022%、`/portfolio` リスト 0.003–0.0036%、tool 詳細15件はすべて 0、portfolio 詳細66件の最大は 0.0345%。これらの残余ピクセルは、warm な地（`#edede8` 系）上的な WebP 圧縮 fringe と日本語テキストのアンチエイリアス（`#e0e2d5` 等、chroma 13 前後）である。

**F5 — 分類マークは「要素として存在し、墨で描かれている」（missing ではない）。** DOM census: `/portfolio` 一覧に `[data-state-mark]` **65 個**（`code` 23 / `design` 17 / `tool` 25、`text.muted` の span 内 = chromatic 色0）、`/` に status mark 3、`/keyboard` 5、`/projects/dotfiles` 1。分類**色**を DOM に持つのは `/design-system` の specimen のみ（F1）。＝ 「色が残る場所 = 分類 specimen、内容面のマークは形と語と墨」という状態を実測できた。ただし §6 のとおり、この run はポートフォリオの**画像**を検証できておらず、分類マークの有無は DOM とピクセルで確認したものである。

**F6 — 画像の読み込み失敗 95 capture（すべて `/portfolio` 系）。capture 環境の制約であり、デザインの欠陥ではない。** 詳細と /media 未検証の宣言は §6。

## 6. ポートフォリオ画像の読み込み失敗（capture 環境）— 未検証の明示

**95/356 capture で `<img>` の読み込みが失敗した（`naturalWidth === 0`）。すべて `/portfolio` 系ルートである。**

失敗 capture 数: **95** / 356、該当ルート: **24** 件（失敗 image 要素合計 180）。route ごとの failed 画像数（各 capture）:

- `/portfolio` — 4 capture 失敗: 390/light=21, 390/dark=23, 1280/light=22, 1280/dark=23
- `/portfolio/icon-tegaki-anime` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/my-sns-icon` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/seishun` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/m5-clock` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/pomodoroom` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/my-web-2025` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/kosen-fes2025-ending` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/nulloto` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/bansankai` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/kosen-fes-2025` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/cclub-brochure-2025` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/tegaki-anime` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/reel-2024` — 3 capture 失敗: 390/light=1, 1280/light=1, 1280/dark=1
- `/portfolio/prototype-brochure` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/liteglow` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/multislicer` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/ch4nge` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/propose` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/kakumei` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/homura` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/design-001` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/blue-white-design` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1
- `/portfolio/cclub-brochure-2024` — 4 capture 失敗: 390/light=1, 390/dark=1, 1280/light=1, 1280/dark=1

**理由（実測）— harness が production 構成の artifact を配るため**:

1. **local R2 は存在し、key も揃っている。** state は `.wrangler` ではなく `.tmp/d1state/v3/r2/` にある（再現コマンド (1)(2)): blob **116 件**、`_mf_objects` **116 行**、local D1 の `portfolio_media.r2_key` **130 行**に対する欠損 **0**（重複バイトで130 行が 116 object に潰れている = `docs/verification/portfolio/legacy-media-migration.md` の 130 行 / 116 object と一致）。同一の bootstrap server はその key をローカルでも配る: `GET /media/<key>` → **200**（再現コマンド (3))。
2. **それでもブラウザは local を叩かない。** preview が配る HTML の img src は**絶対 URL**（`https://rebuildup.dev/media/…`、配信 HTML 中に 23 本）で、その base は build 成果物に焼き込まれている: `.cloudflare/output/v0/workers/default/worker.config.json` に `"MEDIA_PUBLIC_BASE_URL": {"type":"text","value":"https://rebuildup.dev/media"}`（再現コマンド (4))。harness が配っているのは production build artifact なので、ブラウザは production の `/media/<key>` へ向かい、local origin には決して当たらない。
3. **production 側に object が無い。** 同一 key の production GET → **404**（再現コマンド (3))。これは既知の release blocker と一致する: `docs/verification/portfolio/legacy-media-migration.md`（Issue #850）とそれを引用する `quality/issue-closure-ledger.json` の記録 — production の media は 3 件のみで、R2 object 116 件は未移行。**本 run は production R2 の在庫を監査していない**（その監査は `pnpm run r2:media:audit` の役割）; 404 という応答だけを実測した。

**再現コマンド**（実測日 2026-11-04）:

```sh
# (1) local R2 の blob 在庫
$ ls .tmp/d1state/v3/r2/my-web-2026/blobs | wc -l
116

# (2) 116-vs-130 突合: _mf_objects.key に無い portfolio_media.r2_key は0件
$ node --input-type=module <<'EOF'
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
const dir = '.tmp/d1state/v3/r2/miniflare-R2BucketObject';
const obj = new DatabaseSync(dir + '/' + readdirSync(dir).find((f) => f.endsWith('.sqlite') && !f.startsWith('metadata')), { readOnly: true });
const have = new Set(obj.prepare('SELECT key FROM _mf_objects').all().map((r) => r.key));
const dbs = [];
(function walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = d + '/' + e.name; if (e.isDirectory()) walk(p); else if (e.name.endsWith('.sqlite') && !e.name.endsWith('-wal') && e.name !== 'metadata.sqlite') dbs.push(p); } })('.tmp/d1state/v3/d1');
const d1 = new DatabaseSync(dbs[0], { readOnly: true });
const keys = d1.prepare('SELECT r2_key FROM portfolio_media').all().map((r) => r.r2_key);
const missing = keys.filter((k) => !have.has(k));
console.log(`objects=${have.size} media_rows=${keys.length} missing=${missing.length}`);
EOF
objects=116 media_rows=130 missing=0

# (3) 同一 server（bootstrap --port=17123 起動中）は key をローカルで配り、production は 404
$ curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
    http://127.0.0.1:17123/media/portfolio/icon-tegaki-anime/icon-tegaki-anime/media_1786783446233_a4460f179e314d3fae4fd0ffc319fd9e-20260408_gif.gif
200 image/gif
$ curl -s -o /dev/null -w '%{http_code}\n' \
    https://rebuildup.dev/media/portfolio/icon-tegaki-anime/icon-tegaki-anime/media_1786783446233_a4460f179e314d3fae4fd0ffc319fd9e-20260408_gif.gif
404
$ curl -s http://127.0.0.1:17123/portfolio | grep -o 'https://rebuildup.dev/media/[^"]*' | wc -l
23

# (4) preview が配る artifact に production の media base が焼き込まれている
$ rg -o '"MEDIA_PUBLIC_BASE_URL":\{"type":"text","value":"[^"]*"\}' .cloudflare/output/v0/workers/default/worker.config.json
"MEDIA_PUBLIC_BASE_URL":{"type":"text","value":"https://rebuildup.dev/media"}
```

**宣言**: 本 run は **`/media/<key>` が描画されることを検証していない**。95 capture はカードの本文・分類マーク・レイアウトを示すが、**サムネイルの見え方は示していない**。失敗の原因は「preview harness が production 構成の artifact を配し、media URL が production を指す」という harness 仕様と「production R2 にこれらの object が無い」という未移行状態の合成であり、design system の色設計の欠陥でも「local R2 の欠如」でもない。この coverage gap（preview ベースの視覚検証はメディア描画を検証できないこと）は [Issue #903](https://github.com/rebuildup/my-web-2026/issues/903) に記録されている。media 移行の解消後、または production を指さない harness で同一手順の再取得を推奨する。

## 7. この記録が証明しないこと

- **コントラスト適合**: 本記録は色の「存在と面積」を測る。WCAG の text contrast を証明するものではない（`pnpm run a11y:contrast:check` がその役割を持つ）。axe の color-contrast は `e2e/a11y/axe-public-routes.spec.ts`（`pnpm run a11y:axe:check`）が担う。
- **`/admin*`**: 対象外（未撮影・未測定）。
- **`/media/<key>` の描画**: §6 のとおり未検証。
- **2 engine目 / interaction / hover / focus / 動き**: Chromium 単独、`reducedMotion: reduce`、静止画。
- **日本語コピーの文言適合**: `copy:*` gate の領域。
- **本番データ**: local D1 + skeleton/migrated seed のみ。production の在庫・値は測っていない（production URL への撮影替わりは行っていない）。

## 8. stage 5 基準の達成状況

| 基準 | 状態 |
| --- | --- |
| production build（dist 手動編集なし） | 充足 — `pnpm run build` @ `7f650a43` |
| repo 自身の local production path で配信・data source を明記 | 充足 — §1 |
| 全公開ルート × 390/1280 × light/dark = WebP q≤82 で保存 | 充足 — 356/356（`/admin*` は範囲外） |
| chromatic share 測定 + 表 | 充足 — §4.1–4.4 |
| 主要 chromatic hex とそのシェア | 充足 — 表 A/D ほか |
| 実コンテンツ描画（section 数・title・fallback/error/empty 検査） | 充足 — §4 要約（356 件すべて markers false） |
| 390 の horizontal overflow | 充足 — 0 件 |
| `/design-system` がシステムに従っているか（status セクションの色を含む） | 充足 — F1（stage-4 後の状態を撮影） |
| **ポートフォリオ画像（`/media/<key>`）の描画検証** | **未達** — preview harness が production の media URL を焼き込み（§6）、production R2 に object が無いため 404。coverage gap は [Issue #903](https://github.com/rebuildup/my-web-2026/issues/903)。環境要因であり、修正は media 移行 / harness の別作業 |
| 本ドキュメントの作成 | 充足 — 本ファイル |
| commit / push / Draft PR | 本 PR で充足（この記録の PR がそれ） |

**結論**: stage 5 のうち1基準（ポートフォリオ画像の描画検証）が環境要因で未達のため、**stage 5 完了とは宣言しない**。その他の基準は上表のとおり充足しており、色の適用（chromatic share・DOM の色・status の無彩色）は §4/§5 の実測値で裏付けられる。
