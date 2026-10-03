# Issue #149 — Operator runbook: dev `BETTER_AUTH_SECRET` rotation

Authoritative operator runbook for the
`pnpm run rotate:dev-better-auth-secret` driver introduced by Issue
#149. This is a **dev-only** driver; production rotation is
[`scripts/rotate-better-auth-secret.mjs`](../../scripts/rotate-better-auth-secret.mjs)
(separate runbook) and lives under Issue #139 / PR #140.

## Security context (do not skip)

On 2026-09-28, a read-only Infisical preflight for Issue #122 leaked
four plaintext secret values into agent output (Issue #139). One of
them was the **dev** `BETTER_AUTH_SECRET` — the value Incident #99
had previously used to recover the production Cloudflare Worker
binding, before the production-side provenance was confirmed broken
and superseded. The dev value is no longer a production source after
the post-#89 / post-#140 production flip, but the dev env itself
still holds the exposed plaintext as its active Better Auth signing
material. This driver is the dev-side cleanup path.

**This script does NOT touch production.** It is locked to
`--environment=dev`. Any other value (including `prod`) is rejected
with exit 1. The production driver
(`scripts/rotate-better-auth-secret.mjs`) is the canonical surface
for prod rotation; do not attempt to bypass the lock.

## Production desired state post-rotation (dev env)

| Surface | Name | Post-rotation value |
| --- | --- | --- |
| Infisical `dev` | `BETTER_AUTH_SECRET` | `<fresh>` (replaces exposed legacy) |
| Infisical `dev` | `BETTER_AUTH_SECRETS` | `1:<fresh>` (versioned envelope; matches the prod naming) |
| Local `.dev.vars` | (both) | refreshed by `pnpm run generate:dev-vars` after the script completes |
| Production Cloudflare Worker | (no change) | out of scope; this script does not touch prod |
| Infisical `prod` | (no change) | out of scope |

The script's `--execute` performs an in-process fresh generation
followed by an `infisical secrets set --file` CLI write to the
`dev` env, then a wrapped-API read-back with `timingSafeEqual`
byte-equality verification. The Operator MUST then run
`pnpm run generate:dev-vars` to refresh the local `.dev.vars` file
(out of script scope — the driver is single-concern: Infisical dev
env only).

## Operation modes (mutually exclusive)

| Mode | Side effects | Operator authorization required |
| --- | --- | --- |
| `--dry-run` (default) | None | no |
| `--execute` | Infisical dev env write + read-back byte verification | yes (writer `INFISICAL_TOKEN` on `dev`) |

Defaults: `--dry-run` + `--environment=dev`. The dev-only lock is
intentional: any value other than `dev` is rejected.

The script does NOT support `--verify-only` (use
[`pnpm run infisical:verify`](../../scripts/infisical-verify.mjs)
for that — it is the canonical read-only verification surface for
all envs), and does NOT support `--worker-recovery` (dev has no
Worker binding).

## Step 0 — Operator pre-flight

### 0.1 — read these first

- `AGENTS.md` §4-bis "Agent invariant: no value-listing of real
  secrets" (added in Issue #139). The runbook and the script both
  depend on it.
- `docs/runbook/issue-139-rotation.md` (production-side runbook; this
  dev driver is the parallel cleanup path).

### 0.2 — assemble prerequisites

- **Writer-scoped** `INFISICAL_TOKEN` with **write permission on the
  dev env**. The viewer-scoped Workers Builds Machine Identity
  (`my-web-2026-cf-worker`, role=`viewer`) is NOT sufficient for
  `--execute`. Fail-closed if supplied.
- `.infisical.json` is present at the repo root and contains
  `workspaceId` (the script reads it; a missing file fails the
  preflight).

### 0.3 — confirm baseline

```bash
# Read-only status report. Token value is NEVER printed by this script.
INFISICAL_TOKEN=<writer-scope-token> \
  pnpm run infisical:verify
```

Expected pre-rotation output (from `infisical:verify`, NOT from this
script):

```text
# shows current dev BETTER_AUTH_SECRET / BETTER_AUTH_SECRETS status
# status: <CONSISTENT | DIVERGENT | LEGACY_ONLY | VERSIONED_ONLY | BOTH_MISSING>
```

### 0.4 — operator authorization in the current interaction

The agent MUST NOT proceed past Step 1 without explicit operator
authorization in the current interaction. Sample canonical phrasing:

> "Authorize Step 1 — execute `pnpm run rotate:dev-better-auth-secret -- --execute` with writer-scope `INFISICAL_TOKEN` on the `dev` env. The script is locked to `--environment=dev`; production is not touched. After the script completes, I (the operator) will run `pnpm run generate:dev-vars` to refresh local `.dev.vars`. Do NOT paste any plaintext. Authorized."

This satisfies `[[release-merge-human-gate]]`-class operator gate
(the script is not the release PR, but the same human-gate principle
applies to any production-mutating operator action under the
2026-09-28 incident regime — and even though the dev env is not
production, the writer token still has audit-trail value).

## Step 1 — operator-authorized execute

```bash
INFISICAL_TOKEN=<writer-scope-token> \
  pnpm run rotate:dev-better-auth-secret -- --execute
```

Dry-run equivalent for plan validation (recommended once before the
real execute):

```bash
pnpm run rotate:dev-better-auth-secret -- --dry-run
```

What `execute` does (4 stages):

1. **Preflight**: parse argv, confirm `--environment=dev`, read
   `.infisical.json#workspaceId`, cleanup stale tempdir.
2. **Generate fresh plaintext + versioned envelope**: CSPRNG
   (`crypto.randomBytes(48)`) → 64 base64url chars → 384 bits of
   entropy. Validate the value against `parseVersionedSecrets`
   round-trip invariants (no comma, no leading/trailing whitespace,
   `1:<fresh>` parses cleanly).
3. **Write to Infisical dev**: temp YAML file with both
   `BETTER_AUTH_SECRET` and `BETTER_AUTH_SECRETS = 1:<fresh>` keys
   (mode 0600, `os.tmpdir()`, `rmSync`'d in `finally` after the
   subprocess exits). Spawn `infisical secrets set --file` with the
   `buildInfisicalEnv` subprocess env (PR #140 contract: keeps the
   writer `INFISICAL_TOKEN`, strips other Infisical credentials).
4. **Read-back byte verification**: HTTPS GET
   `/api/v3/secrets/raw/{name}` with `viewSecretValue=true` (PR #151
   contract: no `type=personal` query; reads
   `response.secret.secretValue`; 404 + allowMissing = null,
   otherwise fail-closed). `timingSafeEqual` against the in-process
   fresh value. If the byte-equality check fails, exit 3 (partial-
   failure; the fresh value IS in Infisical dev but the read-back
   did not match; manual investigation required).

After Stage 4 reports OK, the Operator runs:

```bash
pnpm run generate:dev-vars
```

to refresh the local `.dev.vars` file from the fresh Infisical dev
values. (Out of script scope: the dev driver does not write to
`.dev.vars` directly; that is a separate concern owned by the
`generate-dev-vars` script.)

## Expected output

```text
[rotate-dev-better-auth] mode=execute
[rotate-dev-better-auth] environment=dev
[rotate-dev-better-auth] workspaceId=<redacted>
[execute] writing fresh BETTER_AUTH_SECRET + BETTER_AUTH_SECRETS to Infisical dev (via CLI subprocess for E2EE)...
[execute] verifying Infisical read-back (HTTPS GET + timingSafeEqual)...
[execute] complete. Infisical dev: fresh BETTER_AUTH_SECRET + BETTER_AUTH_SECRETS.
[execute] Operator MUST run `pnpm run generate:dev-vars` to refresh local .dev.vars (out of script scope).
```

The fresh plaintext value is NEVER printed by this script, in any
log line, error message, or subprocess output. The operator does
not need to paste any value.

## Subprocess env isolation (PR #140 contract)

The dev driver uses `buildInfisicalEnv(baseEnv, token)` (imported
from the prod driver) to build the Infisical CLI subprocess env:

- Keeps writer `INFISICAL_TOKEN` (the CLI needs it to authenticate).
- Strips the other Infisical credentials (`INFISICAL_CLIENT_ID`,
  `INFISICAL_CLIENT_SECRET`, `INFISICAL_PROJECT_ID`,
  `INFISICAL_SITE_URL`, `INFISICAL_API_URL`).

The dev driver does NOT spawn any Wrangler / D1 subprocess (dev
runs locally; no Cloudflare bindings are involved). Therefore the
`buildWranglerEnv` builder is not used by this driver.

## Failure / rollback matrix

| Failure point | State after failure | Recovery |
| --- | --- | --- |
| Stage 1 (arg parse / .infisical.json / stale tempdir) | None mutated | Fix the precondition (e.g. create `.infisical.json`, point `INFISICAL_TOKEN` at writer scope) and re-run `--execute`. |
| Stage 2 (CSPRNG / parseVersionedSecrets round-trip) | None mutated | This stage never fails on a healthy Node runtime; if it does, the Node environment is broken. Investigate the `crypto.randomBytes` / `parseVersionedSecrets` call site. |
| Stage 3 (Infisical CLI subprocess) | None mutated (the YAML file is `rmSync`'d in `finally` regardless) | Fix the Infisical connectivity / token scope, re-run `--execute`. The script will generate a NEW fresh value (the previous one was never persisted to Infisical). |
| Stage 4 (read-back byte verification) | Fresh value IS in Infisical dev, but the byte-equality check did not match (exit 3) | DO NOT re-run `--execute` (that would generate a NEW fresh value and overwrite the in-flight one). Investigate: re-run `pnpm run infisical:verify` to inspect the state; if the in-flight value is the desired one, the script's read path may be reading a stale cache or hitting a different environment. Manual cleanup or a follow-up driver invocation may be required. |
| Operator forgets to run `pnpm run generate:dev-vars` | Infisical dev has fresh value; local `.dev.vars` still has the exposed legacy value | The script reports "Operator MUST run `pnpm run generate:dev-vars`" as the final line. If missed, the operator can run it any time after the script completes; it is a read-only read of the now-fresh Infisical dev values. |

There is no "atomic disable-old + insert-new" stage in this driver
(because the dev env does not authenticate against D1; the Better
Auth signing material is the env value itself). The Infisical dev
write IS the containment: once the fresh value is in Infisical dev,
the dev `pnpm dev` (via `infisical run --env=dev`) will start using
the fresh value on the next spawn. There is no intermediate "old
still valid" window that needs explicit disable.

## Forbidden patterns (re-stated; see AGENTS.md §4-bis)

The following commands are **forbidden** under the 2026-09-28
incident regime, regardless of operator authorization. They are
listed here so the dev-cleanup runbook is self-contained:

- `infisical secrets ... --env=dev` with the value displayed
- `wrangler secret:list --format pretty` (displays values)
- `curl https://secrets.rebuildup.dev/api/v3/secrets/raw/<name>`
  with `viewSecretValue=true` outside the dedicated driver
- Direct `echo $VAR` / `printenv` / `cat .dev.vars` of any
  environment that holds a real production credential

The dev driver itself never prints plaintext. The
`infisical:verify` script is the canonical read-only verification
surface.

## Out of scope

- Production rotation. Handled by
  [`scripts/rotate-better-auth-secret.mjs`](../../scripts/rotate-better-auth-secret.mjs)
  (Issue #139 / PR #140). Do NOT use this dev driver for prod.
- `MY_WEB_2026_CONSUMER_API_KEY` rotation. Handled by
  [`scripts/rotate-home-api-key.mjs`](../../scripts/rotate-home-api-key.mjs)
  (Issue #74 / PR #141). The dev env may have a separate D1 home
  consumer key row; that is a separate ticket (not #149).
- Cloudflare D1 / R2 / Worker mutation. Dev runs locally; no
  Cloudflare bindings are touched by this driver.
- `.dev.vars` direct write. The operator runs
  `pnpm run generate:dev-vars` to refresh the local file.
- Release PR / tag / GitHub Release.
- CLOUDFLARE_API_TOKEN revoke/rotate. That is #148 (operator-side
  external mutation, out of code scope).
