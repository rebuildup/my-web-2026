# Test layout

Foundation release uses Vitest for unit/smoke/integration tests:

- Unit tests: co-located next to the implementation as
  `<feature>.test.ts(x)` to keep the boundary obvious.
- Smoke tests: a small `boundary.test.ts` that boots the Hono app with a
  fake `Env` and asserts the health route returns 200.
- Integration tests: any test that spins up `SELF` via
  `@cloudflare/vitest-plugin` lives under `test/integration/**`.

Coverage thresholds are **not** enforced in 0.1.0 — see ADR-0007. Add
coverage policy deliberately once a meaningful testable surface exists.
