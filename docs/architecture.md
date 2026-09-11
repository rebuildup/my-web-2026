# Architecture

> Canonical architecture for my-web-2026. Source of truth for
> boundaries. Implementation may lag; this document is the target.

## One-page view

```
                    +----------------------------+
                    |   Cloudflare Worker (1x)   |
                    |                            |
   Browser -------->| TanStack Start (SSR)       |
   (HTML / JS)      |     |                      |
                    |     v                      |
                    |  Server fns (createServerFn)|
                    |     |                      |
                    |     v                      |
                    | src/domains/<n>/...        |
                    |     ^                      |
                    +-----|----------------------+
                          |
   3rd party ----> Hono external boundary (/api/v1, /webhooks, ...)
   (webhooks,         ^
   OAuth, ...)        |
                  src/boundary/index.ts
                          |
                  src/domains/<n>/...
                          ^
                          |
                  Static assets binding (dist/client)
```

## Layers

| Layer                         | Folder                           | Owns                                                      |
| ----------------------------- | -------------------------------- | --------------------------------------------------------- |
| UI rendering                  | `src/routes/**`                  | Page components, loaders, actions                         |
| Internal application ops      | `src/domains/<n>/application/**` | Use cases, orchestration                                  |
| External HTTP boundary (Hono) | `src/boundary/**`                | `/api/v1/*`, `/webhooks/*`, `/oauth/*`, `/integrations/*` |
| Persistence / adapter         | `src/domains/<n>/adapters/**`    | D1, R2, KV, Queues, third-party SDKs                      |
| Cloudflare infra              | `src/infra/**`                   | `Env`, logging, runtime helpers                           |
| Public types / events         | `src/domains/<n>/contracts/**`   | Shared schemas                                            |

## Internal vs external split

See [ADR-0002](adr/ADR-0002-architecture-boundary.md). One file
enforces it: `src/start.ts` checks the path prefix against
`EXTERNAL_BOUNDARY_PREFIXES` and either delegates to the Hono
external boundary or hands control back to TanStack Start.

| Concern              | Layer                          |
| -------------------- | ------------------------------ |
| UI loader / mutation | TanStack Start server function |
| Page SSR             | TanStack Start SSR             |
| External REST API    | Hono                           |
| Inbound webhook      | Hono                           |
| OAuth callback       | Hono                           |
| Third-party adapter  | Hono                           |

## Frontend (feature-oriented)

```
src/features/<feature>/
  routes/         (route entry — used by TanStack Start)
  components/
  hooks/
  styling.ts      (semantic tokens + recipes, when needed)
  index.ts        (public entry)
```

Cross-feature imports go through `index.ts`. A flat
`src/components/` is forbidden.

Planned features (post-Foundation):

- `portfolio` — works / projects
- `content` — CMS-driven content
- `tools` — Tool Registry / embed
- `projects` — long-form project write-ups
- `activity` — timeline / changelog
- `integrations` — external system status

## Backend (domain / application / adapters)

```
src/domains/<name>/
  application/   - pure use cases, orchestration
  adapters/      - persistence + external SDKs
  contracts/     - shared types / events
  README.md
```

Application code does not import `cloudflare:*`, `hono`, or
`@tanstack/react-start`. Adapters own those imports.

## Tools (submodules)

See [ADR-0006](adr/ADR-0006-tools-submodule-policy.md).

- Tools live under `tools/<tool>/` as pinned Git submodules.
- The parent never imports inside `tools/<tool>/src/**`.
- Tools may use any framework / styling / runtime.
- A future Tool Registry / manifest / build orchestration lives
  under `src/domains/tools/`.

0.1.0 Foundation does not add any concrete Tool submodule.

## Cloudflare services

See [ADR-0004](adr/ADR-0004-cloudflare-services-policy.md). At 0.1.0
the Worker has one Static Assets binding and nothing else.

## Trust boundaries

| Boundary                                 | Trust                                |
| ---------------------------------------- | ------------------------------------ |
| Browser <-> Worker                       | Public internet                      |
| Worker <-> Cloudflare platform bindings  | Within Cloudflare account trust      |
| Hono external boundary <-> internal code | Internal (same Worker, same account) |
| Tool submodule <-> my-web-2026 host code | Submodule commit-pinned, no imports  |

## Deployable shape

```text
dist/
  client/                    <- Static Assets directory
    .assetsignore
    assets/index-*.css
    assets/index-*.js
    ...
  server/
    .vite/manifest.json
    assets/
      worker-entry-*.js     <- Cloudflare Worker main bundle
      router-*.js
      start-*.js
      application-*.js
      index-*.js
      _tanstack-start-manifest_v-*.js
      empty-plugin-adapters-*.js
    wrangler.json
```

`pnpm run build` produces this layout. `pnpm run deploy` (which
runs `wrangler deploy`) ships it to Cloudflare.

## See also

- [docs/development.md](development.md) — bootstrap / run / test.
- [docs/release.md](release.md) — sprint / release workflow.
- [docs/recovery.md](recovery.md) — durable agent recovery.
- [ADR-0001](adr/ADR-0001-stack-selection.md) — stack selection.
