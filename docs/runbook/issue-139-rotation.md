# Issue #139 — Better Auth signing-secret rotation runbook

> Canonical production operator runbook for the fresh
> `BETTER_AUTH_SECRET` rotation. Cross-referenced from
> [`AGENTS.md §4`](../../AGENTS.md) and
> [`docs/adr/ADR-0015-infisical-env-management.md`](../adr/ADR-0015-infisical-env-management.md).
>
> ## Security context
>
> On 2026-09-28, a read-only Infisical preflight for Issue #122 leaked
> four plaintext secret values into agent output. One of them — the
> Infisical `dev` `BETTER_AUTH_SECRET` — is the value currently bound
> to the production Cloudflare Worker, because Incident #99 recovery
> restored Worker signing material from that exact dev value (per
> Issue #99 documentation; production-side provenance has not changed
> since).
>
> The exposed `dev` `BETTER_AUTH_SECRET` is therefore treated as
> **production-compromised**. The existing Issue #122 reconciliation
> premise ("copy the exposed dev value into Infisical prod") is
> discarded: a `MATCH` between dev and prod would prove only that
> the exposed value is still in use, not that the system is safe.
>
> This runbook covers the canonical-incident containment path: a
> fresh rotation driven by `scripts/rotate-better-auth-secret.mjs`
> that replaces the production signing material WITHOUT ever printing,
> logging, or argv-passing the value.

## Production desired state post-rotation

