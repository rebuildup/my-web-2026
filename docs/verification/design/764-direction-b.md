この記録は実測値であり owner 承認ではない。

> **追記（2026-11-04、Issue #812 / colour system III）**
> 本記録の計測は 2026-11-03 時点の 6 content family に対する実測であり、
> その数値は当時の事実として残す。現在の層は content family を
> `rose` / `cyan` / `amber` の **3** に絞り、`indigo` / `violet` / `teal`
> を削除し、Tool を色面なし（`text.default`）とした。したがって
> §1 の content role 一覧、§旧→新対応の末尾 2 行、および
> `signal.content.{indigo,violet,teal}` のコントラスト行は
> **現行の層には存在しない**。現行のマトリクスは 23 ペア ×
> 2 appearance で、削除した 3 role 以外のペアは弱めていない。

# Issue #764 Phase 1 — direction B 実装と計測

- 日付: 2026-11-03
- ブランチ: `764-impl`
- 基準: `origin/release-0-8-1` head `4e91f075`（作業ツリーは未コミット）
- 対象: 色の semantic role の置き換え（Phase 1）
- 対象外: 情報アーキテクチャの再編（Phase 2、未実装）。
  提案のみ `docs/design/information-architecture-proposal.md`。

## 1. 実装したこと

- `src/editorial/tokens.ts` に `charcoal.1000` を追加し、raw ramp を
  hue 名（`rose` / `cyan` / `amber` / `indigo` / `violet` / `teal`）へ
  改名した。ramp はカテゴリ名を持たない。
- `src/editorial/semantic-tokens.ts` を direction B の役割に置き換えた。
  - monochrome: `surface.*` 6 / `text.*` 5 / `border.*` 3
  - signal: `signal.action` / `signal.actionActive` / `signal.{positive,negative,warning}`
  - content: `signal.content.{rose,cyan,amber,indigo,violet,teal}`
- `src/editorial/content-signal.ts` を追加した。カテゴリ既知の対応
  （design → rose、code → cyan、writing → amber、tool → indigo）を
  保ち、未知の seed は FNV-1a で 6 family のどれかへ決定的に割り当てる。
- 旧 `bg.*` / `accent.*` / `border.subtle` の参照を `src/**` の各所で
  置き換えた（変更のあった `src/**` のファイルは 84 = `.tsx` 78 /
  `.ts` 4 / `.md` 2）。`accent.category.<facet>` を説明する履歴
  コメントは当時の事実として残した。
- `/design-system` の色セクションを role 名・用途・light/dark の
  解決値・彩色面積ルールの表示に更新した。セクション間の装飾
  ボーダーを削除した。
- コントラストゲート `scripts/check-a11y-contrast.mjs` を新しい
  role に合わせ、26 ペア × 2 appearance = 52 行にした。除外は
  理由付きで出力する。
- 撮影 harness が参照する CSS 変数名も新しい role に合わせた
  （`capture-a11y-focus-visible.mjs` の `--colors-surface-canvas`、
  `capture-i18n-unicode-slug.test.mjs` の `--surface-canvas` 期待値）。

### 旧 → 新 role 対応

| 旧 | 新 |
| --- | --- |
| `bg.canvas` | `surface.canvas` |
| `bg.subtle` | `surface.sunken` |
| `bg.surface` | `surface.raised` |
| `bg.inverse` | `surface.inverse` |
| `accent.surface` | `surface.feature` |
| `bg.accent` | `signal.action` |
| `accent.interactive` | `signal.actionActive` |
| `accent.positive` / `negative` / `warning` | `signal.positive` / `negative` / `warning` |
| `accent.category.{design,code,writing,tool}` | `signal.content.{rose,cyan,amber,indigo}` |
| `border.subtle` | `border.divider`（構造用途のみ） |
| `border.strong` / `border.focus` | 同名 |
| `text.{default,muted,inverse,accent}` | 同名 |
| — | `surface.control`（押せる面） |
| — | `text.disabled` |
| — | `signal.content.{violet,teal}` |

## 2. 計測環境

- ビルド: `pnpm run build`（成功）
- 配信: `pnpm run preview`（`127.0.0.1:4174`。`--port 3300` は
  vite preview に無視され、既定の 4174 で待ち受けた）
- ブラウザ: Playwright 同梱 Chromium、`deviceScaleFactor: 2`、
  viewport 高 900 CSS px
- 画面: `/` と `/design-system`、幅 390 / 1440、light / dark
- 撮影: `.tmp/capture-764.mjs`（gitignored の一時スクリプト）
- 画像: WebP quality 82、PNG は保存していない

## 3. 彩色面積の計測

### 3.1 定義

「彩色画素」は `max(r,g,b) − min(r,g,b) ≥ 24` の画素とした。
`svg` / `img` / `canvas` / `video` の矩形は除外した（画像・アイコン・
キャラクターは design token の彩色ではない）。

