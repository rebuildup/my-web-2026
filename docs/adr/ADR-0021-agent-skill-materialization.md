# ADR-0021: Agent skill materialization and operating-model boundary

- Status: Accepted
- Date: 2026-11-16
- Extends: ADR-0007, ADR-0008, ADR-0015, Issue #647
- Superseded by: None

## Context

project-init moved from a small vendored Skill set to a larger
agent-environment model: a root contract that dispatches to Skills, a
`skills-lock.json` provenance record, project-init
`constitution/` / `organization/` documents, and additional capabilities
for skill selection, secrets, security audit, correctness assurance,
estimation, naming, debugging, TDD, and Cloudflare Workers practice.

This repository already had a large `AGENTS.md` contract, 41 vendored
Skills with documented forks, ADR-0001…ADR-0020, GitHub Projects as the
delivery SoT, Infisical as the secret SoT, and a ruleset-protected
`main`. A blanket sync would have overwritten deliberate local decisions
and introduced upstream ADR numbers that collide with this repository's
own ADR numbering.

## Decision

1. Keep `AGENTS.md` + `docs/adr/` as this repository's agent contract
   and decision history. Do not copy project-init's
   `constitution/CONSTITUTION.md` or `organization/profiles/*` into this
   repository. The upstream profile defaults that conflict with local
   decisions are Linear release planning and autonomous ticket-PR
   landing; this repository keeps GitHub Projects / Issues as the
   delivery SoT and requires explicit human authorization for every
   merge, release merge, tag, and release publication (§6–§7,
   `skills/github-delivery`).

2. Materialize `skills-lock.json` for the project-local `skills/`
   tree. The lock records `source`, `ref`, `sourceType`, `skillPath`,
   and a `computedHash` over the vendored directory. It is provenance
   and drift evidence; it does not authorize mechanical sync. Skills
   that are intentionally forked or pinned keep their documented local
   content and older upstream `ref`.

3. Adopt the missing capabilities that match this repository's actual
   stack and policies: `skill-selection`, `secrets-management`,
   `security-audit`, `correctness-assurance`, `code-naming`,
   `agent-delivery-estimation`, `cf-cli`, `workers-best-practices`,
   `diagnosing-bugs`, `tdd`, and `skill-authoring`. Take the
   `interaction-discipline` YAML quoting fix and the
   `security-maintenance` → `security-audit` handoff from project-init
   `v0.9.0`.

4. Keep the existing fork/pin table in `AGENTS.md` §10 as the canonical
   record of skills that must not be synced mechanically. Skills still
   pinned to project-init `0.1.1` (`agent-recovery`, `onboarding`,
   `sandbox-runtime`, `writing-discipline`, plus the already documented
   forks) require a local adaptation pass before any `v0.9.0` sync,
   because current upstream text assumes autonomous landing and
   project-init organization/ADR vocabulary that this repository does
   not adopt.

5. Decline `linear-release-control`, `orca-frontend`,
   `supervisor-boundary`, and `idea-discovery` for now: the first two
   conflict with the GitHub-Projects SoT / no-Orca configuration, the
   third requires a dedicated non-authoring Supervisor profile that is
   not selected, and the fourth is a conditional capability rather than
   a current need.

## Consequences

- A fresh clone can reach every adopted Skill from `AGENTS.md` §10 and
  verify provenance from `skills-lock.json`.
- Existing delivery, secret, architecture, and merge-authorization
  invariants remain owned by `AGENTS.md`, `docs/release.md`,
  `docs/security.md`, and the relevant ADRs rather than by copied
  upstream constitution/profile text.
- Future Skill updates still require a per-skill diff and an explicit
  check against §3 / §6 / §7 invariants; `npx skills update` or
  `bunx skills update` over the whole directory remains forbidden.
