# ADR-0013 — Emoji catalog: hard-coded → D1-backed, then top-level `reactions/` obligation

- Status: Accepted (revised 2026-09-19)
- Date: 2026-09-19
- Branch: 39 (rev)
- Ticket: G (initial) + boundary follow-up after PR #44 review
- Sprint: 0.3.0-extended
- Decision driver: 0.3.0-extended home integration (Tickets E + F + G)
  + architecture-boundary review on PR #44 (P1)
- Replaces: the 16-slug hard-coded catalog that lived in
  `src/home/reactions/emoji-catalog.ts` from Ticket E (branch 37)
- Module location: in branch 39's first cut the catalog lived at
  `src/http/reactions/emoji-catalog.ts` (under the HTTP owner). After
  the PR #44 architecture review it was promoted to the top-level
  `src/reactions/` obligation so neither `home/` nor `admin/` has to
  cross the HTTP boundary for slug catalog reads or writes.

## 1. Context

Ticket E (branch 37) shipped the home reactions widget with a
**hard-coded** 16-slug emoji catalog (`src/home/reactions/emoji-catalog.ts`):
`thumbs_up`, `tada`, `fire`, `eyes`, `sparkles`, `rocket`, `heart`,
`laughing`, `thinking`, `clap`, `wave`, `check`, `cross`, `warning`,
`star`, `bulb`. The catalog was deliberately synchronous and
in-process so the slug format (`^[a-z][a-z0-9_]*$`, 1..32 chars)
could be locked down before exposing it as a contract (originally
scoped at 1..32 chars; finalised at 1..16 to match the reactions
API — see the contract alignment note below).

In practice, hard-coding the catalog means every vocabulary change
— adding a new reaction glyph, swapping a codepoint for a
better-rendered one, retiring a slug — requires a code commit and a
release. That is fine for a one-pass vocabulary but does not scale
to "I want to swap `tada` 🎉 for `confetti_ball` 🎊 without
redeploying". The 0.3.0-extended sprint was scoped to make the home
page actually consume the reactions + access counter APIs, so
promoting the catalog to a D1-backed table is the obvious follow-up
to "let admins manage it without a deploy".

**Contract alignment note (post-review):** The slug contract was
originally scoped at 1..32 chars, but `/api/v1/reactions` constrains
the `value` field to ≤ 16 chars (`src/http/reactions/schema.ts`
`MAX_EMOJI_LEN`). Because the home widget stores each slug AS the
opaque `value` of a `kind: 'emoji'` reaction, catalog slugs longer
than 16 would be registered successfully but silently 400 at
PUT/DELETE. We align `MAX_EMOJI_SLUG_LEN` to 16 in
`src/http/reactions/slug-regex.ts` so admin and the reactions API
agree on the same maximum.

## 2. Decision

Promote the catalog to a D1-backed `reaction_emoji_catalog` table
with admin CRUD. Slug contract, reactions API external contract, and
home widget external rendering contract are **unchanged**.

### 2.1 Schema (`migrations/0004_emoji_catalog.sql`)

```sql
CREATE TABLE IF NOT EXISTS reaction_emoji_catalog (
    slug         TEXT    PRIMARY KEY,
    codepoint    TEXT    NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_by   TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reaction_emoji_catalog_enabled
    ON reaction_emoji_catalog(enabled);
```

- `slug` is the public `:slug:` contract — `^[a-z][a-z0-9_]*$`,
  1..16 chars (aligned to `MAX_EMOJI_LEN`). PK so duplicate inserts
  are caught by SQLite.
- `codepoint` is the literal emoji string (1..16 UTF-16 code units —
  enough for ZWJ sequences like 👨‍👩‍👧‍👦).
- `enabled` is 0/1; `disabled` rows stay in the table but the home
  widget stops showing the chip and the picker.
- `created_by` / `created_at` / `updated_at` for audit.
- Seed: the 16 Ticket-E slugs are inserted via `INSERT OR IGNORE`
  with `enabled = 1` so a fresh deploy renders the same vocabulary
  before any admin action.

### 2.2 Module layout

- `src/reactions/slug-regex.ts` — the slug regex / length constants
  (`EMOJI_SLUG_REGEX`, `MAX_EMOJI_SLUG_LEN`). Single canonical import
  path for both `home/` and `admin/` consumers.
