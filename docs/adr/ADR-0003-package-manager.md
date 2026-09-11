# ADR-0003: Package manager

- Status: Accepted
- Date: 2026-09-11
- Superseded by: None

## Context

my-web-2025 used Bun. The user's brief explicitly says:

> "既存のmy-web-2025がBunだからという理由だけでBunを継承しないでください。"

The project-init policy (ADR-0001 §11) lists "Bun" as the default JS/TS
package manager. That is a starting point, not a binding decision.

The actual stack to support is:

- Cloudflare Workers + Wrangler 4.131.0
- TanStack Start 1.168.x with `@tanstack/react-start/plugin/vite`
- Hono 4.13.7
- Panda CSS 1.12.x with `@pandacss/dev`
- React 19.3 / Vite 7.3 / TypeScript 5.9
- Vitest 4.1.x

The choice also needs to work uniformly on macOS / WSL2 / Linux / NixOS,
and be future-friendly to a workspace layout for future Tool submodules.

## Decision

We adopt **pnpm 12.3.x** as the package manager for my-web-2026.

### Rationale

1. **Panda CSS official guide uses pnpm.** The Panda CSS docs (verified
   on 2026-09-11) use `pnpm create vite`, `pnpm install -D @pandacss/dev`,
   and `pnpm panda init --postcss` as their canonical setup. Staying on
   the documented path avoids drift.
2. **Workspace support is a first-class feature.** Future Tool
   submodules will benefit from a real workspace layout
   (`pnpm-workspace.yaml`). Bun's workspace support is improving but
   pnpm's is the most mature today.
3. **Deterministic lockfile.** pnpm's lockfile resolution is more
   conservative than npm's and surfaces peer-dependency issues earlier.
4. **Vite / Wrangler / Workers Vite plugin all work with pnpm.** All
   packages were installed and verified end-to-end with pnpm 12.3.4 in
   this repository.
5. **Cross-platform parity.** pnpm behaves identically on macOS,
   Windows + WSL2, and Linux.
6. **Native binary handling.** pnpm's `onlyBuiltDependencies` allowlist
   (via `pnpm-workspace.yaml`) keeps native-binary install scripts
   explicit and reviewable.

### What is **not** decided here

- We do not commit to any particular `pnpm` patch release — `12.3.4`
  is the version that happened to be installed during initialization
  and is pinned in `package.json#packageManager`.
- We do not adopt `pnpm` for build orchestration (e.g. pnpm-only
  scripts) beyond what npm scripts already do. Wrangler, Vite, Vitest
  and Panda CLI are all invoked through npm scripts so the runner can
  be swapped without rewriting `package.json`.
- We do not adopt pnpm-only features (catalogs, patched dependencies,
  `nodeLinker=hoisted`) in 0.1.0. They can be added in later sprints
  if a real need emerges.

### `packageManager` and corepack

`package.json` pins `"packageManager": "pnpm@12.3.4"`. `corepack enable
pnpm` on a fresh checkout will install that exact version. CI uses the
same `packageManager` so local and CI resolutions match.

### `onlyBuiltDependencies`

`pnpm-workspace.yaml` lists `esbuild`, `workerd`, and `@cloudflare/vite-plugin`
in `onlyBuiltDependencies`. These packages need postinstall scripts to set up
native binaries. Adding a new native-binary package requires a code review
that also updates this list.

## Consequences

### Positive

- One documented setup path for all hosts.
- Workspace-ready for future Tool submodules without a toolchain change.
- `pnpm install` is reproducible from the lockfile alone.

### Negative / Trade-offs

- Bun's raw install / script speed advantage is forfeited. The
  performance impact is irrelevant for this project's size.
- `pnpm` defaults to a strict, non-flat `node_modules`. Some tools that
  assume hoisting (none in our stack today) would need adjustment.

## Re-evaluation triggers

Re-evaluate when:

- pnpm 13 ships a breaking change that we cannot absorb quickly.
- Vite / Wrangler / TanStack Start explicitly drop pnpm support.
- Bun ships first-class Workers / Workers Static Assets tooling that closes
  the integration gap.