| Surface | Name | Post-rotation value |
| --- | --- | --- |
| Infisical `prod` | `BETTER_AUTH_SECRET` | `<fresh>` (replaces exposed legacy) |
| Infisical `prod` | `BETTER_AUTH_SECRETS` | `1:<fresh>` (ready for #89 Phase B flip) |
| Worker | `BETTER_AUTH_SECRET` | `<fresh>` (legacy binding, fresh value) |
| Worker | `BETTER_AUTH_SECRETS` | **NOT bound** (Phase 3+ #89 is a separate ticket) |

The `BETTER_AUTH_SECRETS` binding is deliberately NOT added to the
Worker in this rotation. The Phase 3+ flip is the Issue #89 driver
(`scripts/phase-3-plus-prod-flip.mjs --execute --operation=flip`),
which is a separate operator gate. Do NOT mix containment with the
Phase B transition.

## Operation modes (mutually exclusive)

| Mode | What it does | Operator authorization required |
| --- | --- | --- |
| `--dry-run` (default) | describe plan, no network, no mutation | no |
| `--execute` | generate fresh + Infisical write + Worker write | yes (writer INFISICAL_TOKEN) |
| `--verify-only` | read Infisical + Worker binding names; report status | no (read-only) |
| `--worker-recovery` | read fresh from Infisical prod, write Worker only | yes (writer INFISICAL_TOKEN) |

`--execute` and `--worker-recovery` are the only modes that mutate
production. Both require operator-supplied `INFISICAL_TOKEN` with
**writer** scope on the `prod` environment. The viewer Machine
Identity (`my-web-2026-cf-worker`, role=`viewer`) fails-closed for
write paths.

## Step 0 — Operator pre-flight

Before running `--execute`:

1. Confirm the canonical production origin `https://rebuildup.dev` is
   reachable. The rotation does not change the route binding but
   verification surfaces depend on it.
2. Confirm the operator-scoped writer `INFISICAL_TOKEN` is available
   in the current shell. UA-from-MA is NOT acceptable.
3. Confirm no other `--execute` (or `--worker-recovery`) is in flight
   on the same Worker. Concurrent runs will race.
4. Smoke baseline: `pnpm run e2e:prod` (if available locally). The
   `--verify-only` mode in step 1 below is the canonical pre-flight
   check.

## Step 1 — Pre-flight: `--verify-only` (read-only, no mutation)

```bash
INFISICAL_TOKEN=<writer-token> pnpm run rotate:better-auth-secret -- --verify-only
```

Expected output (current pre-#139 state):

```text
[verify-only] Infisical BETTER_AUTH_SECRET: present
[verify-only] Infisical BETTER_AUTH_SECRETS: present
[verify-only] Infisical envelope invariant: BROKEN   ← legacy state
[verify-only] Worker bindings: 2 (BETTER_AUTH_SECRET BETTER_AUTH_SECRETS)
[verify-only] status=DIVERGENT
```

The `BROKEN` envelope invariant is expected BEFORE rotation. The
`DIVERGENT` status reflects that the existing `BETTER_AUTH_SECRETS`
envelope was constructed from the legacy plaintext, which has been
exposed in the agent transcript. After rotation completes, the
envelope will be reconstructed from the new fresh value.

## Step 2 — Rotation: `--execute` (operator gate)

```bash
INFISICAL_TOKEN=<writer-token> pnpm run rotate:better-auth-secret -- --execute
```

Driver pipeline:

1. Generate fresh `BETTER_AUTH_SECRET` in process via
   `crypto.randomBytes(48)` → 64 base64url chars (384 bits).
2. Write 0600 YAML temp file under `os.tmpdir()` containing both
   `BETTER_AUTH_SECRET: <fresh>` and `BETTER_AUTH_SECRETS: "1:<fresh>"`.
3. Spawn `infisical secrets set --file <yaml> --env=prod --path=/`
   (native CLI; E2EE; YAML quoted scalar; mode 0600; finally rmSync).
4. Read-back verify: HTTPS GET both secrets + `timingSafeEqual`
   against the in-process fresh value. Failure throws before any
   Worker mutation.
5. Spawn `wrangler secret bulk -c wrangler.production.jsonc` with
   stdin JSON `{ "BETTER_AUTH_SECRET": "<fresh>" }` (legacy binding
   only).
6. Verify: `wrangler secret list --format json` confirms
   `BETTER_AUTH_SECRET` is present.

The script will exit with status:

- `0` — full success
- `1` — argument / preflight failure (no mutation)
- `2` — Infisical subprocess failure (Worker NOT mutated)
- `3` — **partial-failure recovery state**: Infisical fresh-write
  succeeded, Worker fresh-write failed. **DO NOT re-run `--execute`**
  (that would generate a new fresh value and overwrite Infisical
  again). Run `--worker-recovery` instead (see step 3).

## Step 3 — Partial-failure recovery: `--worker-recovery`

If `--execute` exits with status `3`, the Infisical `prod`
`BETTER_AUTH_SECRET` and `BETTER_AUTH_SECRETS` already hold the
fresh values, but the Worker still holds the legacy value. Recovery:

```bash
INFISICAL_TOKEN=<writer-token> pnpm run rotate:better-auth-secret -- --worker-recovery
```

The driver reads the current `BETTER_AUTH_SECRET` from Infisical
`prod` (HTTPS GET) — this is the fresh value just written — and
writes it to the Worker via `wrangler secret bulk`. **No new value is
generated.** This is the safe recovery path; the alternative
(re-running `--execute`) would generate a second fresh value,
overwrite Infisical again, and leave the Worker inconsistent.

After `--worker-recovery` completes successfully, the canonical
post-rotation state is achieved and step 4 verification applies.

## Step 4 — Post-rotation verification

```bash
INFISICAL_TOKEN=<writer-token> pnpm run rotate:better-auth-secret -- --verify-only
```

Expected output:

```text
[verify-only] Infisical BETTER_AUTH_SECRET: present
[verify-only] Infisical BETTER_AUTH_SECRETS: present
[verify-only] Infisical envelope invariant: OK
[verify-only] Worker bindings: 1 (BETTER_AUTH_SECRET)
[verify-only] status=CONSISTENT
```

Notes on the expected Worker binding list:

- `BETTER_AUTH_SECRET` MUST be present.
- `BETTER_AUTH_SECRETS` MUST NOT be present (Phase 3+ #89 is a
  separate ticket — do NOT run `--delete-legacy-only` or `--flip` from
  `phase-3-plus-prod-flip.mjs` here).
- If the pre-rotation state had `BETTER_AUTH_SECRETS` bound, that
  binding is now stale and contains the LEGACY plaintext as part of
  the versioned value. The #139 rotation does NOT remove that
  binding. Cleanup is owned by Phase 3+ #89 (Issue #89 Phase B
  `flip` + post-deploy `delete-legacy-only`).

Then run the canonical automated smoke:

```bash
pnpm run e2e:prod
```

Expected: canonical surfaces green (HTTP 200 on `/`, `/api/v1/health`,
`/api/v1/db/ping`, `/api/v1/media/ping` returning `key_not_found`).

Finally, **operator manual sign-in** at
`https://rebuildup.dev/admin/login` with real production admin
credentials to confirm session establishment. The signing-secret
rotation invalidates all existing sessions (expected impact — see
"Expected production impact" below).

## Step 5 — Issue / PR closure

After step 4 verifies clean, close Issue #139 with a comment that
references:

- The exact pre-rotation `--verify-only` output (status=DIVERGENT)
- The exact post-rotation `--verify-only` output (status=CONSISTENT)
- The Worker binding list (1-name legacy only)
- The exact-head commit SHA of the rotation script
- The PR head SHA that landed the rotation script

PR #91 (release) MUST remain Draft until #89 Phase B
(`phase-3-plus-prod-flip.mjs --execute --operation=flip` + post-deploy
`--delete-legacy-only`) completes. Phase B is the separate gate that
adds the `BETTER_AUTH_SECRETS` Worker binding and removes the legacy
binding.

## Expected production impact

| Surface | Impact |
| --- | --- |
| All admin / user sessions | **Invalidated** — re-sign-in required |
| D1 `apikey` rows | Unaffected — rotation is signing-secret only |
| D1 portfolio / reaction / access counter data | Unaffected |
| R2 portfolio media | Unaffected |
| `MY_WEB_2026_CONSUMER_API_KEY` | Unaffected — covered by #74 (separate rotation) |

## Failure / rollback matrix

| Step | Failure | Action |
| --- | --- | --- |
| Step 2 (--execute) exit 1 | arg / preflight | fix env / args; rerun step 1 |
| Step 2 (--execute) exit 2 | Infisical CLI failed | inspect Infisical state with `--verify-only`; if both secrets already hold fresh values, jump to step 3 (--worker-recovery); otherwise investigate CLI failure |
| Step 2 (--execute) exit 3 | Infisical OK + Worker failed | run step 3 (--worker-recovery) |
| Step 3 (--worker-recovery) fails | Wrangler bulk failed twice | investigate wrangler output; if Worker already shows fresh binding name, run step 4 to confirm; otherwise contact operator |

**Critical invariant:** under NO circumstance should the script
roll Infisical `prod` back to the exposed legacy value. The legacy
value is the exposed one and is unsafe; rolling back re-uses it.

## Forbidden in this runbook

- `infisical secrets` value-listing against the real environment
  (the originating incident). Use `--verify-only` (HTTPS GET of
  individual secrets, byte-equality comparison only) instead.
- Direct `wrangler secret put` / `wrangler secret delete`
  invocations. Use `wrangler secret bulk` with stdin JSON via
  the rotation script.
- Re-running `--execute` after a partial failure (exit 3). Use
  `--worker-recovery` instead.
- Shell-embedded secret values in argv, CI logs, GitHub Actions
  output, or chat.
- Mixing the #139 containment rotation with the Issue #89 Phase B
  flip. They are separate operator gates.
- Manual HTTPS PUT of a secret value to Infisical — the v3 write
  endpoint requires E2EE ciphertext and is not supported from the
  Node API. Use the Infisical CLI via `--file` (YAML).

## References

- [`AGENTS.md §4`](../../AGENTS.md) — canonical architecture
  boundary.
- [`docs/adr/ADR-0015-infisical-env-management.md`](../adr/ADR-0015-infisical-env-management.md)
  §1 (Infisical SoT) / §6 (consumer API key) / §9 (audit-only
  legacy semantics).
- [`docs/runbook/cloudflare-workers-builds.md`](cloudflare-workers-builds.md)
  — Phase B release sequence (Issue #89 + #91).
- [`scripts/rotate-better-auth-secret.mjs`](../../scripts/rotate-better-auth-secret.mjs)
  — driver implementation (read top-of-file JSDoc for invariants).
- [`scripts/phase-3-plus-prod-flip.mjs`](../../scripts/phase-3-plus-prod-flip.mjs)
  — Issue #89 Phase B driver (separate ticket, separate gate).
- Issue #139 — canonical incident tracker.
- Issue #89 — Phase 3+ flip (separate ticket).
- Issue #122 — superseded by this rotation (the dev→prod reconcile
  premise is discarded).
- Issue #99 — prior production secret deletion/recovery incident.
