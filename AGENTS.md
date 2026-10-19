# AGENTS.md — my-web-2026 root agent contract

This file is the **always-on** root contract for AI agents working on
my-web-2026. It contains only the invariants that apply on every
session. Domain-specific workflows are in `skills/<skill>/SKILL.md`.

> Read this file once per session. Read individual Skills only when
> the task actually requires them (progressive disclosure).

## 1. Project identity

- my-web-2026 replaces my-web-2025 as the personal Web Platform.
- 0.1.0 Foundation shipped in 2026-09; full migration is targeted for 2026-10.
- `package.json#version` is the sole current release-version source. Do not duplicate
  the current version in UI copy, README status prose, health responses, or runbooks;
  import/derive it or use GitHub Release metadata.
- Repository is a single Cloudflare Workers deployment, modular
  monolith architecture.
- Visibility: **public**. License: MIT. Canonical remote:
  `https://github.com/rebuildup/my-web-2026.git`.
- Source code, commit messages: **English**.
- Internal development docs, Issue / PR title and body, review
  discussion: **日本語**.
- Branch names are identifiers or release versions only — no prose.

## 2. Stack (do not invent alternatives without an ADR)

- Runtime / deployment: Cloudflare Workers (`@cloudflare/vite-plugin`,
  `wrangler`).
- Web framework: TanStack Start (`@tanstack/react-start` 1.168.x).
- External HTTP boundary: Hono (`hono` 4.13.x) at `/api/v1/*`,
  `/webhooks/*`, `/oauth/*`, `/integrations/*`.
- Internal application operations: TanStack Start server functions
  (`createServerFn`).
- Worker entry: `src/server.ts`. Default export `{ fetch(request, env,
  ctx) }` dispatches between Hono and the TanStack Start default
  handler based on path prefix. The default CSRF middleware is active
  because `src/start.ts` is intentionally absent — do not re-add it
  without an ADR.
- Styling: Panda CSS (`@pandacss/dev` 1.12.x). The shipped visual language is `src/editorial/`: `tokens.ts`, `semantic-tokens.ts`, and `primitives/`. **Tailwind CSS is forbidden.**
- Format / lint: Biome (`@biomejs/biome` 1.9.x). Replaces both
  Prettier and ESLint.
- Package manager: pnpm 12.3.x. **Bun is not the default.** Do not
  add Bun to scripts or CI.
- UI: React 19.2.x, Vite 7.1.x, TypeScript 5.9.x.
- Tests: Vitest 4.1.x + `@cloudflare/vitest-plugin` (workerd pool).

Verify all version-sensitive facts against current official docs.
This file is updated when the stack changes.

## 3. Architecture boundary (always enforce)

The TanStack Start / Hono split is enforced in `src/server.ts`. Do not bypass it.

Source ownership is **obligation-oriented** (ADR-0008). Path is a projection of
ownership, not the rule that creates ownership.

For every durable boundary, be able to answer:

1. Obligation — what work does it own?
2. Change reason — what decision or contract makes it change?
3. Authority — what has final decision authority over that change?
4. Dependency direction — who may know this contract?
5. Lifecycle — what is it born and removed with?

Do not create `modules/`, `components/`, `ui/`, `models/`, `services/`,
`utils/`, `shared/`, or similar folders merely to classify implementation
types. Technical names are allowed when they own an independent contract:
`http/`, `cloudflare/`, framework-imposed `routes/`, and runtime entrypoints
are current examples.

Current dependency direction:

