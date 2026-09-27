# ADR-0006: Tool submodules as independent applications

- Status: Accepted (revised 2026-09-27)
- Date: 2026-09-11
- Superseded by: None

## Context

my-web-2026 inherits a set of standalone Web Tools from my-web-2025.
Each Tool is an independent application with its own UI, framework,
style, and runtime. The brief is explicit:

> "ここで扱う Tool は my-web-2026 の内部機能ではありません"
> "Tool ごとに独自 framework / style / runtime を許可する"
> "my-web 本体の Panda CSS / Design System を強制しない"
> "build artifact / manifest contract を境界とする"
> "submodule commit SHA を my-web 側の verified version として固定する"
> "parent から submodule 内部の `src` を直接 import しない"
> "submodule から parent の内部コードを相対参照しない"
> "Tool source を parent repo 側だけで dirty patch しない"
> "Tool 側の fix は独立 PR で出す"
> "external URL は、本当に必要な場合だけ exception として認める"

Issue #80 establishes the contract (registry schema + verifier +
build orchestrator) for integrating Tools from external/ submodules
into the host. Issue #81 brings the first Tool — ProtoType — through
that contract into production. Issue #80 does **not** add a Tools
navigation surface or expose Tools in the public UI; that is #81's
job. Until then the contract is durable, exercised, and verifiable,
but no Tool is host-served.

## Decision

### 1. Submodule placement

Tools are placed under `external/<slug>/` as Git submodules. The
parent repository pins the submodule to a specific commit SHA.

```
my-web-2026/
  external/
    <slug>/            # git submodule, pinned to <sha>
  src/tools/
    manifest.json      # the registry: one entry per Tool (runtime-imported)
    manifest.schema.json # JSON Schema (draft-07) for the registry
    registry.ts        # host-side Tool Registry API (Issue #80)
    registry.test.ts
    public.ts          # route-facing re-exports
  docs/tools/
    inventory.md       # durable inventory of every known Tool
    runbook.md         # operator-facing integration runbook
  scripts/
    check-tools-manifest.mjs   # verifies registry + gitlink SHAs
    check-tools-manifest.test.mjs
    build-tools.mjs           # builds + collects same_origin_static tools
    build-tools.test.mjs
  dist/client/tools/   # BUILD ARTEFACT (git-ignored)
    <slug>/
      app/             # the Tool's static bundle (issue #81 decision)
        index.html
```

The source checkout (`external/<slug>/`) and the build artefact
(`dist/client/tools/<slug>/app/`) live in **different namespaces on
purpose**:

- `external/<slug>/` is a git submodule pinned to a specific SHA. It
  is git-tracked; the parent only ever holds one Tool source tree at
  a time. Editing the Tool's source happens in the Tool repo, not
  here.
- `dist/client/tools/<slug>/app/` is a build artefact emitted by
  `scripts/build-tools.mjs`. It is git-ignored, ephemeral, and
  regenerated every `pnpm run build`. The `/app/` sub-namespace under
  the slug keeps the iframe route (`/tools/<slug>`) and the artefact
  root (`/tools/<slug>/app/`) from colliding: TanStack Start serves
  the route, Static Assets serves the bundle, and Worker routing
  resolves the iframe `src` to the artefact without path-prefix
  ambiguity.
- The manifest lives under `src/tools/` (not `docs/tools/`) because
  `src/tools/registry.ts` imports it at build time via
  `import manifest from './manifest.json' with { type: 'json' }`.
  Putting the registry in `docs/tools/` would either force an awkward
  src→docs edge (violates AGENTS.md §3 — `routes → home` etc. never
  reaches `docs/`) or duplicate the manifest. Single SoT under
  `src/tools/` resolves it.

### 2. Boundary rules

- Parent code must **never** import from `external/<slug>/src/**`.
- Parent code must **never** import a Tool's `package.json` or
  `external/<slug>/dist/**`.
- Submodule code must **never** import from `../../src/**` of the
  parent. The Tool is a standalone repo; it does not know the host
  codebase exists.
- Tools may use any framework, any styling system, any runtime that
  fits their problem. They are not bound to TanStack Start, Hono, or
  Panda CSS.
- Tools may use any package manager (pnpm / bun / npm / yarn) — the
  build orchestrator dispatches on `build.package_manager`.

These rules are enforced mechanically by
`scripts/check-architecture.mjs` (Tool-boundary pass). A violation
breaks `pnpm run validate:fast`.

### 3. Integration contract

A Tool is integrated through a registry entry in
`src/tools/manifest.json`. The contract has three parts:

**Source — where the Tool lives:**

- `source.canonical_repo`: an `https://github.com/...` URL. The
  verifier flags URLs that *appear* to be derived from the slug
  because they end with `/<slug>.git` but the prefix does not match
  the `https://github.com/rebuildup/tool-<slug>.git` convention; this
  catches copy-paste typos.
- `source.submodule_path`: must match `^external/<slug>$`.
- `source.pinned_sha`: must be a 40-char lowercase hex SHA.
- `source.branch`: the upstream default branch (`main`, `develop`,
  …). Documented for future bumps.

**Build — how the Tool becomes an artefact:**

- `build.package_manager`: one of `pnpm | bun | npm | yarn`.
- `build.command`: an idempotent command run inside the submodule
  cwd. Conventions: `pnpm install --frozen-lockfile && pnpm run build`
  for `pnpm`; `bun install --frozen-lockfile && bun run build` for
  `bun`. `--frozen-lockfile` is the canonical pnpm 12.3.x form —
  `--frozen-lockfile=false` is not valid in pnpm 12.3.4 and was
  removed from the manifest at the start of Issue #81.
