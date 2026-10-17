# Security

> my-web-2026 security policy and current controls.

## Reporting vulnerabilities

- Open a GitHub Issue tagged `security`, target a release.
- Implement the fix in a normal ticket branch
  (`<issue-number>`) or a patch release branch.
- Run `pnpm run validate:release`.
- Land via the canonical release PR flow.

For urgent / out-of-band reports (live site exploitation, credential
leaks), contact the maintainer directly via the channel listed in
`CODEOWNERS` / repository Settings → Code security before opening a
public Issue. If you find a leaked credential, assume it is
compromised: revoke and rotate immediately. Do not wait for the
patch release.

## CSRF

TanStack Start's **default CSRF middleware** is the canonical
mutation-protection mechanism for server functions. It is enabled by
default because `src/start.ts` is intentionally absent — adding a
custom `startInstance` override would disable the default
middleware, so do not add one without an ADR.

External boundary handlers under `src/http/**` are not protected by
the default CSRF middleware; they are responsible for their own
authentication and origin checks per ADR-0002.

## Test scope: local workerd vs real Cloudflare

`@cloudflare/vitest-plugin` runs SELF tests inside a local workerd
pool with **Miniflare-simulated** D1 / R2 / KV bindings. This proves:

- The Worker entry dispatches the request correctly.
- Hono handlers see the binding through `c.env.<binding>`.
- The D1 / R2 client API surface (`prepare`, `first`, `head`, …)
  behaves as documented.

It does **not** prove that real Cloudflare D1 / R2 resources
exist or are reachable. Real-resource smoke requires:

1. Real D1 `database_id` and real R2 `bucket_name` declared in
   `wrangler.jsonc`.
2. Production deploy via Cloudflare Workers Builds (canonical
   path — uses the `build_token_uuid` binding registered in
   Cloudflare project settings, NOT `CLOUDFLARE_API_TOKEN`). For
   local-diagnostic deploys the operator may instead use
   `pnpm deploy` with `wrangler login` (OAuth) or an explicit
   `CLOUDFLARE_API_TOKEN` env var; see
   [`docs/security/cloudflare-api-token-inventory.md`](security/cloudflare-api-token-inventory.md)
   for the consumer / non-consumer map.
3. A `curl` smoke against the deployed Worker URL: `/`,
   `/api/v1/health`, `/api/v1/db/ping`, `/api/v1/media/ping`.

