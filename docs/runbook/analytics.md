# Google Analytics 4 — production wire-up

> Source of truth for the GA4 production wiring on
> `https://rebuildup.dev`. Cross-linked from
> [`AGENTS.md §4`](../../AGENTS.md) and Issue #171 / Issue #187.

## Identity model

The GA4 property ships under a single public measurement ID of the
shape `G-XXXXXXX` issued by GA4 when the operator registers the
property. The ID is a **non-secret public identifier** — it appears
in client-side `gtag` snippets on every visitor's browser and is
already visible in the network panel of every visitor's DevTools.
However, because the operator wants to set / inspect the value from
the Infisical dashboard (which only surfaces runtime secrets, not
Wrangler `vars`), the value lives in Infisical `dev` / `prod` rather
than in `wrangler.jsonc#vars`. Issue #187 performed this migration.

| Side | Location | Lifecycle |
| --- | --- | --- |
| Measurement ID value (`G-XXXXXXX`) | Infisical `dev` + `prod` under the name `GOOGLE_ANALYTICS_MEASUREMENT_ID` | Operator-managed via Infisical dashboard; never committed to source control |
| `secrets.required` declaration | `wrangler.jsonc#secrets.required` and `wrangler.production.jsonc#secrets.required` | committed; tracks the runtime secret name |
| Seed placeholder `G-PLACEHOLDER000` | `scripts/infisical-seed.mjs` (dev only; prod placeholder is operator-seeded) | seeded once at merge time; replaced with the real `G-XXXXXXX` BEFORE traffic is cut |
| Type augmentation | `src/cloudflare/auth/env.d.ts` (`GOOGLE_ANALYTICS_MEASUREMENT_ID: string`) | committed; tracks `wrangler.jsonc` |
| Render gate | `src/routes/__root.tsx#loader` (server-side read) + `src/editorial/analytics/GoogleAnalytics.tsx` (component, public paths only) | committed |
| Exclusion gate | `useLocation()` selector `pathname.startsWith('/admin')` in `__root.tsx#RootComponent` (script mount) + the same rule inside `trackRoutePageView` (page_view emission, Issue #286) | committed |
| SPA route-change tracking | `GoogleAnalyticsRouteTracker` in `GoogleAnalytics.tsx`, mounted unconditionally in `__root.tsx#RootComponent` (Issue #286) | committed |

The placeholder is the **default state**. The Worker reads the
runtime secret at SSR time; if the operator has not yet replaced
the placeholder with a real `G-XXXXXXX`, GA4 simply receives a
script load against a non-existent property and the pageview is
silently discarded. The placeholder therefore makes the wire-up
exercised end-to-end without an operator-configured GA ID.

## Initial setup

To wire GA4 into production for the first time:

1. **Register a GA4 property** at <https://analytics.google.com/> for
   the canonical origin `https://rebuildup.dev`. Note the
   measurement ID (`G-XXXXXXX`) the property page issues.

2. **Set the value in Infisical** (Operator session, no agent
   transcript). Issue #187 seeded the **placeholder**
   `G-PLACEHOLDER000` into both `dev` and `prod`. Operator replaces
   the prod value via the Infisical dashboard:

   - Project: `my-web-2026`
   - Environment: `prod`
   - Secret name: `GOOGLE_ANALYTICS_MEASUREMENT_ID`
   - Secret value: the `G-XXXXXXX` from step 1.

   Status-only confirmation that the secret is present (after the
   operator run) is run by:

   ```bash
   pnpm run infisical:check:cf -- --execute --environment=prod
   # → status-only output: presence / absence of each name; no value
   ```

   The dev placeholder may be left in place (dev traffic is
   recorded into a non-existent GA property; no leakage). Operators
   who want a real GA property to record dev traffic can replace the
   dev value the same way; the dev environment is not in scope for
   the production release readiness gate.

3. **Operator gate before traffic.** This is a **deployment
   readiness gate**. The release PR may merge with the placeholder
   still in `prod`, but **the placeholder MUST be replaced with the
   real `G-XXXXXXX`** before `https://rebuildup.dev` carries
   real visitor traffic. The runbook
   [`docs/runbook/cloudflare-workers-builds.md`](cloudflare-workers-builds.md)
   calls this out as an explicit step in the canonical production
   release sequence.

4. **Land on the release trunk** via the standard PR review +
   merge. Cloudflare Workers Builds deploys the new config to
   production; the next request to `/`, `/about`, `/contact`,
   `/portfolio`, or `/tools` returns HTML that contains the GA
   `<script async>` tag in `<head>`. The script always references
   the current `GOOGLE_ANALYTICS_MEASUREMENT_ID` value — placeholder
   or real.

5. **Verify in production** (operator session, no agent transcript):

   ```bash
   curl -sS https://rebuildup.dev/ | grep googletagmanager
   ```

   Expect one `<script async src="https://www.googletagmanager.com/gtag/js?id=…">`
   line, plus the inline `gtag('config', '…')` script. The id
   segment reflects the current Infisical `prod` value. **Do not
   paste the id into chat or logs.**

   Status-only placeholder check (Issue #286) — tests for the known
   `G-PLACEHOLDER000` seed WITHOUT ever printing the id itself. As
   long as the placeholder is deployed, GA4 silently discards every
   hit:

   ```bash
   curl -sS https://rebuildup.dev/ -o /tmp/prod.html
   grep -c PLACEHOLDER000 /tmp/prod.html
   # 1 (or more) → placeholder still deployed → step 2 above is
   #               still pending → pageviews are discarded.
   # 0           → a real G-XXXXXXX is deployed (do not print it).
   ```

   ```bash
   curl -sS https://rebuildup.dev/admin/login | grep googletagmanager
   ```

   Expect zero matches. The `/admin/*` exclusion is in
   `src/routes/__root.tsx#RootComponent` — verify with a
   read-only `git grep` if the exclusion is ever suspected to
   have regressed:

   ```bash
   git grep -n "startsWith('/admin')" src/routes/__root.tsx
   ```

## Per-environment behaviour

`wrangler.jsonc` (the default env) feeds `pnpm dev` and local
workerd runs. `wrangler.production.jsonc` feeds the production
deploy via Cloudflare Workers Builds and the local fallback
`pnpm run deploy:production`. Both `secrets.required` arrays list
`GOOGLE_ANALYTICS_MEASUREMENT_ID`; both runtime contracts are the
same name.

Setting one without the other is a misconfiguration, not a feature:
the resulting environment renders nothing. The mirroring rule is
documented in `wrangler.production.jsonc`'s header comment and is
the same rule that applies to every other shared secret
(`MY_WEB_2026_CONSUMER_API_KEY`, `BETTER_AUTH_SECRETS`).

## Why a secret, not a var (Issue #187 reasoning)

| Property | Decision |
| --- | --- |
| Identifier class | Public (visible in every visitor's network panel) |
| Rotates with deployment? | Rare (only on property migration) |
| Operators must read the value before writing? | No — write GA4 directly |
| Must NOT enter agent transcript / logs | True (compliance hygiene, not security) |
| Worker secret vs var | **Secret** — operator wants to inspect / edit from the Infisical dashboard; `vars` does not surface there |

The var/secret distinction is about operator ergonomics, not security:
`vars` are committed to source control and not editable from
Infisical; `secrets` are managed in Infisical and read at runtime.
The value is still a public identifier, so it is treated under the
public-identifier compliance hygiene (never log / echo the value)
rather than the secret containment treatment that
`BETTER_AUTH_SECRETS` / `MY_WEB_2026_CONSUMER_API_KEY` get.

## Rotation

GA4 does not require rotation in the security sense. The two
operational reasons to change the value are:

- The operator migrates to a new GA4 property (e.g. splits traffic
  by environment, hands the property to a different GA account).
- The property was leaked into a context where its predecessor
  should be revoked.

In both cases the procedure is the same as the initial setup:
edit the Infisical `prod` (and `dev`, if applicable) value from the
dashboard, then wait for the next Worker deploy OR force the next
deploy if traffic must pick up the change before the next release.
There is no separate "rotation" pathway because the value is not a
credential and a rotation driver would only obscure the operator
flow.

## Acceptance

The `pnpm run validate:fast` gate is the canonical local check.
It runs:

- `format:check` and `lint:check` (Biome) — covers the
  `__root.tsx`, `GoogleAnalytics.tsx`, and wrangler JSON edits.
- `architecture:check` — the `routes -> editorial` edge is
  registered in `AGENTS.md §3`.
- `typecheck` — `src/cloudflare/auth/env.d.ts` augmentation keeps
  `worker-configuration.d.ts` in sync (`pnpm run cf-typegen:check`
  is the `validate:release`-only check for that).
- `test` — `src/editorial/analytics/GoogleAnalytics.test.tsx`
  exercises the capture helper and the rendered markup, including
  the empty / undefined / whitespace-only / capture-once branches
  and the URL-encoding + inline-script escaping rules, plus the
  Issue #286 SPA contract: one inline `gtag('config', …)` per
  document, one `page_view` per route change (deduped against the
  initial location), `/admin/*` never tracked, no captured ID →
  no tracking, and the queue-`config` fallback for documents whose
  init snippet never ran.
- `pnpm run test:client` — `GoogleAnalytics.client.test.tsx`
  mounts `GoogleAnalyticsRouteTracker` under happy-dom and asserts
  the effect wiring end to end (Issue #286). Not part of
  `validate:fast`; run it alongside the gate for analytics changes.
- `infisical:check:coverage` — verifies the three
  deploy-time sources (`wrangler.jsonc#secrets.required`,
  `wrangler.production.jsonc#secrets.required`,
  `scripts/run-deploy-inner.mjs#REQUIRED_RUNTIME_SECRETS`) all
  list `GOOGLE_ANALYTICS_MEASUREMENT_ID`.

A failing test means the wire-up has drifted and the PR is not
merge-ready. The canonical gate is the per-ticket PR review
against the target release branch — ticket PRs do not require
per-merge operator auth (the release-merge human gate covers
release PR / tag / GitHub Release only, per the canonical scope
rule).

## SPA route-change tracking (Issue #286)

Earlier versions of this runbook declared SPA pageview tracking
out of scope; Issue #286 implemented it and superseded that
section. The contract today:

- `gtag('config', …)` in the inline init script records the
  **initial document load** — exactly once per document.
- `GoogleAnalyticsRouteTracker` (mounted unconditionally in
  `__root.tsx#RootComponent`) pushes
  `gtag('event', 'page_view', …)` **once per client-side location
  change** (`pathname + searchStr`), deduped against the initial
  location so the initial load is never counted twice.
- `/admin/*` locations are never emitted; the tracker instance
  survives admin navigations so the first public page after
  leaving `/admin/*` is tracked.
- No captured measurement ID → the tracker is inert (same off
  switch as the script mount).
- If the document's init snippet never ran (visit landed on
  `/admin/*`, where the GA scripts are excluded) the tracker
  bootstraps the official `dataLayer`/`gtag` queue and queues
  `js` + `config`; `config` records that page's page_view.

## Out of scope

The Issue #171 body lists these as not part of the wire-up and they are
also not part of this runbook:

- **Cookie consent banner.** Out of scope per Issue #171 body. If a
  visitor jurisdiction requires consent in the future, the
  acceptance gate moves to a separate ticket.
- **Custom events / conversions.** Out of scope. Future tickets
  can extend `src/editorial/analytics/` with sibling components
  that emit typed events.
- **A separate rotation driver.** Out of scope; the value is a
  public identifier and the operator flow is the same as the
  initial setup.