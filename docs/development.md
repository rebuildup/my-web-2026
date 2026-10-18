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

**Calling the write endpoints directly in dev.** With the mock gate
off, `/api/v1/*` writes go through `csrfGuard`
(see [`docs/security.md`](security.md#csrf)), which requires a
same-origin signal. A `curl` therefore has to declare the origin it
is calling:

```bash
curl -s -X POST http://127.0.0.1:3000/api/v1/access/hit \
  -H 'Authorization: Bearer …' \
  -H 'Origin: http://127.0.0.1:3000' \
  -H 'Content-Type: application/json' -d '{}'
# without -H 'Origin: …' → 403 {"error":"csrf_rejected","reason":"origin_check_missing"}
```

Reads need no header. The first-party server functions are unaffected:
they self-call the boundary with the origin they are calling (see
`src/home/{access,reactions}/load.ts`).

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
pnpm run validate:fast         # read-only gate chain (see quality/profile.yaml for the ordered component list)
pnpm run validate:integration  # + build + wrangler:dry-run + lint:ci + build-storybook
pnpm run validate:release      # + cf-typegen:check
```

`pnpm run compat:check` は Web API / CSS の採用可否を Baseline（web-features）で
判定する gate（Issue #414）。走査面は `src/**` に加えて生成 CSS の入力である
`panda.config.ts`（`app-shell` surface の `files`）で、`src/` 以外のファイルは
surface に明示しない限り走査されない。バー未満の採用は fallback 要件が明示され
evidence が検証できた場合のみ warning、fallback 宣言が無い採用は fail。定義は
`quality/browser-baseline.json`、詳細は
[`docs/verification/standards/browser-baseline.md`](verification/standards/browser-baseline.md)。

CI (`.github/workflows/ci.yml`) runs `validate:integration` from the
`validate` job on every PR and every push to `main` / `release-*`.
The same job also installs the Playwright Chromium binary and runs
the E2E suite against `pnpm dev`.

Two workflow gates exist because they answer different questions:
`lint:ci` (actionlint) owns YAML syntax, and
[`ci:pins:check`](security/supply-chain-actions-pinning.md) owns the
Actions supply chain — pinned commit SHAs, least-privilege job
tokens, and the rule that CI can neither read a secret value nor
deploy production or publish a Release.

`validate:fast` additionally runs `pnpm run install:scripts:check`,
the dependency install lifecycle script audit (Issue #474). It fails
when an installed dependency can execute code during `pnpm install`
(a `preinstall` / `install` / `postinstall` hook, the implicit
`node-gyp rebuild` of a package that ships `binding.gyp`, or the
`prepare` of a git-hosted dependency) that the reviewed policy in
`quality/install-scripts.json` has no record for, or when that record
and pnpm's execution allow-list (`pnpm-workspace.yaml`) disagree. See
[`docs/runbook/install-script-audit.md`](runbook/install-script-audit.md).

### Route × quality-gate coverage

The published route roster and the quality gates that measure it are
kept in sync by a cheap gate that runs inside `validate:fast`:

```bash
pnpm run routes:quality:check  # quality/route-coverage.json vs src/routes/**
pnpm run routes:quality:report # .tmp/route-quality-report.html (no browser needed)
```

Adding a route file without a `quality/route-coverage.json` entry fails
the gate on purpose: the PR must add the route as a gate target, or
exclude it with a reason for every gate family. See
[`docs/verification/quality/route-quality-coverage.md`](verification/quality/route-quality-coverage.md).

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
  In Smoke #2 (`pnpm run e2e:prod`, POST-deploy) it also registers the
  five representative routes (`/`, `/about`, `/portfolio`, `/tools`,
  `/api/v1/health`) and checks each one's HTTP response, short
  navigation path, and documented default state, read-only. Smoke #1
  (`pnpm run e2e:prod:transition`) skips them: it runs PRE-merge, while
  production still serves the previous `main` build and the registry is
  release-branch data.
- `pnpm run e2e:prod:local` runs the same spec file against the LOCAL
  preview build (`http://127.0.0.1:3000`), so the Issue #500
  representative-route contract is reproducible offline. It builds the
  working tree first and forces the localhost origin even if the parent
  shell exported a production `PLAYWRIGHT_BASE_URL`; the Issue #43
  canonical-origin group (which hardcodes the canonical origin, including
  the one deliberate write, the anonymous reaction mutation) skips itself
  in local mode, and subresource requests to any other origin are aborted
  before navigation.

```bash
pnpm run e2e:install     # one-time: chromium browser + system deps
pnpm run e2e             # run smoke.spec.ts; auto-starts pnpm dev locally
# Production smoke (Issue #43 / ADR-0014):
pnpm run e2e:prod        # runs prod-smoke.spec.ts against https://rebuildup.dev
# Offline rehearsal of the Issue #500 representative-route contract:
pnpm run e2e:prod:local  # same spec file against http://127.0.0.1:3000
```

The E2E suite asserts the four public surfaces documented in
`docs/architecture.md`:

- `GET /` (200, SSR HTML)
- `GET /api/v1/health` (200, `{status:'ok',...}`)
- `GET /api/v1/db/ping` (200, `{one:1,...}` against the D1 binding)
- `GET /api/v1/media/ping` (404, `key_not_found` against the R2 binding)
`playwright.config.ts` ignores every `prod-*.spec.ts` when
`PLAYWRIGHT_BASE_URL` points at localhost, so `pnpm run e2e` can never
reach the canonical production origin. The single documented exception is
`pnpm run e2e:prod:local`, which builds first, sets
`E2E_LOCAL_PROD_SMOKE=1`, and forces the base URL to localhost. The
production representative-route
contract is DATA in `scripts/prod-smoke-routes.mjs`; its pass/fail
classifier `auditRoute()` is unit-tested offline by
`scripts/prod-smoke-routes.test.mjs` (wired into `pnpm run test`), so the
smoke logic is verified without a network, without workerd, and without a
browser. Each observation carries the final (post-redirect) origin and
pathname, and the classifier rejects either kind of drift, so a route that
answered from another host cannot pass as a healthy canonical origin.

## Bundle map (Issue #483)

`pnpm run verify:bundle-map` renders a **report** about an emitted client
build: which chunks each route loads and what they cost, which chunks are
duplicated, which are unreachable, and whether any host route pulls in the
Tool artifacts under `tools/**`. It reads the build output only — no
network, no Cloudflare API, no production read — and it is wired into no
`validate:*` entry point, so it can never block a build or a release.
`quality/profile.yaml#diagnostic_entry_points` records the same contract.

```bash
pnpm exec vite build                                   # emit the client build
node scripts/build-tools.mjs                           # Tool artefacts
node scripts/sync-cf-build-output.mjs                 # copy them into Build Output
node scripts/e2e-local-bootstrap.mjs --port=3000       # preview server (terminal 1)
pnpm run verify:bundle-map -- --base-url=http://127.0.0.1:3000
```

Without `--base-url` the script still runs a static pass over the emitted
files; the route matrix and the Home Tool-isolation finding need the
measurement and are reported as not measured.

The committed snapshot lives at
[`docs/verification/perf/bundle-map.md`](../docs/verification/perf/bundle-map.md),
with its screenshot at `docs/verification/perf/bundle-map.webp`
(Issue #483 names a `.png`; the WebP substitution is stated in the PR body).
Regenerate both when the client chunking changes.

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

## Public-route head metadata gate

Issue #418 added a gate over the `<head>` of every public route:
title / description / canonical for the indexable surface, a
`noindex` policy for `/admin/*`, a no-canonical policy for 404
documents, and a query-free canonical for search-query URLs.

```bash
# CI gate (runs inside `pnpm run validate:fast` via `pnpm test`):
pnpm exec vitest run test/integration/seo-head.test.ts

# Point the same policy at any origin (dev server, vite preview, …):
pnpm run seo:head:check -- --live http://localhost:5173
pnpm run seo:head:check -- --live http://localhost:5173 --html .tmp/seo-head-report.html

# Regenerate the verification screenshot:
pnpm run verify:seo-head-screenshot
```

The policy lives in `scripts/seo-head-contract.mjs`; the CI test and
the `--live` CLI are two front-ends over that one engine. The route
inventory is the framework's own route tree, so a new route without
description / canonical metadata fails the gate instead of quietly
passing (the root layout's fallback title means a route that forgot
its own title is caught as a duplicate title, not as a missing one).
A request that errored is a finding too — an unfetched route is never
a pass. Details and the last report are in
`docs/verification/seo/head-metadata-check.md`.

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
