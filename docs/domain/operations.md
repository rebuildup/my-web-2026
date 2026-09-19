# Operations

> Status: **Canonical operational truth**
> Visibility: public (MIT)

この文書は sprint / ticket / release / quality gate の運用事実をまとめる。詳細な操作手順は Skills に置き、ここでは長期的な invariant を記録する。

## Operating model

my-web-2026 は owner-operated repository である。

human contributor や agent が作業しても、durable state は会話ではなく GitHub Issue / PR / branch / repository-controlled docs に残す。

## Sprint

基本単位:

- 1 sprint = 1 week
- 1 sprint = 1 target semantic version
- 1 sprint = 1 release branch

release branch は `release-x-y-z` 形式とする。

## Ticket

canonical flow:

- 1 top-level Issue = 1 ticket branch = 1 ticket PR
- ticket branch name は Issue number のみ
- independent ticket PR の base は target release branch
- stacked ticket PR の base は immediate predecessor branch
- durable な active ticket branch は remote head と Draft PR を持つ

会話や local worktree だけに進捗を残さない。

## Main / release boundary

`main` は released source state である。

`main` を更新する canonical path は `release-x-y-z -> main` PR のみ。release branch は sprint の integration line であり、個別 ticket はまず target release に landing する。

ticket が predecessor branch に merge されただけでは Done としない。target release trunk に到達して初めて landing とみなす。

## Release PR merge human gate

次の三操作は owner の **current interaction における明示的承認** が必要。

- release PR merge
- release tag push
- GitHub Release publication

次は approval ではない。

- CI is green
- release-ready 判定
- 以前の一般的な承認
- agent が作成した release plan
- automated review の approve

agent は readiness を報告するところまで進め、human gate を越えない。

## Quality gates

repository の deterministic entry point は三段階。

### `pnpm run validate:fast`

local feedback。format check / lint check / typecheck / repository script が定義する test を実行する。read-only validation として扱う。

### `pnpm run validate:integration`

ticket PR verification。`validate:fast` に加え、build、Wrangler dry-run、CI lint、Storybook build など repository contract 上の integration checks を実行する。

### `pnpm run validate:release`

pre-main verification。`validate:integration` に加え、Cloudflare type generation drift など release-specific contract を検証する。

local agent と GitHub Actions は同じ entry points を使い、workflow YAML に隠れた別ルールを作らない。

## Browser E2E

Playwright E2E は release / UI change に応じて CI で実行する。

E2E が別 entry point であることと、重要度が低いことは同義ではない。browser behavior を保証する obligation は、unit test で代替しない。

## Branch protection

`main` は public repository ruleset で保護する。

少なくとも direct push、force push、deletion を許可せず、PR と required checks を経由する。release source policy は CI と repository rules の両方で守る。

## Source of truth

判断が衝突した場合の優先順位:

1. project-wide policy / canonical architecture / `AGENTS.md`
2. design / specification / explicit task instruction
3. coherent existing implementation
4. current official framework / runtime / SDK guidance
5. established ecosystem convention
6. local best judgment

personal fact については [`../personal/owner.md`](../personal/owner.md) の publication / grounding rule を追加で適用する。

## Recovery

native session resume は便利だが canonical recovery ではない。

recovery source:

- GitHub Issue / Project state
- ticket branch / remote head SHA
- Draft / Ready PR
- stack predecessor
- repository-controlled ADR / docs / Skills
- immutable verification result

一時的な会話ログを project knowledge の唯一の source にしない。

## Incident / on-call

single-owner project のため、形式的な on-call rotation は持たない。

runtime failure や release blocker は、再現可能な evidence とともに Issue / ticket に落とし、implementation status と external blocker を分離して記録する。
