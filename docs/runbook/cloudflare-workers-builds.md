# Cloudflare Workers Builds — production delivery runbook

> Canonical production delivery path for `https://rebuildup.dev`.
> Source-controlled by Issue #71 (ADR-0015 Phase 5). Cross-linked
> from [`AGENTS.md §4`](../../AGENTS.md) and
> [`docs/adr/ADR-0015-infisical-env-management.md`](../adr/ADR-0015-infisical-env-management.md).

## Production deploy authority

The **only** production deployment authority is **Cloudflare Workers
Builds** triggered by pushes to `main`. Pushing to `main` runs the
configured Cloudflare build command and the production deploy command
inside the Cloudflare build environment. No agent, GitHub Actions job,
or local command makes a production deploy.

| Actor | Role | Production deploy? |
| --- | --- | --- |
| Cloudflare Workers Builds on `main` push | Production deploy | **Yes** (sole authority) |
| GitHub Actions (`.github/workflows/ci.yml`) | Validation + production smoke (manual) | **No** |
| Local `pnpm run deploy:production:prepared` (operator) | Recovery / debugging fallback only | **Yes, but NOT a canonical release path** |
| Local `pnpm run deploy:production` (umbrella command) | Same as above | **Yes, fallback only** |

## Workers Builds configuration

Configured under **Cloudflare Dashboard → Workers → `my-web-2026` →
Settings → Builds**:

| Field | Value |
| --- | --- |
| Git repository | `rebuildup/my-web-2026` |
| Production branch | `main` |
| Build command | `pnpm run build` |
| Deploy command | `pnpm run deploy:production:prepared` |
| Root directory | repository root |
| Build variables | `NODE_VERSION=22`, `PNPM_VERSION=12.3.4`, `BUN_VERSION=1.4.2` |
| Build caching | enabled |
| Non-production branch builds | **disabled** — GitHub Actions owns PR/release validation |
| API token permissions | Worker deploy + route edit + **Account / D1 / Edit** (the deploy command applies pending D1 migrations before Wrangler deploy) |

### Toolchain parity: CI and Workers Builds must pin the same Bun

`external/readmark` is built by `scripts/build-tools.mjs` with
`bun install --frozen-lockfile`, and it ships a Bun **text lockfile**
(`bun.lock`, `lockfileVersion: 2`). Bun older than 1.3 cannot parse
it: it logs `UnknownLockfileVersion`, silently **ignores** the
lockfile, and then `--frozen-lockfile` fails with the misleading
`lockfile had changes, but lockfile is frozen` — which reads like a
dependency problem and is not one.

GitHub Actions provisions Bun explicitly (`oven-sh/setup-bun` with
`bun-version: 1.4.2`). Cloudflare Workers Builds does **not**: the
build image ships its own Bun (1.2.15 as of 2026-10-04) unless the
`BUN_VERSION` build variable overrides it. That divergence is what
failed the 0.5.0 release builds — CI was green while the production
build path was not.

**Contract: both environments pin `1.4.2`.** When the readmark
lockfile format changes, bump all three together:

| Where | What |
| --- | --- |
| `.github/workflows/ci.yml` | `oven-sh/setup-bun` → `bun-version` |
| Workers Builds trigger | build variable `BUN_VERSION` |
| `scripts/build-tools.mjs` | `MINIMUM_PACKAGE_MANAGER_VERSION.bun` (fail-fast guard) |
| this runbook | Build Variables row above |

`scripts/build-tools.mjs` probes `<package-manager> --version` before
each Tool build and refuses to continue when the detected version is
below the minimum, naming both versions. The failure is then an
explicit error at the Tool boundary instead of an opaque lockfile
parse error several steps later. **Do not fix a toolchain-version
failure by downgrading the Tool's lockfile** — the lockfile is the
Tool's contract; the build runtime is what must be brought up to it.

### Build / Deploy phase contract (Issue #247)

The two phases are deliberately asymmetric:

| Phase | Command | Produces |
| --- | --- | --- |
| Build | `pnpm run build:production` | a complete `.cloudflare/output/v0/` |
| Deploy | `pnpm run deploy:production:prepared` | consumes that Build Output |

`build:production` is **one self-contained command**: application
build → Tool build → client-bundle check → `cf build` → Tool sync into
the Build Output → Build Output verification. It never assumes a
previous step ran; the CI rule is that it must not succeed because
some other script happened to execute first.

