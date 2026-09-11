# 0.1.0 Foundation backlog

> Concrete ticket list for the first release. Mirrored in
> [`docs/release.md`](release.md#010-foundation-backlog). The real
> GitHub Issue numbers are assigned when the Issues are opened
> against the canonical remote.

## Sprint goal

Establish my-web-2026's canonical runtime wiring, design system
foundation, and quality gate on Cloudflare Workers + TanStack Start.
A production-equivalent smoke release (Worker deployed, D1 / R2
bindings reachable, Hono external boundary + TanStack SSR active) is
the acceptance signal.

## Tickets

### #001 Runtime wiring fix

- **Type**: architecture
- **Size**: M
- **Priority**: P0
- **Depends on**: —
- **Acceptance**:
  1. `src/server.ts` is the Worker entry. Default export
     `{ fetch(request, env, ctx) }` dispatches between Hono and the
     TanStack Start default handler based on path prefix.
  2. `EXTERNAL_BOUNDARY_PREFIXES = ['/api/v1', '/webhooks', '/oauth',
     '/integrations']`. Other paths go to TanStack Start.
  3. `src/start.ts` is deleted. TanStack Start's default CSRF
     middleware is active (verified by inspecting the built worker
     bundle).
  4. Hono handlers receive **real** Cloudflare `env` and `ctx` —
     no mocked `{} as Env` stub.
  5. `src/http/hono.ts` replaces `src/boundary/index.ts`; no other
     files reference the old path.
- **Validation**: `pnpm run validate:integration` (build +
  `wrangler deploy --dry-run` succeeds).

### #002 Repository hygiene fix

- **Type**: governance
- **Size**: S
- **Priority**: P0
- **Depends on**: —
- **Acceptance**:
  1. `package-lock.json` and `vitest.config.mts` are deleted; only
     `pnpm-lock.yaml` remains.
  2. `.gitignore` includes `dist-cloudflare/` and `.biome/`.
  3. `vite.config.ts` no longer references `vitest` types.
  4. README and CONTRIBUTING match the canonical remote and
     visibility; the project is documented as public with an MIT
     license.
  5. Version drift between `README.md`, `quality/profile.yaml`, and
     `package.json` is eliminated.
  6. On-disk build artefacts (`dist/`, `dist-cloudflare/`,
     `styled-system/`) are removed.
- **Validation**: `pnpm install --frozen-lockfile` succeeds.

### #003 Design system foundation

- **Type**: design system
- **Size**: S
- **Priority**: P0
- **Depends on**: —
- **Acceptance**:
  1. `src/design-system/tokens.ts` exports raw Panda tokens
     (colors, fonts, fontSizes, radii, shadows, spacing, breakpoints).
  2. `src/design-system/semantic-tokens.ts` registers the semantic
     layer (bg, text, border) via `theme.semanticTokens` in
     `panda.config.ts`.
  3. `src/infra/design-tokens.ts` is deleted.
  4. `tsconfig.json` paths include `@design-system/*`; `vite.config.ts`
     resolves the alias.
- **Validation**: `pnpm exec panda codegen` emits semantic tokens in
  `styled-system/tokens/index.mjs`.

### #004 Quality gate rebuild (Biome)

- **Type**: tooling
- **Size**: M
- **Priority**: P0
- **Depends on**: —
- **Acceptance**:
  1. `@biomejs/biome` is a devDependency; `prettier` is removed.
  2. `pnpm run format` (write) and `pnpm run format:check` (read-only)
     scripts exist.
  3. `pnpm run lint:check` (read-only) script exists.
  4. `validate:fast` runs only read-only steps (no `--write`).
  5. `validate:integration` adds `build` and `wrangler:dry-run`
     (the dry-run step is part of the gate, not just an artefact).
  6. `quality/profile.yaml` matches the script commands.
  7. `.github/workflows/ci.yml` has exactly two jobs
     (`validate`, `validate-release`); bootstrap is not duplicated
     inside jobs that already depend on it.
- **Validation**: `pnpm run validate:fast`, `pnpm run validate:integration`,
  `pnpm run validate:release` succeed locally.

### #005 Module restructure

- **Type**: architecture
- **Size**: M
- **Priority**: P0
- **Depends on**: #001 (the new `src/http/hono.ts` is the source of truth)
- **Acceptance**:
  1. `src/features/`, `src/domains/`, `src/boundary/`, `src/infra/`
     are deleted.
  2. `src/modules/README.md` describes the vertical-slice rule.
  3. `src/platform/cloudflare/README.md` reserves the platform-specific
     namespace.
  4. `src/http/hono.ts` and `src/http/hono.test.ts` exist.
  5. `src/routes/index.tsx` no longer imports `getInternalHealth` or
     anything from the deleted `src/domains/**`.
  6. `tsconfig.json` paths and `vite.config.ts` alias no longer
     reference `@features`, `@domains`, `@boundary`, `@infra`.
- **Validation**: `pnpm run validate:fast` (typecheck), `pnpm run build`.

### #006 D1 binding smoke

- **Type**: infrastructure
- **Size**: S
- **Priority**: P1
- **Depends on**: #008 (main protection)
- **Acceptance**:
  1. `wrangler.jsonc` declares a `d1_databases` binding named `DB`.
  2. `src/http/hono.ts` exposes `GET /api/v1/db/ping` that runs
     `SELECT 1 AS one` via `c.env.DB`.
  3. `test/integration/d1.test.ts` calls `SELF.fetch('/api/v1/db/ping')`
     and asserts 200 with `body.one === 1`.
  4. `pnpm run cf-typegen` regenerates `worker-configuration.d.ts` so
     `Env.DB: D1Database` is visible to TypeScript.
- **Validation**: `pnpm test` (the integration project runs the SELF
  smoke) and `pnpm run validate:integration` (dry-run + binding visible).

### #007 R2 binding smoke

- **Type**: infrastructure
- **Size**: S
- **Priority**: P1
- **Depends on**: #008 (main protection)
- **Acceptance**:
  1. `wrangler.jsonc` declares an `r2_buckets` binding named `MEDIA`.
  2. `src/http/hono.ts` exposes `GET /api/v1/media/ping` that calls
     `c.env.MEDIA.head('probe')` and surfaces the canonical
     "key_not_found" 404 response.
  3. `test/integration/r2.test.ts` calls `SELF.fetch('/api/v1/media/ping')`
     and asserts 404 with `body.status === 'key_not_found'`.
- **Validation**: same as #006.

### #008 GitHub delivery setup

- **Type**: governance / CI
- **Size**: S
- **Priority**: P0
- **Depends on**: —
- **Acceptance**:
  1. `main` ruleset: direct push disabled, force push disabled,
     deletion disabled, PR required, required status check = `validate`.
  2. `release-* -> main` PRs additionally require `validate-release`.
  3. Labels created: `type/governance`, `type/feature`, `type/infra`,
     `type/release`, `priority/p0`, `priority/p1`, `priority/p2`.
  4. Project board created with columns Backlog / Ready / In Progress /
     Review / Done.
  5. 9 GitHub Issues opened with bodies drawn from
     `docs/backlog-0.1.0.md` (or this file).
- **Validation**: `gh api repos/rebuildup/my-web-2026/branches/main/protection`
  returns the ruleset shape; Issue list contains 0.1.0 IDs.

### #009 Cut the 0.1.0 release PR

- **Type**: release
- **Size**: S
- **Priority**: P0
- **Depends on**: #001–#008
- **Acceptance**:
  1. `release-0-1-0` branch created from `main`.
  2. Tickets #001–#007 merged via Draft PRs into `release-0-1-0`.
  3. `pnpm run validate:release` exits 0 on `release-0-1-0`.
  4. Draft release PR (`release-0-1-0 -> main`) opened; both
     `validate` and `validate-release` required checks are green.
  5. Release PR merged into `main`.
  6. Tag `v0.1.0` pushed.
  7. (Optional) `pnpm deploy` runs against a real Cloudflare account
     and the deployed Worker URL answers `/`, `/api/v1/health`,
     `/api/v1/db/ping`, and `/api/v1/media/ping` as documented.
- **Validation**: `gh release view v0.1.0` returns the tag with notes.

## Dependency graph

```
#001 ── #005
#002 (independent)
#003 (independent)
#004 (independent)
#006 ──┐
#007 ──┼─ #009 (release cut)
#008 ──┘
```

## Next Issue to start

The natural first ticket is **#001 Runtime wiring fix** — every
later ticket either depends on it (#005) or benefits from the
runtime being correct first (#006 / #007 SELF smoke). #002, #003,
#004, and #008 can start in parallel with #001.

If the operator is still in the "decide whether to create a remote"
phase, the next step is not a ticket — it is the human decision
recorded as the body of #008.
