# Phase B / 0.5.0 release-order invariant — 2026-09-27

> Status: release-safety constraint discovered during Issue #106/#99 follow-up.

## Invariant

`release-0-5-0 -> main` cannot be merged while production remains on the legacy
`BETTER_AUTH_SECRET`-only auth binding **unless** the deploy contract is first
returned to the legacy 2-name form.

Reason:

1. Cloudflare Workers Builds watches `main`, not `release-0-5-0`.
2. A release PR merge therefore immediately enters the production deploy path.
3. The configured deploy command is `pnpm run deploy:production:prepared`.
4. On the current release branch, that command runs the Infisical-backed deploy
   wrapper whose required runtime secret set is:
   - `BETTER_AUTH_SECRETS`
   - `MY_WEB_2026_CONSUMER_API_KEY`
5. `BETTER_AUTH_SECRET` is `AUDIT_ONLY_SECRETS` and is deliberately excluded
   from the Wrangler secrets payload.
6. Production currently has the restored legacy binding
   `BETTER_AUTH_SECRET` + `MY_WEB_2026_CONSUMER_API_KEY`, with
   `BETTER_AUTH_SECRETS` absent.

Therefore a `main` push with the current release contract is not a neutral 0.5.0
deploy: it crosses the Phase B secret boundary. Depending on Infisical prod
contents, it either fails closed for missing `BETTER_AUTH_SECRETS` or uploads
the versioned binding as part of deployment. Either outcome contradicts
`Phase B after release`.

## Safe ordering choices

Exactly one of these must be true before Release PR #91 merge:

- **Phase-B-first:** execute and verify Issue #89 through the versioned binding
  transition, then merge #91 and let Cloudflare Builds deploy the already-aligned
  contract; or
- **Legacy-release-first:** land a deliberate ticket reverting the production
  deploy contract on `release-0-5-0` back to the legacy 2-name form, release
  0.5.0 safely, and perform Phase B in a later separately gated change.

The current repository state satisfies neither choice. Release PR #91 must
remain Draft until the operator selects and completes one path.

## Non-effects

This document performs no production mutation, no secret read/write, no deploy,
and no release merge. Issue #89 remains operator-gated.