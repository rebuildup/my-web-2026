# Consumer API key rotation — current manual path

> Manual rotation runbook for `MY_WEB_2026_CONSUMER_API_KEY` until
> Issue #74 (`scripts/rotate-home-api-key.mjs`) lands.
> Source-controlled by Issue #71 (ADR-0015 Phase 5). Cross-linked
> from [`AGENTS.md`](../../AGENTS.md) and
> [`docs/adr/ADR-0015-infisical-env-management.md`](../adr/ADR-0015-infisical-env-management.md).

## Pair contract

The consumer API key exists as a **pair**:

| Side | Location | Identity |
| --- | --- | --- |
| Plaintext value (the "key") | Cloudflare Worker runtime secret `MY_WEB_2026_CONSUMER_API_KEY`, mirrored to Infisical `prod` | inline value (logged-once, never re-readable from either side) |
| SHA-256 hash of the plaintext | D1 `apikey` table (Better Auth table) — row `WHERE name = 'home-self-consumption' AND enabled = 1` | `apikey.id` (UUID) + `apikey.referenceId` (Better Auth user UUID) |

Both sides must agree, or the home reactions / access-counter /
sign-in internal surfaces fail with `401 invalid api key` from
Better Auth's verification. The D1 row is the rotation anchor:
until the D1 row is updated, the Worker binding is the *old*
plaintext even if Infisical / Worker secret is the *new* one.

## Current state (as of 0.5)

The current production pairing was created by
`scripts/bootstrap-home-api-key.mjs` and recorded in the bootstrap
JSON output:

```json
{
  "id": "<apikey.uuid>",
  "prefix": "mk_home_",
  "start": "mk_hom",
  "createdAt": <epoch-ms>,
  "enabled": 1,
  "name": "home-self-consumption",
  "referenceId": "<admin-user-uuid>"
}
```

