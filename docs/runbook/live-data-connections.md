# Live data feed production connections

Ordered sequence for connecting the three live-data feeds that shipped
in v0.9.0 — GitHub activity ingest, Discord presence, and the
self-hosted GitHub Readme Stats cards — **after Cloudflare
authentication exists**. Every step that is not an account operation
is copy-paste runnable; the owner-account steps are collected in
Phase 0 so they never block the technical sequence.

Per-feed detail stays in the dedicated runbooks; this document is the
order and the credential layout only:

- [`github-activity-sync.md`](github-activity-sync.md) — Issues
  #316 / #319 / #932
- [`discord-presence.md`](discord-presence.md) — Issue #320
- [`github-readme-stats.md`](github-readme-stats.md) — Issue #933
- [`infisical-secrets.md`](infisical-secrets.md) — secret SoT boundary

## Prerequisites

1. **v0.9.0 is deployed.** The ingest endpoints
   (`PUT /api/v1/activity/github`, `PUT /api/v1/presence/discord`) and
   the stats routes (`/api/v1/github-readme-stats/*`) exist only in the
   deployed Worker. All three feeds fail closed while unconnected, so
   connecting after deploy is the safe order — never before.
2. **D1 migrations are already applied.** The production deploy
   command (`deploy:production:prepared`) applies pending migrations
   before Wrangler deploy, so 0011 / 0012 land with v0.9.0. Verify,
   do not assume:

   ```sh
   pnpm run db:migrate:list:production   # needs CLOUDFLARE_D1_API_TOKEN
   ```

   Only if a feed must be connected **before** the deploy (not the
   normal order) apply manually:
   `pnpm run db:migrate:apply:production` (dry run) then
   `pnpm run db:migrate:apply:production -- --execute`.
