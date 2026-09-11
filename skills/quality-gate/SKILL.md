---
name: quality-gate
description: my-web-2026 の stack (Cloudflare Workers + TanStack Start + Hono + Panda CSS + Vitest + Biome) 固有の quality gate 設計・実行・更新。
---

# Quality Gate (my-web-2026)

Compiled per `quality/profile.yaml` (schema version 1). Re-compile
when any trigger in ADR-0007 fires.

## Three deterministic entry points

| Gate                   | Command                                                                       | Purpose                       |
| ---------------------- | ----------------------------------------------------------------------------- | ----------------------------- |
| `validate:fast`        | `format:check && lint:check && typecheck && test`                             | local feedback, read-only     |
| `validate:integration` | `validate:fast && build && wrangler:dry-run`                                  | ticket-PR level verification  |
| `validate:release`     | `validate:integration && cf-typegen`                                          | release-branch pre-`main`     |

These scripts are the only entry points. The scripts live in
`package.json#scripts`; the gate profiles live in
`quality/profile.yaml`.

**`pnpm run format` (`biome format --write`) is developer-only and
must never appear inside a `validate:*` script.** All gates invoke
the read-only variants: `format:check` and `lint:check`.

GitHub Actions (`.github/workflows/ci.yml`) invokes the same scripts.
Do not redefine validation logic in workflow YAML.

## Verification taxonomy (my-web-2026)

- **Unit** — Vitest tests in `src/**/*.{test,spec}.{ts,tsx}`. Do not
  require a Worker boundary. 0.1.0 ships `src/http/hono.test.ts` as
  the Hono smoke.
- **Smoke / connectivity** — `vite build` + `wrangler deploy --dry-run
  --outdir dist-cloudflare`. Proves the Cloudflare Worker bundle is
  acceptable. `pnpm run wrangler:dry-run` is a first-class script;
  it is composed into `validate:integration`, not run manually.
- **Integration** — `@cloudflare/vitest-plugin` SELF tests in
  `test/integration/**`. They run inside the workerd pool against
  the real `Env` (D1 / R2 / ASSETS bindings). 0.1.0 ships
  `test/integration/d1.test.ts` and `test/integration/r2.test.ts`.
  The single `vitest.config.ts` registers both unit tests and SELF
  integration tests via `tanstackStart()` + `cloudflareTest()`
  plugins.
- **Contract / schema** — Type tests for Hono handlers + the
  generated Cloudflare types (`pnpm run cf-typegen` is the last step
  of `validate:release`). Out of scope as separate gates at 0.1.0.
- **E2E / system** — Real browser / runtime flow tests. Out of scope
  at 0.1.0.
- **Manual / visual** — Reserved for UI work in later sprints.

## Change-risk -> required verification

| Change                                          | Minimum verification             |
| ----------------------------------------------- | --------------------------------- |
| Pure logic (Hono handler, server fn body)       | `validate:integration`            |
| New route in `src/routes/**`                    | `validate:integration`            |
| `wrangler.jsonc` binding change                 | `validate:integration`            |
| Entry-point change (`src/server.ts`)            | `validate:integration`            |
| Panda config / token change                     | `validate:integration`            |
| Stack / dependency upgrade                      | `validate:release`                |
| Release branch bump                             | `validate:release`                |

## Format and lint are read-only inside gates

Biome (`@biomejs/biome` 1.9.x) replaces Prettier + ESLint. Two
scripts are read-only and used by gates:

- `pnpm run format:check` → `biome format`
- `pnpm run lint:check` → `biome lint`

`pnpm run format` → `biome format --write` exists for developer
ergonomics only.

`biome.json` configures indent (tab, width 2), line width (100),
quotes (single in JS, double in JSX), semicolons (always), trailing
commas (all), arrow parentheses (always), and `organizeImports`. It
ignores `dist`, `dist-cloudflare`, `styled-system`, `node_modules`,
`.biome/`, `pnpm-lock.yaml`, `worker-configuration.d.ts`, and
`src/routeTree.gen.ts`.

## Framework-native checks first

Use framework-provided tools before adding generic ones:

- TanStack Start: `vite build` emits the canonical Cloudflare bundle
  via `@cloudflare/vite-plugin`. `src/start.ts` is intentionally
  absent — adding a custom `startInstance` requires an ADR because
  it disables the default CSRF middleware.
- Wrangler: `wrangler types` (`pnpm run cf-typegen`) +
  `wrangler deploy --dry-run` for type and bundle parity.
- Panda: `panda codegen` runs as `pnpm prepare`; the postcss pipeline
  runs inside `vite build`.
- Vitest: a single `vitest.config.ts` registers both `tanstackStart()`
  and `cloudflareTest()` plugins; the SELF pool is `workerd`.
- Hono: Web Standards types only — no Express middleware. Hono lives
  in `src/http/hono.ts`, dispatched from `src/server.ts` (custom
  Worker entrypoint). Bindings are typed via
  `Hono<{ Bindings: Env }>`.

## False-green prohibitions

- `.only` / `.skip` in committed tests.
- `|| true` / ignored exit codes.
- `pnpm run format` invoked inside a `validate:*` script.
- CI jobs that re-run the same checks previously run by another
  job in the same workflow run.
- `mock-only` test reported as real integration.
- Reusing a green result from a different SHA (e.g. after a stack
  rebase).

## Coverage

`quality/profile.yaml#coverage_policy.enabled = false` at 0.1.0. This
is intentional; the surface area is tiny. Threshold policy is a
0.2.0 decision.

## CI resource efficiency

`.github/workflows/ci.yml` has exactly two jobs:

- `validate` — runs `pnpm run validate:integration` on
  `pull_request` and on `push` to `main` / `release-*`.
- `validate-release` — runs `pnpm run validate:release` on `push` to
  `main` / `release-*` only.

- `concurrency.cancel_in_progress: true`, grouped by PR / ref.
- `timeout-minutes` on every job.
- Bootstrap (`setup-node`, `corepack enable pnpm`,
  `pnpm/action-setup`, `actions/cache@v4`,
  `pnpm install --frozen-lockfile`) is declared per job — `cache@v4`
  makes the duplicate cheap and keeps each job independently
  runnable.

The previous 3-job shape (validate-fast / validate-integration /
validate-release) is collapsed into 2 because `validate:fast` is
already the first step of `validate:integration`. The same checks
must not be invoked twice in one push-to-main.

## Re-compile triggers

See ADR-0007. At minimum: framework upgrade, new app target,
architecture boundary change, CI workflow change, escaped regression,
material Actions usage change.
