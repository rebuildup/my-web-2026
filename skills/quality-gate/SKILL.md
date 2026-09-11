---
name: quality-gate
description: my-web-2026 の stack (Cloudflare Workers + TanStack Start + Hono + Panda CSS + Vitest + Biome + actionlint) 固有の quality gate 設計・実行・更新。
---

# Quality Gate (my-web-2026)

Compiled per `quality/profile.yaml` (schema version 1). Re-compile
when any trigger in ADR-0007 fires.

## Three deterministic entry points

| Gate                   | Command                                                                                  | Purpose                                          |
| ---------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `validate:fast`        | `format:check && lint:check && typecheck && test`                                        | local feedback, read-only                        |
| `validate:integration` | `validate:fast && build && wrangler:dry-run && lint:ci && build-storybook`              | ticket-PR level verification                     |
| `validate:release`     | `validate:integration && cf-typegen:check`                                               | release-branch pre-`main` (regenerated types match committed types) |

Playwright E2E is not part of any local `validate:*` script — it
runs in the CI `validate` job after `validate:integration` passes,
because the suite needs the Playwright Chromium binary and (on
Linux) `sudo` for `--with-deps`. Local E2E is opt-in via
`pnpm run e2e`.

These scripts are the only entry points. The scripts live in
`package.json#scripts`; the gate profiles live in
`quality/profile.yaml`.

**`pnpm run format` (`biome format --write`) is developer-only and
must never appear inside a `validate:*` script.** All gates invoke
the read-only variants: `format:check` and `lint:check`.

GitHub Actions (`.github/workflows/ci.yml`) invokes the same scripts.
Do not redefine validation logic in workflow YAML.

## `cf-typegen:check` is a real check, not a generation step

`wrangler types` regenerates `worker-configuration.d.ts`. Running it
inside CI without verification means a stale committed file is never
caught. `cf-typegen:check` runs `wrangler types` and then
`git diff --exit-code -- worker-configuration.d.ts`, so the gate
fails when the committed file diverges from what `wrangler` would
produce.

## Verification taxonomy (my-web-2026)

- **Unit** — Vitest tests in `src/**/*.{test,spec}.{ts,tsx}`. Do not
  require a Worker boundary. 0.1.0 ships `src/http/hono.test.ts` as
  the Hono smoke.
- **Smoke / connectivity** — `vite build` + `wrangler deploy --dry-run
  --outdir dist-cloudflare`. Proves the Cloudflare Worker bundle is
  acceptable. `pnpm run wrangler:dry-run` is a first-class script;
  it is composed into `validate:integration`, not run manually.
