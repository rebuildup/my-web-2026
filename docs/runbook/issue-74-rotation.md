# Issue #74 — Operator runbook: `MY_WEB_2026_CONSUMER_API_KEY` rotation

Authoritative operator runbook for the `pnpm run rotate:home-api-key` driver introduced by Issue #74. Issue #74 originally proposed an "output plaintext exactly once" design; **that design is rejected** after Issue #139's 2026-09-28 canonical incident, in which an Infisical real-value read leaked four plaintext credentials into the agent transcript (one of them this script's target secret). The script now completes **generation → propagation** entirely IN-PROCESS, never printing the new plaintext.

This runbook is the **ONLY** path for rotating `MY_WEB_2026_CONSUMER_API_KEY` after the 2026-09-28 incident. Do **not** attempt `infisical secrets set` against the prod env from an interactive agent session — that is the originating anti-pattern.

## Security context (do not skip)

- The 2026-09-28 issue exposed the dev `BETTER_AUTH_SECRET` AND the prod-leaning
  `MY_WEB_2026_CONSUMER_API_KEY`. The dev Better Auth value was the **#99
  recovery source currently used in production Worker bindings**
  (`BETTER_AUTH_SECRET` legacy binding on the live `*.workers.dev`-based
  production deployment before Issue #89 Phase B). The consumer API key is
  the home-side credential used by `src/home/{access,reactions}/load.ts`
  and the admin surface for the `mk_home_*` scheme.
- ROTATION replaces the exposed plaintext with a fresh CSPRNG-generated
  value across:
  - D1 `apikey` row (new `home-self-consumption-rotated-<id>` named row,
    fresh SHA-256 hash, enabled=1)
  - Infisical `prod` `MY_WEB_2026_CONSUMER_API_KEY` (via
    `infisical secrets set --file` with mode 0600 YAML, rmSync'd)
  - Cloudflare Worker `MY_WEB_2026_CONSUMER_API_KEY` binding (via
    `wrangler secret bulk -c wrangler.production.jsonc` with stdin JSON)

## Production desired state post-rotation

| Surface | Pre-rotation (exposed) | Post-rotation (target) |
| --- | --- | --- |
| D1 `apikey` enabled rows | `home-self-consumption` (old hash) | `home-self-consumption` (old hash, STILL ENABLED) + `home-self-consumption-rotated-<id>` (new hash, ENABLED) |
| Infisical `prod` `MY_WEB_2026_CONSUMER_API_KEY` | exposed plaintext | fresh plaintext |
| Worker `MY_WEB_2026_CONSUMER_API_KEY` | exposed plaintext | fresh plaintext |
| Sourceable by old plaintext? | YES (exposed) | NO (Worker binding no longer matches) |
| Sourceable by new plaintext? | NO | YES |

The script intentionally does **NOT** disable the old D1 row at rotation
time. The Worker binding is the runtime authentication source; once it
flips to fresh, the exposed plaintext stops being accepted regardless of
the old D1 row's `enabled` flag. A separate `--disable-row=<id>` gate
exists for cleaning the D1 audit trail AFTER smoke confirmation. This
split keeps rotation roll-back safe (smoke failure → re-run `--execute`
re-uses the existing rotated row).

## Operation modes (mutually exclusive)

| Mode | Side effects | Use when |
| --- | --- | --- |
| `--dry-run` (default) | None | Pre-flight verification of the planned rotation. |
| `--execute` | D1 INSERT + Infisical write + Worker write + verify | Operator-authorized rotation. **Requires `INFISICAL_TOKEN` with writer scope on prod env + wrangler OAuth for `--target=remote`.** |
| `--verify-only` | Read-only (HTTPS GET + D1 SELECT + wrangler secret list) | Confirm post-rotation state. **Requires `INFISICAL_TOKEN`.** |
| `--disable-row=<id>` | Single-row UPDATE on D1 (no new value generated) | Operator-authorized cleanup of an old row, AFTER smoke confirmation. |

Defaults: `--dry-run` + `--target=remote` + `environment=prod`.

## Step 0 — preflight

### 0.1 — read these first

- `AGENTS.md` §4-bis "Agent invariant: no value-listing of real secrets"
  (added in Issue #139). The runbook and the script both depend on it.
- `docs/runbook/cloudflare-workers-builds.md` (canonical sequence; this
  rotation is a separate operator gate from the release lifecycle).

### 0.2 — assemble prerequisites

- **Operator-scoped** `INFISICAL_TOKEN` with **write permission on the
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

# Expected pre-rotation output (D1 has only home-self-consumption + zero rotated rows):
#   [verify-only] D1 active rows: 1
#   [verify-only] D1 rotated rows: 0
#   [verify-only] Infisical MY_WEB_2026_CONSUMER_API_KEY: present
#   [verify-only] Worker bindings: <N> (MY_WEB_2026_CONSUMER_API_KEY bound)
```

### 0.4 — operator authorization in the current interaction

The agent MUST NOT proceed past Step 1 without explicit operator authorization in the current interaction. Sample canonical phrasing:

> "Authorize Step 1 — execute `pnpm run rotate:home-api-key -- --execute` with writer-scope `INFISICAL_TOKEN`. Do NOT pass `--disable-row=<id>`. Run smoke (curl /api/v1/reactions with the new key) BEFORE Step 2. Authorized."

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

What `execute` does:

1. Generate fresh CSPRNG plaintext (`mk_home_<52-alphabet-chars>`). The
   plaintext NEVER leaves the Node process except via:
   - YAML temp file (mode 0600, rmSync'd in `finally`)
   - `wrangler secret bulk` stdin JSON
   - Function-local Buffer (best-effort drop after the subprocess exits)
2. INSERT a new D1 row under
   `home-self-consumption-rotated-<YYYYMMDDHHMMSS>-<8hex>` with the
   fresh SHA-256 hash and `enabled=1`.
3. Verify the row appears in `apikey` (id + enabled=1).
4. Write `MY_WEB_2026_CONSUMER_API_KEY` to Infisical `prod` via
   `infisical secrets set --file` (CLI subprocess, native binary).
5. Read-back verify via HTTPS GET + `timingSafeEqual` (constant-time).
6. Write `MY_WEB_2026_CONSUMER_API_KEY` to the Cloudflare Worker via
   `wrangler secret bulk -c wrangler.production.jsonc` with stdin JSON.
7. Verify Worker binding-name presence via
   `wrangler secret list --format json`.

The operator-visible output reports ONLY the rotated D1 row id + the
plaintext fact ("Infisical MY_WEB_2026_CONSUMER_API_KEY = <fresh>").
The fresh plaintext IS NEVER displayed.

Expected output:
```
[execute] INSERT new D1 row name=home-self-consumption-rotated-20260928143000-abc12345...
[execute] D1 row verified: id=<uuid> enabled=1
[execute] writing fresh MY_WEB_2026_CONSUMER_API_KEY to Infisical prod (via CLI subprocess)...
[execute] verifying Infisical read-back (HTTPS GET + timingSafeEqual)...
[execute] writing MY_WEB_2026_CONSUMER_API_KEY to Worker via wrangler secret bulk (stdin JSON)...
[execute] verifying Worker binding names (no value read-back)...
[execute] complete.
  D1 row: id=<uuid> name=home-self-consumption-rotated-... enabled=1
  Infisical prod: MY_WEB_2026_CONSUMER_API_KEY = <fresh>
  Worker: MY_WEB_2026_CONSUMER_API_KEY = <fresh>
  Next step: smoke (curl /api/v1/reactions with new key) → operator confirms → --disable-row=<old-id>
```

## Step 2 — smoke verification

Two-track smoke (mandatory before Step 3). Operator MUST perform both:

**Automated track:**

```bash
pnpm run e2e:prod
# (uses rebuilt infrastructure; canonical surfaces green expected)
```

**Manual operator track:**

```bash
# Use the new plaintext against production /api/v1 endpoints. The new
# plaintext is in Operator's notes only — never in argv / GitHub / chat.
# Example (curl, --data-urlencode the key into a header — adjust to your
# loaders' auth shape):
curl -fsS -H "X-API-Key: <fresh-plaintext>" \
  https://rebuildup.dev/api/v1/health
# Expect: 200 status, canonical-surfaced body
```

Operator confirms in the current interaction:
- smoke 200 returned for canonical surfaces
- No 401/403 with the new plaintext (Worker binding holds the fresh
  value; runtime auth works)
- No 500s indicating the new row is missing (D1 row id reported by
  Step 1 must be findable)

If smoke fails, see **Step 2.5 — Smoke failure recovery** below.

## Step 2.5 — Smoke failure recovery

The script's contract is **partial-failure tolerant**. The expected
failure mode is:

- **Stage 4 (Infisical write) fails**: D1 row inserted; Operator re-runs
  `--execute`. The re-run is idempotent on D1 (the new row is already
  present, `ON CONFLICT(\`key\`) DO NOTHING` makes the INSERT a no-op,
  but stage 2 verifies the new row IS already present via
  `SELECT ... WHERE \`key\ = '<fresh hash>'`).
- **Stage 5 (Worker write) fails after Infisical succeeded**: the script
  exits with code 3 and prints the recovery instruction. Operator
  re-runs `--execute`. The new value is already in Infisical; the
  re-run's stage 4 read-back verifies it, then re-attempts stage 5.

DO NOT manually `infisical secrets set` or `wrangler secret put` to
recover — that bypasses the verify-after-write contract. Always re-run
`--execute`. The script will detect the partial state and complete it.

If re-run `--execute` continues to fail, escalate to operator manual
intervention:

```bash
# Roll back the Infisical prod entry to the exposed pre-rotation value
# ONLY if both Stage 4 and Stage 5 writes are unrecoverable AND the
# exposed value has not been used to sign live sessions since. This
# path is documented here for completeness; the 2026-09-28 incident
# regime prefers "fresh in process until recovery is possible" over
# "return to exposed".

# (NOT RECOMMENDED — only if both the partial-failure retry is exhausted
# AND the operator explicitly authorizes a return-to-exposed value in
# the current interaction.)
```

## Step 3 — operator-authorized disable-old (cleanup)

After smoke confirmation, the operator cleans up the audit trail:

```bash
# Disable the OLD row (the exposed one). The script does NOT
# auto-invoke this — disable is a separate gate.
pnpm run rotate:home-api-key -- --disable-row=<old-row-id>
```

The old D1 row id is reported by `--verify-only` (or by the
`bootstrap-home-api-key.mjs` original output if the row is the bootstrap
one). Single-row UPDATE; idempotent (idempotency guard:
`WHERE enabled = 1`).

This step is **NOT required for runtime correctness** — the Worker
binding already flipped in Step 1, so the exposed plaintext is no longer
runtime-authentic. It IS required for audit-trail hygiene: leaving the
old D1 row enabled makes the audit table misleading (`SELECT
COUNT(*) FROM apikey WHERE enabled=1` will over-count by one).

## Step 4 — Issue / PR closure

1. Confirm rotation success end-to-end:

```bash
INFISICAL_TOKEN=<writer-scope-token> \
  pnpm run rotate:home-api-key -- --verify-only
# Expected:
#   [verify-only] D1 active rows: 2 (bootstrap + rotated)
#   [verify-only] D1 rotated rows: 1
#   [verify-only] Infisical MY_WEB_2026_CONSUMER_API_KEY: present
#   [verify-only] Worker bindings: <N> (MY_WEB_2026_CONSUMER_API_KEY bound)
```

2. Read-back (using the dedicated script, NEVER a raw `infisical secrets` call):

```bash
INFISICAL_TOKEN=<writer-scope-token> \
  pnpm run rotate:better-auth-secret -- --verify-only
# (no plaintext in output; status-only MATCH/DIFFER/MISSING)
# For MY_WEB_2026_CONSUMER_API_KEY specifically, use:
INFISICAL_TOKEN=<writer-scope-token> \
  pnpm run rotate:home-api-key -- --verify-only
# (the rotated D1 row id confirms the value went in; not a value list)
```

3. Issue #74 closure: comment with rotation-id + D1 row id + smoke
   evidence. PR #141 (this PR) is the code-side deliverable; the
   rotation itself is a separate operator gate. **Operators do not
   embed the rotated D1 row id or any other secret in the issue
   comment.**

## Expected production impact

- **In-flight sessions on the home-side reaction / access counter
  surfaces**: requests using the EXPOSED old plaintext will receive
  401 from the Worker binding the moment Step 1.6 completes. Operators
  must either roll client retry behaviour or accept the 401 spike.
  This is expected (the credential was exposed; the rotation is the
  remediation).
- **Auth sessions via Better Auth** (`BETTER_AUTH_SECRET` rotation is
  Issue #139, separate script — do NOT conflate): unaffected by this
  script. Issue #139 has its own runbook.
- **Smoke 1 automated track** (`pnpm run e2e:prod`): unaffected; the
  e2e tests do not exercise the home consumer key against production
  surfaces (their assertion is sign-in form present, not authenticated
  reactions writes).
- **Smoke 2 manual operator track**: MUST perform a real
  `/api/v1/reactions` write with the new plaintext to confirm runtime
  auth path. See Step 2.

## Failure / rollback matrix (single-page reference)

| Failure point | State after failure | Recovery |
| --- | --- | --- |
| Stage 2 admin lookup fails | None mutated | Pre-rotate setup; verify admin user exists in D1 |
| Stage 3 INSERT fails | None mutated | Re-run `--execute`; INSERT is idempotent |
| Stage 4 Infisical fails after Stage 3 succeeds | D1 row inserted, Infisical unchanged | Re-run `--execute`; stage 3 will skip (idempotent), stage 4 will retry |
| Stage 5 Worker write fails after Stage 4 succeeded (signal) | D1 row + Infisical fresh; Worker on old value | Re-run `--execute`; stage 5 will retry. **Treat any in-flight session as compromised on the old plaintext.** |
| Stage 5 Worker write fails after Stage 4 succeeded (non-zero) | Same as signal case | Same as signal case |
| Stage 6 binding-name verify fails | D1 row + Infisical fresh + Worker write report claimed success | Re-run `--execute`; binding write is idempotent on `wrangler secret bulk` for the same name |
| Operator `--disable-row=<id>` fails mid-execute | Disabled status unknown | Re-run `--disable-row=<id>`; UPDATE is guarded `WHERE enabled = 1` so it is safe to retry |
| Smoke fails | Operator-judgment | Decide whether to (a) re-run rotation with a fresh value (discards the rotated row), or (b) roll the Worker binding back to the old value (acceptable IF the exposed value has not yet been used by a live adversary — but **discouraged** under the 2026-09-28 regime) |

The **discouraged** roll-back-the-Worker-binding path is:

```bash
# ONLY if explicitly authorized by operator in the current interaction.
# Do NOT run without authorization.
INFISICAL_TOKEN=<writer-scope-token> \
  pnpm run rotate:home-api-key -- --execute
# then immediately disable the rotated row:
pnpm run rotate:home-api-key -- --disable-row=<new-row-id>
# and re-enable the OLD row in D1 (manual SQL):
# UPDATE apikey SET enabled = 1, updatedAt = <now> WHERE id = '<old-id>';
```

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
