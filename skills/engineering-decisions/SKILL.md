---
name: engineering-decisions
description: my-web-2026 での自律的判断の優先順位と user escalation policy。
---

# Engineering Decisions (my-web-2026)

## Canonical decision precedence

1. project-wide policy (`AGENTS.md`) / canonical architecture / ADR
2. design / specification / explicit task instruction
3. coherent existing implementation in this repo
4. current official Cloudflare / TanStack Start / Hono / Panda CSS
   guidance (verified 2026-09-11, re-verify when in doubt)
5. established ecosystem convention
6. local best judgment

When two sources at the same level conflict, the more specific and
newer canonical source wins.

## Existing implementation is evidence, not authority

Before adopting a pattern from `src/**`:

- Check whether the same responsibility is implemented elsewhere.
- Exclude generated / vendored / example code.
- Distinguish in-progress migrations from finished work.
- Confirm no ADR has revised the convention.

## Decisions that do not need user escalation

The agent proceeds on its own when the answer is uniquely or
effectively determined by the precedence and the decision is
reversible, local, and does not change acceptance criteria, public
contracts, security / privacy posture, meaningful cost, or release
scope.

Examples that fall into this category:

- File / directory placement that follows the architecture boundary
  in `AGENTS.md §3`.
- Naming that follows the existing repository convention.
- Lint / type / format fixes that touch a single file.
- Choosing between two Cloudflare regions when neither affects
  availability / data residency.

## Decisions that require user escalation

Escalate when the call affects:

- Product semantics visible to end users.
- Public / external API contracts.
- Security / privacy / compliance.
- Meaningful cost or quota use.
- Release scope or date.
- Irreversible / destructive operations.
- Canonical sources that genuinely conflict.

When asking, present the alternatives, the impact of each, and a
recommendation.

## Verification before relying on memory

For any version-sensitive fact (Cloudflare compatibility date,
TanStack Start API, Hono router API, Panda CSS preset names,
Wrangler config keys), verify against the current official source.
Memory is the starting point, not the answer.

## Persistence

Significant decisions are recorded in:

- `docs/adr/ADR-NNNN-<slug>.md` for architecture / tooling / process
- Inline code comments for implementation details
- `AGENTS.md` (rare; only when the decision is always-on)
