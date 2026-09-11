---
name: sandbox-runtime
description: my-web-2026 の implementation worker 用 isolated runtime を macOS / WSL / Linux / remote provider 差を吸収して提供する。
---

# Sandbox Runtime (my-web-2026)

Adapts project-init `sandbox-runtime` for my-web-2026. Read
`AGENTS.md` first.

## Invariants

- 1 implementation worker = 1 isolated workspace / runtime.
- Mutable state (DB, queue, port map, build output, `.wrangler/`,
  `node_modules/.cache/`) is never shared.
- Same internal port is allowed; host-published port is unique per
  runtime.
- Host Docker socket, root-equivalent host capability, master
  credentials are never given to a worker.
- Read-only toolchain state and immutable caches may be shared.

## Local targets (first-class)

- macOS / Apple Silicon (`arm64`).
- Windows 11 + WSL2 / WSL Containers.
- Linux / NixOS.
- Remote Linux sandbox (CI, paid providers).

## Portability rules

- Portable Web / backend tasks run in a Linux sandbox on every
  host, including macOS, to reduce CI / remote drift.
- Apple-native tasks (Xcode / iOS / macOS tooling) may use a
  macOS-native worker but keep per-worker workspace isolation.
- WSL is not itself an isolation boundary; multiple workers inside
  WSL still need container / VM / sandbox boundaries.
- Docker Desktop is not a hard dependency. The local runtime is
  selected by the operator at initialization time.

## Cloudflare-specific sandbox concerns

- `wrangler dev` opens port `8787` by default. The runtime must
  remap if multiple workers run concurrently.
- `node_modules` includes native binaries (`workerd`, `esbuild`,
  `@cloudflare/vite-plugin`). pnpm's `onlyBuiltDependencies`
  allowlist in `pnpm-workspace.yaml` keeps the install script
  behaviour explicit. Adding a new native-binary dependency must
  update that allowlist.
- `.wrangler/` is per-worker; do not share between workers.

## Reproducibility target

```
clone
  -> pnpm install (12.3.4, installed directly; no corepack — see ADR-0003)
  -> pnpm run prepare
  -> sandbox create (if used)
  -> pnpm run dev | pnpm run build | pnpm run test
  -> validation
```

The same command chain runs locally and in CI.
