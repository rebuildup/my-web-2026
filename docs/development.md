# Development

> How to bootstrap, run, test, and troubleshoot my-web-2026.

## Supported hosts

- macOS / Apple Silicon — first-class.
- Windows 11 + WSL2 — first-class.
- Linux / NixOS — first-class.
- Remote Linux sandbox (CI / paid providers) — first-class.

Docker Desktop is not a hard dependency. The local runtime is
selected by the operator at init time.

## Prerequisites

| Tool     | Version                          |
| -------- | -------------------------------- |
| Node.js  | 20.18+                           |
| pnpm     | 12.3.x (install directly, not via corepack — see ADR-0003) |
| Wrangler | `^4.131.0` (npm)                 |
| Git      | 2.40+                            |

## Bootstrap

```bash
git clone https://github.com/rebuildup/my-web-2026.git
cd my-web-2026
# corepack is forbidden in this repository; install pnpm directly:
npm install -g pnpm@12.3.4
pnpm install
pnpm prepare        # panda codegen
```

## Run

```bash
# Local Cloudflare dev server (TanStack Start + Hono)
pnpm dev
# -> http://127.0.0.1:3000

# Storybook (editorial visual-language preview, primitives, tokens)
pnpm storybook
# -> http://127.0.0.1:6006
```

## Validate

```bash
pnpm run validate:fast         # format:check + lint:check + typecheck + test
pnpm run validate:integration  # + build + wrangler:dry-run + lint:ci + build-storybook
pnpm run validate:release      # + cf-typegen:check
```

CI (`.github/workflows/ci.yml`) runs `validate:integration` from the
`validate` job on every PR and every push to `main` / `release-*`.
The same job also installs the Playwright Chromium binary and runs
the E2E suite against `pnpm dev`.

## Storybook

Storybook 8.6.x previews the visual obligations that currently exist in source.
The shipped public surface uses `src/editorial/`: raw / semantic tokens plus
the current editorial primitives. New primitives are added only when that
visual language owns the requirement.

Stories stay next to their owner (for example
`src/editorial/primitives/<Name>.stories.tsx`).

```bash
pnpm storybook           # dev server on :6006
pnpm run build-storybook # static build to ./storybook-static
```

`build-storybook` is part of `validate:integration`. The static
output is gitignored.

## Playwright E2E

Playwright 1.63.x covers the deployed Worker smoke. Two surfaces
exist:

- `pnpm run e2e` runs `e2e/smoke.spec.ts` against `pnpm dev`
  locally (default) or any deployed URL via `PLAYWRIGHT_BASE_URL`.
- `pnpm run e2e:prod` runs `e2e/prod-smoke.spec.ts` against the
  canonical production URL `https://rebuildup.dev` (Issue #43 /
  ADR-0014). Operator-initiated only — never gated by regular CI.

```bash
pnpm run e2e:install     # one-time: chromium browser + system deps
pnpm run e2e             # run smoke.spec.ts; auto-starts pnpm dev locally
# Production smoke (Issue #43 / ADR-0014):
pnpm run e2e:prod        # runs prod-smoke.spec.ts against https://rebuildup.dev
```

The E2E suite asserts the four public surfaces documented in
`docs/architecture.md`:

- `GET /` (200, SSR HTML)
- `GET /api/v1/health` (200, `{status:'ok',...}`)
- `GET /api/v1/db/ping` (200, `{one:1,...}` against the D1 binding)
- `GET /api/v1/media/ping` (404, `key_not_found` against the R2 binding)

## Format and lint

```bash
pnpm run format         # biome format --write (mutating)
pnpm run format:check   # read-only
pnpm run lint:check     # biome lint (read-only)
```

Validation gates only ever invoke `format:check` and `lint:check`.
The write-style `format` script is for local developer use, not CI.

## Cloudflare bindings

Edit `wrangler.jsonc` to add or change a binding, then:

```bash
pnpm run cf-typegen
```

Commit the regenerated `worker-configuration.d.ts` in the same PR.
See [ADR-0004](adr/ADR-0004-cloudflare-services-policy.md) for the
"purpose-based service selection" rule and the deferred services
list.

## Tests

Two test locations under a single Vitest config (workerd pool):

- `src/**/*.{test,spec}.{ts,tsx}` — Hono unit smoke
  (`src/http/hono.test.ts`).
- `test/integration/**/*.{test,spec}.{ts,tsx}` — D1 / R2 SELF smoke
  using `@cloudflare/vitest-plugin` `SELF` helper.

Run them:

```bash
pnpm test
```

## Generated artefacts

| Path               | Source                                   | Gitignored |
| ------------------ | ---------------------------------------- | ---------- |
| `dist/`            | `pnpm build`                             | yes        |
| `dist-cloudflare/` | `pnpm run wrangler:dry-run`              | yes        |
| `styled-system/`   | `pnpm prepare` (panda codegen)           | yes        |
| `storybook-static/`| `pnpm run build-storybook`               | yes        |
| `playwright-report/` | `pnpm run e2e`                        | yes        |
| `test-results/`    | `pnpm run e2e` (failure artefacts)      | yes        |
| `node_modules/`    | `pnpm install`                           | yes        |
| `.biome/`          | `pnpm run format` (cache)                | yes        |
| `.wrangler/`       | `wrangler dev`                           | yes        |
| `.tmp/`            | temporary research                       | yes        |
| `.reference/`      | external clones                          | yes        |

## Adding a Cloudflare binding

1. Open a GitHub Issue describing the feature and the binding.
2. Add the binding to `wrangler.jsonc` in the same PR.
3. Run `pnpm run cf-typegen` and commit `worker-configuration.d.ts`.
4. Add a handler under `src/http/hono.ts` (or a new
   `src/http/<name>.ts` if the surface grows).
5. Document the new binding in [docs/architecture.md](architecture.md).
6. Add an ADR if the binding introduces a new Cloudflare service
   (see [ADR-0004](adr/ADR-0004-cloudflare-services-policy.md)).

## Troubleshooting (quick reference)

| Symptom                                  | Likely cause / fix                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm install` warns `Ignored builds`   | Check `pnpm-workspace.yaml` `allowBuilds` / `onlyBuiltDependencies`.     |
| `wrangler types` regenerates stale      | Run after every binding change. Commit the diff.                         |
| `pnpm prepare` produces empty            | Run after editing `panda.config.ts`.                                     |
| `vite build` fails on `breakpoints`      | Panda breakpoint format: `'640px'`, not `{ value: ... }`.                |
| Hono path not intercepted               | Add the prefix to `EXTERNAL_BOUNDARY_PREFIXES` in `src/server.ts`.       |
| Port `3000` already in use               | Override with `--port` or change `vite.config.ts`.                       |
| vitest can't find `cloudflare:test`      | Ensure `vitest.config.ts` includes `tanstackStart()` so virtual modules resolve. |
| `validate:*` re-runs `format` (write)   | Should not happen — check `package.json` scripts use `format:check`.     |

See [docs/troubleshooting.md](troubleshooting.md) for the full list.
