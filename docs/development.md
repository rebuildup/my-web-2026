# Development

> How to bootstrap, run, test, and troubleshoot my-web-2026.

## Supported hosts

- macOS / Apple Silicon — first-class.
- Windows 11 + WSL2 — first-class.
- Linux / NixOS — first-class.
- Remote Linux sandbox (CI / paid providers) — first-class.

Docker Desktop is not a hard dependency. The local runtime is
selected by the operator at init time.

## Prerequisites

| Tool     | Version                          |
| -------- | -------------------------------- |
| Node.js  | 20.18+                           |
| pnpm     | 12.3.x (install directly, not via corepack — see ADR-0003) |
| Wrangler | `^4.131.0` (npm)                 |
| Git      | 2.40+                            |

## Bootstrap

```bash
git clone https://github.com/rebuildup/my-web-2026.git
cd my-web-2026
# corepack is forbidden in this repository; install pnpm directly:
npm install -g pnpm@12.3.4
pnpm install
pnpm prepare        # panda codegen
```

### Phase 1 / Issue #67 — Infisical + Cloudflare Workers Builds bootstrap

ADR-0015 §11 Phase 1 provisions the Infisical project, Machine
Identity, and Cloudflare Workers Builds credential binding. The
agent drives the flow via `pnpm` scripts; the operator only needs
to provide short-lived auth tokens in the shell environment.

**Prerequisites (operator one-time, per developer / CI runner):**

```bash
# Infisical self-host Universal Auth token (operator-scoped).
#   Run `infisical login` once; the CLI writes the short-lived
#   token to `INFISICAL_TOKEN` in the current shell.
infisical login

# Cloudflare user-scoped API token with the following two
# permissions (NOT the existing build pipeline token — this is a
# distinct user-scoped token used by the agent to discover + bind
# the production Workers Builds trigger):
#   - Workers Builds Configuration: Edit
#   - Workers Scripts: Read
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...   # from wrangler.production.jsonc#account_id
```

**Bootstrap flow (run in order; each is idempotent):**

```bash
# 1. Create the `my-web-2026` Infisical project + dev/prod envs,
#    write .infisical.json (workspaceId + defaultEnvironment).
pnpm run infisical:bootstrap:api

# 2. Create Machine Identity + Universal Auth + bind credentials to
#    the production Workers Builds trigger (in-memory secret
#    handling — client secret never touches disk / stdout / log).
pnpm run infisical:bootstrap:cf

# 3. Seed the dev env with the 3-name contract (random values).
#    PROD env is intentionally NOT seeded — operator imports the
#    current Worker `BETTER_AUTH_SECRET` + `MY_WEB_2026_CONSUMER_API_KEY`
#    plaintext via `infisical secrets set` manually, outside the
#    agent flow.
pnpm run infisical:seed

# 4. Fileless dev smoke (Windows-safe via Node spawn + shell:false).
#    Asserts all 3 contract keys are present in the dev env.
pnpm run infisical:verify
```

**Operator post-#67 work (NOT agent-automated; manual via Infisical
web UI or `infisical secrets set`):**

```bash
# Import current Cloudflare Worker `BETTER_AUTH_SECRET` plaintext.
infisical secrets set \
    --projectId="$(jq -r .workspaceId .infisical.json)" \
    --env=prod \
    BETTER_AUTH_SECRET=<current-worker-plaintext>

# Import current `MY_WEB_2026_CONSUMER_API_KEY` plaintext.
infisical secrets set \
    --projectId="$(jq -r .workspaceId .infisical.json)" \
    --env=prod \
    MY_WEB_2026_CONSUMER_API_KEY=<current-worker-plaintext>
```

**`BETTER_AUTH_SECRETS` for prod** is intentionally NOT seeded by
the agent. The versioned form activates only at the Phase 3+ flip
(separate production-side deploy ticket, human-gated per
`skills/github-delivery/SKILL.md` §Release PR merge human gate).

## Run

> **Secrets flow from Infisical, not from `.dev.vars`.** See
> [ADR-0015 §9](adr/ADR-0015-infisical-env-management.md) for the
> staged design. Local dev uses the dev environment of the
> Infisical project pinned by the committed `.infisical.json` in
> the repo root.

```bash
# Primary path — Windows-safe, fileless (no .dev.vars written).
# scripts/_run-dev.mjs spawns `pnpm exec infisical run --env=dev --
# pnpm exec vite dev` with shell:false. The CLI auto-resolves the
# project from .infisical.json; no --projectId needed.
pnpm dev
# -> http://127.0.0.1:3000

# Storybook (editorial visual-language preview, primitives, tokens)
pnpm storybook
# -> http://127.0.0.1:6006
```

### Fallback: `pnpm run generate:dev-vars`

Use the fallback when the Infisical CLI (`infisical` binary) is
unavailable on the workstation but **the self-hosted Infisical API at
`https://secrets.rebuildup.dev` is reachable AND a currently valid
`INFISICAL_TOKEN` is exported**. The fallback is **not** an offline
path — it still requires network access to the Infisical API and a
non-expired operator token — and it is **not** a CLI replacement for
operators who cannot meet those preconditions (use the primary
`pnpm dev` path instead, once `infisical login` succeeds).

The fallback script `scripts/generate-dev-vars.mjs` fetches the
keys listed in `wrangler.jsonc#secrets.required` via the documented
REST API and writes them to the gitignored `.dev.vars` (NOT the
committed `.dev.vars.example` documentation template):

