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
| source SHA | `5d257d81909240a8e3b844b6a4653ef4b3e92ecf`（base `release-0-6-3`） |
| ブラウザ | Chromium 153.0.8010.12（`@playwright/test ^1.63.0`、playwright.config.ts と同じ chromium プロジェクト） |
| viewport / DPR | 1280x900 / 1 |
| CPU | CDP `Emulation.setCPUThrottlingRate` = **4x** |
| ネットワーク | CDP `Network.emulateNetworkConditions` = Slow 4G 相当（RTT 150 ms / down 1638 kbps / up 750 kbps） |
| サーバ | `vite preview`（= 実 Worker ビルド + local D1）。`pnpm run build` 済み前提 |
| fixture | local D1 に **120 行**（`portfolio_project`）、先頭ページ size **100**（`clampLimit` の既定値） |
| media | 未投入。`vite preview` は `MEDIA_PUBLIC_BASE_URL` に本番 media origin を束縛するため、card は仕様どおり placeholder / text-only の形状で測定 |
| Node / OS | v26.12.0 / darwin arm64 |

コマンド:

```bash
pnpm run build                                   # 実 Worker ビルド（preview の前提）
node scripts/perf-large-list.mjs                 # seed → measure → click Load more → cleanup
```

CI での再現条件は上表の browser / viewport / CPU / network / source SHA をそのまま使えば同じ形状の数字が出るが、**runner ノイズのため CI を gate にはしない**（#385 / #386 の領域）。CI が常時守るのは `scripts/perf-large-list.test.mjs`（純ロジック契約）と `src/portfolio/components/list-scale.test.tsx`（100+ 行での DOM / a11y 不変条件）である。

## 2. 実測結果（120行 fixture）

`Load more` は実際にクリックし、2ページ目が DOM に入ったところで計測した。

| 指標 | before（修正前） | after（修正後） | 合格基準 |
| --- | --- | --- | --- |
| 初期描画 card 数 | 100 | 100 | page size 100 と一致（満杯） |
| Load more 後 card 数 | 120 | 120 | fixture 全件 = 120 |
| DOM node 数（初期） | 1826 | 1826 | — |
| DOM node 数 / card | 18.26（pinned 付き card は 20） | 18.26 | **上限 20**（1 card が 1 card のまま） |
| DOM node 数（Load more 後） | 2164 | 2164 | 追加 20 行ぶんの node だけ増える |
| JS heap | 9.2 MB → 10.9 MB（+1.7 MB） | 9.2 MB → 10.9 MB（+1.7 MB） | 記録のみ（noise が gate 向きでない） |
| navigation `load` | 12351 ms | 12351 ms | 4x CPU + Slow 4G 条件の記録値 |
| Load more 追加レイテンシ | 413 ms | 413 ms | 記録のみ |
| `aria-label` ただし命名ロール無し | **122** | **0** | **0** |
| アクセシビリティツリー上で "facets" group | **0** | **100** | 1 page あたり card 数と一致 |
| ページエラー | 0 | 0 | 0 |

### before / after の差分は 1 要素だけ

- **修正要素**: `ProjectCard` の facet group（`src/portfolio/components/ProjectCard.tsx`）。
  `aria-label="facets"` を置いた **role 無しの `<div>`** に `role="group"` を足した 1 属性のみ。
- **なぜこれが 1 card あたりの欠陥なのか**: role `generic` の要素の `aria-label` は prohibited attribute で、
  どのアクセシビリティ API も名前を読み上げない。1 枚占总card なので、100 行(page 1) なら 100 件、
  120 行なら 120 件の違反になる。上の「アクセシビリティツリー上で "facets" group = 0」は
  Chromium が実際にその名前を読み上げていない証拠（after で 100 に増える）。
- **DOM 	node 数が変わらない理由**: 属性 1 個の追加なので、per-card ceiling 20 も 1826 node も動かない。
  可視レイアウトも動かない（`role="group"` は表示ロールを持たない）。
- **意図的に直していないもの**: `FacetFilter` の `aria-label="facet filter chips"` と
  `PortfolioDetail` の `aria-label="facets"` も同じ `<div>` 形状だが、今回の計測対象は
  **一覧の card**（件数に比例する面）だけなので|Issue の「今回の1要素のみ」に従って触っていない。
  残る 2 箇所は本 Issue の known issue として記録し、Follow-up の候補とする（別 Issue）。

## 3. CI が常時守る不変条件（gate ではない）

| ファイル | 何を守るか |
| --- | --- |
| `src/portfolio/components/list-scale.test.tsx` | 100 行 page の per-card DOM node 上限、追記 page の node が線形に増えること、role generic 要素に `aria-label` が無いこと、facet group が名前付きで公開されること |
| `scripts/perf-large-list.test.mjs` | fixture の決定性・列挙値の閉じた範囲・cleanup のスコープ、a11y 不変条件の純関数、上限判定が実際に fail すること、CLI が 100+ を拒否すること |

`pnpm run test` は上記 2 つを含む（`scripts/perf-large-list.test.mjs` は
`scripts/check-test-wiring.mjs` の契約に従い `package.json#scripts.test` から到達可能）。

## 4. スクリーンショット

`docs/verification/perf/large-list-pagination.png` は、計測した**同じページ**の viewport キャプチャに
計測パネル（source SHA / browser / viewport / CPU / network / fixture / DOM / heap / append /
a11y 不変条件 / verdict）を載せた 1 枚。ページング境界（100 枚目の card と 101 枚目）が
画面内に入るスクロール位置で撮り、報告書の数字と食い違わないようにしている。

## 5. 制限（known limitations）

- media 未投入（placeholder 形状）。cover `<img>` がある場合の card node 数は +1 程度だが、
  本 Issue では images を Production media origin に向けないため測定していない。
- JS heap / latency は 4x CPU + Slow 4G の 1 回のラボ実測であり、runner ごとの差が大きい。
  gate 化は #385 / #386 の判断。
- happy-dom による操作テスト（`PortfolioList.pagination.client.test.tsx`）は
  `pnpm run test:client` 専用で、`validate:fast` には入っていない（既存方針）。
  実ページでの操作は本 Issue の計測（実クリック）が担保している。