2 つの値を記録する。

- **solid**: 注目画素と上下左右の 4 近傍がすべて彩色画素で、かつ
  色差が各チャンネル 16 以内のときだけ数える。塗りつぶしの pill /
  rule / status dot は残り、文字の 1px アンチエイリアス縁は消える。
  **5% ルールの判定はこの値で行う。**
- **raw**: 単純な彩色画素の割合。アンチエイリアス縁を含む上限値。
  参考として併記する。

「画面」は 2 通り測った。

- **full page**: その幅でレンダリングされたページ全体。
- **first viewport**: 最初の 900 CSS px（訪問者が最初に見る面）。

`/design-system` は色見本そのものが被写体なので、色セクション
（`[data-colour-section]`）を除いた値も併記する。これは製品画面の
彩色面積ではなく、見本を除いた残りの面の参考値である。

### 3.2 結果

| ページ | 幅 | 外観 | 全体 solid | 全体 raw | 最初の viewport solid | 色セクション除外 solid |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | 390 | light | 1.59% | 4.35% | 3.02% | 1.59% |
| `/` | 390 | dark | 0.88% | 1.17% | 2.75% | 0.88% |
| `/` | 1440 | light | 0.63% | 1.69% | 0.98% | 0.63% |
| `/` | 1440 | dark | 0.34% | 0.45% | 0.73% | 0.34% |
| `/design-system` | 390 | light | 1.39% | 4.63% | 1.57% | 1.47% |
| `/design-system` | 390 | dark | 0.45% | 0.58% | 0.78% | 0.43% |
| `/design-system` | 1440 | light | 0.53% | 1.76% | 0.73% | 0.55% |
| `/design-system` | 1440 | dark | 0.17% | 0.21% | 0.21% | 0.16% |

**判定: 全 8 条件で solid は 5% 以下。** 最大は `/` 390 light の
最初の viewport で **3.02%**。上限に最も近い raw 値は
`/design-system` 390 light 全体の **4.63%** で、これも 5% 未満だが
余裕は小さい。raw は文字のアンチエイリアス縁を含むため、実際の
彩色面積は solid の値に近い。

色セクションを除いた `/design-system` の値が全体よりわずかに
高くなる行がある（1.39% → 1.47%、0.53% → 0.55%）。分母から色
セクションを抜く一方、残りの面の彩色は変わらないためで、彩色が
増えたわけではない。

### 3.3 撮影ファイル

`docs/verification/design/764-direction-b/`

- `home-390-light.webp` / `home-390-dark.webp`
- `home-1440-light.webp` / `home-1440-dark.webp`
- `design-system-390-light-part1..3.webp` / `-dark-part1..3.webp`
- `design-system-1440-light-part1..3.webp` / `-dark-part1..3.webp`
- `colour-area.json`（上の数値の生データ）

`/design-system` は 390 で 23,192 CSS px、1440 で 17,039 CSS px の
高さになり、DPR 2 の 1 枚 WebP はエンコーダ上限（16,383 px）を
超える。そのため 3 分割で保存した。分割は連続する縦方向の
スライスで、重複はない。

## 4. コントラスト計測（WCAG 2.2 SC 1.4.3）

`pnpm run a11y:contrast:check`（`scripts/check-a11y-contrast.mjs`）の
出力。26 ペア × 2 外観 = 52 行、**全行が閾値以上**。

### 4.1 monochrome

| ペア | light | dark |
| --- | --- | --- |
| `text.default` on `surface.canvas` | 17.06 : 1 | 18.80 : 1 |
| `text.default` on `surface.raised` | 17.41 : 1 | 17.77 : 1 |
| `text.default` on `surface.sunken` | 16.29 : 1 | 19.36 : 1 |
| `text.default` on `surface.control` | 14.48 : 1 | 16.45 : 1 |
| `text.muted` on `surface.canvas` | 7.24 : 1 | 6.13 : 1 |
| `text.muted` on `surface.raised` | 7.39 : 1 | 5.79 : 1 |
| `text.muted` on `surface.sunken` | 6.91 : 1 | 6.31 : 1 |
| `text.muted` on `surface.control` | 6.14 : 1 | 5.36 : 1 |
| `text.muted` on `surface.feature` | 7.10 : 1 | 5.38 : 1 |
| `text.accent` on `surface.canvas` | 5.67 : 1 | 7.10 : 1 |
| `text.accent` on `surface.feature`（large） | 5.56 : 1 | 6.22 : 1 |
| `text.inverse` on `signal.action` | 5.93 : 1 | 5.93 : 1 |
| `text.inverse` on `signal.actionActive` | 7.56 : 1 | 7.56 : 1 |
| `text.inverse` on `surface.inverse` | 17.85 : 1 | 17.85 : 1 |
| `border.focus` on `surface.canvas`（non-text） | 3.91 : 1 | 11.80 : 1 |
| `border.strong` on `surface.canvas`（non-text） | 4.54 : 1 | 4.18 : 1 |

