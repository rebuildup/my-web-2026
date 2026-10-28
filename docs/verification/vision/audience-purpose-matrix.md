# 訪問者目的別の編集方針 — 表示プレビューの検証画像 (#516)

- 対象: `docs/vision/audience-purpose-separation.md`（編集方針の本文）と `src/personal/audience-purpose/`（preview データ + Storybook story）
- Issue: #516（`docs(vision): 就活・差別化・需要・ネット集客の目的を分けて整理`）
- 成果物: `docs/verification/vision/audience-purpose-matrix.webp`
- 状態: **本 Issue で実装・検証済み**。残る未決事項は §5 に列挙

## 1. 何を撮ったか（条件・対象範囲）

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/personal/audience-purpose/AudiencePurposeMatrix.stories.tsx` の `personal/audience-purpose / Preview`（shipped story の component を shipped story の args で描画） |
| capture 手段 | `node scripts/capture-audience-purpose-matrix.mjs`（`.tmp/` に Vite harness を生成 → loopback 配信 → Playwright Chromium → `sharp` で WebP 化） |
| 描画 CSS | リポジトリの Panda 設定（`postcss.config.mjs` → `panda.config.ts`）を harness の Vite build に渡したもの。すなわち実際の `src/styles.css` |
| viewport / DPR | 1440 x 900 / 2（`fullPage` 撮影） |
| 生成物サイズ | 1440 x 3741 px、**283 kB** WebP（quality 80、budget 300 kB） |
| 再現性 | **encode 段は決定的、ブラウザ撮影は byte 再現ではない**（プロセス間でも差が出る）。再生成は視覚的に同一であることを目標とする |
| 本番非破壊 | 既定で外部通信なし。local harness build と loopback 配信のみ。deploy / remote binding / secret 値の読み出しは無い |

Issue は `docs/verification/vision/audience-purpose-matrix.png` を指定しているが、本リポジトリの `docs/verification/**` 配下は **WebP** が慣習（既存の全 artefact が `.webp`）であり、PNG は本文稠密な画面に対して検証 artefact として大きすぎるため **`.webp`** を commit した。`scripts/capture-audience-purpose-matrix.mjs` は `.webp` 以外の出力先を拒否する。

### なぜ `storybook dev` ではなく harness なのか

`storybook dev` はこのリポジトリの story を配信できない。`.storybook/main.ts` はプロジェクトの `vite.config.ts` を merge し、その中の `@cloudflare/vite-plugin` が dev server を接管してから Worker の runtime secret を要求して起動に失敗する（実測: `Missing required secrets for Worker "my-web-2026"`）。同じ理由を `scripts/capture-error-state-gallery.mjs`（#501）と `scripts/capture-a11y-table-code.mjs`（#407）が記録している。

そのため capture は `.tmp/` に Vite harness を生成し、**shipped story module を直接 import** して、Storybook が同じ story を描画するのと同じ component + args の組をレンダリングする。harness が描くものは「Copied した preview」ではなく「shipping されている preview そのもの」なので、capture と Storybook surface は乖離しない。

## 2. 画面が示しているもの

画像は編集方針の preview そのものを全ページ撮影したものである。

1. **document title** — `訪問者目的別の編集方針（Issue #516）`。本文の `#` 見出しと同一の文字列。
2. **7 つの section** — 見出しは本文の `##` 見出しと 1 文字ずつ一致する（§4 の parity gate が両者の集合・順序を固定する）。
3. **表 1「目的軸ごとの主張の種別（可 / 条件付き / 不可）」** — §2 の表。行 = 主張の種別（誇示 / 事実 / 集客 / 採用）、列 = 目的軸（就活 / 差別化 / 需要 / ネット集客 / 自慢）。Miro の階層（哲学 > 見せたいものを作る > 就活 / 差別化 / 需要 / ネット集客 / 自慢）は **公開 copy ではなく編集用の軸** としてのみ使っている。
4. **表 2「3 つの導線が接続できる先と、そこに書いてよいこと」** — §4 の表。行 = 導線（実作品 / 履歴 / 問い合わせ）。接続先はこの repository に実在する公開 surface だけで、根拠の正本（`docs/personal/domain.md` / `src/contact/` の判定結果）を併記する。
5. **35 個の箇条書き** — 各 section の 実例 / 反例 / 判断根拠 / 主張種別 / 決定 / 採用 / 保留。保留の項目は必ず「未確認（owner 確認待ち）」と書いてある。

## 3. 機械で検証した項目

撮影は「asseet を作る」だけに留まらず、**描画された DOM を preview データと突き合わせる**。capture が fails する条件は以下。

| 項目 | 判定 |
| --- | --- |
| document title | 描画された `<h1>` が preview データの title と一致 |
| section 集合 | 描画された `<h2>` の集合と順序が preview データの `heading` と一致 |
| 表の数 | 描画された `<table>` が 2 個（preview データの matrix を持つ section の数）と一致 |
| 表の caption | 各表の `<caption>` が preview データの caption と一致 |
| 表の header / body | 各表の header 行と body 行が preview データの cell と 1 文字ずつ一致 |
| 箇条書き | 描画された `<li>` が preview データの points と 1 文字ずつ一致 |
| 横スクロール | `scrollWidth <= clientWidth`（WCAG 2.2 SC 1.4.10 Reflow）。撮影幅 1440 で横スクロールは出ない |

この検証は `scripts/capture-audience-purpose-matrix.test.mjs`（pure 関数に対する unit test）と capture 本体（実ブラウザでの観測）の 2 段構えである。

## 4. 本文との一致（parity gate）

本文 `docs/vision/audience-purpose-separation.md` と preview データ `src/personal/audience-purpose/AudiencePurposeMatrix.preview.ts` の一致は `scripts/check-audience-purpose-preview-parity.test.mjs` が検証する。

- `#` 見出しが一致する。
- `##` 見出しの集合と順序が一致する。
- 各 section の箇条書きが、文書側・preview 側で同じ行・同じ順序。
- 各 section の表が、文書側・preview 側で同じ caption / header / body。
- 各箇条書きは 実例 / 反例 / 判断根拠 / 主張種別 / 決定 / 採用 / 保留 のいずれかの label で始まる。
- **前書き（preamble）に箇条書きも表も無い**。つまり「片方にだけ存在する見出し / 事例」が構造として発生し得ない。

## 5. 再現手順

```bash
# 検証画像（.webp）を再生成する
node scripts/capture-audience-purpose-matrix.mjs
# → docs/verification/vision/audience-purpose-matrix.webp
# → .tmp/audience-purpose-matrix/report.json（観測値と判定）

# 本文と preview の一致を検証する
node --experimental-strip-types --test scripts/check-audience-purpose-preview-parity.test.mjs

# capture script の contract を検証する
node --experimental-strip-types --test scripts/capture-audience-purpose-matrix.test.mjs
```

capture script は `package.json` に登録していない（並列 PR の conflict を避けるため。`pnpm run` ではなく `node scripts/...` で実行する）。

## 6. 機械で検証していない項目（人手での判断）

- 表明の文言が **読みやすいか**、表の verdict 括弧書きが **正しい日本語か**（ mechanically には「preview と文書が一致している」ことしか確認していない）。
- 7 つの section の並びが **読み順として自然か**。
- 保留にした項目が **本当に保留でよいか**（owner 判断）。

## 7. 残存の未決事項

- `src/personal/**` は新しい owner ディレクトリとして未登録（owner 登録は別 PR）。本 Issue の範囲は「編集方針の文書 + 単独 preview + 一致検証」であり、owner 登録そのものは含めない。
- Miro の付箋本文は閲覧できないため、付箋内の詳細・時系列・数値・評価・軸の優先順位は本文側で「未確認（owner 確認待ち）」と明示してある。確認後に本文を書き換える場合、本文と preview の parity gate が落ちるため、preview データも同時に更新する必要がある。
