# Contributing to my-web-2026

> Welcome. This file documents the contribution workflow and the
> invariants every change must respect.

## Repository

- Canonical remote: `https://github.com/rebuildup/my-web-2026.git`.
- Visibility: public.
- License: MIT (see [`LICENSE`](./LICENSE)).

## Quick start

```bash
# corepack is forbidden (see ADR-0003); install pnpm directly.
npm install -g pnpm@12.3.4
pnpm install
pnpm prepare
pnpm run validate:fast
pnpm dev
```

Detailed bootstrap, run, and troubleshooting steps are in
[`docs/development.md`](docs/development.md).

## Sprint workflow

One sprint = one week = one target version. The canonical weekly
procedure is documented in [`docs/release.md`](docs/release.md) and
[`skills/github-delivery/SKILL.md`](skills/github-delivery/SKILL.md).

- Branch per Issue number: `<issue-number>` (no `issue/` prefix,
  no slug).
- Branch per release: `release-x-y-z`.
- All `release-x-y-z` updates land via Draft PRs and merge into
  `main` through `release-x-y-z -> main`.
- Stacked tickets base on the immediate predecessor branch, not on
  the release trunk.
- Every active ticket branch must have a Draft PR with linked Issue,
  assignee, reviewer, labels, target release, and stack context.

## Stack rules (do not violate)

- Do not add Bun, Tailwind, KV, Queues, Durable Objects, Workflows,
  Vectorize, or Workers AI to 0.1.0. Each requires a separate ADR.
- Do not import from `hono`, `@tanstack/react-start`, or any
  Cloudflare SDK inside capability / domain / application code.
- Server functions (`createServerFn`) live next to the route file
  that uses them, or under `src/modules/<capability>/server.ts`.
- External HTTP handlers live under `src/http/**`. The Worker entry
  is `src/server.ts`.

See [`docs/architecture.md`](docs/architecture.md) and
[`docs/adr/`](docs/adr/) for the canonical decisions.

## Validation

Every PR must pass `pnpm run validate:integration`. The `release-x-y-z`
branch must additionally pass `pnpm run validate:release`. Both
gates are run identically locally and in GitHub Actions.

## Security

Vulnerabilities and credential leaks follow the triage workflow in
[`docs/security.md`](docs/security.md). For urgent / out-of-band
reports, contact the maintainer directly via the channel listed in
`docs/security.md` before opening a public GitHub Issue.

## Decisions

Architecture changes that are not trivially reversible require an ADR
under `docs/adr/`. The decision precedence is in
[`skills/engineering-decisions/SKILL.md`](skills/engineering-decisions/SKILL.md).
