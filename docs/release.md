# Release

> my-web-2026 release workflow. Built on the project-init GitHub
> delivery policy. See [`skills/github-delivery/SKILL.md`](../skills/github-delivery/SKILL.md)
> for the operational details.

## Cadence

Current release identity is **not duplicated in this document**. `package.json#version`
is the sole current-version source; release branches are named `release-x-y-z` and
`pnpm run version:check` rejects a branch/version mismatch. Historical release numbers
below remain literal records.

- One sprint = one week.
- One sprint = one target semantic version = one release branch
  `release-x-y-z`.
- 0.1.0 Foundation was released on 2026-09-11.
- 0.2.0 Public Preview was released on 2026-09-19.
- 0.3.0 Editorial Reactions was released on 2026-09-20.
- my-web-2025 remains the complete public edition until required capabilities
  are migrated; cutover timing follows capability readiness rather than a fixed date.

## Sprint cycle

1. Decide target version, sprint window, release date.
2. Branch `release-x-y-z` from `main`.
3. Define the sprint goal.
4. Select Ready tickets (respecting dependency and capacity).
5. Each ticket:
   - Create `<issue-number>` branch from `release-x-y-z` (or from the
     immediate predecessor branch when stacked).
   - First meaningful commit immediately.
   - `git push -u origin <branch>`.
   - Verify `git rev-parse origin/<branch>` equals the local commit.
   - Open Draft PR with linked Issue / assignee / reviewer / labels /
     target release / stack context.
   - Implement.
   - `pnpm run validate:integration`.
   - Move to Ready.
6. Land via the canonical merge path:
   - Independent ticket: PR merge into `release-x-y-z`.
   - Stacked ticket: stack landing from the bottom of the stack.
7. Reconcile Issue / Project state after landing.
8. Run `pnpm run validate:release` on `release-x-y-z`.
9. Open / update the Draft release PR (`release-x-y-z -> main`) once
   the branch has any meaningful integrated difference.
10. Merge the release PR (only after `main` protection / ruleset
    allows it AND the repository owner has given explicit human
    approval in the current interaction — see the Release PR
    merge human gate above).
11. Tag the merged commit with `v<version>` (also gated by the
    human approval rule above).
12. Re-plan any unfinished tickets for the next sprint.

## Repository visibility

- Canonical remote: `https://github.com/rebuildup/my-web-2026.git`.
- Visibility: **public**.
- License: MIT (see [`LICENSE`](../LICENSE)).

## Public repository main protection checklist

When visibility is `public`, `main` MUST be protected by a ruleset
that enforces the following. As of v0.1.0 (2026-09-11) all items
below are in place; ruleset id `#22942689` (`main-protection`).

- [x] Branch protection / ruleset on `main` exists.
- [x] Direct push disabled.
- [x] Force push disabled (`non_fast_forward` rule).
- [x] Deletion disabled (`deletion` rule).
- [x] PR required for any change (`pull_request` rule).
- [x] Required status check `validate` on every PR; on push to
      `release-*` the additional `cf-typegen check` step and
      Playwright E2E (with the `ui-change` label gate on PR) must
      pass.
- [x] `release-* -> main` only is enforced via the head-ref
      policy check in `.github/workflows/ci.yml` (PRs into `main`
      whose `head_ref` does not match `^release-` fail the check).
- [x] Required review count: **zero** (`required_approving_review_count: 0`).
      Solo-development repos cannot use the repository owner as a
      required approver because GitHub does not count the PR
      author's own review. The release-PR human gate (see below)
      is the explicit approval mechanism instead.

### Release PR merge human gate

The repository owner is the sole authority that can approve a
release PR merge, the release tag push, and the GitHub Release
publication. See
[`skills/github-delivery/SKILL.md#release-pr-merge-human-gate-canonical-rule`](../skills/github-delivery/SKILL.md)
for the canonical wording. Agents MUST stop before any of those
three operations and surface the readiness status for explicit
human approval. This rule is codified in AGENTS.md §6 and was
introduced after the v0.1.0 retrospective.

### Bootstrap exception (0.1.0 RC only, historical)

The foundation cleanup commits on `release-0-1-0` were formed
**directly on the release branch** without an Issue / Draft PR /
ticket branch. This was a documented one-time exception during the
bootstrap of a new public repository: there were no Issues, no PRs,
and no rulesets yet, so the canonical Issue-driven flow could not
be followed. From 0.2.0 onward **every commit lands through the
canonical flow**; the v0.1.0 reconciliation was driven by Issue #1
(`0.1.0 release reconciliation`).

## 0.2.0 Public Preview

0.2.0 is the first release intended to be useful as a public preview rather
than only as platform foundation.

### Release outcome

- Canonical `GET /` home surface with Hero / Capabilities / Platform health /
  Footer composition.
- The public identity is grounded as 木村友亮 / samuido while `my-web-2026`
  remains the platform / repository name.
- The complete 2025 edition remains linked during migration.
- Portfolio / Content / Activity are explicit planned capabilities rather than
  implied complete features.
