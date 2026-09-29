# Google Analytics 4 — production wire-up

> Source of truth for the GA4 production wiring on
> `https://rebuildup.dev`. Cross-linked from
> [`AGENTS.md §4`](../../AGENTS.md) and Issue #171.

## Identity model

The GA4 property ships under a single public measurement ID of the
shape `G-XXXXXXX` issued by GA4 when the operator registers the
property. The ID is a **non-secret public identifier** — it appears
in client-side `gtag` snippets on every visitor's browser and is
already visible in the network panel of every visitor's DevTools,
so it does not need the secret containment treatment that
`BETTER_AUTH_SECRETS` or `MY_WEB_2026_CONSUMER_API_KEY` get.

| Side | Location | Lifecycle |
| --- | --- | --- |
| Measurement ID value (`G-XXXXXXX`) | `wrangler.jsonc#vars.GOOGLE_ANALYTICS_MEASUREMENT_ID` and the production mirror `wrangler.production.jsonc#vars.GOOGLE_ANALYTICS_MEASUREMENT_ID` | committed to source control |
| Empty default `""` | same vars block | committed to source control (shipped 0.5.0 baseline) |
| Type augmentation | `src/cloudflare/auth/env.d.ts` (`GOOGLE_ANALYTICS_MEASUREMENT_ID?: string`) | committed; tracks `wrangler.jsonc` |
| Render gate | `src/routes/__root.tsx#loader` (server-side read) + `src/editorial/analytics/GoogleAnalytics.tsx` (component, public paths only) | committed |
| Exclusion gate | `useRouterState` selector on `state.location.pathname.startsWith('/admin')` in `__root.tsx` | committed |

The Wire is off by default: both wrangler files ship with
`GOOGLE_ANALYTICS_MEASUREMENT_ID: ""`, the env augmentation declares
the field as `string | undefined`, and `GoogleAnalytics` renders
`null` for any falsy value. Operators therefore do not need to
remove a script tag — leaving the var unset (or empty) is the
canonical off switch.

## Initial setup

To wire GA4 into production for the first time:

1. **Register a GA4 property** at <https://analytics.google.com/> for
   the canonical origin `https://rebuildup.dev`. Note the
   measurement ID (`G-XXXXXXX`) the property page issues.

2. **Edit both wrangler configs** to set the value. In
   `wrangler.jsonc`:

   ```jsonc
   "vars": {
       "MY_WEB_2026_REACTIONS_TARGET": "home-page",
       "MY_WEB_2026_COUNTER_KEY": "home-page",
       "GOOGLE_ANALYTICS_MEASUREMENT_ID": "G-XXXXXXX"
   }
   ```

   Mirror the same edit in `wrangler.production.jsonc#vars`. The
   value is the same in dev and production — GA4 does not require
   per-environment properties.

3. **Commit the change on a ticket branch.** Per
   `AGENTS.md §6` the canonical flow is:

   ```bash
   git checkout -b 171 release-0-5-0   # use the relevant ticket number
   # edit wrangler.jsonc and wrangler.production.jsonc
   git commit -m "feat(analytics): enable GA4 wire-up (#171)"
   git push -u origin 171
   gh pr create --draft --base release-0-5-0 ...
   ```

   The agent must not log, print, or paste the `G-XXXXXXX` value
   into commit messages, PR bodies, chat transcripts, or runbook
   prose. The runbook describes the *contract*; the value lives
   only in the committed config files.

4. **Land on the release trunk** via the standard PR review +
   merge. Cloudflare Workers Builds deploys the new config to
   production; the next request to `/`, `/about`, `/contact`,
   `/portfolio`, or `/tools` returns HTML that contains the GA
   `<script async>` tag in `<head>`.

5. **Verify in production** (operator session, no agent transcript):

   ```bash
   curl -sS https://rebuildup.dev/ | grep googletagmanager
   ```

   Expect one `<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX">`
   line, plus the inline `gtag('config', 'G-XXXXXXX')` script.

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
`pnpm run deploy:production`. Both vars carry the same value when
GA is enabled; either file with the var set to a non-empty value
wires the script on the corresponding environment.

Setting one without the other is a misconfiguration, not a feature:
the resulting environment renders nothing. The mirroring rule is
documented in `wrangler.production.jsonc`'s header comment and is
the same rule that applies to every other shared var
(`MY_WEB_2026_REACTIONS_TARGET`, `MY_WEB_2026_COUNTER_KEY`,
`MEDIA_PUBLIC_BASE_URL`, `BETTER_AUTH_URL`).

## Why a `var`, not a secret

| Property | Decision |
| --- | --- |
| Identifier class | Public (visible in every visitor's network panel) |
| Rotates with deployment? | Rare (only on property migration) |
| Operators must read the value before writing? | No — write GA4 directly |
| Must NOT enter agent transcript / logs | True (compliance hygiene, not security) |
| Worker secret vs var | **Var** — no need for the Infisical-managed runtime-secret handshake documented in [`docs/runbook/cloudflare-workers-builds.md`](cloudflare-workers-builds.md) |

Putting it in `wrangler.jsonc#vars` (committed to source control)
removes it from the AGENTS.md §4 value-listing concern entirely:
the value travels with the commit, no `infisical secrets …` call
ever needs to be issued to verify presence.

## Rotation

GA4 does not require rotation in the security sense. The two
operational reasons to change the value are:

- The operator migrates to a new GA4 property (e.g. splits traffic
  by environment, hands the property to a different GA account).
- The property was leaked into a context where its predecessor
  should be revoked.

In both cases the procedure is the same as the initial setup:
edit both wrangler files, commit on a ticket branch, land via the
PR review process. There is no separate "rotation" pathway
because the value is not a credential.

## Acceptance

The `pnpm run validate:fast` gate is the canonical local check.
It runs:

- `format:check` and `lint:check` (Biome) — covers the
  `__root.tsx`, `GoogleAnalytics.tsx`, and wrangler JSON edits.
- `architecture:check` — the new `routes -> editorial` edge is
  registered in `AGENTS.md §3`.
- `typecheck` — `src/cloudflare/auth/env.d.ts` augmentation keeps
  `worker-configuration.d.ts` in sync (`pnpm run cf-typegen:check`
  is the `validate:release`-only check for that).
- `test` — `src/editorial/analytics/GoogleAnalytics.test.tsx`
  exercises the capture helper and the rendered markup, including
  the empty / undefined / whitespace-only / capture-once branches
  and the URL-encoding + inline-script escaping rules.

A failing test means the wire-up has drifted and the PR is not
merge-ready. The canonical gate is the per-ticket PR review
against `release-0-5-0` — ticket PRs do not require per-merge
operator auth (the release-merge human gate covers release PR /
tag / GitHub Release only, per the canonical scope rule).

## Out of scope

The Issue #171 body lists these as not part of the wire-up and they are
also not part of this runbook:

- **Cookie consent banner.** Out of scope per Issue #171 body. If a
  visitor jurisdiction requires consent in the future, the
  acceptance gate moves to a separate ticket.
- **Single Page Application pageview tracking.** The wire-up is
  load-time only — `gtag('config', ...)` records the initial
  pageview on first load. Subsequent client-side navigations do
  NOT push `gtag('event', 'page_view', ...)` calls. Adding
  SPA-style tracking requires a separate ticket so the
  load-event hook (the `useRouterState` subscription pattern)
  can be designed in isolation.
- **Custom events / conversions.** Out of scope. Future tickets
  can extend `src/editorial/analytics/` with sibling components
  that emit typed events.