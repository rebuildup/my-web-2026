---
name: onboarding
description: fresh contributor / fresh AI agent が my-web-2026 で会話履歴なしに開発・検証・復旧できる documentation を整備・更新する。
---

# Onboarding (my-web-2026)

The goal is not "has a README"; it is "can a fresh contributor or
fresh agent understand, bootstrap, run, validate, pick an Issue,
follow the sprint workflow, and recover a ticket without prior
context".

## Required entry points

- `README.md` — purpose, support platform, architecture index,
  canonical bootstrap / run / validate command, internal docs index,
  recovery entry.
- `CONTRIBUTING.md` — development workflow, GitHub workflow.
- `AGENTS.md` — root agent contract (this repository).
- `docs/architecture.md` — system boundaries, dependency direction,
  data flow.
- `docs/development.md` — bootstrap, run, test, validate.
- `docs/troubleshooting.md` — recurring failure modes.
- `docs/release.md` — weekly release sprint, version, deployment,
  GitHub delivery.
- `docs/security.md` — security maintenance, reporting.
- `docs/recovery.md` — durable recovery, fencing, side-effect
  reconciliation.
- `docs/adr/` — architecture decisions.
- `skills/` — project-local Agent Skills (progressive disclosure).

## README minimum

README must link, not duplicate:

- What the project is.
- Support / target platform (Cloudflare Workers).
- Architecture overview link (`docs/architecture.md`).
- Canonical bootstrap command (`pnpm install`).
- Canonical run command (`pnpm dev`).
- Canonical validate commands (from `quality/profile.yaml`).
- Internal docs index.
- Contribution entry point.
- Recovery entry point.

## GitHub workflow onboarding

A new agent or contributor must be able to discover, from
`CONTRIBUTING.md` and `skills/github-delivery/SKILL.md`:

- One-week sprint cadence.
- `release-x-y-z` integration branch format.
- Number-only ticket branch format.
- Issue dependency graph as canonical dependency SoT.
- Independent ticket PR base = target release branch.
- Stacked dependent ticket PR base = immediate predecessor branch.
- Branch creation -> first meaningful commit -> remote publish ->
  remote head SHA verify -> immediate Draft PR as one start
  procedure.
- PR metadata requirement (linked Issue, assignee, reviewer,
  labels, target release, stack context, validation state).
- Stack landing = landed on target release trunk.
- `release-x-y-z -> main` as the only integration to `main`.
- `main` protection / ruleset expectations for a public repository.

## Discovery ordering

A fresh agent reads, in order:

1. `AGENTS.md`
2. The Skill relevant to the task (`skills/<name>/SKILL.md`).
3. The doc relevant to the task (`docs/architecture.md` etc.).
4. The ADR relevant to the decision in question.

It does **not** read the full Skills bundle, the full `docs/`
tree, or the full `docs/adr/` set on every session.

## Documentation verification

Documented commands are tested against a fresh environment when
practical. CI exercises the same commands. `docs/troubleshooting.md`
is updated when recurring failure knowledge accumulates.
