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

### Phase 1 / Issue #67 — Infisical + Cloudflare Workers Builds bootstrap

ADR-0015 §11 Phase 1 provisions the Infisical project, Machine
Identity, and Cloudflare Workers Builds credential binding. The
agent drives the flow via `pnpm` scripts; the operator only needs
to provide short-lived auth tokens in the shell environment.

**Prerequisites (operator one-time, per developer / CI runner):**

```bash
# Infisical self-host Universal Auth token (operator-scoped).
#   Run `infisical login` once; the CLI writes the short-lived
#   token to `INFISICAL_TOKEN` in the current shell.
infisical login

# Cloudflare user-scoped API token with the following two
# permissions (NOT the existing build pipeline token — this is a
# distinct user-scoped token used by the agent to discover + bind
# the production Workers Builds trigger):
#   - Workers Builds Configuration: Edit
#   - Workers Scripts: Read
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...   # from wrangler.production.jsonc#account_id
```

**Bootstrap flow (run in order; each is idempotent):**

```bash
# 1. Create the `my-web-2026` Infisical project + dev/prod envs,
#    write .infisical.json (workspaceId + defaultEnvironment).
pnpm run infisical:bootstrap:api

# 2. Create Machine Identity + Universal Auth + bind credentials to
#    the production Workers Builds trigger (in-memory secret
#    handling — client secret never touches disk / stdout / log).
pnpm run infisical:bootstrap:cf

# 3. Seed the dev env with the 3-name contract (random values).
#    PROD env is intentionally NOT seeded — operator imports the
#    current Worker `BETTER_AUTH_SECRET` + `MY_WEB_2026_CONSUMER_API_KEY`
#    plaintext via `infisical secrets set` manually, outside the
#    agent flow.
pnpm run infisical:seed

# 4. Fileless dev smoke (Windows-safe via Node spawn + shell:false).
#    Asserts all 3 contract keys are present in the dev env.
pnpm run infisical:verify
```

**Operator post-#67 work (NOT agent-automated; manual via Infisical
web UI or `infisical secrets set`):**

```bash
# Import current Cloudflare Worker `BETTER_AUTH_SECRET` plaintext.
infisical secrets set \
    --projectId="$(jq -r .workspaceId .infisical.json)" \
    --env=prod \
    BETTER_AUTH_SECRET=<current-worker-plaintext>

# Import current `MY_WEB_2026_CONSUMER_API_KEY` plaintext.
infisical secrets set \
    --projectId="$(jq -r .workspaceId .infisical.json)" \
    --env=prod \
    MY_WEB_2026_CONSUMER_API_KEY=<current-worker-plaintext>
```

**`BETTER_AUTH_SECRETS` for prod** is intentionally NOT seeded by
the agent. The versioned form activates only at the Phase 3+ flip
(separate production-side deploy ticket, human-gated per
`skills/github-delivery/SKILL.md` §Release PR merge human gate).

## Run

> **Secrets flow from Infisical, not from `.dev.vars`.** See
> [ADR-0015 §9](adr/ADR-0015-infisical-env-management.md) for the
> staged design. Local dev uses the dev environment of the
> Infisical project pinned by the committed `.infisical.json` in
> the repo root.

```bash
# Primary path — Windows-safe, fileless (no .dev.vars written).
# scripts/_run-dev.mjs spawns `pnpm exec infisical run --env=dev --
# pnpm exec vite dev` with shell:false. The CLI auto-resolves the
# project from .infisical.json; no --projectId needed.
pnpm dev
# -> http://127.0.0.1:3000

# Storybook (editorial visual-language preview, primitives, tokens)
pnpm storybook
# -> http://127.0.0.1:6006
```

### Fallback: `pnpm run generate:dev-vars`

Use the fallback when the Infisical CLI (`infisical` binary) is
unavailable on the workstation but **the self-hosted Infisical API at
`https://secrets.rebuildup.dev` is reachable AND a currently valid
`INFISICAL_TOKEN` is exported**. The fallback is **not** an offline
path — it still requires network access to the Infisical API and a
non-expired operator token — and it is **not** a CLI replacement for
operators who cannot meet those preconditions (use the primary
`pnpm dev` path instead, once `infisical login` succeeds).

The fallback script `scripts/generate-dev-vars.mjs` fetches the
keys listed in `wrangler.jsonc#secrets.required` via the documented
REST API and writes them to the gitignored `.dev.vars` (NOT the
committed `.dev.vars.example` documentation template):

```bash
# Operator supplies a short-lived Universal Auth token
export INFISICAL_TOKEN="<token>"
# Optional override (default: https://secrets.rebuildup.dev)
# export INFISICAL_API_URL="https://..."

pnpm run generate:dev-vars         # writes .dev.vars (mode 0600)
pnpm run generate:dev-vars -- --dry-run   # plan only, no file
```