- `src/reactions/slug-validate.ts` — pure `validateSlug` and
  `validateCodepoint` helpers (the catalog seam). Used by the home
  loader (`addHomeReactionImpl` / `removeHomeReactionImpl`) and by
  the admin CRUD.
- `src/reactions/emoji-catalog.ts` — DB-backed read + CRUD functions
  over `D1Database`:
  - `loadCatalog(db, { includeDisabled? })` — home widget read.
  - `listAllCatalogEntriesForAdmin(db)` — admin list read (includes
    audit fields).
  - `insertCatalogEntry`, `rebindCatalogEntry`,
    `setCatalogEntryEnabled`, `removeCatalogEntry` — admin writes.
  - Pure helpers `resolveCodepoint`, `isEnabled` for slug → glyph
    resolution.
- `src/reactions/` is a **top-level obligation owner** (ADR-0008),
  co-owned conceptually by `home/` and `admin/`. Promoting the
  catalog out of `src/http/reactions/` was forced by the PR #44
  architecture review: AGENTS.md §3 declares
  `home/reactions → http/reactions (schema types only)`, which
  forbids the home loader from value-importing a D1-backed catalog
  through the HTTP boundary. The reactions API router
  (`src/http/reactions/router.ts`) still does not own or touch the
  catalog; it accepts opaque `value` strings ≤16 chars, the same as
  in branch 36.
- `src/home/reactions/emoji-catalog.ts` — thin home-side facade that
  re-exports the contract from `src/reactions/emoji-catalog.ts` and
  adapts it to the home widget's prop-driven
  `HomeReactionsData.catalog` field. The home widget never imports
  the DB catalog module directly; the SSR loader primes the catalog
  and threads it through props.
- `src/admin/emoji-catalog/load.ts` — admin CRUD `createServerFn`
  wrappers around the catalog functions (now imported from
  `src/reactions/`), each gated by `requireAdmin()`.
- `src/admin/emoji-catalog/catalog.tsx` — admin UI view (list +
  per-row actions + create form).
- `src/routes/admin.emoji-catalog.tsx` — `/admin/emoji-catalog`
  route file.

### 2.3 Home integration

- `getHomeReactionsImpl` now reads `loadCatalog(env.DB)` in parallel
  with the upstream `/api/v1/reactions` fetch; the result is exposed
  as `HomeReactionsData.catalog`.
- `addHomeReactionImpl` and `removeHomeReactionImpl` validate the
  incoming `value` (kind=`emoji`) against the DB-backed catalog via
  `validateEmojiSlug(catalog, value)` — the same seam the widget
  uses, so client and server agree.
