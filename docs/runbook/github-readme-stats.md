# GitHub Readme Stats self-hosting (Issue #933)

Runbook for the self-hosted `github-readme-stats-fast` endpoints the
Worker serves under `/api/v1/github-readme-stats/` and the profile
README (`rebuildup/rebuildup`) will point at.

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
requires a token. Without one every endpoint answers HTTP 200 with
an error SVG (`GitHub token not configured`) — routing, content
type and the error contract all work, but no real card renders.

Token resolution order (`src/vendor/.../common/utils.ts`):
`GITHUB_README_STATS_PAT_1..10` → `GITHUB_TOKEN`.

Provision ONE dedicated fine-grained PAT (public-read scopes only —
the cards read public profile data; do NOT reuse a `repo`-scoped
token on the public Worker):

```sh
# interim binding (persists across deploys — deploys preserve
# existing Worker secrets and only rewrite secrets.required names)
wrangler secret put GITHUB_README_STATS_PAT_1 --name <worker-name>

# preferred long-term path (contract-managed):
#   1. owner creates the fine-grained PAT
#   2. seed Infisical prod + dev as GITHUB_README_STATS_PAT_1
#   3. add the name to secrets.required (wrangler.jsonc,
#      wrangler.production.jsonc, _cloudflare-contract.mjs,
#      quality/secret-rotation-ledger.json) — a separate ticket,
#      because making it required blocks deploys until seeded
```

For local dev, add the same name to `.dev.vars` (gitignored) or to
the Infisical `dev` env — `pnpm dev` injects the dev env.

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
# (not the "GitHub token not configured" error SVG)
```

Contract tests: `src/http/github-readme-stats/router.test.ts`
(19 cases — params, cache/ETag, error sanitisation, locale).

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

## Failure behaviour

- Missing/invalid token → error SVG (HTTP 200), never a 5xx and
  never a leaked token/URL/stack in the body.
- GitHub API failure → error SVG; the rest of the site is
  unaffected (the home `<img>` simply shows the upstream error
  card; consider a follow-up to hide the img on error if desired).
- Caching: microCache 5 s (data) + svgCache 5 min (rendered SVG) +
  HTTP cache headers — external hot-linking is cheap.
