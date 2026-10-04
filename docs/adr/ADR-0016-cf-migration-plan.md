# cf migration — inventory and work split

Scope: eliminate the Wrangler dependency from Cloudflare operations,
configuration and observability. Companion to Issue #247.

Every count below is measured, not estimated (`git grep -ci wrangler` on
`main @ a581a39`).

## 1. Inventory

**1,079 occurrences across 104 tracked files.**

| Area | Files | Disposition |
| --- | --- | --- |
| `scripts/` | 36 | replace with cf (bulk of the work) |
| `docs/` (runbooks + guides) | 20 | update to cf; historical narrative may stay |
| `src/` (runtime source) | 13 | mostly comments; only execution paths matter |
| `docs/adr/` | 12 | **keep as history** — these record past decisions |
| `e2e/` + `test/` | 5 | update to cf |
| `wrangler.jsonc` + `wrangler.production.jsonc` | 2 | **delete**, folded into `cloudflare.config.ts` |
| `package.json`, `pnpm-lock.yaml`, `.github/`, `AGENTS.md`, `biome.json`, `tsconfig.json`, `vite.config.ts`, `vitest*.config.ts`, `playwright.config.ts`, `quality/profile.yaml`, `worker-configuration.d.ts`, `.dev.vars.example`, `.gitignore`, `.vscode/settings.json`, `README.md` | 18 | dependency removal / script rewrite / doc text |

### Executable surfaces in `package.json` (all migrate)

```
deploy, deploy:production, deploy:production:prepared
wrangler:dry-run
cf-typegen                       (wrangler types)
db:migrate:{local,remote,production}
db:migrate:list:{local,remote,production}
validate:integration              (wrangler:dry-run + production dry-run)
```

## 2. cf capability verification (measured 2026-10-04)

Every required capability exists in `cf@1.0.0-beta.12`. Nothing below is assumed.

| Current Wrangler use | cf equivalent | Note |
| --- | --- | --- |
| `wrangler deploy` | `cf deploy` | has `--prebuilt`, `--secrets-file` |
| `wrangler d1 migrations apply/list` | `cf d1 migrations apply/list` | **requires database ID**; names and bindings rejected |
| `wrangler d1 execute` | `cf d1 query` / `cf d1 raw` | same ID-only rule |
| `wrangler r2 object put/get` | `cf r2 objects put/get` | — |
| `wrangler secret bulk/list` | `cf workers secrets bulk/list/delete` | — |
| `wrangler types` | `cf workers types` | driven by `cloudflare.config.ts` |
| Builds inspection | `cf builds get/logs/limits` | already used during the 0.5.0 release |
| R2 custom domain | `cf r2 buckets domains custom` | already used during the 0.5.0 release |

`@cloudflare/vite-plugin` has a `2.0.0-beta` line; the repo pins `^1.0.0`.

`cf migrate [path]` performs the mechanical translation and emits a
`cloudflare.config.ts` plus three follow-up TODOs. Its generated
`wrangler.config.ts` shim imports `wrangler/experimental-config` — that
shim must **not** be adopted; it would keep a Wrangler dependency alive.

## 3. Configuration parity

`wrangler.jsonc` and `wrangler.production.jsonc` collapse into **one**
`cloudflare.config.ts` with `development` / `production` modes. Wrangler
names are translated, not copied.

