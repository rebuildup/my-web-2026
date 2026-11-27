# GitHub activity snapshot sync (Issues #316 / #319 / #932)

Runbook for keeping the GitHub activity snapshot the home "現在地"
sections read fresh — including the anonymised private-repository
half — **without a commit, PR merge or site release per refresh**.
For the ordered production connection sequence across all three
v0.9.0 live feeds see
[`live-data-connections.md`](live-data-connections.md).

## Data flow

```text
GitHub API ──▶ scripts/sync-github-activity.mjs --push
                  │  (anonymise BEFORE serialise; checkActivitySnapshot gate)
                  ▼
        PUT /api/v1/activity/github   (Bearer github_activity:write key + Origin)
                  ▼
        D1 github_activity_snapshot (single row, migration 0012)
                  ▼
        src/home/activity/live.ts → status card + current-projects
        (valid AND freshest observedAt wins; committed JSON is the
         reviewed fallback / release seed)
```

The committed `src/home/activity/github-activity.json` is still the
fallback: if the D1 row is missing, invalid, or older than the
committed document, the home renders the committed artefact. A
stopped feed therefore degrades to the last reviewed snapshot
instead of serving stale data as fresh.

## Why operator-side, not CI

The private half needs two credentials:

- `GITHUB_TOKEN` — a PAT that can read the owner's **private**
  repositories (`repo` scope).
- `GITHUB_ACTIVITY_SALT` — the HMAC salt behind the stable
  `private-<hmac12>` anonymous ids. Changing it re-ids every private
  project on the page. **Generate once, never rotate.**

`quality/actions-pins.json` approves **zero** repository-secret
references by policy: runtime credentials are Infisical-owned and a
CI step that can read them would be a new credential path, not a
convenience. The auto-update is therefore an operator-side scheduled
job with secrets injected by `infisical run` into that process only.

## Secrets (Infisical `dev` environment)

