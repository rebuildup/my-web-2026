# Project introduction verification

Issue #621 — `/projects/dotfiles` は `rebuildup/dotfiles` の公開 README を
offline snapshot から表示する。このディレクトリの画像は、その表示が
「現在の snapshot」として何を出し、何を出さないかを記録したものである。
判定の authority は画像ではなく、以下の suite / gate である。

## 判定基準

| 対象 | 基準 |
| --- | --- |
| snapshot の来歴 | `source.commitSha` / `source.readmeBlobSha` が 40 hex、README URL が commit に固定され、`contentDigest` が introduction と一致する（`pnpm run projects:check`） |
| allowlist | 同期が読む URL は repository metadata / default-branch commit / `README.md` の 3 つだけ。submodule・Infisical 値・machine-local config は読まない（[`scripts/_project-introduction.mjs`](../../../scripts/_project-introduction.mjs) の `PROJECT_SOURCES` / `allowedRequestUrls`） |
| 表示 | authored な boundary と README の 5 section（設計原則 / リポジトリ構成 / エージェントランチャー / エージェント設定の固定 / 設計判断と調査）が出る。README は text + link のみで、raw Markdown / HTML は出ない |
| 状態 | `current` / `stale` / `unavailable` / `unknown` を区別し、stale / unavailable は「最新ではない」と明示する。snapshot が無い場合は内容を捏造しない |
| provenance | page 上に README commit（公開 README が最後に変わった commit）、README blob、最終確認時刻、適用時刻が出る |
| 公開境界 | `<script>` / `javascript:` / `.gitconfig` / 生の secret 名が配信 HTML に現れない |
| レイアウト | 390 px 幅で横スクロールしない |

## 実行手順

```bash
pnpm run projects:check
pnpm exec vitest run test/integration/projects-dotfiles.test.ts
pnpm exec playwright test e2e/projects-dotfiles.spec.ts e2e/seo-status.spec.ts
```

## 画像

| file | viewport | 内容 |
| --- | --- | --- |
| `dotfiles-introduction-desktop.webp` | 1440 × 1000 | hero、boundary、README 5 section、provenance |
| `dotfiles-introduction-mobile.webp` | 390 × 844 | 同じ内容の phone 幅。横スクロールなし |

`pnpm run build` の後 `pnpm exec vite preview --port 4173` を起動し、
Chromium で `/projects/dotfiles` を full-page 撮影、WebP quality 80 に
変換した。どちらも 300 KB 以下。画像は補助資料であり、内容の一致は
上の integration test が検証する。
