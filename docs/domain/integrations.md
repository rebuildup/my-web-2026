# Integrations

> Status: **Draft** — owner 自身が本文を埋めるまで Draft のまま
> Visibility: public (MIT)

外部サービスとの契約。 **観測されるまで top-level に昇格しない** (YAGNI on structure)。 capability-scoped のうちは capability 内部 (例: `writing/notion/`) に置く。

## Table

| ID | Service | Status | Capability owners | Promotion criteria | Notes |
| --- | --- | --- | --- | --- | --- |
| notion | Notion API | TODO | TODO | TODO | 1 capability のみ使用なら capability-scoped のまま |
| github | GitHub API | TODO | TODO | TODO | multi-capability 観測後に top-level 昇格可否を判断 |
| discord | Discord API | TODO | TODO | TODO | |
| stripe | Stripe API | TODO | TODO | TODO | |

## Status 列の規約

- `capability-scoped (writing)` — 単一 capability 内部に置かれている
- `promoted to top-level` — 複数 capability 観測後に昇格済み
- `demoted to capability-scoped (writing)` — 過去 top-level だったが降格
- TODO — 未確定

## Promotion criteria 列の規約

> **観測事実のみを昇格基準にする。 「将来複数で使うかも」は昇格理由にならない。**

観測する条件:

- 複数 capability が同じ service を呼ぶ
- 呼び出し interface が共通化が必要 (契約テストが必要)
- 外部 SLA / 認証が capability 内部で扱うには複雑

## Notes

> TODO — owner が各 integration について追加する注記、 認証方式、 rate limit、 過去 co-change 観測、 関連 ADR
