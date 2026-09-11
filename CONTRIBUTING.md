# CONTRIBUTING

> How a new contributor (human or AI agent) joins my-web-2026.

## Before you start

1. Read [AGENTS.md](AGENTS.md). It is short on purpose.
2. Read the Skill relevant to your task:
   - [skills/github-delivery/SKILL.md](skills/github-delivery/SKILL.md)
   - [skills/quality-gate/SKILL.md](skills/quality-gate/SKILL.md)
   - [skills/engineering-decisions/SKILL.md](skills/engineering-decisions/SKILL.md)
3. Read the ADR relevant to your decision
   (`docs/adr/ADR-NNNN-*.md`).
4. Do **not** read the entire `skills/` and `docs/` tree on every
   session — that is a progressive-disclosure violation.

## Repository setup

```bash
corepack enable pnpm
pnpm install
pnpm run prepare
```

`pnpm install` triggers `panda codegen` via the `prepare` script and
produces the `styled-system/` package.

## Weekly sprint cadence

- One sprint = one week = one target semantic version = one
  `release-x-y-z` integration branch.
- Ticket branch is the GitHub Issue number only (`123`). No prefix,
  no slug.

## Ticket lifecycle (human or agent)

1. Pick an Issue from the GitHub Project `Ready` column.
2. Create the branch from the current `release-x-y-z` (or from the
   immediate predecessor branch if stacked).
3. Make the first meaningful commit **immediately**.
4. `git push -u origin <branch>`.
5. `git rev-parse origin/<branch>` must equal your local commit.
6. Open a Draft PR with linked Issue, assignee, reviewer, labels,
   target release, and stack context.
7. Implement, run `pnpm run validate:integration`, request review.
8. Move the PR to Ready.
9. Land via the canonical merge path.
10. Reconcile the Issue / Project state after landing.

## Stack

Stack-specific contribution rules:

- React components live under `src/features/<feature>/**`.
- Domain / application logic lives under `src/domains/<name>/**`.
- External HTTP traffic lives under `src/boundary/**`.
- Cloudflare-specific code lives under `src/infra/**`.
- Cloudflare services (D1, R2, KV, Queues, Durable Objects, etc.)
  require their own ticket — see
  [ADR-0004](docs/adr/ADR-0004-cloudflare-services-policy.md).

## Validation

The three entry points from [`quality/profile.yaml`](quality/profile.yaml):

| Command                         | When                               |
| ------------------------------- | ---------------------------------- |
| `pnpm run validate:fast`        | While iterating                    |
| `pnpm run validate:integration` | Before opening a PR / before merge |
| `pnpm run validate:release`     | Before a release PR merges         |

CI invokes the same three commands. Do not redefine validation
inside workflow YAML.

## Security

See [docs/security.md](docs/security.md) for the advisory intake,
triage, and patching workflow. For sensitive disclosures, contact
the repository owner out-of-band; do not file a public GitHub Issue.

## Decisions

Significant changes require an ADR (see
[docs/adr/](docs/adr/) for templates). Decisions that touch:

- Stack / dependency choice
- Architecture boundary
- Cloudflare service adoption
- Quality gate change
- Release workflow

must add a new ADR before or alongside the implementation PR.

## License

Internal contribution; outbound license is decided when the
canonical remote is created.