| Setting | `wrangler.jsonc` | `wrangler.production.jsonc` | Target in `cloudflare.config.ts` |
| --- | --- | --- | --- |
| Worker name | `my-web-2026` | `my-web-2026` | `worker.name` (shared) |
| account id | absent | `c6ab6651…` | `accountId` (shared; harmless in dev) |
| entrypoint | `./src/server.ts` | `./dist/server/index.js` | mode-dependent: dev bundles source, prod deploys prebuilt |
| no_bundle | absent | `true` | expressed by the prod prebuilt path, not carried over |
| `rules` ESModule | absent | `**/*.js`, `**/*.mjs` | owned by the bundler, not hand-listed |
| compatibility date | `2026-09-07` | `2026-09-07` | `worker.compatibilityDate` |
| compatibility flags | `nodejs_compat`, `global_fetch_strictly_public` | same | `worker.compatibilityFlags` |
| assets dir / binding | `./dist/client` / `ASSETS` | same | `ASSETS: bindings.assets()` with directory |
| D1 | `DB`, id `d761ddb7…`, `migrations_dir` | same | `DB: bindings.d1({ name, id })`; `migrations_dir` has no cf equivalent — cf resolves migrations from its own config |
| R2 | `MEDIA`, `my-web-2026` | same | `MEDIA: bindings.r2({ name })` |
| rate limits | `RATE_LIMIT_WRITE` ns `…001` 60/60; `RATE_LIMIT_READ` ns `…002` 600/60 | same | `bindings.rateLimit({ namespace, simple })` |
| vars | 2 named vars | 2 named vars + `BETTER_AUTH_URL` + `MEDIA_PUBLIC_BASE_URL` | shared 2; the other two production-only |
| secrets.required | 3 names | 3 names | `bindings.secret()` declarations |
| observability | enabled | enabled | `worker.observability` |
| source maps | `upload_source_maps: true` | same | cf bundler default; verify rather than copy |
| custom domain | absent | `rebuildup.dev`, `zone_id 7dde90c8…` | `worker.domains`, production-only |
| `BETTER_AUTH_URL` | intentionally absent | `https://rebuildup.dev` | production-only (dev must not inherit it) |

## 4. Incident-derived acceptance

Each acceptance traces to a 0.5.0 release-window failure.

| Issue | Incident | Acceptance |
| --- | --- | --- |
| #227 | pre-deploy vs post-deploy contract conflated | both modelled as distinct concepts; no conflation |
| #230 | service endpoint resolved from implicit session state | endpoint/domain **explicit and mandatory**; no implicit default |
| #233 | CI and production build tool versions diverged | one SoT for tool versions, validated on both paths |
| #235 | executable path guessed from package internals | executable resolution is declarative, never a hardcoded path |
| #240 | ESM driver kept bare `require()` on an unexecuted branch | tests exercise the **real production execution path** |
| #243 | deploy failed after the migration window closed | see below |

### #243 acceptance test

From the converged production state — legacy secret deleted, live Worker
carrying exactly `BETTER_AUTH_SECRETS` / `MY_WEB_2026_CONSUMER_API_KEY` /
`GOOGLE_ANALYTICS_MEASUREMENT_ID` — a **cf-based deploy dry-run and
integration path must succeed**. "The first deploy passes" is not
sufficient; the contract must survive the state the release leaves behind.

## 5. Work split

Each slice is independently mergeable and leaves the tree green.

| Slice | Scope | Risk |
| --- | --- | --- |
| **1 — foundation** | `cf` devDependency, Vite Plugin 2 beta, `cloudflare.config.ts` with modes, `cf workers types`, local dev + build | high — the beta plugin is the new build path |
| **2 — deploy path** | `deploy`, `deploy:production:prepared`, `run-deploy-inner`, `deploy-with-secrets`, dry-run scripts | high — touches production delivery |
| **3 — D1** | `db:migrate:*`, `check-cf-secrets` Tier 3, portfolio driver D1/R2 paths; **ID-based addressing** | medium |
| **4 — secrets** | Phase B flip, both rotate drivers, typegen; `cf workers secrets bulk` | high — credential mutation |
| **5 — Builds observability** | new `scripts/cf-build-status.mjs`: SHA → build UUID, metadata, paginated logs, truncated detection, limits, first failing stage, secret-safe output | low — new, read-only |
| **6 — cleanup** | classify all 1,079 occurrences as remove / cf equivalent / historical; drop the `wrangler` dependency and both config files; docs, runbooks, `AGENTS.md` | medium — wide but mechanical |

Slices 3 and 4 are the ones that need release-window discipline: they
mutate production credentials and must not be rehearsed against production.

## 6. Out of scope

- **GA4** — `GOOGLE_ANALYTICS_MEASUREMENT_ID` stays `G-PLACEHOLDER000`.
  Not mixed into this migration; the real `G-…` replacement is an operator
  task, and no v0.5.0 artifact needs retagging.
- **Production deploy** — not performed; the usual release boundary applies.
