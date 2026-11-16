# Provenance: github-readme-stats-fast

This directory contains a **vendored copy** of the upstream
[Pranesh-2005/github-readme-stats-fast](https://github.com/Pranesh-2005/github-readme-stats-fast)
source code, adapted for Cloudflare Workers (Hono) runtime.

## Upstream Reference

- **Repository**: https://github.com/Pranesh-2005/github-readme-stats-fast
- **Commit SHA**: `8e2c76e59a9e2407f2c80f4e23704a04e8db21ad`
- **Commit Message**: `fix,feat,docs: fixed promise dedup in svgCache and added state while revalidate header to all api's, added trailing slash for one canonical form and updated actuall cache time in readme`
- **License**: MIT (see `LICENSE`)
- **Vendored Date**: 2026-11-16
- **Vendored By**: Issue #933 implementation

## Scope of Vendored Code

Only the following upstream modules are vendored (adapted for Workers runtime):

- `src/fetchers/stats.js` → `fetchers/stats.ts`
- `src/fetchers/top-languages.js` → `fetchers/top-languages.ts`
- `src/fetchers/streak-fetcher.js` → `fetchers/streak-fetcher.ts`
- `src/fetchers/repo.js` → `fetchers/repo.ts`
- `src/cards/stats.js` → `cards/stats.ts`
- `src/cards/top-languages.js` → `cards/top-languages.ts`
- `src/cards/streak-card.js` → `cards/streak-card.ts`
- `src/cards/repo.js` → `cards/repo.ts`
- `src/common/utils.js` → `common/utils.ts`
- `src/common/Card.js` → `common/Card.ts`
- `src/common/icons.js` → `common/icons.ts`
- `src/common/I18n.js` → `common/I18n.ts`
- `src/common/microCache.js` → `common/microCache.ts`
- `src/common/svgCache.js` → `common/svgCache.ts`
- `src/common/normalizeparam.js` → `common/normalizeparam.ts`
- `src/translations.js` → `translations.ts`
- `src/calculateRank.js` → `calculateRank.ts`
- `themes/index.js` → `themes/index.ts`

The following upstream modules are **NOT vendored** (out of scope for Issue #933):
- WakaTime card (`wakatime.js`, `gist.js`)
- Gist card (`gist.js`)
- UI preview (`ui/`)
- Express server (`express.js`)
- Vercel deployment config (`vercel.json`)

## Adaptations for Cloudflare Workers

1. **Runtime**: Replaced `axios` + `dotenv` with native `fetch` and Workers bindings.
2. **GraphQL Transport**: Uses `@octokit/graphql` via native fetch (or direct fetch to `api.github.com/graphql`).
3. **Caching**: In-memory `Map` caches (`microCache`, `svgCache`) work per-isolate; TTL values preserved.
4. **Environment Variables**: GitHub PATs read from `env.GITHUB_README_STATS_PAT_*` (numbered) and `env.GITHUB_TOKEN` fallback.
5. **Error Handling**: Error responses sanitized — no tokens, internal URLs, or stack traces in SVG output.
6. **TypeScript**: All modules rewritten in TypeScript with strict types.
7. **Module System**: ESM imports adapted for Workers/Vite bundling.

## Update Procedure

To update the vendored copy:

1. Clone upstream at target commit: `git clone https://github.com/Pranesh-2005/github-readme-stats-fast.git .reference/github-readme-stats-fast`
2. Check out target commit: `cd .reference/github-readme-stats-fast && git checkout <COMMIT_SHA>`
3. Diff against current vendored copy: `diff -ur external/github-readme-stats-fast/src .reference/github-readme-stats-fast/src`
4. Apply adaptations (TypeScript, Workers runtime, sanitization) to changed files.
5. Update this `PROVENANCE.md` with new commit SHA and date.
6. Run tests: `pnpm exec vitest run src/http/github-readme-stats/`

## License Compliance

- Upstream license: MIT (permissive, allows vendoring and modification).
- This vendored copy retains the upstream `LICENSE` file verbatim.
- Modifications are documented in this file and in commit history.
- No additional license restrictions imposed.