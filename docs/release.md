# Release

> my-web-2026 release workflow. Built on the project-init GitHub
> delivery policy. See [`skills/github-delivery/SKILL.md`](../skills/github-delivery/SKILL.md)
> for the operational details.

## Cadence

- One sprint = one week.
- One sprint = one target semantic version = one release branch
  `release-x-y-z`.
- 0.1.0 Foundation is the first release; planned for 2026-09.
- Full migration from my-web-2025 is planned for 2026-10.

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
    allows it).
11. Tag the merged commit with `v<version>`.
12. Re-plan any unfinished tickets for the next sprint.

## Repository visibility

- Canonical remote: `https://github.com/rebuildup/my-web-2026.git`.
- Visibility: **public**.
- License: MIT (see [`LICENSE`](../LICENSE)).

## Public repository main protection checklist

When visibility is `public`:

- [ ] Branch protection / ruleset on `main` exists.
- [ ] Direct push disabled.
- [ ] Force push disabled.
- [ ] Deletion disabled.
- [ ] PR required for any change.
- [ ] Required status checks: `validate` (PR); on `release-* -> main`
      the additional `cf-typegen check` step inside the same `validate`
      job must pass.
- [ ] `release-* -> main` only is enforced (either by ruleset pattern
      or by a required status check).
- [ ] Required reviews: at least one (operator can self-review until a
      second maintainer is added).

These boxes intentionally start **unchecked** at 0.1.0 RC. They become
checkable only after the operator runs the GitHub UI / `gh` commands
documented in `docs/backlog-0.1.0.md#008-github-delivery-setup`. Until
that happens, this checklist is the **target state**, not the current
state — a doc that claims the ruleset exists while GitHub returns 0
rulesets is dangerous.

### Bootstrap exception (0.1.0 RC only)

The eight Foundation cleanup commits on `release-0-1-0` were formed
**directly on the release branch** without an Issue / Draft PR /
ticket branch. This is a documented one-time exception during the
bootstrap of a new public repository: there were no Issues, no PRs,
and no rulesets yet, so the canonical Issue-driven flow could not be
followed. From 0.2.0 onward **every commit lands through the canonical
flow**, starting with the `0.1.0 release reconciliation` Issue that
drives #009 (CI green, real Cloudflare smoke, `v0.1.0` tag).

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
