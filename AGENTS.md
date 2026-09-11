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
- Styling: Panda CSS (`@pandacss/dev` 1.12.x). **Tailwind CSS is
  forbidden.**
- Package manager: pnpm 12.3.x. **Bun is not the default.** Do not
  add Bun to scripts or CI.
- UI: React 19.3.x, Vite 7.3.x, TypeScript 5.9.x.
- Tests: Vitest 4.1.x.

Verify all version-sensitive facts against current official docs.
This file is updated when the stack changes.

## 3. Architecture boundary (always enforce)

The split between TanStack Start and Hono is enforced in
`src/start.ts`. Do not bypass it.

- Hono handlers must live under `src/boundary/**`.
- Server functions must live next to the route file that uses them
  (or under `src/domains/<name>/application/**`).
- Domain / application code (`src/domains/**`) must not import from
  `hono`, `@tanstack/react-start`, or any Cloudflare SDK.

Frontend is **feature-oriented** (`src/features/<name>/**`).
Backend is **domain-oriented** (`src/domains/<name>/**`). Do not
create a flat `src/components/`, `src/hooks/`, `src/utils/`
mega-folder.

## 4. Cloudflare services policy

Only the resources declared in `wrangler.jsonc` exist. At 0.1.0 that
is one Worker plus one Static Assets binding. Every additional
service (D1, R2, KV, Queues, Durable Objects, Workflows, Vectorize,
Workers AI) requires its own ticket and ADR entry, and `pnpm run
cf-typegen` after the binding change.

## 5. Quality gates

Three deterministic entry points defined in `quality/profile.yaml`:

- `pnpm run validate:fast` — local worker feedback.
- `pnpm run validate:integration` — ticket PR verification.
- `pnpm run validate:release` — pre-`main` verification.

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

- `skills/github-delivery/SKILL.md` — Issue / PR / release sprint
- `skills/quality-gate/SKILL.md` — quality profile + change-risk
- `skills/parallel-orchestration/SKILL.md` — multi-agent / stacked PR
- `skills/sandbox-runtime/SKILL.md` — per-worker isolated runtime
- `skills/engineering-decisions/SKILL.md` — decision precedence
- `skills/security-maintenance/SKILL.md` — framework advisory workflow
- `skills/onboarding/SKILL.md` — fresh contributor / fresh agent
- `skills/agent-recovery/SKILL.md` — durable recovery

Architecture docs (`docs/architecture.md`), development docs
(`docs/development.md`), and release docs (`docs/release.md`) are the
canonical entry points for human contributors.

## 11. Out-of-scope at 0.1.0 (do not start)

- Product feature work
- CMS / D1 / R2 schema
- Tools submodule integration
- Webhook platform
- Personal Dashboard
- Multiple Workers / microservice split

These are 0.2.0 / 0.3.0 work. The 0.1.0 goal is the foundation
release, not the feature release.