### 4.2 signal

| ペア | light | dark |
| --- | --- | --- |
| `signal.positive` on `surface.canvas` | 5.24 : 1 | 12.91 : 1 |
| `signal.negative` on `surface.canvas` | 6.00 : 1 | 10.40 : 1 |
| `signal.warning` on `surface.canvas` | 4.79 : 1 | 13.64 : 1 |
| `signal.content.rose`（non-text） | 5.77 : 1 | 10.85 : 1 |
| `signal.content.cyan`（non-text） | 5.12 : 1 | 13.57 : 1 |
| `signal.content.amber`（non-text） | 4.70 : 1 | 14.92 : 1 |
| `signal.content.indigo`（non-text） | 7.55 : 1 | 9.87 : 1 |
| `signal.content.violet`（non-text） | 6.79 : 1 | 10.65 : 1 |
| `signal.content.teal`（non-text） | 5.23 : 1 | 13.30 : 1 |
| `signal.action` vs `surface.canvas`（non-text） | 5.67 : 1 | 3.31 : 1 |

最も余裕が小さいのは dark の `signal.action` vs `surface.canvas` で
**3.31 : 1**（3 : 1 の non-text 最小値に対して +0.31）。action fill は
白い `text.inverse`（5.93 : 1）を載せるため、dark で明るくできない。
brand ramp を動かす場合はこのペアを最初に再測する。

### 4.3 マトリクスから除外したもの

| トークン | 理由 | 実測 |
| --- | --- | --- |
| `border.divider` | 構造上の区切りで、component を識別する境界ではない（SC 1.4.3 の 3 : 1 は識別境界にのみ要求） | 1.18 : 1 light / 1.14 : 1 dark |
| `text.disabled` | inactive control は SC 1.4.3 の対象外。方向 B は語と形でも無効状態を示す | 4.55 : 1 light / 4.19 : 1 dark |
| `signal.actionActive` vs `surface.canvas` | 押下状態は control の静止境界ではない。ラベルペア（`text.inverse` on `signal.actionActive`）はマトリクスに含む | 7.23 : 1 light / 2.60 : 1 dark |

## 5. 測っていないこと

- **owner の視覚承認。** この記録は数値であり、direction B が
  「使える」という判断ではない。`/design-system` と `/` の見た目は
  owner が確認していない。
- **DOM レベルの全ルート・コントラスト監査。** 今回は token ペアの
  ゲートのみ。`docs/verification/a11y/contrast.md` の DOM 監査は
  旧トークン名の時点の記録で、再実行していない。Home / About /
  Portfolio / Tools の全可視文字を再走査していない。
- **`/` と `/design-system` 以外の彩色面積。** About / Portfolio /
  Portfolio detail / Projects / Tools / Keyboard / Contact は
  撮影していない。
- **状態・操作時の彩色面積。** hover / focus / pressed / disabled の
  各状態、reaction picker の開閉、consent banner の表示状態は
  測っていない。
- **実機・実ブラウザ差。** Playwright 同梱 Chromium の 1 環境のみ。
  Safari / Firefox / iOS / Android の実機、OS の colour profile、
  zoom、強制 dark mode は未確認。
- **high-contrast / forced-colors。** Windows High Contrast と
  `forced-colors: active` は未確認。
- **色覚シミュレーション。** 6 content family が 1 型・2 型・3 型の
  色覚で区別できるかは測っていない。色は語と `StateMark` を伴う
  前提だが、family 同士の識別性は未検証。
- **文字のアンチエイリアス差。** 彩色面積の raw 値はフォント
  レンダリングに依存する。solid 値を主指標にした理由でもある。
- **Storybook の見た目。** `pnpm run build-storybook` の成否は
  Phase 1 の完了条件だが、Storybook の各 story を目視・撮影して
  いない。
- **情報アーキテクチャ。** Phase 2 は未実装。ナビ、ルート統合、
  redirect、sitemap は変更していない。
- **本番環境。** production deploy、Cloudflare Workers Builds、
  production smoke は実行していない。

## 6. 再現手順

```sh
pnpm run build
pnpm run preview -- --port 3300 --strictPort   # 実際は 4174 で待ち受ける
node .tmp/capture-764.mjs                      # 撮影 + 彩色面積
pnpm run a11y:contrast:check                   # token ペアのコントラスト
pnpm run build-storybook
/Users/rebui/work/my-web-2026/.tmp/supervisor/bin/vfast
```

`.tmp/capture-764.mjs` は一時スクリプトで、リポジトリには含めない。
数値の正本は `colour-area.json` と `a11y:contrast:check` の出力。
