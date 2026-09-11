---
name: github-delivery
description: my-web-2026 での GitHub Issue / Project / weekly release sprint / stacked PR / Draft PR / release integration の運用。
---

# GitHub Delivery (my-web-2026)

This Skill adapts the project-init `github-delivery` policy to
my-web-2026. Read `AGENTS.md` first; read this Skill only when the task
involves Issue, PR, branch, or release workflow.

## Source of truth

- Released source state: `main`
- Active sprint / release integration: `release-x-y-z`
- Durable planning: GitHub Issues + Projects
- Dependency: GitHub Issue / Project dependency metadata
- Review / integration: Pull Requests
- Transient execution: Supervisor / agent runtime

`main` is the released, integrated source. Normal ticket PRs do not
target `main`.

## Repository visibility blocker

If the canonical remote repository is created with `public`
visibility, `main` must be protected with a branch ruleset before any
release PR can land. The current initialization cannot determine
visibility because the remote has not been created. That fact is
recorded as a blocker in `docs/release.md` and in the 0.1.0
backlog (Issue "Confirm canonical remote and visibility").

## Weekly release sprint

A sprint is one week, mapped 1:1 to one target semantic version and
one release branch:

```
release-<major>-<minor>-<patch>
```

Examples: `release-0-1-0`, `release-0-2-0`, `release-1-0-0`.

Emergency patch releases use a patch release branch and a release PR,
not direct edits to `main`.

## Issue

- Title / body: 日本語
- Must include (when relevant): objective / user-visible outcome,
  acceptance criteria, scope / non-scope, dependency / blocked-by,
  priority, size, area / component, target version, release date,
  accountable assignee.
- Short-lived research / subtasks do not need their own Issue.

## Project

Default status flow:

```
Backlog -> Ready -> In Progress -> In Review -> Done
```

Recommended fields: Priority, Size, Target Version, Area, Blocked.

Dependency execution has three orthogonal states — `blocked`,
`stack-ready`, `integrated` — that do not replace the Project
Status flow.

## Ticket branch

1 top-level Issue = 1 ticket branch = 1 ticket PR.

Canonical branch name: `<issue-number>`. No prefix, no slug.

## Branch creation is one start procedure

1. Create durable branch.
2. Make the first meaningful commit immediately.
3. Push to the canonical remote.
4. Verify `git rev-parse origin/<branch>` equals the local commit.
5. Open Draft PR.
6. Set linked Issue, assignee, reviewer / CODEOWNERS, labels,
   target release, stack context, validation status.

This rule applies to humans, Coordinators, implementation workers,
and subagents. Subagents that create durable branches must perform
all six steps; if they lack remote-publish or PR-mutation rights they
return control to the Supervisor / Coordinator immediately.

## PR metadata

At creation, the PR must have:

- Linked Issue (`Issue: #<number>`)
- Assignee
- Reviewer request or CODEOWNERS-derived reviewer
- Repository labels
- Acceptance criteria
- Implementation summary
- Validation status / results
- Known limitations / blockers
- Target release branch
- Stack predecessor / successor context when stacked

If no meaningful reviewer exists, the PR body states that and the
alternate review path (CI, explicit final review, automation).

## Independent ticket PR

```
main
└─ release-x-y-z
   └─ 123
```

PR: `123 -> release-x-y-z`.

## Stacked ticket PR

For a linear hard-dependency chain in the same release:

```
main
└─ release-x-y-z
   └─ 123
      └─ 124
         └─ 125
```

PR bases: `123 -> release-x-y-z`, `124 -> 123`, `125 -> 124`.

Stack eligibility: same repository, same target release, real hard
dependency, ordered chain, reviewable immutable predecessor
snapshot.

## Stack-ready execution

Dependent ticket may start before the predecessor merges as long as a
reviewable immutable predecessor commit SHA is pinned.

Predecessor change -> downstream rebase / update -> affected
validation re-run on the new SHA. Old green result does not
transfer.

## Ready for review

Move Draft to Ready only when:

- Acceptance criteria implemented
- `pnpm run validate:fast` (or stronger) green on the current SHA
- Blocking known problems resolved or explicitly scoped out
- PR body / metadata reflects current implementation
- Reviewer requested or absence documented
- Target release / immediate predecessor staleness handled
- Stack downstream branches reconciled when required

## Landing / Done

Issue Done = landed on target release trunk. Not merely merged into
an intermediate predecessor branch.

Stack landing: from bottom of stack upward. Review the contiguous
group together; reconcile each Issue / Project item after landing.

Native GitHub stack semantics are platform-specific; the invariant is
that Done means "changes on `release-x-y-z`", not "PR merged".

## Release branch / Draft release PR

Release branch created at sprint start. Zero-diff release branches
cannot have a PR on GitHub; that is the only Draft-PR exception.

When the release branch first contains a meaningful integrated
difference, immediately open a Draft release PR with:

- Release goal
- Included Issues / ticket PRs
- Breaking changes
- Migration notes
- Validation status
- Known limitations
- Version / release metadata

## Release PR

`release-x-y-z -> main` is the only path to update `main` once the
repository is public and `main` is protected. Run the full
`validate:release` entry point first.

## Public repository main protection

When the remote is created as public, the initializer MUST:

1. Add a branch protection / ruleset on `main` that disallows direct
   push, web edit, force push, deletion, and requires PR + required
   checks.
2. If branch protection cannot enforce a head-branch pattern, add a
   required status check / GitHub Action that rejects `base == main`
   unless `head` matches `release-*` and the intended target release.

If the initializer lacks permission, the missing protection is
reported as a blocker in `docs/release.md` and as a GitHub Issue.

## Language policy

- Issue title / body: 日本語
- PR title / body / review discussion: 日本語
- Commit message: English
- Source code: English
- Internal planning docs: 日本語
- Branch name: identifier / version only
