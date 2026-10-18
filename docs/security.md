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

## CSP frame-ancestors

> The inbound embed policy: which ancestor may put one of our
> responses inside an iframe. Issue #448. Distinct from the **outbound**
> Tool embed policy (`src/tools/registry.ts` + the manifest's
> `delivery.iframe`), which decides which Tools this host embeds.

### Three questions that are not the same question

| Question | Directive / contract | Owner |
| --- | --- | --- |
| Who may **read** a Tool artefact cross-origin? | `Access-Control-Allow-Origin` | `public/_headers` (Static Assets) |
| Who may **frame** one of our documents? | `Content-Security-Policy: frame-ancestors` | `src/server.ts` + `public/_headers` |
| Which Tools may this host **embed**? | `delivery.kind` / `delivery.iframe` | `src/tools/registry.ts` + `src/tools/manifest.json` |

The failure this separation prevents: `/tools/<slug>` renders an
`<iframe>`, which reads like "the Tool surface must be framable", and
by extension every surface. It is not. A document may embed an iframe
without being framable itself. Only the **ancestors of the Tool
document** matter for the Tool rule, and the only ancestor the Tool
document has is our own shell.

### Policy table

| Surface | Directive | Enforced in |
| --- | --- | --- |
| `/admin`, `/admin/*` | `frame-ancestors 'none'` | `src/server.ts` (Worker) |
| `/api/v1/auth`, `/api/v1/auth/*` (Better Auth — Account) | `frame-ancestors 'none'` | `src/server.ts` (covers the Hono response) |
| every other **Worker-generated** response (`/`, `/about`, `/contact`, `/portfolio/*`, `/tools*`, `/api/v1/*`) | `frame-ancestors 'self'` | `src/server.ts` (Worker) |
| `/tools/:slug/app`, `/tools/:slug/app/*` (Tool artefacts) | `frame-ancestors 'self'` | `public/_headers` (Static Assets) |
| `/share/*` (public static documents, e.g. `/share/procon2026/`) | `frame-ancestors 'self'` | `public/_headers` (Static Assets) |

Decisions behind the table:

- **Public stays `'self'`, not `'none'`.** Same-origin framing is a
  legitimate authoring/debugging affordance and a public marketing
  surface has no signed-in state to clickjack. Denying framing
  everywhere would buy nothing and cost the same-origin case.
