# GitHub Readme Stats self-hosting (Issue #933)

Runbook for the self-hosted `github-readme-stats-fast` endpoints the
Worker serves under `/api/v1/github-readme-stats/` and the profile
README (`rebuildup/rebuildup`) will point at. For the ordered
production connection sequence across all three v0.9.0 live feeds see
[`live-data-connections.md`](live-data-connections.md).

## Endpoints

| Card | Path |
|---|---|
| Stats | `GET /api/v1/github-readme-stats/api?username=<u>` |
| Top languages | `GET /api/v1/github-readme-stats/api/top-langs/?username=<u>` |
| Streak | `GET /api/v1/github-readme-stats/api/streak?username=<u>` |
| Repo pin | `GET /api/v1/github-readme-stats/api/pin/?username=<u>&repo=<o/r>` |

Upstream parameters (`theme`, `layout`, `locale`, `hide`, …) are
compatible — the vendored code is
`src/vendor/github-readme-stats-fast/` (Pranesh-2005,
commit `8e2c76e`, MIT — see `PROVENANCE.md`).

## Required secret — the one remaining gate

The vendored fetchers call the GitHub **GraphQL** API, which
requires a token. Without one every endpoint answers **HTTP 503**
with a short-lived degraded SVG (`Service unavailable`) — see
"Failure behaviour". Routing, content type and the degraded
contract work, but no real card renders until a token is bound.

Token resolution order (`src/vendor/.../common/utils.ts`):
`GITHUB_README_STATS_PAT_1..10` → `GITHUB_TOKEN`.

Provision ONE dedicated fine-grained PAT (public-read scopes only —
the cards read public profile data; do NOT reuse a `repo`-scoped
token on the public Worker):

```sh
# contract-managed path (the ONLY supported path — Issue #969):
#   1. owner creates the fine-grained PAT
#   2. seed Infisical prod + dev as GITHUB_README_STATS_PAT_1
#      (infisical secrets set --env=prod --path=/ GITHUB_README_STATS_PAT_1)
#   3. the name is already in secrets.required
#      (wrangler.jsonc, wrangler.production.jsonc,
#      _cloudflare-contract.mjs, quality/secret-rotation-ledger.json)
#   4. the next `cf deploy --prebuilt --secrets-file` binds it
```

There is deliberately NO `wrangler secret put` / `cf workers secrets`
interim path: a secret bound outside the Infisical → deploy pipeline
would diverge between local development and the deployed Worker, and
the next deploy would not know how to reproduce it. If the PAT is
seeded only in Infisical `prod`, `check-cf-secrets` Tier 1 passes and
`run-deploy-inner.mjs` writes it into the deploy secrets file.

For local dev, seed the same name in the Infisical `dev` env —
`pnpm dev` injects it. Do NOT copy the value into `.dev.vars` or any
other local file: the Infisical env is the single source so the local
and deployed paths cannot diverge.

## Verification

```sh
# all four endpoints, real token bound
for p in 'api?username=rebuildup' 'api/top-langs/?username=rebuildup' \
         'api/streak?username=rebuildup' \
         'api/pin/?username=rebuildup&repo=my-web-2026'; do
  curl -sI "https://rebuildup.dev/api/v1/github-readme-stats/$p" \
    | grep -iE 'HTTP/|content-type|cache-control'
done
# expect: 200, image/svg+xml, cache headers; body is a real card
# (a 503 "Service unavailable" body means the token is NOT bound)
```

Contract tests: `src/http/github-readme-stats/router.test.ts`
(24 cases — params, cache/ETag, degraded-state contract, error
sanitisation, locale).

## README migration plan (`rebuildup/rebuildup` — separate repo)

1. **Precondition**: production `rebuildup.dev` answers real SVGs
   for all four endpoints (verification above). Do NOT switch URLs
   before this — the whole point is identical images.
2. In `rebuildup/rebuildup` README, replace the four
   `https://github-readme-stats-fast.vercel.app/...` image URLs with
   `https://rebuildup.dev/api/v1/github-readme-stats/...` keeping
   the same query parameters. Open a PR in that repo (its own
   review flow — this repo's ticket PRs do not cover it).
3. **Rollback**: the change is a pure URL swap in markdown; revert
   the README commit to return to the Vercel-hosted images. Keep
   the Vercel URLs in the PR description for one release cycle.
4. After the README deploys and renders correctly, the Vercel
   dependency is fully retired; no code change is needed here.

## Failure behaviour — degraded-state contract

Two response classes, deliberately distinct:

- **Per-request errors stay HTTP 200 error SVG** (upstream
  contract): blacklisted username, unsupported locale/layout,
  missing params, user/repo not found. These describe the
  *request*, not the service.
- **Service degradation returns HTTP 503** with
  `Cache-Control: max-age=60, s-maxage=60` and a generic
  `Service unavailable` SVG (`src/http/github-readme-stats/router.ts`
  `degradedResponse`):
  - no GitHub token configured (`GITHUB_README_STATS_PAT_*` and
    `GITHUB_TOKEN` all absent) — checked before any upstream call;
  - any upstream `CustomError` that is not `USER_NOT_FOUND`
    (GraphQL/REST API failure, `MAX_RETRY` rate-limit exhaustion,
    dynamically-typed upstream errors).

  The 503 body never carries the upstream message, token names, or
  internal detail, and the short cache window keeps an outage from
  being pinned as a normal card by CDN or `<img>` consumers.

- Non-`CustomError` throws still render the sanitized 200 error SVG.
- Caching: microCache 5 s (data) + svgCache 5 min (rendered SVG) +
  HTTP cache headers — external hot-linking is cheap. Failed fetches
  are never written to microCache.
