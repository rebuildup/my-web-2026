# Tests

Two Vitest projects (see `vitest.config.ts`):

- `unit` — Node environment, fast feedback. Lives next to the code
  it covers (`src/**\/*.{test,spec}.{ts,tsx}`).
- `integration` — workerd environment via
  `@cloudflare/vitest-plugin`, exercised through the `SELF` helper.
  Lives in `test/integration/**`.

Run them:

```bash
pnpm test                  # both projects
pnpm test --project unit
pnpm test --project integration
```

Both run inside `pnpm run validate:fast` and `pnpm run validate:integration`.
