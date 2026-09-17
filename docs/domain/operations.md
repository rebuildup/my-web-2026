# Operations

> Status: **Draft** — owner 自身が本文を埋めるまで Draft のまま
> Visibility: public (MIT)

operational truth。 sprint / release / quality gates / merge gates などの運用事実を 1 か所に集約する (現状 AGENTS.md §5, §6 に分散している事実の再配置)。

## Sprint

- 1 sprint = 1 週間
- 1 sprint = 1 target semantic version
- 1 sprint = 1 release branch (`release-x-y-z`)

## Ticket

- 1 top-level Issue = 1 ticket branch = 1 ticket PR
- ticket branch name は Issue number のみ (例: `23`, `42`)。 `issue/` prefix / slug 不可
- ticket PR の base:
  - 独立 ticket: `release-x-y-z`
  - stacked dependent ticket: immediate predecessor branch
- active durable ticket branch は必ず published remote head + Draft PR を持つ
- release branch のみ例外 (zero-diff against main の間)

## Release

- `release-x-y-z → main` PR のみが `main` を更新する
- release PR merge / tag push / GitHub Release 公開は **owner の明示的承認なしに実行しない** (Release PR merge human gate)
- "CI が green" / "release-ready" / 事前承認された計画は merge 承認を構成しない

## Quality gates

3 段階:

- `pnpm run validate:fast` — local feedback (read-only)
- `pnpm run validate:integration` — ticket PR 検証
- `pnpm run validate:release` — pre-main 検証

local agent と GitHub Actions は同じ entry point を使う。

## Branch protection

- main: ruleset による保護
- release branches: zero-diff against main の間のみ active

## Notes

> TODO — owner が追加する運用ルール、 incident response、 on-call 体制 (single-person operation の場合は不要)、 release cadence の例外
