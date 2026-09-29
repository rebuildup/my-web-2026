# Infisical secrets — canonical organization

> Canonical operator reference for the `my-web-2026` Infisical
> workspace. Source-controlled by Issue #167. Cross-linked from
> [`AGENTS.md §4`](../../AGENTS.md),
> [`ADR-0015`](../adr/ADR-0015-infisical-env-management.md), and
> [`docs/runbook/cloudflare-workers-builds.md`](cloudflare-workers-builds.md).
>
> **Scope.** This runbook answers three operator questions:
>
> 1. *What secret lives where?* (workspace, environment, name)
> 2. *Who is responsible for rotation, and on what cadence?*
> 3. *How do I add / rotate / verify a secret without ever
>    listing its value?*
>
> **No-value-listing.** AGENTS.md §4 forbids value-listing against
> real environments (originating incident: Issue #139, 2026-09-28).
> Every operator flow in this runbook uses dedicated scripts that
> emit **status-only output** (`MATCH` / `DIFFER` / `MISSING` /
> `PRESENT`). No secret value is ever printed to stdout, logs,
> chat, argv, or a commit message while following these flows.

## 1. Overview

### 1.1 Workspace

| Field | Value | Source |
| --- | --- | --- |
| Project name | `my-web-2026` | `scripts/infisical-bootstrap-api.mjs` (Issue #67, Phase 1) |
| Workspace ID (project pointer) | `89cda9cb-31ab-4ace-afe9-f155024850d1` | `.infisical.json#workspaceId` (committed, no secrets) |
| Instance | self-host (`https://secrets.rebuildup.dev`) | ADR-0015 §1 |
| API URL (overridable) | `https://secrets.rebuildup.dev` (default in `scripts/deploy-with-secrets.mjs`) | `INFISICAL_API_URL` env var override supported |
| Auth path | Universal Auth (HTTPS POST `/api/v1/auth/universal-auth/login`) | ADR-0015 §3; `INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` |

### 1.2 Environments

| Slug | Display name | Purpose | Created by | Status |
| --- | --- | --- | --- | --- |
| `dev` | `Development` | Local / agent development. Random seed via `scripts/infisical-seed.mjs --env=dev`. | `scripts/infisical-bootstrap-api.mjs` (Issue #67, Phase 1) | **Active** |
| `prod` | `Production` | Source of truth for runtime secret VALUES that the production Worker binds. Seeding path is operator-only — `infisical-seed.mjs --env=prod` is **hard-rejected** (ADR-0015 §11.7 zero-prod-seeds rationale). | `scripts/infisical-bootstrap-api.mjs` (Issue #67, Phase 1) | **Active**, intentionally under-populated |

### 1.3 Staging

**There is no `staging` environment in the workspace at this time.**
ADR-0015 §3 leaves `INFISICAL_API_URL` overridable for a future
staging / dev override, but no staging environment has been
provisioned. If a future release requires a staging environment:

1. Provisioning goes through `scripts/infisical-bootstrap-api.mjs`
   (idempotent environment create path).
2. The seed/rotation scripts that gate on `prod` (`infisical-seed.mjs`)
   must be extended first; do not bypass by passing `--env=staging`.
3. `wrangler.jsonc` (default / local-dev) does not gain a `staging`
   `vars.BETTER_AUTH_URL` until a Cloudflare zone is provisioned for it.
4. `check-cf-secrets.mjs` currently validates `--environment=prod|dev`
   only; add `--environment=staging` together with the env itself
   (gate: this runbook update + ADR amendment + a release ticket).

### 1.4 Design intent

The runtime / build credentials are governed by ADR-0015's SoT
boundary. Infisical is the SoT **only** for runtime secrets and
deploy-time credentials; static non-secret vars (`MY_WEB_2026_*`,
`BETTER_AUTH_URL`, etc.) and identifiers (`database_id`,
`zone_id`) stay in Wrangler config. Cloudflare-controlled
credentials (Workers Builds API token) stay in Cloudflare UI.

| Concern | SoT | Reason |
| --- | --- | --- |
| Runtime secret VALUES | **Infisical `prod` / `dev`** | The runtime secret cannot be re-read from Cloudflare, so a separate store is required |
| Static non-secret vars | Wrangler config (`vars`) | Required to keep `worker-configuration.d.ts#Env` typed |
| Identifiers (`database_id`, `bucket_name`, `zone_id`, `account_id`, `namespace_id`) | Wrangler config | Non-secret — source-controlled contract is more reliable than operator recall |
| Cloudflare Workers Builds native API token | Cloudflare UI (cannot be moved) | Cloudflare authentication boundary |
| `INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` | Cloudflare Workers Builds env vars (not Infisical) | Build-time only; Worker runtime must never see them |

## 2. Secret inventory

### 2.1 Names only

The complete runtime secret inventory, sourced from ADR-0015 §2
and pinned by `wrangler*.jsonc#secrets.required` and
`scripts/run-deploy-inner.mjs#REQUIRED_RUNTIME_SECRETS` /
`AUDIT_ONLY_SECRETS`:

| Name | Lives in (prod) | Lives in (dev) | Purpose | Rotation owner | Cadence | Tier (ADR-0015 §7) |
| --- | --- | --- | --- | --- | --- | --- |
| `BETTER_AUTH_SECRETS` | Infisical `prod` | Infisical `dev` | Better Auth 1.5+ versioned rotation. Comma-separated `version:value` pairs, highest version first. `src/cloudflare/auth/better-auth.ts` parser is strict: unique versions, strictly descending order, decimal digits only, no empty segments. | Repository owner (operator gate) | On suspected compromise or quarterly review | **Tier 1 (runtime)** — required Phase 3+ |
| `BETTER_AUTH_SECRET` | Infisical `prod` (audit-trail / recovery only) | Infisical `dev` (random seed) | Better Auth legacy single-form signing material. **Phase 3+ audit-only semantics**: NOT in `wrangler*.jsonc#secrets.required`, NOT in `REQUIRED_RUNTIME_SECRETS`, never written to `secrets.json` by `scripts/run-deploy-inner.mjs#AUDIT_ONLY_SECRETS`. Stripped from sanitized child env. | Repository owner (operator gate) | Only as part of `BETTER_AUTH_SECRETS` envelope rotation | **Tier 1 (runtime)** — audit-only Phase 3+ |
| `MY_WEB_2026_CONSUMER_API_KEY` | Infisical `prod` | Infisical `dev` (random seed, no D1 row depends on it) | Home self-consumption consumer API key (ADR-0011). Bound to Worker `env.MY_WEB_2026_CONSUMER_API_KEY`. Pairs with D1 `apikey` row `name='home-self-consumption'` (`UNIQUE(apikey.key)` enforces SHA-256 hash uniqueness). | Repository owner (operator gate) | On suspected compromise or as needed | **Tier 1 (runtime)** — required Phase 1+ |
| `GOOGLE_ANALYTICS_MEASUREMENT_ID` | Infisical `prod` (placeholder `G-PLACEHOLDER000` seeded at #187 merge; operator replaces with real `G-XXXXXXX` BEFORE cutting traffic) | Infisical `dev` (placeholder seeded; operator may replace if dev GA property exists) | GA4 measurement ID (Issue #171, Issue #187). Bound to Worker `env.GOOGLE_ANALYTICS_MEASUREMENT_ID`. Public identifier; the var→secret move in Issue #187 is operator-ergonomic (Infisical dashboard editability), NOT a security containment change. Operator gate: replace prod placeholder with real `G-XXXXXXX` before production traffic — see `docs/runbook/analytics.md` and the canonical sequence step in `docs/runbook/cloudflare-workers-builds.md`. | Repository owner (operator gate) | Rare (property migration / leak-driven) | **Tier 1 (runtime)** — required Issue #187+ |

### 2.2 Deploy-time credentials (NOT in Infisical)

These are managed in Cloudflare Workers Builds env vars (build
container only; Worker runtime never sees them). They are listed
here for completeness so the operator can distinguish *what is in
Infisical* from *what is in Cloudflare*.

| Name | Lives in | Purpose | Rotation owner | Cadence |
| --- | --- | --- | --- | --- |
| `INFISICAL_CLIENT_ID` | Cloudflare Dashboard → Workers Builds → Environment variables | Universal Auth identity for production deploys | Repository owner (operator gate) | On suspected compromise; rotate before re-issue |
| `INFISICAL_CLIENT_SECRET` | Cloudflare Dashboard → Workers Builds → Environment variables (sensitive, redacted in logs) | Universal Auth secret for production deploys | Repository owner (operator gate) | Same cadence as `INFISICAL_CLIENT_ID` (rotate as a pair) |

**Invariant.** These are deploy-time credentials. They are not
runtime secrets and do not appear in `wrangler*.jsonc`. The deploy
script (`scripts/deploy-with-secrets.mjs`) consumes them via
HTTPS POST body and never echoes them to stdout/log.

### 2.3 Audit-only vs required (current state)

| Contract source | Names |
| --- | --- |
| `wrangler.jsonc#secrets.required` | `BETTER_AUTH_SECRETS`, `MY_WEB_2026_CONSUMER_API_KEY`, `GOOGLE_ANALYTICS_MEASUREMENT_ID` |
| `wrangler.production.jsonc#secrets.required` | `BETTER_AUTH_SECRETS`, `MY_WEB_2026_CONSUMER_API_KEY`, `GOOGLE_ANALYTICS_MEASUREMENT_ID` |
| `scripts/run-deploy-inner.mjs#REQUIRED_RUNTIME_SECRETS` | `BETTER_AUTH_SECRETS`, `MY_WEB_2026_CONSUMER_API_KEY`, `GOOGLE_ANALYTICS_MEASUREMENT_ID` |
| `scripts/run-deploy-inner.mjs#AUDIT_ONLY_SECRETS` | `BETTER_AUTH_SECRET` |

These three static sources MUST agree. The agreement is enforced
by `scripts/check-infisical-coverage.mjs` (CI-runnable, pure
static lint).

### 2.4 Live Worker binding

To inspect the live Worker binding state without leaking values:

```bash
pnpm exec wrangler secret list --format json -c wrangler.production.jsonc
# → returns names only (Wrangler exposes values via bulk JSON
#   upload only, not list). Cross-check against
#   `wrangler.production.jsonc#secrets.required` + Tier 1 inventory.
```

During the Phase B window (`#139` containment → `#89` flip →
`#91` merge / Cloudflare Workers Builds deploy → `--delete-legacy-only`),
the live Worker carries `BETTER_AUTH_SECRET` in addition to
`BETTER_AUTH_SECRETS`. The expected contract per phase is documented
in `docs/runbook/cloudflare-workers-builds.md` (Smoke boundary
semantics table).

## 3. Naming convention

### 3.1 Current convention (do not churn)

The existing names are NOT prefixed by environment — the
environment is **the path dimension**, the name is **the secret
identity**. Renaming is forbidden while a Worker binding depends
on the old name.

| Prefix | Meaning | Examples |
| --- | --- | --- |
| `BETTER_AUTH_*` | Better Auth signing material (ADR-0009) | `BETTER_AUTH_SECRETS`, `BETTER_AUTH_SECRET` |
| `MY_WEB_2026_*` | Project-scoped runtime secrets | `MY_WEB_2026_CONSUMER_API_KEY` |
| `INFISICAL_*` | Universal Auth / client identity (deploy-time, not Infisical) | `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET` |

**Why no env suffix?** Wrangler reads secrets by exact name from
`process.env` at runtime. Suffixing `MY_WEB_2026_CONSUMER_API_KEY_PROD`
would require source changes in `src/server.ts` /
`scripts/run-deploy-inner.mjs` to select the right name per
environment. ADR-0015 §1 SoT boundary makes env selection the
Infisical path's job (`infisical run --env=prod`).

### 3.2 Future naming — what to follow when adding a new name

When a new secret is added, the operator / authoring ticket MUST
follow this template:

```text
{PRODUCT_OR_LIB}_{ROLE}
```

- `PRODUCT_OR_LIB` is the upstream library or product the secret
  binds to (`BETTER_AUTH`, `MY_WEB_2026`, future `STRIPE`,
  `GITHUB_APP`, etc.). This is a stable identity.
- `ROLE` is a brief role description (`SECRETS`, `SECRET`,
  `CONSUMER_API_KEY`, `WEBHOOK_SECRET`). Upper-snake-case.
- No env suffix.
- No random / generated suffix.
- Length ≤ 64 chars (Wrangler secret name limit).

A `{service}_{env}_{name}` style is rejected because (a) env
selection is the Infisical path, (b) suffixing doubles the surface
of `secrets.required` declarations, and (c) it conflicts with the
strict Better Auth parser at `src/cloudflare/auth/better-auth.ts`
which expects a fixed name.

## 4. Operator flows

### 4.1 Add a new secret

1. **Decision first.** Confirm the value is a runtime secret or
   deploy-time credential that belongs in Infisical / Workers
   Builds, NOT a static non-secret var (which belongs in
   `wrangler.jsonc#vars`) and NOT a Cloudflare-only auth boundary.
   See ADR-0015 §1 SoT boundary table.
2. **Pick the name** per §3.2.
3. **Add the name** to BOTH `wrangler.jsonc#secrets.required` and
   `wrangler.production.jsonc#secrets.required` (for runtime
   secrets only — deploy-time credentials are NOT in
   `secrets.required`).
4. **Add the name** to `scripts/run-deploy-inner.mjs#REQUIRED_RUNTIME_SECRETS`.
   If the secret is audit-only (read by Cloudflare but never
   uploaded to Worker on deploy), add it to `AUDIT_ONLY_SECRETS`
   instead and document why in the file comment.
5. **Seed the value** into Infisical `dev` first via
   `scripts/infisical-seed.mjs --env=dev` (or operator-driven
   `infisical secrets set NAME=value --env=dev` for non-random
   values). NEVER use `infisical-seed.mjs --env=prod` — that path
   is hard-rejected (ADR-0015 §11.7).
6. **Operator imports the prod value** manually via
   `infisical secrets set NAME=value --env=prod` outside the
   agent flow (ADR-0015 §11 Initial migration).
7. **Run drift check.** `pnpm run infisical:check:coverage` must
   PASS (static contract).
8. **Document** the new name in §2 of this runbook (PR included
   in the same ticket).
9. **Deploy.** `pnpm run deploy:production:prepared` will pick the
   value up; production deploys MUST go through the canonical
   release path described in `docs/runbook/cloudflare-workers-builds.md`
   (Cloudflare Workers Builds owns production deploy authority).

### 4.2 Rotate a runtime secret

For each name, the canonical driver is pinned:

| Name | Driver | Runbook |
| --- | --- | --- |
| `BETTER_AUTH_SECRETS` (preferred) / `BETTER_AUTH_SECRET` (legacy, audit-only) | `scripts/rotate-better-auth-secret.mjs` (operator-gated `--execute`) | `docs/runbook/issue-139-rotation.md` |
| `MY_WEB_2026_CONSUMER_API_KEY` | `scripts/rotate-home-api-key.mjs` (operator-gated `--execute`) | `docs/runbook/consumer-api-key-rotation.md` |

**Generic rotation discipline (binding for all paths):**

- **Plaintext is one-time output** at creation. Never echo it
  into chat, GitHub, log, or argv.
- **Hash comparison is the only verification primitive.**
  Compare `sha256(plaintext).digest('base64url')` in-process; never
  print plaintext to compare.
- **Operator gate** — destructive operations (mint new + revoke
  old) require operator authorization in the current interaction
  (AGENTS.md §6 / `release-merge-human-gate` spirit).
- **Pair integrity** — `MY_WEB_2026_CONSUMER_API_KEY` rotates as
  a pair (Infisical `prod` + Worker binding + D1 `apikey` row).
  The D1 row is the rotation anchor.
- **Smoke after rotation** — `pnpm run e2e:prod` (or
  `pnpm exec infisical run --env=prod -- node -e "<smoke>"` for
  fileless verification) MUST observe the new value before the
  old is destroyed.

### 4.3 Verify drift

| What | Script | When |
| --- | --- | --- |
| Static contract (Infisical name / wrangler config / deploy script alignment) | `pnpm run infisical:check:coverage` | Every `validate:fast` (CI) and before every release |
| Tier 1 Infisical ↔ Tier 2 wrangler ↔ Tier 3 live Worker binding (name parity only) | `pnpm run infisical:check:cf -- --execute --environment=prod --worker-contract=transition\|final` | Pre-deploy preflight + post-deploy drift check |
| Dev env presence (Boolean markers only) | `pnpm run infisical:verify` | After every dev secret seed / change |
| Value drift | **NOT done by design** | Cloudflare secret VALUES cannot be re-read (Cloudflare API has no value-read endpoint) |

### 4.4 Inspect live Worker bindings

```bash
pnpm exec wrangler secret list --format json -c wrangler.production.jsonc
# Name-only output. No value.
```

Use this together with `pnpm run infisical:check:cf -- --execute --environment=prod --require-live-worker`
to confirm Tier 1 / Tier 3 name parity after any deploy.

## 5. Cross-references

- [ADR-0015 §1 SoT boundary](../adr/ADR-0015-infisical-env-management.md#1-sot-境界)
- [ADR-0015 §2 Infisical project構成](../adr/ADR-0015-infisical-env-management.md#2-infisical-project-構成)
- [ADR-0015 §6 consumer API key rotation](../adr/ADR-0015-infisical-env-management.md#6-my_web_2026_consumer_api_key-rotation-runbook)
- [ADR-0015 §7 drift detection](../adr/ADR-0015-infisical-env-management.md#7-drift-検出)
- [ADR-0015 §9 wrangler secrets.required staged design](../adr/ADR-0015-infisical-env-management.md#9-wranglerjsonc-への-secretsrequired-追加-phase-別-staged-設計)
- [ADR-0015 §11 Initial migration](../adr/ADR-0015-infisical-env-management.md#11-initial-migration)
- [AGENTS.md §4 Cloudflare services policy](../../AGENTS.md)
- [Cloudflare Workers Builds runbook](cloudflare-workers-builds.md)
- [Consumer API key rotation runbook](consumer-api-key-rotation.md)
- [Issue #139 rotation runbook](issue-139-rotation.md)
- [Issue #74 rotation runbook](issue-74-rotation.md)
- `scripts/deploy-with-secrets.mjs` — Universal Auth login + child-process env discipline
- `scripts/run-deploy-inner.mjs` — `REQUIRED_RUNTIME_SECRETS` / `AUDIT_ONLY_SECRETS` separation
- `scripts/check-cf-secrets.mjs` — Tier 1 / Tier 2 / Tier 3 drift logic
- `scripts/check-infisical-coverage.mjs` — static 3-source agreement
- `scripts/infisical-seed.mjs` — dev-env 3-name seed (prod hard-rejected)
- `scripts/rotate-better-auth-secret.mjs` — Issue #155 driver
- `scripts/rotate-home-api-key.mjs` — Issue #74 driver (rotation follow-up)
- `scripts/phase-3-plus-prod-flip.mjs` — Issue #89 Phase B driver
- `.infisical.json` — committed workspace pointer (`workspaceId` only, no secrets)

## 6. Forbidden patterns (restated from AGENTS.md §4)

The originating incident (Issue #139, 2026-09-28) was an
`infisical secrets --env=dev --path=/` invocation whose plaintext
output was rendered into agent transcript, exposing four production
credentials. The same anti-pattern includes (non-exhaustive):

- `infisical secrets list ...` / `infisical secrets --env=...
  --path=...` / `infisical secrets get <name> --plain` (real value
  surfaces to stdout).
- `wrangler secret:list --format pretty` or any wrangler secret
  subcommand that exposes values (Wrangler exposes names only via
  `wrangler secret list --format json`; the agent must rely on
  the name-only contract).
- `curl https://app.infisical.com/api/v3/secrets/raw/<name>` or any
  HTTPS call that requests `viewSecretValue=true` against a real
  environment unless explicitly authorized in the current
  interaction AND the response is consumed inside a dedicated
  script that prints status-only output (`MATCH` / `DIFFER` /
  `MISSING`) and NEVER the value itself.
- Direct `echo $VAR` / `printenv` / `cat .dev.vars` of any
  environment that holds a real production credential.

**The canonical replacement path** is a dedicated comparison script
that captures → compares → emits status-only output. Agents MUST
prefer these scripts over ad-hoc debugging shortcuts that print
values:

- `scripts/rotate-better-auth-secret.mjs --verify-only`
- `scripts/reconcile-prod-auth-secret.mjs --verify`
- `scripts/check-cf-secrets.mjs --execute`
- `scripts/check-infisical-coverage.mjs` (static, no values)

**Secret value comparison via dedicated script (status-only output)
is NOT a debugging shortcut.** It is the canonical verification
surface. The forbidden patterns above are the shortcuts.

## 7. Update discipline

When this runbook changes:

- Inventory table edits MUST accompany a code change in
  `wrangler*.jsonc#secrets.required` and
  `scripts/run-deploy-inner.mjs` (Tier 1/2/3 contract).
- Naming convention changes (§3) MUST be a breaking change for any
  in-flight rotation ticket and require an ADR amendment.
- Operator flows (§4) MUST point at scripts that exist in
  `scripts/`. If the referenced script is deleted, update the
  flow in the same PR — dead links in a runbook are worse than no
  runbook.
- This file is cross-linked from AGENTS.md §4. Any structural
  rename must update AGENTS.md in the same PR.