The deploy phase **does not rebuild**. It verifies the Build Output it
is about to ship and then runs `cf deploy --prebuilt --mode production
--secrets-file <temp>`. Rebuilding in the deploy phase would let the
artifact that was verified differ from the artifact that ships.

The production gate is the artifact, not a config path. An invocation
is authorized because the Build Output is production-mode, built for
this account and this Worker, with a bundle and complete Tool
assets — not because `--config` named a file. Verification runs
**before** any D1 migration or Cloudflare API call, so a bad artifact
cannot half-deploy.

`CLOUDFLARE_API_TOKEN` is a **deploy-time** credential: the `cf` child
needs it, the Worker's secrets file never receives it, and it is not
part of the runtime required-secret contract.

**Do not switch the Workers Builds commands above until the deploy
path, D1, and the secrets/preflight are all cf-native.** Until then
the build command stays `pnpm run build` and the deploy command keeps
its current form.

### The two commands above are gated (Issue #480)

The table above is the only place the Workers Builds commands are written
down outside the Cloudflare Dashboard, so renaming `build` or
`deploy:production:prepared` in `package.json` would leave production
running a command that no longer exists — silently, because CI never reads
the dashboard. `pnpm run cf:config:drift:check` closes that: it asserts the
commands recorded in `quality/cloudflare-config-drift.json` still name a
real `package.json` script AND still match the rows in the table above. A
script rename therefore fails `validate:fast` and forces the dashboard
change and this table to move together. Full procedure:
[`docs/runbook/cloudflare-config-drift.md`](cloudflare-config-drift.md).

### Artifact attestation (Issue #476)

`pnpm run artifact:attestation:check` hashes the production-mode Build
Output and records the source commit, `package.json` dependency ranges,
`pnpm-lock.yaml` digest and resolved package count in
`release-assets/supply-chain/<version>/artifact-attestation.json`. It
runs at the end of `validate:integration`; CI retains the document as
`artifact-attestation-<sha>`. It does **not** change the deploy
authority: Cloudflare Workers Builds still deploys, no credential is
read by the attestation tool, and no Cloudflare API is called.

When a Cloudflare build UUID / deploy id is actually available, pass it
with `--build-uuid` / `--deploy-id`. The value is recorded verbatim and
is not authenticated against the Cloudflare API. A build run inside the
Cloudflare environment may pass `WORKERS_CI_COMMIT_SHA` as the expected
source commit; wiring that into the Workers Builds command is out of
scope by owner decision (2026-10-19). Before attaching a manifest to
a GitHub Release, verify it against the release tag itself with
`pnpm run artifact:attestation:check -- --manifest=<path>
--release-tag="v<version>"`: the tag must resolve to the manifest's
source commit and name its version. Hashing the artifact Cloudflare
Workers Builds actually deploys, and comparing it to that manifest, stays
outside the attested scope by owner decision (2026-10-19,
attestation §8-3) — this step does not change the deploy authority, and
no credential is read by the tool. See
[`docs/security/supply-chain-artifact-attestation.md`](../security/supply-chain-artifact-attestation.md).

## Runtime secrets — source of truth

Infisical `prod` environment is the **single source of truth** for
runtime secret VALUES. The Wrangler config declares the **set of
required NAMES**; Workers Builds fetches the values from Infisical at
deploy time, never hard-codes values in the repo, and never stores
values in `*.dev.vars` or committed files.

### Workers Builds credentials

| Name | Type | Lives in |
| --- | --- | --- |
| `INFISICAL_CLIENT_ID` | Machine Identity client id | Cloudflare Dashboard → Workers Builds → Environment variables |
| `INFISICAL_CLIENT_SECRET` | Machine Identity client secret | Cloudflare Dashboard → Workers Builds → Environment variables (sensitive) |

These are **NOT** runtime secrets — they are deploy-time credentials
the build environment uses to authenticate against Infisical Universal
Auth. The client secret never appears in build logs (Workers Builds
redacts `*_SECRET`, `*_TOKEN`, `*_KEY` variables from log output).

### Worker runtime secrets (source-controlled required names)

