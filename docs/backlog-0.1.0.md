# 0.1.0 Foundation backlog

> Concrete ticket list for the first release. Mirrored in
> [`docs/release.md`](release.md#010-foundation-backlog). The real
> GitHub Issue numbers are assigned when the Issues are opened
> against the canonical remote.

## Sprint goal

Establish my-web-2026's canonical architecture and dev / build /
deploy foundation. Empty-site Cloudflare production-equivalent
release is acceptable.

## Tickets

### #001 Confirm canonical remote and visibility

- **Type**: governance
- **Size**: S
- **Priority**: P0
- **Owner**: repository owner
- **Depends on**: —
- **Acceptance**:
  1. Canonical GitHub remote exists.
  2. Visibility decided (`public` preferred; `private` acceptable).
  3. README, `LICENSE`, and `docs/security.md` updated to match the
     decision.
- **Validation**: `pnpm run validate:fast`.

### #002 Apply `main` protection + release-source status check

- **Type**: governance / CI
- **Size**: S
- **Priority**: P0
- **Depends on**: #001
- **Acceptance** (only when #001 is `public`):
  1. Branch protection / ruleset on `main` with required reviews,
     required checks (`validate:fast`, `validate:integration`), and
     no direct push.
  2. A required status check that rejects `base == main` PRs whose
     head is not `release-*` matching the current target release.
- **Acceptance** (when #001 is `private`): document the decision
  and the relaxed protection in `docs/release.md`.
- **Validation**: `pnpm run validate:fast` + manual ruleset
  inspection.

### #003 Wire `@cloudflare/vitest-plugin` into `validate:integration`

- **Type**: test infrastructure
- **Size**: M
- **Priority**: P1
- **Depends on**: —
- **Acceptance**:
  1. At least one Worker-boundary integration test runs through
     `@cloudflare/vitest-plugin`'s `SELF` helper.
  2. `pnpm run validate:integration` exits 0 with the new test
     enabled.
  3. `quality/profile.yaml` documents the new test level as
     active (no longer `deferred_to_0_2_0`).
- **Validation**: `pnpm run validate:integration`.

### #004 Add D1 binding smoke (Foundation smoke + dry-run with binding)

- **Type**: infra
- **Size**: M
- **Priority**: P1
- **Depends on**: #002
- **Acceptance**:
  1. `wrangler.jsonc` declares a `d1_databases` binding for a
     placeholder database.
  2. `pnpm run cf-typegen` regenerates `worker-configuration.d.ts`.
  3. A smoke test executes a trivial D1 query at Worker boot.
  4. `pnpm run validate:integration` exits 0.
- **Validation**: `pnpm run validate:integration`.

### #005 Add R2 binding smoke

- **Type**: infra
- **Size**: M
- **Priority**: P1
- **Depends on**: #002
- **Acceptance**: same shape as #004 but for R2.
- **Validation**: `pnpm run validate:integration`.

### #006 Bootstrap `portfolio` feature module (UI placeholder)

- **Type**: feature
- **Size**: M
- **Priority**: P2
- **Depends on**: #004 (so the feature has persistence to talk to)
- **Acceptance**:
  1. `src/features/portfolio/**` exists with routes / components /
     hooks / styling skeleton.
  2. The route is wired into the router via TanStack Start file
     routing.
  3. A server function exercises a domain operation backed by the
     D1 binding.
  4. `pnpm run validate:integration` exits 0.
- **Validation**: `pnpm run validate:integration`.

### #007 Bootstrap `content` feature module (CMS placeholder)

- **Type**: feature
- **Size**: M
- **Priority**: P2
- **Depends on**: #004
- **Acceptance**:
  1. `src/features/content/**` exists with the same structure as
     #006.
  2. The CMS revision model (draft / published / history / preview /
     publish / rollback) is specified in
     `docs/architecture.md` and `docs/release.md`.
  3. A single D1 table representing `content_revisions` is wired.
- **Validation**: `pnpm run validate:integration`.

### #008 Bootstrap `tools` domain module (Tool Registry spec only)

- **Type**: domain / architecture
- **Size**: M
- **Priority**: P2
- **Depends on**: —
- **Acceptance**:
  1. `src/domains/tools/` is created with `application/`,
     `adapters/`, `contracts/` subfolders.
  2. `docs/architecture.md` describes the Tool Registry / manifest /
     build orchestration contract.
  3. No concrete Tool submodule is added in 0.1.0.
- **Validation**: `pnpm run validate:integration`.

### #009 Adopt first external integration behind Hono (example webhook)

- **Type**: feature
- **Size**: M
- **Priority**: P2
- **Depends on**: #005
- **Acceptance**:
  1. A single Hono handler at `/webhooks/<example>/...` parses a
     request, calls into `src/domains/<n>/application`, and returns
     2xx.
  2. Idempotency key handling per
     `skills/agent-recovery/SKILL.md` is documented and exercised
     by a test.
- **Validation**: `pnpm run validate:integration`.

### #010 Bootstrap `activity` feature module

- **Type**: feature
- **Size**: M
- **Priority**: P2
- **Depends on**: —
- **Acceptance**: route + components skeleton, server function
  shell, `pnpm run validate:integration` green.
- **Validation**: `pnpm run validate:integration`.

### #011 Cut the 0.1.0 release PR

- **Type**: release
- **Size**: S
- **Priority**: P0
- **Depends on**: #001–#010
- **Acceptance**:
  1. `release-0-1-0` branch is created from `main`.
  2. Every ticket PR has merged into `release-0-1-0`.
  3. `pnpm run validate:release` exits 0 on `release-0-1-0`.
  4. Draft release PR (`release-0-1-0 -> main`) is opened and
     merged.
  5. Tag `v0.1.0` is pushed.
- **Validation**: `pnpm run validate:release`.

## Dependency graph

```
#001
 └─ #002
     ├─ #004
     │   ├─ #006
     │   └─ #007
     └─ #005
         └─ #009

#003 (independent)
#008 (independent)
#010 (independent)

#001..#010
 └─ #011
```

## Next Issue to start

If the operator is ready to start work today, the natural first
ticket is **#001 Confirm canonical remote and visibility** — every
other ticket either depends on the remote (because Issues are
opened against it) or depends on the protection that #002 will set
up. #003 / #008 / #010 can start in parallel with #001 because they
do not depend on the remote.

If the operator is still in the "decide whether to create a remote"
phase, the next step is not a ticket — it is the human decision
recorded as the body of #001.
