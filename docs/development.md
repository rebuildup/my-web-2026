# Development

> How to bootstrap, run, test, and validate my-web-2026 from a fresh
> checkout on a supported host.

## Supported hosts

- macOS / Apple Silicon (arm64) — first-class.
- Windows 11 + WSL2 / WSL Containers — Linux-oriented repos live
  inside the WSL Linux filesystem, not on `/mnt/c`.
- Linux / NixOS — first-class.
- Remote Linux sandbox (CI / paid providers) — first-class.

Docker Desktop is not a hard dependency. The local runtime is
selected by the operator at init time.

## Prerequisites

| Tool     | Version             |
| -------- | ------------------- |
| Node.js  | 20.18+              |
| Corepack | bundled with Node   |
| pnpm     | 12.3.x via corepack |
| Wrangler | `^4.131.0` (npm)    |
| Git      | 2.40+               |

## Bootstrap

```bash
git clone <canonical-remote> my-web-2026
cd my-web-2026
corepack enable pnpm
pnpm install
pnpm run prepare     # generates Panda styled-system
```

`pnpm install` triggers `panda codegen` via the `prepare` script.

## Run

```bash
# Local dev (Cloudflare runtime via @cloudflare/vite-plugin)
pnpm dev

# Production-equivalent build
pnpm build

# Local preview of the production build (Vite preview server)
pnpm preview

# Cloudflare-compatible deploy (after a successful build)
pnpm deploy
```

`pnpm dev` listens on `127.0.0.1:3000` by default (see
`vite.config.ts#server.port`).

## Validate

The three deterministic entry points in
[`quality/profile.yaml`](../quality/profile.yaml):

```bash
# Worker gate — fast feedback
pnpm run validate:fast

# Integration gate — PR candidate
pnpm run validate:integration

# Release gate — pre-main verification
pnpm run validate:release
```

CI uses the same commands.

## Generate Cloudflare types

After any change to `wrangler.jsonc` (binding add, env, etc.):

```bash
pnpm run cf-typegen
```

This regenerates `worker-configuration.d.ts`. Commit the regenerated
file in the same PR as the binding change.

## Generated artefacts

| Path               | Source                                   | Gitignored |
| ------------------ | ---------------------------------------- | ---------- |
| `dist/`            | `pnpm build`                             | yes        |
| `dist-cloudflare/` | `wrangler deploy --dry-run --outdir=...` | yes        |
| `styled-system/`   | `panda codegen`                          | yes        |
| `node_modules/`    | `pnpm install`                           | yes        |
| `.wrangler/`       | `wrangler dev`                           | yes        |
| `.tmp/`            | temporary research                       | yes        |
| `.reference/`      | external clones                          | yes        |

## Adding a Cloudflare binding

1. Open a GitHub Issue describing the feature and the binding.
2. Add the binding to `wrangler.jsonc` in the same PR.
3. Run `pnpm run cf-typegen` and commit `worker-configuration.d.ts`.
4. Add a domain adapter under `src/domains/<name>/adapters/**`.
5. Wire the adapter into the relevant server function or Hono handler.
6. Document the new binding in [docs/architecture.md](architecture.md).
7. Add an ADR if the binding introduces a new Cloudflare service
   (see [ADR-0004](adr/ADR-0004-cloudflare-services-policy.md)).

## Troubleshooting (quick reference)

| Symptom                               | Likely cause / fix                                                |
| ------------------------------------- | ----------------------------------------------------------------- |
| `pnpm install` warns `Ignored builds` | Normal at 0.1.0 — see `.npmrc` / `pnpm-workspace.yaml`.           |
| `wrangler types` regenerates stale    | Run after every binding change. Commit the diff.                  |
| `panda codegen` produces empty        | Run `pnpm run prepare` after editing `panda.config.ts`.           |
| `vite build` fails on `breakpoints`   | Panda breakpoint format: `'640px'`, not `{ value: ... }`.         |
| Hono path not intercepted             | Add the prefix to `EXTERNAL_BOUNDARY_PREFIXES` in `src/start.ts`. |
| Port `3000` already in use            | Override with `--port` or change `vite.config.ts`.                |

See [docs/troubleshooting.md](troubleshooting.md) for the full list.
