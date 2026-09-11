# ADR-0007: Quality gate compilation

- Status: Accepted (revised 2026-09-11)
- Date: 2026-09-11
- Extends: project-init ADR-0005, ADR-0006
- Superseded by: None

## Context

The project-init policy (ADR-0005) says quality gates must be compiled
per project from current official framework / runtime guidance — they
are not a fixed bundle. ADR-0006 adds the verification taxonomy.

my-web-2026's stack is:

- Cloudflare Workers + Wrangler 4.131
- TanStack Start 1.168.x
- Hono 4.13.x
- Panda CSS 1.12.x
- React 19.2 / Vite 7.1 / TypeScript 5.9
- Vitest 4.1.x + `@cloudflare/vitest-plugin` 1.1.x (workerd pool)
- Biome 1.9.x (format + lint)

The first-pass `validate:*` scripts contained a mutating `format`
step (green-by-mutation) and CI repeated the same bootstrap and
format+typecheck+test chain three times across three jobs. This ADR
records the corrected compilation.

## Decision

### 1. Three gates

| Gate                   | Command                                                                         | Purpose                                |
| ---------------------- | ------------------------------------------------------------------------------- | -------------------------------------- |
| `validate:fast`        | `format:check && lint:check && typecheck && test`                               | local feedback, read-only              |
| `validate:integration` | `validate:fast && build && wrangler:dry-run`                                    | ticket-PR level verification           |
| `validate:release`     | `validate:integration && cf-typegen`                                            | release branch pre-`main` verification |

These are wired in `package.json#scripts` and referenced by the
project-local `quality/profile.yaml`.

### 2. Format and lint are read-only inside gates

- `pnpm run format` (`biome format --write`) — developer only, never
  called from a `validate:*` script.
- `pnpm run format:check` (`biome format`) — read-only, used by
  `validate:fast`.
- `pnpm run lint:check` (`biome lint`) — read-only, used by
  `validate:fast`.

`biome.json` configures indent (tab, width 2), line width (100),
quotes (single in JS, double in JSX), semicolons (always), trailing
commas (all), arrow parentheses (always), and `organizeImports`.

### 3. CI shape: two jobs, shared bootstrap, no chain duplication

`.github/workflows/ci.yml` has exactly two jobs:

- `validate` — runs `pnpm run validate:integration` on
  `pull_request` and on `push` to `main` / `release-*`.
- `validate-release` — runs `pnpm run validate:release` on
  `push` to `main` / `release-*` only.

Bootstrap (`setup-node`, `corepack enable pnpm`, `pnpm/action-setup`,
`actions/cache`, `pnpm install --frozen-lockfile`) is **not**
duplicated inside jobs that already depend on each other; each job
declares its own bootstrap because `actions/cache@v4` makes the
duplicate cheap, and the two jobs are independent enough that sharing
would re-introduce coupling.

`validate:fast` is no longer a separate CI job; it is composed into
`validate:integration` as the first step. The previous design ran
`validate:fast` three times per push-to-main; the new design runs
the same checks once.

### 4. Verification taxonomy

- **Unit** — Vitest tests in `src/**/*.{test,spec}.{ts,tsx}` that do
  not require a Worker boundary. 0.1.0 ships a Hono smoke test
  (`src/http/hono.test.ts`).
- **Smoke / connectivity** — `vite build` + `wrangler deploy --dry-run`
  proves the bundle is Cloudflare-compatible. `pnpm run wrangler:dry-run`
  is part of `validate:integration`, not a separate manual step.
- **Integration** — `@cloudflare/vitest-plugin` SELF tests in
  `test/integration/**`. 0.1.0 ships D1 (`/api/v1/db/ping`) and R2
  (`/api/v1/media/ping`) SELF smokes; they run inside the workerd
  pool with real bindings.
- **Contract / schema** — Type tests for Hono handlers and the
  generated Cloudflare types (`pnpm run cf-typegen` is part of
  `validate:release`). Out of scope as separate gates at 0.1.0.
- **E2E** — Real browser / runtime flow tests. Out of scope for
  0.1.0.
- **Manual / visual** — Reserved for UI work in later sprints.

### 5. Change-risk -> verification mapping (0.1.0)

| Change                                          | Required verification             |
| ----------------------------------------------- | --------------------------------- |
| Pure logic (Hono handler, server fn body)       | `validate:integration`            |
| `wrangler.jsonc` binding change                 | `validate:integration`            |
| Entry-point change (`src/server.ts`)            | `validate:integration`            |
| Panda config / token change                     | `validate:integration`            |
| Release branch bump                             | `validate:release`                |
| Vite / Wrangler / plugin upgrade                | `validate:release`                |

### 6. No universal coverage threshold

`0.1.0` does not enforce a coverage threshold. The 0.1.0 source
surface is intentionally tiny; meaningful coverage is a 0.2.0
concern once real domain modules exist. `quality/profile.yaml#coverage_policy`
records this explicitly.

### 7. Profile location

The canonical machine-readable profile lives at
`quality/profile.yaml`. It is re-compiled when:

- A framework / runtime major version is bumped.
- An architecture boundary changes.
- A new app / platform target is introduced.
- A gate becomes flaky or slow enough to materially affect
  development velocity.
- An escaped regression shows a missing validation layer.

## Consequences

### Positive

- Three deterministic entry points that the agent and CI share.
- No `pnpm test` / `npm test` divergence.
- Coverage policy is honest — it is not enforced on a tiny 0.1.0
  surface.
- CI no longer runs the same checks three times per push-to-main.

### Negative / Trade-offs

- `validate:integration` is the only PR gate (replaces the previous
  `validate:fast` + `validate:integration` split). Operators who
  want quick feedback before pushing should still run
  `pnpm run validate:fast` locally.

## Re-evaluation triggers

Re-evaluate when:

- Any of the third-party packages in this stack ships a breaking
  change to its public API.
- A new application target (mobile, CLI, library) is introduced.
- `validate:integration` becomes the bottleneck of development
  velocity.
- Coverage thresholds become meaningful and need re-introduction.
