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

## Open redirect

Every `returnTo`-shaped value that crosses the external boundary is
untrusted. `src/http/security/**` refuses anything that is not an
internal absolute path, and is mounted in front of the Better Auth
handler at `/api/v1/auth/*`. `BETTER_AUTH_URL` is the trusted-origin
allow-list; when it is unset the guard refuses every absolute URL
(fail-closed). The shipped contract, operator duties and known limits:
[`docs/security/open-redirect.md`](security/open-redirect.md).

## D1 parameter binding (Issue #452)

### Rule

Every D1 statement that user input reaches must bind that input with
`?` / `?N` + `.bind(...)`. Splicing a value into the statement text is
a defect even when the value is escaped today: the statement text is
the part a reviewer reads as structure, and a bound value cannot change
the parse tree.

### Where it is enforced

Two gates, both run by `pnpm run test` (and therefore by
`pnpm run validate:fast` and CI):

| Gate | What it proves | Where |
| --- | --- | --- |
| Runtime suite | Attack fixtures reach the real endpoints through `externalBoundary`; the recorded SQL text is byte-identical to the benign run, no payload appears in a statement, and the seeded rows survive. | `test/integration/d1-parameter-binding.test.ts` (workerd pool) |
| Static gate | The **literal argument** of every `prepare()` / `exec()` / `batch()` call in `src/**` contains no `${…}` interpolation. A statement assembled into a variable before the call is out of scope by design — that is a dataflow judgement, not a scan. | `scripts/check-d1-sql-binding.mjs`, wired via `scripts/check-d1-sql-binding.test.mjs` |

Run the static gate on its own with `node scripts/check-d1-sql-binding.mjs`.
Exit 1 means one of two things: an interpolated statement, or an
`SQL_STRUCTURE_ALLOWLIST` entry the scan never reached (dead
configuration). Adding an entry is a reviewable decision: it must name
the file, the interpolated identifier, and why the value cannot carry
user input. The single current entry is `cursorPredicate` in
`src/portfolio/load.ts` — a fixed chain of `?` placeholders whose
components are all bound — and it is **live** only because that file
passes its list statement to `prepare()` inline. Write the statement
inline; a `const sql = …` in front of it hides the interpolation from
the gate, and the gate then fails on the unreachable entry rather than
letting it rot.

### Known unscanned inventory

The static gate reads literal arguments, so these D1 statements are
**not** covered by it. None of them interpolates — each is a constant,
or a choice between two literals — so what actually guards them is the
combination of that reading and review:

| Site | Shape | Other coverage |
| --- | --- | --- |
| `src/http/reactions/reactions.ts` (`REACTION_INSERT_SQL`, `REACTION_LOOKUP_SQL`) | module-level string constant | runtime suite (`PUT` / `DELETE` / `GET /api/v1/reactions`) |
| `src/portfolio/load.ts` (`prevSql`, `nextSql` in `loadPortfolioAdjacent`) | local string constant | runtime suite (portfolio slug read) |
| `src/reactions/emoji-catalog.ts` (`loadCatalog`) | `cond ? 'literal A' : 'literal B'` | `src/reactions/emoji-catalog.test.ts` (home widget read; no user input reaches either branch) |

Two further limits are deliberate and documented in the gate's own
docstring: string concatenation inside a call argument
(`db.prepare('… WHERE k = ' + key)`) is not inspected, and `exec`
also matches `RegExp.prototype.exec` — all five `.exec(` sites in
`src/**` today are regexes, so D1 `exec()` / `batch()` have no shipped
call site yet (the fixture test covers both).

### Covered surfaces

Only endpoints that exist today (Issue #452 forbids inventing one):

- `POST /api/v1/access/hit`, `GET /api/v1/access/count/:key`
- `PUT` / `DELETE` / `GET /api/v1/reactions` (`target_key`, `actor_id`, `value`)
- `GET /api/v1/reaction-images/:id`
- portfolio loader slug read (`loadPortfolioProject`, `loadPortfolioAdjacent`)
- emoji catalog slug read (`getCatalogEntry`)

Payload families: tautology, comment tail, UNION, stacked statement,
backslash quote, LIKE wildcard, plus whitespace-free variants that
survive the access-counter validators and inputs the validators reject
(over-length, embedded space, control character).

### Operational contract

This gate changes no runtime contract: the auth / API-key boundary,
the Cloudflare bindings (`DB`, `MEDIA`, `ASSETS`), and the Tool
Registry dependency are all untouched. (One production statement was
reshaped for the gate — `listPortfolioProjectsImpl` now passes its SQL
to `prepare()` inline instead of through a `const sql` local. The
statement text is byte-identical; only where it is written changed, so
the allowlist entry above is enforced rather than dead.)

A new D1 surface is covered by adding it to the runtime suite. An
existing one is covered by the static gate **only if it is written as
the literal argument of `prepare()` / `exec()` / `batch()`**: a
statement written inline fails the gate on its own commit, while a
statement assembled in a variable is not scanned at all and must be
caught by the runtime suite (or by review). The inventory above names
the variable-built statements that exist today — keep it current when
one is added.

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

- Log redaction gate (Issue #467): `pnpm run log:redaction:check`
  fails when `src/**` writes to `console.*` outside `src/logging/`, or
  when an operator script prints a secret-named value. The contract,
  the coverage matrix, and the re-run procedure live in
  [`docs/security/log-redaction.md`](security/log-redaction.md); the
  verification report it produces is committed at
  `docs/verification/security/log-redaction-test.webp`.
- Secret scanning: enabled as an asynchronous CI job (see
  `quality/profile.yaml#security_gates.secret_scanning`).
- Dependency review: deferred to a post-0.1.0 ticket.
- Code scanning (SAST): deferred.
- Container scanning: not applicable (no `Containerfile` at 0.1.0).
- Workflow YAML lint runs through `pnpm run lint:ci` inside the
  `validate` job (actionlint 1.7.12, downloaded by
  `scripts/lint-ci.mjs`). Biome does not lint `.yml`.
- Redirect-target matrix (Issue #454) is regenerated from the shipped
  guard by `pnpm run security:redirect:report`; the committed image and
  its reading guide are in
  [`docs/verification/security/`](verification/security/).

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
