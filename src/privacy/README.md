# `src/privacy/**` — the published data lifecycle (Issue #496)

> Obligation: **what this platform stores, for how long, how it is
> deleted, where it leaves the deployment — and which of those sentences
> a visitor may read.**

`data-lifecycle.ts` is the single source of truth for the public
privacy wording. `src/home/privacy-notice.tsx` renders it; it does not
write any sentence of its own.

## Why this is a leaf obligation

The registry restates numbers that other obligations own —
`ACTOR_COOKIE_MAX_AGE_SECONDS` (`home/reactions/cookie.ts`),
`DEDUP_WINDOW_MS` (`http/access-counter/schema.ts`) — as prose, because
a privacy notice has to be readable and because importing them would
create a dependency on the very stores it describes. `leafOwners` in
`scripts/check-architecture.mjs` keeps this module from importing any
other obligation, and `data-lifecycle.test.ts` (exempt from the leaf
rule, like every `*.test.*` under a leaf) asserts the prose against the
real constants. A changed constant that is not republished here fails
`pnpm run test`.

## Entries

| id | stores | retention | deletion channel | external transfer | senders |
| --- | --- | --- | --- | --- | --- |
| `actor-cookie` | random 32-hex id, browser cookie | 1 year (`Max-Age`) + server-side copy in `reactions.actor_id` | visitor action (toggle) | none | — |
| `reaction-rows` | target / actor / principal / kind / value / created_at | none — no expiry column, no purge job | visitor action | none | — |
| `access-counter` | aggregate counts + per-request dedup UUID | dedup expires after 60 min, purged only on the same id's next hit | operator action | none | — |
| `analytics-events` | this platform’s code sends the measurement id + `page_path` / `page_location` / `page_title`; GA4 collects the referrer and the browser / device information itself | Google's property setting — not verifiable here | third party | Google Analytics 4 | `platform-code`, `third-party-automatic` |
| `admin-auth` | operator email / password hash / sessions (incl. the client IP address and the user-agent string) / invitations | 30-day session, invitation expiry | operator action | none | — |
| `contact-surface` | nothing — the page has no form | not applicable | not applicable | none | — |

Each entry carries `evidence` pointers into `src/**`, `migrations/*.sql`
and `wrangler.jsonc`, and `publication.status`:

- `approved` — rendered by `<PrivacyNotice />`.
- `pending` — kept here so the fact is not lost, rendered nowhere.

`getPublishedDataLifecycle()` is fail-closed: an unknown status is not
published. The same filter (`filterPublishedEntries`) runs inside
`<PrivacyNotice />`, so the rule holds for whatever set the component
is handed.

## Scope by sender (Issue #662)

A send claim is scoped by **who sends the value**, not by the data item.
Two senders carry the same kind of item: this platform's own code sends
the measurement id and the path, and GA4 collects the referrer and the
browser / device information itself. One sentence covering both ("what
is sent is the measurement id and the path information") reads as
excluding the second — and contradicts the consent banner
(`src/editorial/analytics/AnalyticsConsent.tsx`), which names it
plainly.

`transfer.senders` therefore carries one scope per sender, and
`<PrivacyNotice />` renders each of them under the 「送信者:」 heading.
`findSendScopeViolations()` fails closed:

- an entry that claims an outward transfer and names no sender is an
  error;
- an entry whose target is `google-analytics-4` and that does not
  separate `platform-code` from `third-party-automatic` is an error;
- an entry that sends nothing outward and names a sender is an error;
- a scope that carries no text in one of the two locales is an error.

The module-level integrity check runs the same rule, so a registry that
breaks it fails the Worker boot instead of shipping a notice whose
scope contradicts the banner.

## Two sentences that are scoped, not absolute

Both limits below are repository facts, and the published wording names
them instead of claiming more than the code supports.

- **Analytics query strings.** `stripAnalyticsQuery` reaches the SPA
  route-change `page_view` only. The first `page_view` is recorded by
  `gtag('config', …)`, where GA reads `document.location` itself, so
  this repository cannot strip the query string there — the limit
  `docs/security/log-redaction.md` ("Known limits") records. Overriding
  `page_path` in the config call would re-decide the Issue #286 contract
  ("`config` records the first page_view exactly once"), so it belongs
  to that Issue and not to this registry.
- **The invited email address.** `/admin/invitations/accept?token=…` is
  an unauthenticated route: its loader only probes the token, and the
  view prints the probed address while the invitation is still valid.
  The password hash and the session token stay behind the auth
  boundary; the address does not.

## Refusals

`UNSUPPORTED_PUBLIC_CLAIMS` lists the claims the public wording must
never make, each with the repository fact that falsifies it: anonymity,
a deletion-request channel, an unqualified "nothing leaves", automatic
deletion. `findUnsupportedClaims()` is asserted against the published
sentence set and against a served document in
`test/integration/data-lifecycle.test.ts`.

A missing or unproven fact is a `pending` entry or an open decision, not
a sentence. Nothing here is inferred from what a typical site would say.

## Changing an entry

1. Change the implementation, not the registry (or both, in one commit).
2. Update the entry's sentences and its `evidence` pointers.
3. Run `pnpm run test` — the constant cross-checks and the served-HTML
   claim check are the authority, not this README.