# my-web-2026

[![CI](https://github.com/rebuildup/my-web-2026/actions/workflows/ci.yml/badge.svg)](https://github.com/rebuildup/my-web-2026/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/rebuildup/my-web-2026/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/rebuildup/my-web-2026?include_prereleases&style=flat)](https://github.com/rebuildup/my-web-2026/releases)

> Public preview of the next Personal Web Platform for 木村友亮 / samuido.
> v0.2.0 establishes the canonical 2026 home surface while the complete
> 2025 edition remains available at https://yusuke-kim.com during migration.

`my-web-2026` is a modular monolith: one Cloudflare Worker, one
repository, one set of bindings. TanStack Start owns the UI and
internal application operations. Hono owns the external HTTP
boundary (webhooks, OAuth, integrations, REST APIs). Panda CSS owns
styling.

## Support / target platform

- Runtime: Cloudflare Workers (production / staging / preview).
- Local hosts: macOS / Apple Silicon, Windows 11 + WSL2, Linux,
  NixOS. Remote Linux sandbox is also supported.
- Language: TypeScript 5.9, React 19.2, Vite 7.1.

## Stack

| Concern        | Choice                                       |
| -------------- | -------------------------------------------- |
| Runtime        | Cloudflare Workers                           |
| Web framework  | TanStack Start 1.168.x                       |
| Build / dev    | Vite 7.1.x + `@cloudflare/vite-plugin`       |
| External HTTP  | Hono 4.13.x                                  |
| Styling        | Panda CSS 1.12.x (no Tailwind)               |
| Format / lint  | Biome 1.9.x (replaces Prettier + ESLint)     |
| Package mgr    | pnpm 12.3.x                                  |
| Tests          | Vitest 4.1.x + `@cloudflare/vitest-plugin`   |

See [`docs/architecture.md`](docs/architecture.md) and
[`docs/adr/`](docs/adr/) for the canonical decisions.

## Canonical commands

```bash
# Bootstrap (corepack is forbidden; install pnpm directly)
npm install -g pnpm@12.3.4
pnpm install

# Develop locally (Cloudflare runtime via @cloudflare/vite-plugin)
pnpm dev

# Validate (three deterministic entry points)
pnpm run validate:fast
pnpm run validate:integration
pnpm run validate:release

# Deploy
pnpm run deploy
```

`validate:fast` runs `format:check + lint:check + typecheck + test`.
`validate:integration` adds `build + wrangler:dry-run`. `validate:release`
adds `cf-typegen`. See [`quality/profile.yaml`](quality/profile.yaml).

## Internal docs index

- [AGENTS.md](AGENTS.md) — root agent contract (always-on).
- [docs/architecture.md](docs/architecture.md) — system boundaries.
- [docs/development.md](docs/development.md) — bootstrap / run / test.
- [docs/release.md](docs/release.md) — weekly release sprint workflow.
- [docs/security.md](docs/security.md) — security maintenance.
- [docs/recovery.md](docs/recovery.md) — durable agent recovery.
- [docs/troubleshooting.md](docs/troubleshooting.md) — recurring failures.
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution workflow.
- [skills/](skills/) — project-local Agent Skills.
- [docs/adr/](docs/adr/) — Architecture Decision Records.

## Recovery entry

A fresh agent recovering an active ticket reads:

1. [AGENTS.md](AGENTS.md)
2. [skills/agent-recovery/SKILL.md](skills/agent-recovery/SKILL.md)
3. [skills/github-delivery/SKILL.md](skills/github-delivery/SKILL.md)
4. The GitHub Issue + PR + branch state for the ticket.

A human recovering the same ticket reads:

1. [README.md](README.md) (this file)
2. [docs/development.md](docs/development.md)
3. [docs/release.md](docs/release.md)
4. [docs/troubleshooting.md](docs/troubleshooting.md)

## Status

- **v0.2.0 Public Preview** — canonical home, platform health, design-system
  foundation, release gates, and personal/domain grounding.
- **Portfolio / Content / Activity** — planned capabilities; not yet migrated.
- **2025 edition** — remains the complete public site at https://yusuke-kim.com
  until the required surfaces have moved.

See [docs/release.md](docs/release.md) for release scope and gates.

## License

MIT — see [`LICENSE`](./LICENSE).
