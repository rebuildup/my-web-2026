# ADR-0004: Cloudflare services policy

- Status: Accepted
- Date: 2026-09-11
- Superseded by: None

## Context

Cloudflare has a wide catalogue of services (D1, R2, KV, Queues, Durable
Objects, Workflows, Vectorize, Workers AI, etc.). It is tempting to adopt
several of them early "just in case".

The brief explicitly warns against this:

> "Cloudflareサービスだからという理由だけで導入しないでください。"

The 0.1.0 Foundation release should not provision Cloudflare resources
that are not actually used.

## Decision

The 0.1.0 release provisions **only**:

- One Cloudflare Worker (the application).
- One Cloudflare Static Assets binding for the Vite-emitted client.

The following services are **explicitly deferred** until a feature
ticket in a later release actually needs them:

| Service         | First-use trigger                                            |
| --------------- | ------------------------------------------------------------ |
| D1              | First CMS / structured-content feature ticket                |
| R2              | First user-uploaded media or download artefact               |
| Queues          | First webhook that requires durable async processing         |
| KV              | First session-cache / settings-cache need                    |
| Durable Objects | First realtime / stateful coordination need                  |
| Workflows       | First durable multi-step processing need                     |
| Vectorize       | First product feature that genuinely needs semantic search   |
| Workers AI      | First product feature that genuinely needs on-edge inference |

### Provisioning rules

- Each Cloudflare service adoption must come with a feature ticket,
  its own binding declared in `wrangler.jsonc`, a domain adapter under
  `src/domains/<name>/adapters/`, and a documentation update in
  `docs/architecture.md`.
- `pnpm run cf-typegen` must be re-run after every binding change so
  `worker-configuration.d.ts` stays in sync.
- A service is **never** added to satisfy a "nice to have" or to keep
  parity with another project.

### Cleanup / removal

If a service ends up unused, the binding must be removed in the same
release that removes its last call site. There is no "parking" of
bindings.

## Consequences

### Positive

- `wrangler.jsonc` stays small and reviewable.
- The Worker bundle stays small (~1 MiB uncompressed at 0.1.0).
- Adoption cost of any Cloudflare service is paid exactly once, by
  the feature ticket that needs it.

### Negative / Trade-offs

- The first feature ticket that needs D1 / R2 / etc. will also have to
  introduce the binding and the typegen step. This is intentional.

## Re-evaluation triggers

Re-evaluate when:

- The 0.2.0 or 0.3.0 backlog contains multiple features that need the
  same Cloudflare service. At that point, an "introduce X" ticket
  ahead of the features becomes worthwhile.
- Cloudflare ships a service that materially changes the runtime
  model (e.g. a first-class native binding that would simplify the
  architecture).