3. **Cloudflare authentication.** `CLOUDFLARE_D1_API_TOKEN`
   (Infisical `prod`) covers every `--target=remote` /
   `--target=production` D1 operation, including the two
   `bootstrap:*-ingest-key` commands. Deploys and Worker secret
   bindings go through `cf deploy --prebuilt --secrets-file`, driven
   by `scripts/deploy-with-secrets.mjs` under Infisical `prod` —
   there is NO `wrangler secret put` / `cf workers secrets` path
   (Issue #969): a binding written outside the Infisical → deploy
   pipeline would diverge between local development and production.
4. **Infisical CLI** authenticated for `dev` (feed secrets) and `prod`
   (the D1 token).

## Secret layout — read before Phase 2/3

All three feed scripts read the ingest key from the **same env name**,
`MY_WEB_2026_API_KEY`, but each feed needs a **different key** (different
`apikey` row, different scope). One Infisical path cannot hold three
values under one name, so each feed gets its own folder and its own
`infisical run --path`:

| Feed | Infisical `dev` path | Secrets under it |
| --- | --- | --- |
| GitHub activity | `/feeds/github-activity` | `MY_WEB_2026_API_KEY` (`mk_activity_…`), `GITHUB_TOKEN`, `GITHUB_ACTIVITY_SALT` |
| Discord presence | `/feeds/discord-presence` | `MY_WEB_2026_API_KEY` (`mk_presence_…`), `DISCORD_BOT_TOKEN`, `DISCORD_USER_ID` |
| Readme Stats | n/a — the PAT is a Worker secret, not an Infisical `dev` value (see Phase 1) | — |

`GITHUB_TOKEN` / `GITHUB_ACTIVITY_SALT` already exist at the `dev`
root; copy them into `/feeds/github-activity` (or re-set them there)
because `infisical run --path=<folder>` injects that folder's secrets.
**Never rotate `GITHUB_ACTIVITY_SALT`** — rotation re-ids every private
anonymous project on the page.

## Phase 0 — owner account operations (parallel, no Cloudflare needed)

These are the only steps that cannot be automated. Start them at any
time; nothing below waits on them except the feed it belongs to.

1. **Discord application + bot** — create the app, create the bot,
   copy the token, enable **Presence Intent** only, invite with zero
   permissions, note the owner snowflake. Full steps:
   [`discord-presence.md`](discord-presence.md) §1.
2. **Readme Stats PAT** — create ONE fine-grained PAT with public-read
   scopes only; do not reuse a `repo`-scoped token on the public
   Worker. See [`github-readme-stats.md`](github-readme-stats.md).
3. **GitHub activity credentials** — `GITHUB_TOKEN` (PAT that can read
   private repos) and `GITHUB_ACTIVITY_SALT` are already seeded in
   Infisical `dev` (Epic #928); verify presence, do not re-generate
   the salt.

## Phase 1 — GitHub Readme Stats image (no D1)

Fastest feed; independent of the other two.

```sh
# Infisical is the ONLY secret path (Issue #969). The name is already
# in secrets.required on both wrangler configs + _cloudflare-contract.mjs,
# so the next `cf deploy --prebuilt --secrets-file` binds it — and a
# deploy attempted BEFORE the seed fails closed at run-deploy-inner.
infisical secrets set --env=prod GITHUB_README_STATS_PAT_1   # paste the PAT
infisical secrets set --env=dev  GITHUB_README_STATS_PAT_1   # optional: local cards
```

Verify all four endpoints answer real cards (200 + `image/svg+xml`;
a 503 "Service unavailable" body means the token is NOT bound):

```sh
for p in 'api?username=rebuildup' 'api/top-langs/?username=rebuildup' \
         'api/streak?username=rebuildup' \
         'api/pin/?username=rebuildup&repo=my-web-2026'; do
  curl -sI "https://rebuildup.dev/api/v1/github-readme-stats/$p" \
    | grep -iE 'HTTP/|content-type|cache-control'
done
```

Only after real cards render: the `rebuildup/rebuildup` README URL
migration is a separate-repo change in its own review flow — see
[`github-readme-stats.md`](github-readme-stats.md) §README migration.
Contract-managed binding (`secrets.required` + Infisical prod/dev
seeding) is a separate ticket, not a launch blocker.

## Phase 2 — GitHub activity ingest (Issues #316 / #319 / #932)

```sh
# 1. confirm migration 0012 is applied (deploy did it)
pnpm run db:migrate:list:production

# 2. mint the ingest key — needs CLOUDFLARE_D1_API_TOKEN (Infisical prod).
#    Prints the mk_activity_… plaintext ONCE.
infisical run --env=prod -- \
  pnpm run bootstrap:activity-ingest-key -- --target=remote

# 3. store the printed key in Infisical dev at /feeds/github-activity
#    as MY_WEB_2026_API_KEY (see Secret layout), together with
#    GITHUB_TOKEN and GITHUB_ACTIVITY_SALT.

# 4. dry-run, then first real publish
infisical run --env=dev --path=/feeds/github-activity -- \
  pnpm run activity:publish -- --dry-run
infisical run --env=dev --path=/feeds/github-activity -- \
  pnpm run activity:publish

# 5. schedule daily (launchd/cron) — same command, no --dry-run
```

The public side needs no further step: `live.ts` picks whichever
document (D1 row vs committed fallback) observed more recently, and a
stopped feed degrades to the committed snapshot automatically.

## Phase 3 — Discord presence (Issue #320)

```sh
# 1. confirm migration 0011 is applied
pnpm run db:migrate:list:production

# 2. mint the ingest key (needs CLOUDFLARE_D1_API_TOKEN)
infisical run --env=prod -- \
  pnpm run bootstrap:presence-ingest-key -- --target=remote
#    → mk_presence_… plaintext ONCE → Infisical dev
#      /feeds/discord-presence as MY_WEB_2026_API_KEY, plus
#      DISCORD_BOT_TOKEN and DISCORD_USER_ID from Phase 0.

# 3. one-shot verification, then the long-running feed
infisical run --env=dev --path=/feeds/discord-presence -- \
  node scripts/sync-discord-presence.mjs --once
infisical run --env=dev --path=/feeds/discord-presence -- \
  node scripts/sync-discord-presence.mjs
```

`DISCORD_PRESENCE_USER_ID` — the owner snowflake the public card
checks the snapshot against — is a **required runtime secret** in
the shared contract (`REQUIRED_RUNTIME_SECRETS` →
`bindings.secret()`), seeded only via Infisical `prod`:

```sh
infisical secrets set DISCORD_PRESENCE_USER_ID=<owner-snowflake> --env=prod --path=/
```

Until the secret is seeded AND the release deploy ships the binding,
the card fails closed to "unavailable" even with the feed running —
connecting the feed first is harmless.

Run the long-running feed under launchd/`KeepAlive` per
[`discord-presence.md`](discord-presence.md) §Running.

## Failure modes (all fail closed — order does not affect safety)

| Condition | Visible result |
| --- | --- |
| Stats PAT not bound | 503 + short-lived degraded SVG on all four endpoints |
| Activity ingest key missing / migration absent | PUT refused; home keeps serving the committed snapshot |
| `GITHUB_TOKEN` without `GITHUB_ACTIVITY_SALT` | sync refuses BEFORE any private fetch (exit 2) |
| Discord feed stopped > 15 min | presence card shows unavailable, never stale "online" |
| `DISCORD_PRESENCE_USER_ID` secret unset in Infisical `prod` | presence card unavailable regardless of feed |
| Any feed's `MY_WEB_2026_API_KEY` from the wrong Infisical path | 401/403 on PUT; last good snapshot ages out honestly |