```bash
# Operator supplies a short-lived Universal Auth token
export INFISICAL_TOKEN="<token>"
# Optional override (default: https://secrets.rebuildup.dev)
# export INFISICAL_API_URL="https://..."

pnpm run generate:dev-vars         # writes .dev.vars (mode 0600)
pnpm run generate:dev-vars -- --dry-run   # plan only, no file
```

The fallback ALWAYS mirrors exactly `wrangler.jsonc#secrets.required`
(it does not widen the set to match the full dev env seen by the
primary path). The current source-controlled contract is the
**versioned 2-name form**:

```jsonc
// from wrangler.jsonc#secrets.required
"BETTER_AUTH_SECRETS",
"MY_WEB_2026_CONSUMER_API_KEY"
```

`BETTER_AUTH_SECRET` (legacy single-secret form) is NOT in
`secrets.required`; it is retained in Infisical `prod` as an audit
trail (ADR-0015 §9 audit-only semantics) but is never uploaded to
the Worker — see `scripts/run-deploy-inner.mjs#AUDIT_ONLY_SECRETS`
for the deploy-time contract that prevents the legacy binding from
resurrecting on subsequent deploys. The legacy → versioned migration
is the production-side Phase B work (Issue #89), gated per
[`docs/runbook/cloudflare-workers-builds.md`](runbook/cloudflare-workers-builds.md).
Local `generate:dev-vars` does NOT need Phase B to run to function;
it always reads the current `secrets.required`.

`.dev.vars` is gitignored, written atomically (temp + rename, with
rollback on failure), and constrained to
`wrangler.jsonc#secrets.required` — anything else in Infisical is
silently ignored. The script never logs the secrets themselves; it
prints only key names + counts. After running the fallback,
`pnpm dev` continues to work (Infisical remains the primary path;
`.dev.vars` is only consulted by direct `wrangler dev` invocations).

### Local API mock layer (`LOCAL_API_MODE=mock`, Issue #166 / #186)

For visual verification against canned data — empty D1, no live
session, designer-driven UI screenshots — set `LOCAL_API_MODE=mock`
in the gitignored `.dev.vars` next to this README:

```bash
echo 'LOCAL_API_MODE=mock' >> .dev.vars
pnpm dev
```

The activation gate at `src/http/hono.ts` checks
`c.env.LOCAL_API_MODE === 'mock'` and forwards `/api/v1/*` to the
canned-data sub-app at `src/http/mock/`. The eight served endpoints
are `auth.session` / `auth.sign-in/email` / `auth.sign-out`,
`access.count` / `access.hit` / `access.principal`,
`reactions/:slug` / `reactions/:slug/toggle`. Anything outside that
set (portfolio, keys, emoji-catalog, auth-invitations) falls through
to the real routers even in mock mode.

**Why a vite-plugin override is needed.** `LOCAL_API_MODE` is
intentionally NOT in `wrangler.jsonc#vars` (production must never see
it) and NOT in `wrangler.jsonc#secrets.required` (it is not a secret
and adding it would widen the deploy-time required-secret contract).
Wrangler's `getVarsForDev` therefore filters `.dev.vars` entries down
to `vars ∪ secrets.required`, which means a plain
`LOCAL_API_MODE=mock` in `.dev.vars` would never reach `c.env` and
the gate would silently fall through. The fix is a `config()` callback
on the `cloudflare()` plugin in `vite.config.ts` that reads `.dev.vars`
once at config-load time and merges `LOCAL_API_MODE` (only) into
`workerConfig.vars`. Once the key lives in `vars`, the same wrangler
filter lets it through as a plain-text binding, and the gate fires.
The passthrough is opt-in: when `.dev.vars` is absent or carries no
`LOCAL_API_MODE` entry, the callback returns `undefined` and the
production boundary runs unchanged.

**Smoke verification (manual):**

```bash
pnpm dev &                              # start the dev server
curl -s http://127.0.0.1:3000/api/v1/access/count
# → {"count":1234}
curl -s http://127.0.0.1:3000/api/v1/reactions/home-page
# → {"reactions":[{"emoji":"👍","count":12}, …]}
curl -s -X POST http://127.0.0.1:3000/api/v1/access/hit \
  -H 'Content-Type: application/json' -d '{}'
# → {"incremented":true,"count":1235,"first_hit":1700000000000,"last_hit":1700000000000}
```

The gate's `LOCAL_API_MODE` check is strict-equality against the
literal string `"mock"`. Any other value (unset, empty, `on`, `1`,
`off`) routes through to the real production handlers — the mock
layer is the surgical opt-in, never the default.

**Calling the write endpoints directly in dev.** With the mock gate
off, `/api/v1/*` writes go through `csrfGuard`
(see [`docs/security.md`](security.md#csrf)), which requires a
same-origin signal. A `curl` therefore has to declare the origin it
is calling:

```bash
curl -s -X POST http://127.0.0.1:3000/api/v1/access/hit \
  -H 'Authorization: Bearer …' \
  -H 'Origin: http://127.0.0.1:3000' \
  -H 'Content-Type: application/json' -d '{}'
# without -H 'Origin: …' → 403 {"error":"csrf_rejected","reason":"origin_check_missing"}
```

Reads need no header. The first-party server functions are unaffected:
they self-call the boundary with the origin they are calling (see
`src/home/{access,reactions}/load.ts`).

**Regression tests:**

- `src/http/hono.test.ts` — the gate against the real
  `externalBoundary` (env=mock returns canned body; env unset or any
  other value falls through).
- `scripts/_dev-vars-reader.test.mjs` — the `.dev.vars` parser +
  override-builder (12 unit tests).

`LOCAL_API_MODE` MUST NOT be added to `wrangler.jsonc#vars` or
`secrets.required` — both widen the production deploy contract. The
canonical location for the flag is `.dev.vars` only.

## Validate

```bash
pnpm run validate:fast         # read-only gate chain (see quality/profile.yaml for the ordered component list)
pnpm run validate:integration  # + build + bundle budget + wrangler:dry-run + lint:ci + build-storybook
pnpm run validate:release      # + cf-typegen:check
```

`validate:fast` には UI copy の locale 契約検査 `pnpm run copy:i18n:check` も含まれる
(下記「UI copy の locale 契約」参照)。

`pnpm run compat:check` は Web API / CSS の採用可否を Baseline（web-features）で
判定する gate（Issue #414）。走査面は `src/**` に加えて生成 CSS の入力である
`panda.config.ts`（`app-shell` surface の `files`）で、`src/` 以外のファイルは
surface に明示しない限り走査されない。バー未満の採用は fallback 要件が明示され
evidence が検証できた場合のみ warning、fallback 宣言が無い採用は fail。定義は
`quality/browser-baseline.json`、詳細は
[`docs/verification/standards/browser-baseline.md`](verification/standards/browser-baseline.md)。

`pnpm run compat:stress:check` measures a static fixture that mirrors the
shipped layout language at the narrowest supported viewport (320px) with a
scrollbar forced into play (Issue #416).
On a host that paints overlay scrollbars (macOS Chromium, reserved gutter
0px) the gutter half of the gate degrades to a recorded
`gutter_not_observable` warning rather than a pass — see
[`docs/verification/compat/stress-story.md`](verification/compat/stress-story.md).
It is a standalone static fixture — no Worker, no route, no dev server — and
every run also measures three deliberately broken variants of the same document
so the detector has to catch them by name; a surviving control exits 2 rather
than passing. Chromium is required (`pnpm run e2e:install`), so this gate is
NOT part of `validate:fast` (offline / read-only / cheap by contract); its pure
half runs in CI through `scripts/check-layout-stress.test.mjs`, which is wired
into `pnpm run test`. Details and the last report are in
[`docs/verification/compat/stress-story.md`](verification/compat/stress-story.md).

`pnpm run css:check` は出荷 CSS（Panda が `panda cssgen` で生成するシートと
`src/**/*.css`）を CSS Syntax parser とレビュー済み vocabulary で検証する
gate（Issue #413）。構文エラー・未知 property / at-rule / value function・
プロパティ文法外の keyword は fail し、vendor prefix は prefix 無し側が仕様定義済みの
ときだけ、`engine 固有プロパティ` は名前・理由・basis URL・surface スコープを持つ
allowlist エントリだけを受理する（何も抑止していないエントリも fail）。
`compat:check` が「対象ブラウザで動くか」を答えるのに対し、こちらは
「parsable か・名前が存在するか」を答える。定義は `quality/css-standards.json`、
詳細は
[`docs/verification/standards/css-validated.md`](verification/standards/css-validated.md)。

CI (`.github/workflows/ci.yml`) runs `validate:integration` from the
`validate` job on every PR and every push to `main` / `release-*`.
The same job also installs the Playwright Chromium binary and runs
the E2E suite against `pnpm dev`.

## Route bundle budget (Issue #482)

`pnpm run bundle:budget:check` measures the **initial JS and CSS bytes** of
every route from the Vite build, and fails `validate:integration` when a route
outgrows its cap.

```bash
pnpm run build               # vite build writes dist/client/bundle-graph.json
pnpm run bundle:budget:check # per-route table + PASS/FAIL
pnpm run bundle:budget:check -- --json --report=.tmp/bundle-budget.json
pnpm run bundle:budget:check -- --html=.tmp/bundle-budget.html
```

It reads the chunk graph the `my-web-2026:client-bundle-graph` Vite plugin
emits during the client build. For each route in `src/routeTree.gen.ts` it sums
the client entry chunk, the transitive **static**-import closure of that
route's chunk, and the chunks of its **layout ancestors** (`/admin/keys`
renders inside `/admin`'s layout, which is a separate chunk the child's own
closure does not import). Dynamic imports are never charged to first paint.
When a route file owns more than one chunk — TanStack Start splits a route's
component from its not-found component — the `component` split is the one
measured, chosen by an explicit rank rather than by the order the bundler
happened to emit the chunks in.

`--json` writes exactly one JSON document to **stdout**; every human status
line goes to stderr, so `pnpm run bundle:budget:check -- --json | jq` works.
`--report=` and `--html=` create their parent directory, so the `.tmp/` paths
above work on a fresh checkout where `.tmp/` does not exist yet.

Sizes are **byte lengths of the emitted files**, read back from disk after
Rollup flushed them — not JavaScript string lengths, and not the pre-finalize
copy. That matters twice: a chunk carrying a Japanese literal is larger on disk
than `code.length` suggests, and Vite's `build-import-analysis` rewrites
`chunk.code` *after* an ordinary user plugin's `generateBundle` runs (it is
what injects the preload marker and dependency map). A budget gate that
undercounts its own artefacts could pass a real over-cap file, so the graph
plugin runs in post order from `writeBundle`
(`vite.config.ts` → `scripts/_client-bundle-graph.mjs`).

An acknowledged `exception` keeps the run green while the bundle is still above
its cap, so the HTML report lists every exception with its measurement, cap,
overage and reason instead of only printing the violations.

Numbers live in [`quality/bundle-budget.json`](../quality/bundle-budget.json);
the gate records its reproduction conditions (no browser, no network, no CPU
dependence, and the measured commit SHA) both in that file and in
`quality/profile.yaml`.

Three things this gate is **not**:

- It is not a Lighthouse score gate (Issue #384 measures, #385 thresholds).
- It is not a Core Web Vitals / LCP / CLS budget (Issue #386).
- It is not a rendering-speed measurement of any kind. It counts shipped bytes.

Tool bundles under `/tools/<slug>/app/**` are independent Vite builds loaded in
a sandboxed iframe, so they are aggregated and capped separately — a heavy Tool
cannot hide behind a host route's budget.

Accepting an overage needs a reason:

```json
"/tools/": {
  "initial_js_bytes": 1560000,
  "initial_css_bytes": 40000,
  "exception": {
    "metric": "initial_js_bytes",
    "reason": "Why this route knowingly ships more, and what will remove it."
  }
}
```

An exception without a reason of at least 20 characters is a configuration
error and fails the gate. So is a new route with no budget entry: routes come
from the generated tree, so forgetting the budget fails loudly instead of
silently shipping an uncapped page. `tool_iframe` is required for the same
reason — deleting the section would turn the Tool cap off without a word.

Raising a cap is **not** machine-checked. The gate compares numbers; it does
not compare a cap against the previous cap, so a PR that multiplies
`initial_js_bytes` gets a green run. What holds the line is review: a cap
change is a one-line diff in `quality/bundle-budget.json`, and the PR that
makes it is expected to state the new measurement, the delta, and what caused
it. An `exception` is the only mechanism that survives that review on its own
merits, because the gate itself refuses an unreasoned one.

Two workflow gates exist because they answer different questions:
`lint:ci` (actionlint) owns YAML syntax, and
[`ci:pins:check`](security/supply-chain-actions-pinning.md) owns the
Actions supply chain — pinned commit SHAs, least-privilege job
tokens, and the rule that CI can neither read a secret value nor
deploy production or publish a Release.

`validate:fast` additionally runs `pnpm run install:scripts:check`,
the dependency install lifecycle script audit (Issue #474). It fails
when an installed dependency can execute code during `pnpm install`
(a `preinstall` / `install` / `postinstall` hook, the implicit
`node-gyp rebuild` of a package that ships `binding.gyp`, or the
`prepare` of a git-hosted dependency) that the reviewed policy in
`quality/install-scripts.json` has no record for, or when that record
and pnpm's execution allow-list (`pnpm-workspace.yaml`) disagree. See
[`docs/runbook/install-script-audit.md`](runbook/install-script-audit.md).

### Route × quality-gate coverage

The published route roster and the quality gates that measure it are
kept in sync by a cheap gate that runs inside `validate:fast`:

```bash
pnpm run routes:quality:check  # quality/route-coverage.json vs src/routes/**
pnpm run routes:quality:report # .tmp/route-quality-report.html (no browser needed)
```

Adding a route file without a `quality/route-coverage.json` entry fails
the gate on purpose: the PR must add the route as a gate target, or
exclude it with a reason for every gate family. See
[`docs/verification/quality/route-quality-coverage.md`](verification/quality/route-quality-coverage.md).

## Storybook

Storybook 8.6.x previews the visual obligations that currently exist in source.
The shipped public surface uses `src/editorial/`: raw / semantic tokens plus
the current editorial primitives. New primitives are added only when that
visual language owns the requirement.

Stories stay next to their owner (for example
`src/editorial/primitives/<Name>.stories.tsx`).

```bash
pnpm storybook           # dev server on :6006
pnpm run build-storybook # static build to ./storybook-static
```

`build-storybook` is part of `validate:integration`. The static
output is gitignored.

### Story ownership gate (#509)

A story is feature-local UI: it renders a component with props, so its
runtime import closure must stay inside the obligation that owns it.
`pnpm run storybook:ownership:check` walks every story the `stories`
globs in `.storybook/main.ts` actually match — the walk starts from
each glob's non-glob prefix, so a story declared outside `src/` is a
subject too — and fails when the closure reaches a foreign boundary:

| Boundary | Why it is foreign for a preview |
| --- | --- |
| `src/routes/**` | route contract — pulling it in drags the whole app graph |
| `src/server.ts` | Worker entrypoint |
| `src/http/**` | external HTTP boundary (Hono) |
| `src/cloudflare/**` | owns the bindings; a preview has none |
| `cloudflare:workers` | Workers virtual module — does not resolve in a browser |

Excluded on purpose, and reported as `not applicable` in the output:
the four boundary *paths* above (they are the rule's targets, not its
subjects — a story living inside one is listed there too, not counted),
`import type` and `import { type A } from` edges (both erased by
`verbatimModuleSyntax`, AGENTS.md §3; a clause that still binds one
runtime name stays a runtime edge), npm packages, the generated
`styled-system/` layer and static assets. A *source* file outside
`src/` is not a leaf — it is walked like any other module, so an
external story cannot reach a boundary through a sibling helper; an
unresolvable path outside `src/` is printed as `external`).
`cloudflare:workers` is not a path, so it appears as a violation and
under known limitations instead.

The walk reads imports off a masked copy of each module — comments,
string literals and template text are blanked first — so a story that
*shows* an import example is not read as an edge, and an import-shaped
comment is not read as a **server-function seam** that would stop the
walk. The same mask reads the `stories` globs, so a commented-out
`stories: [...]` above the real config cannot become the subject set. A
template literal without an interpolation stays readable as a
placeholder, because `import(`../x`)` names a real specifier, and a `/`
that follows a keyword (`return /['"]/.test(x)`) is read as a regular
expression rather than a division. Inside a server-function seam (a
module that value-imports `createServerFn`) the walk stops **inside a
`.handler(…)` body and nowhere else**, because that body is what the
start compiler plugin removes from the client build. Every other edge
of the module — a module-level `import { env } from
'cloudflare:workers'`, a side-effect import, an `export … from`
re-export — is evaluated when the module loads, so it is walked
whichever export the story asked for. Narrowing a module-level edge by
the bindings a story imports is unsound: a module can bind `env` at
module level, read it only inside the handler, and still be pulled
into the preview by a story that imports nothing but its export types.
So server-only bindings are resolved with `await import(…)` **inside**
the handler body (`src/home/reactions/load.ts`,
`src/admin/emoji-catalog/load.ts`), and a dynamic `import()` outside
every handler body is walked even when no export reaches the
declaration that holds it. The seam edge itself is printed as `seam`,
not hidden. The factory is found under whatever local name the module
imports it as (`import { createServerFn as serverFn }`), a
regular-expression literal is consumed whole including its terminating
slash and flags, a space or comment between `import` and `(` is
allowed, and an import shape — an alias, a namespace import, a default
import, a barrel re-export — is only another hop in the chain the
report prints.

```bash
pnpm run storybook:ownership:check
pnpm run storybook:ownership:check -- --json=.tmp/storybook-ownership.json
```

`--json=<path>` creates the parent directory, so the documented
`.tmp/…` path works on a fresh checkout.

Exit codes: `0` every subject passed, `1` at least one foreign-boundary
reach, `2` a subject could not be fully resolved or the subject set
could not be read (`not run` — reported as NOT a pass, so an incomplete
walk, a glob outside the repository and a non-literal `stories` entry
can never be mistaken for green). When the subject set is empty the
message says whether no story matched the globs or every match was
excluded as living inside a foreign boundary. The gate is wired into
`validate:fast`, and `scripts/check-storybook-ownership.test.mjs` covers
it with pass / fail / not-run / not-applicable fixtures.

Known limitations are printed with the report. The one to remember
when adding code: only the `~/` alias is resolved, so an alias-shaped
specifier (`@/…`) reads as an external package and would hide a
boundary behind it — add the alias to the checker when it is added to
the bundler config.

The `docs/verification/platform/storybook-ownership-check.webp`
screenshot in #576 is a rendering of this gate's text report; re-create
it from `--json` output, the gate itself needs nothing but the command
above. Issue #509 names a `.png` for this screenshot; the repository
ships it as `.webp` at the same path stem under the WebP policy / #452
precedent, and the intermediate PNG is not committed. Whether the
Issue path should be amended to `.webp` or a `.png` should also be
added is an owner decision, recorded as an open item in the PR body
(the same substitution is already stated for
`docs/verification/perf/bundle-map.webp` above).

## Playwright E2E

Playwright 1.63.x covers the deployed Worker smoke. Three surfaces
exist:

- `pnpm run e2e` runs `e2e/smoke.spec.ts` against `pnpm dev`
  locally (default) or any deployed URL via `PLAYWRIGHT_BASE_URL`.
- `pnpm run e2e:prod` runs `e2e/prod-smoke.spec.ts` against the
  canonical production URL `https://rebuildup.dev` (Issue #43 /
  ADR-0014). Operator-initiated only — never gated by regular CI.
  In Smoke #2 (`pnpm run e2e:prod`, POST-deploy) it also registers the
  five representative routes (`/`, `/about`, `/portfolio`, `/tools`,
  `/api/v1/health`) and checks each one's HTTP response, short
  navigation path, and documented default state, read-only. Smoke #1
  (`pnpm run e2e:prod:transition`) skips them: it runs PRE-merge, while
  production still serves the previous `main` build and the registry is
  release-branch data.
- `pnpm run e2e:prod:local` runs the same spec file against the LOCAL
  preview build (`http://127.0.0.1:3000`), so the Issue #500
  representative-route contract is reproducible offline. It builds the
  working tree first and forces the localhost origin even if the parent
  shell exported a production `PLAYWRIGHT_BASE_URL`; the Issue #43
  canonical-origin group (which hardcodes the canonical origin, including
  the one deliberate write, the anonymous reaction mutation) skips itself
  in local mode, and subresource requests to any other origin are aborted
  before navigation.
- `pnpm run e2e:compat` runs `e2e/compat/**` on Chromium, Firefox and
  WebKit — see [Cross-engine compat matrix](#cross-engine-compat-matrix).
- `pnpm run e2e:viewport` runs `e2e/viewport/**` on Chromium at four
  viewport widths — see [Viewport regression grid](#viewport-regression-grid).

```bash
pnpm run e2e:install     # one-time: chromium browser + system deps
pnpm run e2e             # run smoke.spec.ts; auto-starts pnpm dev locally
# Production smoke (Issue #43 / ADR-0014):
pnpm run e2e:prod        # runs prod-smoke.spec.ts against https://rebuildup.dev
# Offline rehearsal of the Issue #500 representative-route contract:
pnpm run e2e:prod:local  # same spec file against http://127.0.0.1:3000
```

The E2E suite asserts the four public surfaces documented in
`docs/architecture.md`:

- `GET /` (200, SSR HTML)
- `GET /api/v1/health` (200, `{status:'ok',...}`)
- `GET /api/v1/db/ping` (200, `{one:1,...}` against the D1 binding)
- `GET /api/v1/media/ping` (404, `key_not_found` against the R2 binding)
`playwright.config.ts` ignores every `prod-*.spec.ts` when
`PLAYWRIGHT_BASE_URL` points at localhost, so `pnpm run e2e` can never
reach the canonical production origin. The single documented exception is
`pnpm run e2e:prod:local`, which builds first, sets
`E2E_LOCAL_PROD_SMOKE=1`, and forces the base URL to localhost. The
production representative-route
contract is DATA in `scripts/prod-smoke-routes.mjs`; its pass/fail
classifier `auditRoute()` is unit-tested offline by
`scripts/prod-smoke-routes.test.mjs` (wired into `pnpm run test`), so the
smoke logic is verified without a network, without workerd, and without a
browser. Each observation carries the final (post-redirect) origin and
pathname, and the classifier rejects either kind of drift, so a route that
answered from another host cannot pass as a healthy canonical origin.

## UI copy の locale 契約

visitor-facing copy がどの言語で公開されているかは
[`copy/resources.json`](../copy/resources.json) が宣言し、
`pnpm run copy:i18n:check` (`scripts/check-copy-i18n.mjs`) が検査する。
`validate:fast` の一部として CI でも走る。

検査するのは「その locale で未翻訳のキー」「feature が登録していないキーを名指ししている
リソース」「source locale に到達できない fallback 連鎖」、そして原文の意味を守るための
機械判定 (数値 / `{placeholder}` / 否定 / 権限マーカー / 禁則・full-width 残留) である。
locale は機能ごとに opt-in なので、全機能に全言語を要求しない — 未 opt-in の locale は
情報として記録されるだけで失敗にしない。

文の語調・敬称・語順 (prose quality) は gate が判定しない。`prose: "verified"` は
原文と突き合わせた人が記録する主張であり、`published` locale では未検証の状態で
公開できない。推敲途中のリソース (`status: "draft"`) は解決時に fallback され、
`served` されない。

```bash
pnpm run copy:i18n:check                       # gate (exit 1 で失敗)
node scripts/check-copy-i18n.mjs --format=html --out=.tmp/copy-i18n.html
node scripts/check-copy-i18n.mjs --include-fixture --format=html \
  --out=.tmp/missing-keys-report.html          # fixture 込みのレポート (fixture は gate しない)
node --test scripts/check-copy-i18n.test.mjs   # fixture で finding class を検証
```

契約の意味、schema、2 番目の locale を opt-in する手順は
[`copy/README.md`](../copy/README.md) を参照。

## Cross-engine compat matrix

Issue #415 added a second Playwright configuration that runs the
public UI contract on Chromium, Firefox and WebKit at once. It is
separate from the default `pnpm run e2e` config on purpose: the default
config is the chromium-only required gate, and multiplying it by three
engines would triple that gate while answering a different question.

```bash
pnpm run build                  # vite preview serves the built Worker
pnpm run e2e:compat:install     # chromium + firefox + webkit binaries
pnpm run e2e:compat             # run e2e/compat/** on all three engines
pnpm run verify:compat-screenshot  # render the matrix + write the WebP
```

| Path                              | What it is                                        |
| --------------------------------- | ------------------------------------------------- |
| `playwright.compat.config.ts`     | 3 projects + JSON reporter; spreads the base config so `baseURL`, the local D1 `webServer` and `globalSetup` are inherited |
| `e2e/compat/contract.ts`          | closed public landing-route roster + observe/judge pair |
| `e2e/compat/public-ui.spec.ts`    | route display contract + basic operations         |
| `e2e/compat/negative-control.spec.ts` | deliberate breakage, rejected by the same judge |
| `.tmp/compat-results.json`        | Playwright JSON report (matrix source)            |
| `.tmp/compat-screenshots/`        | per-engine, per-route captures (matrix source)     |
| `.tmp/compat-matrix.html`         | rendered engine x test matrix                     |
| `playwright-report/`              | Playwright HTML report (CI only, uploaded for failure inspection) |
| `docs/verification/compat/browsers-matrix.webp` | committed verification screenshot       |

CI runs the same command from `.github/workflows/compat.yml` (push to
`main` / `release-*`, every PR into them, and `workflow_dispatch`) and
uploads the matrix plus the raw report as artefacts. The workflow's
`runner` input exists so a host-dependent engine behaviour can be
measured on `macos-latest` as well as `ubuntu-latest`.

How a failure is kept visible
-----------------------------

- **One engine, one red cell.** The matrix is engine x test, so a
  WebKit-only regression never collapses into "the suite passed".
- **SKIP is not PASS.** A skipped test renders as `SKIP`, and a retry
  that only passed on the second attempt renders as `FLAKY`.
- **Uncovered routes are reported.** A roster route with no executed
  test is listed in its own band instead of being folded into a pass,
  and the report script exits non-zero while that band is non-empty.
- **A degraded run cannot replace the evidence.** If no engine binary
  can be launched, the report script refuses to overwrite the
  committed WebP instead of recording an all-`unavailable` matrix.

- **The gate is shown to fail.** `negative-control.spec.ts` feeds the
  same judge three broken fixtures, an unimplemented route, and one
  real page, and asserts that each is rejected by the rule that owns
  it while the real page still passes.

The roster is specifically the public *landing* routes. Detail
surfaces (`/portfolio/$slug`, `/tools/$slug`) are not part of the
shell / display contract this gate holds.

Recorded OS / engine differential
---------------------------------

The keyboard-reachability step of the skip-to-content link is skipped
on WebKit: headless WebKit never moves sequential focus off `BODY` —
not on the first Tab, not after a click, not after five stops — on any
page, while Chromium and Firefox reach the first link on the first Tab.
It reproduces on both hosts this repository runs on (the
`ubuntu-latest` CI runner and a local macOS runner), so it is a
property of the WebKit build under automation rather than of
my-web-2026. The traversal check is therefore skipped there instead of
being weakened everywhere; the skip-link contract itself (the link
exists and its `#main` target resolves) is still asserted on WebKit by
`assertRouteContract`. The matrix shows the cell as `SKIP`.

## Viewport regression grid

Issue #417 added a third Playwright configuration that answers the
layout question the other two do not: the same surface still lays out
correctly at **390 / 768 / 1024 / 1440** (phone, tablet portrait,
tablet landscape, laptop). The engine axis belongs to the compat suite
and the "does it render at all" axis belongs to the default suite, so
this one is separate from both and excluded from both via `testIgnore`.

```bash
pnpm run build                  # vite preview serves the built Worker
pnpm run e2e:install            # chromium binary
pnpm run e2e:viewport           # run e2e/viewport/**
pnpm run verify:viewport-diff-grid  # render the grid + write the WebP
```

| Path                                    | What it is                                        |
| --------------------------------------- | ------------------------------------------------- |
| `playwright.viewport.config.ts`          | chromium project, `deviceScaleFactor: 1`, JSON reporter; spreads the base config so `baseURL`, the local D1 `webServer` and `globalSetup` are inherited |
| `e2e/viewport/contract.ts`               | closed route × viewport roster + observe/judge pair |
| `e2e/viewport/layout.spec.ts`            | the gate: 4 routes × 4 widths, capture + judge      |
| `e2e/viewport/visual-diff.spec.ts`       | stability / breakage / viewport-shift pixel controls |
| `e2e/viewport/negative-control.spec.ts`  | deliberate breakage, rejected by the same judge     |
| `scripts/_viewport-diff.mjs`             | the shared pixel-diff contract (thresholds + overlay) |
| `.tmp/viewport-results.json`             | Playwright JSON report (grid source)                |
| `.tmp/viewport-cells/`                   | per-cell layout fingerprints (numbers shown in the grid) |
| `.tmp/viewport-controls/`                | the three visual-diff control records               |
| `.tmp/viewport-screenshots/`             | per-cell and per-control captures                   |
| `docs/verification/compat/viewport-diff-grid.webp` | committed verification screenshot       |

CI runs the same command from `.github/workflows/viewport.yml` (push to
`main` / `release-*`, every PR into them, and `workflow_dispatch`) and
uploads the grid plus the raw report as artefacts. The workflow's
`runner` input exists so a host-dependent layout measurement can be
re-measured on `macos-latest` as well as `ubuntu-latest`.

How a failure is kept visible
-----------------------------

- **One cell, one state.** The grid is route × viewport, so a single
  narrow-width regression is a single red cell rather than a collapsed
  total.
- **SKIP is not PASS**, and a retry that only passed on the second
  attempt renders as `FLAKY`.
- **The measured numbers travel with the badge.** Every cell prints
  the overflow, the body font size and the nav mode the judge asserted,
  so the badge is auditable without opening logs.
- **Uncovered cells are reported.** A roster cell with no executed test
  is listed in its own band, and the report script exits non-zero while
  that band is non-empty.
- **Rows outside the grid are listed too**, so a failing negative
  control cannot hide behind a green grid.
- **The gate is shown to fail twice.** `visual-diff.spec.ts` proves the
  pixel layer goes red on an injected layout break (and that the
  geometry judge rejects the same page), and `negative-control.spec.ts`
  proves the judge rejects four broken fixtures, an unimplemented
  route, and nothing on the real page.
- **The diff harness is shown to be quiet.** Re-capturing an unchanged
  page must produce a 0-pixel difference; a harness that reports a
  change for an unchanged page is a harness nobody can read.

Why no committed pixel baseline
-------------------------------

Both sides of every comparison are produced by the same browser build
in the same run, so a non-zero diff is attributable to the page.
Committing a baseline captured on one host and comparing it against
another host's capture would measure font rasterisation instead of
layout — the false-positive failure mode this Issue forbids. Pinning a
single capture environment (a container image plus one Playwright build)
so committed baselines become possible is recorded as an open decision
on Issue #417 rather than half-implemented here.

## Bundle map (Issue #483)

`pnpm run verify:bundle-map` renders a **report** about an emitted client
build: which chunks each route loads and what they cost, which chunks are
duplicated, which are unreachable, and whether any host route pulls in the
Tool artifacts under `tools/**`. It reads the build output only — no
network, no Cloudflare API, no production read — and it is wired into no
`validate:*` entry point, so it can never block a build or a release.
`quality/profile.yaml#diagnostic_entry_points` records the same contract.

```bash
pnpm exec vite build                                   # emit the client build
node scripts/build-tools.mjs                           # Tool artefacts
node scripts/sync-cf-build-output.mjs                 # copy them into Build Output
node scripts/e2e-local-bootstrap.mjs --port=3000       # preview server (terminal 1)
pnpm run verify:bundle-map -- --base-url=http://127.0.0.1:3000
```

Without `--base-url` the script still runs a static pass over the emitted
files; the route matrix and the Home Tool-isolation finding need the
measurement and are reported as not measured.

The committed snapshot lives at
[`docs/verification/perf/bundle-map.md`](../docs/verification/perf/bundle-map.md),
with its screenshot at `docs/verification/perf/bundle-map.webp`
(Issue #483 names a `.png`; the WebP substitution is stated in the PR body).
Regenerate both when the client chunking changes.

## Format and lint

```bash
pnpm run format         # biome format --write (mutating)
pnpm run format:check   # read-only
pnpm run lint:check     # biome lint (read-only)
```

Validation gates only ever invoke `format:check` and `lint:check`.
The write-style `format` script is for local developer use, not CI.

## Cloudflare bindings

Edit `wrangler.jsonc` to add or change a binding, then:

```bash
pnpm run cf-typegen
```

Commit the regenerated `worker-configuration.d.ts` in the same PR.
See [ADR-0004](adr/ADR-0004-cloudflare-services-policy.md) for the
"purpose-based service selection" rule and the deferred services
list.

## Tests

Two test locations under a single Vitest config (workerd pool):

- `src/**/*.{test,spec}.{ts,tsx}` — Hono unit smoke
  (`src/http/hono.test.ts`).
- `test/integration/**/*.{test,spec}.{ts,tsx}` — D1 / R2 SELF smoke
  using `@cloudflare/vitest-plugin` `SELF` helper.

Run them:

```bash
pnpm test
```

## Public-route head metadata gate

Issue #418 added a gate over the `<head>` of every public route:
title / description / canonical for the indexable surface, a
`noindex` policy for `/admin/*`, a no-canonical policy for 404
documents, and a query-free canonical for search-query URLs.

```bash
# CI gate (runs inside `pnpm run validate:fast` via `pnpm test`):
pnpm exec vitest run test/integration/seo-head.test.ts

# Point the same policy at any origin (dev server, vite preview, …):
pnpm run seo:head:check -- --live http://localhost:5173
pnpm run seo:head:check -- --live http://localhost:5173 --html .tmp/seo-head-report.html

# Regenerate the verification screenshot:
pnpm run verify:seo-head-screenshot
```

The policy lives in `scripts/seo-head-contract.mjs`; the CI test and
the `--live` CLI are two front-ends over that one engine. The route
inventory is the framework's own route tree, so a new route without
description / canonical metadata fails the gate instead of quietly
passing (the root layout's fallback title means a route that forgot
its own title is caught as a duplicate title, not as a missing one).
A request that errored is a finding too — an unfetched route is never
a pass. Details and the last report are in
`docs/verification/seo/head-metadata-check.md`.

## Generated artefacts

| Path               | Source                                   | Gitignored |
| ------------------ | ---------------------------------------- | ---------- |
| `dist/`            | `pnpm build`                             | yes        |
| `dist-cloudflare/` | `pnpm run wrangler:dry-run`              | yes        |
| `styled-system/`   | `pnpm prepare` (panda codegen)           | yes        |
| `storybook-static/`| `pnpm run build-storybook`               | yes        |
| `playwright-report/` | `pnpm run e2e`                        | yes        |
| `test-results/`    | `pnpm run e2e` (failure artefacts)      | yes        |
| `node_modules/`    | `pnpm install`                           | yes        |
| `.biome/`          | `pnpm run format` (cache)                | yes        |
| `.wrangler/`       | `wrangler dev`                           | yes        |
| `.tmp/compat-*/`  | `pnpm run e2e:compat` (matrix artefacts)   | yes        |
| `.tmp/viewport-*/` | `pnpm run e2e:viewport` (grid artefacts) | yes        |
| `.tmp/`            | temporary research                       | yes        |
| `.reference/`      | external clones                          | yes        |

## Adding a Cloudflare binding

1. Open a GitHub Issue describing the feature and the binding.
2. Add the binding to `wrangler.jsonc` in the same PR.
3. Run `pnpm run cf-typegen` and commit `worker-configuration.d.ts`.
4. Add a handler under `src/http/hono.ts` (or a new
   `src/http/<name>.ts` if the surface grows).
5. Document the new binding in [docs/architecture.md](architecture.md).
6. Add an ADR if the binding introduces a new Cloudflare service
   (see [ADR-0004](adr/ADR-0004-cloudflare-services-policy.md)).

## Troubleshooting (quick reference)

| Symptom                                  | Likely cause / fix                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm install` warns `Ignored builds`   | Check `pnpm-workspace.yaml` `allowBuilds` / `onlyBuiltDependencies`.     |
| `wrangler types` regenerates stale      | Run after every binding change. Commit the diff.                         |
| `pnpm prepare` produces empty            | Run after editing `panda.config.ts`.                                     |
| `vite build` fails on `breakpoints`      | Panda breakpoint format: `'640px'`, not `{ value: ... }`.                |
| Hono path not intercepted               | Add the prefix to `EXTERNAL_BOUNDARY_PREFIXES` in `src/server.ts`.       |
| Port `3000` already in use               | Override with `--port` or change `vite.config.ts`.                       |
| vitest can't find `cloudflare:test`      | Ensure `vitest.config.ts` includes `tanstackStart()` so virtual modules resolve. |
| `validate:*` re-runs `format` (write)   | Should not happen — check `package.json` scripts use `format:check`.     |

See [docs/troubleshooting.md](troubleshooting.md) for the full list.