The current source-controlled contract is the **versioned 3-name form** (Issue #187 added `GOOGLE_ANALYTICS_MEASUREMENT_ID`):

| Name | SoT location | Phase |
| --- | --- | --- |
| `BETTER_AUTH_SECRETS` | Infisical `prod` | Phase 3+ (post-#89) |
| `MY_WEB_2026_CONSUMER_API_KEY` | Infisical `prod` | Phase 1+ (carried forward) |
| `GOOGLE_ANALYTICS_MEASUREMENT_ID` | Infisical `prod` | Issue #187+ (placeholder `G-PLACEHOLDER000` seeded at merge time; operator replaces with real `G-XXXXXXX` BEFORE traffic — see operator gate below) |

Decoded in `wrangler.production.jsonc#secrets.required` and mirrored
in `wrangler.jsonc#secrets.required`. The deploy inner script
(`scripts/run-deploy-inner.mjs`) reads its `REQUIRED_RUNTIME_SECRETS`
from the same source.

### Audit-only legacy separator

`BETTER_AUTH_SECRET` is retained in Infisical `prod` as an **audit /
recovery copy only**. It is **NOT** in `wrangler*.jsonc#secrets.required`,
and `scripts/run-deploy-inner.mjs#AUDIT_ONLY_SECRETS` actively strips
it from the sanitized child-process environment and **never writes it
to `secrets.json`** (ADR-0015 §9 audit-only semantics; the legacy
binding cannot resurrect on the next deploy).

## Source-controlled contract vs live Worker state

These are **independent facts** at every point in time:

- The **source-controlled desired contract** is `wrangler*.jsonc#secrets.required`
  → versioned 2-name form.
- The **live Worker binding state** depends on the most recent
  deploy + the most recent Phase B driver operation.

During the post-incident Phase B window (#139 containment → #89 flip → … → delete-legacy-only),
the live Worker carries the legacy `BETTER_AUTH_SECRET` binding in
addition to `BETTER_AUTH_SECRETS`. The config comment in
`wrangler.production.jsonc#secrets.required` is the **next deploy's
contract**, not a claim about the current Worker state.

To inspect live state without leaking values:

```bash
pnpm exec wrangler secret list --format json -c wrangler.production.jsonc
# → returns [{name: "BETTER_AUTH_SECRET"}, {name: "BETTER_AUTH_SECRETS"}, ...] (name-only)
```

## Canonical production release sequence (ADR-0015 §9 + Issue #124)

Sequencing is enforced by runbook; this is the **only** order that
keeps recovery paths well-defined. **Do not reorder.**

```text
#139 credential containment complete
       │  Better Auth production rotation + consumer API-key rotation
       │  + exposed Cloudflare token revoke/replace + dev Better Auth cleanup
       │
       ▼
#89 Phase B `flip` (Infisical write of versioned envelope + bulk put
       `BETTER_AUTH_SECRETS` to Worker via scripts/phase-3-plus-prod-flip.mjs)
       │  → Worker now carries BOTH legacy `BETTER_AUTH_SECRET` and
       │    versioned `BETTER_AUTH_SECRETS`. `main` runtime code still
       │    reads legacy (`BETTER_AUTH_SECRET`). The versioned binding
       │    is **inert** until #91 merge/deploy.
       │
       ▼
GA4 operator gate (Issue #187) — if production GA4 tracking is
       desired BEFORE the release PR merge, replace the placeholder
       `G-PLACEHOLDER000` in Infisical `prod` for the secret
       `GOOGLE_ANALYTICS_MEASUREMENT_ID` with the real `G-XXXXXXX`
       value (Infisical dashboard). Status-only verification:
       `pnpm run infisical:check:cf -- --execute --environment=prod`.
       The release PR may merge with the placeholder still in `prod`;
       the placeholder is harmless (GA4 just records into a
       non-existent property) but the operator MUST replace it BEFORE
       real visitor traffic is cut to production. See
       `docs/runbook/analytics.md`. This gate is OUT of the Phase B
       driver ordering — it is a separate operator concern.
       ▼
Smoke #1 — transition smoke (PRE #91-merge; legacy runtime still active)
       │  Automated `pnpm run e2e:prod:transition` checks the
       │  canonical surfaces that are expected to work on the current
       │  `main` while intentionally deferring the #106 login-page
       │  assertion to Smoke #2. The Issue #500 representative
       │  routes are deferred to Smoke #2 for the same reason: their
       │  expectations are release-branch facts and nothing of this
       │  release is deployed yet (see "Representative route
       │  coverage" below). `wrangler secret list` confirms the
       │  versioned binding is
       │  present alongside the legacy binding. A known pre-#91
       │  Issue #106 baseline (`/admin/login -> 307 /admin/login`)
       │  is NOT treated as a Smoke #1 failure: that route fix exists
       │  only on `release-0-5-0` until #91 deploys.
       │
       │  **Operator legacy-auth check (still mandatory):** use a
       │  same-origin browser context on https://rebuildup.dev to
       │  submit real production credentials directly to Better Auth's
       │  `POST /api/v1/auth/sign-in/email` endpoint, preserve the
       │  returned session cookie, then load `/admin` and reload it.
       │  Both authenticated loads must succeed. Never put credentials
       │  in argv, logs, GitHub, or chat; use interactive browser input
       │  (or an equivalent stdin-only mechanism).
       │
       │  This verifies the **legacy runtime path** after #139 rotation.
       │  It does NOT validate the versioned runtime path — see
       │  "Smoke boundary semantics" below.
       │
       ├── transition/binding failure → rollback-versioned-only
       │   → investigate → #89 NOT closed
       ├── legacy-auth/session failure → DO NOT merge #91; investigate
       │   #139 Better Auth rotation/recovery. rollback-versioned-only
       │   may remove the inert transition binding but does not repair
       │   a broken legacy signing secret.
       ▼
Release PR #91 (`release-x-y-z → main`) merged
       (operator explicit approval required per
       AGENTS.md §6 / release-merge-human-gate)
       │
       ▼
Cloudflare Workers Builds observes `main` push, builds, runs
       `pnpm run deploy:production:prepared` (applies pending D1
       migrations + Wrangler deploy with the versioned 3-name
       secrets.required, including GA). `main` runtime code now reads
       `BETTER_AUTH_SECRETS`; legacy binding still present as fallback.
       │
       ▼
Smoke #2 — versioned-runtime smoke (POST #91-merge/deploy; automated)
       │  `pnpm run e2e:prod` — the **core** production smoke only
       │  (canonical surfaces + the versioned contract) +
       │  the Issue #500 representative routes with their
       │  documented default states (see "Representative route
       │  coverage" below) +
       │  anonymous `GET /admin/login` returns 200 (the #106 fix
       │  in production: login form reachable without auth gate).
       │  `wrangler secret list` confirms both bindings still present.
       │  `pnpm run e2e:prod` deliberately EXCLUDES
       │  `e2e/prod-portfolio.spec.ts`: that spec is the G15
       │  post-publication contract (see its header) and cannot pass
       │  while the Portfolio candidates are still `visibility=draft`.
       │  Portfolio verification is a separate, later gate — see
       │  "Portfolio publication smoke" below.
       │
       ▼
Smoke #3 — versioned-runtime operator manual sign-in (POST #91-merge/deploy)
       │  Operator signs in to https://rebuildup.dev/admin/login
       │  with real production credentials; confirms session
       │  established and persists across reload. This is the FIRST
       │  smoke that exercises the versioned-runtime path.
       │
       ├── failure here → restore-legacy-only (re-adds BETTER_AUTH_SECRET
       │   to Worker via bulk put) → investigate → #89 NOT closed
       ▼
#89 Phase B `--delete-legacy-only` — strips the legacy Worker binding
       via bulk put `{"BETTER_AUTH_SECRET": null}` (Cloudflare API only;
       no Infisical mutation)
       │
       ▼
final drift check — `pnpm run infisical:check:cf -- --execute
       --environment=prod --worker-contract=final --require-live-worker`
       reports Tier 1 = versioned+audit set,
       Tier 2 = versioned 3-name, Tier 3 = versioned 3-name
       │
       ▼
#78 / #82 Portfolio publication (operator-gated, release-window)
       │  `prepare/verify` (draft) → `--operation=publish` → the
       │  candidates become `visibility=public` in production D1 and
       │  their media becomes readable on the R2 custom domain.
       ▼
Portfolio publication smoke — `pnpm run e2e:prod:portfolio`
       │  `e2e/prod-portfolio.spec.ts` only. Verifies the G15
       │  post-publish contract: `/portfolio` lists every published
       │  manifest entry, each `/portfolio/<slug>` returns 200 with
       │  canonical + OGP metadata, and every `media.rebuildup.dev`
       │  asset returns 200 with its declared content type.
       │
       ├── failure here → the publication window is NOT complete;
       │   #78 / #82 stay open. This is independent of the #89
       │   secret lifecycle, which has already converged above.
```

### Portfolio publication smoke is a separate gate

`e2e/prod-portfolio.spec.ts` is **not** part of `pnpm run e2e:prod` or
`pnpm run e2e:prod:transition`, by design. The spec's own header states
the contract: it is the G15 end-to-end public-surface verification that
is only valid **after** G14 (`--operation=publish`). Before publication
the candidates are `visibility=draft` and the per-detail canonical /
OGP assertions fail by design.

This matters for sequencing: Smoke #2 runs immediately after the #91
deploy, which is *before* the publication window. Running the portfolio
spec there would produce a guaranteed-false red that says nothing about
the versioned-secret runtime.

Two distinct preconditions, do not conflate them:

| Precondition | When it must hold |
| --- | --- |
| `media.rebuildup.dev` resolves (R2 custom domain attached) | **Pre-release preparation** (#82). Can and should be attached + verified before #91 so it is not a surprise during the publication window. |
| Portfolio candidates published (`visibility=public`) | **After** `--operation=publish`. Until then `e2e/prod-portfolio.spec.ts` cannot pass. |

## Representative route coverage (Issue #500)

Smoke #2 (`pnpm run e2e:prod`, POST-deploy) runs
`e2e/prod-smoke.spec.ts` with the five **representative routes**
registered:

| Route | Default state the smoke requires |
| --- | --- |
| `/` | six default sections render, and the reactions widget is configured (never the "reactions disabled" placeholder) |
| `/about` | the repo-controlled identity snapshot renders (identity heading + five narrative sections) |
| `/portfolio` | exactly one of the two documented branches: `catalogue-empty` (empty state, no card) or `catalogue-published` (at least one card, no empty state) |
| `/tools` | every manifest Tool renders as one row and is classified the way its manifest entry demands — a public delivery kind links to its OWN `/tools/<slug>` and carries no disabled state, a `host_disabled` Tool renders no anchor at all and shows the Coming soon badge — and the row set equals `src/tools/manifest.json` |
| `/api/v1/health` | `status=ok`, `service=my-web-2026`, `layer=external-boundary`, and a well-formed semantic `version` |

Each route is also checked for its **short navigation path**: `/` offers a
one-click in-site entry to `/about`, `/portfolio`, and `/tools`, and the
two `PublicNav` pages among the representative set (`/about`,
`/portfolio`) link to every sibling representative route.

Every route must answer **for itself, from the origin the run was pointed
at**. `auditRoute()` compares the final (post-redirect) origin AND
pathname against the route contract and against the origin Playwright was
pointed at, so a redirect to a look-alike host serving the same pathname
is a defect rather than a pass — that is what makes "the canonical origin
itself serves this route" and "the smoke never leaves the origin it was
pointed at" verifiable claims rather than prose.

Phase scoping
-------------

**Smoke #1 (`transition`) skips the representative routes entirely.**
They run in Smoke #2 only. Every expectation in the registry is a
release-branch fact — the Tool Registry row set, the home / about section
counts, the declared `<title>` and `<h1>` text, the canonical hrefs —
while Smoke #1 runs BEFORE the release PR merges, so production still
serves the previous `main` build and legitimately differs from the branch.
Asserting release expectations against a pre-deploy deployment would fail
the mandatory pre-merge smoke for a difference nobody has shipped, and
the Smoke #1 failure branch above is a release blocker
(`rollback-versioned-only` → investigate → #89 NOT closed). This is the
same reasoning that already defers the #106 `/admin/login` assertion.

Open owner decision: whether Smoke #1 should carry a **phase-invariant
subset** (status / content-type / redirect-self / heading presence) of the
representative routes. That is a release-sequence semantics decision, and
this document — not a PR — owns it. Until it is decided, the conservative
behaviour (skip, exactly like `/admin/login`) is what ships.

Where the contract lives
------------------------

The routes, expectations, default states, and navigation paths are DATA
in [`scripts/prod-smoke-routes.mjs`](../../scripts/prod-smoke-routes.mjs).
`auditRoute()` there is a pure classifier;
[`scripts/prod-smoke-routes.test.mjs`](../../scripts/prod-smoke-routes.test.mjs)
feeds it fabricated observations offline (no network, no workerd, no
browser), so the smoke's pass/fail logic cannot silently degrade into
"always green". `e2e/prod-smoke.spec.ts` is the read-only browser adapter.
When a smoke goes red, the report names the absolute URL and every
individual defect; an empty defect list is the only pass.

Offline rehearsal
-----------------

`pnpm run e2e:prod:local` runs the SAME spec file against the local
`vite preview` build instead of production. It builds the current working
tree first (the preview server serves `dist/client`), then forces
`PLAYWRIGHT_BASE_URL` to `http://127.0.0.1:${PLAYWRIGHT_PORT:-3000}` even
if the parent shell exported production, so the command cannot silently
run against production. The representative-route adapter navigates to that
resolved `baseURL`, and the Issue #43 canonical-origin group, which does
hardcode the canonical origin (including the one deliberate write, the
anonymous reaction mutation), disarms itself unless the run is explicitly
canonical — local mode always is not. A test in the representative group
asserts that a non-production run does not resolve the canonical origin.
Use the command to rehearse the contract, and to capture a verification
artefact, without reading production at all. It is a rehearsal, not a
substitute: the deployed-`main` measurement still only exists in Smoke #2.

Read-only boundary
------------------

The representative-route coverage issues **GET only**. It writes nothing
to D1, nothing to R2, performs no auth mutation, and clears no cookie.
The anonymous reaction mutation elsewhere in `e2e/prod-smoke.spec.ts` is
the one deliberate write in the file; it predates #500, it proves the
`mw_actor_id` cookie is issued with `Secure`, and it is deliberately NOT
part of the representative-route registry.

Outbound traffic originates only at the canonical production origin in a
production run; the pages themselves reference Google Fonts, GA4, and
`media.rebuildup.dev`, and the smoke does not exercise or assert on any
of them, so it never becomes a third-party availability contract. That is
enforced, not trusted: an observation whose final (post-redirect) origin
differs from the origin the run was pointed at is reported as a defect,
and the browser adapter aborts every subresource request whose origin is
not that same origin before the first navigation. A redirect or a
third-party subresource therefore cannot falsify the boundary silently.

What it deliberately does not check
----------------------------------

- `/portfolio/<slug>` detail pages and R2 media. Those remain the G15
  post-publication contract in `e2e/prod-portfolio.spec.ts`, gated by the
  publication window below.
- Anything authenticated. `/admin/*` stays outside the representative set;
  `GET /admin/login` is still asserted separately, with its own documented
  phase asymmetry.
- Load or latency budgets. This is a correctness smoke, not a performance
  gate.
- Page composition work. `/tools` currently has no in-site link back to
  `/` because Issues #199 / #288 keep site chrome off the home and Tools
  surfaces. That is an information-architecture fact owned by the routes,
  recorded rather than silently "fixed" here.

## Diagnosing a failed build (Issue #247)

Use the repository helper and the Builds API. **Do not** use the
Cloudflare Dashboard or browser automation for production diagnosis —
it needs an interactive login, sits behind a bot challenge, and cannot
be asserted on.

```bash
# by commit SHA (or a branch / PR ref): resolves the Build UUID first
infisical run --env dev --path / -- \
  node scripts/cf-build-status.mjs a581a39

# by explicit Build UUID
infisical run --env dev --path / -- \
  node scripts/cf-build-status.mjs 7681b516-d11e-4a39-a351-fce74ac4d5cb

# machine-readable
... --json

# build-minute limits (useful before assuming a rate limit)
... --limits
```

It reports the build status and window, the full log (with cursor
pagination and truncation detected), the **stage that failed**, the
first error line, an exit code when present, and surrounding context.

The `CLOUDFLARE_API_TOKEN` it reads is the Infisical-managed credential
used throughout the release procedure. The token is only ever read from
the process environment and used as a request header — never echoed,
never placed in argv, never written to disk. Every log line is passed
through a redaction pass (`KEY=value` credentials, `Authorization:
Bearer …`, and `Set-Cookie` are all replaced) before it is printed, so
the output is safe to paste into an Issue.

## Smoke boundary semantics

The smokes look superficially similar but verify **different things**:

| Smoke | Code state | Binding state | Validates |
| --- | --- | --- | --- |
| **#1 (transition)** | `main` reads legacy `BETTER_AUTH_SECRET` | BOTH bindings bound (legacy + versioned) | Transition did not regress the legacy runtime. Real auth is verified through the same-origin Better Auth sign-in endpoint + authenticated `/admin` reload when the known pre-#91 #106 login-page redirect is active; the versioned binding is observable via `wrangler secret list` but **inert** because `main` still reads legacy |
| **#2 (versioned, automated)** | `main` reads `BETTER_AUTH_SECRETS` | BOTH bindings bound | Canonical surfaces green on versioned runtime; anonymous `/admin/login` reachable (#106 production verification) |
| **#3 (versioned, manual)** | `main` reads `BETTER_AUTH_SECRETS` | BOTH bindings bound | Operator's real admin credential signs in successfully via versioned runtime; cookies persist |

**Critical invariant:** Smoke #1 **cannot** validate the
`BETTER_AUTH_SECRETS` runtime path because `main` does not read it
until #91 merges. Treating Smoke #1 as a versioned-runtime check
would yield a false-positive (legacy path signs in successfully and
the operator believes the versioned path is healthy). The
versioned-runtime check is therefore deferred to Smoke #2/#3.

Issue #106 creates one deliberate pre/post-release asymmetry. Before #91,
the current production login page may self-redirect before the form can
render; this is a known code baseline, not evidence about the rotated
legacy secret. Smoke #1 therefore bypasses only that broken **page**
and exercises the same Better Auth sign-in endpoint directly, then proves
the resulting session on the protected `/admin` route. After #91,
Smoke #2 MUST verify anonymous `GET /admin/login` returns 200, and
Smoke #3 MUST use the normal login UI. This exception ends once #106 is
verified in production.

## Deploy preflight contract

`deploy-with-secrets.mjs --execute` authenticates to Infisical once and
then runs `check-cf-secrets.mjs --execute --worker-contract=transition
--require-live-worker` **before** spawning the actual deploy. A non-zero preflight exit aborts
production deployment. `--require-live-worker` invokes `wrangler secret list`
through Wrangler's available Workers Builds authentication context; it does not
require duplicating the build token as a separate `CLOUDFLARE_API_TOKEN` build
secret. An explicit `CLOUDFLARE_API_TOKEN` remains supported for operator/local
diagnostics.

`transition` is the **pre-deploy** live Worker contract. It expects the
current Worker to carry exactly the three bindings that already exist
before #91 deploys:

- `BETTER_AUTH_SECRETS`
- `BETTER_AUTH_SECRET`
- `MY_WEB_2026_CONSUMER_API_KEY`

`GOOGLE_ANALYTICS_MEASUREMENT_ID` is deliberately **not** required by
this pre-deploy Tier 3 check. It is required in Infisical Tier 1 and
Wrangler Tier 2, and the #91 deployment is the operation that first
binds it to the live Worker. Requiring it in the pre-deploy live Worker
contract would create a circular gate (#227).

After #91 deploys and before legacy deletion, the live Worker carries
four bindings (the three above + GA). After post-deploy smoke passes and `--delete-legacy-only` succeeds,
the final drift check MUST use `--worker-contract=final --require-live-worker`, which expects
the versioned three-name Worker contract (`BETTER_AUTH_SECRETS`,
`MY_WEB_2026_CONSUMER_API_KEY`, `GOOGLE_ANALYTICS_MEASUREMENT_ID`) while
Infisical still keeps the legacy audit/recovery copy.

## Recovery operations (Phase B driver)

`scripts/phase-3-plus-prod-flip.mjs` is the single Phase B driver.
Its mode grammar (v4):

| Operation | Mutates Infisical? | Mutates Worker binding? | Use when |
| --- | --- | --- | --- |
| `--dry-run --operation=flip` (default) | No | No | Verify the planned operation |
| `--execute --operation=flip` | Yes (prod `BETTER_AUTH_SECRETS` UPSERT) | Yes (`BETTER_AUTH_SECRETS` bulk put) | Initial Phase B — add versioned binding |
| `--execute --delete-legacy-only` | No | Yes (`BETTER_AUTH_SECRET` bulk null) | post-#91-merge / post-deploy, after Smoke #3 passes |
| `--execute --restore-legacy-only` | No (read-only) | Yes (`BETTER_AUTH_SECRET` bulk put) | Smoke #3 failure AFTER `delete-legacy-only` already ran |
| `--execute --rollback-versioned-only` | No | Yes (`BETTER_AUTH_SECRETS` bulk null) | Smoke #1 failure BEFORE `delete-legacy-only` (legacy runtime must remain readable) |

`flip` requires a **writer-scoped INFISICAL_TOKEN** with edit
permission on the prod env; the viewer Machine Identity is
read-only and fails-closed for `flip`. Other operations do not
require writer scope (they only mutate Worker bindings).

## Rehearsal evidence levels

The recovery operations above are rehearsed offline by
`scripts/_rollback-rehearsal.mjs`. The rehearsal states, per step and
per result, **how strongly the repository can prove that step**:

| Evidence level | Meaning | Who can raise it |
| --- | --- | --- |
| `recorded` | The procedure is written down; nothing ran. | The table in the rehearsal module |
| `simulated-and-tested` | The procedure was exercised against a disposable local fixture and the outcome was asserted. | The offline rehearsal (Issue #721) |
| `human-verified` | A human ran it and confirmed the outcome. | The repository owner, against the real system |
| `production-verified` | It ran against the live platform and the platform's own behaviour confirmed it. | The release operator, against the real system |

A recording is **never** reported as an execution: the levels are
distinct, and the rehearsal may not claim `human-verified` or
`production-verified` — nothing in the repository was done by a human
against Cloudflare.

The offline rehearsal reads **no credential**, makes **no external
request** and performs **no production operation**. It exercises the
documented paths against a disposable local state model
(`scripts/_rollback-fixture.mjs`), so it can show that the decision
logic picks the documented path and that the documented restore changes
the state back.

The facts only the live platform can prove stay **not verified here**:
whether Cloudflare actually rolls the Worker back, whether the previous
release is still deployable, whether `--delete-legacy-only` is
irreversible in practice, whether the Phase B driver performs the bulk
put exactly as described above, and the two human steps — an operator
signing in with real production credentials, and the release PR merge /
tag / GitHub Release publication. A passing local rehearsal never
stands in for any of them.

## GitHub Actions — validation only

`.github/workflows/ci.yml` runs `validate` (format + lint +
architecture + version + typecheck + test + build + wrangler
dry-run + lint:ci + build-storybook + cf-typegen-check on
release-branches). On PRs with the `ui-change` label and on
pushes to `main` / `release-*`, Playwright E2E runs against the
local dev server.

`.github/workflows/prod-smoke.yml` is a manual diagnostic workflow.
Operator-initiated only. Never wired to a push event.

GitHub Actions MUST NOT deploy production. There is no
`.github/workflows/deploy-production.yml`; production deploy
authority stays with Cloudflare Workers Builds.

## Forbidden in this runbook

- Direct `wrangler secret put` / `wrangler secret delete` invocations
  in production contexts (no stdin-pipe path, interactive `confirm()`).
  Use `wrangler secret bulk` with stdin JSON via the Phase B driver.
- `pnpm run deploy:production:prepared` invoked against production
  with `secrets.required` out of sync with the Worker binding state.
- Shell-embedded secret values in argv, CI logs, GitHub Actions
  output, or chat.
- `main` push produced by anything other than the canonical release
  PR merge. CI merges never include deploy.
- Local production deploy used to *replace* the canonical release
  path (recovery / debugging only).
- Re-uploading `BETTER_AUTH_SECRET` as a Worker binding during deploy
  — `AUDIT_ONLY_SECRETS` makes this structurally impossible in
  `scripts/run-deploy-inner.mjs`.

## References

- [`docs/adr/ADR-0015-infisical-env-management.md`](../adr/ADR-0015-infisical-env-management.md)
  §1 (Infisical SoT) / §6 (consumer API key) / §9 (wrangler
  secrets.required staged design + audit-only semantics).
- [`AGENTS.md §4`](../../AGENTS.md).
- `scripts/reconcile-prod-auth-secret.mjs` — #122 driver.
- `scripts/phase-3-plus-prod-flip.mjs` — #89 Phase B driver
  (mode grammar: `flip` / `delete-legacy-only` / `restore-legacy-only` /
  `rollback-versioned-only`).
- `scripts/deploy-with-secrets.mjs` — Universal Auth login + HTTPS POST
  body (shell-less argv).
- `scripts/run-deploy-inner.mjs` — `REQUIRED_RUNTIME_SECRETS` /
  `AUDIT_ONLY_SECRETS` separation + `collectSecrets()` invariant.
- `scripts/check-cf-secrets.mjs` — phase-aware drift logic.
- Issues #71, #89, #122, #124, #91.
