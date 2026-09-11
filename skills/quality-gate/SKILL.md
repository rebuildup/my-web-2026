---
name: quality-gate
description: my-web-2026 の stack (Cloudflare Workers + TanStack Start + Hono + Panda CSS + Vitest) 固有の quality gate 設計・実行・更新。
---

# Quality Gate (my-web-2026)

Compiled per `quality/profile.yaml` (schema version 1). Re-compile
when any trigger in ADR-0007 fires.

## Three deterministic entry points

| Gate                   | Command                                                        | Purpose                 |
| ---------------------- | -------------------------------------------------------------- | ----------------------- |
| `validate:fast`        | `pnpm format && pnpm typecheck && pnpm test`                   | fast worker feedback    |
| `validate:integration` | `pnpm validate:fast && pnpm build && pnpm test --pool=threads` | ticket PR verification  |
| `validate:release`     | `pnpm validate:integration && pnpm cf-typegen`                 | pre-`main` verification |

GitHub Actions (`.github/workflows/ci.yml`) invokes the same three
commands. Do not redefine validation logic in workflow YAML.

## Verification taxonomy (my-web-2026)

- **Unit** — Vitest tests in `src/**/*.{test,spec}.{ts,tsx}`. Do not
  require a Worker boundary.
- **Smoke** — `pnpm build` + `pnpm exec wrangler deploy --dry-run`.
  Confirms the Cloudflare Worker bundle is acceptable.
- **Integration** — Vitest with `--pool=threads`. Multi-component
  tests that exercise TanStack Start SSR, server functions, or Hono
  with a fake `Env`.
- **Contract** — `tsc --noEmit` + `pnpm exec wrangler types`. The
  Hono app and `worker-configuration.d.ts` must stay in sync.
- **E2E / system** — deferred until 0.2.0 introduces a real
  binding.
- **Manual / visual** — reserved for UI work in later sprints.

## Change-risk -> required verification

| Change                          | Minimum verification                  |
| ------------------------------- | ------------------------------------- |
| Pure logic (Hono / server fn)   | unit + smoke                          |
| New route in `src/routes/**`    | unit + integration + smoke            |
| `wrangler.jsonc` binding change | smoke + contract (`cf-typegen`)       |
| Panda config / token change     | smoke (Panda postcss) + manual visual |
| Stack / dependency upgrade      | full `validate:integration`           |
| Release branch                  | full `validate:release`               |

## Framework-native checks first

Use framework-provided tools before adding generic ones:

- TanStack Start: `vite build` emits the canonical Cloudflare bundle.
- Wrangler: `wrangler types` + `wrangler deploy --dry-run` for type
  and bundle parity.
- Panda: `panda codegen` for the `styled-system` package,
  `panda prepare` postcss pipeline.
- Vitest: native TypeScript, native ESM, native pool workers.
- Hono: Web Standards types only — no Express middleware.

## False-green prohibitions

- `.only` / `.skip` in committed tests.
- `|| true` / ignored exit codes.
- `coverage` thresholds with broad excludes.
- `mock-only` test reported as real integration.
- Reusing a green result from a different SHA (e.g. after a stack
  rebase).

## Coverage

`quality/profile.yaml#coverage_policy.enabled = false` at 0.1.0. This
is intentional; the surface area is tiny. Threshold policy is a
0.2.0 decision.

## CI resource efficiency

- `pull_request`: `validate:fast` + `validate:integration`.
- `push` to `main` or `release-*`: `validate:integration` + `validate:release`.
- `concurrency.cancel_in_progress: true`, grouped by PR / ref.
- `timeout-minutes` on every job.
- Required checks for public repository: `validate:fast`,
  `validate:integration`.

## Re-compile triggers

See ADR-0007. At minimum: framework upgrade, new app target,
architecture boundary change, CI workflow change, escaped regression,
material Actions usage change.
