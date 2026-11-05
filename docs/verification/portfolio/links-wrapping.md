# Portfolio §07 Links の折り返し実測（Issue #871）

**この記録は実測値であり、owner の承認ではない。**

## 1. 欠陥

`/portfolio/[slug]` の §07 Links は、ラベルを持たないリンクについて URL を
そのまま表示する。折り返しの指定が無いため、折り返し機会を持たない URL
（例 `https://github.com/rebuildup/Aulymo_v03`）は 1 つの切れない文字列として
レイアウトされ、390px 幅で**文書全体**が横スクロールした。

Issue #870 の測定中に発見した実測値（修正前）:

```
viewport 390 → document.scrollWidth 410 / clientWidth 390
はみ出した要素:
  A    width 394  "Repositoryhttps://github.com/rebuildup/A…"
  SPAN width 317  "https://github.com/rebuildup/Aulymo_v03"
```

同じ面でも `?` を含む URL は折り返し機会があるため、はみ出さなかった。
つまり URL の字面で壊れるかどうかが変わっていた。

## 2. 修正

`src/portfolio/components/PortfolioDetail.tsx` の §07 のアンカーに 3 つを足した:

| プロパティ | 理由 |
| --- | --- |
| `flexWrap: 'wrap'` | ラベルと URL を別の行に置けるようにする |
| `minWidth: '0'` | flex item が内容幅より小さく縮めるようにする |
| `overflowWrap: 'anywhere'` | URL 自体に折り返し機会を与える（継承されるので内側の span にも効く） |

URL を短縮する表示は採らない。リンク先の同一性が読み手に伝わらなくなるため。

## 3. 実測（修正後）

ローカル preview + ローカル D1 fixture（`fixture-long-url`、リンクは
`https://github.com/rebuildup/Aulymo_v03` 1 本）、Playwright 同梱 Chromium、
DPR 2。

| viewport / appearance | `document.scrollWidth` / `clientWidth` | viewport を超えた要素 |
| --- | --- | --- |
| 1440 light | 1440 / 1440 | 0 |
| 390 light | **390 / 390** | 0 |
| 390 dark | **390 / 390** | 0 |

390px での実測レイアウト: アンカーは 358×54 CSS px、ラベル（`Repository`）が
1 行目、URL が 2 行目に 316.9px で収まる。テキストは選択可能なまま
（`user-select` を変更していない）。

証跡: `docs/verification/portfolio/links-wrapping/`
（`links-desktop-light.webp` / `links-mobile-light.webp` / `links-mobile-dark.webp`、WebP・DPR 2）。

## 4. 再現手順

```bash
pnpm run db:migrate:apply:local
node_modules/.bin/cf d1 raw d761ddb7-8179-48dd-855f-c8b7b2924bad \
  --local --persist-to .tmp/d1state --sql "<fixture>"
pnpm run build && node scripts/sync-cf-build-output.mjs
pnpm exec vite preview --port 4401 --strictPort
node .tmp/871-measure.mjs   # request/DOM を測り WebP を書き出す
```

## 5. 測っていないこと

- production の実データ。ローカル fixture のみ。
- Chromium 以外（Safari / Firefox）。`overflow-wrap: anywhere` は主要ブラウザで
  実装済みだが、この repository では Chromium しか測っていない。
- §07 以外の面の長い URL。別途 #767 の棚卸しで扱う。
