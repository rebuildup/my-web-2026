# Development data source (Issue #377)

Runbook for the local development data source: which data the dev
server reads, how to switch it, and what happens when a write is
attempted.

## The question this answers

> "Which data am I looking at right now — and may I write?"

The development surface used to answer neither. The dev server read
the local (miniflare) copy of the schema, and a developer who wanted
to see the production numbers had no supported way to do it. The
production API was not an alternative either: every API answer is
scoped to the calling API key's principal, and the development key is
not a row in the production database (copying the production key into
development is forbidden by AGENTS.md §4).

The answer is a **mode**, and the mode is always visible.

## The modes

| Command | Bindings | API responses | Writes |
| --- | --- | --- | --- |
| `pnpm dev` | local (miniflare) | live | allowed |
| `pnpm dev:mock` | local (miniflare) | canned fixtures | allowed (in-memory only) |
| `pnpm dev:production-data` | **production** D1 / R2 | live | **refused** |
| `pnpm dev:read-only-guard` | local (miniflare) | live | **refused** |

`pnpm dev` is the default and is unchanged by this issue: it never
sees production, and it never needs a credential it does not have.

### `pnpm dev:production-data` — production data, read-only

The dev server's `DB` and `MEDIA` bindings point at the real
Cloudflare resources (`@cloudflare/vite-plugin`'s `remoteBindings`,
plus `dev: { remote: true }` on the two bindings). Reads show
production data. **Every write is refused** with the stable code
`production_readonly_write_refused`.

The mode needs a Cloudflare **remote session**: the plugin creates a
temporary edge-preview session for the account. A user-scoped API
token must carry the permission for that API; when it does not, the
dev server refuses to start with

```
error when starting dev server:
Error: This Worker uses bindings that need to run remotely, even when
developing locally, but the remote session could not be authenticated.
```

The operator-side options are `wrangler login` on the workstation, or
a token that carries the permission the edge-preview API requires.
**This is an operator action — no repository change can grant it.**

### `pnpm dev:read-only-guard` — the refusal, without production

The same write policy as the production mode, with the bindings left
local (`CLOUDFLARE_VITE_FORCE_LOCAL=true`). This is how the refusal
is proved: the write policy is the production one, and no write can
reach the production database because the data never leaves the
machine.

## Where the mode is visible

1. **On the page** — the home page renders an indicator above the
   fold (`src/home/data-source-badge.tsx`) naming the source and the
   write policy. It renders only outside the deployed production
   Worker, so the shipped page carries no development text.
2. **In the console** — `pnpm dev:production-data` prints one line at
   startup.
3. **In the runtime** — the indicator is produced by
   `src/cloudflare/data-source.ts`, the same module the write guards
   consult, so the screen can never claim a source the runtime does
   not have.

## What is refused, and where

| Write path | Guard |
| --- | --- |
| every unsafe method on `/api/v1/*` (access hit, reaction add / remove, API key creation, image upload) | `src/http/hono.ts` — the boundary middleware, before every router |
| the admin surfaces (emoji catalogue, images, API keys, invitations) | `src/admin/read-only.ts` — called by every admin write server function |
| the home's reaction add / remove and the page-view hit | `src/home/access/load.ts`, `src/home/reactions/load.ts` — the loader refuses before it writes |
| the emoji catalogue auto-register (a D1 write that happens BEFORE the upstream call) | `src/home/reactions/load.ts` |

Reads are never refused. The whole point of the mode is to see
production data.

## How the mode reaches the runtime

One binding, `MY_WEB_2026_DATA_SOURCE`, declared **in development
only** (`cloudflare.config.ts`):

- absent → the deployed production Worker;
- `local` → the dev server with local bindings;
- `production-readonly` → the dev server with production bindings;
- `production-readonly-local` → the production-readonly write policy
  with local bindings (`pnpm dev:read-only-guard`);
- anything else → **fail closed**: writes are refused and the
  indicator says the value was not recognised.

The same environment variable decides whether the bindings are
remote, in `vite.config.ts` and in `cloudflare.config.ts`, so the
binding target and the write policy cannot drift apart.

> `cloudflare.config.ts` restates the three vocabulary strings
> instead of importing `src/cloudflare/data-source.ts`: the Cloudflare
> config loader runs outside the Worker module graph, and importing a
> `src/` module from it breaks the dev server. The restatement is
> guarded by `test/integration/dev-data-source.test.ts`, which asserts
> that every value the configuration declares is recognised by the
> runtime.

## Verification artefacts

- [`docs/verification/development/README.md`](../verification/development/README.md)
  — what the two screenshots show and how they were captured.
- `test/integration/dev-data-source.test.ts` — the refusal, the reads
  that keep working, the admin guard, and the agreement between the
  configuration's vocabulary and the runtime's.
- `src/cloudflare/data-source.test.ts` — the mode resolution itself.

## Related

- Issue #186 — the mock gate (`LOCAL_API_MODE=mock`).
- AGENTS.md §4 — the secret policy (no production credential is ever
  copied into development).
