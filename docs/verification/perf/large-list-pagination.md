# 大量リストのページング境界 — `/portfolio` 120行 fixture 実測 (#490)

- 対象: `/portfolio` 一覧（`src/portfolio/components/PortfolioList.tsx` + `ProjectCard.tsx`）
- Issue: #490（`test(perf): 多量記事/作品リストのページング境界を検査`）
- 測るもの: **DOM node 数 / JS heap / 操作（Load more 追加）の成立 / アクセシビリティ不変条件**
- 測らないもの: Lighthouse スコア、Core Web Vitals budget、release gate
  - これらは #384（再現可能な Lighthouse 計測）/ #385（release gate）/ #386（Web Vitals budget）の所有物。**計測・可視化・ゲートを混ぜない**ことが本 Issue の受け入れ条件。
- 本番非破壊: fixture は **local D1**（`.tmp/d1state`）だけに投入し、計測後に必ず削除する。

## 1. 再現条件（実測した環境）

| 項目 | 値 |
| --- | --- |
| source SHA | `3dbc481`（after。before は `2395ef8`。差分は docs のみで src / scripts は同一 — §2 参照） |
| ブラウザ | Chromium 153.0.8010.12（`@playwright/test ^1.63.0`、playwright.config.ts と同じ chromium） |
| viewport / DPR | 1280x900 / 1 |
| CPU | CDP `Emulation.setCPUThrottlingRate` = **4x** |
| ネットワーク | CDP `Network.emulateNetworkConditions` = Slow 4G 相当（RTT 150 ms / down 1638 kbps / up 750 kbps） |
| サーバ | `vite preview`（= 実 Worker ビルド + local D1）。`pnpm run build` 済み前提 |
| fixture | local D1 に **120 行**（`portfolio_project`）、先頭ページ size **100**（`clampLimit` の既定値） |
| media | 未投入。`vite preview` は `MEDIA_PUBLIC_BASE_URL` に本番 media origin を束縛するため、card は仕様どおり placeholder / text-only の形状で測定 |
| Node / OS | v26.12.0 / darwin arm64 |
| 実行環境 | ローカル開発機（CI runner ではない）。CI 側の再現条件は同じ browser / viewport / CPU / network 設定で同じ**手順**を通す（§3 参照） |

コマンド:

```bash
pnpm run build                                   # 実 Worker ビルド（preview の前提）
node scripts/perf-large-list.mjs                 # seed → measure → click Load more → cleanup
```

## 2. 実測結果（120行 fixture）

`Load more` は**実際にクリック**し、2ページ目が DOM に入ったところで計測した。

- `before` = `2395ef8` に「今回の1要素修正」だけ戻した状態（`src/portfolio/components/ProjectCard.tsx` を 7b95c4b 版へ差し替え、ほかは同一）
- `after` = `3dbc481`（clean）。`2395ef8 → 3dbc481` の差分は `docs/verification/perf/**` のみで、
  `src/` と `scripts/`（ハーネス本体）は同一。したがって **DOM node 数・AX node 数・件数**は
  同じコードの 1 対 1 比較であり、ヒープとレイテンシだけが 1 回の走査ノイズを含む。

| 指標 | before | after | 合格基準 |
| --- | --- | --- | --- |
| 初期描画 card 数 | 100 | 100 | page size 100 と一致（満杯） |
| Load more 後 card 数 | 120 | 120 | fixture 全件 = 120 |
| DOM node 数（初期） | 1826 | 1826 | — |
| DOM node 数 / card | 18.26（pinned 付き card は 20） | 18.26（同じ） | **上限 20** |
| DOM node 数（Load more 後） | 2164 | 2164 | 追加 20 行ぶんの node だけ増える |
| アクセシビリティツリー全体 node 数 | 3241 | 3241 | 修正で node が増えていないことの証拠 |
| JS heap | 10.7 MB → 11.6 MB | 10.0 MB → 11.6 MB | 記録のみ（gate 向きでない） |
| navigation `load` | 12820 ms | 13023 ms | 4x CPU + Slow 4G 条件の記録値 |
| Load more 追加レイテンシ | 774 ms | 534 ms | 記録のみ |
| 一覧面の命名不可な `aria-label` | **100** | **0** | **0** |
| ページ全体の命名不可な `aria-label` | 101 | 1（下記 follow-up） | 記録のみ（§4） |
| AX 上で "facets" group と読める node | **0** | **100**（追加後は 120） | 描画 card 数と一致 |
| alt 無し image | 0 | 0 | 0 |
| ページエラー | 0 | 0 | 0 |
| verdict | FAIL | **PASS** | — |

### before / after の差は 1 要素だけ

- **修正要素**: `ProjectCard` の facet group（`src/portfolio/components/ProjectCard.tsx`）。
  `aria-label="facets"` を置いた **role 無しの `<div>`** に `role="group"` を足した 1 属性のみ。
