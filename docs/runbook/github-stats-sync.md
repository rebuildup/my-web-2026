# GitHub stats snapshot sync (Issues #1244 / #1245)

Runbook for keeping the GitHub stats snapshot the profile Vitals /
Top Languages / stats surfaces read fresh — **without a commit, PR
merge or site release per refresh**, and without any GitHub API call
on the image-request path (ADR-0027, data contract
`docs/domain/github-profile-data.md`).

## Data flow

```text
GitHub API ──▶ scripts/sync-github-stats.mjs --push
                  │  (scope×window metrics; aggregates only)
                  ▼
        PUT /api/v1/stats/github   (Bearer github_stats:write key + Origin)
                  ▼
        D1 github_stats_snapshot (single row, migration 0013)
                  ▼
        profile surfaces read D1 only — upstream calls per request = 0
```

Unlike the activity feed there is NO committed JSON fallback: the
stats snapshot exists only in D1. A missing/invalid row renders the
honest "unavailable" variant; a stopped job preserves Last Known
Good automatically (the single row is only overwritten by a
validated push).

## Secrets (Infisical)

| Name | Content |
|---|---|
| `GITHUB_TOKEN` | PAT with `repo` scope — affiliation repos, private visibility, search API |
| `MY_WEB_2026_API_KEY` | The `github_stats:write` ingest key (own Infisical path, e.g. `/feeds/github-stats`) |

`GITHUB_TOKEN` is REQUIRED for this job (unlike the activity sync,
which degrades to public-only): affiliation discovery, the search
API and private-visibility repo stats all need auth.

## One-time provisioning

1. Apply migration 0013 (`pnpm run db:migrate:apply:local` /
   `pnpm run db:migrate:apply:production`).
2. Mint the ingest key:

   ```sh
   pnpm run bootstrap:stats-ingest-key -- --target=remote
   ```

   Prints the `mk_stats_…` plaintext **once**. Store it in Infisical
   as `MY_WEB_2026_API_KEY` for the stats-feed identity — do NOT
   reuse the activity or presence keys.

## Running

```sh
# build the document locally for review (writes .tmp/, pushes nothing)
pnpm run stats:sync -- --dry-run

# live update: gather → validate → PUT to D1 ingest
infisical run --env=dev --path=/feeds/github-stats -- pnpm run stats:publish
```

`stats:publish` writes NOTHING to the repository. Without
`GITHUB_TOKEN` the job refuses (exit 2). A total upstream failure
exits 1 and pushes nothing — Last Known Good is preserved. Partial
failures (e.g. search rate-limited) still push: affected metric
fields stay `null` and `sources.*.status` records which upstreams
answered.

## Scheduling

Daily is enough — vitals move slowly. Production runs it via the
operator-machine launchd job `dev.rebuildup.my-web-2026-github-stats`
(daily 09:30 JST, after the 09:00 activity sync), mirroring the
`dev.rebuildup.my-web-2026-github-activity` plist:

```sh
infisical run --env=dev --path=/feeds/github-stats -- \
  node scripts/sync-github-stats.mjs --push
```

Log: `/tmp/my-web-2026-stats-sync.log`. A missed day is safe — the
snapshot keeps serving Last Known Good until the next successful push.

## Rank comparison (contract §3.1)

Every snapshot carries `rank.current` (vendored calculateRank) and
`rank.legacy` (pre-vendoring anuraghazra formula) computed on the
IDENTICAL declared inputs — the old-vs-new comparison is data in
the snapshot itself, not a one-off report. First sync: compare the
two `rank.*` blocks, then record the observed delta under
`docs/verification/`.

## Failure modes

| Condition | Behaviour |
|---|---|
| GitHub API / GraphQL error | affected source `failed`; its metrics stay `null`; push still succeeds if any source answered |
| Search API rate limit | `sources.search = failed`; rank becomes `null` (inputs unmeasured); other metrics unaffected |
| Every upstream failed | exit 1, pushes nothing; LKG preserved |
| Ingest key missing/invalid | PUT 401/403; sync exits 1, LKG keeps serving |
| Migration 0013 not applied | PUT fails at the D1 write; apply via `db:migrate:apply:*` |
| D1 row missing | surfaces render honest "unavailable" — never zero |
