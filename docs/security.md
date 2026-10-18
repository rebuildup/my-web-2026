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

## Markdown / Notion-derived HTML input boundary

Article bodies (Portfolio projects) are editor-controlled, third-party
originated text. Two input shapes exist, and each has exactly one
sanctioned entry point.

### Markdown — `src/portfolio/markdown.lexer.ts`

- The lexer **does not parse raw HTML**. Every text node reaches React
  as text, so `<script>` in a body renders as visible `&lt;script&gt;`,
  never as markup.
- `classifyHref` is the single href oracle. It allows `http:`,
  `https:`, root-relative and fragment hrefs, and **blocks**
  everything else — including values a browser would treat as a
  scheme after normalising: control-character obfuscation
  (`java<TAB>script:`), character-reference obfuscation
  (`javascript&#58;`), and protocol-relative hrefs (`//host`), which
  are resolved and inherit the external-link policy instead of
  masquerading as internal paths.
- A blocked href is **not** rewritten to `#`. It renders as an inert
  `<span class="portfolio-md-link-blocked">` carrying
  `data-blocked-reason` and `data-blocked-href`, so the refusal is
  visible to the author and to a reviewer. `safeHref` /
  `isExternalHref` remain for callers that only need the old
  string / boolean shape; they read the same oracle.

### Notion-derived HTML — `src/portfolio/markdown.notion.ts`

Notion exports carry `<script>`, `on*` handlers, `javascript:` hrefs
and inline `<svg>`, so HTML may only enter the renderer through this
adapter:

- **Allow list.** Elements not named in the module are unwrapped (text
  survives, markup does not); elements on the active list (`script`,
  `style`, `iframe`, `object`, `embed`, `svg`, `form`, …) are dropped
  with their subtree.
- **Attribute allow list.** Every `on*` attribute is dropped and
  recorded; every attribute outside the allow list is dropped; URL
  attributes go through `classifyHref`, so the scheme policy is not
  re-implemented.
- **Auditable.** `sanitizeNotionHtml` returns the refusals
  (`dropped[]`) rather than failing silently, and it never throws —
  malformed markup degrades to text, bounded by a depth and an output
  ceiling.

**Wiring status.** The adapter is **not** yet called by any ingest
path: the portfolio migration writes plain Markdown today. It landed
first, with tests, so that whichever migration introduces Notion HTML
inherits one sanitiser. Any new caller must go through it; adding a
second HTML path is a review failure, not a style preference.

### Verification

- Renderer level: `src/portfolio/markdown.security.test.tsx` and
  `src/portfolio/markdown.notion.test.tsx` over the shared corpus in
  `src/portfolio/markdown.xss-fixtures.ts`.
- Worker level: `test/integration/markdown-xss-ssr.test.ts` drives
  `GET /portfolio/<fixture>` through `SELF.fetch` with the corpus in a
  D1 row, and asserts over the served `<article>` region.
- Screenshot: `docs/verification/security/markdown-xss-fixture.webp`
  (see `docs/verification/security/README.md` for how to regenerate
  it). The corpus carries attack simulations on purpose; it contains
  no credentials and no live third-party origin.

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
