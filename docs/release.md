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

## Repository visibility blocker

`my-web-2026` does not yet have a canonical remote. The
initialization cannot determine whether the remote will be `public`
or `private`. Until that decision is made:

- `main` is not yet protected.
- The `release-x-y-z -> main` PR path is the canonical intent but
  cannot be enforced by GitHub yet.

This is recorded as **Issue "Confirm canonical remote and
visibility"** in the 0.1.0 backlog. The Issue also asks for:

- Creation of the remote.
- Visibility decision (`public` is preferred for open personal
  site work; `private` is acceptable).
- Branch protection / ruleset for `main` (if public).
- A required status check that rejects `base == main` PRs whose head
  is not `release-*` (if protection cannot enforce the head pattern
  directly).

If permission is insufficient, the missing protection is itself a
blocker and is documented in the Issue body, not silently accepted.

## Public repository main protection checklist

When visibility is `public`:

- [ ] Branch protection / ruleset on `main` exists.
- [ ] Direct push disabled.
- [ ] Force push disabled.
- [ ] Deletion disabled.
- [ ] PR required for any change.
- [ ] Required status checks: `validate:fast`, `validate:integration`.
- [ ] Required reviews: at least one (operator can self-review until
      a second maintainer is added).
- [ ] `release-* -> main` only is enforced (either by ruleset pattern
      or by a required status check).

## 0.1.0 Foundation backlog

| Issue | Title                                                             | Depends on |
| ----- | ----------------------------------------------------------------- | ---------- |
| #001  | Confirm canonical remote and visibility                           | —          |
| #002  | Apply `main` protection (if public) + release-source status check | #001       |
| #003  | Wire `@cloudflare/vitest-plugin` into `validate:integration`      | —          |
| #004  | Add D1 binding smoke (Foundation smoke + dry-run with binding)    | #002       |
| #005  | Add R2 binding smoke                                              | #002       |
| #006  | Bootstrap `portfolio` feature module (UI placeholder)             | #004       |
| #007  | Bootstrap `content` feature module (CMS placeholder)              | #004       |
| #008  | Bootstrap `tools` domain module (Tool Registry spec only)         | —          |
| #009  | Adopt first external integration behind Hono (example webhook)    | #005       |
| #010  | Bootstrap `activity` feature module                               | —          |
| #011  | Cut the 0.1.0 release PR                                          | #001–#010  |

The dependency graph is canonical. #001 must land before #002. #004
must land before #006 and #007. #001–#010 must land before #011.

(Issue numbers are placeholders. The real numbers are assigned by
GitHub when the Issues are opened.)

## Tools / external subdomain policy

my-web-2026 may host Tools under `tools.<domain>` or as
sub-paths. The Tool Registry ticket (#008) is responsible for the
policy; individual Tool tickets follow the convention in
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
