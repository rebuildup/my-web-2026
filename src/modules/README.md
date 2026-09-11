# Modules

Capability-oriented vertical slices. Each module owns its own model,
service, repository, server function, and UI files. Empty
`application/` / `adapters/` / `contracts/` directories are **not**
required; introduce them only when the module actually grows into
those layers.

The 0.1.0 Foundation release does not ship any modules. `portfolio`,
`content`, `activity`, and integration adapters land in 0.2.0+.

## Layout

```
src/modules/
├─ <capability>/            # one folder per business capability
│  ├─ model.ts              # pure types / value objects
│  ├─ service.ts            # business operations
│  ├─ repository.ts         # persistence boundary (D1 / R2)
│  ├─ server.ts             # createServerFn entrypoints
│  ├─ ui/                   # feature-local React components
│  └─ styling.ts            # feature-local Panda recipes / tokens
```

## Rules

- A module imports from `@design-system/*` and `@platform/*` but never
  reaches into another module's internals.
- A module imports from `hono`, `@tanstack/react-start`, or any
  Cloudflare SDK **only** through `server.ts`. Model / service /
  repository code stays framework-agnostic.
- Cross-module collaboration goes through public exports in
  `<capability>/index.ts`.
- New modules add their own folder; do not retrofit capability code
  into `src/lib`, `src/utils`, or `src/components`.
