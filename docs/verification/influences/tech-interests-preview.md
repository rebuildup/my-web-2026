# 技術関心 inventory — 表示プレビューの検証画像 (#528)

- 対象: `docs/influences/tech-interests.md`（技術関心の記録）と `src/personal/tech-interests/`（preview データ + Storybook story）
- Issue: #528
- 成果物: `docs/verification/influences/tech-interests-preview.webp`
- 状態: **本 Issue で実装・検証済み**。残る未決事項は §7 に列挙

## 1. 何を撮ったか（条件・対象範囲）

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/personal/tech-interests/TechInterests.stories.tsx` の `Default` story（story 自身の `render:` が返すツリーをそのまま描画） |
| capture 手段 | `node scripts/capture-tech-interests.mjs`（`.tmp/` に Vite harness を生成 → loopback 配信 → Playwright Chromium → `sharp` で WebP 化） |
| 描画 CSS | リポジトリの Panda 設定（`postcss.config.mjs` → `panda.config.ts`）を harness の Vite build に渡したもの。すなわち実際の `src/styles.css` |
| viewport / DPR | 1440 x 900 / 1（`fullPage` 撮影。描画後のページ高は 12245 CSS px） |
| 生成物サイズ | 860 x 7313 px、**290 kB** WebP（quality 80、budget 300 kB） |
| 画的範囲 | **ページ全体**（切り抜きはしていない。§3 の gate は DOM 全体を見るので、画像の画素数と検証範囲は一致しない） |
| 再現性 | **encode 段は決定的、ブラウザ撮影は byte 再現ではない**（プロセス間でも差が出る）。再生成は視覚的に同一であることを目標とする |
| 本番非破壊 | 既定で外部通信なし。local harness build と loopback 配信のみ。deploy / remote binding / secret 値の読み出しは無い |

### なぜ 860 px 幅なのか（budget に対して）

1440 px の viewport でページ全体を描いて 1440 px 幅のまま WebP 化すると **budget を超える**（実測 900 px 幅で 312 kB、budget 300 kB）。budget は上げない。

- viewport を狭めても解決しない。content span は `Container`（`maxWidth: 1024px`）で上限を持つため、viewport を狭めても本文の幅は 1024 px のままで、**文書は長くなる**。WebP の size は本文の画素数でほぼ決まるので、狭い viewport は容量の節約にならない。
- そこで **画像の画素数を絞る** 方を選んだ。1440 px viewport で描いた full-page PNG を 860 px 幅へ downsample して符号化すると、**画面の全体**が 290 kB に収まる（本文の 16 px は約 9.5 px になる。viewer で拡大すれば読める）。

つまり「画面を一部だけ撮る」のではなく「**画面全体を、budget に収まる倍率で**撮る」選択である。assertion（§3）は画像の画素数に依らず DOM 全体を見るので、文書の途中が欠けていても capture は落ちる。

### なぜ `storybook dev` ではなく harness なのか

`storybook dev` 自体は **起動でき、story も描画できる**（2026-10-31 に実測: `pnpm exec storybook dev --port 6013` → index 200、`iframe.html?id=<story id>` が story の本文を描画。起動時に `Missing required secrets for Worker "my-web-2026"` と表示されるが、これは `@cloudflare/vite-plugin` が出す警告であって dev server の起動を止めない）。この repository は既に `pnpm run a11y:axe-storybook:ci` で Storybook dev 上の story に axe をかけている。

一方で **`pnpm run build-storybook` はこの repository では manager-only の静的ビルドになる**（`@storybook/react-vite` builder がプロジェクトの `vite.config.ts` を merge し、Cloudflare / TanStack Start plugin が preview の出力先を取る。出力に `iframe.html` が無く `sb-manager/` しか残らない — 2026-10-31 に再実測）。同じ事実を `scripts/capture-error-state-gallery.mjs`（#501）と `scripts/capture-a11y-table-code.mjs`（#407）が記録している。

capture は長-lived な dev server に依存しないため `.tmp/` に Vite harness を生成し、**shipped story module を直接 import** して、その story の `render:` が返すツリーを描画する。この story は `component` + `args` ではなく `render:` を宣言しているため、harness は「同等の component/args の組」ではなく **story が返す render 出力そのもの** を描画する。harness が描くものは「Copied した preview」ではなく「shipping されている preview そのもの」なので、capture と Storybook surface は乖離しない。

### なぜ WebP なのか

本リポジトリの `docs/verification/**` 配下は WebP が慣習であり、script は `.webp` 以外の出力先を拒否する（`assertWebpOutputPath`）。PNG のままだと本文稠密な画面に対して検証 artefact として大きすぎる。300 kB は repository 全体の evidence image budget（`scripts/_lazy-media-image.mjs`）でもある。

## 2. 画面が示しているもの

画像は技術関心 inventory の preview そのものを全ページ撮影したものである。

1. **document title** — `技術関心 inventory`。
2. **状態の定義** — 4 状態の凡例（`現在使用` / `制作で使った` / `試した` / `好き / 関心`）。
3. **現在の推奨（20 件）** — `CURRENT_RECOMMENDATIONS` から導出した一覧。
4. **10 個の section** — 見出しは `TECH_INTEREST_SECTIONS[].heading` と一致する（§3 の gate が集合と順序を固定する）。
5. **各 section の summary** — 記録の `##` 直後の段落。
6. **各 section の point** — 記録の箇条書きそのもの。
7. **35 件の entry card（section 側）** — 名前、状態ラベル、カテゴリラベル、観測日、根拠、備考。
8. **保留（置き換わった観察 2 件）** — `SUPERSEDED_OBSERVATIONS` と、それを置き換えた観察。

`現在使用` の 20 件は §3 の `現在の推奨` 一覧にも同じ形で並ぶため、画面に現れる entry card は section 側 35 件 + current 側 20 件 + held 側 2 件 = 57 枚になる。これは重複であって欠落ではない（現在の推奨は「置き換わっていない `現在使用` の観察」というデータから導出された別の一覧である）。

## 3. 機械で検証した項目

撮影は「asset を作る」だけに留まらず、**描画された DOM を preview データと突き合わせる**。capture が失敗する条件は以下（1 つでも違反すると非 0 で終了し、artefact も書かれない。検証に失敗した実行は既存の artefact も削除する）。

| 項目 | 判定 |
| --- | --- |
| document title | 描画された `<h1>` が `技術関心 inventory` と一致 |
| section 集合 | 描画された section 数と、見出しの集合が preview データの `heading` と一致（10 個） |
| section summary | 各 section の summary 段落が preview データの `summary` と一致 |
| section point | 各 section の `<li>` に preview データの `points` がすべて含まれる |
| entry | 各 section の entry が `name` / 状態ラベル `INTEREST_STATE_LABELS[state]` / カテゴリラベル `INTEREST_CATEGORY_LABELS[category]` / 観測日 `observedOn` を描画している |
| entry の過不足 | section に preview データにない entry が混ざっていない |
| 現在の推奨 | 見出しが `現在の推奨（20 件）`、render された entry 数が `CURRENT_RECOMMENDATIONS.length` と一致、各 entry の名前・状態ラベル・観測日が一致 |
| 保留 | 見出しが `保留（置き換わった観察 2 件）`、render された entry 数が `SUPERSEDED_OBSERVATIONS.length` と一致、各 entry の名前・観測日が一致 |
| 置き換わった観察の隔離 | 保留の entry が `現在の推奨` 側に現れない（`Wrangler` / `@cloudflare/vite-plugin 1.x` が current に出ない） |
| inventory 全体 | `TECH_INTEREST_ENTRIES` の全 35 件が、いずれかの section に名前・状態ラベル・観測日つきで render されている |
| 横スクロール | `scrollWidth <= clientWidth`（WCAG 2.2 SC 1.4.10 Reflow）。撮影幅 1440 で横スクロールは出ない |

判定関数 `verifyRenderedPreview()` は pure な関数で、観測結果（DOM）と期待値（preview データ）の差だけを failure として返す。差があれば capture は落ち、flattering な画像が残らない。

## 4. 本文との一致（parity gate）

本文 `docs/influences/tech-interests.md` と preview データ `src/personal/tech-interests/TechInterests.preview.ts` の一致は `scripts/check-tech-interests-preview-parity.test.mjs` が検証する。

本 capture はその parity gate の **別 half** である。parity gate は「本文と preview データが一致しているか」を見るが、**preview が実際に描画されているか**は見ていない。capture は描画された DOM を見る。

## 5. 再現手順

```bash
# 検証画像（.webp）を再生成する
node scripts/capture-tech-interests.mjs
# → docs/verification/influences/tech-interests-preview.webp
# → .tmp/tech-interests/report.json（観測値と判定）

# 本文と preview の一致を検証する
node --experimental-strip-types --test scripts/check-tech-interests-preview-parity.test.mjs
```

capture script は `package.json` に登録していない（並列 PR の conflict を避けるため。`pnpm run` ではなく `node scripts/...` で実行する）。§7 の未決事項を参照。

## 6. 機械で検証していない項目（人手での判断）

- 記録の**文言**が正しいか、状態の判定が妥当か（機械的には「preview データがそのまま描画されている」ことしか確認していない）。
- 10 個の section の並びが**読み順**として自然か。
- 4 状態の定義が、実際の関心と合っているか。
- `現在の推奨` に含まれる 20 件が、記録上の「いま使っている」と称してよいか。
- artifact の 860 px 幅の縮小が、レビュー時に読みやすさとして妥当か。

## 7. 残存の未決事項

- **`pnpm run knip:check` は green（141 findings / 141 baselined / 0 new）。** `knip.json` の entry には `scripts/*.test.mjs` が含まれるため、`scripts/capture-tech-interests.test.mjs` が本 script を import する時点で本 script は unused 扱いにならない。`package.json` の scripts には登録していない（並列 PR との conflict を避けるため）。§5 の `node scripts/...` で実行できる。
- 本 capture は `src/personal/**` を **preview データと story の置き場所**として使う前提で書かれている。`src/personal/**` の owner 登録は別 PR の課題であり、本 Issue の範囲外。
- Miro の付箋本文は閲覧できないため、付箋内の詳細・時系列・数値・評価・軸の優先順位は本文側で「未確認（owner 確認待ち）」と明示してある。確認後に本文を書き換える場合、本文と preview の parity gate が落ちるため、preview データも同時に更新する必要がある。
