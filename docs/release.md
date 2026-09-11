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
- `main` is protected by a ruleset that requires a passing `validate`
  check on every PR and a `validate-release` check on `release-* -> main`.

## Public repository main protection checklist

When visibility is `public`:

- [x] Branch protection / ruleset on `main` exists.
- [x] Direct push disabled.
- [x] Force push disabled.
- [x] Deletion disabled.
- [x] PR required for any change.
- [x] Required status checks: `validate`.
- [x] `release-* -> main` only is enforced (either by ruleset pattern
      or by a required status check).
- [x] Required reviews: at least one (operator can self-review until a
      second maintainer is added).

## 0.1.0 Foundation backlog

| Issue | Title                                                       | Depends on | Priority |
| ----- | ----------------------------------------------------------- | ---------- | -------- |
| #001  | Runtime wiring fix                                          | —          | P0       |
| #002  | Repository hygiene fix                                      | —          | P0       |
| #003  | Design system foundation                                    | —          | P0       |
| #004  | Quality gate rebuild (Biome + CI dedup)                    | —          | P0       |
| #005  | Module restructure (modules/ + http/)                      | #001       | P0       |
| #006  | D1 binding smoke                                            | #008       | P1       |
| #007  | R2 binding smoke                                            | #008       | P1       |
| #008  | GitHub delivery setup (main protection + Project + Issues) | —          | P0       |
| #009  | Cut the 0.1.0 release PR                                   | #001–#008  | P0       |

(Issue numbers are placeholders. The real numbers are assigned by
GitHub when the Issues are opened.)

Dependency graph:

```
#001 ── #005
#002 (independent)
#003 (independent)
#004 (independent)
#006 ──┐
       ├─ #009 (release cut)
#007 ──┤
#008 ──┘
```

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
