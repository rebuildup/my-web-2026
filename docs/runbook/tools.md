# Tools runbook (Issue #183)

This runbook covers the operational surface for the Tool Registry
obligation: how to mirror the manifest into D1, who is allowed to
seed the remote D1, and how the host's `/tools/$slug` route reads
the roster at runtime.

> Companion to `docs/tools/runbook.md`. The companion file
> documents the inventory / build-orchestrator / submodule-bump
> surfaces (the Issue #80 obligation). This file documents the
> D1 mirror seed (Issue #183 follow-up).

## 1. Read the canonical source of truth

The Tools obligation is manifest-driven. The host's
`/tools/$slug` route reads `src/tools/manifest.json` at build time
through `src/tools/registry.ts`. The D1 mirror is **derived**
state — it exists so operational tooling (admin views, drift
checks, future audit reports) can read the same roster the host
serves.

```text
src/tools/manifest.json          ← source of truth (read-only)
        │
        ▼
scripts/seed-tools.mjs           ← derives SQL INSERT statements
        │
        ▼
D1 `tool` table                  ← mirror (audit + drift checks)
```

The manifest remains authoritative. If the manifest and the D1
mirror disagree, the manifest wins — the mirror is a snapshot, not
a config.

## 2. Default mode: dry-run

```bash
pnpm run seed:tools
```

Default behaviour (no flags): the script emits SQL to stdout and
prints a status message to stderr. It does NOT spawn
`wrangler d1 execute`. Agents run this as a plan step, never as
an autonomous write. The produced SQL is:

1. `CREATE TABLE IF NOT EXISTS tool ( ... )` — self-bootstrapping
   against a fresh local D1.
2. One `INSERT OR REPLACE INTO tool VALUES (...)` per manifest
   entry. `slug` is the primary key, so re-running is idempotent.

The DDL column list (`slug`, `display_name`, `description`,
`canonical_repo`, `pinned_sha`, `delivery_kind`, `classification`,
`license`, `notes`, `created_at`, `updated_at`) is the minimum
needed for drift detection against the manifest.

## 3. Apply against local D1

```bash
pnpm run seed:tools -- --execute
```

`--execute` flips the script into the apply path. It still defaults
to `--target=local`, so the produced SQL is fed into:

```bash
pnpm exec wrangler d1 execute DB --local --file <tmp>/seed.sql
```

The SQL file is created in `os.tmpdir()` with mode `0600` and
cleaned up in a `finally` block; nothing secret ever crosses the
script boundary (the manifest has no secrets in scope).

## 4. Apply against remote D1 — operator-only

```bash
pnpm run seed:tools -- --execute --target=remote
```

This branch is **operator-only**. The script enforces a hard
target-rejection gate: `--target=remote` without `--execute`
exits `2` with a status-only message and refuses to spawn any
subprocess. The same gate is used by
`scripts/upload-portfolio-media.mjs` and is part of the agent
contract (AGENTS.md §4).

The full preconditions for a remote seed:

1. **Operator authorization in the current interaction.** Agents
   MUST NOT reach this branch silently. The authorisation scope
   matches the AGENTS.md §4 model: explicit operator approval,
   scoped to the current seed operation.
2. **Cloudflare account credentials available on the workstation.**
   `wrangler d1 execute --remote` needs an authenticated session.
   A CI environment with no `CLOUDFLARE_API_TOKEN` (or equivalent)
   will fail; this is the no-canonical-case-of-silent-fallback
   guard.
3. **`pnpm run db:migrate:list:remote` is clean** (no pending
   migrations on the production D1). The seed script does not run
   migrations; if the schema is stale, run migrations first.

## 5. Verify the local D1 mirror

```bash
pnpm exec wrangler d1 execute DB --local \
  --command "SELECT slug, display_name, delivery_kind FROM tool ORDER BY slug;"
```

Expected: 14 rows (the same roster as `src/tools/manifest.json`).
Drift check: compare the slug set against the manifest — every
manifest `slug` MUST appear in the mirror, and the mirror MUST
NOT contain slugs the manifest does not list.

## 6. /tools/$slug URL contract

The route at `src/routes/tools.$slug.tsx` enforces two URL
contracts:

1. **Lowercase canonical slug.** Manifest slugs match
   `^[a-z0-9][a-z0-9-]{0,127}$` (see
   `src/tools/manifest.schema.json`). The route loader lowercases
   `params.slug` before looking up the registry, so display-case
   URLs (`/tools/ProtoType`) still resolve to the canonical
   lowercase slug (`/tools/prototype`). The canonical URL itself
   remains lowercase — this is URL tolerance, not a
   canonicalisation contract.
2. **404 → empty state, no double chrome.** When the slug is
   genuinely unknown (loader throws `notFound()`), the route's
   `notFoundComponent` renders `ToolNotFound` — a SectionHeading
   with the eyebrow "404", a bilingual explanation, and a link
   back to `/tools`. The breadcrumb chain also drops the
   `/tools/$slug` leaf when the loader throws
   (`dropOnMissingLoaderData: true` in
   `src/editorial/nav/route-labels.ts`), so the visible chrome
   stops at "Home > Tools" instead of misleadingly showing a stub
   "Tool" leaf.

The 404 path is a meaningful surface, not a blank page with the
default `<p>Not Found</p>` string.

## 7. Forbidden shortcuts

- **Do not** import `src/tools/manifest.json` from a Cloudflare
  Worker handler / API route. The manifest is consumed only by
  the build orchestrator and the host's `/tools/$slug` route.
  Other surfaces go through the `tool` D1 mirror (this runbook).
- **Do not** bypass `--target=remote` rejection. The script exits
  `2` for a reason; do not remove the gate to "fix" a CI
  environment that lacks `CLOUDFLARE_API_TOKEN`.
- **Do not** treat the D1 mirror as authoritative. The manifest
  wins. If the mirror drifts, the fix is to re-run
  `pnpm run seed:tools -- --execute` against local D1; do NOT
  edit the mirror rows directly.
- **Do not** execute `--target=remote` from an agent session
  without explicit operator authorisation in the current
  interaction (see §4).

## 8. Related artefacts

- `src/tools/manifest.json` — canonical source of truth.
- `src/tools/manifest.schema.json` — JSON Schema for the
  registry.
- `src/tools/registry.ts` — host-side data source.
- `src/routes/tools.$slug.tsx` — iframe shell route + 404 empty
  state.
- `scripts/seed-tools.mjs` + `.test.mjs` — D1 mirror seed
  (this runbook).
- `scripts/build-tools.mjs` — artefact collection (companion
  runbook `docs/tools/runbook.md`).
- `scripts/check-tools-manifest.mjs` — manifest verifier
  (companion runbook).
- `docs/tools/inventory.md` — durable inventory of all 14 Tools.
- `docs/tools/runbook.md` — companion runbook (submodule /
  inventory / verification).
- `docs/adr/ADR-0006-tools-submodule-policy.md` — ADR this
  runbook operationalises.