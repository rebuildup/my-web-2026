# Markdown 書式の検証成果物（Issue #435）

`markdown-format-regression.webp` は Issue #435 が求めるスクリーンショットである。
source と実際の描画結果の左右比較と、判定表を 1 枚にまとめたもの。

Issue は `.png` のパスで指定しているが、**リポジトリに残すのは WebP**
（幅 1440、quality 80、264,692 bytes ≒ 258 KB）である。Playwright が書けるのは PNG だけなので、
`node scripts/markdown-format-report.mjs` が出力した HTML を Chromium で撮影し、
同じ `sharp`（devDependency）で WebP に再エンコードしている。内容は同一で、
`scripts/security-header-report.mjs` の扱いと同じ方針である。

## 画像の内容

1. **technical-article.md** — 対応構文と未対応構文が混在する記事 fixture。
   「数値・否定・権限の記述が 1 文字も書き換えられない」ことを、全行が
   Markdown marker を外した形で可視テキストに残る形で確認する。脚注 `[^1]`、
   pipe table、`$E = mc^2$`、`~~…~~`、`- [ ]` が文字として残っていることも
   同じ画面に写る。
2. **hostile.md** — `<script>` / `<img onerror>` / `<svg onload>` /
   `<iframe>` / `javascript:` / `data:` / `vbscript:` / `file:` の payload。
   raw HTML は markup として 1 つも現れず、inert なテキストとして画面に出る。
   危険 scheme の link は anchor にならず、理由と拒否 URL を持つ可視の
   `portfolio-md-link-blocked` marker として出る（Issue #451）。
3. **判定表** — fixture ごとに 5 項目（inert markup / href scheme /
   行の欠落なし / locale 属性なし / 文字の置換なし）の PASS/FAIL と計測値。

レンダリングは Vite SSR を通した**本番と同じ** `PortfolioMarkdown`、
スタイルは `panda cssgen` が出力する**本番と同じ** token である。secret は
一切含まれない（入力は repository 内の fixture だけ）。

## 再生成

```bash
node scripts/markdown-format-report.mjs        # → .tmp/markdown-format-report/report.html
pnpm run storybook                              # 実画面は portfolio/Markdown の 2 story

# 検証画像を本のパスへ取り直す
node scripts/markdown-format-report.mjs --capture
```

`--capture` は Chromium で全ページ撮影し、メモリ上で sharp に渡して WebP に
変換する（中間 PNG は書かない）。FAIL が混ざった判定表でも撮影は行う — この
成果物は測定の記録であり、将来の regression は diff に出るべきものだから。
render が inert でなかった場合だけ、script は非 0 で終了する。
生成される HTML は日本語なので `<html lang="ja">` であり、report 自身が locale を
推論しないことの証拠でもある。

## 検証そのものの入口

- `pnpm exec vitest run src/portfolio/markdown.safety.test.tsx`
- `node --test scripts/markdown-format-report.test.mjs`

契約の本文は [`docs/portfolio/markdown-format.md`](../../portfolio/markdown-format.md)。