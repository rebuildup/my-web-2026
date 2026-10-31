# タイポグラフィ / グリッド / スイスデザインの採否記録 — 表示プレビューの検証画像 (#527)

- 対象: `docs/influences/typography-grid-swiss-design.md`（採否記録の本文）と `src/personal/typography-grid-swiss/`（preview データ + Storybook story）
- Issue: #527（`docs(influences): タイポグラフィ・グリッド・スイスデザインの採否を記録`）
- 成果物: `docs/verification/influences/typography-grid-choices.webp`
- 状態: **本 Issue で実装・検証済み**。残る未決事項は §7 に列挙

## 1. 何を撮ったか（条件・対象範囲）

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/personal/typography-grid-swiss/TypographyGridChoices.stories.tsx` の `Default` story（story 自身の `render:` が返すツリーをそのまま描画） |
| capture 手段 | `node scripts/capture-typography-grid-choices.mjs`（`.tmp/` に Vite harness を生成 → loopback 配信 → Playwright Chromium → `sharp` で WebP 化） |
| 描画 CSS | リポジトリの Panda 設定（`postcss.config.mjs` → `panda.config.ts`）を harness の Vite build に渡したもの。すなわち実際の `src/styles.css` |
| viewport / DPR | 1440 x 900 / 2（`fullPage` 撮影。描画後のページ高は 7496 CSS px） |
| 生成物サイズ | 900 x 4685 px、**281 kB** WebP（quality 80、budget 300 kB） |
| 再現性 | **encode 段は決定的、ブラウザ撮影は byte 再現ではない**（プロセス間でも差が出る）。再生成は視覚的に同一であることを目標とする |
| 本番非破壊 | 既定で外部通信なし。local harness build と loopback 配信のみ。deploy / remote binding / secret 値の読み出しは無い |

### なぜ 900 px 幅なのか（budget に対して）

1440 px の viewport でページ全体を描いて 1440 px 幅のまま WebP 化すると **584 kB** になり、committed artefact の budget 300 kB の 2 倍になる。budget は上げない。

- viewport を狭めても解決しない。content span は `Container`（`maxWidth: 1024px`）で上限を持つため、viewport を狭めても本文の幅は 1024 px のままで、**文書は長くなる**（実測: 1024 px viewport で 8052 px）。WebP の size は本文の画素数でほぼ決まるので、狭い viewport は容量の節約にならない。
- そこで **画像の画素数を絞る** 方を選んだ。1440 px viewport で DevicePixelRatio 2 で描いた full-page PNG を 900 px 幅へ downsample して符号化すると、**同じ 1 画面の全体**が 281 kB に収まる（本文の 16 px は約 10 px になる。viewer で拡大すれば読める）。

つまり「画面を一部だけ撮る」のではなく「**画面全体を、budget に収まる倍率で**撮る」選択である。assertion（§3）は画像の画素数に依らず DOM 全体を見るので、文書の途中が欠けていても capture は落ちる。

### なぜ `storybook dev` ではなく harness なのか

`storybook dev` 自体は **起動でき、story も描画できる**（2026-10-31 に実測: `pnpm exec storybook dev --port 6013` → index 200、`iframe.html?id=<story id>` が story の本文を描画。起動時に `Missing required secrets for Worker "my-web-2026"` と表示されるが、これは `@cloudflare/vite-plugin` が出す警告であって dev server の起動を止めない）。この repository は既に `pnpm run a11y:axe-storybook:ci` で Storybook dev 上の story に axe をかけている。

一方で **`pnpm run build-storybook` はこの repository では manager-only の静的ビルドになる**（`@storybook/react-vite` builder がプロジェクトの `vite.config.ts` を merge し、Cloudflare / TanStack Start plugin が preview の出力先を取る。出力に `iframe.html` が無く `sb-manager/` しか残らない — 2026-10-31 に再実測）。同じ事実を `scripts/capture-error-state-gallery.mjs`（#501）と `scripts/capture-a11y-table-code.mjs`（#407）が記録している。

capture は長-lived な dev server に依存しないため `.tmp/` に Vite harness を生成し、**shipped story module を直接 import** して、その story の `render:` が返すツリーを描画する。この story は `component` + `args` ではなく `render:` を宣言しているため、harness は「同等の component/args の組」ではなく **story が返す render 出力そのもの** を描画する。harness が描くものは「Copied した preview」ではなく「shipping されている preview そのもの」なので、capture と Storybook surface は乖離しない。

### なぜ WebP なのか

本リポジトリの `docs/verification/**` 配下は WebP が慣習であり、script は `.webp` 以外の出力先を拒否する（`assertWebpOutputPath`）。PNG のままだと本文稠密な画面に対して検証 artefact として大きすぎる。

## 2. 画面が示しているもの

画像は採否記録の preview そのものを全ページ撮影したものである。

1. **document title** — `スイスデザイン・タイポグラフィ・グリッドの採否記録`。
2. **document metadata** — status / source / verification / preview の 4 項目。
3. **8 つの section** — 見出しは `TYPOGRAPHY_GRID_CHOICES.sections[].heading` と一致する（§3 の gate が集合と順序を固定する）。
4. **各 section の lead 段落** — 記録の `##` 直後の段落。
5. **25 個の sub-heading** — `###` 見出し。
6. **108 個の箇条書き** — 採否・理由・根拠・解除条件・具体例・反例を含む、記録の箇条書きそのもの。

## 3. 機械で検証した項目

撮影は「asset を作る」だけに留まらず、**描画された DOM を preview データと突き合わせる**。capture が失敗する条件は以下（1 つでも違反すると非 0 で終了し、artefact も書かれない）。

| 項目 | 判定 |
| --- | --- |
| document title | 描画された `<h1>` が `TYPOGRAPHY_GRID_CHOICES.document.title` と一致 |
| document metadata | 描画されたヘッダの 4 項目が status / source / verification / preview と一致 |
| section 集合 | 描画された `<section>` の数と、見出しの集合・順序が preview データの `heading` と一致 |
| section lead | 各 section の段落が preview データの `lead` と一致 |
| sub-heading | 各 section の `<h3>` の集合と順序が preview データの block heading と一致 |
| 箇条書き | 各 section の `<li>` が preview データの `bullets` と 1 文字ずつ一致（label を持つ bullet は「ラベル: 本文」の形に組み立て直したうえで比較する） |
| 横スクロール | `scrollWidth <= clientWidth`（WCAG 2.2 SC 1.4.10 Reflow）。撮影幅 1440 で横スクロールは出ない |

判定関数 `verifyRenderedRecord()` は pure な関数で、観測結果（DOM）と期待値（preview データ）の差だけを failure として返す。差があれば capture は落ち、flattering な画像が残らない。

## 4. 本文との一致（parity gate）

本文 `docs/influences/typography-grid-swiss-design.md` と preview データ `src/personal/typography-grid-swiss/TypographyGridChoices.preview.ts` の一致は `scripts/check-typography-grid-choices-preview-parity.test.mjs` が検証する（`##` 見出し / `###` 見出し / 箇条書き / 段落 / metadata）。

本 capture はその parity gate の **別 half** である。parity gate は「本文と preview データが一致しているか」を見るが、**preview が実際に描画されているか**は見ていない。capture は描画された DOM を見る。

## 5. 再現手順

```bash
# 検証画像（.webp）を再生成する
node scripts/capture-typography-grid-choices.mjs
# → docs/verification/influences/typography-grid-choices.webp
# → .tmp/typography-grid-choices/report.json（観測値と判定）

# 本文と preview の一致を検証する
node --experimental-strip-types --test scripts/check-typography-grid-choices-preview-parity.test.mjs
```

capture script は `package.json` に登録していない（並列 PR の conflict を避けるため。`pnpm run` ではなく `node scripts/...` で実行する）。§7 の未決事項を参照。

## 6. 機械で検証していない項目（人手での判断）

- 記録の**文言**が正しいか、採否の判断が妥当か（機械的には「preview データがそのまま描画されている」ことしか確認していない）。
- 8 つの section の並びが**読み順**として自然か。
- typography / grid / Swiss design の 3 概念の区別が実質的な差として記録されているか。
- 比較画面（before / after と 2 つの反例）が、見た目の差として的確か。
- artifact の 900 px 幅の縮小が、レビュー時に読みやすさとして妥当か。

## 7. 残存の未決事項

- **`pnpm run knip:check` は green（141 findings / 141 baselined / 0 new）。** `knip.json` の entry には `scripts/*.test.mjs` が含まれるため、`scripts/capture-typography-grid-choices.test.mjs` が本 script を import する時点で本 script は unused 扱いにならない。`package.json` の scripts には登録していない（並列 PR との conflict を避けるため）。§5 の `node scripts/...` で実行できる。
- `src/personal/**` は新しい owner ディレクトリとして未登録（owner 登録は別 PR）。本 Issue の範囲は「記録の文書 + 単独 preview + 一致検証 + 検証画像」であり、owner 登録そのものは含めない。
- Miro の付箋本文は閲覧できないため、付箋内の詳細・時系列・数値・評価・軸の優先順位は本文側で「未確認（owner 確認待ち）」と明示してある。確認後に本文を書き換える場合、本文と preview の parity gate が落ちるため、preview データも同時に更新する必要がある。
