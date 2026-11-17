# Discord presence feed (Issue #320)

Runbook for the owner's Discord presence card on the home status
section: how the data flows, how to provision it, and how to stop it.
For the ordered production connection sequence across all three
v0.9.0 live feeds see
[`live-data-connections.md`](live-data-connections.md).

## Architecture

A Cloudflare Worker cannot hold a Gateway WebSocket, so the Discord
connection lives **outside** the Worker:

```text
Discord Gateway ──(official bot, GuildPresences intent)──▶
  scripts/sync-discord-presence.mjs  (operator machine)
        │  PUT /api/v1/presence/discord  (Bearer ingest key + Origin)
        ▼
  D1 discord_presence_snapshot (single row, migration 0011)
        │  SSR read at request time
        ▼
  src/home/presence/reader.ts → PresenceCard (fail-closed)
```

- The bot sees **only the owner's presence**. The script filters
  `presenceUpdate` to `DISCORD_USER_ID` and the snapshot schema has
  no field that could carry another member's data.
- The ingest endpoint requires an API key with the
  `discord_presence:write` scope — a dedicated consumer, separate
  from the home self-consumption key.
- The public reader re-validates the stored document and enforces a
  15-minute freshness window on `generatedAt`. A stopped feed shows
  the unavailable state, never a stale "online".

## One-time provisioning

### 1. Discord application + bot

1. Create an application at <https://discord.com/developers/applications>
   (or reuse an existing one).
2. Under **Bot**, create a bot user and copy the token.
3. Under **Bot → Privileged Gateway Intents**, enable
   **Presence Intent** (and leave Server Members / Message Content
   OFF — they are not needed). Bots below Discord's verification
   threshold do not need intent review.
4. Invite the bot to a guild the owner belongs to with no
   permissions required (scope `bot` with zero permissions is
   sufficient — presence reading needs no guild permissions).
5. The owner must share that guild and must not have "Enable
   Clipboard"/presence hidden from the bot's server (Discord user
   setting: Server Settings → Privacy → "Display currently running
   game" stays on; hiding online status hides presence entirely).

### 2. Ingest API key

```sh
pnpm run bootstrap:presence-ingest-key -- --target=remote
```

Prints the `mk_presence_…` plaintext **once**. Store it in the
operator's secret store (Infisical `dev` environment) as
`MY_WEB_2026_API_KEY` for the presence-feed identity — do NOT reuse
the home self-consumption key.

### 3. Worker secret + migration

Apply the migration to each target database before the feed is
enabled (`pnpm run db:migrate:apply:local` /
`pnpm run db:migrate:apply:production` — the production apply is the
usual gated operator step).

Set the real owner snowflake as the `DISCORD_PRESENCE_USER_ID`
runtime secret — it is a required name in the shared contract
(`scripts/_cloudflare-contract.mjs` → `REQUIRED_RUNTIME_SECRETS`,
mirrored in both `wrangler*.jsonc#secrets.required` and
`cloudflare.config.ts` `bindings.secret()`). Like the GA measurement
ID it is semi-public, but the value is operator-managed from the
Infisical dashboard, never committed config:

```sh
infisical secrets set DISCORD_PRESENCE_USER_ID=<owner-snowflake> --env=prod --path=/
```

While the secret is unset the card fails closed to unavailable.
The ingest feed must publish the same snowflake as `userId` or the
public reader refuses the snapshot.

### 4. Operator secrets

Via Infisical (`dev` env, process-scoped injection — never write
values to disk):

- `DISCORD_BOT_TOKEN` — the bot token from step 1.
- `DISCORD_USER_ID` — the owner snowflake from step 3.
- `MY_WEB_2026_API_KEY` — the ingest key from step 2. Stored at the
  feed's own Infisical path `/feeds/discord-presence` — see
  [`live-data-connections.md`](live-data-connections.md) "Secret
  layout"; the env name is shared by all three feeds, so the path is
  what keeps the keys distinct.

## Running

```sh
# one-shot verification (pushes current presence, exits)
infisical run --env=dev --path=/feeds/discord-presence -- node scripts/sync-discord-presence.mjs --once

# long-running feed (launchd / tmux / any always-on shell)
infisical run --env=dev --path=/feeds/discord-presence -- node scripts/sync-discord-presence.mjs
```

The script re-pushes the re-observed presence every
`PRESENCE_REFRESH_MS` (default 5 min) so `generatedAt` stays inside
the 15-minute reader window, and pushes immediately on every
`presenceUpdate` for the tracked user.

A launchd plist for macOS is left to the operator; the contract the
plist must satisfy is simply "run the command above, restart on
exit". `KeepAlive` is appropriate — the script exits non-zero only
on missing env or fatal login errors.

## Stopping

- `Ctrl+C` / `SIGTERM`: the script pushes one `offline`,
  `isLive:false` snapshot (best effort) so the card stops claiming
  "online" immediately, then exits.
- Killing the process uncleanly: the last snapshot goes stale within
  15 minutes and the card degrades to unavailable on its own.
- Revoking access entirely: disable the ingest key (admin → API
  keys) and/or delete the D1 row. The endpoint then refuses writes
  and the card shows unavailable.

## Failure modes (all fail closed)

| Condition | Card shows |
|---|---|
| No D1 row / `DISCORD_PRESENCE_USER_ID` secret unset | unavailable |
| Feed stopped > 15 min (`generatedAt` stale) | unavailable |
| Stored document fails re-validation | unavailable |
| `userId` mismatch vs the `DISCORD_PRESENCE_USER_ID` secret | unavailable |
| Ingest key revoked / wrong scope | push fails, last snapshot ages out |

## Privacy notes

- Only the owner's presence is tracked; other guild members are
  never read into the snapshot (the wire schema has no field for
  them, and `.strict()` rejects smuggled keys).
- The snapshot stores presence metadata only — no messages, no DMs,
  no tokens. `docs/privacy` lifecycle entry
  `discord-presence-snapshot` documents retention (single row,
  overwritten) and deletion (operator D1 delete).
