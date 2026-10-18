# Verification artifacts

Each file here is the **record of one verification run**, not a
substitute for it. The suite named in each report is the authority:
re-run it and the artifact is regenerated, and if the artifact and the
suite disagree, the suite wins.

## `location-private-fallback.webp`

Issue #511 — owner-unapproved location / schedule data must not reach
public SSR HTML, `/api/v1/*` JSON, or the GA4 analytics payload, and
the surface must still show something when the data is private.

- **判定基準**

  | 対象 | 基準 |
  | --- | --- |
  | 公開SSR HTML | owner未承認のフィールド名・座標ペア・`geo:` URI が含まれない |
  | 公開 JSON | `/api/v1/*` の 200 / 401 レスポンスに同じ語彙が含まれない |
  | Analytics | GA4 bootstrap は measurement ID のみ、`page_view` は `page_path` 系のみ |
  | 公開用代替表示 | 非公開でも surface は空にならない（Home は Activity を `planned` として提示し続ける） |
  | 非空虚性 | 検出器が fixture に対して実際に発火する |

- **実行手順**

  ```bash
  pnpm exec vitest run test/integration/privacy-projection.test.ts
  ```

- **画像について**

  CI レポート形式のレンダリング結果。dev サーバーは Infisical の
  secret に依存するため、このリポジトリの作業環境からは実画面を
  起動できない。画像は補助資料であり、判定は CI の `validate` job
  が担う。

- **対象外**

  `/about` / `/portfolio` の HTML（loader が portfolio D1 schema を
  要求し、対象 suite は reactions のみ bootstrap するため 500）、
  publication 設定の実装（owner 決定が必要）、多言語表示。