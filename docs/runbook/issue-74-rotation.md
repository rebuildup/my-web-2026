# Issue #74 — Operator runbook: `MY_WEB_2026_CONSUMER_API_KEY` rotation

Authoritative operator runbook for the `pnpm run rotate:home-api-key` driver introduced by Issue #74. Issue #74 originally proposed an "output plaintext exactly once" design; **that design is rejected** after Issue #139's 2026-09-28 canonical incident, in which an Infisical real-value read leaked four plaintext credentials into the agent transcript (one of them this script's target secret). The script now completes **generation → propagation → in-process smoke** entirely IN-PROCESS, never printing the new plaintext.

This runbook is the **ONLY** path for rotating `MY_WEB_2026_CONSUMER_API_KEY` after the 2026-09-28 incident. Do **not** attempt `infisical secrets set` against the prod env from an interactive agent session — that is the originating anti-pattern.

## Security context (do not skip)

- The 2026-09-28 incident exposed the dev `BETTER_AUTH_SECRET` AND the
  prod-leaning `MY_WEB_2026_CONSUMER_API_KEY`. The dev Better Auth value was
  the **#99 recovery source currently used in production Worker bindings**
  (`BETTER_AUTH_SECRET` legacy binding on the live `*.workers.dev`-based
  production deployment before Issue #89 Phase B). The consumer API key is
  the home-side credential used by `src/home/{access,reactions}/load.ts`
  and the admin surface for the `mk_home_*` scheme.
- ROTATION replaces the exposed plaintext with a fresh CSPRNG-generated
  value across:
  - **D1 `apikey`**: two-phase mutation — Phase 1 INSERT-new+verify,
    Phase 2 (after smoke) DISABLE-old+verify. The dual-valid window
    between the two phases is bounded by the in-process smoke (~1s).
    The old row is disabled only AFTER the fresh row is proven usable,
    so a fresh-row INSERT failure cannot produce a zero-valid-key
    state.
  - **Infisical `prod` `MY_WEB_2026_CONSUMER_API_KEY`** (via
    `infisical secrets set --file` with mode 0600 YAML, rmSync'd)
  - **Cloudflare Worker `MY_WEB_2026_CONSUMER_API_KEY`** binding (via
    `wrangler secret bulk -c wrangler.production.jsonc` with stdin JSON)

Subprocess env isolation (PR #141 re-review, 2026-09-28):
- `buildInfisicalEnv(baseEnv, token)` — keeps writer `INFISICAL_TOKEN`,
  strips machine-identity / project / site / api-url. Used for the
  Infisical CLI subprocess only.
- `buildWranglerEnv(baseEnv)` — strips the full Infisical credential
  set. Used for `wrangler secret bulk`, `wrangler secret list`, and
  `wrangler d1 execute` subprocesses. Wrangler/D1 MUST NEVER receive
  the writer-scoped Infisical token.

## Architectural correction (PR #141 review, 2026-09-28)

The initial draft framed old-D1-row disable as **audit-trail cleanup** — a separate gate after smoke confirmation. That framing was wrong. The external `/api/v1/*` endpoints authenticate against Better Auth's `auth.api.verifyApiKey(...)` middleware (`src/http/api-keys/middleware.ts:17`), which verifies the request plaintext against the **D1 `apikey.key` hash directly**. The Worker `MY_WEB_2026_CONSUMER_API_KEY` binding is the **internal self-consumption key** (used by `src/home/{access,reactions}/load.ts` to authenticate home-side loaders when they call `/api/v1/*`). It is **NOT the external-auth source-of-truth**.

Consequence: a leaked plaintext that hashes to an **enabled** D1 row is still accepted by external API endpoints, regardless of the Worker binding value. Disabling the old D1 row is therefore **containment**, not audit hygiene. It MUST happen before the rotation is declared complete; the Worker binding change is internal-self-consumption visibility, not a security boundary.

## Production desired state post-rotation

| Surface | Pre-rotation (exposed) | Post-rotation (target) |
| --- | --- | --- |
| D1 `apikey` old row `home-self-consumption` | enabled (the leaked plaintext authenticates) | **disabled** (containment) |
| D1 `apikey` new row `home-self-consumption-rotated-<id>` | absent | enabled, fresh SHA-256 hash |
| Infisical `prod` `MY_WEB_2026_CONSUMER_API_KEY` | exposed plaintext | fresh plaintext |
| Worker `MY_WEB_2026_CONSUMER_API_KEY` | exposed plaintext | fresh plaintext |
| Sourceable by old plaintext via `/api/v1/*`? | YES | **NO** (containment) |
| Sourceable by new plaintext via `/api/v1/*`? | NO | YES (in-process smoke confirms) |

The script's `--execute` performs a **two-phase D1 mutation**:
Phase 1 INSERT-new + verify, then in-process smoke against the
canonical protected surface, then Phase 2 DISABLE-old + verify. The
old row is disabled ONLY AFTER the fresh row is proven usable, so a
fresh-row INSERT failure cannot produce a zero-valid-key state. The
Worker binding is written AFTER disable-old commits. No
operator-visible plaintext is ever required.

## Operation modes (mutually exclusive)

| Mode | Side effects | Use when |
| --- | --- | --- |
| `--dry-run` (default) | None | Pre-flight verification of the planned rotation. |
| `--execute` | D1 two-phase (insert-new+verify → smoke → disable-old+verify) + Infisical + Worker + verify | Operator-authorized rotation. **Requires writer-scope `INFISICAL_TOKEN` on prod + wrangler OAuth for `--target=remote`.** Refuses to start if a rotated row is already enabled (forces explicit recovery). |
| `--verify-only` | Read-only (HTTPS GET + D1 SELECT + wrangler secret list) | Confirm post-rotation state. **Requires `INFISICAL_TOKEN`.** |
| `--disable-row=<id>` | Single-row UPDATE on D1 (no new value generated) | Operator-authorized cleanup of a half-completed rotation, OR audit-trail disable of a stale row. Idempotent (`WHERE enabled = 1` guard). |
| `--worker-recovery=<id>` | Reads fresh from Infisical, writes to Worker via bulk, verifies binding names | Partial-failure recovery when Worker write failed AFTER Infisical + smoke + D1 succeeded. NO new plaintext generated; no D1 mutation. |

Defaults: `--dry-run` + `--target=remote` + `environment=prod`.

## Step 0 — preflight

### 0.1 — read these first

- `AGENTS.md` §4-bis "Agent invariant: no value-listing of real secrets"
  (added in Issue #139). The runbook and the script both depend on it.
- `docs/runbook/cloudflare-workers-builds.md` (canonical sequence; this
  rotation is a separate operator gate from the release lifecycle).

### 0.2 — assemble prerequisites

- **Writer-scoped** `INFISICAL_TOKEN` with **write permission on the
  prod env**. The viewer-scoped Workers Builds Machine Identity
  (`my-web-2026-cf-worker`, role=`viewer`) is NOT sufficient for
  `--execute`. Fail-closed if supplied.
- `CLOUDFLARE_API_TOKEN` (or local wrangler OAuth) for `wrangler secret
  bulk` and `wrangler secret list` against
  `wrangler.production.jsonc`.
- `.infisical.json` is present at the repo root and contains
  `workspaceId` (the script reads it; a missing file fails the
  preflight).

### 0.3 — confirm baseline

```bash
# Read-only status report. Token value is NEVER printed by this script.
INFISICAL_TOKEN=<writer-scope-token> \
  pnpm run rotate:home-api-key -- --verify-only

# Expected pre-rotation output:
#   [verify-only] D1 rotated rows enabled: 0 (steady state)
#   [verify-only] D1 old home row enabled: true  ← CONTAINMENT not yet done
#   [verify-only] Infisical MY_WEB_2026_CONSUMER_API_KEY: present
#   [verify-only] Worker bindings: <N> (MY_WEB_2026_CONSUMER_API_KEY bound)
```

### 0.4 — operator authorization in the current interaction

The agent MUST NOT proceed past Step 1 without explicit operator authorization in the current interaction. Sample canonical phrasing:

> "Authorize Step 1 — execute `pnpm run rotate:home-api-key -- --execute` with writer-scope `INFISICAL_TOKEN`. Do NOT pass `--disable-row=<id>`; the script manages disable-old after the smoke. Smoke is in-process — you do NOT need to paste any plaintext. Authorized."

This satisfies `[[release-merge-human-gate]]`-class operator gate (the
script is not the release PR, but the same human-gate principle applies
to any production-mutating operator action under the 2026-09-28
incident regime).

## Step 1 — operator-authorized execute

```bash
INFISICAL_TOKEN=<writer-scope-token> \
  pnpm run rotate:home-api-key -- --execute
```

Dry-run equivalent for plan validation (recommended once before the
real execute):

```bash
pnpm run rotate:home-api-key -- --dry-run
```

What `execute` does (10 stages):

1. **Preflight**: refuses to start if an enabled rotated row already
   exists (forces explicit `--worker-recovery` or `--disable-row`
   instead of silently generating a second plaintext).
2. **Locate OLD row**: SELECT the enabled `home-self-consumption` row
   in D1. If missing, abort with a clear bootstrap-required error.
   Note: the OLD row is **NOT** disabled at this point; that is
   Stage 7.
3. **Generate fresh plaintext + hash**: CSPRNG (`crypto.randomBytes`)
   → 52-char a-zA-Z alphabet → `mk_home_<52-char>` plaintext →
   SHA-256 base64url hash. The plaintext NEVER leaves the Node process.
4. **Resolve admin user**: SELECT the first `user.role='admin'` row for
   the apikey's `referenceId`.
5. **INSERT new D1 row** (Phase 1 of D1 mutation) under
   `home-self-consumption-rotated-<id>` with the fresh hash and
   `enabled=1`. `ON CONFLICT(\`key\`) DO NOTHING` (idempotent on
   hash). Verify the row is present and enabled. Old row remains
   enabled during this window (dual-valid, bounded).
6. **In-process smoke**: `fetch` against the canonical protected
   surface `https://rebuildup.dev/api/v1/access/count/home-page`
   (`requireApiKey` + `access_counter:read`-gated) with
   `Authorization: Bearer <fresh>`, expecting 2xx. The plaintext stays
   inside `runSmoke`'s scope and is released on function return. The
   operator NEVER sees the plaintext. **There is no `--smoke-url`
   override** — sending `Authorization: Bearer <fresh>` to an
   arbitrary URL would exfiltrate the new credential (PR #141
   re-review, 2026-09-28). If the smoke FAILS, the script aborts
   BEFORE Stage 7 (disable-old), so the OLD row stays valid. The
   operator runs `--disable-row=<rotatedRowId>` to discard the fresh
   row, then investigates the surface and re-runs `--execute`.
7. **Disable OLD row** (Phase 2 of D1 mutation = containment):
   `UPDATE apikey SET enabled = 0 WHERE id = '<old>' AND enabled = 1`.
   Idempotent. Verify the row is now disabled.
8. **Write Infisical `prod`**: 0600 YAML temp file (rmSync'd in
   `finally`), `infisical secrets set --file <yaml> --env=prod
   --path=/`. The Infisical subprocess env is `buildInfisicalEnv(...)`
   — keeps writer `INFISICAL_TOKEN`, strips other Infisical
   credentials (PR #141 re-review, 2026-09-28). Constant-time
   read-back verify (`timingSafeEqual`).
9. **Write Worker binding**: `wrangler secret bulk -c
   wrangler.production.jsonc` with stdin JSON. The Wrangler subprocess
   env is `buildWranglerEnv(process.env)` — strips the full Infisical
   credential set (token + machine identity + project/site/api).
   Wrangler MUST NEVER receive the writer-scoped Infisical token.
10. **Verify Worker binding names** via
    `wrangler secret list --format json -c wrangler.production.jsonc`
    (name-only; Cloudflare does not expose values).

The operator-visible output reports ONLY the rotated D1 row id +
containment state + binding-name presence. The fresh plaintext IS
NEVER displayed.

Expected output:

```
[execute] checking for in-flight rotation in D1...
[execute] locating old home-self-consumption row...
[execute] INSERT new D1 row name=home-self-consumption-rotated-... (Phase 1 of D1 mutation)...
[execute] D1 row verified: id=<new-uuid> enabled=1 (both old + new rows enabled during smoke window)
[execute] in-process smoke: GET https://rebuildup.dev/api/v1/access/count/home-page with the fresh plaintext...
[execute] smoke: OK status=200 url=https://rebuildup.dev/api/v1/access/count/home-page header=Authorization
[execute] disabling OLD row id=<old-uuid> (Phase 2 of D1 mutation, containment)...
[execute] OLD row disabled; leaked plaintext now rejected by external auth middleware
[execute] writing fresh MY_WEB_2026_CONSUMER_API_KEY to Infisical prod (via CLI subprocess)...
[execute] verifying Infisical read-back (HTTPS GET + timingSafeEqual)...
[execute] writing MY_WEB_2026_CONSUMER_API_KEY to Worker via wrangler secret bulk (stdin JSON)...
[execute] verifying Worker binding names (no value read-back)...
[execute] complete.
  D1 new row: id=<new-uuid> name=home-self-consumption-rotated-... enabled=1
  D1 old row: id=<old-uuid> disabled (containment)
  Infisical prod: MY_WEB_2026_CONSUMER_API_KEY = <fresh>
  Worker: MY_WEB_2026_CONSUMER_API_KEY = <fresh>
  In-process smoke: status=200 url=https://rebuildup.dev/api/v1/access/count/home-page
```

## Step 2 — post-rotation confirm

Two-track confirm (operator-side, after `--execute` completes):

**Automated track:**

```bash
INFISICAL_TOKEN=<writer-scope-token> \
  pnpm run rotate:home-api-key -- --verify-only
# Expected:
#   [verify-only] D1 rotated rows enabled: 1
#   [verify-only] D1 old home row enabled: false   ← CONTAINMENT in place
#   [verify-only] Infisical MY_WEB_2026_CONSUMER_API_KEY: present
#   [verify-only] Worker bindings: <N> (MY_WEB_2026_CONSUMER_API_KEY bound)
```

**Manual operator track (NO curl with new plaintext required):**

The in-process smoke in Step 1 already verified the fresh plaintext
authenticates against production. The operator does NOT type or paste
the new value. The operator's role is:

- Confirm the `[execute] smoke: OK status=200` line appeared in Step 1
  output.
- Optionally sign in to `/admin/login` to confirm Better Auth session
  establishment (unrelated to this credential; covers Better Auth
  issue #139).
- Optionally `pnpm run e2e:prod` to confirm the production portfolio
  smoke (PR #138) stays green.

If the in-process smoke in Step 1 reported `FAIL`, `--execute` aborted
before Infisical/Worker writes — containment is in place but the
production surface did not accept the new plaintext. Investigate the
smoke URL / auth header shape before re-running.

## Step 3 — partial-failure recovery (only if needed)

The script's contract is **partial-failure tolerant**. If `--execute`
exits with code 3 (Infisical + smoke + D1 succeeded, Worker failed),
the operator runs `--worker-recovery=<rowId>` to complete the Worker
stage WITHOUT regenerating a new plaintext:

```bash
# --execute exited with code 3; the recovery command was printed.
# Sample output: "[execute] Recovery: re-run `pnpm run rotate:home-api-key -- --worker-recovery=<rowId>`"

INFISICAL_TOKEN=<writer-scope-token> \
  pnpm run rotate:home-api-key -- --worker-recovery=<rowId>
```

`--worker-recovery` reads the fresh value from Infisical `prod` (the
value already there from Step 1's stage 9), writes it to the Worker
via `wrangler secret bulk`, and verifies binding names. NO new D1 row,
NO new plaintext.

If `--worker-recovery` fails because Infisical no longer holds the
fresh value (catastrophic — operator manual recovery required):

```bash
# 1. Inspect what Infisical currently holds (status-only)
INFISICAL_TOKEN=<writer-scope-token> \
  pnpm run rotate:home-api-key -- --verify-only

# 2. Discard the partial state via --disable-row on the rotated row
# (this restores "leaked plaintext still authenticates" until a
#  fresh rotation is possible; under the 2026-09-28 incident regime
#  this is acceptable IF the original surface accepts the old
#  plaintext; otherwise a manual re-rotation is required)
pnpm run rotate:home-api-key -- --disable-row=<rotated-row-id>
```

DO NOT manually `infisical secrets set` or `wrangler secret put` to
recover — that bypasses the verify-after-write contract and re-opens
the value-listing anti-pattern.

## Step 4 — Issue / PR closure

1. Confirm rotation success end-to-end (Step 2).
2. Issue #74 closure: comment with rotation-id (the `<id>` part of the
   rotated row name) + rotated D1 row id + in-process smoke status +
   bind-name verify status. PR #141 (this PR) is the code-side
   deliverable; the rotation itself is a separate operator gate.
   **Operators do not embed the rotated D1 row id or any other secret
   in the issue comment.**

## Expected production impact

- **In-flight sessions on the home-side reaction / access counter
  surfaces**: requests using the EXPOSED old plaintext receive 401
  from Better Auth's `auth.api.verifyApiKey` the moment Stage 7
  (Phase 2 disable-old) commits in D1. From Stage 5 (Phase 1 insert-
  new+verify) up to Stage 7, both old and new rows are enabled
  (documented dual-valid window). The rotation's containment boundary
  is D1, NOT the Worker binding. Operators must either roll client
  retry behaviour or accept the 401 spike at the Phase 2 commit
  moment. This is expected (the credential was exposed; the rotation
  is the remediation).
- **Worker self-consumption (`MY_WEB_2026_CONSUMER_API_KEY` is the
  internal self-consumption key for `src/home/{access,reactions}/load.ts`)**:
  flips to fresh in Stage 9 (Worker write). In-flight home loader
  calls using the old plaintext receive 401 from `/api/v1/*`
  momentarily until they retry with the Worker-binding-fresh value.
- **Auth sessions via Better Auth** (`BETTER_AUTH_SECRET` rotation is
  Issue #139, separate script — do NOT conflate): unaffected by this
  script. Issue #139 has its own runbook.
- **Smoke 1 automated track** (`pnpm run e2e:prod`): unaffected; the
  e2e tests do not exercise the home consumer key against production
  surfaces (their assertion is sign-in form present, not authenticated
  reactions writes).
- **Smoke 2 in-process track**: already integrated into `--execute`.
  Returns 2xx if the production surface accepts the new plaintext;
  the operator does not need to perform any additional action.

## Failure / rollback matrix (single-page reference)

| Failure point | State after failure | Recovery |
| --- | --- | --- |
| Stage 1 in-flight check | None mutated | Investigate; existing rotated row indicates a partial rotation. Run `--worker-recovery` or `--disable-row` to resolve. |
| Stage 2 / Stage 4 (locate OLD or admin lookup) fails | None mutated | Re-run `--execute` once the precondition is fixed. |
| Stage 5 INSERT fails (Phase 1) | OLD row still enabled, no new row written | Fix the precondition (admin, INSERT) and re-run `--execute`. No partial state to discard. |
| Stage 5 row-verify fails | OLD row still enabled, new row may exist with unexpected hash | Operator runs `--verify-only` to inspect; if a row exists, run `--disable-row=<rowId>` to discard, then re-investigate. |
| Stage 6 in-process smoke fails | OLD row STILL enabled, new row enabled (dual-valid window); containment NOT yet in place | **Containment is NOT yet in place** — the script aborted BEFORE disable-old. Operator MUST run `--disable-row=<rotatedRowId>` to discard the fresh row, then fix the smoke surface (URL / auth header) and re-run `--execute`. |
| Stage 7 disable-old fails (Phase 2) | NEW row enabled, OLD row still enabled (leaked plaintext still authenticates) | **Leaked plaintext still authenticates — containment pending.** Investigate the disable failure. Operator MUST run `--disable-row=<oldRowId>` to restore containment. The fresh row stays valid. |
| Stage 8 Infisical write fails | OLD row disabled, new row enabled, smoke OK, Infisical unchanged | **Containment is in place.** Re-run `--execute`; Stage 1 refuses (existing rotated row). Operator runs `--disable-row=<new-row-id>` to discard OR manually fixes Infisical connectivity, then re-runs `--execute` (still refuses) and runs `--worker-recovery=<new-row-id>` to push the new value to Worker. |
| Stage 9 Worker write fails | OLD row disabled, new row enabled, smoke OK, Infisical holds fresh | **Exit 3 with explicit `--worker-recovery=<new-row-id>` command printed.** Operator runs that command to complete. |
| Stage 10 binding-name verify fails | OLD row disabled, new row enabled, smoke OK, Infisical holds fresh, Worker write exit 0 but binding missing | Re-run `--worker-recovery=<new-row-id>` to retry the Worker write + binding-name verify. |

The key invariant: **if Stage 6 (smoke) or earlier fails, the OLD row
stays valid** — the script never disables the only working key before
the replacement has been proven usable. This is the "no zero-valid-key
state" contract (PR #141 re-review, 2026-09-28).
| Operator `--disable-row=<id>` fails mid-execute | Disabled status unknown | Re-run `--disable-row=<id>`; UPDATE is guarded `WHERE enabled = 1` so it is safe to retry. |

Under the 2026-09-28 incident regime, "fresh stays in process until
recovery is possible" is preferred over "return to exposed value."

## Forbidden patterns (re-stated; see AGENTS.md §4-bis)

The following commands are **forbidden** under the 2026-09-28 incident
regime, regardless of operator authorization. They are listed here so
the rotation runbook is self-contained:

- `infisical secrets ... --env=prod` with the value displayed
- `wrangler secret:list --format pretty` (displays values)
- `curl https://secrets.rebuildup.dev/api/v3/secrets/raw/MY_WEB_2026_CONSUMER_API_KEY`
  with `viewSecretValue=true` outside the dedicated script
- `echo $INFISICAL_TOKEN` / `printenv` / `cat .dev.vars` of prod
- `wrangler secret put MY_WEB_2026_CONSUMER_API_KEY` (interactive
  confirmation; bypasses the bulk-stdin pattern)
- `wrangler secret delete MY_WEB_2026_CONSUMER_API_KEY` (same)

The canonical replacement is the dedicated comparison surface
(`pnpm run rotate:home-api-key -- --verify-only` for status-only output).

## References

- AGENTS.md §4-bis "Agent invariant: no value-listing of real secrets"
  (the canonical policy basis; Issue #139-added).
- `docs/runbook/cloudflare-workers-builds.md` (canonical release
  sequence; this rotation is independent of the release lifecycle).
- Issue #139 (BETTER_AUTH_SECRET rotation; sibling script
  `scripts/rotate-better-auth-secret.mjs`).
- Issue #122 (`reconcile-prod-auth-secret.mjs` driver; preflight tooling).
- ADR-0015 (Infisical SoT; §6 consumer API key contract; §9 staged
  design — this rotation aligns with §9 without modifying it).
- `scripts/bootstrap-home-api-key.mjs` (the original provisioning tool;
  this rotation script is its sibling for in-place credential rotation).
- `migrations/0006_apikey_key_unique.sql` (UNIQUE INDEX on
  `apikey.\`key\``; hash-unique invariant — the integrity guarantee
  behind the row-name uniqueness).
- `src/http/api-keys/middleware.ts:17` (Better Auth
  `auth.api.verifyApiKey(...)` — confirms D1-direct auth, hence
  disable-old = containment).