This real-resource smoke is part of the 0.1.0 release cut (#009
in `docs/release.md`), not the per-binding local SELF tests (#006
/ #007). Until #009 lands, "D1 / R2 binding works" means **"the
binding API is reachable in the local workerd pool"**, not
**"the production database is online"**.

## Inventory at 0.1.0

| Package                     | Pinned version | Notes                                 |
| --------------------------- | -------------- | ------------------------------------- |
| `wrangler`                  | `^4.131.0`     | Cloudflare Workers toolchain          |
| `@cloudflare/vite-plugin`   | `^1.0.0`       | Vite <-> Workers bundling             |
| `@cloudflare/vitest-plugin` | `^1.0.0`       | Worker test pool (local Miniflare)    |
| `@tanstack/react-start`     | `^1.168.52`    | Framework                             |
| `@tanstack/react-router`    | `^1.168.52`    | Router                                |
| `hono`                      | `^4.13.7`      | External HTTP boundary                |
| `@pandacss/dev`             | `^1.12.1`      | Styling                               |
| `@biomejs/biome`            | `^1.9.4`       | Format + lint                         |
| `actionlint`                | latest         | Workflow YAML lint (CI step)          |
| `storybook`                 | `^8.6.18`      | Design-system preview (dev only)      |
| `@playwright/test`          | `^1.63.0`      | E2E suite (chromium)                  |
| `vite`                      | `^7.1.0`       | Bundler                               |
| `vitest`                    | `~4.1.0`       | Test runner                           |
| `react` / `react-dom`       | `^19.2.0`      | UI runtime                            |
| `typescript`                | `^5.9.0`       | Language                              |

## Automated checks

- Secret scanning: enabled as an asynchronous CI job (see
  `quality/profile.yaml#security_gates.secret_scanning`).
- Dependency review: deferred to a post-0.1.0 ticket.
- Code scanning (SAST): deferred.
- Container scanning: not applicable (no `Containerfile` at 0.1.0).
- Workflow YAML lint runs through `pnpm run lint:ci` inside the
  `validate` job (actionlint 1.7.12, downloaded by
  `scripts/lint-ci.mjs`). Biome does not lint `.yml`.

## Error redaction (Issue #457)

The external HTTP boundary (`src/http/**`) and the public
server-function surfaces must never answer a client with an internal
error. "Internal" means: a stack trace or source location, a
SQL / D1 / R2 message, a table or column name, a binding name, a
secret or secret binding name, or the text of a caught exception.

### Boundary 5xx contract

`src/http/errors.ts` owns the only redaction path for 5xx responses.
Every body is exactly:

```json
{
  "error": "internal_error" | "service_unavailable",
  "message": "<repo-authored sentence>",
  "request_id": "<correlation id>"
}
```

The caught error is handed to `console.error` and to nothing else.

| Concern | Contract |
| --- | --- |
| Correlation | `request_id` is byte-identical to the `X-Request-Id` response header, and to the id in the internal log line. A client-supplied `X-Request-Id` is reused when it matches `^[A-Za-z0-9._:-]{1,128}$` — the trace-id alphabets in real use (hex, UUID, W3C `traceparent`, dotted service ids) — so a reporter can be traced; anything else (empty, too long, spaces, control characters) is replaced by a freshly minted 128-bit hex id. The charset is not cosmetic: since #457 the id is published in the **body** too, so an unconstrained echo would let any client string ride inside a documented contract field. |
| Ops probes | `/api/v1/health`, `/api/v1/db/ping` (200) and `/api/v1/media/ping` (404 `key_not_found`) keep their documented bodies, including the `binding` field. Only the **failure** branch changed: the old `{"status":"binding_error","binding":"d1"\|"r2"}` 503 is now the redacted body above. The request path already identifies which probe failed, so no operational signal is lost. |
| Minting outside `/api/v1/*` | `resolveRequestId` mints an id when the request-id middleware did not run — that is, the `/webhooks`, `/oauth`, and `/integrations` prefixes. None of those prefixes has a handler yet, so the branch is currently unreachable in production; it exists so that a future handler on those prefixes is correct by default rather than by remembering. |
| Auth | 401 / 403 bodies are unchanged (`missing_authorization`, `invalid_api_key`, `missing_scope`). They carry no server state, and the correlation id is still available through the `X-Request-Id` header. |
| 4xx bodies | Router-owned rejection bodies may echo a **repo-authored** validator message (a closed set: `kind must be one of: emoji, image`). They never echo an error object, a table name, or a stack. |

Open question (deliberately not decided here): whether the `binding`
field in the **200 / 404** probe bodies counts as internal
information. The failure branch no longer publishes it and the success
branch still does; this record states that fact rather than claiming
the binding is hidden.

### Server-function surfaces

TanStack Start serialises a thrown handler error into the
`/_serverFn/*` payload through `ShallowErrorPlugin`, which copies the
**message**. A raw D1 failure would therefore render
`D1_ERROR: no such table: …` on a public page.

Two rules cover the public server functions, and which one applies is
a property of the surface:

| Surface | Rule |
| --- | --- |
| `src/portfolio/public.ts` (`project` / `adjacent` / `list`) and `src/about/public.ts` (`about`) | The read **is** the page. A failure throws through `withPublicErrorBoundary` (`src/portfolio/public-errors.ts`): the internal error is logged once with a short `ref`, and the thrown error carries `portfolio_unavailable (ref=…)` — 16 hex chars — instead. `/about` uses the same boundary because its `experience` subset is composed from the same public portfolio rows, so it failed through the same mechanism. |
| `src/home/reactions/load.ts` (the `/` widget) | The read is an **input** to a widget on a page that must render regardless. Both legs are best-effort: the `reaction_emoji_catalog` read and the upstream `fetch` degrade to an empty catalog / empty aggregate list and log the internal error, so a storage or transport outage costs the widget its content rather than the home page its error screen. The sibling home loaders already worked this way (`getHomeCounter`, `getHomeSystemStatus`, `probeCloudflareHealth`); #457 brought `getHomeReactions` in line. |

### Verification

- Unit: `src/http/errors.test.ts`,
  `src/portfolio/public-errors.test.ts`, and the degradation cases in
  `src/home/reactions/load.test.ts`.
- Local worker: `test/integration/error-redaction.test.ts` drives the
  real boundary (real middleware, real rate-limit binding, real D1)
  for accepted, rejected, and failed requests — including a real D1
  failure produced by dropping the `reactions` table, and injected
  D1 / R2 binding failures for the 503 branch. The same suite
  asserts the three rendered public screens through the real SSR
  pipeline: `/portfolio` and `/about` answer 500 with
  `portfolio_unavailable (ref=…)` and no D1 marker anywhere in the
  HTML, and `/` still answers 200 with a degraded reactions widget
  when `reaction_emoji_catalog` is absent.
- Screenshot:
  [`docs/verification/security/error-redaction-page.webp`](verification/security/error-redaction-page.webp),
  regenerated with `node scripts/capture-error-redaction-report.mjs`
  (or `pnpm run capture:error-redaction-report`). The page renders the
  responses the Worker actually produced; it contains no credential.
  The committed artefact is WebP (width ≤ 1600 px, quality 80) rather
  than PNG: Playwright cannot write WebP, so the capture script
  re-encodes the screenshot buffer with the `sharp` devDependency and
  never writes the intermediate PNG.

## Browser binaries (Playwright)

`pnpm run e2e` runs against `pnpm dev` (locally) or a deployed Worker
URL via `PLAYWRIGHT_BASE_URL`. The Chromium browser binary used by the
E2E suite is downloaded on demand:

- Locally: `pnpm run e2e:install` (`playwright install --with-deps
  chromium`). The `--with-deps` flag uses `sudo apt-get install` on
  Linux to add the system shared libraries Chromium needs
  (`libnspr4.so`, etc.) — operators should review this command before
  invoking it. The sandbox where development happens has no `sudo`,
  so `e2e:install` fails there; on CI runners `sudo` is available.
- On CI: the `Install Playwright Chromium` step in
  `.github/workflows/ci.yml` runs `pnpm exec playwright install
  --with-deps chromium`. The resulting `playwright-report/` artefact
  is uploaded via `actions/upload-artifact@v4` with a 7-day retention
  for triage; it contains the same HTML / traces that the local run
  would emit and must not include credentials or secrets.

Playwright is pinned in `package.json#devDependencies` and the
browser version is locked by `@playwright/test`'s `browsers` manifest
(see `pnpm exec playwright --version`). Bumping Playwright requires
running `pnpm run e2e:install` once after the lockfile update so the
new browser binary is available.
