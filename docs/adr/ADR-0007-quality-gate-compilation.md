# ADR-0007: Quality gate compilation

- Status: Accepted (revised 2026-09-11; amended 2026-10-19 by Issue #566)
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

| Gate                   | Command                                                                                       | Purpose                                |
| ---------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------- |
| `validate:fast`        | `format:check && lint:check && typecheck && test`                                             | local feedback, read-only              |
| `validate:integration` | `validate:fast && build && wrangler:dry-run && lint:ci && build-storybook`                    | ticket-PR level verification           |
| `validate:release`     | `validate:integration && cf-typegen:check`                                                     | release branch pre-`main` verification |

The `validate:integration` gate additionally installs the Playwright
Chromium binary and runs the E2E suite inside the CI `validate`
job (`pnpm run e2e`), against a local `pnpm dev` webServer started
by `playwright.config.ts`. The Playwright report is uploaded as a
7-day retention artefact on every run.

These are wired in `package.json#scripts` and referenced by the
project-local `quality/profile.yaml`.

### 1a. Where the ordered chain lives (amendment, Issue #566)

The three gates above were originally `&&`-joined command chains
inside `package.json`. A trial merge of 20 concurrent 0.6.3 ticket
PRs conflicted on those lines in 17 of them: a ticket that added one
gate had to rewrite a line every other ticket was also rewriting.

`quality/profile.yaml#gates.<name>.components` is therefore the
**execution order**, not only its record. Each `validate:*` npm script
is one line — `node scripts/run-quality-gates.mjs <gate>` — and that
runner reads the declared components and runs them in order, one
command per line, stopping at the first failure and propagating that
step's exit code (the semantics of the chain it replaces). The same
reasoning applies to `pnpm run test`: it delegates to
`scripts/run-script-tests.mjs`, which discovers `scripts/*.test.mjs`
by convention instead of enumerating them, and
`scripts/check-test-wiring.mjs` proves reachability against that same
rule.

Adding a gate or a script test is an appended line or a new file, not
a rewrite of a shared chain. Nothing else in this ADR changes: the
three entry points, the read-only format/lint rule, the single CI job
and the change-risk mapping are untouched.

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

### 3. CI shape: one job, shared bootstrap, no chain duplication

`.github/workflows/ci.yml` has exactly one job:

- `validate` — runs `pnpm run validate:integration` on every
  `pull_request` and on every `push` to `main` / `release-*`. The
  push-only extra steps (`cf-typegen:check`, Playwright E2E) are
  gated by an `if:` expression so PR drafts and non-UI PRs skip
  them.

Bootstrap (`setup-node`, `pnpm/action-setup@v4`, `actions/cache`,
`pnpm install --frozen-lockfile`) is declared once. The previous
two-job design (`validate` + `validate-release`) was collapsed to a
single job because both jobs shared the same bootstrap and
`validate:release` is a strict superset of `validate:integration`
plus `cf-typegen:check`; the conditional `if:` gate replaces the
job-level split. See `skills/quality-gate/SKILL.md` for the
resource-efficiency rationale. `pnpm/action-setup@v4` downloads
the pnpm 12.3.4 standalone binary directly; **corepack is
forbidden** (see ADR-0003).

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
- **Design-system** — `pnpm run build-storybook` is part of
  `validate:integration`; a broken Panda recipe / Storybook story
  fails the PR gate without needing a browser.
- **Integration** — `@cloudflare/vitest-plugin` SELF tests in
  `test/integration/**`. 0.1.0 ships D1 (`/api/v1/db/ping`) and R2
  (`/api/v1/media/ping`) SELF smokes; they run inside the workerd
  pool with Miniflare-simulated local bindings.
- **Contract / schema** — Type tests for Hono handlers and the
  generated Cloudflare types (`pnpm run cf-typegen:check` is part of
  `validate:release`). Out of scope as separate gates at 0.1.0.
- **E2E** — Playwright 1.63.x suite in `e2e/`. The 0.1.0 suite is
  HTTP-only (`request` fixture) and covers `/`, `/api/v1/health`,
  `/api/v1/db/ping`, `/api/v1/media/ping`. Runs in CI via
  `pnpm run e2e` after Playwright Chromium is installed
  (`playwright install --with-deps chromium`).
- **Manual / visual** — Reserved for UI work in later sprints.

### 5. Change-risk -> verification mapping (0.1.0)

| Change                                          | Required verification             |
| ----------------------------------------------- | --------------------------------- |
| Pure logic (Hono handler, server fn body)       | `validate:integration`            |
| `wrangler.jsonc` binding change                 | `validate:integration`            |
| Entry-point change (`src/server.ts`)            | `validate:integration`            |
| Panda config / token change                     | `validate:integration`            |
| New / changed Panda recipe or Storybook story   | `validate:integration` (build-storybook) |
| New / changed Playwright spec                   | `validate:integration` (e2e runs in CI) |
| `.github/workflows/*.yml` change                | `validate:integration` (actionlint enforced) |
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
