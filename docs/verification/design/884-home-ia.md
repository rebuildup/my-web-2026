# Home の IA 圧縮（Issue #884）— 実測

**この記録は実測値であり、owner の承認ではない。**

`docs/design/information-architecture-proposal.md`（Issue #764 Phase 1）§5.2 / §6-4 が
「Home の System status / Counter / Reactions を 1 つの判断にまとめる」と提案し、
「これはページコンポジションの変更なので独立した Issue にする」と書いた分の実装記録。

> **再計測（2026-11-04）**: 初回の計測・撮影は `origin/release-0-8-1` をマージする前の
> ツリーで行った。マージ後は Issue #767 の pet safe-area
> （`src/editorial/pet/safe-area.ts`、下端インラインに 76px の回廊を確保）が Home の
> ライティングカラム幅を変えているので、**マージ後のツリーで撮り直した値だけを以下に残す**。
> 差分の要因はこの Issue ではなくベースの変更（回廊）とデータ状態（mock）である。

## 1. 変えたこと

`src/home/composer.tsx` の読み順と、`src/home/status/tiles.tsx` の `chrome` prop だけ。
取得経路（server function）、DB、privacy notice、ナビ、ルート、sitemap は触っていない。

| | before | after |
| --- | --- | --- |
| Home のトップレベル `<section aria-labelledby>` | 7 | **5** |
| `status-heading` | `<section>` の見出し | `h3` サブブロック（節内、id 維持） |
| `reactions-heading` | `<section>` の見出し | `h3` サブブロック（節内、id 維持） |
| `access-counter-heading` | `<section>` の見出し | `h3` サブブロック（節内、id 維持） |
| サイト状態を表す `<h2>` | 3 本（System status / Reactions / Access counter） | **1 本**（サイトの状態 / Site status） |

`src/home/status/tiles.tsx` は `chrome?: 'section' | 'body'` を得た。
`'body'` は「説明文 + 行 + observed-at + 既知の障害」だけを描き、`<section>` / `<Container>` /
`<SectionHeading>` を描かない。既定値は `'section'` なので、Storybook と検証ギャラリーの
既存の描画は変わらない。説明文は status の obligation 側に残した（`STATUS_DESCRIPTION`）。

## 2. 見出しの並び（実測 / 1440 light）

```
h2  サイトの状態 / Site status        (id=site-status-heading)
h3  プラットフォームの状態 / Platform health (id=status-heading)
h3  既知の障害 / Known incidents      (id=status-heading-incidents)
h3  みんなの反応 / Reactions          (id=reactions-heading)
h3  ページビュー / Page views         (id=access-counter-heading)
```

`h2` の直下が `h3` で、レベルの飛びは無い。`scripts/check-a11y-heading-landmarks.mjs`
（ソース単位で1ファイル内の見出し連続を比較し、`<SectionHeading>` を h2 と読む）は
`pnpm run a11y:heading-landmarks:check` で **no violations**（`src/home/composer.tsx` は
h2 → h3 ×4 → h2 の順）。

## 3. セクションの実測

`document.querySelectorAll('#app-root section[aria-labelledby]')` と
`getBoundingClientRect()`。ローカル dev server（`MY_WEB_2026_DATA_SOURCE=mock`
`LOCAL_API_MODE=mock`、DataSourceBadge に `data-data-source="mock"` を確認）、
Playwright 同梱 Chromium、DPR 2、full page。生の数値は
`docs/verification/design/884-home-ia/measurements.json`。

### 1440 × 900（light / dark は同一値）

| # | `aria-labelledby` | top (px) | height (px) |
| --- | --- | --- | --- |
| 0 | `hero-title` | 0 | 435 |
| 1 | `current-projects-heading` | 435 | 801 |
| 2 | `capabilities-heading` | 1286 | 613 |
| 3 | `site-status-heading` | 1899 | 1349 |
| 4 | `contact-cta-heading` | 3248 | 387 |

