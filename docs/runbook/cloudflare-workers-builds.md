# Cloudflare Workers Builds — production delivery runbook

> Canonical production delivery path for `https://rebuildup.dev`.
> Source-controlled by Issue #71 (ADR-0015 Phase 5). Cross-linked
> from [`AGENTS.md §4`](../../AGENTS.md) and
> [`docs/adr/ADR-0015-infisical-env-management.md`](../adr/ADR-0015-infisical-env-management.md).

## Production deploy authority

The **only** production deployment authority is **Cloudflare Workers
Builds** triggered by pushes to `main`. Pushing to `main` runs the
configured Cloudflare build command and the production deploy command
inside the Cloudflare build environment. No agent, GitHub Actions job,
or local command makes a production deploy.

| Actor | Role | Production deploy? |
| --- | --- | --- |
| Cloudflare Workers Builds on `main` push | Production deploy | **Yes** (sole authority) |
| GitHub Actions (`.github/workflows/ci.yml`) | Validation + production smoke (manual) | **No** |
| Local `pnpm run deploy:production:prepared` (operator) | Recovery / debugging fallback only | **Yes, but NOT a canonical release path** |
| Local `pnpm run deploy:production` (umbrella command) | Same as above | **Yes, fallback only** |

## Workers Builds configuration

Configured under **Cloudflare Dashboard → Workers → `my-web-2026` →
Settings → Builds**:

| Field | Value |
| --- | --- |
| Git repository | `rebuildup/my-web-2026` |
| Production branch | `main` |
| Build command | `pnpm run build` |
| Deploy command | `pnpm run deploy:production:prepared` |
| Root directory | repository root |
| Build variables | `NODE_VERSION=22`, `PNPM_VERSION=12.3.4` |
| Build caching | enabled |
| Non-production branch builds | **disabled** — GitHub Actions owns PR/release validation |
| API token permissions | Worker deploy + route edit + **Account / D1 / Edit** (the deploy command applies pending D1 migrations before Wrangler deploy) |

## Runtime secrets — source of truth

Infisical `prod` environment is the **single source of truth** for
runtime secret VALUES. The Wrangler config declares the **set of
required NAMES**; Workers Builds fetches the values from Infisical at
deploy time, never hard-codes values in the repo, and never stores
values in `*.dev.vars` or committed files.

### Workers Builds credentials

| Name | Type | Lives in |
| --- | --- | --- |
| `INFISICAL_CLIENT_ID` | Machine Identity client id | Cloudflare Dashboard → Workers Builds → Environment variables |
| `INFISICAL_CLIENT_SECRET` | Machine Identity client secret | Cloudflare Dashboard → Workers Builds → Environment variables (sensitive) |

These are **NOT** runtime secrets — they are deploy-time credentials
the build environment uses to authenticate against Infisical Universal
Auth. The client secret never appears in build logs (Workers Builds
redacts `*_SECRET`, `*_TOKEN`, `*_KEY` variables from log output).

### Worker runtime secrets (source-controlled required names)

The current source-controlled contract is the **versioned 2-name form**:

