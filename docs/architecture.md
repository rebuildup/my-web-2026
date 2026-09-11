# Architecture

> One-page view of the system. Detail and rationale live in
> [`docs/adr/`](adr/). Implementation details live in source.

## Layers

```
Cloudflare Worker (real env, real ctx)
        │
        ▼
src/server.ts                    # default export: { fetch(request, env, ctx) }
        │
        ├─ /api/v1/*  /webhooks/*  /oauth/*  /integrations/*
        │       │
        │       ▼
        │   src/http/hono.ts     # Hono external boundary, real env via c.env
        │
        └─ everything else
                │
                ▼
       @tanstack/react-start/server-entry
       (= default TanStack Start handler, default CSRF middleware active)
```

The default CSRF middleware is what TanStack Start installs when no
custom `src/start.ts` is present. Adding a `startInstance` override
disables it — do **not** define one without an ADR.

## Frontend (feature-oriented, capability-keyed)

```
src/
├─ routes/                       # TanStack Start file-based routes
├─ modules/
│   └─ <capability>/             # one folder per business capability
│       ├─ model.ts              # pure types / value objects
│       ├─ service.ts            # business operations
│       ├─ repository.ts         # persistence boundary (D1 / R2)
│       ├─ server.ts             # createServerFn entrypoints
│       ├─ ui/                   # feature-local React components
│       └─ styling.ts            # feature-local Panda recipes / tokens
└─ http/                         # NOT a feature; a single shared boundary
    └─ hono.ts                   # external HTTP boundary (Hono)
```

The 0.1.0 Foundation release does not ship any `src/modules/<capability>/`
folder. `portfolio`, `content`, `activity`, etc. land in 0.2.0+.

## Backend (capability-oriented)

The same `src/modules/<capability>/` tree is the backend for each
capability. Server functions live in `server.ts` next to model /
service / repository files. Application code (anything inside
`src/modules/<capability>/**` other than `server.ts`) must not import
`hono`, `@tanstack/react-start`, or any Cloudflare SDK — those are
adapters' responsibility, and only `server.ts` is allowed to bridge.

## External HTTP boundary

Hono is mounted at `src/http/hono.ts` and wired into the Worker entry
at `src/server.ts`. Path-prefix dispatch is enforced in one place;
handlers themselves can use real Cloudflare bindings (`D1`, `R2`,
`ASSETS`) through `c.env`.

The boundary contract:

- `/api/v1/*` — external REST API endpoints.
- `/webhooks/*` — inbound webhooks from external services.
- `/oauth/*` — OAuth callback handlers.
- `/integrations/*` — third-party integration adapters.

Internal application operations invoked from the UI are TanStack
Start server functions and never appear under these prefixes.

## Persistence

| Binding | Name     | Purpose                                                 |
| ------- | -------- | ------------------------------------------------------- |
| D1      | `DB`     | Structured content (placeholder `database_id` in 0.1.0) |
| R2      | `MEDIA`  | Blobs / media (placeholder bucket, create on first deploy) |
| Assets  | `ASSETS` | Static assets emitted by Vite to `./dist/client`        |

Bindings are declared in `wrangler.jsonc`. After editing, run
`pnpm run cf-typegen` and commit the regenerated
`worker-configuration.d.ts` in the same PR.

Additional Cloudflare services (KV, Queues, Durable Objects,
Workflows, Vectorize, Workers AI) require their own ADR per
ADR-0004.

## Test scope: local workerd vs real Cloudflare

The SELF integration tests under `test/integration/**` run inside the
`@cloudflare/vitest-plugin` workerd pool, which uses **Miniflare** to
simulate D1 / R2 / ASSETS bindings locally. They confirm the binding
API surface (`prepare` / `first` / `head` / etc.) and the Worker
entry dispatch.

Real-resource smoke (a deployed Worker against the real Cloudflare
D1 / R2 instances) is part of the release cut (#009 in
`docs/release.md`), not the per-binding SELF tests. See
[`docs/security.md`](security.md#test-scope-local-workerd-vs-real-cloudflare)
for the detailed contract.

## Platform

```
src/platform/cloudflare/         # Cloudflare-specific helpers (env, types)
```

Capability / domain code does not import from here directly. Bindings
flow through function arguments or Hono's `c.env`.

## Deployable shape

After `pnpm run build` + `pnpm run wrangler:dry-run`:

```
dist/
├─ client/                       # static assets (HTML / CSS / JS bundles)
└─ server/                       # Cloudflare Worker bundle
    ├─ index.js
    ├─ wrangler.json
    └─ assets/

dist-cloudflare/                 # wrangler deploy --dry-run output
```

## Out-of-scope at 0.1.0

- Product features (`portfolio`, `content`, `activity`).
- Tools submodule integration.
- Coverage thresholds.
- ESLint / Oxlint (Biome is sufficient).
- Microservice / multi-Worker split.
