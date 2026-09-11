# ADR-0006: Tool submodules as independent applications

- Status: Accepted
- Date: 2026-09-11
- Superseded by: None

## Context

my-web-2026 inherits a set of existing Web Tools from my-web-2025.
These Tools are independent applications with their own UI, framework,
style, and runtime. The brief is explicit:

> "Toolは独立したapplicationとして扱います。"
> "parentからsubmodule内部の `src` を直接importしない"
> "submoduleからparentの内部コードを相対参照しない"
> "Toolごとに独自framework/style/runtimeを許可する"
> "my-web本体のPanda CSS / Design Systemを強制しない"
> "build artifact / manifest contractを境界とする"
> "submodule commit SHAをmy-web側のverified versionとして固定する"

This ADR records those rules so the 0.1.0 architecture leaves room
for Tools to land in later sprints.

## Decision

### 1. Submodule placement

Tools are placed under `tools/<tool-name>/` as Git submodules. The
parent repository pins the submodule to a specific commit SHA.

```
my-web-2026/
  tools/
    <tool-name>/      # git submodule, pinned to <sha>
```

### 2. Boundary rules

- Parent code must **never** import from `tools/<tool>/src/**`.
- Submodule code must **never** import from `../*/src/**` or
  `../*/styled-system/**` of the parent.
- Tools may use any framework, any styling system, any runtime that
  fits their problem. They are not bound to TanStack Start, Hono, or
  Panda CSS.

### 3. Integration contract

A Tool is integrated into a my-web-2026 page through a manifest:

- The Tool is built inside its own repository into a deployable
  artefact (HTML / JS bundle / iframe-friendly bundle / native
  component).
- The artefact is exposed under a stable URL (e.g.
  `https://tools.<domain>/<tool-name>/`).
- The my-web-2026 page embeds the artefact via `<iframe>`, server-side
  include, or any other embed pattern documented by the Tool.

A future Tool Registry / manifest / build orchestration service lives
under `src/domains/tools/` once it is introduced.

### 4. Version pinning

The parent pins each submodule to a verified commit SHA. Bumping a
submodule is a normal PR with:

- Updated `.gitmodules` and `tools/<tool>/.git` HEAD
- The new pinned SHA in the PR description
- The integration test that exercises the new SHA

Submodule floats / auto-updates are not used.

### 5. 0.1.0 scope

`0.1.0` does not add any concrete Tool submodule. `tools/` is left
empty (apart from a `README.md` that explains the boundary). The
`tools/.gitkeep` file (or equivalent) marks the directory as
intentional.

## Consequences

### Positive

- Tools are decoupled from the host architecture.
- The host can ship Tools one at a time without re-platforming.
- A broken submodule does not break the host build, provided the
  embed surface is still resolvable.

### Negative / Trade-offs

- A future Tool Registry / manifest / build orchestration layer is
  required before multiple Tools can be integrated cleanly. That
  work is out of scope for 0.1.0.
- Submodule bumps are extra ceremony compared to a flat monorepo.

## Re-evaluation triggers

Re-evaluate when:

- Multiple Tools need to land in the same release. At that point, a
  Tool Registry ticket precedes the individual Tool tickets.
- A Tool genuinely needs to share code with the host. That is a
  signal that the Tool should be promoted into a host domain module
  (`src/domains/<name>/`) instead of staying a submodule.
