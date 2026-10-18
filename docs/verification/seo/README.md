# SEO / structured data verification

> Issue #422 / #418 / #421 の検証成果物と、その再現手順。
> 対象は schema.org の `Person` / `CreativeWork`、公開 route の `<head>`
> メタデータ、そして link unfurler へ公開する Open Graph / Twitter card。

## 何が検証されるのか

- `src/editorial/structured-data/contract.json` が route ごとの宣言
  （どの `@type` を出すか / 出さないならなぜ出さないか）。
- `src/editorial/structured-data/validate.ts` が、その宣言に対する
  違反だけを error として報告する。
- `test/integration/structured-data.test.ts` が、実 SSR HTML
  （`SELF.fetch` 経由の TanStack Start 出力）に対して宣言と一致するかを
  両方向で照合する。

**schema validity と Google Rich Results は別系統です。** 本レポートと
gate は、リポジトリが宣言した契約に違反しているかどうかだけを判定します。
Google の対応種別・表示要件・品質ルールは判定しておらず、「Rich Results
に対応している」とは主張しません。

## 再現手順

前提: Node 22.18 以上、pnpm 12.3.x。report のスクリーンショットを
再現する場合のみ Chromium が必要（`pnpm run e2e:install`）。

```bash
# 1. suite 自体（CI の validate と同じ実行）
pnpm exec vitest run structured-data

# 2. route coverage gate（validate:fast に組み込み済み）
pnpm run structured-data:check

# 3. このディレクトリのレポート画像と、その元になる HTML
pnpm run verify:structured-data-screenshot
```

## 期待結果

| 手順 | 期待 |
| --- | --- |
| `vitest run structured-data` | 5 files / 82 tests すべて green |
| `structured-data:check` | `8 public route(s) declared, 8 non-public route(s) out of scope` / exit 0 |
| `verify:structured-data-screenshot` | `.tmp/structured-data-report.html` と `structured-data-report.webp` を書き出す |

route ごとの期待値:

| route | 期待する `@type` |
| --- | --- |
| `/about` | `BreadcrumbList` + `Person` |
| `/portfolio/aulymo` | `BreadcrumbList` + `CreativeWork` |
| `/contact`, `/portfolio` | `BreadcrumbList` |
| `/`, `/tools`, `/tools/prototype`, `/design-system` | 出力なし（宣言済み "not implemented"） |
| `/admin/**` | 対象外（認証必須の内部 surface） |

出力されない（= 宣言されている）事实:

- `Person.award` / `education` / `alumniOf` / `hasCredential` /
  `jobTitle` / `affiliation` / `knowsAbout`
- `CreativeWork.keywords`
- `identity.role` の文字列（学校名 + 学年を含む表示用文字列）

理由は `contract.json#person.unapprovedProperties` に 1 行ずつ记录的。
承認済みの構造化レコード（期間・発行主体・取得日 …）が用意されたら、
宣言と test を同時に更新する。

## 画像

- `structured-data-report.webp` — Issue が要求する
  `docs/verification/seo/structured-data-report.png` の `.webp` 版。
  中間 PNG はディスクに書かず、メモリ上の Buffer を `sharp` で
  WebP に再エンコードしている（`scripts/make-seo-structured-data-report.mjs`）。
- レポート本文の Person / CreativeWork ノードは
  `test/integration/fixtures/structured-data-snapshot.json` から読む。
  同ファイルは integration suite が実 SSR HTML と `toEqual` で照合して
  いるため、画像は CI が検証していない document を描写し得ない。
## 画像

- `head-metadata-check.webp` — Issue #418 の `<head>` メタデータ gate。
  詳細は [`head-metadata-check.md`](head-metadata-check.md)。
- `ogp-preview.webp` — Issue #421 の Open Graph / Twitter card gate
  （代表 URL の card preview と missing media の fallback 行）。
  詳細は [`ogp-preview.md`](ogp-preview.md)。
- `sitemap-browser.webp` — sitemap / robots の検証。

## gate 一覧

| Issue | gate | 入口 |
| --- | --- | --- |
| #418 | 公開 route の title / description / canonical | `test/integration/seo-head.test.ts` / `pnpm run seo:head:check -- --live <url>` |
| #421 | Open Graph / Twitter card（missing media の fallback 含む） | `test/integration/ogp-card.test.ts` / `pnpm run ogp:card:check` |
| #422 | structured data（JSON-LD） | `test/integration/structured-data.test.ts` / `pnpm run structured-data:check` |