```text
routes -> home
routes -> portfolio
routes -> about (`/portfolio/[slug]` embeds the approved person identity as the CreativeWork author; the fact stays owned by `about`)
routes -> editorial (Issue #171 — GA4 mount in __root.tsx)
home/reactions -> i18n (Issue #433)
editorial -> i18n (Issue #432 — the fr / de / pt / ru heading-glyph
                 fixture is policy data: which code points a heading
                 must render and which claims (number / negation /
                 permission) it must keep. `editorial` still owns the
                 font stack; the fixture declares a type TIER, not a
                 `font-family`)

server -> editorial (Issue #501 — SSR render-failure fallback document;
                     `src/server.ts` replaces a document React could not
                     render with `editorial/error-states/ssr-fallback.ts`; the
                     entrypoint is the only layer outside React)
router -> editorial (Issue #501 — failure surfaces bound in getRouter())
about -> editorial (Issue #422 — approved snapshot → `Person` projection; the fact stays owned by `about`)

routes -> http/security (Issue #454 — `classifyRedirectTarget` in the
           /admin/login loader; the security classifier only, no router,
           no handler)
home/status -> cloudflare
home/reactions -> reactions
home/access -> http/access-counter (schema types only)
home -> logging (Issue #467 — shared log redaction)
admin/emoji-catalog -> reactions
admin -> logging (Issue #467 — admin image diagnostics)
reactions -> cloudflare (env.DB at SSR time)
http/seo -> portfolio (public project index only; the public-visibility
             filter stays in the portfolio obligation — Issue #420)
portfolio -> cloudflare (env.DB / env.MEDIA at SSR time, DI seam)
portfolio -> editorial
reactions -> i18n (Issue #433)
portfolio -> i18n (Issue #433)
external-api -> editorial (Issue #499 — display primitives only)
server -> http
http -> cloudflare (env.DB / env.MEDIA at request time; pure rules such as
  `isPublicMediaKey` may be imported as values, since `cloudflare/**` stays binding-free)
http -> logging (Issue #467 — boundary diagnostics)
http/reactions -> logging (Issue #467 — image-reference rejection record)
portfolio -> logging (Issue #467 — server-function public error boundary)
cloudflare -> logging (Issue #467 — auth email stub + binding probes)
editorial -> logging (Issue #467 — SSR fallback failure record)
server -> tools (Issue #449 — `toolRouteSecurityPolicy()` reads
             `delivery.iframe.allow` / `referrer_policy` from the Tool
             manifest; the policy object is passed into the HTTP
             boundary, so the Tool Registry still imports nothing
             from `src/http/**`)
home -> editorial
```

- `src/i18n/**` owns the platform's Unicode text
  policy (Issue #433): display text is preserved
  byte-exact and a URL slug is authored rather than
  derived, so normalization can never merge two
  distinct words onto one published URL. It is a
  **leaf obligation** — no repository imports — so
  `home/`, `portfolio/`, `reactions/`, `admin/` and
  `routes/` can all obey one rule without depending
  on each other. `scripts/check-architecture.mjs`
  enforces the leaf rule (every `*.test.*` /
  `*.spec.*` file under a leaf is exempt, so
  `src/i18n/fixtures.test.ts` can assert against
  the owner-owned grammars; implementation modules
  are not exempt). Each obligation keeps
  ownership of its own slug grammar:
  `src/reactions/slug-regex.ts` publishes
  `EMOJI_SLUG_GRAMMAR`, `src/portfolio/schema.ts`
  publishes `PORTFOLIO_SLUG_GRAMMAR`, and `i18n`
  owns only the rule for applying them. See
  `docs/adr/ADR-0017-unicode-normalization-and-url-slug-separation.md`
  and `docs/domain/i18n.md`.
  Issue #432 adds the glyph half of the same policy:
  `src/i18n/glyphs.fixture.ts` is the shared fr / de / pt / ru
  heading fixture whose code points, guards and authored forms
  `src/i18n/glyphs.test.ts` (CI),
  `src/editorial/glyph-headings.stories.tsx` (preview) and
  `scripts/capture-glyph-coverage.mjs` (measured artefact) all read.

- `src/home/**` owns the canonical Home surface and its presentation decisions.
- `src/editorial/**` owns the shipped editorial visual language.
- `src/cloudflare/**` owns Cloudflare-specific runtime behavior.
- `src/http/**` owns the external HTTP boundary.
- `src/logging/**` (Issue #467) is a **leaf** obligation owning
  the runtime log-redaction contract: `redact.ts` decides what may
  appear in a log record, `logger.ts` is the only module allowed
  to touch `console` in `src/**`. It owns the question "may this
  value be written to an operator-visible stream", not the question
  "what should be logged about a request" — each owner logs its own
  narrower record. Its independent contract: the AGENTS.md §4
  "no value-listing of real secrets" invariant generalizes from
  operator tooling to every runtime stream, and
  `scripts/check-log-redaction.mjs` is the gate that keeps
  `console.*` out of every other `src/**` file. `scripts/**`
  (operator tooling) does NOT import it: the Node scripts print
  status-only output by construction and must stay runnable without
  a Worker bundle, so the shared contract there is the marker-based
  `node --test` suites, not a shared module.
- `src/reactions/**` owns the slug-grammar / DB-backed emoji catalog
  shared by `home/` and `admin/`. Promoted in branch 39 from
  `src/http/reactions/` so neither the `home/` nor the `admin/`
  obligation has to value-import through the HTTP boundary (the
  reactions API does not own the catalog). The HTTP boundary's
  `src/http/reactions/**` keeps only the Hono router, schema, and
  reaction-image module; types and values about the catalog live
  here. AGENTS.md §3 "type-only edges" makes the
  `home → http` direction `import type`-only, so schemas under
  `src/http/access-counter/schema.ts` are the allowed place for
  home to read counter result shapes.
- `src/portfolio/**` (Issue #76, target 0.5.0) owns the
  employment-facing Portfolio data model, publication contract,
  and R2 media composition. The D1 / R2 access uses a DI seam
  (`createD1PortfolioLoader(env)`) and a `PortfolioLoader`
  interface so routes / UI can be unit-tested with a fake
  implementation and so the on-disk shape can evolve without
  leaking through every consumer — see the home reactions
  loader for the same pattern. The portfolio obligation is a
  peer to `home/`; neither imports from the other.
- `src/external-api/**` (Issue #499) owns the reliability contract
  for a display component that reads a third-party API: bounded
  attempt, stale-aware snapshot, breaker state, and non-destructive
  fallback (`contract.ts`), the single place an outbound request is
  issued (`timeout.ts`), the attempt sequencing (`reader.ts`), one
  adapter (`github.ts`) and the display surface
  (`ExternalReadCard.tsx`). It composes `editorial` primitives and
  reads nothing through `http/` or a `cloudflare` binding. Nothing
  is wired to a route, so the repository makes **no outbound
  third-party request at runtime**; promotion follows
  `docs/domain/integrations.md` (capability-scoped first).
- `src/routes/**` is the TanStack Start file-route contract; keep route files thin.
- An external third-party read is not an `src/http/**` concern: `http/`
  owns the INBOUND external boundary (`/api/v1/*`, `/webhooks/*`),
  while `src/external-api/**` owns OUTBOUND reads a display component
  makes. The two must not import each other.
- Internal UI operations use TanStack Start server functions at the obligation
  that composes them (currently `src/home/{status,reactions,access}/load.ts`,
  `src/portfolio/public.ts`, and `src/admin/**/load.ts`).
- Hono handlers remain under `src/http/**`.
- TanStack Start's default CSRF middleware is canonical. A custom
  `startInstance` is forbidden without an ADR.

Do not pre-create shared abstractions, integrations, or future visual languages.
Promote a local implementation only after an independent contract / authority /
lifecycle is observed; demote it if that independence disappears.

Physical separation also has a cost. Do not split a conceptual distinction into
another directory unless the split improves ownership, dependency direction,
blast radius, or navigation.

**Type-only edges.** Some edges in the dependency table above are
annotated `(schema types only)`. They mean: the source owner may
import from the target, but only via `import type { … } from
"…/<schema>"` — never a value import. TypeScript's
`verbatimModuleSyntax: true` erases those at build time, so the
runtime obligation graph is unchanged. `scripts/check-architecture.mjs`
enforces this for every edge registered in `typeOnlyEdges`; adding a
new edge requires an entry there AND in the dependency table above.
The currently registered type-only edge is `home → http`.

## 4. Cloudflare services policy

Only resources declared in the Wrangler configuration exist. The durable baseline is:

- Static Assets binding (`ASSETS`).
- D1 binding (`DB`, `database_name: my-web-2026`,
  `database_id: d761ddb7-8179-48dd-855f-c8b7b2924bad`, APAC).
- R2 binding (`MEDIA`, `bucket_name: my-web-2026`, Standard).

Every additional service (KV, Queues, Durable Objects, Workflows,
Vectorize, Workers AI) requires its own ticket and ADR entry, and
`pnpm run cf-typegen` after the binding change.

### Canonical production domain

The canonical production origin is `https://rebuildup.dev` (owned
in Cloudflare). Home, Admin, and `/api/v1/*` all serve from that
origin. Wiring is documented in `docs/adr/ADR-0014-rebuildup-dev-canonical-production-domain.md`
(Issue #43); `BETTER_AUTH_URL=https://rebuildup.dev` and the
`routes[]` binding for the bare hostname live in the companion
file `wrangler.production.jsonc`. Production delivery is owned by Cloudflare
Workers Builds: pushes to `main` run the configured Cloudflare build command
and production deploy command. GitHub Actions owns validation and the manual
production-smoke workflow only; it must not deploy production. The local
`pnpm run deploy:production` command is a recovery/debugging fallback. The
companion file exists because
declaring `env.production` inside `wrangler.jsonc` causes wrangler
4.x typegen to narrow `Env` to env-scoped bindings, breaking
every `env.DB` / `env.MEDIA` call site. The `*.workers.dev` URL is
debug / infrastructure only — never referenced as canonical in
ADRs, READMEs, user-facing copy, or example URLs.

### Runtime secret SoT + production release handshake

Runtime secret **values** live in Infisical. The Wrangler configuration
declares only the **names** (see `wrangler.jsonc#secrets.required` and
its `wrangler.production.jsonc` mirror). The canonical production
release sequence and all failure / rollback paths are defined only in
[`docs/runbook/cloudflare-workers-builds.md`](docs/runbook/cloudflare-workers-builds.md).
Do not duplicate or reorder that sequence from memory. The canonical
secret inventory / environment separation / naming convention / rotation
ownership table lives in
[`docs/runbook/infisical-secrets.md`](docs/runbook/infisical-secrets.md)
(Issue #167). Its current
post-incident order is `#139 containment → #89 Phase B flip → Smoke #1
→ release PR merge / Cloudflare Workers Builds deploy → Smoke #2/#3
→ --delete-legacy-only → final drift`.

Issue #122 is closed / superseded historical context. Its dev→prod
reconciliation path MUST NOT be executed.

Authority:

- ADR-0015 [`docs/adr/ADR-0015-infisical-env-management.md`](docs/adr/ADR-0015-infisical-env-management.md)
  §1 (Infisical SoT) / §6 (consumer API key) / §9 (staged design +
  audit-only semantics).
- Issues #71 (runbook) / #89 (Phase B) / #124 (canonical sequence) /
  #139 (credential-containment incident). Issue #122 is historical
  only and is not an active release gate.
- The companion `wrangler.production.jsonc` `secrets.required` block
  header distinguishes the source-controlled desired contract from
  the live Worker binding state during the Phase B window.

### Agent invariant: no value-listing of real secrets

Agents MUST NOT execute value-listing commands against real
environments. The originating incident (Issue #139, 2026-09-28) was
an `infisical secrets --env=dev --path=/` invocation whose plaintext
output was rendered into agent transcript, exposing four production
credentials. The same anti-pattern includes (non-exhaustive):

- `infisical secrets list ...` / `infisical secrets --env=... --path=...`
  / `infisical secrets get <name> --plain` (real value surfaces to
  stdout).
- `wrangler secret:list --format pretty` or any wrangler secret
  subcommand that exposes values (Wrangler exposes names only via
  `wrangler secret list --format json`; the agent must rely on the
  name-only contract).
- `curl https://app.infisical.com/api/v3/secrets/raw/<name>` or any
  HTTPS call that requests `viewSecretValue=true` against a real
  environment unless explicitly authorized in the current
  interaction AND the response is consumed inside a dedicated script
  that prints status-only output (MATCH / DIFFER / MISSING) and
  NEVER the value itself.
- Direct `echo $VAR` / `printenv` / `cat .dev.vars` of any
  environment that holds a real production credential.

The canonical replacement path is a dedicated comparison script
(`scripts/rotate-better-auth-secret.mjs --verify-only`,
`scripts/reconcile-prod-auth-secret.mjs --verify`,
`scripts/check-cf-secrets.mjs`) that captures → compares → emits
status-only output. Agents MUST prefer these scripts over ad-hoc
debugging shortcuts that print values.

Secret value comparison via dedicated script (status-only output) is
NOT a debugging shortcut. It is the canonical verification surface.
The forbidden patterns above are the shortcuts.

This rule is enforced at three layers:

- **Repository policy** (this section): agents operating on this
  repository MUST follow the rule.
- **Operator authorization model**: ad-hoc value-listing requires
  explicit operator approval in the current interaction, scoped to a
  specific value (e.g. "for the next 60 seconds, you may read the
  Infisical `prod` `MY_WEB_2026_CONSUMER_API_KEY` value via the
  dedicated verification script"). Generic authorization does NOT
  cover value-listing.
- **Runtime CLI guard** (planned, Issue #140 follow-up): the
  repository-owned wrapper scripts listed above enforce the rule
  structurally — there is no `print-secret-value` subcommand and
  error paths never echo the underlying value.

## 5. Quality gates

Three deterministic entry points defined in `quality/profile.yaml`:

- `pnpm run validate:fast` — local feedback. Read-only.
  (`format:check` + `lint:check` + `architecture:check` +
  `log:redaction:check` (Issue #467 — `src/**` may only reach
  `console` through `src/logging/logger.ts`, and operator scripts may
  not print a secret value) +
  `structured-data:check` + `index:boundary:check` +
  `seo:status:check` (Issue #419 — every shipped route must own a
  status row (200 / 404 / 500 / redirect / noindex) whose proof file
  cites it, so an unreviewed request class cannot pass silently) +
  `tools:check` + `security:headers:check` + `install:scripts:check` +
  `wrangler:independence:check` + `cloudflare:contract:check` +
  `test:wiring:check` + release-asset checks + `version:check` +
  `typecheck` + `infisical:check:coverage` + `sbom:check` +
  `csrf:contract:check` + `compat:check` +
  `tools:provenance:check` +
  `tools:artifact:check` (Issue #466 — a Tool's declared license is
  checked against the license file in the pinned checkout and its
  dependency set against the reviewed record in
  `quality/tool-artifact-inventory.json`; a shipped Tool whose evidence
  is missing or contradicts the record is an error, and
  `scripts/build-tools.mjs` refuses to publish it) +
  `copy:i18n:check` + `publication:check` +
  `content:links:check` (Issue #434 — internal link 404 / unsafe
  target / missing image alt is an error; external timeouts are
  warnings) +
  `routes:quality:check` (Issue #492) + `i18n:policy:check` +
  `a11y:reduced-motion:check` (Issue #403 — every motion surface
  must carry the `data-motion` hook, read or receive the shared
  preference, and be nameable by a reduced-motion selector) +
  `ci:pins:check` (Issue #472, GitHub
  Actions pin / token audit) + `knip:check` (Issue #531,
  diff gate vs `quality/knip-baseline.json`) + `test`.
  The canonical list is
  `quality/profile.yaml#gates.fast.components`; add a step there,
  not only in the script. Issue #566 made that list executable:
  each `validate:*` npm script is one line
  (`node scripts/run-quality-gates.mjs <gate>`) that runs the
  declared components in order, one command per line, and stops at
  the first failure with that failure's exit code. `pnpm run test`
  likewise delegates to `scripts/run-script-tests.mjs`, which
  discovers every `scripts/*.test.mjs` by convention — so adding a
  gate or a script test never edits a shared one-line chain.)
- `pnpm run validate:integration` — ticket PR verification.
  (`validate:fast` + `build:production` + per-route bundle budget
  (`bundle:budget:check`, Issue #482) + default/production Wrangler
  dry-runs + `lint:ci` (actionlint 1.7.12, downloaded by
  `scripts/lint-ci.mjs`) + `build-storybook`)
- `pnpm run validate:release` — pre-`main` verification.
  (`validate:integration` + `cf-typegen:check`)

Playwright E2E is a separate CI step on pushes to `main` / `release-*`
and on PRs with the `ui-change` label; it is not part of the local
`validate:release` command.

`validate:fast` also runs `install:scripts:check` (Issue #474): the
dependency install-lifecycle audit that keeps
`pnpm-workspace.yaml#allowBuilds` and
[`quality/install-scripts.json`](quality/install-scripts.json) in
agreement. It reads installed manifests and those two files only, is
status-only, and fails closed when the tree is not a pnpm install.
Runbook: [`docs/runbook/install-script-audit.md`](docs/runbook/install-script-audit.md).

One gate is deliberately **not** in the three entry points: the
dependency advisory gate (Issue #470,
[`quality/dependency-advisory-gate.json`](quality/dependency-advisory-gate.json),
`pnpm run dep-audit:check`). It needs the npm registry advisory
endpoint, and `validate:fast` is offline and read-only by contract, so
it runs as the `Dependency advisory audit` step of the `validate` job
instead. The decision logic is in `scripts/check-dependency-advisories.mjs`,
not in workflow YAML, and the same verdict is reproducible locally with
`pnpm run dep-audit:check`; whether it should also join a local entry
point is an open decision recorded in
[`quality/profile.yaml`](quality/profile.yaml). Operator reference:
[`docs/runbook/dependency-advisories.md`](docs/runbook/dependency-advisories.md).

A second gate is deliberately **not** in the three entry points, and is
not a CI step either: the R2 key-set audit (Issue #577,
`pnpm run r2:media:audit`). It reads the **production** `MEDIA` bucket's
key set read-only and fails when a key exists outside
`PUBLIC_MEDIA_PREFIXES` — the enforcement owner chose for the public R2
custom domain. It needs an R2-scoped credential, and no workflow under
`.github/workflows/` holds a Cloudflare credential, so it runs as a
release step performed by an operator (step 9 of
[`docs/release.md`](docs/release.md)'s sprint cycle). It is
status-only (verdict, counts, reason codes — never an object key, a key
fragment, a credential or a raw CLI error) and fail-closed: anything it
cannot decide exits non-zero. Decision:
[`quality/profile.yaml`](quality/profile.yaml#r2_media_key_set_audit).
Operator reference:
[`docs/runbook/r2-media-key-set-audit.md`](docs/runbook/r2-media-key-set-audit.md).

A third gate is deliberately **not** in the three entry points, and is
not a CI step either: the operator MFA confirmation audit (Issue #469,
`pnpm run check:operator-mfa`). It reads one local JSON ledger
(`quality/operator-mfa-ledger.json`) in which the operator records the
date they last verified 2FA / Passkey on the GitHub, Cloudflare,
Infisical and registrar accounts, and classifies each service as
`confirmed` / `unconfirmed` / `stale` / `missing` (ledger verdict
`OK` / `OUTSTANDING` / `UNDECIDABLE`, exit 0 / 1 / 2). It holds no
credential, calls no provider and touches no binding — the four account
states are not observable from a Worker, so what the gate audits is the
**record**, not the account. The ledger schema has no field for an
account identifier, an identifier-shaped key is `UNDECIDABLE`, and both
the ledger and the rendered report go through a status-only anonymization
guard. It stays out of `validate:*` because the shipped ledger is
unconfirmed until the owner fills it in (a CI step would be permanently
red for a condition only the owner can resolve). Decision:
[`quality/profile.yaml`](quality/profile.yaml#operator_mfa_audit).
Operator reference:
[`docs/runbook/operator-mfa-verification.md`](docs/runbook/operator-mfa-verification.md).

Local agent and GitHub Actions invoke the same entry points. Do not
hide validation logic inside workflow YAML. Coverage thresholds are
**not** enforced at 0.1.0; that decision is in ADR-0007.

## 6. Sprint workflow

- One sprint = one week = one target semantic version = one
  release branch `release-x-y-z`.
- **Cutting `release-x-y-z` includes setting `package.json#version`
  to `x.y.z` in the same step.** `version:check` derives the
  expected version from the branch name and fails the whole
  `validate` job on a mismatch, so a release branch whose
  `package.json#version` still carries the previous sprint's
  number is red from its very first commit until it is bumped.
  This is option 1 + option 2 of Issue #253: the bump lands on
  the branch that needs it (rather than being deferred to a
  later ticket), **and** the cutting step itself now states the
  requirement so the next branch does not repeat it. The gate
  stays strict — a release-branch mismatch is an error, never
  a warning.
- Ticket branch is the Issue number only (`123`). No `issue/` prefix,
  no slug.
- 1 top-level Issue = 1 ticket branch = 1 ticket PR.
- Independent ticket PR base = `release-x-y-z`.
- Stacked dependent ticket PR base = immediate predecessor branch.
- All ticket branches start with: create branch → first meaningful
  commit → push to canonical remote → verify remote head SHA → open
  Draft PR → set linked Issue / assignee / reviewer / labels / target
  release / stack context.
- An active durable ticket branch without a Draft PR is a **bug**,
  not a normal state.
- `main` is the released source state. Only `release-x-y-z → main`
  PRs update `main` (and only when `main` protection / ruleset
  allows it).
- Stack landing: ticket Done = landed on target release trunk, not
  merely merged into an intermediate predecessor branch.
- **Release PR merge human gate**: agents MAY create and update the
  release PR, run validation, and report release readiness. Agents
  MUST NOT merge the release PR, push the release tag, or publish
  the GitHub Release without explicit human approval from the
  repository owner in the current interaction. "CI is green",
  "release-ready", or any pre-approved plan does NOT constitute
  merge approval. This applies even when the agent is implementing
  the rule itself (the rule cannot be tightened in a single
  autonomous pass without an interim human check). See
  `skills/github-delivery/SKILL.md` for the canonical wording and
  scope.
- See `skills/github-delivery/SKILL.md` for the full procedure.

## 7. Recovery

Native session resume is an optimisation. Canonical recovery is from
durable project state:

- GitHub Issue + Project (status, target release, dependencies).
- Ticket branch, remote head SHA, Draft / Ready PR.
- Stack predecessor identity + exact predecessor SHA when stacked.
- Repository-controlled design / ADR / Skills / docs.
- Immutable worker / subagent results.

Active durable ticket branches must always have a published remote
head + Draft PR. Release branches are the only exception, and only
while they are zero-diff against `main`. See
`skills/agent-recovery/SKILL.md`.

## 8. Decision precedence

For any judgement call, follow:

1. project-wide policy / canonical architecture / this `AGENTS.md`
2. design / specification / explicit task instruction
3. coherent existing implementation
4. current official framework / runtime / SDK guidance
5. established ecosystem convention
6. local best judgment

Do not escalate a question whose answer is uniquely determined by the
precedence. Do escalate when the call affects product semantics,
public contracts, security, privacy, cost, release scope, or
external contracts.

## 9. Localised project state

- `.tmp/` — ephemeral verification artefacts. Gitignored.
- `.reference/` — external reference clones. Gitignored. Use
  `git clone <url> .reference/<name>` for short-lived research.
- `Containerfile` — when a custom container definition is added.
  Foundation release does not need one.

## 10. Available skills (progressive disclosure)

Read a Skill only when the task actually requires it.

### Vendoring — do not sync mechanically (Issue #647)

`skills/` holds **manual vendored copies**. There is no
`skills-lock.json` and no hash gate, and each vendored skill is a
single `SKILL.md` — upstream `references/` directories were never
imported. The vendored set has two upstreams:

- `rebuildup/project-init` — delivery / quality / runtime skills.
  Last reconciled against **0.1.1**; upstream has since moved to
  `release-0-6-0` (`52d3e64`). (`writing-discipline` is itself vendored
  by project-init from the writing-skills upstream.)
- `rebuildup/design-skills` — design skills. Last reconciled against
  **0.3.0** (`release-0-3-0`).

**Running `npx skills update` (or `bunx skills update`) over the whole
directory is forbidden.** The following are **intentionally forked**,
and a blanket sync would silently reverse a project decision or break a
canonical link:

| Skill | Why it is forked |
| --- | --- |
| `github-delivery` | Owns the **all-merges-need-explicit-authorization** rule (§6) and the `Release PR merge human gate (canonical rule)` heading. `docs/release.md` and `docs/runbook/sbom.md` anchor to that heading — upstream deleted it, and `scripts/check-content-links.mjs` excludes `skills/**`, so a broken anchor would not be caught. Upstream also grants *autonomous ticket-PR landing*, which would widen agent merge authority, and routes planning through Linear rather than the GitHub Projects SoT that §7 declares. |
| `worktree-workflow` | Pinned to this repo's `.config/wt.toml` (Issue #284); upstream's additions assume a Rust/Cargo build this repository does not have. |
| `engineering-decisions` | Encodes the same 6-level precedence list as §8 (the wording differs); upstream's 9-level variant introduces Constitution / Operating Model / Practice concepts this repository does not have, so §8 would have to change in the same commit. |
| `quality-gate` | The local file is upstream project-init 0.1.1 **minus** `## 7.1 Delivery-estimation integration` and **plus** four local-only sections that exist in no upstream release or branch tip: `## 17. Dependency / static-analysis goals`, `## 18. UI information architecture gate`, `## 19. Rendered UI verification`, `## 20. Build / container / deliverable verification`. Those local sections are the rules this repository's own `quality/profile.yaml` fast gate implements (`knip:check` ↔ §17, rendered-UI verification ↔ §19, build / deliverable verification ↔ §20), so a blanket sync would delete live local gates and re-add a section this repository does not use. **Owner decision: OPEN** — keep the local variant, or re-sync to upstream. |
| `parallel-orchestration`, `policy-evaluation` | Content sync deferred to a later release — see Issue #647. |
| `form-design`, `motion-system` | Edited in this repository to stop cross-referencing upstream's `interaction-state`: `form-design` drops the single line that points at it, `motion-system` drops its whole `### Interaction-state boundary` section. Both files are otherwise byte-identical to design-skills `v0.3.0`. |
| `interaction-states` | The local file is upstream design-skills' `interaction-states` **as it existed before upstream deleted it** in `6c2acf5` (2026-09-17, "remove duplicate interaction-states skill"); it was imported verbatim (commit `2a7460a6`) and is byte-identical to that revision. It is **not** a rename of upstream's current `interaction-state` — that is a different, later, "experimental" state-graph document (344 lines), while the local file is the 234-line component-state document (hover / focus / pressed / selected / disabled semantics) that `skills/touch-interface/SKILL.md:24`, `skills/dark-mode-design/SKILL.md:158` and `skills/keyboard-interface/SKILL.md:91,179` still point at. Copying upstream's current `interaction-state` over it would silently replace a different scope under the same name. **Owner decision: OPEN** — keep the deleted upstream variant, or re-import upstream's current `interaction-state` and re-point those references. |

Upstream skills this repository **does not vendor**: `linear-release-control`
(explicitly declined — it conflicts with §7's GitHub-Projects SoT),
`herdr-runtime`, `orca-frontend` (both explicitly declined),
`secrets-management`, `skill-selection`, `security-audit`,
`agent-delivery-estimation`, `correctness-assurance`, `idea-discovery`.
Re-evaluation candidates from Issue #647: `skill-selection`,
`secrets-management`, and the `interaction-discipline` YAML quoting fix.

To take an upstream change, diff it first, land it as its own ticket,
and re-check the §3 / §6 / §7 invariants it touches. The update command
is `npx skills add rebuildup/project-init --skill <name> --copy` —
**not** `bunx` (§2 forbids Bun here) and **never without `--copy``
(a symlinked install is not what §10 promises readers). The CLI installs
into an **agent** skills directory (`.claude/skills/`, `.agents/skills/`,
…), not into this repository's `skills/`: treat its output as a staging
copy and diff it into `skills/<name>/` by hand. Clone the upstream into
`.reference/<name>` (§9) to diff against.

### Sprint / delivery
- `skills/github-delivery/SKILL.md` — Issue / PR / release sprint
- `skills/parallel-orchestration/SKILL.md` — multi-agent / stacked PR
- `skills/onboarding/SKILL.md` — fresh contributor / fresh agent

### Quality / evaluation
- `skills/quality-gate/SKILL.md` — quality profile + change-risk
- `skills/policy-evaluation/SKILL.md` — policy / Skill change evaluation
- `skills/security-maintenance/SKILL.md` — framework advisory workflow

### Engineering / design
- `skills/engineering-decisions/SKILL.md` — decision precedence
- `skills/design-refinement/SKILL.md` — pre-implementation design refinement

### Runtime / recovery
- `skills/sandbox-runtime/SKILL.md` — per-worker isolated runtime
- `skills/worktree-workflow/SKILL.md` — Worktrunk / git worktree mechanics
- `skills/agent-recovery/SKILL.md` — durable recovery

### Communication
- `skills/writing-discipline/SKILL.md` — reader-facing prose pipeline
- `skills/interaction-discipline/SKILL.md` — active-work interaction discipline

### Design (general-purpose)

Web fundamentals / design-layout / animation-interaction の汎用 Skills。
Vendor-specific design system / media production 系は含まない
(`design-skills` upstream 47 件から 25 件選抜、 release-0-3-0)。

- `skills/design-intent/SKILL.md` — DESIGN-BRIEF 起点の design direction
- `skills/color-system/SKILL.md` — semantic color roles, light/dark
- `skills/typesetting/SKILL.md` — text rhythm, mixed-script, hierarchy
- `skills/layout-system/SKILL.md` — Marketing / Dashboard / Application / Swiss
- `skills/responsive-design/SKILL.md` — fluid / container query / breakpoint
- `skills/interaction-states/SKILL.md` — hover / focus / pressed / loading 等 state
- `skills/navigation-design/SKILL.md` — navigation model 選定
- `skills/iconography-system/SKILL.md` — icon family 設計
- `skills/motion-system/SKILL.md` — Marketing / Product UI / Navigation motion
- `skills/motion-audit/SKILL.md` — 既存 UI の motion 調査
- `skills/motion-implement/SKILL.md` — motion 実装
- `skills/motion-review/SKILL.md` — motion review
- `skills/token-audit/SKILL.md` — Panda CSS semantic-tokens 監査
- `skills/document-design/SKILL.md` — long-form paginated docs
- `skills/diagram-design/SKILL.md` — architecture / process diagram
- `skills/dark-mode-design/SKILL.md` — dark appearance 設計
- `skills/content-design/SKILL.md` — product / service content
- `skills/form-design/SKILL.md` — form flow 設計
- `skills/table-design/SKILL.md` — table / data grid
- `skills/accessibility-audit/SKILL.md` — accessibility 監査・修正
- `skills/cognitive-accessibility/SKILL.md` — 認知・学習障害への design
- `skills/inclusive-design/SKILL.md` — exclusion 検出 + 多様な参加経路
- `skills/high-contrast-design/SKILL.md` — high-contrast / forced-colors
- `skills/touch-interface/SKILL.md` — touch / coarse-pointer interaction
- `skills/keyboard-interface/SKILL.md` — keyboard interaction model

Architecture docs (`docs/architecture.md`), development docs
(`docs/development.md`), and release docs (`docs/release.md`) are the
canonical entry points for human contributors.

## 11. Out-of-scope at 0.1.0 (do not start)

- Product feature work (portfolio, content, activity, etc.)
- Tools submodule integration
- Webhook platform (beyond the `/webhooks/*` boundary contract)
- Personal Dashboard
- Multiple Workers / microservice split
- Coverage thresholds
- ESLint / Oxlint (Biome is sufficient at 0.1.0)

These are 0.2.0 / 0.3.0 work. The 0.1.0 goal is the foundation
release, not the feature release.
