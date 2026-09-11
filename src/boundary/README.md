# External HTTP boundary (Hono)

This folder owns the **external** HTTP entry points — anything that is not
a TanStack Start server function invoked from the UI:

- `/api/v1/*` - stable external REST contracts
- `/webhooks/*` - inbound webhooks (idempotency keys required, see ADR-0007)
- `/oauth/*` - OAuth callback handlers
- `/integrations/*` - third-party integration adapters

Internal application operations (loaders, actions, server functions
triggered by the UI) belong to TanStack Start under `src/routes/**`.

Domain logic is shared with the UI layer via `src/domains/**`. Do not
duplicate business rules between Hono handlers and TanStack Start server
functions.