- Disabled slugs **reject** the home widget write — admin disabled
  them deliberately, the home should not bypass that. Unknown
  slugs continue to reject (same as Ticket E's behavior).
- The home widget reads `data.catalog` (not a constant import) so
  any admin rebind takes effect on the next SSR pass without a
  client bundle refresh.

### 2.4 Admin surface

- New admin capability "Emoji catalog" (`src/routes/admin.tsx`).
- Route `/admin/emoji-catalog` — loader is admin-gated via
  `getCurrentSession` + role check; redirects to `/admin/login` or
  `/admin` like the other admin routes.
- Create form: `slug` (regex-validated client-side) + `codepoint`
  (single emoji).
- Per-row actions: `enable`/`disable`, `rebind` (prompt), `remove`
  (confirm). Each goes through its own `createServerFn` wrapper.

## 3. Trade-offs

### 3.1 Disabled-slug write rejection

We chose to **reject** PUT/DELETE on disabled slugs (rather than
silently accepting them). Reasoning:

- The slug → enabled state is an explicit admin signal that
  "this reaction is not currently rendered". Silently accepting
  writes would inflate aggregates on a chip nobody can see.
- The dedup UNIQUE on `(target_key, principal, actor_id, kind,
  value)` means a visitor who already had `:foo:` recorded before
  the admin disabled it cannot remove it either — they get
  `invalid_body`. This is intentional: the admin signal wins over
  visitor cleanup.

The alternative (silently accept) would be safer-but-uglier:
historical reactions would keep appearing on the home widget via
their stored `:slug:` text (the inert placeholder), but new
aggregates would accumulate. We chose explicit rejection over silent
acceptance for clarity; ADR-0008 §2 calls out that admin signals
should not be subverted by visitor actions.

### 3.2 No cache layer

Each home SSR pass reads the catalog from D1 (`loadCatalog(db)`).
D1 reads are cheap (small indexed table, sorted result) and the
catalog only changes when an admin takes an action, so adding a
cache would be premature optimisation. The home loader primes the
catalog once per request; the widget reuses `data.catalog` across
re-renders. If the catalog grows past a few hundred rows in a future
sprint, add an in-process LRU keyed by `Date.now() / cache_ttl_ms`
inside `loadCatalog` — until then, a fresh read is the simplest
correct thing.

### 3.3 No `workers.dev` references

Per the canonical domain decision (memory: `rebuildup-dev-canonical-domain`),
no `*.workers.dev` URL appears anywhere in this ticket's new code
or migrations. The production wiring ticket (Issue #43, task #64)
owns the Cloudflare custom-domain setup.

### 3.4 Slug renames are not supported

`slug` is the PK; an admin cannot rename a slug. They can disable +
add a new slug, but existing reactions with the old slug keep
working (they just render the inert `:old_slug:` placeholder). This
is the same trade-off documented in Ticket E's
`emoji-catalog.ts`: slugs are stable opaque keys, and the
historical record is preserved.

### 3.5 Obligation owner: catalog lives outside the HTTP boundary

The first cut of branch 39 placed the catalog at
`src/http/reactions/emoji-catalog.ts`, under the HTTP-boundary
obligation. PR #44's architecture review surfaced that AGENTS.md §3
declares `home/reactions → http/reactions (schema types only)`, so
the home loader was forced to value-import a D1-backed CRUD module
through an owner that does not need it (the reactions API router
itself never reads or writes the catalog). Rather than loosen the
architecture-checker, we promoted the slug grammar
(`slug-regex.ts`), the catalog seam (`slug-validate.ts`), and the
DB-backed catalog (`emoji-catalog.ts`) to a new top-level
`src/reactions/` obligation. The boundary change preserves the
external contract (the Hono router is unchanged) and removes the
forbidden edge.

The trade-off is one extra directory at the top of `src/`. That
cost is paid back by the fact that `home/`, `admin/`, and any future
consumer of the catalog can import the catalog directly without
going through the HTTP boundary or paying a `fetch` round-trip.
TypeScript's `verbatimModuleSyntax: true` plus the architecture
checker (`typeOnlyEdges = [{ from: 'home', to: 'http' }]`) keeps
the remaining `home → http` edge type-only, so the runtime graph is
unchanged.

## 4. Consequences

### 4.1 What changes

- `src/reactions/emoji-catalog.ts`,
  `src/reactions/slug-regex.ts`,
  `src/reactions/slug-validate.ts` — new top-level obligation owner
  carrying the slug grammar and the DB-backed catalog CRUD. These
  modules previously lived under `src/http/reactions/`; they were
  promoted to satisfy AGENTS.md §3
  (`home/reactions → http/reactions (schema types only)`).
- `src/http/reactions/{slug-regex,slug-validate,emoji-catalog}.ts`
  deleted; only the Hono router, request schema, and reaction-image
  module remain under `src/http/reactions/**`.
- `src/home/reactions/emoji-catalog.ts` — was a constant table (Ticket
  E); now a thin facade over `src/reactions/emoji-catalog.ts`. Public
  surface for `widget.tsx` / `load.ts` changed from sync constants
  to catalog-parameterised helpers.
- `HomeReactionsData` gains a `catalog: readonly CatalogEntry[]`
  field. SSR loader is the single producer.
- `getHomeReactionsImpl`, `addHomeReactionImpl`,
  `removeHomeReactionImpl` — read `env.DB` via the `HomeReactionsEnv`
  shape. Tests inject `DB: env.DB` (the workerd binding).
- `src/admin/emoji-catalog/load.ts` — imports the catalog + slug
  validators from `src/reactions/` (previously from
  `src/http/reactions/`).
- `src/admin/composer.tsx` — `AdminCapability.id` union extended to
  `'emoji-catalog'`.
- `src/routes/admin.tsx` — capability list includes the catalog
  entry with `status: 'live'`.
- `scripts/check-architecture.mjs` — `typeOnlyEdges` registry
  extended to include `home → http`; the script now rejects value
  imports across that edge (was already forbidden in spec, now
  enforced automatically).

### 4.2 What does NOT change

- `reactions` table — the home widget still stores opaque `value`
  strings; the catalog table is metadata only.
- `/api/v1/reactions` Hono router — still accepts opaque `value`
  strings ≤16 chars; still dedupes at `(target_key, principal,
  actor_id, kind, value)`. The reactions API does not look at the
  catalog (the home loader pre-validates instead).
- `:slug:` contract — `^[a-z][a-z0-9_]*$`, 1..16 chars (aligned
  to `MAX_EMOJI_LEN` after the PR review).
- `mw_actor_id` cookie contract — Ticket E, unchanged.
- `MY_WEB_2026_CONSUMER_API_KEY` bootstrap — Ticket E, unchanged.

## 5. Out of scope (deliberate non-goals)

- **Slug-level access control** — every admin can add / rebind /
  disable any slug. Per-admin audit would need a `reaction_emoji_catalog_audit`
  table; not justified at the 16-slug seed scale.
- **Catalog import / export** — admins manage via the UI. A
  CSV/YAML import is a 0.4.0 follow-up if/when the catalog crosses
  ~50 entries.
- **Image reactions in the catalog** — the image library already has
  its own admin UI (`/admin/images`). The catalog is emoji-only.
- **Per-visitor dedup on the access counter** — Ticket F / ADR-0012
  documented this as 0.4.0; not affected by this ADR.
- **Cache invalidation across multiple Workers** — single Worker for
  0.3.0; the cache question is moot until multi-Worker (out of scope
  per AGENTS.md §11).

## 6. Risks

| Risk | Mitigation |
|---|---|
| Disabled-slug rejection surprises a returning visitor who tries to remove their old reaction | Documented in the ADR; the rejection surfaces a clear `invalid_body` reason to the visitor. The widget's optimistic state rollback handles it cleanly. |
| Catalog row count grows unbounded (admin adds a thousand slugs) | `idx_reaction_emoji_catalog_enabled` keeps the active subset query at `O(log n)`. If growth becomes a real concern, a max-entries admin gate is a follow-up. |
| Concurrent insert on the same slug (two admins at once) | D1 PK enforces single winner via `UNIQUE constraint failed`. The admin `insertCatalogEntryFn` catches the message and surfaces `slug_exists`. |
| Codepoint with variation selector 16 (e.g. ☑️ vs ☑) renders inconsistently | Documented as out of scope; admins pick the glyph they want and own the result. The widget renders whatever string the admin stored. |
| Migration on a database that already has reactions referencing unknown slugs | The seed inserts use `INSERT OR IGNORE` so they never collide. Existing reactions reference slugs that may not be in the seed — they render the inert `:slug:` text via the home widget's fallback. |
| `wrangler.jsonc` vars drift between Ticket E and Ticket G | No new vars added; the catalog reads D1 directly. `wrangler:dry-run` validates the unchanged config. |

## 7. Validation

- `pnpm run validate:fast` (format, lint, typecheck, tests).
- `pnpm run validate:integration` (build, wrangler dry-run,
  actionlint, storybook).
- `pnpm run validate:release` (cf-typegen:check) — no binding
  change, no new vars; should be a no-op.

End-to-end coverage:

- 11 unit tests in `src/reactions/emoji-catalog.test.ts`
  (D1 round-trip + pure helpers — was previously under
  `src/http/reactions/` before the obligation promotion).
- 7 unit tests in `src/home/reactions/emoji-catalog.test.ts`
  (catalog facade after the sync-constant → catalog-parameterised
  migration).
- 5 widget SSR tests in `src/home/reactions/widget.test.tsx`
  (uses `data.catalog` snapshot).
- 6 home-loader integration tests in `src/home/reactions/load.test.ts`
  (3 of them new — DB-seeded catalog + disabled-slug rejection).
- 3 admin-view stories in
  `src/admin/emoji-catalog/catalog.stories.tsx`.

## 8. References

- ADR-0011 (home self-consumption consumer pattern) — Ticket E.
- ADR-0012 (access counter implementation) — Ticket F.
- `migrations/0004_emoji_catalog.sql` — this ADR's schema.
- `migrations/0003_reactions.sql` — the `reactions` table that the
  catalog maps to.
- Memory: `rebuildup-dev-canonical-domain` — production domain
  policy that this ADR honours.
- Issue: #43 (canonical production wiring — out of scope here).
