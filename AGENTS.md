# AGENTS.md — my-web-2026 root agent contract

This file is the **always-on** root contract for AI agents working on
my-web-2026. It contains only the invariants that apply on every
session. Domain-specific workflows are in `skills/<skill>/SKILL.md`.

> Read this file once per session. Read individual Skills only when
> the task actually requires them (progressive disclosure).

## 1. Project identity

- my-web-2026 replaces my-web-2025 as the personal Web Platform.
- 0.1.0 Foundation release is targeted for 2026-09; full migration is
  targeted for 2026-10.
- Repository is a single Cloudflare Workers deployment, modular
  monolith architecture.
- Visibility: **public**. License: MIT. Canonical remote:
  `https://github.com/rebuildup/my-web-2026.git`.
- Source code, commit messages: **English**.
- Internal development docs, Issue / PR title and body, review
  discussion: **日本語**.
- Branch names are identifiers or release versions only — no prose.

## 2. Stack (do not invent alternatives without an ADR)

- Runtime / deployment: Cloudflare Workers (`@cloudflare/vite-plugin`,
  `wrangler`).
- Web framework: TanStack Start (`@tanstack/react-start` 1.168.x).
- External HTTP boundary: Hono (`hono` 4.13.x) at `/api/v1/*`,
  `/webhooks/*`, `/oauth/*`, `/integrations/*`.
- Internal application operations: TanStack Start server functions
  (`createServerFn`).
- Worker entry: `src/server.ts`. Default export `{ fetch(request, env,
  ctx) }` dispatches between Hono and the TanStack Start default
  handler based on path prefix. The default CSRF middleware is active
  because `src/start.ts` is intentionally absent — do not re-add it
  without an ADR.
- Styling: Panda CSS (`@pandacss/dev` 1.12.x). Tokens in
  `src/design-system/tokens.ts` (raw) + `src/design-system/
  semantic-tokens.ts` (semantic). **Tailwind CSS is forbidden.**
- Format / lint: Biome (`@biomejs/biome` 1.9.x). Replaces both
  Prettier and ESLint.
- Package manager: pnpm 12.3.x. **Bun is not the default.** Do not
  add Bun to scripts or CI.
- UI: React 19.2.x, Vite 7.1.x, TypeScript 5.9.x.
- Tests: Vitest 4.1.x + `@cloudflare/vitest-plugin` (workerd pool).

Verify all version-sensitive facts against current official docs.
This file is updated when the stack changes.

## 3. Architecture boundary (always enforce)

The split between TanStack Start and Hono is enforced in
`src/server.ts`. Do not bypass it.

- Hono handlers live under `src/http/**` (mounted by `src/server.ts`).
- Server functions live next to the route file that uses them, or under
  `src/modules/<capability>/server.ts`.
- Capability / domain / application code (`src/modules/**` and any
  feature-local file) must not import from `hono`, `@tanstack/
  react-start`, or any Cloudflare SDK.
- TanStack Start's **default CSRF middleware is the canonical CSRF
  protection**. Custom `startInstance` is forbidden — overriding it
  would disable the default middleware.

Frontend is **feature-oriented** (under `src/modules/<capability>/ui/`).
Backend is **capability-oriented** (`src/modules/<capability>/**`).
Do not create a flat `src/components/`, `src/hooks/`, `src/utils/`
mega-folder.

## 4. Cloudflare services policy

Only the resources declared in `wrangler.jsonc` exist. At 0.1.0 that
is:

- Static Assets binding (`ASSETS`).
- D1 binding (`DB`, placeholder database id — replace on first deploy).
- R2 binding (`MEDIA`, placeholder bucket — create on first deploy).

Every additional service (KV, Queues, Durable Objects, Workflows,
Vectorize, Workers AI) requires its own ticket and ADR entry, and
`pnpm run cf-typegen` after the binding change.

## 5. Quality gates

Three deterministic entry points defined in `quality/profile.yaml`:

- `pnpm run validate:fast` — local feedback. Read-only.
  (`format:check` + `lint:check` + `typecheck` + `test`)
- `pnpm run validate:integration` — ticket PR verification.
  (`validate:fast` + `build` + `wrangler:dry-run`)
- `pnpm run validate:release` — pre-`main` verification.
  (`validate:integration` + `cf-typegen`)

Local agent and GitHub Actions invoke the same entry points. Do not
hide validation logic inside workflow YAML. Coverage thresholds are
**not** enforced at 0.1.0; that decision is in ADR-0007.

## 6. Sprint workflow

- One sprint = one week = one target semantic version = one
  release branch `release-x-y-z`.
- Ticket branch is the Issue number only (`123`). No `issue/` prefix,
  no slug.
- 1 top-level Issue = 1 ticket branch = 1 ticket PR.
- Independent ticket PR base = `release-x-y-z`.
- Stacked dependent ticket PR base = immediate predecessor branch.
- All ticket branches start with: create branch → first meaningful
  commit → push to canonical remote → verify remote head SHA → open
  Draft PR → set linked Issue / assignee / reviewer / labels / target
  release / stack context.
- An active durable ticket branch without a Draft PR is a **bug**,
  not a normal state.
- `main` is the released source state. Only `release-x-y-z → main`
  PRs update `main` (and only when `main` protection / ruleset
  allows it).
- Stack landing: ticket Done = landed on target release trunk, not
  merely merged into an intermediate predecessor branch.