The fallback ALWAYS mirrors exactly `wrangler.jsonc#secrets.required`
(it does not widen the set to match the full dev env seen by the
primary path). The current source-controlled contract is the
**versioned 2-name form**:

```jsonc
// from wrangler.jsonc#secrets.required
"BETTER_AUTH_SECRETS",
"MY_WEB_2026_CONSUMER_API_KEY"
```

`BETTER_AUTH_SECRET` (legacy single-secret form) is NOT in
`secrets.required`; it is retained in Infisical `prod` as an audit
trail (ADR-0015 §9 audit-only semantics) but is never uploaded to
the Worker — see `scripts/run-deploy-inner.mjs#AUDIT_ONLY_SECRETS`
for the deploy-time contract that prevents the legacy binding from
resurrecting on subsequent deploys. The legacy → versioned migration
is the production-side Phase B work (Issue #89), gated per
[`docs/runbook/cloudflare-workers-builds.md`](runbook/cloudflare-workers-builds.md).
Local `generate:dev-vars` does NOT need Phase B to run to function;
it always reads the current `secrets.required`.

`.dev.vars` is gitignored, written atomically (temp + rename, with
rollback on failure), and constrained to
`wrangler.jsonc#secrets.required` — anything else in Infisical is
silently ignored. The script never logs the secrets themselves; it
prints only key names + counts. After running the fallback,
`pnpm dev` continues to work (Infisical remains the primary path;
`.dev.vars` is only consulted by direct `wrangler dev` invocations).

### Local API mock layer (`LOCAL_API_MODE=mock`, Issue #166 / #186)

For visual verification against canned data — empty D1, no live
session, designer-driven UI screenshots — set `LOCAL_API_MODE=mock`
in the gitignored `.dev.vars` next to this README:

```bash
echo 'LOCAL_API_MODE=mock' >> .dev.vars
pnpm dev
```

The activation gate at `src/http/hono.ts` checks
`c.env.LOCAL_API_MODE === 'mock'` and forwards `/api/v1/*` to the
canned-data sub-app at `src/http/mock/`. The eight served endpoints
are `auth.session` / `auth.sign-in/email` / `auth.sign-out`,
`access.count` / `access.hit` / `access.principal`,
`reactions/:slug` / `reactions/:slug/toggle`. Anything outside that
set (portfolio, keys, emoji-catalog, auth-invitations) falls through
to the real routers even in mock mode.

**Why a vite-plugin override is needed.** `LOCAL_API_MODE` is
intentionally NOT in `wrangler.jsonc#vars` (production must never see
it) and NOT in `wrangler.jsonc#secrets.required` (it is not a secret
and adding it would widen the deploy-time required-secret contract).
Wrangler's `getVarsForDev` therefore filters `.dev.vars` entries down
to `vars ∪ secrets.required`, which means a plain
`LOCAL_API_MODE=mock` in `.dev.vars` would never reach `c.env` and
the gate would silently fall through. The fix is a `config()` callback
on the `cloudflare()` plugin in `vite.config.ts` that reads `.dev.vars`
once at config-load time and merges `LOCAL_API_MODE` (only) into
`workerConfig.vars`. Once the key lives in `vars`, the same wrangler
filter lets it through as a plain-text binding, and the gate fires.
The passthrough is opt-in: when `.dev.vars` is absent or carries no
`LOCAL_API_MODE` entry, the callback returns `undefined` and the
production boundary runs unchanged.

**Smoke verification (manual):**

```bash
pnpm dev &                              # start the dev server
curl -s http://127.0.0.1:3000/api/v1/access/count
# → {"count":1234}
curl -s http://127.0.0.1:3000/api/v1/reactions/home-page
# → {"reactions":[{"emoji":"👍","count":12}, …]}
curl -s -X POST http://127.0.0.1:3000/api/v1/access/hit \
  -H 'Content-Type: application/json' -d '{}'
# → {"incremented":true,"count":1235,"first_hit":1700000000000,"last_hit":1700000000000}
```

The gate's `LOCAL_API_MODE` check is strict-equality against the
literal string `"mock"`. Any other value (unset, empty, `on`, `1`,
`off`) routes through to the real production handlers — the mock
layer is the surgical opt-in, never the default.

**Regression tests:**

- `src/http/hono.test.ts` — the gate against the real
  `externalBoundary` (env=mock returns canned body; env unset or any
  other value falls through).
- `scripts/_dev-vars-reader.test.mjs` — the `.dev.vars` parser +
  override-builder (12 unit tests).

`LOCAL_API_MODE` MUST NOT be added to `wrangler.jsonc#vars` or
`secrets.required` — both widen the production deploy contract. The
canonical location for the flag is `.dev.vars` only.

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
