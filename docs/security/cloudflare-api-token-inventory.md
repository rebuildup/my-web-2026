# Cloudflare API token — consumer / non-consumer inventory

Authoritative durable record of where the **`CLOUDFLARE_API_TOKEN`**
environment variable is consumed, NOT consumed, or merely referenced
in the `my-web-2026` repository. Created under Issue #148
(2026-09-28 canonical-incident follow-up; relates to the same
incident regime as #139).

The token value itself is NEVER recorded here. The authoritative
Cloudflare-side scope / consumer map (organization-level secret
bindings, GitHub Actions org-scoped secrets, Cloudflare dashboard
API tokens) is operator-side and lives outside the repository —
this doc tracks only the repository contract.

## TL;DR

| Category | Count | Impact if revoked |
| --- | --- | --- |
| **Direct repo consumers** (read `process.env.CLOUDFLARE_API_TOKEN`) | 2 scripts | Optional commands would fail; production deploys UNAFFECTED |
| **Indirect consumers** (subprocess that reads the env on its own) | 1 (Wrangler) | Optional Wrangler invocations would fail; CI / Workers Builds UNAFFECTED |
| **Test fixtures** | 1 (`scripts/check-cf-secrets.test.mjs`) | None (uses fake values) |
| **Doc references** (no code consumption) | 5 files | None |

**Production delivery is UNAFFECTED by revoking `CLOUDFLARE_API_TOKEN`**
because the canonical production deploy path is Cloudflare Workers
Builds (uses the `build_token_uuid` binding in
`wrangler.production.jsonc#routes`-adjacent worker settings), NOT
`CLOUDFLARE_API_TOKEN`. See
[`docs/runbook/cloudflare-workers-builds.md`](../runbook/cloudflare-workers-builds.md)
for the canonical release sequence.

## Direct consumers (`process.env.CLOUDFLARE_API_TOKEN`)

### 1. `scripts/check-cf-secrets.mjs` — Tier 3 drift verification

| Field | Value |
| --- | --- |
| **Read sites** | Lines 218-219 (gate predicate), 424-425 (Tier 3 dry-run eligibility), 601, 609, 713 (binding-skip log) |
| **Behaviour when set** | Tier 3 (live Worker secret name verification via `wrangler secret list`) runs in addition to Tier 1 (Infisical prod) + Tier 2 (Infisical dev) |
| **Behaviour when unset** | Tier 3 is skipped with `[dry-run] would skip Tier 3 (live worker): CLOUDFLARE_API_TOKEN not set.` log message; Tier 1/2 still run |
| **Fail-closed?** | No. Skips Tier 3 by design; mandatory seams (Tier 1, Tier 2) do not depend on this token |
| **Used in CI?** | No. CI runs `check-infisical-coverage` and `check-cf-secrets` tests, but never `--execute` (Tier 3 mutation path) |
| **Used in production?** | No. Production releases use Workers Builds binding; Tier 3 is operator-diagnostic only |

If revoked: Tier 3 (live Worker name verification) becomes a no-op.
Production behaviour is unaffected because Tier 3 is a name-only
diagnostic, not a value-listing or mutation command.

### 2. `scripts/infisical-bootstrap-cf.mjs` — Workers Builds binding (optional)

| Field | Value |
| --- | --- |
| **Read site** | Line 601 (`const cloudflareToken = process.env.CLOUDFLARE_API_TOKEN;`) |
| **Behaviour when set** | After Infisical seeding, attempts to write the Workers Builds Machine Identity (`build_token_uuid`, `cf_account_id`, `cf_zone_id`, `cf_workers_subdomain`) to Cloudflare via the API token |
| **Behaviour when unset** | Skips the binding step with `CLOUDFLARE_API_TOKEN not set — skipping Workers Builds binding step.`; Infisical seed proceeds normally |
| **Fail-closed?** | No. The Workers Builds binding is a one-time setup step (idempotent on subsequent runs); absence of the token is non-fatal |
| **Used in CI?** | No. `pnpm run infisical:bootstrap:cf` is an operator-local script (the `bootstrap:cf` template wires a viewer-scope Machine Identity into Infisical; the API token is only needed for the optional Worker-binding extension step) |
| **Used in production?** | No. The Machine Identity is the production runtime credential; `CLOUDFLARE_API_TOKEN` is only the operator setup convenience |

If revoked: the Workers Builds binding step is skipped. Re-running
`pnpm run infisical:bootstrap:cf` without the token does not regress
the Machine Identity already stored in Cloudflare (writes are
idempotent; absent token is documented as a no-op). Operator may
still complete the binding manually via the Cloudflare dashboard.

## Indirect consumers

### Wrangler CLI (every `wrangler ...` subprocess)

| Field | Value |
| --- | --- |
| **Reads** | `CLOUDFLARE_API_TOKEN` (or `WRANGLER_API_TOKEN`) as an auth fallback when Wrangler OAuth / Workers Builds auth is unavailable |
| **Repository call sites** | All scripts that spawn `wrangler` (Tier 3 verification in `scripts/check-cf-secrets.mjs`, `scripts/publish-portfolio-production.mjs` for R2 PUT, `scripts/migrate-portfolio-from-2025.mjs` for D1 migration, `scripts/upload-portfolio-media.mjs` for R2 uploads, `scripts/rotate-home-api-key.mjs` for `wrangler secret bulk`, `scripts/phase-3-plus-prod-flip.mjs` for `wrangler secret bulk`, etc.) |
| **Behaviour when `CLOUDFLARE_API_TOKEN` set** | Wrangler uses the token for authentication |
| **Behaviour when unset** | Wrangler falls back to OAuth credentials in `~/.config/.wrangler/` OR Workers Builds machine identity (for CI); an explicit missing-token failure is returned only when no fallback is available |
| **Production impact if revoked** | None. Production deploy is Workers Builds, not token-based |
| **Local operator impact if revoked** | Local `wrangler ...` commands that previously relied on the token would now fail; the operator must re-`wrangler login` (interactive OAuth) or substitute an alternative auth mechanism |

### Cloudflare Workers Builds (not a `CLOUDFLARE_API_TOKEN` consumer)

The canonical production deploy path uses Cloudflare Workers Builds
with the `build_token_uuid` binding registered in the
Cloudflare-side project settings (NOT in `wrangler.jsonc`). This
binding is unrelated to `CLOUDFLARE_API_TOKEN` and is not affected
by #148.

## Test fixtures (fake values; not real tokens)

### `scripts/check-cf-secrets.test.mjs`

| Lines | Form | Purpose |
| --- | --- | --- |
| 25, 290, 301, 305, 316, 322, 484, 490 | Comments + assertions | Test the script's behaviour with / without the env var |
| 456, 462, 488 | `env: { CLOUDFLARE_API_TOKEN: 'fake-token-for-dry-run-mention' }` or `'cloudflare-token'` | Inject a fake value to verify the script reads the env var and does NOT log the token value in any output |

All test values are literal fake strings (`'fake-token-for-dry-run-mention'`, `'cloudflare-token'`). No real-token material is present in the test fixtures.

## Non-consumers (doc references only)

| File | Reference | Notes |
| --- | --- | --- |
| `docs/adr/ADR-0015-infisical-env-management.md:348` | "build_token_uuid と `CLOUDFLARE_API_TOKEN` の 2 系統を避け、Build token に集約" | ADR §11-type statement: production uses `build_token_uuid`, not `CLOUDFLARE_API_TOKEN` |
| `docs/development.md:56` | `export CLOUDFLARE_API_TOKEN=...` | Local-development setup snippet (operator convention, not enforced) |
| `docs/runbook/cloudflare-workers-builds.md:196-197` | "An explicit `CLOUDFLARE_API_TOKEN` remains supported for operator/local diagnostics." | Explicit delineation: token is for operator diagnostics only, production uses Workers Builds |
| `docs/security.md:48` | CI/deploy step reference | Outdated wording; the line still suggests CI may consume `CLOUDFLARE_API_TOKEN`, but the actual workflows (`ci.yml`, `prod-smoke.yml`) do NOT reference it. Follow-up: clarify the wording in `docs/security.md` |
| `docs/migration/phase-3-plus-prod-flip-preflight-2026-09-27.md` | Preflight baseline row `CLOUDFLARE_API_TOKEN \| NOT SET \| No (wrangler OAuth active)` | Operator preflight evidence record |
| `docs/runbook/issue-74-rotation.md` | Implicit reference | The `rotate-home-api-key` runbook uses `wrangler` subprocesses; the token is referenced as the implicit auth fallback |

## Out-of-repo consumers (operator-side; not tracked in this doc)

| Surface | Notes |
| --- | --- |
| Cloudflare dashboard API tokens (organization-level) | Operator-side; tracked by Cloudflare audit log; outside repository scope |
| Cloudflare Workers Builds `build_token_uuid` binding | Separate token from `CLOUDFLARE_API_TOKEN`; canonical production deploy credential; outside `CLOUDFLARE_API_TOKEN` revocation impact |
| GitHub Actions organization secrets | Operator-side; current workflows (`ci.yml`, `prod-smoke.yml`) DO NOT reference `CLOUDFLARE_API_TOKEN` per grep evidence above. The script `--execute` (Tier 3) is not run in CI |
| Operator-local `~/.config/.wrangler/` OAuth credentials | Replacement auth path if `CLOUDFLARE_API_TOKEN` is revoked; operator-side |

## Revocation impact analysis (operator decision support)

**Question:** if the currently-exposed `CLOUDFLARE_API_TOKEN` is revoked,
what breaks?

**Direct repo consumers (2 sites):**

| Script | Effect | Mitigation |
| --- | --- | --- |
| `pnpm run infisical:check:cf -- --execute --environment=prod` (Tier 3) | Tier 3 (live Worker name verification) is skipped; Tier 1 + Tier 2 still report PASS | None needed; Tier 3 is optional drift diagnostic |
| `pnpm run infisical:bootstrap:cf` (Workers Builds binding step) | Binding step is skipped; rest of the bootstrap (Infisical seed) proceeds | Re-bind manually via Cloudflare dashboard if not already bound |

**Indirect (Wrangler):**

| Surface | Effect | Mitigation |
| --- | --- | --- |
| Local `wrangler` invocations | Without OAuth (`wrangler login`), Wrangler reports "No API token provided" | Operator runs `wrangler login` once for OAuth; or substitute a replacement `CLOUDFLARE_API_TOKEN` env var |
| Production deploy | UNAFFECTED (Workers Builds, separate credential) | None needed |

**Recommended remediation:**

1. Determine whether the operator actually needs a replacement
   `CLOUDFLARE_API_TOKEN`. The canonical production deploy path does
   not need one, and repository diagnostics can run without Tier 3.
2. For local operator mutation gates (for example Gate B/C or #89
   Phase B), prefer Wrangler OAuth (`wrangler login`) so no new
   long-lived API token has to be created solely for these operations.
3. If token auth is intentionally chosen instead of OAuth, derive its
   permissions from the exact gated operations. A read-only diagnostic
   token is **not sufficient** for repository drivers that execute
   `wrangler secret bulk` or remote D1 writes. Do not add R2
   permission unless the approved operation actually touches R2.
4. After a non-exposed auth path is confirmed, revoke the exposed
   token.
5. Confirm status-only that the revoked token is rejected, and record
   the result in Issue #139.

## Cross-references

- ADR-0015 §11 ("deployment credentials separation")
- `docs/runbook/cloudflare-workers-builds.md` (canonical release sequence)
- `docs/security.md` (general security posture; references the token in legacy CI/deploy prose)
- Issue #139 (canonical incident containment)
- Issue #148 (this inventory + replacement + revoke)
- `scripts/check-cf-secrets.mjs` (Tier 1/2/3 implementation)
- `scripts/infisical-bootstrap-cf.mjs` (Workers Builds binding step)
