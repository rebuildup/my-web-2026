# ADR-0014 — rebuildup.dev canonical production domain

- Status: Accepted
- Date: 2026-09-19
- Branch: 43
- Issue: #43
- Sprint: 0.3.0-extended (between Ticket G and the 0.3.0 release gate)
- Decision driver: 0.3.0 release production wiring
- Superseded by: None
- Memory: `rebuildup-dev-canonical-domain` (origin session)

## 1. Context

my-web-2026 has shipped to `https://my-web-2026.rebuild-up-up.workers.dev`
since the v0.1.0 Foundation release (2026-09-11). That URL is the
default `*.workers.dev` Worker URL Cloudflare assigns; it is not a
stable identity and is documented here only as the deploy target of
record for that release.

The 0.3.0 sprint is the first one intended to be consumed as a
public preview rather than only as platform foundation. A public
preview needs a stable, owned origin so that:

- Better Auth's `baseURL` and `trustedOrigins` match the URL the
  visitor actually typed.
- Cookies are scoped to a stable domain that survives Worker
  re-deploys to new URLs.
- HTTPS / HSTS / certificate transparency are anchored to a domain
  the operator controls.
- The migration from my-web-2025 (linked from Home today) has a
  shared vocabulary with the 2026 platform.

The Cloudflare zone `rebuildup.dev` is already owned by the
operator (Issue #43 body). DNS, TLS, and edge configuration are
managed via Cloudflare.

`www.rebuildup.dev` and other subdomains are explicitly **not** in
scope for this ticket (Issue #43 §非スコープ). Mail / MX / SPF /
DKIM and other subdomain design are also out of scope.

## 2. Decision

`https://rebuildup.dev` is the canonical production origin for
my-web-2026. All public surfaces (Home, Admin, `/api/v1/*`)
share that single origin. The Worker is attached to the Cloudflare
zone via `routes[]` with `custom_domain: true` so Cloudflare
provisions DNS + TLS automatically.

`*.workers.dev` URLs continue to exist (Cloudflare assigns them to
every Worker deployment) but are **debug / infrastructure only** —
they are not documented as canonical, not referenced from user-facing
copy, ADRs, READMEs, or seed data. Better Auth never sees a
`*.workers.dev` URL.

`www.rebuildup.dev` is intentionally not wired. Adoption is a
separate ticket and an explicit decision.

## 3. Trade-offs

### 3.1 Single origin simplifies cookies / CORS / Better Auth

`Better Auth` reads `BETTER_AUTH_URL` once and uses it for both
`baseURL` and `trustedOrigins`
(`src/cloudflare/auth/better-auth.ts:65,111`). With one canonical
origin we get cookies, CSRF, and trusted-origin handling correct
by default. The alternative (multiple origins, e.g. `home.rebuildup.dev`
vs `admin.rebuildup.dev`) would force cookie scoping, CORS, and
Better Auth config to be aligned across every surface — a recurring
source of subtle bugs in single-origin projects.

### 3.2 Single point of failure on the origin

A single canonical origin means a DNS outage or certificate
renewal failure takes down Home, Admin, and the API together. This
is mitigated by:

- Cloudflare's edge — DNS resolution is global + cached.
- ACME automation — TLS renewals are automatic; the operator only
  intervenes if a renewal fails.
- `/api/v1/health` is the documented liveness check; ops alerting
  should page on its 5xx.
- The default `*.workers.dev` URL still serves the Worker (debug
  entry point) if the custom domain is misconfigured.

The alternative (multi-origin with separate DNS records) would
reduce blast radius but introduce a permanent ops surface to keep
the records aligned. For a single-operator project, the
single-origin trade-off is the right call.

### 3.3 Custom domain requires Cloudflare zone ownership

This decision relies on `rebuildup.dev` already being in the
operator's Cloudflare account. The domain IS already owned
(Issue #43 body), so the wiring is a config change, not a
registration. If the operator ever leaves Cloudflare, the
canonical-domain decision needs to be re-evaluated.

### 3.4 Local development is unchanged

`pnpm dev` continues to serve `http://127.0.0.1:3000` and Better
Auth infers `baseURL` from `request.url` when `BETTER_AUTH_URL`
is unset. The canonical-origin decision does not touch local dev.

## 4. Wiring

### 4.1 Companion file `wrangler.production.jsonc`

The production-only overrides (canonical URL var + custom-domain
route) live in the companion file `wrangler.production.jsonc` next
to `wrangler.jsonc`. The default-env typegen against
`wrangler.jsonc` is left intact.

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-web-2026",
  "main": "./src/server.ts",
  // ... duplicated from wrangler.jsonc ...
  "vars": {
    "MY_WEB_2026_REACTIONS_TARGET": "home-page",
    "MY_WEB_2026_COUNTER_KEY": "home-page",
    "BETTER_AUTH_URL": "https://rebuildup.dev"
  },
  "routes": [
    {
      "pattern": "rebuildup.dev",
      "custom_domain": true,
      "zone_id": "REPLACE_WITH_REBUILDUP_DEV_ZONE_ID"
    }
  ],
  "no_bundle": true
}
```

The operator must replace the placeholder `zone_id` with the
actual Cloudflare zone ID for `rebuildup.dev` (found via
`wrangler zones list` or the Cloudflare dashboard) before
running `pnpm run deploy:production`.

### 4.2 Why a separate config file (not `env.production`)

The natural wrangler way to scope config per environment is an
`env.<name>` block inside `wrangler.jsonc`. We deliberately
do NOT use that shape here because:

1. **Wrangler 4.x typegen narrows `Env` to env-scoped bindings**:
   declaring `env.production` in `wrangler.jsonc` makes
   `__BaseEnv_Env` (the default-env type used by every source file)
   treat every top-level binding (`DB`, `MEDIA`, `ASSETS`,
   `RATE_LIMIT_WRITE`, `RATE_LIMIT_READ`) as **optional**, which
   would force `env.DB!` / `env.MEDIA!` (etc.) non-null assertions
   on every binding call site in the codebase (~126 sites).
2. **Wrangler 4.131 does not support top-level `extends`** in JSON /
   JSONC config files (4.135+ does). Upgrading wrangler is out of
   scope for this ticket.
3. **Wrangler 4.131 does not recognize `custom_domains` as a
   top-level key** (4.135+ does); the supported shape is
   `routes[]` with `custom_domain: true`.

A separate `wrangler.production.jsonc` that fully duplicates the
default config and adds the production-only overrides:

- Keeps `wrangler.jsonc` (and its typegen) clean for local dev.
- Allows production-only var (`BETTER_AUTH_URL`) without breaking
  default-env type narrowing.
- Lets us use `routes[]` (the 4.131-supported shape) without
  mixing concerns into `wrangler.jsonc`.

The duplication cost is small: any change to `wrangler.jsonc` must
be mirrored into `wrangler.production.jsonc`. The header comment
in `wrangler.jsonc` calls this out.

### 4.3 Better Auth config

`src/cloudflare/auth/better-auth.ts` reads `env.BETTER_AUTH_URL`
and passes it to both `baseURL` and `trustedOrigins`. No code
change is needed; only the env contract is enforced by this ADR.

The runtime contract is `string | undefined`. The default-env
typegen does not enumerate `BETTER_AUTH_URL` (since the top-level
`vars` block omits it), but wrangler injects the production-only
var into the runtime `env` at deploy time, so the documented cast
(`env as { BETTER_AUTH_URL?: string }`) still resolves correctly
in production.

### 4.4 Home self-consumption

`src/home/{reactions,access}/load.ts` already reads
`BETTER_AUTH_URL` from `env` to compute its upstream target URL.
With the production config, the home loader calls
`https://rebuildup.dev/api/v1/*` instead of an inferred origin.
No code change needed.

### 4.5 Operator deploy command

```bash
pnpm run deploy:production
# = pnpm run build && wrangler deploy -c wrangler.production.jsonc
```

Wrangler:

1. Builds the Worker bundle (`vite build`).
2. Reads the production config (`-c wrangler.production.jsonc`).
3. Deploys to the Worker.
4. Attaches `rebuildup.dev` to the Worker via the `routes[]`
   entry (Cloudflare provisions the DNS + TLS cert automatically
   because `custom_domain: true` + a valid `zone_id` are set).
5. Pins `BETTER_AUTH_URL=https://rebuildup.dev` in the runtime
   `env.vars` for the production deployment.

### 4.6 `no_bundle: true` on the production config

The production config sets `no_bundle: true` so wrangler skips its
own bundling step. The TanStack Start manifest resolution and the
Vite-produced `dist/` artifacts are accepted as-is. This matches
the expectation set by `@cloudflare/vite-plugin` in the default
config: Vite owns the build, wrangler just deploys.

## 5. Operator runbook

After this PR lands on `release-0-3-0`:

```bash
# 1. Operator runs from the release-0-3-0 branch locally
pnpm run cf-typegen
pnpm run deploy:production

# 2. Verify the canonical URL
curl -I https://rebuildup.dev/                  # HTTP/2 200
curl -I https://rebuildup.dev/admin/login      # HTTP/2 200
curl    https://rebuildup.dev/api/v1/health    # {"status":"ok"}

# 3. Run the production smoke (manual or via GH Actions)
pnpm run e2e:prod
# or:
gh workflow run prod-smoke.yml
gh run watch

# 4. After smoke is green, the 0.3.0 release PR can be opened
# (release-0-3-0 → main). Human merge + tag + Release publish per
# AGENTS.md §6 release PR merge human gate.
```

The `e2e:prod` smoke is operator-initiated (locally or via GH
Actions `workflow_dispatch`). It is NOT a CI gate.

## 6. Consequences

### 6.1 What changes

- `wrangler.jsonc` — header comment updated to document the
  companion-file wiring and the rationale for not using
  `env.production`. No top-level shape change.
- `wrangler.production.jsonc` (NEW) — fully duplicated default
  config + `vars.BETTER_AUTH_URL=https://rebuildup.dev` +
  `routes[]` with `custom_domain: true` for `rebuildup.dev`.
  Operator replaces the placeholder `zone_id` before deploying.
- `.dev.vars.example` — `BETTER_AUTH_URL` comment block now points
  at `wrangler.production.jsonc` instead of `*.workers.dev`.
- `src/cloudflare/auth/better-auth.ts` — header comment updated to
  cross-link this ADR. No code change.
- `playwright.config.ts` — header comment updated to mention
  `https://rebuildup.dev` as the canonical production URL.
- `e2e/prod-smoke.spec.ts` (NEW) — production-only smoke against
  the canonical origin.
- `package.json` — `e2e:prod` and `deploy:production` scripts added.
- `.github/workflows/prod-smoke.yml` (NEW) — `workflow_dispatch`
  trigger only. The production site is never gated by regular CI.
- `docs/development.md` — `e2e:prod` documented as the production
  smoke entry point.
- `docs/release.md` — 0.3.0 Release gate adds the canonical-origin
  verification step.
- `AGENTS.md §4` — cross-link to this ADR + note that
  `*.workers.dev` is debug-only.

### 6.2 What does NOT change

- Local `pnpm dev` still runs at `http://127.0.0.1:3000` with
  Better Auth's `request.url` inference. No `.dev.vars` change.
- `/api/v1/*` Hono router — origin-agnostic.
- Better Auth's session / cookie schema — already correct for
  HTTPS origins (Set-Cookie `Secure` is automatic when `baseURL`
  starts with `https://`).
- The default `*.workers.dev` URL — still serves the Worker as a
  debug entry point; just not documented as canonical.
- `MY_WEB_2026_CONSUMER_API_KEY` / `BETTER_AUTH_SECRET` — still
  managed via `wrangler secret put`, not committed.
- Home / Admin / `/api/v1/*` route handlers — already
  origin-agnostic.

## 7. Out of scope

- `www.rebuildup.dev` adoption — separate ticket, separate decision.
- Mail domain / MX / SPF / DKIM.
- Other subdomain design (`tools.rebuildup.dev`, `api.rebuildup.dev`,
  etc.).
- Multi-region / multi-Worker deployment (AGENTS.md §11).
- Per-visitor CSRF policy beyond Better Auth's `formCsrfMiddleware`
  — Better Auth is the canonical CSRF surface today.
- Upgrading wrangler to 4.135+ (which would unlock
  `custom_domains` and `extends` at the top level). Out of scope
  for this ticket; the companion-file shape is the 4.131-compatible
  workaround.

## 8. References

- Issue #43 — `infra: rebuildup.dev を canonical production domain
  として設定する`.
- Memory `rebuildup-dev-canonical-domain` — canonical-domain
  policy that this ADR codifies.
- ADR-0004 — Cloudflare services policy (custom domains are a
  Worker configuration, not a separate Cloudflare service).
- ADR-0009 — Better Auth foundation (§8 environment contract).
- ADR-0010 — Abuse protection (rate limit).
- `wrangler.jsonc` — default / local-dev config.
- `wrangler.production.jsonc` — production-only overrides.
- `src/cloudflare/auth/better-auth.ts` — `baseURL` + `trustedOrigins`.
- `e2e/prod-smoke.spec.ts` — production smoke.
