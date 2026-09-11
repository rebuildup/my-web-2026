---
name: agent-recovery
description: AI agent / session / sandbox 中断から my-web-2026 の ticket work を durable state へ復元する。
---

# Agent Recovery (my-web-2026)

Adapts project-init `agent-recovery` for my-web-2026.

## Durable state

A recovering agent reconstructs from:

- GitHub Issue + Project (status, target release, priority,
  dependency).
- Target release branch (`release-x-y-z`).
- Ticket branch, remote head SHA, Draft / Ready PR.
- Stack predecessor Issue / PR + pinned predecessor SHA when
  applicable.
- Repository-controlled design / ADR / Skills / docs.
- Immutable worker / subagent result commits / refs / artefacts.

Transient state (session ID, agent ID, local Supervisor memory,
shell history, IDE state, unpushed local logs) is not the source of
truth.

## Recovery algorithm

1. Identify Issue / Project / PR / target release / dependency.
2. Fetch current ticket / release branch, remote commit graph, stack
   relation.
3. For durable ticket branches, verify that:
   - The remote head SHA equals the recorded commit SHA.
   - A Draft PR exists with linked Issue / assignee / reviewer /
     labels / intended base.
   - If any of these are missing, repair the delivery surface
     (publish, open Draft PR, set metadata) before continuing.
4. For release branches, check whether they are zero-diff against
   `main`. Zero-diff release branches do not require a Draft PR;
   release branches with any meaningful integrated difference must
   have one.
5. Read the latest structured recovery checkpoint, if present.
6. Re-read `AGENTS.md`, the relevant Skill, the relevant ADR.
7. Acquire execution ownership atomically (Supervisor compare-and-set
   on `execution_generation` + fencing token).
8. Reconcile children / subagents; revoke stale-generation results.
9. Recreate workspace from the recorded immutable snapshot.
10. Re-evaluate validation state on the current SHA.
11. Verify external side-effect idempotency before retrying.
12. Continue work under the new generation / token.

## Hard recovery

When sandbox / provider is gone, durable state must be sufficient.
The canonical sources are GitHub and the repository. Wrangler state
(`.wrangler/`) is recoverable from the remote bindings and `pnpm run
cf-typegen`; it is not a durable source.

## Stack update

If the predecessor changed after a previous validation run, the
recorded `validated_sha` no longer matches. The affected downstream
branches are re-validated from the new SHA. Old green results are
discarded.

## External side effects

`wrangler deploy`, Cloudflare resource mutation, GitHub Issue / PR
mutation, and notification writes are external side effects. They
require idempotency keys when the underlying API supports them
(GitHub Issue / PR creation does). Record intent + result + remote
identifier in a durable journal before and after the call.
