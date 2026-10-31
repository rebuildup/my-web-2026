# 作りながら成長する — コンテンツ仕様の表示プレビュー検証画像 (#513)

- 対象: `docs/personal/growth-through-making.md`（仕様書の正本）と `src/routes/design-system/sections/`（preview データ + Storybook story）
- Issue: #513（`docs(vision): 作りながら成長する — 成長を作品と試行錯誤に紐づけるコンテンツ仕様`）
- 成果物: `docs/verification/vision/growth-case-study-preview.webp`
- 状態: **本 Issue で実装・検証済み**。残る未決事項は §7 に列挙

## 1. 何を撮ったか（条件・対象範囲）

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/routes/design-system/sections/GrowthThroughMaking.stories.tsx` の `Default` story（story 自身の `render()` 出力を描画） |
| capture 手段 | `node scripts/capture-growth-through-making.mjs`（`.tmp/` に Vite harness を生成 → loopback 配信 → Playwright Chromium → `sharp` で WebP 化） |
| 描画 CSS | リポジトリの Panda 設定（`postcss.config.mjs` → `panda.config.ts`）を harness の Vite build に渡したもの。すなわち実際の `src/styles.css` |
| viewport / DPR | 1440 x 900 / 1（`fullPage` 撮影） |
| 成果物サイズ | 960 x 4225 px、**258 kB** WebP（quality 80 / effort 6、budget 300 kB） |
| 再現性 | **encode 段は決定的、ブラウザ撮影は byte 再現ではない**（プロセス間でも差が出る）。再生成は視覚的に同一であることを目標とする |
| 本番非破壊 | 既定で外部通信なし。local harness build と loopback 配信のみ。deploy / remote binding / secret 値の読み出しは無い |

### なぜ `storybook dev` ではなく harness なのか

`storybook dev` 自体は **起動でき、story も描画できる**（2026-10-31 に実測: `pnpm exec storybook dev --port 6013` → index 200、`iframe.html?id=<story id>` が story の本文を描画。起動時に `Missing required secrets for Worker "my-web-2026"` と表示されるが、これは `@cloudflare/vite-plugin` が出す警告であって dev server の起動を止めない）。この repository は既に `pnpm run a11y:axe-storybook:ci` で Storybook dev 上の story に axe をかけている。

一方で **`pnpm run build-storybook` はこの repository では manager-only の静的ビルドになる**（`@storybook/react-vite` builder がプロジェクトの `vite.config.ts` を merge し、Cloudflare / TanStack Start plugin が preview の出力先を取る。出力に `iframe.html` が無く `sb-manager/` しか残らない — 2026-10-31 に再実測）。同じ事実を `scripts/capture-error-state-gallery.mjs`（#501）と `scripts/capture-a11y-table-code.mjs`（#407）が記録している。

capture は長-lived な dev server に依存しないため `.tmp/` に Vite harness を生成し、**shipped story module を直接 import** して、その story が持つ `render()` 出力をレンダリングする。harness が描くものは「Copied した preview」ではなく「shipping されている preview そのもの」なので、capture と Storybook surface は乖離しない。

### なぜ 960 px で encode したのか（budget を上げない判断）

本仕様書は長い。全ページ撮影は 1440 px 幅で高さ 6337 px になり、1440 px のまま WebP 化すると **約 480 kB** で、300 kB の budget を超える。budget は上げない前提なので、**三角形を切るのではなく写す量を減らす**方を選んだ。

- 採用: 全ページ（9 section すべて）を 1440 px で撮影し、960 px に縮尺して encode する（258 kB）。
- 不採用: 上半分だけ native 解像度で撮る（可読性は高いが、画面の半分しか写らない）。

_document title / section 見出し / sub-heading / 箇条書きの検証は encode 後の絵ではなく**描画された DOM** に対して行うため、縮尺しても検証の強度が変わらない。_

## 2. 画面が示しているもの

画像はコンテンツ仕様の preview そのものを全ページ撮影したものである。

1. **document title** — `作りながら成長する — 成長を作品と試行錯誤に紐づけるコンテンツ仕様`。
2. **document metadata 4 件** — `Canonical growth-content specification` / 典拠 / 機械検証 / プレビューのパス。いずれも preview データ module の `document` が持つ文字列。
3. **9 つの section** — 見出しは `GROWTH_THROUGH_MAKING.sections[].heading`（仕様書の `##` 見出し）と一致する。
4. **19 個の sub-heading** — `heading` を持つ block（20 block のうち第 1 section の 1 block だけが `heading` を持たない）の `###` 見出し。
5. **9 個の lead 段落** — 各 section の 1 段落。
6. **76 個の箇条書き** — すべての block の bullet。`case` / `held` の block は `before:` / `after:` / `学び:` / `理由:` などのラベルを本文と分けて表示する。

