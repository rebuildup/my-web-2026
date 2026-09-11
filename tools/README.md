# Tools

This directory is reserved for Git submodules that hold independent
Web Tools integrated into my-web-2026.

`0.1.0` Foundation does not add any concrete Tool submodule yet.
The directory exists so that future Tool tickets can land here
without moving the architecture.

## Boundary rules

- A Tool lives at `tools/<tool-name>/` as a Git submodule pinned to
  a specific commit SHA on the my-web-2026 side.
- my-web-2026 source code must never import from inside a
  submodule's `src/**`.
- A submodule must never import from `../*/src/**` of the parent.
- Each Tool may use any framework, styling system, or runtime.
- my-web-2026's Panda CSS / design system is **not** forced on
  Tools.

## Adding a Tool (post-0.1.0)

1. Open a GitHub Issue describing the Tool and the embed contract.
2. Add the submodule: `git submodule add <repo> tools/<tool-name>`.
3. Pin a specific commit SHA on the parent side.
4. Wire the Tool into the relevant my-web-2026 page via the
   manifest contract described in
   [ADR-0006](../docs/adr/ADR-0006-tools-submodule-policy.md).
5. Document the integration in `docs/architecture.md`.

See [ADR-0006](../docs/adr/ADR-0006-tools-submodule-policy.md) for
the full policy.