| Name | Content |
|---|---|
| `GITHUB_TOKEN` | PAT with `repo` scope (fine-grained PAT scoped to the owner's repos also works) |
| `GITHUB_ACTIVITY_SALT` | Random salt, e.g. `openssl rand -hex 32`. **Generate once, never rotate** — rotation changes every private-anon id. |
| `MY_WEB_2026_API_KEY` | The `github_activity:write` ingest key (see below). Stored at the feed's own Infisical path `/feeds/github-activity` — see [`live-data-connections.md`](live-data-connections.md) "Secret layout"; the env name is shared by all three feeds, so the path is what keeps the keys distinct |

Store all three in the self-hosted Infisical
(`https://secrets.rebuildup.dev`, project `d4c2fc09-…`, env `dev`).
Never write them to `.env` files or the repository.

## One-time provisioning

1. Apply migration 0012 to each target database
   (`pnpm run db:migrate:apply:local` /
   `pnpm run db:migrate:apply:production` — the production apply is
   the usual gated operator step).
2. Mint the ingest key:

   ```sh
   pnpm run bootstrap:activity-ingest-key -- --target=remote
   ```

   Prints the `mk_activity_…` plaintext **once**. Store it in
   Infisical `dev` as `MY_WEB_2026_API_KEY` for the activity-feed
   identity — do NOT reuse the home self-consumption or Discord
   presence keys.

## Running

```sh
# refresh the committed artefact only (reviewed fallback / seed)
infisical run --env=dev --path=/feeds/github-activity -- pnpm run activity:sync
infisical run --env=dev --path=/feeds/github-activity -- pnpm run activity:check   # privacy/shape gate

# live update: fetch → anonymise → gate → PUT to D1 ingest
infisical run --env=dev --path=/feeds/github-activity -- pnpm run activity:publish
infisical run --env=dev --path=/feeds/github-activity -- pnpm run activity:publish -- --dry-run
```

`activity:publish` (`sync-github-activity.mjs --push`) writes
NOTHING to the repository: it builds the snapshot in memory, runs
the same `checkActivitySnapshot` gate the committed file passes
through, and PUTs the document to
`GITHUB_ACTIVITY_INGEST_URL` (default
`https://rebuildup.dev/api/v1/activity/github`). Override the URL
only for non-production targets. Without `GITHUB_TOKEN` the private
source stays `unconfigured` — the push still works and publishes the
public half. `GITHUB_TOKEN` without `GITHUB_ACTIVITY_SALT` is a hard
failure BEFORE any fetch: private repositories are never retrieved
without the anonymisation secret.

## Scheduling

A daily run is enough — the snapshot carries its own
`generatedOn`/`observedAt`, and the public surface shows whichever
document observed most recently. Production runs it via the
operator-machine launchd job
`dev.rebuildup.my-web-2026-github-activity` at 09:00 and 21:00 JST
(the evening slot is the same-day catch-up for a failed or missed
morning run):

```sh
infisical run --env=dev --path=/feeds/github-activity -- pnpm run activity:publish
```

The push is idempotent: an unchanged snapshot simply overwrites the
single D1 row; there is no PR noise because there is no PR.

Resilience (Issue #1254): the script takes
`.tmp/sync-github-activity.lock` before any network call (a second
concurrent run exits cleanly; dead-pid or >2h locks are reclaimed),
and the ingest PUT retries transient 429/5xx/network failures with
bounded backoff via `scripts/_sync-ops.mjs`. Freshness is observable
at `GET /api/v1/github-profile/snapshot-health`, which the daily
prod-smoke asserts stays `fresh` for the smoke-critical sources.

## Privacy contract

- Private repos are reduced to `{ id: 'private-<hmac12>', kind,
  name: '非公開プロジェクト', lastActiveAt?, activity }` **before**
  serialisation — the serializer builds private entries
  field-by-field and never spreads upstream data.
- `anonId` has NO fallback salt: an empty/missing
  `GITHUB_ACTIVITY_SALT` throws, and `buildSnapshot` refuses to emit
  private entries without it. A predictable HMAC key would let anyone
  recompute `private-<hmac12>` for a guessed repo id and re-link the
  anonymous project — the fail-closed path makes that impossible.
- `checkActivitySnapshot` (`scripts/check-github-activity.mjs`)
  re-verifies the artifact: private entries may carry only the
  anonymous allowlist, ids must match `private-[0-9a-f]{12}`, feed
  entries are public-only. `--push` runs the same gate in memory
  before anything leaves the operator machine.
- The ingest boundary re-validates independently
  (`src/http/activity/schema.ts`, strict allowlist) and the public
  reader (`src/home/activity/snapshot.ts`) validates again on read —
  a document that leaks a private identifier is refused at write AND
  at render.
- The salt, token and ingest key are never written to the snapshot,
  logs or the repository. Push/log output is status-only (counts,
  never identifiers beyond the already-anonymous ones).

## Failure modes

| Condition | Behaviour |
|---|---|
| GitHub API error / rate limit | sync exits 1, pushes nothing; last good D1 row / committed snapshot keeps serving |
| `GITHUB_TOKEN` unset | private source `unconfigured`; public half still pushes |
| `GITHUB_TOKEN` set, `GITHUB_ACTIVITY_SALT` unset | hard failure (exit 2) before any fetch — private repos are never pulled without the salt |
| Snapshot fails `checkActivitySnapshot` | push aborts before the request; nothing stored |
| Ingest key missing/invalid | PUT returns 401/403; sync exits 1, last good snapshot keeps serving |
| Migration 0012 not applied | PUT fails at the D1 write; apply via `db:migrate:apply:*` |
| D1 row stale/invalid | home falls back to the committed snapshot automatically |

## Rotating the committed artefact

The committed JSON is the reviewed fallback, not the live source.
Refresh it deliberately (e.g. before a release that should carry a
recent seed):

```sh
infisical run --env=dev --path=/feeds/github-activity -- pnpm run activity:sync   # writes the file
infisical run --env=dev --path=/feeds/github-activity -- pnpm run activity:check
# review the diff, commit on a ticket branch → release-0-9-0
```