| Name | SoT location | Phase |
| --- | --- | --- |
| `BETTER_AUTH_SECRETS` | Infisical `prod` | Phase 3+ (post-#89) |
| `MY_WEB_2026_CONSUMER_API_KEY` | Infisical `prod` | Phase 1+ (carried forward) |

Decoded in `wrangler.production.jsonc#secrets.required` and mirrored
in `wrangler.jsonc#secrets.required`. The deploy inner script
(`scripts/run-deploy-inner.mjs`) reads its `REQUIRED_RUNTIME_SECRETS`
from the same source.

### Audit-only legacy separator

`BETTER_AUTH_SECRET` is retained in Infisical `prod` as an **audit /
recovery copy only**. It is **NOT** in `wrangler*.jsonc#secrets.required`,
and `scripts/run-deploy-inner.mjs#AUDIT_ONLY_SECRETS` actively strips
it from the sanitized child-process environment and **never writes it
to `secrets.json`** (ADR-0015 §9 audit-only semantics; the legacy
binding cannot resurrect on the next deploy).

## Source-controlled contract vs live Worker state

These are **independent facts** at every point in time:

- The **source-controlled desired contract** is `wrangler*.jsonc#secrets.required`
  → versioned 2-name form.
- The **live Worker binding state** depends on the most recent
  deploy + the most recent Phase B driver operation.

During the post-incident Phase B window (#139 containment → #89 flip → … → delete-legacy-only),
the live Worker carries the legacy `BETTER_AUTH_SECRET` binding in
addition to `BETTER_AUTH_SECRETS`. The config comment in
`wrangler.production.jsonc#secrets.required` is the **next deploy's
contract**, not a claim about the current Worker state.

To inspect live state without leaking values:

```bash
pnpm exec wrangler secret list --format json -c wrangler.production.jsonc
# → returns [{name: "BETTER_AUTH_SECRET"}, {name: "BETTER_AUTH_SECRETS"}, ...] (name-only)
```

## Canonical production release sequence (ADR-0015 §9 + Issue #124)

Sequencing is enforced by runbook; this is the **only** order that
keeps recovery paths well-defined. **Do not reorder.**

```text
#139 credential containment complete
       │  Better Auth production rotation + consumer API-key rotation
       │  + exposed Cloudflare token revoke/replace + dev Better Auth cleanup
       │
       ▼
#89 Phase B `flip` (Infisical write of versioned envelope + bulk put
       `BETTER_AUTH_SECRETS` to Worker via scripts/phase-3-plus-prod-flip.mjs)
       │  → Worker now carries BOTH legacy `BETTER_AUTH_SECRET` and
       │    versioned `BETTER_AUTH_SECRETS`. `main` runtime code still
       │    reads legacy (`BETTER_AUTH_SECRET`). The versioned binding
       │    is **inert** until #91 merge/deploy.
       ▼
Smoke #1 — transition smoke (PRE #91-merge; legacy runtime still active)
       │  Automated `pnpm run e2e:prod` (canonical surfaces green,
       │  `wrangler secret list` confirms versioned binding present).
       │  **Operator manual sign-in** at
       │  https://rebuildup.dev/admin/login with real production
       │  credentials; this verifies the **legacy runtime path** has
       │  not regressed during the binding flip (cookies must persist
       │  across reload). It does NOT validate the versioned runtime
       │  path — see "Smoke boundary semantics" below.
       │
       ├── failure → rollback-versioned-only → invesetigate → #89 NOT closed
       ▼
Release PR #91 (`release-x-y-z → main`) merged
       (operator explicit approval required per
       AGENTS.md §6 / release-merge-human-gate)
       │
       ▼
Cloudflare Workers Builds observes `main` push, builds, runs
       `pnpm run deploy:production:prepared` (applies pending D1
       migrations + Wrangler deploy with the versioned-2-name
       secrets.required). `main` runtime code now reads
       `BETTER_AUTH_SECRETS`; legacy binding still present as fallback.
       │
       ▼
Smoke #2 — versioned-runtime smoke (POST #91-merge/deploy; automated)
       │  `pnpm run e2e:prod` (canonical surfaces) +
       │  anonymous `GET /admin/login` returns 200 (the #106 fix
       │  in production: login form reachable without auth gate).
       │  `wrangler secret list` confirms both bindings still present.
       │
       ▼
Smoke #3 — versioned-runtime operator manual sign-in (POST #91-merge/deploy)
       │  Operator signs in to https://rebuildup.dev/admin/login
       │  with real production credentials; confirms session
       │  established and persists across reload. This is the FIRST
       │  smoke that exercises the versioned-runtime path.
       │
       ├── failure here → restore-legacy-only (re-adds BETTER_AUTH_SECRET
       │   to Worker via bulk put) → investigate → #89 NOT closed
       ▼
#89 Phase B `--delete-legacy-only` — strips the legacy Worker binding
       via bulk put `{"BETTER_AUTH_SECRET": null}` (Cloudflare API only;
       no Infisical mutation)
       │
       ▼
final drift check — `pnpm run infisical:check:cf -- --execute
       --environment=prod --worker-contract=final --require-live-worker`
       reports Tier 1 = versioned+audit set,
       Tier 2 = versioned 2-name, Tier 3 = versioned 2-name
```

## Smoke boundary semantics

The smokes look superficially similar but verify **different things**:

| Smoke | Code state | Binding state | Validates |
| --- | --- | --- | --- |
| **#1 (transition)** | `main` reads legacy `BETTER_AUTH_SECRET` | BOTH bindings bound (legacy + versioned) | Transition did not regress the legacy runtime; the versioned binding is observable via `wrangler secret list` but **inert** because `main` still reads legacy |
| **#2 (versioned, automated)** | `main` reads `BETTER_AUTH_SECRETS` | BOTH bindings bound | Canonical surfaces green on versioned runtime; anonymous `/admin/login` reachable (#106 production verification) |
| **#3 (versioned, manual)** | `main` reads `BETTER_AUTH_SECRETS` | BOTH bindings bound | Operator's real admin credential signs in successfully via versioned runtime; cookies persist |

**Critical invariant:** Smoke #1 **cannot** validate the
`BETTER_AUTH_SECRETS` runtime path because `main` does not read it
until #91 merges. Treating Smoke #1 as a versioned-runtime check
would yield a false-positive (legacy path signs in successfully and
the operator believes the versioned path is healthy). The
versioned-runtime check is therefore deferred to Smoke #2/#3.

## Deploy preflight contract

`deploy-with-secrets.mjs --execute` authenticates to Infisical once and
then runs `check-cf-secrets.mjs --execute --worker-contract=transition
--require-live-worker` **before** spawning the actual deploy. A non-zero preflight exit aborts
production deployment. `--require-live-worker` invokes `wrangler secret list`
through Wrangler's available Workers Builds authentication context; it does not
require duplicating the build token as a separate `CLOUDFLARE_API_TOKEN` build
secret. An explicit `CLOUDFLARE_API_TOKEN` remains supported for operator/local
diagnostics.

`transition` expects the live Worker to carry all three names during
the migration window:

- `BETTER_AUTH_SECRETS`
- `BETTER_AUTH_SECRET`
- `MY_WEB_2026_CONSUMER_API_KEY`

After post-deploy smoke passes and `--delete-legacy-only` succeeds,
the final drift check MUST use `--worker-contract=final --require-live-worker`, which expects
only the versioned two-name Worker contract while Infisical still keeps
the legacy audit/recovery copy.

## Recovery operations (Phase B driver)

`scripts/phase-3-plus-prod-flip.mjs` is the single Phase B driver.
Its mode grammar (v4):

| Operation | Mutates Infisical? | Mutates Worker binding? | Use when |
| --- | --- | --- | --- |
| `--dry-run --operation=flip` (default) | No | No | Verify the planned operation |
| `--execute --operation=flip` | Yes (prod `BETTER_AUTH_SECRETS` UPSERT) | Yes (`BETTER_AUTH_SECRETS` bulk put) | Initial Phase B — add versioned binding |
| `--execute --delete-legacy-only` | No | Yes (`BETTER_AUTH_SECRET` bulk null) | post-#91-merge / post-deploy, after Smoke #3 passes |
| `--execute --restore-legacy-only` | No (read-only) | Yes (`BETTER_AUTH_SECRET` bulk put) | Smoke #3 failure AFTER `delete-legacy-only` already ran |
| `--execute --rollback-versioned-only` | No | Yes (`BETTER_AUTH_SECRETS` bulk null) | Smoke #1 failure BEFORE `delete-legacy-only` (legacy runtime must remain readable) |

`flip` requires a **writer-scoped INFISICAL_TOKEN** with edit
permission on the prod env; the viewer Machine Identity is
read-only and fails-closed for `flip`. Other operations do not
require writer scope (they only mutate Worker bindings).

## GitHub Actions — validation only

`.github/workflows/ci.yml` runs `validate` (format + lint +
architecture + version + typecheck + test + build + wrangler
dry-run + lint:ci + build-storybook + cf-typegen-check on
release-branches). On PRs with the `ui-change` label and on
pushes to `main` / `release-*`, Playwright E2E runs against the
local dev server.

`.github/workflows/prod-smoke.yml` is a manual diagnostic workflow.
Operator-initiated only. Never wired to a push event.

GitHub Actions MUST NOT deploy production. There is no
`.github/workflows/deploy-production.yml`; production deploy
authority stays with Cloudflare Workers Builds.

## Forbidden in this runbook

- Direct `wrangler secret put` / `wrangler secret delete` invocations
  in production contexts (no stdin-pipe path, interactive `confirm()`).
  Use `wrangler secret bulk` with stdin JSON via the Phase B driver.
- `pnpm run deploy:production:prepared` invoked against production
  with `secrets.required` out of sync with the Worker binding state.
- Shell-embedded secret values in argv, CI logs, GitHub Actions
  output, or chat.
- `main` push produced by anything other than the canonical release
  PR merge. CI merges never include deploy.
- Local production deploy used to *replace* the canonical release
  path (recovery / debugging only).
- Re-uploading `BETTER_AUTH_SECRET` as a Worker binding during deploy
  — `AUDIT_ONLY_SECRETS` makes this structurally impossible in
  `scripts/run-deploy-inner.mjs`.

## References

- [`docs/adr/ADR-0015-infisical-env-management.md`](../adr/ADR-0015-infisical-env-management.md)
  §1 (Infisical SoT) / §6 (consumer API key) / §9 (wrangler
  secrets.required staged design + audit-only semantics).
- [`AGENTS.md §4`](../../AGENTS.md).
- `scripts/reconcile-prod-auth-secret.mjs` — #122 driver.
- `scripts/phase-3-plus-prod-flip.mjs` — #89 Phase B driver
  (mode grammar: `flip` / `delete-legacy-only` / `restore-legacy-only` /
  `rollback-versioned-only`).
- `scripts/deploy-with-secrets.mjs` — Universal Auth login + HTTPS POST
  body (shell-less argv).
- `scripts/run-deploy-inner.mjs` — `REQUIRED_RUNTIME_SECRETS` /
  `AUDIT_ONLY_SECRETS` separation + `collectSecrets()` invariant.
- `scripts/check-cf-secrets.mjs` — phase-aware drift logic.
- Issues #71, #89, #122, #124, #91.
