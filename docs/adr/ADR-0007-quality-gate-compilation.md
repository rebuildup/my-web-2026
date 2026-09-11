# ADR-0007: Quality gate compilation

- Status: Accepted
- Date: 2026-09-11
- Extends: project-init ADR-0005, ADR-0006
- Superseded by: None

## Context

The project-init policy (ADR-0005) says quality gates must be compiled
per project from current official framework/runtime guidance — they
are not a fixed bundle. ADR-0006 adds the verification taxonomy.

my-web-2026's stack is:

- Cloudflare Workers + Wrangler 4.131
- TanStack Start 1.168.x
- Hono 4.13.7
- Panda CSS 1.12.x
- React 19.3 / Vite 7.3 / TypeScript 5.9
- Vitest 4.1.x

The current official guidance for each component, verified on
2026-09-11:

- Cloudflare TanStack Start guide: `vite dev`, `vite build`, `wrangler
deploy`, `wrangler types`.
- Panda CSS Vite + React guide: `pnpm panda codegen` in the
  `prepare` script, postcss plugin in Vite.
- Hono: works on Cloudflare Workers natively, no special setup beyond
  the standard `Hono<{ Bindings: Env }>` typed app.
- Vitest with `@cloudflare/vitest-plugin`: supports pool-based
  integration tests that boot a real Worker.

This ADR records the compiled quality profile for 0.1.0 Foundation.

## Decision

### 1. Three gates

| Gate                   | Command                                                        | Purpose                                |
| ---------------------- | -------------------------------------------------------------- | -------------------------------------- |
| `validate:fast`        | `pnpm format && pnpm typecheck && pnpm test`                   | fast feedback for an isolated worker   |
| `validate:integration` | `pnpm validate:fast && pnpm build && pnpm test --pool=threads` | ticket-PR level verification           |
| `validate:release`     | `pnpm validate:integration && pnpm cf-typegen`                 | release branch pre-`main` verification |

These are wired in `package.json#scripts` and referenced by the
project-local `quality/profile.yaml`.

### 2. Verification taxonomy

- **Unit** — Vitest tests in `src/**/*.{test,spec}.{ts,tsx}` that do
  not require a Worker boundary. Foundation release ships a Hono
  smoke test that uses a fake `Env`.
- **Smoke / connectivity** — `vite build` + `wrangler deploy --dry-run`
  proves the bundle is Cloudflare-compatible. A real Worker smoke
  test using `@cloudflare/vitest-plugin`'s `SELF` is introduced once
  a binding is added.
- **Integration** — Multi-boundary tests that exercise two or more
  of: TanStack Start SSR, server function, Hono external boundary.
  Out of scope for 0.1.0.
- **Contract / schema** — Type tests for the Hono app and for the
  generated Cloudflare types (`pnpm cf-typegen`). Out of scope for
  0.1.0.
- **E2E** — Real browser / runtime flow tests. Out of scope for
  0.1.0.
- **Manual / visual** — Reserved for UI work in later sprints.

### 3. Change-risk -> verification mapping (0.1.0)

| Change                                        | Required verification                        |
| --------------------------------------------- | -------------------------------------------- |
| Pure logic (Hono handler, server fn body)     | Unit + smoke (`vite build`)                  |
| New route / file change under `src/routes/**` | Unit + integration (loader data) + smoke     |
| `wrangler.jsonc` binding change               | `pnpm cf-typegen` + smoke                    |
| Panda config / token change                   | `vite build` (Panda postcss) + manual visual |
| Vite / Wrangler / plugin upgrade              | Full `validate:integration`                  |
| Release branch bump                           | Full `validate:release`                      |

### 4. No universal coverage threshold

`0.1.0` does not enforce a coverage threshold. The 0.1.0 source
surface is intentionally tiny; meaningful coverage is a 0.2.0
concern once real domain modules exist.

### 5. CI semantics

GitHub Actions invokes the same three deterministic entry points.
Local and CI run the same commands. CI does not redefine the
verification logic in workflow YAML.

### 6. Profile location

The canonical machine-readable profile lives at
`quality/profile.yaml` (see ADR). It is re-compiled when:

- A framework / runtime major version is bumped.
- An architecture boundary changes.
- A new app / platform target is introduced.
- A gate becomes flaky or slow enough to materially affect
  development velocity.
- An escaped regression shows a missing validation layer.

## Consequences

### Positive

- Three deterministic entry points that the agent and CI share.
- No `pnpm test` / `npm test` divergence.
- Coverage policy is honest — it is not enforced on a tiny 0.1.0
  surface.

### Negative / Trade-offs

- `@cloudflare/vitest-plugin` is installed but not yet exercised
  in 0.1.0. A follow-up ticket wires it into `validate:integration`
  once a binding is added.

## Re-evaluation triggers

Re-evaluate when:

- Any of the third-party packages in this stack ships a breaking
  change to its public API.
- A new application target (mobile, CLI, library) is introduced.
- `validate:integration` becomes the bottleneck of development
  velocity.