- `build.output_dir`: path relative to the submodule root (typically
  `dist`).

**Delivery — how the artefact reaches the user:**

- `delivery.kind` is one of:
  - `same_origin_static` — the Tool is served from the parent's
    Static Assets under `/tools/<slug>/app/...`. Requires the
    `external/<slug>/` submodule to be checked out at
    `source.pinned_sha`; `scripts/build-tools.mjs` runs the build and
    copies the artefact to `dist/client/tools/<slug>/app/`.
    Optionally sets `delivery.entry_html` (defaults to
    `<artifact_path>/index.html`) and `delivery.iframe.{sandbox,
    referrer_policy}` for the iframe route.
  - `external_exception` — the Tool is reachable only via an external
    URL. Used only when the runtime genuinely requires an external
    origin (e.g. `getUserMedia` constraints). `delivery.external_url`
    is required.
  - `host_disabled` — the Tool is in the inventory but **not**
    currently served. `delivery.disabled_reason` is required and
    must explain the Tool-side fix needed before the Tool can flip to
    `same_origin_static`. This is the default state for every Tool in
    the registry at the end of #80.

A future Tool-side fix is **not** made inside the parent's working
copy. It is made as a separate PR in the Tool's own repo, then the
parent bumps `source.pinned_sha` to that PR's merge SHA.

### 4. Version pinning

The parent pins each submodule to a verified commit SHA. Bumping a
submodule is a normal PR with:

- Updated `.gitmodules` and `external/<slug>/.git` HEAD
- The new pinned SHA recorded in `src/tools/manifest.json`
- The integration test (`scripts/check-tools-manifest.mjs`) green for
  the new SHA

Submodule floats / auto-updates are not used.

### 5. Build orchestration ownership

`scripts/build-tools.mjs` is the single source of truth for turning
checked-out Tool submodules into collected artefacts. The host's
`pnpm run build` invokes it (or the orchestrator is wired into the
host build by `vite.config.ts` via a build hook — see #81 for the
specific hook shape).

The orchestrator:

1. Reads `src/tools/manifest.json`.
2. For each entry with `delivery.kind === "same_origin_static"`,
   verifies the actual gitlink SHA equals `source.pinned_sha`.
3. Runs `build.command` inside `external/<slug>/` with
   `build.package_manager` on `$PATH`.
4. Cleans `dist/client/tools/<slug>/` (the slug's root namespace),
   then mirrors `external/<slug>/<output_dir>` to
   `dist/client/tools/<slug>/app/`.
5. Asserts the collected artefact contains `index.html` (the iframe
   entry point).

Tools with `delivery.kind` other than `same_origin_static` are
reported as SKIPPED. The orchestrator exits 0 in the all-skipped
case — at the end of Issue #80, all 14 Tools are SKIPPED.

### 6. 0.1.0 → 0.4.0 scope

- **0.1.0** — `external/` did not exist. ADR-0006 reserved the
  boundary but had no concrete Tools.
- **0.2.0 / 0.3.0 / 0.4.0** — still no concrete Tools. Foundation
  sprints shipped without a Tool.
- **Issue #80 (target 0.5.0)** — concrete Tool integration contract
  lands: `external/` placeholder, durable inventory, manifest schema,
  verifier, build orchestrator. All 14 entries are
  `host_disabled`. **No public Tool surface is added by #80.**
- **Issue #81 (target 0.5.0)** — ProtoType pilot lands. One Tool
  flips to `same_origin_static`. The `/tools/prototype` route ships.
  This is the production public proof.

## Consequences

### Positive

- Tools are decoupled from the host architecture.
- The host can ship Tools one at a time without re-platforming.
- A broken submodule does not break the host build, provided the
  embed surface is still resolvable — `delivery.kind = host_disabled`
  is a valid steady state.
- The registry is the single source of truth: an operator can read
  `src/tools/manifest.json` to see exactly which Tools are
  integrated, which are blocked on Tool-side fixes, and which require
  external hosting.
- `scripts/check-tools-manifest.mjs` mechanically enforces the
  mechanical contract (slug grammar, SHA format, gitlink SHA match,
  cross-tool uniqueness) so a future drift is caught at `pnpm run
  validate:fast`.

### Negative / Trade-offs

- 12 of 14 inventoried Tools are Next.js component libraries. They
  cannot serve themselves as same_origin_static until their own repo
  ships a standalone Vite build. That work is owned by those Tool
  repos and is not on my-web-2026's critical path.
- Submodule bumps are extra ceremony compared to a flat monorepo.
- Two package managers coexist in the parent (pnpm 12.3.x as the
  default; bun is accepted inside the Tool submodules only when the
  Tool itself declares it). `scripts/check-tools-manifest.mjs`
  enforces this.

## Re-evaluation triggers

Re-evaluate when:

- More than one Tool flips to `same_origin_static` and the operator
  wants a Tools index page. That is a #82-style ticket, not a #80
  revision.
- A Tool genuinely needs to share code with the host. That triggers a
  new obligation-boundary decision; it does not automatically promote
  the Tool into a pre-defined host domain path.
- A Tool needs a runtime API surface beyond a static iframe (e.g.
  cross-origin `postMessage` for collaboration). That is a new
  architectural decision — revisit the iframe sandbox rules in
  `delivery.iframe.sandbox` and the `Permissions-Policy` header.
