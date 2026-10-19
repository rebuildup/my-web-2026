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
| Render gate | `src/routes/__root.tsx#loader` (server-side read) → `AnalyticsGate` in `src/editorial/analytics/AnalyticsConsent.tsx` (public paths only, and only after a stored consent decision) → `src/editorial/analytics/GoogleAnalytics.tsx` | committed |
| Consent gate (Issue #495) | `src/editorial/analytics/consent.ts` (decision rules, document-scoped state) + `AnalyticsConsentControl` (the only place a decision is recorded); the default state is **no measurement** | committed |
| Exclusion gate | `isAnalyticsMountPath(pathname)` in `src/editorial/analytics/consent.ts`, called once by `__root.tsx#RootComponent` (gate mount) + the same rule inside `trackRoutePageView` (page_view emission, Issue #286). The predicate is unit-tested (`consent.test.ts`) because an SSR assertion cannot distinguish a working gate from a missing one | committed |
| SPA route-change tracking | `GoogleAnalyticsRouteTracker` in `GoogleAnalytics.tsx`, mounted together with the loader inside `AnalyticsGate` (Issue #286; consent-gated since Issue #495) | committed |

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
   production. Since Issue #495 the SSR HTML does **not** contain
   the GA tag on any route: the measurement gate renders the
   `<script async>` node in the browser, only after a visitor has
   recorded a `granted` decision. The value is still read from the
   runtime secret at SSR time and carried to the client in the
   loader data, so a deploy that changes the secret does change the
   ID the next granted visitor's browser requests.

5. **Verify in production** (operator session, no agent transcript).
   There is no `curl` verdict any more: the tag is client-only and
   consent-gated, so an HTTP request to `/` can never show it. Use a
   browser instead:

   1. Open `https://rebuildup.dev/` with DevTools → Network open and
      filter for `googletagmanager`.
   2. Confirm **no** `gtag/js` request is made while the consent
      panel is showing 未選択 (this is the pre-consent guarantee).
   3. In the console, record a grant for this origin only:

      ```js
      localStorage.setItem('my-web-2026:analytics-consent', 'granted');
      ```

   4. Reload and confirm exactly one
      `https://www.googletagmanager.com/gtag/js?id=G-…` request,
      followed by one `page_view`. The id segment reflects the
      current Infisical `prod` value — **do not paste the id into
      chat or logs** (AGENTS.md §4: status-only output).
   5. Withdraw from the panel (拒否する) and confirm the control
      reports 無効. In the console,
      `window['ga-disable-G-…']` (same id) is now `true`; no further
      `page_view` is sent on navigation.
   6. Remove the test decision so the origin returns to its default
      state:

      ```js
      localStorage.removeItem('my-web-2026:analytics-consent');
      location.reload();
      ```

   Placeholder detection is now an Infisical question, not an HTTP
   one: if the deployed value is still `G-PLACEHOLDER000`, GA4
   silently discards every hit and the Network panel shows
   `?id=G-PLACEHOLDER000`. Decide that from the request URL in the
   browser (boolean: placeholder / not placeholder) and never by
   printing the secret from the environment (
   `pnpm run infisical:check:cf -- --execute --environment=prod`
   prints presence only).

   `/admin/*` has no consent surface and mounts no gate, so
   `https://rebuildup.dev/admin/login` must not request
   `googletagmanager` even with a stored grant. The rule is
   `isAnalyticsMountPath` in `src/editorial/analytics/consent.ts`,
   called once by `__root.tsx#RootComponent`. Verify it with the
   committed unit table rather than a grep — an SSR page proves
   nothing here, because no route renders the tag on the server:

   ```bash
   pnpm exec vitest run src/editorial/analytics/consent.test.ts -t isAnalyticsMountPath
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
- `test` — `src/editorial/analytics/GoogleAnalytics.test.tsx` and
  `consent.test.ts` exercise the capture helper, the rendered
  markup, the consent decision rules (unset / denied / granted,
  storage refusal, Do Not Track / Global Privacy Control), and the
  Issue #286 SPA contract: one inline `gtag('config', …)` per
  document, one `page_view` per route change (deduped against the
  initial location), `/admin/*` never tracked, no captured ID →
  no tracking, no consent decision → no tracking, and the
  queue-`config` fallback for documents whose init snippet never ran.
- `pnpm run test:client` — `AnalyticsConsent.client.test.tsx` and
  `GoogleAnalytics.client.test.tsx` mount the gate and tracker under
  happy-dom and assert the browser-only contract (Issue #495):
  nothing before hydration, a stored grant mounts the loader, a
  withdrawal stops an already-loaded tag (`ga-disable-<ID>` plus a
  Consent Mode update), a refused write stops measurement, and a
  re-grant clears the opt-out flag **and** issues the matching
  `consent update` that restores analytics storage on the already-loaded
  tag. Not part of `validate:fast`; run it alongside the gate for
  analytics changes.
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
- `GoogleAnalyticsRouteTracker` (mounted with the loader inside
  `AnalyticsGate`, so only after a stored grant) pushes
  `gtag('event', 'page_view', …)` **once per client-side location
  change** (`pathname + searchStr`), deduped against the initial
  location so the initial load is never counted twice.
- `/admin/*` locations are never emitted; the tracker instance
  survives admin navigations so the first public page after
  leaving `/admin/*` is tracked.
- No captured measurement ID → the tracker is inert (same off
  switch as the script mount), and no consent decision → the
  tracker is not mounted at all.
- If the document's init snippet never ran (visit landed on
  `/admin/*`, where the GA scripts are excluded, then moved to a
  public route after a grant) the tracker bootstraps the official
  `dataLayer`/`gtag` queue and queues `js` + `config`; `config`
  records that page's page_view.

### ID supply on the client (Issue #286 diagnosis)

The root loader yields the ID during SSR; on the client
`cloudflare:workers` resolves to the empty stub
(`src/cloudflare/workers-stub.ts`), so the prop reaches the client
through the dehydrated loader state that `hydrateStart()` now
consumes (Issue #291 wired this in `src/client.tsx` — before that
fix the client re-ran loaders against the empty stub and the prop
stayed `undefined`). The write-once capture is **additionally seeded
from the bootstrap script the gate rendered** into the current
document (`<script src="…gtag/js?id=G-…">` — see
`readMeasurementIdFromDocument` in `GoogleAnalytics.tsx`) as a
belt-and-braces path for documents without dehydrated state. Since
Issue #495 that DOM node is client-only and exists exactly where a
stored grant allowed measurement (never on `/admin/*`, which has no
gate), so the off switch and the admin exclusion are unchanged.

Verified in the merged state (Issues #286 + #291 together): a
session that starts on `/admin/*` and reaches a public page via
client-side navigation receives the ID through the dehydrated prop
path, arms the tracker, and executes the queued config — the
admin-first gap that existed when only the DOM seed was available
is closed.

The React hydration mismatch that earlier versions of this runbook
recorded as pre-existing (`<Suspense>` vs `#app-root` on every
load) was fixed by Issue #291 (PR #298): `hydrateStart()` now
consumes the SSR handoff, so there are zero hydration page errors
and no `/_serverFn/*` loader re-runs on initial load.

## Out of scope

The Issue #171 body lists these as not part of the wire-up and they are
also not part of this runbook:

- **Cookie consent banner.** No longer out of scope: Issue #495
  shipped the consent surface (`AnalyticsConsentControl`) and the
  non-tracking default. This runbook's verification step above is
  the operator procedure for it. A jurisdiction-specific legal
  reading is a separate owner decision — see
  `docs/verification/privacy/analytics-disabled.md`.
- **Custom events / conversions.** Out of scope. Future tickets
  can extend `src/editorial/analytics/` with sibling components
  that emit typed events.
- **A separate rotation driver.** Out of scope; the value is a
  public identifier and the operator flow is the same as the
  initial setup.