`document.documentElement.scrollWidth` / `clientWidth` = **1440 / 1440**、
`body.scrollHeight` = 4331、`h1` は 1 本。

節内の `h3` 幅は 4 本とも **613px**（`spread` の 8/12 列 = 従来の System status の行幅と同じ）。
ライトとダークで geometry は完全一致。

### 390 × 844（light / dark、mobile emulation）

| # | `aria-labelledby` | top (px) | height (px) |
| --- | --- | --- | --- |
| 0 | `hero-title` | 0 | 642 |
| 1 | `current-projects-heading` | 642 | 1252 |
| 2 | `capabilities-heading` | 2040 | 1245 |
| 3 | `site-status-heading` | 3285 | 2005 |
| 4 | `contact-cta-heading` | 5290 | 429 |

`scrollWidth` / `clientWidth` = **390 / 390**（横スクロールなし）、
ビューポートを超える要素 **0**、`body.scrollHeight` = 6752、`h1` は 1 本。

節内の `h3` 幅は 4 本とも **282px**。マージした Issue #767 の pet safe-area が
ベースのまま 76px のインライン終端回廊を確保するため（`390 − 76 − 32`）、
初回記録の 358px ではない。回廊はベースの変更で、この Issue は触っていない。

## 4. reduced motion

`prefers-reduced-motion: reduce` をエミュレートして再読込した 1440 dark で、
`getComputedStyle(el).animationName !== 'none'` の要素は **0**（同じ計測を通常設定で
行ったときは **7** ある）。`docs/verification/design/884-home-ia/home-1440-dark-reduced-motion.webp`
がその描画で、`home-1440-dark.webp` と差分が出るのはこの 7 つのアニメーションが
止まるところだけである。

## 5. スクリーンショット

すべて WebP（DPR 2、full page、`quality: 72`）。PNG は無い。
初回の撮影はマージ前のツリーのため、下記はマージ後に撮り直した同じファイル名のものである。

| ファイル | viewport | appearance |
| --- | --- | --- |
| `884-home-ia/home-1440-light.webp` | 1440 × 900 | light |
| `884-home-ia/home-1440-dark.webp` | 1440 × 900 | dark |
| `884-home-ia/home-1440-dark-reduced-motion.webp` | 1440 × 900 | dark / reduce |
| `884-home-ia/home-390-light.webp` | 390 × 844 (mobile) | light |
| `884-home-ia/home-390-dark.webp` | 390 × 844 (mobile) | dark |

## 6. 測っていないこと

- **before（変更前 7 セクション）の高さは撮り直していない。** 比較表の before は構造
  （セクション数と id）の事実で、高さの before/after 比較はしていない。
- 320px 幅、200% zoom、実機（iOS Safari / Android Chrome）、Firefox / WebKit。
- 実データ（D1 / R2）での描画。計測は `MY_WEB_2026_DATA_SOURCE=mock` の canned data のみ
  （ローカル D1 の preview でも撮り直していない）。
- Reactions の選択操作、Counter の加算、既知の障害がある状態（記録が 0 件の描画のみ）。
- スクリーンリーダー実機での読み上げ、キーボード実走（構造と可視性は e2e が固定している）。
- Lighthouse / Core Web Vitals。

## 7. 公開日本語コピー

新しく公開面に出る文は 3 つ:

- 見出し「サイトの状態 / Site status」（`title` + `titleEn`）
- 節の説明「このサイトが今動いているか。binding の到達性、ページビュー、訪問者の反応を 1 つの面にまとめています。」
- eyebrow `02 — Status`（旧 `02 — System status` から短縮）

数値の採番だけの変更: contact の eyebrow が `05 — Contact` → `03 — Contact`
（Footer の `04 — Edition` の採番は Issue #842 の担当で変えていない）。
既存の説明文（status / reactions / counter）は文言を変えずに節内へ移しただけ。
Issue #506 の `copy:approval:check` はこれらを `NEEDS REVIEW` として報告する。
承認記録は作成していない（agent は owner の承認を作れない）。
