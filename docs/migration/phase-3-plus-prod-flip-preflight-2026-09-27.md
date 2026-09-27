# Phase 3+ production flip preflight (Issue #89) — 2026-09-27

> Status: **read-only verification, NOT execution**
> Visibility: internal-only ops doc
> Grounded: 2026-09-27

This document is the agent-side preflight evidence for the Phase 3+
production secret flip (`BETTER_AUTH_SECRET` → `BETTER_AUTH_SECRETS`
versioned 2-name). It was produced by read-only operations against:

- the local repo at `release-0-5-0 @ 3240cfffef20db446d3ddc014aa5885ef190864c`
  and `release-0-4-0 @ 6236f48277b96a8ea1cccafeacba41d71ea9abc0`
- the Cloudflare Worker (read-only via `wrangler secret list` / `wrangler deployments list`)
- the Phase B driver dry-run (`scripts/phase-3-plus-prod-flip.mjs --dry-run`)

**No secret values appear in this document.** No write operations
were performed. No production mutation has occurred.

## 0.4 vs 0.5 contract consistency (post-fetch)

| Surface | release-0-4-0 | release-0-5-0 | Match |
|---|---|---|---|
| `wrangler.production.jsonc#account_id` | `c6ab6651a5d4d6d0d07686bbd3c3d56f` | same | ✓ |
| `wrangler.production.jsonc#vars.BETTER_AUTH_URL` | `https://rebuildup.dev` | same | ✓ |
| `wrangler.production.jsonc#vars.MEDIA_PUBLIC_BASE_URL` | (absent) | `https://media.rebuildup.dev` | 0.5-only (expected) |
| `wrangler.production.jsonc#secrets.required` | `["BETTER_AUTH_SECRETS", "MY_WEB_2026_CONSUMER_API_KEY"]` | same | ✓ |
| `scripts/run-deploy-inner.mjs#REQUIRED_RUNTIME_SECRETS` | `['BETTER_AUTH_SECRETS', 'MY_WEB_2026_CONSUMER_API_KEY']` | same | ✓ |
| `scripts/run-deploy-inner.mjs#AUDIT_ONLY_SECRETS` | `['BETTER_AUTH_SECRET']` | same | ✓ |
| `scripts/phase-3-plus-prod-flip.mjs` | 4 operations | 4 operations | ✓ |

Both branches now have the **versioned 2-name** contract on the Worker
side, with `BETTER_AUTH_SECRET` relegated to `AUDIT_ONLY_SECRETS`
(Infisical audit trail, never re-uploaded). The 0.5-only
`MEDIA_PUBLIC_BASE_URL` is the deliberate forward-sync addition from
PR #105 (Issue #104).

## Phase B driver — 4-operation dry-run (read-only)

All 4 operations were run with `--dry-run` (no side effects). Each
printout confirmed the planned operation and exited 0 without spawning
the Infisical CLI / `wrangler secret bulk` subprocess.

| Operation | Exit | Side effects | Plan |
|---|---|---|---|
| `flip` | 0 | none | read legacy plaintext from Infisical prod → write temp YAML → spawn `infisical secrets set --file` → spawn `wrangler secret bulk` with stdin `{"BETTER_AUTH_SECRETS":"1:<plaintext>"}` |
| `delete-legacy-only` | 0 | none | NO Infisical mutation; spawn `wrangler secret bulk` with stdin `{"BETTER_AUTH_SECRET":null}` |
| `restore-legacy-only` | 0 | none | HTTPS GET legacy plaintext from Infisical prod → spawn `wrangler secret bulk` with stdin `{"BETTER_AUTH_SECRET":"<plaintext>"}` |
| `rollback-versioned-only` | 0 | none | NO Infisical mutation; spawn `wrangler secret bulk` with stdin `{"BETTER_AUTH_SECRETS":null}` |

The `[dry-run] no side effects; pass --execute to apply` line was
printed for each operation. No temp YAML was written. No Infisical
mutation. No Worker mutation.

## Production state (read-only, 2026-09-27)

### Worker secret NAMES (current binding state)

```
BETTER_AUTH_SECRET           (legacy, STILL BOUND — Phase B will delete)
MY_WEB_2026_CONSUMER_API_KEY
```

`BETTER_AUTH_SECRETS` (versioned, plural) is **NOT yet bound**.
Phase A contract is in effect (legacy-only on Worker).

### Recent production deployments

| Date (UTC) | Author | Source | Note |
|---|---|---|---|
| 2026-09-11T17:02 | rebuild.up.up@gmail.com | Upload | Automatic deployment (v0.1.0 era) |
| 2026-09-20T03:51 | rebuild.up.up@gmail.com | Unknown | `BETTER_AUTH_SECRET` 追加 (version a63fe3d7) |

