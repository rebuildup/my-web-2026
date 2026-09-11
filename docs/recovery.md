# Recovery

> How a fresh agent (or fresh human) recovers an in-flight my-web-2026
> ticket from durable state. See
> [`skills/agent-recovery/SKILL.md`](../skills/agent-recovery/SKILL.md)
> for the operational algorithm.

## Sources of truth

- GitHub Issues / Projects (status, target release, dependencies).
- Git branches (`main`, `release-x-y-z`, `<issue-number>`).
- Pull Requests (Draft / Ready, assignee, reviewer, labels, CI).
- Repository-controlled design / ADR / Skills / docs.
- Structured recovery checkpoint (when present).

Transient state (session ID, agent ID, local Supervisor memory,
shell history, IDE state, unpushed local logs) is **not** a source
of truth.

## Recovery ordering

A fresh agent reads, in this order:

1. `AGENTS.md` — always-on invariants.
2. [`skills/agent-recovery/SKILL.md`](../skills/agent-recovery/SKILL.md)
   — durable recovery algorithm.
3. [`skills/github-delivery/SKILL.md`](../skills/github-delivery/SKILL.md)
   — branch / PR / stack invariants.
4. The Issue + PR + branch state of the ticket.
5. The latest structured checkpoint, if any.
6. The relevant ADR.
7. The relevant `docs/` page.

A fresh human reads:

1. `README.md`.
2. `docs/development.md`.
3. `docs/release.md`.
4. `docs/troubleshooting.md`.

## Durable invariants for active ticket branches

An active durable ticket branch must have:

- A published remote head whose SHA matches the recorded local
  commit.
- A Draft PR whose base matches the recorded immediate PR base.
- Linked Issue, assignee, reviewer, labels, target release, stack
  context.

If any of these are missing, the delivery surface is repaired
**before** implementation resumes.

## Durable invariants for release branches

A release branch may be zero-diff against `main` (and therefore
have no Draft PR). Once a release branch has any meaningful
integrated difference, a Draft release PR must exist with
assignee / reviewer / labels / release goal / included Issues /
validation state.

## Hard recovery (sandbox / provider lost)

The canonical sources above must be sufficient. Wrangler state
(`.wrangler/`) is recoverable from the remote bindings and
`pnpm run cf-typegen`; it is not durable state.

## Stack rebase / update

If a predecessor changed, the recorded `validated_sha` no longer
matches. The affected downstream branches are re-validated from
the new SHA. Old green results are discarded.

## External side effects

`wrangler deploy`, Cloudflare resource mutation, and GitHub Issue
/ PR mutation are external side effects. When the API supports
idempotency keys, they are used. Intent + result + remote
identifier are recorded in a durable journal around the call.

## Context exhaustion

When approaching context limits, the agent externalises:

- Current objective
- Accepted decisions and ADR references
- Relevant files / modules
- Issue / target release / PR / stack predecessor
- Completed work
- Pending work
- Validation state
- Blockers

into a structured checkpoint before handoff. The fresh agent
reads the checkpoint first; it does not re-read the conversation.