Subsequent runs of `bootstrap-home-api-key.mjs` are **rerun-idempotent**:
if an enabled row with the same `name` already exists, the script
reports the existing row identity WITHOUT minting a new plaintext.
The original plaintext is therefore only available at row-creation
time. If the plaintext is lost after that point, the row is
**unrecoverable** and a new row must be minted (see "Unrecoverable
plaintext case" below).

## Operations available now (no script change required)

The following operations are available today using existing scripts
and a few `wrangler d1 execute` invocations. They are **manual** in
the sense that there is no end-to-end driver.

### Inspect the current row

```bash
# Local D1 (vitest workerd pool Miniflare)
pnpm exec wrangler d1 execute my-web-2026 --local \
    --command="SELECT id, name, prefix, start, created_at, enabled, reference_id
               FROM apikey WHERE name='home-self-consumption';"

# Production D1 (use only inside an operator-authorized session)
pnpm exec wrangler d1 execute my-web-2026 -c wrangler.production.jsonc \
    --remote --command="<same SELECT>"
```

Output is **machine-readable JSON**; never include the row in
chat logs unless it is the bare row identity (id, prefix, start,
createdAt), not the plaintext.

### Recoverable plaintext case (the plaintext is known)

If the current plaintext is held outside the bootstrap (e.g. in
the operator's local `.dev.vars` or documented somewhere safe):

1. **Confirm both sides agree** before changing anything:

   ```bash
   # Confirm Worker binding matches the held plaintext (no
   # plaintext echo: compare hashes in-process).
   pnpm exec node -e '
     const { createHash } = await import("node:crypto");
     const held = process.env.HELD_PLAINTEXT;
     const worker = process.env.WORKER_PLAINTEXT;     # piped from a one-shot read; do not save
     const h = (s) => createHash("sha256").update(s).digest("base64url");
     if (h(held) !== h(worker)) process.exit(1);
     console.log("MATCH");'
   ```

2. **Skip the D1 step.** The row already binds to the same plaintext.

3. **Update Infisical `prod` only** (if the held plaintext differs
   from the Infisical value):

   ```bash
   INFISICAL_TOKEN=<writer-token> \
       pnpm exec infisical secrets set MY_WEB_2026_CONSUMER_API_KEY \
       --env=prod --secretValue='<new-plaintext>'
   # `secrets set` writes the new value to the Infisical env atomically.
   # The `INFISICAL_TOKEN` is the operator's write-scoped UA token,
   # NOT the viewer Machine Identity used by deploys.
   ```

4. **Trigger a Cloudflare Workers Builds deploy** to push the new
   value into the Worker binding. The deploy command
   (`pnpm run deploy:production:prepared`) reads the new Infisical
   value via the build's UA credentials and updates the Worker.

5. **Smoke verify** the new key:

   ```bash
   curl -X POST https://rebuildup.dev/api/v1/reactions \
       -H "X-API-Key: <new-plaintext>" \
       -H "Content-Type: application/json" \
       -d '{"slug":"rotation-smoke","action":"count"}'
   # expect 2xx with a non-error response body
   ```

The old plaintext remains valid until step 4 lands; the consumer
rotate is therefore an atomic step at the deploy.

### Unrecoverable plaintext case (the plaintext is lost)

If the original plaintext was never recorded anywhere it is still
readable, and the row has no plaintext to mint from:

1. **Operator gate.** Confirm with the repository owner that you
   intend to mint a NEW key. Old consumers (anywhere else in the
   codebase that holds `MY_WEB_2026_CONSUMER_API_KEY` — locally
   cached `.dev.vars`, Cloudflare Dashboard, third-party triggers)
   will be invalidated by the disable step. The operator should
   have already inventoried those consumers before this gate.

2. **Mint the new row + plaintext** by running bootstrap on a fresh
   environment:

   ```bash
   # The script's rerun-idempotent path detects existing enabled rows
   # and refuses to mint a new plaintext. Force a new row by first
   # disabling the existing one (next step), then re-run bootstrap.
   pnpm exec node scripts/bootstrap-home-api-key.mjs --target=remote --json
   ```

3. **Update Infisical `prod`** with the new plaintext
   (same `secrets set` invocation as the recoverable case).

4. **Cloudflare Workers Builds deploy**, then smoke verify as above.

5. **Disable the old row** (this is the destructive part — see
   operator gate below):

   ```bash
   pnpm exec wrangler d1 execute my-web-2026 -c wrangler.production.jsonc \
       --remote --command="UPDATE apikey
                           SET enabled = 0
                           WHERE id = '<oldRowId>';"
   # oldRowId is the UUID from step 2's pre-disable row inspection
   ```

   This update is **destructive and immediate**:
   - Any cached `MY_WEB_2026_CONSUMER_API_KEY` plaintext held
     outside the Worker stops authenticating.
   - The old row's `reference_id` (Better Auth user UUID) is
     retained for audit; only `enabled` flips to 0.
   - D1 migration `0006_apikey_key_unique.sql` enforces
     `UNIQUE(apikey.key)` on the hash; the new row has a
     different plaintext → different hash → no collision.

6. **(Recommended) Rotate the Better Auth admin user password**
   if the compromised credential had access to anything beyond
   the consumer API key.

## Out of scope until #74 lands

Issue #74 (`scripts/rotate-home-api-key.mjs`) is a **Phase 3+
follow-up** (deferred from the original ADR-0015 §F "Phase 2 新規"
language — see ADR-0015 §F + the operator review comment that
caught the deferral, recorded on #74). Until that script
merges, the manual steps above are the only canonical path.

The dedicated script will consolidate:

- argv parsing (`--dry-run` / `--execute`, `--target=local|remote`)
- row-count branching (0 / 1 / 2+)
- in-process plaintext comparison (no echo)
- Infisical HTTPS PUT via Universal Auth
- Workers Builds deploy trigger
- post-deploy smoke curl templates
- D1 old-row disable step

When #74 lands, this runbook becomes the **recovery-mode only**
section of a larger rotation tool's docs; #74's body documents
its own argv contract and AC.

## Plaintext discipline (binding for all paths)

- **Plaintext is one-time output** at row creation. Never echo it
  into chat, GitHub, log, or argv after creation.
- **HASH comparisons are the only verification primitive**.
  Compare `sha256(plaintext).digest('base64url')` in-process;
  never print plaintext to compare.
- **Operator gate for destructive operations.** Row `disable` and
  plaintext unrecoverable mint both require operator authorization
  in the current interaction (per AGENTS.md §6 / release-merge-human-gate
  spirit — the consumer API key is a runtime secret, even if not a
  Worker secret).
- **plaintext is never a command-line argument.** Pipe via `secrets set`
  stdin, or use `pbcopy` / a file with `chmod 600` and `read -s` for
  shell entry. Never `MY_WEB_2026_CONSUMER_API_KEY=<v> pnpm …` in
  chat-attached sessions.

## References

- ADR-0015 §6 + §F.
- Issue #74 (`scripts/rotate-home-api-key.mjs`).
- `scripts/bootstrap-home-api-key.mjs` (idempotent rerun path).
- `scripts/infisical-bootstrap-api.mjs` + `scripts/infisical-seed.mjs`
  (Universal Auth HTTPS POST helpers).
- Migration `0006_apikey_key_unique.sql`.
- `docs/runbook/cloudflare-workers-builds.md` (canonical deploy
  path that the post-rotation deploy step invokes).