Current deployment is **legacy 1-name contract** (Phase A pre-#89).
This matches the production binding state above.

### Worker deployment health

`pnpm exec wrangler deployments list -c wrangler.production.jsonc`
returned the 2 deployments listed above. Both succeeded; no
deployment is in a "failed" state.

## Current execution environment — token availability

| Variable | Status | Required for Phase B |
|---|---|---|
| `INFISICAL_TOKEN` | **NOT SET** | Yes (`flip`, `restore-legacy-only`) |
| `INFISICAL_CLIENT_ID` | NOT SET | Optional (UA fallback for `restore-legacy-only`) |
| `INFISICAL_CLIENT_SECRET` | NOT SET | Optional (UA fallback for `restore-legacy-only`) |
| `CLOUDFLARE_API_TOKEN` | NOT SET | No (wrangler OAuth active) |
| `WRANGLER_API_TOKEN` | NOT SET | No (wrangler OAuth active) |

**The agent's current execution environment has NO writer
credentials.** Any `--execute` Phase B operation WILL fail at the
auth step (for `flip`) or at the Infisical-write step (for
`restore-legacy-only`).

The operator must supply `INFISICAL_TOKEN` (writer-scoped) at execute
time. **The chat has no connector to production-mutating credentials
by design.**

The wrangler OAuth at `~/.config/.wrangler/config/default.toml`
(`rebuild.up.up@gmail.com`) is ACTIVE. This OAuth silently authorizes
`wrangler secret bulk` calls. Per [[release-merge-human-gate]] +
[[issue-99-driver-incident]], **NEVER invoke `--execute` against
production without explicit operator authorization in the current
interaction.**

## Mandatory reconciliation precondition — Issue #122

Incident #99 recovery restored the live Worker `BETTER_AUTH_SECRET` from the
Infisical **dev** value because the Infisical prod copy was not yet a trusted
source. Therefore Phase B MUST NOT start until Issue #122 completes.

Before step 1 below:

- copy/reconcile the exact current recovery value into Infisical prod
  `BETTER_AUTH_SECRET` without exposing plaintext in argv, logs, GitHub, or
  chat;
- compare the intended recovery source and Infisical prod value in-process only
  (bytes/hash comparison; never print either plaintext);
- require equality before `flip` or `restore-legacy-only` can run.

Cloudflare cannot reveal Worker secret plaintext, so this verification must use
the known recovery source held by the operator / Infisical dev. Completing #122
does **not** add `BETTER_AUTH_SECRETS`, delete the legacy binding, deploy, or
otherwise advance Phase B.

## Rollback matrix (Phase B execute runbook)

| # | Step | Command | Success condition | Failure condition | Rollback command | Resulting contract |
|---|---|---|---|---|---|---|
| 1 | `flip` | `node scripts/phase-3-plus-prod-flip.mjs --execute --environment=prod` (with writer-scoped `INFISICAL_TOKEN` in env) | Wrangler exit 0; `wrangler secret list` shows both `BETTER_AUTH_SECRETS` + `BETTER_AUTH_SECRET` | Wrangler exit ≠0 OR Infisical write fails | `rollback-versioned-only` | legacy-only (Worker) + versioned-written (Infisical) |
| 2 | Smoke #1 | `curl https://rebuildup.dev/api/v1/health` returns 200; check Worker logs/runtime for versioned-secret-read path | 200 OK + versioned path observed | 5xx OR versioned path is unusable | `rollback-versioned-only` | legacy-only |
| 3 | Release delivery | **Operator explicitly approves and merges PR #91**; Cloudflare Workers Builds performs the canonical `main`-push production delivery | #91 merge succeeds; Cloudflare Build/deploy succeeds; new production version is visible | merge/build/deploy fails | `rollback-versioned-only` while legacy binding is still present; investigate/revert release separately if needed | legacy-only Worker recovery path remains available |
| 4 | Smoke #2 | Anonymous `/admin/login` returns 200; operator manual sign-in succeeds; reload preserves session; `/api/v1/auth/*` works | Login + reload persistence + admin routes OK | sign-in/session/admin failure | `rollback-versioned-only` (legacy binding is still present) | legacy-only Worker auth contract |
| 5 | Smoke #3 | `/portfolio` + `/about` + `/contact` load 200; no runtime errors | All public surfaces 200 | Any 5xx/runtime regression | `rollback-versioned-only` (legacy binding is still present) | legacy-only Worker auth contract |
| 6 | `delete-legacy-only` | `node scripts/phase-3-plus-prod-flip.mjs --execute --delete-legacy-only --environment=prod` | Wrangler exit 0; `wrangler secret list` shows only `BETTER_AUTH_SECRETS` + `MY_WEB_2026_CONSUMER_API_KEY` | Wrangler exit ≠0 | `restore-legacy-only` | legacy + versioned (revert delete) |
| 7 | Final drift check | `node scripts/check-cf-secrets.mjs` + `node scripts/infisical:verify` | Both pass; aligned with `wrangler.production.jsonc#secrets.required` | Drift detected | `restore-legacy-only` (then investigate) | legacy + versioned |

### Recovery commands (standalone, not part of the canonical flow)

- `rollback-versioned-only` — `node scripts/phase-3-plus-prod-flip.mjs --execute --rollback-versioned-only --environment=prod` — deletes `BETTER_AUTH_SECRETS` from Worker while the legacy binding is still present. Use for failures in steps 1-5 before the canonical legacy deletion.
- `restore-legacy-only` — `node scripts/phase-3-plus-prod-flip.mjs --execute --restore-legacy-only --environment=prod` — re-adds `BETTER_AUTH_SECRET` from Infisical `prod` audit trail. Used if step 6 (delete-legacy-only) succeeds but a downstream dependency breaks.

### Resulting secret contract (post Phase B completion)

After steps 1-7 complete successfully:

- **Cloudflare Worker** secret names: `BETTER_AUTH_SECRETS` (versioned) + `MY_WEB_2026_CONSUMER_API_KEY` (unchanged)
- **Infisical `prod`** secret names: `BETTER_AUTH_SECRETS` (new, versioned form `1:<legacy plaintext>`) + `BETTER_AUTH_SECRET` (audit trail, retained per ADR-0015 §9) + `MY_WEB_2026_CONSUMER_API_KEY` (unchanged)
- **Cloudflare Worker** must NOT have `BETTER_AUTH_SECRET` binding (AUDIT_ONLY contract).
- **wrangler.production.jsonc#secrets.required** already declares `["BETTER_AUTH_SECRETS", "MY_WEB_2026_CONSUMER_API_KEY"]` — no config change needed.

## What agent will NOT do

Per `[[release-merge-human-gate]]` + `[[issue-99-driver-incident]]`:

- **No `--execute` invocation against production** — the agent does not
  have writer `INFISICAL_TOKEN` in the current execution environment,
  AND the operator's `[[release-merge-human-gate]]` requires explicit
  per-interaction authorization.
- **No `wrangler secret bulk` mutation** — the wrangler OAuth is
  active and would silently authorize a bulk operation.
- **No Infisical mutation** — `INFISICAL_TOKEN` is not in env; UA
  fallback requires `INFISICAL_CLIENT_ID` + `INFISICAL_CLIENT_SECRET`
  which are also not in env.
- **No direct/local production deploy to bypass #91** — canonical delivery is
  the operator-approved Release PR #91 merge followed by Cloudflare Workers
  Builds from `main`.
- **No Release PR #91 merge without explicit operator approval** — the merge is
  step 3 of the canonical Phase B/release handshake, not an autonomous action.
- **No closing of Issue #89** — the issue is closed only after #122,
  Phase B execute, #91 production delivery, post-deploy smoke, legacy deletion,
  and final drift verification all complete.

## Next step (operator decision required)

The next production mutation is **Issue #122 reconciliation**, not the Phase B
flip. After #122 is completed and equality is verified without printing
plaintext, the operator may explicitly authorize #89 Phase B step 1.

The canonical sequence is:

`#122 reconcile → flip → Smoke #1 → operator-approved #91 merge → Cloudflare Workers Builds deploy → Smoke #2/#3 → delete-legacy-only → final drift`.

The writer-scoped `INFISICAL_TOKEN` is required for `flip`. The #91 merge
requires a separate explicit operator approval at step 3; no direct/local
production deploy is a substitute.

## Files referenced

- `scripts/phase-3-plus-prod-flip.mjs` — Phase B driver (4 operations)
- `scripts/run-deploy-inner.mjs` — `REQUIRED_RUNTIME_SECRETS` / `AUDIT_ONLY_SECRETS` SoT
- `wrangler.production.jsonc` — production config (Phase 3+ contract)
- `wrangler.jsonc` — local-dev config (Phase 3+ contract)
- `.infisical.json` — `workspaceId` SoT (`89cda9cb-31ab-4ace-afe9-f155024850d1`)
- `docs/adr/ADR-0015-infisical-env-management.md` §9 — audit-only semantics
- `docs/migration/portfolio-2025-publication-prep/` — companion #78 prep
