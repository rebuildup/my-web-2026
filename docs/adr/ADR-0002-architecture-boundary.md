# ADR-0002: Internal vs external HTTP boundary

- Status: Accepted
- Date: 2026-09-11
- Extends: ADR-0001
- Superseded by: None

## Context

ADR-0001 picks Cloudflare Workers + TanStack Start + Hono + Panda CSS.
The brief is explicit that we must not use Hono for **all** internal
communication — only for external traffic. We therefore need a precise
definition of "internal" vs "external" and a concrete implementation
that enforces the boundary by construction, not by convention.

The naive pattern of `import { hono } from '~/boundary'` inside a route
loader would let the two layers leak into each other and break the
"internal operations are not exposed via Hono" invariant.

## Decision

### 1. Two layers, two import directions

| Concern                               | Layer                          |
| ------------------------------------- | ------------------------------ |
| UI loader / action / mutation         | TanStack Start server function |
| Route SSR, navigation, rendering      | TanStack Start SSR handler     |
| Stable external REST API contract     | Hono (`/api/v1/*`)             |
| Inbound webhook from external service | Hono (`/webhooks/*`)           |
| OAuth provider callback               | Hono (`/oauth/*`)              |
| Third-party integration adapter       | Hono (`/integrations/*`)       |

Both layers consume shared domain / application code from `src/domains/**`
but **never** import each other.

### 2. Implementation

- `src/boundary/index.ts` exports the Hono `externalBoundary` app.
- `src/start.ts` defines a `createStart()` instance with a single
  `requestMiddleware` that:
  1. Checks the request path against the external-boundary prefixes.
  2. If matched, hands the request to a one-shot Hono app wrapping
     `externalBoundary` and returns the Hono response.
  3. Otherwise calls `next()` so TanStack Start handles the SSR / route
     / server function as usual.

This keeps `wrangler.jsonc` `main: "@tanstack/react-start/server-entry"`
unchanged. The Hono app only runs for the prefixes it owns.

### 3. Path prefix list

The list is owned by `src/start.ts` (`EXTERNAL_BOUNDARY_PREFIXES`).
Adding a new prefix is a code change reviewed in a normal ticket. It
must not be added by a load-balancer, CDN, or other external system.

### 4. What server functions must look like

TanStack Start server functions (`createServerFn`) are intended to be
called from the UI. They use `createServerFn({ method }).handler(...)`.
Server functions may call any number of domain operations; they may also
read environment variables through `getRequest()`.

Server functions must **not**:

- Be exposed under `/api/*` or `/webhooks/*` URLs.
- Be advertised in public API documentation.
- Be invoked directly by third parties without an explicit path.

If a third party needs access, that traffic is implemented as a Hono
route that internally calls the same domain operation, not as a server
function.

### 5. Domain code stays portable

Application / domain code under `src/domains/<name>/application/**`:

- Must not import `cloudflare:*` packages.
- Must not import from `hono` or `@tanstack/react-start`.
- Must not import from `~/infra` that itself imports Cloudflare APIs,
  except via the `Env` type defined in `~/infra/env.ts`.

Adapters own the Cloudflare-specific concerns: D1, R2, KV, Queues, etc.

## Consequences

### Positive

- The internal/external split is enforced in code, not by review habits.
- The Hono app remains small and stable; it does not absorb UI logic.
- Domain code stays portable to alternative runtimes if we ever need to
  extract a worker.

### Negative / Trade-offs

- Adding a new external route means updating the prefix list and adding
  a Hono handler — a tiny amount of friction we accept on purpose.
- The TanStack Start middleware sees both external and internal traffic
  and has to do a string check on every request. The cost is negligible
  compared to the SSR pipeline itself.

## Re-evaluation triggers

Re-evaluate when:

- TanStack Start ships a first-class HTTP-route primitive that obsoletes
  the Hono layer.
- The prefix-list approach becomes hard to reason about (e.g. too many
  prefixes, prefix collisions).
- We decide to split into multiple Workers, at which point each Worker
  may need its own Hono app.
