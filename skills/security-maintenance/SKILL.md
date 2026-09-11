---
name: security-maintenance
description: my-web-2026 で実際に使っている version に紐付く framework / runtime / dependency の advisory を triage し、target release へ割り当てる。
---

# Security Maintenance (my-web-2026)

## Source priority

1. Official framework / runtime / SDK advisory (Cloudflare, TanStack,
   Hono, Panda, Vite, Wrangler).
2. Official release / security announcement.
3. Ecosystem advisory source (npm audit, GitHub Security Advisories).
4. Maintainer patch information.
5. Trusted secondary source.

## Inventory

Tracked in `quality/profile.yaml#stack` plus `package.json`. When a
package changes version, re-evaluate its advisory feed.

Current pinned stack (2026-09-11):

- `wrangler@^4.131.0`
- `@tanstack/react-start@^1.168.52`
- `@tanstack/react-router@^1.168.52`
- `hono@^4.13.7`
- `@pandacss/dev@^1.12.1`
- `vite@^7.1.0`
- `vitest@~4.1.0`
- `react@^19.2.0`

## Prioritisation

Severity is one input. Project reachability, external exposure,
required privilege, impact scope, fix availability, workaround
quality, regression risk, and target release timing all matter.

P0: critical, reachable, exposed -> patch release can interrupt the
current sprint.
P1: high, reachable -> next planned release.
P2: medium -> back of the target release.
P3: low / informational -> next hygiene sweep.

## Response workflow

1. Detect (advisory feed, GitHub alert, manual review).
2. Triage (reachability + exposure).
3. Decide priority.
4. Open a GitHub Issue tagged `security` with the affected package,
   target release, reproduction if known.
5. Implement the fix in a normal ticket branch (`<issue-number>`) or
   a patch release branch (`release-x-y-z`).
6. Run `pnpm run validate:release` before the release PR merges.
7. Reconcile the Issue only after the fix lands on the release trunk.

## Automated checks

- `wrangler types` regenerates binding types; treat schema drift as a
  possible advisory signal.
- GitHub secret scanning is enabled as an asynchronous CI job (see
  `quality/profile.yaml#security_gates.secret_scanning`).
- Dependency review, code scanning, SBOM are deferred to a post-0.1.0
  ticket.

## Re-evaluation triggers

- A pinned package moves to a new major version.
- An advisory is published for any pinned package.
- The CI / Actions billing model changes.
- An escaped incident in the live environment.