- **Admin and Account are `'none'`** — clickjacking an operator's
  session is the threat (OWASP ASVS framing requirement, the second
  source cited by Issue #448).
- **Path only, no content-type or status gate.** Anonymous
  `GET /admin` answers `307` with no `content-type`, so a
  content-type-gated rule would skip exactly the response most worth
  protecting. Same reasoning as the cache policy in `src/server.ts`.
- **Prefix matching is exact-or-`/`**, so `/administrator` and
  `/api/v1/authentication` do not inherit a denial.
- **"Everything else" is a statement about Worker responses, not about
  every file this site serves.** Static Assets answer before the Worker
  runs (`wrangler.jsonc` declares no `assets.run_worker_first` and no
  `not_found_handling`), so the Worker's `'self'` default never reaches
  them. `/share/<slug>/` is the committed public HTML namespace
  (`docs/architecture.md`), and it carries its own `'self'` rule. The
  two Worker rows and the two `_headers` rows are disjoint halves of one
  policy, not overlapping descriptions of it.

### Why the existing Tool iframes keep working

`/tools/<slug>` (shell) is a Worker response carrying
`frame-ancestors 'self'`; the artefact it frames
(`/tools/<slug>/app/index.html`) is a Static Asset carrying
`frame-ancestors 'self'` in `public/_headers`. Both halves evaluate
against the **ancestor's** origin — the host, which is the same
origin in both cases — so `'self'` permits the embedding.

The `sandbox="allow-scripts"` (no `allow-same-origin`) attribute
makes the framed document's own origin opaque, but `frame-ancestors`
is matched against the ancestor, not the framed document, so the
sandbox changes nothing here. It still blocks the Tool from reading
the host DOM.

`frame-ancestors 'none'` on the artefact would break every integrated
Tool (the shell renders, the iframe never mounts), which is why the
static gate fails on that direction rather than leaving it to review.
`frame-ancestors *` would re-open third-party framing of Tool
documents, which is what the issue denies; the gate fails on it too.

### Why public static documents need their own rule

`/share/procon2026/` (and every future `share/<slug>/`) is delivered as
a Static Asset, so the Worker's default branch never runs for it: no
`_headers` rule means **no** `frame-ancestors`, which is precisely the
state the issue opened by describing ("no surface returned
`frame-ancestors`, so every page could be embedded by any third-party
iframe"). The rule is `'self'` for the same reason the Worker default
is: these are public documents with no signed-in state, so there is
nothing to clickjack, and same-origin framing stays available.

Coverage is checked rather than remembered. The static gate walks every
`.html` file under `public/`, derives the URLs Static Assets serves it
under (`/share/<slug>/` and `/share/<slug>/index.html`), and fails when
no rule matches that URL with a `frame-ancestors` directive — so adding a
public document cannot ship framable by any third party by omission.

### Where it is enforced

| Gate | What it proves | Where |
| --- | --- | --- |
| Runtime suite | Real headers through `SELF.fetch` for every Worker response: `/admin*` and `/api/v1/auth/*` are `'none'`, public surfaces are `'self'`, the anonymous `/admin` redirect carries the header with no content-type, lookalike paths do not inherit a denial, and `/tools/prototype` still mounts its same-origin artefact. | `test/integration/frame-ancestors.test.ts` (workerd pool) |
| Static gate | The Static Assets half, which no runtime test can observe: every `_headers` rule under `/tools` carries `frame-ancestors 'self'`, every committed public HTML document under `public/` is covered by a rule that carries one, no shipped value is permissive (`*`, `https:`, absolute origins), no rule targets a Worker-owned path, and the Worker half still exists. | `scripts/check-frame-ancestors-policy.mjs`, wired via `scripts/check-frame-ancestors-policy.test.mjs` |

Run the static gate on its own with `pnpm run security:embed:check`
(`node scripts/check-frame-ancestors-policy.mjs`). Exit 1 means a
`_headers` rule would widen framing, would break the Tool iframes,
targets a path Cloudflare never applies `_headers` to, or leaves a
committed public HTML document without a framing policy.

`test/integration/frame-ancestors.test.ts` is the only runtime proof
of the Worker half, because it is the only layer that observes the
actual response headers the runtime emits.

### Known unscanned inventory

- **Tool artefact and `share/` responses are not observed at
  runtime.** The workerd pool declares no `assets` binding
  (`vitest.config.ts`), so `public/_headers` is never applied there.
  The static gate is the whole of their coverage; `e2e/tools-prototype.spec.ts`
  proves the artefact is served and mounts in a real browser but does not
  assert headers. Cloudflare applies `_headers` to Static Assets
  responses, and the same file is parsed by `vite preview`, so the rules
  are observable locally and in production.
- **No `X-Frame-Options`.** `frame-ancestors` is CSP 3 and is ignored
  by browsers without CSP support. Every browser this project targets
  supports CSP 3; the legacy header is deliberately not sent so the
  two headers cannot disagree about what is allowed.
- **`/api/v1/*` non-account endpoints carry `'self'`.** They are JSON
  with no document to frame; the value is the default branch, not a
  per-endpoint decision.
- **The existing-CSP branches of `withFrameAncestors` are not observed
  at runtime.** No shipped layer emits a CSP today, so every case in
  `test/integration/frame-ancestors.test.ts` reaches the Worker with no
  pre-existing header. "A CSP that already carries `frame-ancestors` is
  left untouched, byte-for-byte" and "a CSP with other directives gains
  ours as one more directive" are therefore defensive code for a future
  caller, not asserted behaviour: the suite cannot fail if they regress
  until some layer starts sending a CSP, and the static gate does not
  cover them either (it reads `public/_headers` and canaries
  `src/server.ts` for the policy's presence). Exporting the helper from
  the Worker entry purely to test it is not worth the extra export.
- **Leaving an existing `frame-ancestors` alone is fail-open for
  `/admin`.** If a future layer stamps `frame-ancestors 'self'` on an
  Admin response, the Worker keeps it — ownership beats escalation.
  No layer does this today; recorded so the trade-off is visible if an
  Admin CSP is ever introduced.
- **A response with sealed `Headers` is returned unchanged** and
  silently gets no framing policy. Same trade-off, same rationale, as
  the cache policy in `src/server.ts`.

### Operational contract

This change adds no service, no binding, and no secret. Specifically:

- **Auth boundary untouched.** `/api/v1/auth/*` still runs through the
  same Better Auth handler with the same session checks; the header is
  stamped on the response in the Worker entry, not by an auth
  middleware. No token, cookie, or session semantic changed.
- **Cloudflare bindings untouched.** `ASSETS`, `DB`, `MEDIA` are
  unchanged; `wrangler.jsonc` is unchanged, so `cf-typegen` output is
  unchanged.
- **Tool Registry untouched.** `src/tools/manifest.json` and
  `src/tools/registry.ts` are unchanged — the outbound Tool policy is
  not derived from `frame-ancestors`, and no manifest field was added
  to express framing. `pnpm run tools:check` still passes unmodified.
- **Rollout / rollback** is a normal commit revert: the Worker
  half (`src/server.ts`) and the static half (`public/_headers`) are
  independent, so either can be reverted alone; reverting only
  `public/_headers` would leave Tool artefacts and `share/` documents
  with no stated framing policy, and
  `scripts/check-frame-ancestors-policy.mjs` would fail on the next
  commit that touched either file. Revert both together.
- **Verification artefact.** `docs/verification/security/frame-ancestors-test.webp`
  is generated by `pnpm run verify:frame-ancestors-screenshot`
  (`scripts/make-frame-ancestors-report.mjs`), which runs the suite and
  the static gate locally, renders the report, and encodes it as WebP.
  The Issue names a `.png`; the `.webp` extension is a deliberate
  substitution (the same one Issue #452 made for its report).

## API key scope and revocation

The API keys that guard `/api/v1/access/*` and `/api/v1/reactions/*`
have two decision layers: the boundary middleware
(`src/http/api-keys/middleware.ts`) owns the `Authorization` shape and
the resource/action scope lookup, and `@better-auth/api-key` owns hash
verification, revocation, and expiry. Every denial collapses to a single
shape (`401 missing_authorization`, `401 invalid_api_key`, or
`403 missing_scope`) so a refusal cannot become an oracle.

The scope matrix, the fixtures that pin each refusal, and the
secret-handling invariants live in
[`docs/security/api-key-scope.md`](security/api-key-scope.md). Its
measured artefact is
[`docs/verification/security/api-key-scope-matrix.webp`](verification/security/api-key-scope-matrix.webp)
(regenerate with `pnpm run verification:api-key-scope`). Verification is
local-only: fixtures live in a throwaway Miniflare D1 database, and no
production endpoint, secret, or operator account is read or written.

## Cache isolation

Responses whose body depends on who asked for them (per-principal
counters, per-visitor reaction state, sessions, `/admin*`, and
server-function payloads) are marked so that a **shared** cache — CDN
edge, corporate proxy — cannot store them: `private, no-store` on the
external boundary, `private, no-cache` on caller-specific SSR
documents, `no-store` under `/admin*`. Public immutable payloads opt
in explicitly with `public, max-age=…, immutable`.

The full contract, the audit it came from, and the verification
suites are documented in
[`docs/security/cache-isolation.md`](security/cache-isolation.md).

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

## Session lifecycle (sign-in / sign-out)

Better Auth (`src/cloudflare/auth/better-auth.ts`, ADR-0009) owns the
session; the admin gates that consume it live in
`src/admin/auth/load.ts` and the `/admin/*` route loaders. The
behavioural contract is pinned by
`test/integration/session-logout.test.ts` (Issue #439):

| Property                                                          | How it is proven                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| A sign-in session authorizes `/admin` and `/api/v1/auth/get-session` | positive case: the issued cookie resolves the user (with role) and the dashboard renders 200 |
| The same cookie is refused after sign-out                         | negative case: `get-session` resolves no user, `/admin` and `/admin/keys` 307 to `/admin/login`, and the D1 `session` row is deleted |
| Sign-out clears the browser cookie jar                            | `Set-Cookie` re-issues `better-auth.session_token` **and** `better-auth.session_data` with `Max-Age=0` |
| A client-supplied cookie is never promoted by sign-in            | fixation case: an attacker-planted value resolves to no session before *and* after login; the server issues its own token |
| A rejected sign-out does not invalidate the session               | an `Origin` mismatch is refused (4xx) and the session row survives |
| Replaying a dead cookie is a no-op                                | a second sign-out neither errors nor resurrects a session                          |

Two notes on reading that table. The redirect is pinned as **307**
(TanStack Start `redirect()`) and the **exact** path is asserted, so a
role denial (bounced back to `/admin`) can never be mistaken for a
session denial (`/admin/login`). And the cookie names are the test
pool's un-prefixed form: under `https://` — production, where
`BETTER_AUTH_URL=https://rebuildup.dev` is pinned by ADR-0014 — Better
Auth prefixes both with `__Secure-`, so the production names are
`__Secure-better-auth.session_token` / `__Secure-better-auth.session_data`.
The local pool (no `baseURL`) exercises the un-prefixed form; the
prefix is a transport attribute, not a contract change.

Run it locally:

```bash
pnpm exec vitest run test/integration/session-logout.test.ts
```

Every request goes through the local workerd pool, because sign-in and
sign-out write and delete D1 rows; running this against production
would mutate the operator's database and could invalidate the live
admin session. Fixture identities are local (`.test.local` addresses,
throwaway password) and cookie values are never printed — they are
never used as an operand of an assertion at all (vitest echoes both
operands of a failed `expect`), only cookie names, attributes, and
non-printing identity comparisons are asserted on.

Known residual (open owner decision, Issue #439): `session.cookieCache`
is enabled with `maxAge: 5 * 60`, so a party that captured BOTH
`better-auth.session_token` and `better-auth.session_data` *before* the
logout can replay the pair until the cache cookie expires — the cache
answers without consulting D1. A real browser is not exposed (the
sign-out response clears the pair), but the window is a real deviation
from "logout invalidates the session immediately", and closing it means
re-tuning the auth policy ADR-0009 owns. Until an owner decision is
taken, the window is **documented, not closed**.

The suite watches it as one `it.fails` case that asserts the *desired*
outcome ("a pair captured before sign-out is refused afterwards") and
therefore fails today. Because `/api/v1/auth/get-session` has no 401
path — an unknown or deleted session answers 200 with a `null` body —
"refused" is asserted as "resolves to no user" plus the `/admin`
redirect, never as a status code. The case fires on either remedy:
disabling the cache means no `session_data` cookie is issued at all, so
there is no pair to replay; shrinking it means the pair expires instead
of outliving the logout. Either way `it.fails` reports the unexpected
pass and the case is converted to a plain `it`. (Disabling the cache
also requires re-tuning the "sign-out clears the browser jar" case,
which by construction requires a cache cookie to clear.)

A redacted transcript of the observed responses is kept at
[`docs/verification/security/session-logout-e2e.webp`](verification/security/session-logout-e2e.webp).

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
- Dependency advisory gate: enabled (Issue #470, see
  `quality/profile.yaml#security_gates.dependency_review`). The
  `Dependency advisory audit` step of the `validate` job checks the
  committed lockfile with `pnpm audit --json` and evaluates it against
  the reviewed declaration in `quality/dependency-advisory-gate.json`:
  `critical` / `high` are the declared blocking severities, an approved
  exception is a record — keyed by `(advisoryId, package)`, because one
  advisory commonly spans several packages — carrying a reason, an
  approver, a tracking issue and an expiry date, and advisory data that
  cannot be read fails closed (exit `3`) instead of being reported as
  "0 vulnerabilities". A usage mistake or a malformed declaration is
  exit `2`, never a security verdict. The gate runs in CI rather than in
  `validate:fast` because it needs the registry advisory endpoint; the
  decision logic is in `scripts/check-dependency-advisories.mjs` and the
  same verdict is reproducible with `pnpm run dep-audit:check`. It ships
  with `enforcement: audit` and no approved exceptions, so outstanding
  findings are recorded rather than blocking; moving to `block` is an
  owner decision. Runbook:
  [`docs/runbook/dependency-advisories.md`](runbook/dependency-advisories.md).
- Code scanning (SAST): deferred.
- Container scanning: not applicable (no `Containerfile` at 0.1.0).
- Workflow YAML lint runs through `pnpm run lint:ci` inside the
  `validate` job (actionlint 1.7.12, downloaded by
  `scripts/lint-ci.mjs`). Biome does not lint `.yml`.
- Redirect-target matrix (Issue #454) is regenerated from the shipped
  guard by `pnpm run security:redirect:report`; the committed image and
  its reading guide are in
  [`docs/verification/security/`](verification/security/).
- Embed policy (Issue #448) is asserted at runtime by
  `test/integration/frame-ancestors.test.ts` and, for the Static
  Assets half no runtime test can observe, by
  `pnpm run security:embed:check`; the committed report is in
  [`docs/verification/security/`](verification/security/).

## Dependency install lifecycle scripts

`pnpm install` can execute third-party code before any repository
test exists. pnpm 12 is default-deny for that: only the packages
listed as `true` in `pnpm-workspace.yaml#allowBuilds` (or in
`#permissions`, which supersedes it) run their `preinstall` /
`install` / `postinstall` hooks.

That list is audited, not remembered:

- `quality/install-scripts.json` records, per package, whether the
  build is actually needed and why. `default_decision` is `block`;
  a record without a `justification` is rejected.
- `pnpm run install:scripts:check` (part of `validate:fast`) fails
  when an installed package can execute code at install time with no
  reviewed record, when the policy decision and pnpm's execution
  allow-list disagree in either direction, when a grant survives only
  in the legacy `onlyBuiltDependencies` list, or when an installed
  manifest grows an undocumented hook. "Can execute" includes an
  implicit `node-gyp rebuild` for a package that ships `binding.gyp`
  and the `prepare` of a git-hosted dependency. It warns when an
  allow-list entry buys no build, and on stale records.
- The audit is **status-only**: it reads package manifests plus those
  two policy files and prints package names, versions, hook names and
  policy text. No secret value (`.dev.vars`, Infisical, Worker
  secret) is read or printed, and nothing in the runtime / deploy
  path is touched.

Operator procedure (what each failure means, how to remediate, and
the recorded high-risk entry) lives in
[`docs/runbook/install-script-audit.md`](runbook/install-script-audit.md).
Tool-side / upstream changes are deliberately out of scope for the
audit itself (Issue #474): the gate records the risk and names the
removal condition instead of patching a dependency.

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
