# 既知の axe-core 違反の是正記録（Issue #718）

> 対象: 公開ルート（`e2e/a11y/axe-public-routes.spec.ts`）と Storybook の独立 story
> （`e2e/a11y/axe-storybook.spec.ts`）の **描画済みの DOM**。
> 物差しは [WCAG 2.2](https://www.w3.org/TR/WCAG22/) の **A / AA**、
> 走査は axe-core 4.14.0 / タグ `wcag2a` `wcag2aa` `wcag21a` `wcag21aa` `wcag22aa`。
>
> **この Issue の主張**: 台帳（`e2e/a11y/axe-baseline.json` /
> `e2e/a11y/axe-storybook-baseline.json`）は「欠陥を隠さないための装置」であり、
> 恒久的な欠陥の置き場ではない。2026-10-23 に記録された違反は、**実装側で直した**。
> 台帳が空になったのは「ゲートを緩めた」からではなく「欠陥が無くなった」からである
> （§4 の負の対照で証明する）。

## 1. 実測サマリ

| 対象 | 監査単位 | 修正前 | 修正後 |
| --- | --- | --- | --- |
| 公開ルート | 10 route（`/tools` `/admin/login` を含む manifest 全体） | **10 violation / 14 node** | **0 violation / 0 node** |
| Storybook | 100 story（28 file）+ index 1 test | **11 story が `definition-list`**（11 failed / 90 passed） | **0 violation**（101 passed） |
| 台帳 `e2e/a11y/axe-baseline.json` | route × rule | 10 レコード | **0 レコード** |
| 台帳 `e2e/a11y/axe-storybook-baseline.json` | story × rule | 11 レコード | **0 レコード** |

測り方は **同じ装置** を使った。

- ルート: `pnpm run a11y:axe:check`（loopback の `vite preview` に対して Chromium 1 引擎 / 1280 × 720）。
- Storybook: `pnpm run a11y:axe-storybook:ci`（Storybook を loopback に起動して Chromium で実測）。
- 補助計測（リポジトリの外・`.tmp/` に置いた一時スクリプト）: 同じ axe-core と同じタグ集合で
  route ごとの violation 数 / rule id / 要素セレクタ / 要素 HTML を突き合わせるためのもの。
  製品コードではない。

**台帳の記録（2026-10-23）と実測（2026-11-01）は一致していた。** 記録されていた
`Develop facet` などの文字列も実在した（`FacetFilter.tsx` のテンプレートリテラル
`${label.en} facet` が生成する）。つまり、**この Issue で消えた違反は新しい違反ではない**。

## 2. 根本原因ごとの是正

### 2.1 `list`（SC 1.3.1）— desktop nav の `<ul>` の直下に `<a>` がある

| 項目 | 内容 |
| --- | --- |
| before | route 7 件（`/about` `/keyboard` `/contact` `/portfolio` `/portfolio/my-web-2026` `/projects/dotfiles` `/design-system`）で node 各 1、selector `.md\:gap_6`（`<ul data-testid="public-nav-desktop">`） |
| owner | `editorial` — `src/editorial/nav/PublicNav.tsx` |
| 変更 | desktop strip の各項目を `<li>` で包んだ。`<li>` は `display: flex` なので、link は以前と同じ flex item と同じ箱を持つ（`<li>` は line box を作らないので、行の高さ・項目の幅・折り返し閾値は変わらない） |
| after | 7 route すべてで `list` は **観測されない**。ルート監査は 10 route 0 violation |

### 2.2 `definition-list`（SC 1.3.1）— home の status リスト

| 項目 | 内容 |
| --- | --- |
| before | route `/` で node 1（selector `.min-w_0.flex-d_column.d_flex > dl`）、Storybook で 11 story（`src/home/composer.stories.tsx#AllReachable` `#Degraded` と `src/home/status/tiles.stories.tsx` の 9 export） |
| owner | `home` — `src/home/status/tiles.tsx` |
| 原因 | `<dl>` の group `<div>` は `<dt>` / `<dd>` だけを含むことを許されるが、この group には **health badge 用の `<div>`** が 3 番目に入っていた。axe の `only-dlitems` がその `<div>` を「許されない直下の子」と判定していた（`div > div`） |
| 変更 | badge の wrapper を `<dd>` にした（health は同じ term に対する 2 番目の説明）。grid の列・`justifyContent`・余白・字号は変更していない |
| after | `/` と 11 story で `definition-list` は **観測されない** |

### 2.3 `label-content-name-mismatch`（SC 2.5.3）— home の capability link

| 項目 | 内容 |
| --- | --- |
| before | route `/` で node 2: `a[aria-label="ポートフォリオ を開く"]` と `a[href$="tools"]` |
| owner | `home` — `src/home/capabilities/grid.tsx` |
| 原因 | `aria-label` は JA ラベル（`ポートフォリオ`）で、可視テキストは EN ラベル（`Portfolio`）だった。axe の Label in Name は「可視テキストがアクセシブル名に含まれること」を要求する |
| 変更 | `aria-label` を `${capability.labelJa} / ${capability.label} を開く` にした。**可視テキストは変更していない**（`→Portfolioを開く` のまま）。JA ラベルと EN ラベルと JA の動詞を、カードの読む順序どおりに並べただけ |
| after | `/` で `label-content-name-mismatch` は **観測されない** |

### 2.4 `label-content-name-mismatch`（SC 2.5.3）— portfolio の facet chip

| 項目 | 内容 |
| --- | --- |
| before | route `/portfolio` で node 4: `button[aria-label="Develop facet"]` / `"Video facet"` / `"Design facet"` / `"Other facet"` |
| owner | `portfolio` — `src/portfolio/components/FacetFilter.tsx` |
| 原因 | `aria-label` が EN だけ（`Develop facet`）で、可視テキストは JA ラベル（`開発`）+ EN の装飾ラベルだった |
| 変更 | `aria-label` を `${label.ja} / ${label.en} facet`（選択時は ` selected` を足す）にした。**チップの可視テキストは変更していない**（`開発Develop` のまま） |
| after | `/portfolio` で `label-content-name-mismatch` は **観測されない** |

## 3. 台帳と manifest の更新

| ファイル | 変更 |
| --- | --- |
| `e2e/a11y/axe-baseline.json` | 10 レコードを削除（`records: []`）。削除の履歴を `$history` に残した |
| `e2e/a11y/axe-storybook-baseline.json` | 11 レコードを削除（`records: []`）。同上 |
| `e2e/a11y/axe-manifest.ts` | 8 route の `expect` を `baseline` → `pass` に |
| `e2e/a11y/axe-storybook-manifest.ts` | 2 story file の `expect` を `baseline` → `pass` に（note も実装に追随して更新） |

manifest の `expect` の変更は **ゲートを緩めていない**。spec 自身が
「違反を FIX したら manifest を `pass` にして台帳レコードを同じ commit で削除する」と
指示している（`e2e/a11y/axe-public-routes.spec.ts` の失敗メッセージ /
`e2e/a11y/axe-storybook-verdict.ts`）。`pass` の宣言は「違反が 1 件もない」ことを
意味するので、**この変更はゲートの判定を厳しくする方向**である。
ルートの集合・story の集合・走査タグ・比較式には一切手を入れていない。

## 4. 負の対照（空の台帳が恒久 green にならないことの確認）

1. `src/editorial/nav/PublicNav.tsx` の `<li>` を外して **修正前の markup に戻し**、
   再ビルドした。
2. 同じ測定をやり直すと、`list` が 7 route で再検出された
   （`/about` `/keyboard` `/contact` `/portfolio` `/portfolio/my-web-2026`
   `/projects/dotfiles` `/design-system`、合計 7 violation / 7 node）。
3. **空の台帳のまま** `pnpm run a11y:axe:check` を走らせると、7 件が
   `the scan found violation(s) the ledger does not record` で **red** になった
   （gate の exit code 1）。
4. 修正版を復元して再ビルドすると、10 route 0 violation に戻った。

つまり、**台帳が空でもゲートは機能している**。この Issue は比較を緩めておらず、
rule filter を広げておらず、route / story を除外していない。

## 5. 視覚が変わっていないことの確認

修正前後で **同じ viewport（1280 × 720 / Chromium）** の full-page スクリーンショットを
取り、pixel 比較した。

| surface | 結果 |
| --- | --- |
| `/about` | byte 同一 |
| `/keyboard` | byte 同一 |
| `/portfolio` | byte 同一 |
| `/projects/dotfiles` | byte 同一 |
| `/design-system` | byte 同一 |
| `/` | 4,501,760 pixel 中 **50 pixel のみ差分**。差分領域 (703–709, 1377–1387) は「observed at <現在時刻>」の行の中だけにあり、**観測時刻の文字が違うだけ**。レイアウト・配色・字体の差ではない |

capture した 6 surface のうち 5 枚が byte 同一、1 枚（`/`）が観測時刻の文字だけが
違う。`/contact` `/tools` `/admin/login` `/portfolio/my-web-2026` は
スクリーンショットを撮っていない（変更した markup を含まない surface であり、
共通する nav も `home` と同じである）。

さらに、DOM 上の箱も比較した（capture した 6 surface それぞれの nav link /
status row の `dt` `dd` / 各セル / capability link / facet chip の
position・size・font・color・margin・padding）。
**唯一の違いは `aria-label` 属性の値だけ**で、描画される箱は全要素で同一だった。

## 6. 残っている owner 決定（未解決）

| 項目 | 内容 | 誰の決定か |
| --- | --- | --- |
| 公開日本語コピーの編集者承認 | `src/home/capabilities/grid.tsx` の `aria-label` 行は日本語リテラル（`を開く`）を含む。`src/home/**` は公開コピー面なので、PR で `pnpm run copy:approval:check` が **NEEDS REVIEW** になる。承認記録は作っていない（owner の判断なので） | repository owner |
| 実機スクリーンリーダーでの読み上げ品質 | アクセシブル名は「JA ラベル / EN ラベル / 動詞」の形になった。実機 AT での聞きやすさはこのゲートの対象外 | repository owner / 設計判断 |
| モバイル幅の nav | 幅 1280 × 720 だけで測っている。`<li>` 化はモバイル（`<md`）では `<ul>` が `display: none` なので影響しない | 既存のゲートの制約（変更なし） |

## 7. 使わなかった逃げ道

- rule filter を広げていない（`AXE_TAGS` は変更していない）。
- route / story を manifest から外していない。
- 比較式（`axe-storybook-verdict.ts`）と spec を変更していない。
- owner の承認記録を **どこにも作っていない**
  （`quality/copy-editorial-approvals.json` / `quality/stale-content-review.json` /
  `quality/wcag-review-matrix.json` は無変更）。
- 可視テキスト（日文・英文とも）を書き換えていない。直したのは markup と
  `aria-label` の属性値だけで、**見た目は 1 pixel も変わっていない**（§5）。