- See `skills/github-delivery/SKILL.md` for the full procedure.

## 7. Recovery

Native session resume is an optimisation. Canonical recovery is from
durable project state:

- GitHub Issue + Project (status, target release, dependencies).
- Ticket branch, remote head SHA, Draft / Ready PR.
- Stack predecessor identity + exact predecessor SHA when stacked.
- Repository-controlled design / ADR / Skills / docs.
- Immutable worker / subagent results.

Active durable ticket branches must always have a published remote
head + Draft PR. Release branches are the only exception, and only
while they are zero-diff against `main`. See
`skills/agent-recovery/SKILL.md`.

## 8. Decision precedence

For any judgement call, follow:

1. project-wide policy / canonical architecture / this `AGENTS.md`
2. design / specification / explicit task instruction
3. coherent existing implementation
4. current official framework / runtime / SDK guidance
5. established ecosystem convention
6. local best judgment

Do not escalate a question whose answer is uniquely determined by the
precedence. Do escalate when the call affects product semantics,
public contracts, security, privacy, cost, release scope, or
external contracts.

## 9. Localised project state

- `.tmp/` — ephemeral verification artefacts. Gitignored.
- `.reference/` — external reference clones. Gitignored. Use
  `git clone <url> .reference/<name>` for short-lived research.
- `Containerfile` — when a custom container definition is added.
  Foundation release does not need one.

## 10. Available skills (progressive disclosure)

Read a Skill only when the task actually requires it.

### Sprint / delivery
- `skills/github-delivery/SKILL.md` — Issue / PR / release sprint
- `skills/parallel-orchestration/SKILL.md` — multi-agent / stacked PR
- `skills/onboarding/SKILL.md` — fresh contributor / fresh agent

### Quality / evaluation
- `skills/quality-gate/SKILL.md` — quality profile + change-risk
- `skills/policy-evaluation/SKILL.md` — policy / Skill change evaluation
- `skills/security-maintenance/SKILL.md` — framework advisory workflow

### Engineering / design
- `skills/engineering-decisions/SKILL.md` — decision precedence
- `skills/design-refinement/SKILL.md` — pre-implementation design refinement

### Runtime / recovery
- `skills/sandbox-runtime/SKILL.md` — per-worker isolated runtime
- `skills/worktree-workflow/SKILL.md` — Worktrunk / git worktree mechanics
- `skills/agent-recovery/SKILL.md` — durable recovery

### Communication
- `skills/writing-discipline/SKILL.md` — reader-facing prose pipeline
- `skills/interaction-discipline/SKILL.md` — active-work interaction discipline

### Design (general-purpose)

Web fundamentals / design-layout / animation-interaction の汎用 Skills。
Vendor-specific design system / media production 系は含まない
(`design-skills` upstream 47 件から 25 件選抜、 release-0-3-0)。

- `skills/design-intent/SKILL.md` — DESIGN-BRIEF 起点の design direction
- `skills/color-system/SKILL.md` — semantic color roles, light/dark
- `skills/typesetting/SKILL.md` — text rhythm, mixed-script, hierarchy
- `skills/layout-system/SKILL.md` — Marketing / Dashboard / Application / Swiss
- `skills/responsive-design/SKILL.md` — fluid / container query / breakpoint
- `skills/interaction-states/SKILL.md` — hover / focus / pressed / loading 等 state
- `skills/navigation-design/SKILL.md` — navigation model 選定
- `skills/iconography-system/SKILL.md` — icon family 設計
- `skills/motion-system/SKILL.md` — Marketing / Product UI / Navigation motion
- `skills/motion-audit/SKILL.md` — 既存 UI の motion 調査
- `skills/motion-implement/SKILL.md` — motion 実装
- `skills/motion-review/SKILL.md` — motion review
- `skills/token-audit/SKILL.md` — Panda CSS semantic-tokens 監査
- `skills/document-design/SKILL.md` — long-form paginated docs
- `skills/diagram-design/SKILL.md` — architecture / process diagram
- `skills/dark-mode-design/SKILL.md` — dark appearance 設計
- `skills/content-design/SKILL.md` — product / service content
- `skills/form-design/SKILL.md` — form flow 設計
- `skills/table-design/SKILL.md` — table / data grid
- `skills/accessibility-audit/SKILL.md` — accessibility 監査・修正
- `skills/cognitive-accessibility/SKILL.md` — 認知・学習障害への design
- `skills/inclusive-design/SKILL.md` — exclusion 検出 + 多様な参加経路
- `skills/high-contrast-design/SKILL.md` — high-contrast / forced-colors
- `skills/touch-interface/SKILL.md` — touch / coarse-pointer interaction
- `skills/keyboard-interface/SKILL.md` — keyboard interaction model

Architecture docs (`docs/architecture.md`), development docs
(`docs/development.md`), and release docs (`docs/release.md`) are the
canonical entry points for human contributors.

## 11. Out-of-scope at 0.1.0 (do not start)

- Product feature work (portfolio, content, activity, etc.)
- Tools submodule integration
- Webhook platform (beyond the `/webhooks/*` boundary contract)
- Personal Dashboard
- Multiple Workers / microservice split
- Coverage thresholds
- ESLint / Oxlint (Biome is sufficient at 0.1.0)

These are 0.2.0 / 0.3.0 work. The 0.1.0 goal is the foundation
release, not the feature release.