- **なぜこれが 1 card あたりの欠陥なのか**: role `generic` の要素の `aria-label` は prohibited attribute で、
  どのアクセシビリティ API も名前を読み上げない。1 枚当たり card なので、page 1（100 行）では 100 件、
  fixture 全体（120 行）では 120 件の違反になる。「AX 上で "facets" group = 0」は Chromium が実際に
  その名前を読み上げていない証拠であり、after で 100（追加後は 120）になる。
- **DOM node 数が動かない理由**: 属性 1 個の追加なので 1826 node・per-card 18.26・AX node 3241 は before/after 同一。
  可視レイアウトも動かない（`role="group"` は表示ロールを持たない）。1 属性で、1 card あたりの構造は変えていない。
- **意図的に直していないもの**: `FacetFilter` の `aria-label="facet filter chips"` と `PortfolioDetail` の
  `aria-label="facets"` も同じ `<div>` 形状だが、今回の計測対象は**一覧の card**（件数に比例する面）だけ。
 |Issue の「今回の1要素のみ」に従って触っておらず、ページ全体の計測値 101 → 1 の残りがそれ。
  1 ページに 1 回しか描かない面なので、件数に比例する gate 対象ではない（§4）。

## 3. CI が常時守る不変条件（gate ではない）

| ファイル | 何を守るか |
| --- | --- |
| `src/portfolio/components/list-scale.test.tsx` | 100 行 page の per-card DOM node 上限、追記 page の node が線形に増えること、role generic 要素に `aria-label` が無いこと、facet group が名前付きで公開されること |
| `src/portfolio/components/PortfolioList.pagination.client.test.tsx` | 100+ 行での Load more 操作（1 クリック = 1 ページ要求、busy / disabled、追加後の順序と重複なし、終端で control が消える、エラーが alert で出る） |
| `scripts/perf-large-list.test.mjs` | fixture の決定性・列挙値の閉じた範囲・cleanup のスコープ、a11y 不変条件の純関数（暗黙ロール解決込み）、上限判定が実際に fail すること、CLI が 100+ を拒否すること |

`pnpm run test` は上記のうち `list-scale.test.tsx` と `scripts/perf-large-list.test.mjs` を含む
（`scripts/check-test-wiring.mjs` の契約に従い package.json から到達可能）。
`PortfolioList.pagination.client.test.tsx` は happy-dom 用の `pnpm run test:client` 専用（既存方針、§5）。

## 4. follow-up 候補（今回の scope 外）

`FacetFilter` / `PortfolioDetail` の同名 `<div aria-label>`。件数に比例しない面なので本 Issue の
1 要素ルールと harness の gate scope の外。計測は「残りを隠さない」ためにページ全体の件数を出している。
修正するなら別 Issue（1 Issue / 1 PR、`portfolio` obligation の owner は変わらない）。

## 5. スクリーンショット

`docs/verification/perf/large-list-pagination.webp` は、計測した**同じページ**の viewport キャプチャに
計測パネル（source SHA / browser / viewport / CPU / network / fixture / DOM / heap / append /
a11y 不変条件 / verdict）を載せた 1 枚。ページング境界（100 枚目の card と 101 枚目）が画面内に
入るスクロール位置で撮っており、JSON レポートの `screenshot` に
`scrollY` と境界 2 枚の card テキストが記録されている（「stale な画像」が後から判別できるようにするため）。

### Issue が指定した `.png` との差分（明示）

Issue #490 の必須スクリーンショットは `docs/verification/perf/large-list-pagination.png` だが、
**提出物は同ディレクトリの `.webp`**。理由は 2 つ:

1. Chromium は PNG しか書けないため、`sharp` で **WebP（幅 <= 1600、quality 80）** に変換してから commit する。
   一時 PNG は `.tmp/` に書いてその場で削除する（`scripts/perf-large-list.mjs` の `--screenshot` が既定）。
2. 検証用のバイナリを tree に大きく保持しないためのリポジトリ方針（`scripts/layout-audit-shoot.mjs` の
   「screenshot は repository 外へ」という記述と同じ考え方）。

変換後のサイズと budget 判定は JSON レポートの `screenshot.bytes` / `screenshot.withinBudget` に記録され、
上限は `SCREENSHOT_BUDGET_BYTES`（300 kB）。超過時は warning を stderr に出す。

## 6. 制限（known limitations）

- media 未投入（placeholder 形状）。cover `<img>` がある場合の card node 数は +1 程度だが、
  本 Issue では images を本番 media origin に向けないため測定していない。
- JS heap / latency は 4x CPU + Slow 4G の 1 回のラボ実測で、runner ごとの差が大きい。gate 化は #385 / #386 の判断。
- before / after は同一 machine・同一 fixture・同一ハーネスでの 1 対 1 の比較だが、それぞれ 1 回の走査であり、
  ヒープとレイテンシは測定ノイズを含む（DOM node 数と AX node 数はノイズを持たない）。
- happy-dom による操作テストは `validate:fast` に入っていない（既存方針）。実ページでの操作は本 Issue の計測（実クリック）が担保している。