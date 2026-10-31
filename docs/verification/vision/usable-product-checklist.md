# 「使えるもの」を配布・API・操作の公開条件に落とす — 公開条件チェックリストの検証画像 (#515)

- 対象: `docs/personal/usable-product-publication.md`（本文）と `src/personal/usable-product-publication/`（preview データ + Storybook story）
- Issue: #515
- 成果物: `docs/verification/vision/usable-product-checklist.webp`
- 状態: **本 Issue で capture 済み**。機械で検証できる範囲は §3 に列挙し、人手で判断すべき範囲は §6 に列挙する

## 1. 何を撮ったか（条件・対象範囲）

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/personal/usable-product-publication/UsableProductPublication.stories.tsx` の `Checklist` story（story が宣言する `component` に story 自身の `args` を渡した木。Storybook が同じ story で描画する木そのもの） |
| Storybook story id | `preview-usableproductpublication-515--checklist` |
| capture 手段 | `node scripts/capture-usable-product-publication.mjs`（`.tmp/` に Vite harness を生成 → loopback 配信 → Playwright Chromium → `sharp` で WebP 化） |
| 描画 CSS | リポジトリの Panda 設定（`postcss.config.mjs` → `panda.config.ts`）を harness の Vite build に渡したもの。すなわち実際の `src/styles.css` |
| viewport / DPR | 1440 x 900 / 1（`fullPage` 撮影。描画後のページ高は 11042 CSS px） |
| 生成物サイズ | 860 x 6595 px、**282 kB** WebP（quality 80、budget 300 kB） |
| 再現性 | **encode 段は決定的、ブラウザ撮影は byte 再現ではない**（プロセス間でも差が出る）。再生成は視覚的に同一であることを目標とする |
| 本番非破壊 | 既定で外部通信なし。local harness build と loopback 配信のみ。deploy / remote binding / secret 値の読み出しは無い |

### なぜ 860 px 幅なのか（budget に対して）

1440 px の viewport でページ全体を描いて 1440 px 幅のまま WebP 化すると budget を超える。**budget は上げない**。

- 1440 px 幅のままでは 300 kB を超えるため、画像の画素数を絞った。判定結果と次の対応が画面に加わった後の実測は、1024 px 幅で 374 kB / 940 px 幅で 327 kB / 900 px 幅で 303 kB と budget を超え、**860 px 幅で 282 kB** に収まる。
- viewport を狭めても解決しない。content span は `Container`（`maxWidth: 1024px`）で上限を持つため、viewport を狭めても本文の幅は 1024 px のままで、**文書は長くなる**だけである。WebP の size は本文の画素数でほぼ決まるので、狭い viewport は容量の節約にならない。

つまり「画面を一部だけ撮る」のではなく「**画面全体を、budget に収まる倍率で**撮る」選択である。assertion（§3）は画像の画素数に依らず DOM 全体を見るので、文書の途中が欠けていても capture は落ちる。**画像は 1 画面（full page）そのものであり、切り詰めた部分画像ではない**。

### なぜ `storybook dev` ではなく harness なのか

`pnpm run build-storybook` はこの repository では **manager-only の静的ビルド**になる（`@storybook/react-vite` builder がプロジェクトの `vite.config.ts` を merge し、Cloudflare / TanStack Start plugin が出力先を取る。出力に `iframe.html` が無く `sb-manager/` しか残らない — 2026-10-31 に再実測）。したがって **撮影できる静的な gallery が存在しない**。同じ事実を `scripts/capture-error-state-gallery.mjs`（#501）と `scripts/capture-a11y-table-code.mjs`（#407）が記録している。

一方で `storybook dev` 自体は **起動でき、story も描画できる**（2026-10-31 に実測: `pnpm exec storybook dev --port 6013` → index 200、`iframe.html?id=<story id>` が story の本文を描画。起動時に `Missing required secrets for Worker "my-web-2026"` と表示されるが、これは `@cloudflare/vite-plugin` が出す警告であって dev server の起動を止めない。本 repository は既に `pnpm run a11y:axe-storybook:ci` で Storybook dev 上の story に axe をかけている）。

capture はそれでも harness を使う。理由は 3 つで、いずれも「dev server に依存しない」方向の理由である。

1. 長-lived な dev server を起動・停止する手续が不要で、`node scripts/…` 1 本で済む。
2. **DOM assertion が撮影と同じコマンドの中で走る**（撮影と検証が別のステップに分かれない）。
3. 結果が **Storybook builder の挙動に依存しない**（builder 側の出力形態が変わっても capture は壊れない）。

harness は **shipped story module を直接 import** し、その story が宣言する `component` に story 自身の `args` を渡して描画する。この story は `render:` を宣言していない（`component` + `args`）ため、harness が描くものは「同等の component/args の組」ではなく **Storybook がこの story で描画する木そのもの** である。harness が描くのは「Copied した preview」ではなく「shipping されている preview そのもの」なので、capture と Storybook surface は乖離しない。

### なぜ WebP なのか

本リポジトリの `docs/verification/**` 配下は WebP が慣習であり、script は `.webp` 以外の出力先を拒否する（`assertWebpOutputPath`）。PNG のままだと本文稠密な画面に対して検証 artefact として大きすぎる。

## 2. 画面が示しているもの

画像は公開条件チェックリストの preview そのものを全ページ撮影したものである。

1. **document title** — `usableProductTitle`（「使えるもの」を配布・API・操作の公開条件に落とす）。
2. **lead 段落** — `usableProductLead`。
3. **9 つの section** — `usableProductSections` の順に並ぶ（典拠と読み方 / 公開条件の5段階 / 段階ごとのチェックリスト / 判定の語彙 / 適用例 3 件 / 採用と保留 / 残存 · 要 owner 判断）。見出しは preview データの `heading` と一致する（§3 の gate が集合と順序を固定する）。
4. **規則の適用範囲** — 「公開条件の5段階」節の 3 番目の段落。規則が「これから公開する公開物」に適用する公開条件であり、公開済みの公開物の撤回は本稿では決めないことを明記する。
5. **5 段階のカード** — 各段階の「利用者の出口」と「判定」。
6. **段階ごとのチェック** — 5 段階 × 3 項目 = 15 個のチェック項目が list item として描画される。
7. **判定の語彙** — 適合 / 未確認 / 不適合の 3 つの定義。
8. **適用例 3 件** — readmark（既存 Tool）/ `/api/v1/reactions`（既存 API）/ text-counter（公開できない Tool）。各例は、典拠（committed record）と pointer、事実値、5 段階ごとの「記録が述べていること」「記録に無いこと」、そして各段階の **判定結果** と **次の対応** を持つ。
9. **採用と保留** — 採用 5 項目 / 保留 4 項目。
10. **残存 · 要 owner 判断** — 未決 5 項目（API key の発行場所、公開済み公開物の継続・撤回・記録の改訂を含む）。

## 3. 機械で検証した項目

撮影は「asset を作る」だけに留まらず、**描画された DOM を preview データと突き合わせる**。capture が失敗する条件は以下（1 つでも違反すると非 0 で終了し、artefact も書かれない）。

| 項目 | 判定 |
| --- | --- |
| document title | 描画された `<h1>` が `usableProductTitle` と一致 |
| lead 段落 | 描画された header の先頭 `<p>` が `usableProductLead` と一致 |
| section の集合と順序 | 描画された `<section>` の数が `usableProductSections` と一致し、各 section が `id` で対応する |
| section heading | 各 section の `<h2>` が preview データの `heading` と一致 |
| section の段落 | 各 section の `paragraphs` が preview データと一致（欠けている段落を failure にする） |
| section の箇条書き | 各 section の `bullets` が `<li>` として描画されている |
| 5 段階 | 各段階のカードが `stage` id を持ち、段階名・利用者の出口・判定の 3 つを描画する |
| 段階ごとのチェック | 各段階のカードが、その段階の `items[].label` をすべて `<li>` として描画する |
| 適用例の主語 | 各適用例 section が `example.subject` を描画する |
| 適用例の典拠 | 各適用例が `record（pointer）` を描画する |
| 適用例が描く事実 | 各適用例が `label = value` の形式ですべての `facts` を描画する |
| 適用例の段階ノート | 各適用例が 5 段階それぞれの `evidence` を描画する |
| 適用例の欠落 | `gap !== null` の段階についてのみ `gap` を描画する（`gap === null` の段階に欠落文言を出さない） |
| 適用例の判定結果 | 各段階が `verdict`（適合 / 未確認 / 不適合）を描画する |
| 適用例の次の対応 | 各段階が `nextAction` を描画する |
| 採用 / 保留 / 未決 | `usableProductAdopted` / `usableProductHeld` / `usableProductOpenDecisions` の全項目が `<li>` として描画される |
| 横スクロール | `scrollWidth <= clientWidth`（WCAG 2.2 SC 1.4.10 Reflow）。撮影幅 1440 で横スクロールは出ない |

判定関数 `verifyRenderedPreview()` は pure な関数で、観測結果（DOM）と期待値（preview データ）の差だけを failure として返す。差があれば capture は落ち、flattering な画像が残らない。

## 4. 本文との一致（parity gate）

本文 `docs/personal/usable-product-publication.md` と preview データ `src/personal/usable-product-publication/UsableProductPublication.preview.ts` の一致は `scripts/check-usable-product-preview-parity.test.mjs` が検証する。parity gate は本文と preview データが一致しているかを見るに加えて、各段階の判定が 3 つの語彙のどれかでであること、次の対応が本文に存在すること、次の対応が本文が既に持つ場所（保留項目・未決項目・manifest 自身が宣言する条件）を指していること、規則の適用範囲が本文に書かれていることも見る。

本 capture はその parity gate の **別 half** である。parity gate は「本文と preview データが一致しているか」を見るが、**preview が実際に描画されているか**は見ていない。capture は描画された DOM を見る。

## 5. 再現手順

```bash
# 検証画像（.webp）を再生成する
node scripts/capture-usable-product-publication.mjs
# → docs/verification/vision/usable-product-checklist.webp
# → .tmp/usable-product-publication/report.json（観測値と判定）

# 本文と preview の一致を検証する
node --experimental-strip-types --test scripts/check-usable-product-preview-parity.test.mjs

# capture script の契約を検証する（WebP 出力・budget・harness・DOM 比較の負の制御）
node --experimental-strip-types --test scripts/capture-usable-product-publication.test.mjs
```

capture script は `package.json` に登録していない（並列 PR の conflict を避けるため。`pnpm run` ではなく `node scripts/...` で実行する）。§7 の未決事項を参照。

## 6. 機械で検証していない項目（人手での判断）

- 本文の**文言**が正しいか、5 段階の翻訳（見出し語 → 受入指標）が owner の意図と一致するか（owner しか決められないので本文側で「未確認（owner 確認待ち）」と明示してある）。
- 記録の**事実値**（Tool slug・API path・schema field・件数）が、その記録の正しい読み取りであるか。
- 5 段階の並び順が**読み順**として自然か、廃止段の扱いが運用と合っているか。
- 適用例として選んだ 3 件（既存 Tool / 既存 API / 公開できない Tool）が「代表性がある」と言えるか。
- artefact の 860 px 幅の縮小が、レビュー時に読みやすさとして妥当か。

## 7. 残存の未決事項

- **`pnpm run knip:check` は green（141 findings / 141 baselined / 0 new）。** `knip.json` の entry には `scripts/*.test.mjs` が含まれるため、`scripts/capture-usable-product-publication.test.mjs` が本 script を import する時点で本 script は unused 扱いにならない。`package.json` の scripts には登録していない（並列 PR との conflict を避けるため）。§5 の `node scripts/...` で実行できる。
- Miro の付箋本文は閲覧できないため、付箋内の詳細・時系列・数値・評価・軸の優先順位は本文側で「未確認（owner 確認待ち）」と明示してある。確認後に本文を書き換える場合、本文と preview の parity gate が落ちるため、preview データも同時に更新する必要がある。
- 画像内地物の文字は 860 px 幅へ downsample されている（本文の 16 px は約 10 px になる）。拡大すれば読めるが、印刷して読む用途には適さない。