## 3. 機械で検証した項目

撮影は「asset を作る」だけに留まらず、**描画された DOM を preview データと突き合わせる**。capture が fail する条件は以下（1 つでも欠ければ非 zero で終了する）。

| 項目 | 判定 |
| --- | --- |
| document title | 描画された `<h1>` が preview データの `document.title` と一致 |
| document metadata | header の 4 項目（status / source / verification / preview）が preview データと 1 文字ずつ一致 |
| section 集合 | 描画された `<h2>` の集合と順序が preview データの `heading` と一致 |
| sub-heading 集合 | 描画された `<h3>` の集合と順序が preview データの block `heading` と一致 |
| lead 段落 | 描画された section の `<p>` が preview データの `lead` と 1 文字ずつ一致 |
| 箇条書き | 描画された `<li>` が preview データの bullet と 1 文字ずつ一致（欠けた項目は名指しで報告する） |
| 横スクロール | `scrollWidth <= clientWidth`（WCAG 2.2 SC 1.4.10 Reflow）。撮影幅 1440 で横スクロールは出ない |
| 出力形式 | `.webp` 以外の出力先・repository 外への出力は拒否する |
| 成果物サイズ | 300 kB を超える成果物は fail（budget は上げない） |

## 4. 本文との一致（parity gate）

本文 `docs/personal/growth-through-making.md` と preview データ `src/routes/design-system/sections/GrowthThroughMaking.preview.ts` の一致は `scripts/check-growth-through-making-preview-parity.test.mjs` が検証する（`pnpm run test` が `scripts/*.test.mjs` を discovery する）。

- `##` 見出し / `###` 見出し / 箇条書きの項目 / 段落が preview データと一致する。
- 片側にしか存在しない見出しや事例は fail する（差分は「保留」として Markdown に明記してから直す運用）。

capture はこの parity gate の**別**の検証である。parity gate は「Markdown と preview データが一致しているか」を見るのに対し、capture は「**preview が実際にその文字列を描画しているか**」を見る。片方だけでは「preview が空でも通る」gap を塞ぐ。

## 5. 再現手順

```bash
# 検証画像（.webp）を再生成する
node scripts/capture-growth-through-making.mjs
# → docs/verification/vision/growth-case-study-preview.webp
# → .tmp/growth-through-making/report.json（観測値と判定）

# 本文と preview の一致を検証する
node --experimental-strip-types --test scripts/check-growth-through-making-preview-parity.test.mjs
```

capture script は `package.json` に登録していない（`pnpm run` ではなく `node scripts/...` で実行する）。option は `--screenshot=` / `--json-out=` / `--width=` / `--height=` / `--no-build` / `--no-capture`。

## 6. 機械で検証していない項目（人手での判断）

- 仕様の文言が **読みやすいか**、禁止事項の言い回しが **正しい日本語か**（mechanically には「preview と文書が一致している」ことしか確認していない）。
- 9 つの section の並びが **読み順として自然か**。
- 採用 / 保留の判断が **妥当か**（owner 判断）。

## 7. 残存の未決事項

- 仕様の「未確認（owner 確認待ち）」項目（Miro の付箋の全文、公開 surface への割り当て、非公開編集メモの保存先、代替指標）は owner の判断待ちであり、capture はその状態を「未確認として記録している」ことしか検証しない。
- 検証画像は 960 px に縮尺されている。native 解像度版が要るなら budget の判断を再検討する必要があるが、本 Issue では budget を抬高していない。