- Internal D1 status reads use a safe failure contract that does not expose raw
  binding errors.
- Personal / domain documentation distinguishes current product truth,
  migration evidence, temporal personal state, and owner authority.
- Release validation includes integration checks, Cloudflare type generation,
  and Playwright E2E on release-branch pushes.

### Included delivery

- Skills / delivery foundation: #7, #9, #11, #13
- Runtime / internal data path: #16, #25
- Home public surface: #22, #27
- Personal / domain grounding: #26

### Release gate

Before merging `release-0-2-0 -> main`:

1. ticket PRs targeted for 0.2.0 are landed or explicitly deferred;
2. release-branch push CI is green, including Playwright E2E;
3. package / visible version / release documentation all report 0.2.0;
4. production deployment is smoke-tested against the public Worker URL;
5. repository owner gives the explicit release-merge approval required below.

For 0.3.0 and later, the release gate also requires the canonical
production domain to be wired (Issue #43 / ADR-0014):

6. Operator has walked through the home / admin / reactions /
   counter surfaces **on the local dev server** (`pnpm run dev`)
   with their own eyes, against the `__root.tsx` + `bootstrap:home-api-key`
   wiring introduced by this ticket. The dev verify path is
   documented in `ADR-0014 §5.1`; it is the precondition for
   step 7 (the release PR merge human gate). The operator must NOT
   ship to production without having seen the home surface working
   locally first.
7. `https://rebuildup.dev` responds 200 on `/`, `/admin/login`, and
   `/api/v1/health`. `BETTER_AUTH_URL` is pinned in the companion
   file `wrangler.production.jsonc vars` and applied by `.github/workflows/deploy-production.yml`. A merge to `main`
   (which can only happen through an explicitly approved release PR) starts the normal
   main CI. A successful main CI run triggers the production deployment for that exact
   SHA; `workflow_dispatch` remains the recovery/rerun entry point. The job builds, applies remote D1 migrations, ensures the stable
   home-consumer API key row, and performs one production `wrangler deploy --secrets-file`
   so Worker code and both runtime secrets become active together. The required
   production-environment secrets are `CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID`, `BETTER_AUTH_SECRET`, and
   `MY_WEB_2026_CONSUMER_API_KEY`. A reusable `production smoke` job runs
   automatically after deploy and can also be dispatched manually. The operator
   still walks through the home / admin / reactions / counter surfaces on the
   canonical URL before publishing the GitHub Release. The
   `*.workers.dev` URL is debug-only and not documented as
   canonical.

## 0.1.0 Foundation backlog

| Issue | Title                                                       | Depends on | Priority |
| ----- | ----------------------------------------------------------- | ---------- | -------- |
| #001  | Runtime wiring fix                                          | —          | P0       |
| #002  | Repository hygiene fix                                      | —          | P0       |
| #003  | Design system foundation                                    | —          | P0       |
| #004  | Quality gate rebuild (Biome + CI dedup + actionlint)       | —          | P0       |
| #005  | Module restructure (modules/ + http/)                      | #001       | P0       |
| #006  | D1 binding smoke (local workerd SELF)                       | —          | P1       |
| #007  | R2 binding smoke (local workerd SELF)                       | —          | P1       |
| #008  | GitHub delivery setup (main protection + Project + Issues) | —          | P0       |
| #009  | Cut the 0.1.0 release PR (CF real smoke + tag)             | #001–#008  | P0       |
| #010  | Storybook 8.6 + 3 Panda recipe seeds (design-system surface) | #003      | P1       |
| #011  | Playwright 1.63 (chromium HTTP-only E2E) + CI wiring       | #001       | P1       |

(Issue numbers are placeholders. The real numbers are assigned by
GitHub when the Issues are opened.)

Dependency graph:

```
#001 ── #005
#001 ── #011
#003 ── #010
#002 (independent)
#004 (independent)
#006 ──┐
       ├─ #009 (release cut)
#007 ──┤
#008 ──┘
#010 ┐
#011 ┘
```

> Note: #006 / #007 in this backlog are **local Miniflare-simulated**
> SELF smokes via `@cloudflare/vitest-plugin`'s workerd pool. They
> confirm the Worker entry + Hono + binding-API wiring. They do **not**
> confirm real Cloudflare D1 / R2 resources. Real-resource smoke is
> part of #009 (the release cut), not #006 / #007.

## Tools / external subdomain policy

my-web-2026 may host Tools under `tools.<domain>` or as
sub-paths. The Tool Registry ticket (#005 design) is responsible for
the policy; individual Tool tickets follow the convention in
[ADR-0006](adr/ADR-0006-tools-submodule-policy.md).

## Patch releases

Emergency / critical-security patch releases follow the same path —
they create `release-x-y-z` from the current `main`, land the fix
in a normal ticket PR, and merge the release PR. `main` is never
updated directly.

## Post-release

- Tag the merged commit with `v<version>`.
- Update any downstream consumers (Tools submodules, RSS feeds,
  integration endpoints) according to their own release cadence.
- Archive the release branch once the next sprint starts (the
  branch is no longer the integration line).