- **Integration** — `@cloudflare/vitest-plugin` SELF tests in
  `test/integration/**`. They run inside the **workerd pool against
  Miniflare-simulated local bindings** (D1 / R2 / ASSETS). 0.1.0 ships
  `test/integration/d1.test.ts` and `test/integration/r2.test.ts`.
  Real-resource smoke (a deployed Worker against real Cloudflare
  D1 / R2) is part of the release cut (#009 in `docs/release.md`).
- **Contract / schema** — `cf-typegen:check` plus `pnpm run typecheck`.
  Out of scope as separate gates at 0.1.0.
- **E2E / system** — Playwright 1.63.x suite in `e2e/`. The 0.1.0
  suite is HTTP-only (`request` fixture, no browser launch) and
  covers `/`, `/api/v1/health`, `/api/v1/db/ping`,
  `/api/v1/media/ping`. Runs in CI via `pnpm run e2e` after the
  Playwright Chromium binary is installed
  (`playwright install --with-deps chromium`). The report uploads
  as a 7-day `actions/upload-artifact@v4` artefact.
- **Design-system** — `pnpm run build-storybook` is part of
  `validate:integration`. A broken Panda recipe or Storybook story
  fails the PR gate without needing a browser.
- **Manual / visual** — Reserved for UI work in later sprints.

## Change-risk -> required verification

| Change                                          | Minimum verification             |
| ----------------------------------------------- | --------------------------------- |
| Pure logic (Hono handler, server fn body)       | `validate:integration`            |
| New route in `src/routes/**`                    | `validate:integration`            |
| `wrangler.jsonc` binding change                 | `validate:integration`            |
| Entry-point change (`src/server.ts`)            | `validate:integration`            |
| Panda config / token change                     | `validate:integration`            |
| New / changed Panda recipe or Storybook story   | `validate:integration` (build-storybook) |
| New / changed Playwright spec                   | `validate:integration` (e2e runs in CI) |
| `.github/workflows/*.yml` change                | `validate:integration` (actionlint enforced) |
| Stack / dependency upgrade                      | `validate:release`                |
| Release branch bump                             | `validate:release`                |

## Format, lint, and workflow YAML

- **Format / lint**: Biome (`@biomejs/biome` 1.9.x). Two scripts are
  read-only and used by gates: `format:check` and `lint:check`.
  `pnpm run format` (`biome format --write`) is developer-only.
- **Workflow YAML**: actionlint. Biome does not cover
  `.github/workflows/*.yml`; without actionlint, the previous pass
  shipped a tab-indented CI YAML that GitHub Actions could not parse.
  CI uses `rhysd/actionlint@v1`. Local: `pnpm run lint:ci` (requires
  `actionlint` on PATH; install via
  `go install github.com/rhysd/actionlint/cmd/actionlint@latest`).

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
- Wrangler: `wrangler types` + `wrangler deploy --dry-run` for type
  and bundle parity. The committed `worker-configuration.d.ts` is
  verified by `cf-typegen:check`.
- Panda: `panda codegen` runs as `pnpm prepare`; the postcss pipeline
  runs inside `vite build`.
- Vitest: a single `vitest.config.ts` registers both `tanstackStart()`
  and `cloudflareTest()` plugins; the SELF pool is `workerd` running
  on Miniflare-simulated bindings.
- Hono: Web Standards types only — no Express middleware. Hono lives
  in `src/http/hono.ts`, dispatched from `src/server.ts` (custom
  Worker entrypoint). Bindings are typed via
  `Hono<{ Bindings: Env }>`. Path-prefix dispatch in `src/server.ts`
  uses `pathname === prefix || pathname.startsWith(\`${prefix}/\`)` to
  avoid collisions like `/api/v10` or `/api/v1evil`.

## False-green prohibitions

- `.only` / `.skip` in committed tests.
- `|| true` / ignored exit codes.
- `pnpm run format` invoked inside a `validate:*` script.
- CI jobs that re-run the same checks previously run by another
  job in the same workflow run.
- `wrangler types` run as a bare generation step in CI without a
  `git diff --exit-code` check.
- Tabs in `.github/workflows/*.yml`. actionlint enforces 2-space
  indent.
- `mock-only` test reported as real integration.
- Reusing a green result from a different SHA (e.g. after a stack
  rebase).

## Coverage

`quality/profile.yaml#coverage_policy.enabled = false` at 0.1.0. This
is intentional; the surface area is tiny. Threshold policy is a
0.2.0 decision.

## CI resource efficiency

`.github/workflows/ci.yml` has exactly one job:

- `validate` — runs `pnpm run validate:integration` on
  `pull_request` and on `push` to `main` / `release-*`. The
  `cf-typegen:check` step runs only on `push` to `main` / `release-*`.

The previous 2-job shape (`validate` + `validate-release`) is
collapsed into one because every check the release job ran is also
required for PR validation, and the cf-typegen check is conditional.
Each push-to-main runs the same checks once.

- `concurrency.cancel_in_progress: true`, grouped by PR / ref.
- `timeout-minutes: 20` on the single job.
- Bootstrap (`setup-node`, `pnpm/action-setup@v4` with `version: 12.3.4`,
  `actions/cache@v4`, `pnpm install --frozen-lockfile`) is declared
  once. `pnpm/action-setup@v4` downloads the pnpm 12.3.4 standalone
  binary directly; **corepack is forbidden** (ADR-0003). There is no
  second job to duplicate it into.

## Re-compile triggers

See ADR-0007. At minimum: framework upgrade, new app target,
architecture boundary change, CI workflow change, escaped regression,
material Actions usage change.
