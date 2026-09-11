---
name: parallel-orchestration
description: my-web-2026 の ticket work を dependency graph へ分解し、isolated runtime と immutable snapshot / result で安全に並行実行する。
---

# Parallel Orchestration (my-web-2026)

Adapts project-init `parallel-orchestration` for the my-web-2026
stack. Read `AGENTS.md` first.

## Invariants

- 1 implementation worker = 1 isolated mutable runtime.
- Workers do not share the working tree, Git index, or durable
  integration branch.
- Parent -> child delegation uses an **immutable snapshot** (resolved
  commit SHA or content digest). Branch / ref name alone is not
  identity.
- Child -> parent result is an **immutable commit / ref / diff**
  pinned to a recorded SHA / digest.
- Worker sandbox lifecycle is owned by the Supervisor (not by the
  parent model process).
- Git worktree inside a sandbox is permitted; worktree alone is not
  an isolation boundary.
- Durable planning unit: GitHub Issue. Ephemeral subtasks may stay
  Supervisor tasks.
- Every mutable task / result carries an `execution_generation`
  starting at 1. Recovery / reassignment advances it atomically.

## Dependency readiness

A node is spawnable when:

1. It has no unfinished prerequisite, OR
2. It is `stack-ready`: a reviewable immutable predecessor snapshot
   is pinned and the immediate PR base recorded.

When starting from a `stack-ready` predecessor, the worker input MUST
record the predecessor Issue / PR identity and the exact predecessor
commit SHA.

## Spawn contract (mutable worker)

Minimum input fields:

```
issue_or_task_id
objective
acceptance_criteria
target_release
base_snapshot
predecessor_issue_or_pr
predecessor_snapshot
immediate_pr_base
branch_identity
expected_draft_pr
assignee_expectation
reviewer_expectation
label_expectation
execution_generation
role
allowed_tools
filesystem_policy
network_policy
budget
expected_result
```

## Durable branch contract

When a worker / subagent may create a durable branch:

1. Create the branch.
2. Make the first meaningful commit immediately.
3. Push to the canonical remote.
4. Verify remote head SHA equals the local commit.
5. Open the Draft PR.
6. Set linked Issue / assignee / reviewer / labels / target release
   / stack context.

Subagents without remote-publish / PR-mutation rights return control
to the Supervisor / Coordinator immediately after the first
meaningful commit and do not resume implementation until the
Supervisor completes steps 3–6.

## Result contract

```
agent_id
issue_or_task_id
target_release
base_snapshot
predecessor_snapshot
execution_generation
result_commit_or_ref
draft_pr_identity
summary
validation_results
known_issues
```

Stale-generation results are not integrated.

## Stack reconciliation

Predecessor change -> downstream rebase / update -> affected
validation re-run on the new SHA. Old green results are discarded.

## Fallback

If true isolation is unavailable, fall back to read-only research
parallelism or serial implementation. Never run parallel writers on
a shared working tree.
