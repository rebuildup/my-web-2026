# Tool inventory (Issue #80 — fresh state, 2026-09-27)

> Canonical inventory of the 14 standalone Tool repositories listed in
> [my-web-2025 `.gitmodules`](../../.reference/my-web-2025/.gitmodules).
> Read this before opening any Tool integration ticket (Issue #81+).
> Each row is read from the canonical repo at the recorded HEAD SHA;
> we do NOT carry assumptions forward from the my-web-2025 era.

## Classification legend

- **`same_origin_static`** — Tool has a standalone build path
  (HTML + JS + assets bundle) that can be hosted on Cloudflare Assets
  at `/tools/<slug>/...`. Default expectation.
- **`needs_tool_side_fix`** — Tool is consumable but currently lacks a
  standalone build path. Fix must land in the Tool repo (ADR-0006
  §3, Issue #80 — `Tool-side fix が必要な場合`). Pin bumps the SHA
  after the Tool PR lands.
- **`external_exception`** — Tool genuinely requires a different
  origin (e.g. `getUserMedia` from an `https` context, Web Bluetooth,
  WASM modules that must be served from the tool's own CDN). Must be
  justified explicitly in the manifest.
- **`not_integrable_yet`** — Tool needs architectural rework before
  any same-origin hosting is possible. Out of scope until a future
  Tool ticket revives it.

## Inventory

All 14 repos are `PUBLIC` on GitHub, MIT (except `ProtoType` which
declares no license), default branch `main` (except `tool-pi-game` =
`develop`).

| slug | repo | HEAD SHA | default | license | package manager | build path | browser APIs | classification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `prototype` | [rebuildup/ProtoType](https://github.com/rebuildup/ProtoType) | `18e925272ca274e428e143c45194950d562bc096` | `main` | (none) | pnpm | `pnpm run build` (`tsc -b && vite build`) — full Vite app with `index.html` | fetch, canvas / WebGL, three.js, gsap | `same_origin_static` (heavy: ~14 prod deps; large bundle) |
| `text-counter` | [rebuildup/tool-text-counter](https://github.com/rebuildup/tool-text-counter) | `5371479f6b49e2139424ebb9388287cc5e1a6e03` | `main` | MIT | pnpm (peer `next: ^16.3.0`) | NONE — Next.js component library, exports `./src/index.ts` | none (pure text processing) | `needs_tool_side_fix` |
| `color-palette` | [rebuildup/tool-color-palette](https://github.com/rebuildup/tool-color-palette) | `0eb51503ba39712827497281ca489a379c8c912b` | `main` | MIT | pnpm (peer `next: ^16.3.0`) | NONE — Next.js component library | none (pure color math) | `needs_tool_side_fix` |
| `sequential-png-preview` | [rebuildup/tool-sequential-png-preview](https://github.com/rebuildup/tool-sequential-png-preview) | `2bcad8a121f0b058d3f17ac900c76bcc4d47a34e` | `main` | MIT | pnpm (peer `next: ^16.3.0`) | NONE — Next.js component library | `<input type="file">` for drag-drop, `<img>`, `URL.createObjectURL` | `needs_tool_side_fix` |
| `svg2tsx` | [rebuildup/tool-svg2tsx](https://github.com/rebuildup/tool-svg2tsx) | `4e85e922d87bfd75c62d4e0b6cfe595b8289368a` | `main` | MIT | pnpm (peer `next: ^16.3.0`) | NONE — Next.js component library | `<input type="file">`, `URL.createObjectURL` | `needs_tool_side_fix` |
| `business-mail-block` | [rebuildup/tool-business-mail-block](https://github.com/rebuildup/tool-business-mail-block) | `d1ea054adc87315ed6555751b21109366b16710f` | `main` | MIT | `bun@1.3.10` (peer `next: ^16.3.0`) | NONE — Next.js component library | `@hello-pangea/dnd` (drag-drop), `navigator.clipboard` | `needs_tool_side_fix` |
| `code-type-p5` | [rebuildup/tool-code-type-p5](https://github.com/rebuildup/tool-code-type-p5) | `509c2873a434673befeee08c3bf6d4b2c8473b94` | `main` | MIT | pnpm (peer `next: ^16.3.0`) | NONE — Next.js component library | canvas (p5.js) | `needs_tool_side_fix` |
| `fillgen` | [rebuildup/tool-fillgen](https://github.com/rebuildup/tool-fillgen) | `01d53b84e9884352aa2bc44a6b917708de5f5199` | `main` | MIT | pnpm (peer `next: ^16.3.0`) | NONE — Next.js component library | canvas | `needs_tool_side_fix` |
| `qr-generator` | [rebuildup/tool-qr-generator](https://github.com/rebuildup/tool-qr-generator) | `19fd50bb32d4cc1fd1e6129de32a6771c2e6667f` | `main` | MIT | pnpm (peer `next: ^16.3.0`) | NONE — Next.js component library | `qrcode` + `qrcode.react` (canvas / SVG render) | `needs_tool_side_fix` |
| `pomodoro` | [rebuildup/tool-pomodoro](https://github.com/rebuildup/tool-pomodoro) | `954cfd898dba6f46c8ef250d69b1b64245c0eecf` | `main` | MIT | pnpm (peer `next: ^16.3.0`) | NONE — Next.js component library | `Notification`, `Audio` | `needs_tool_side_fix` |
| `history-quiz` | [rebuildup/tool-history-quiz](https://github.com/rebuildup/tool-history-quiz) | `72328139de1ac5ceee84babbf76cd82899fde8c3` | `main` | MIT | pnpm (peer `next: ^16.3.0`) | NONE — Next.js component library | none (quiz state machine) | `needs_tool_side_fix` |
| `pi-game` | [rebuildup/tool-pi-game](https://github.com/rebuildup/tool-pi-game) | `9e19ec5d63c84fad9be625b33b0455e922ba3570` | **`develop`** | MIT | pnpm (peer `next: ^16.3.0`) | NONE — Next.js component library | none (typing game) | `needs_tool_side_fix` (note: default branch `develop`, not `main`) |
| `ae-expression` | [rebuildup/tool-ae-expression](https://github.com/rebuildup/tool-ae-expression) | `cd136e251ae7372143a0ee4af4c727324df47655` | `main` | MIT | pnpm (peer `next: ^16.3.0`) | NONE — Next.js component library | `navigator.clipboard` | `needs_tool_side_fix` |
| `mic-level` | [rebuildup/tool-mic-level](https://github.com/rebuildup/tool-mic-level) | `5df7ac64539ec82fe4a7f4d7de1f2bb9d0b808c3` | `main` | MIT | pnpm + `bun test` (dep `next: ^16.3.0`) | NONE — Next.js component library | `navigator.mediaDevices.getUserMedia({ audio: true })` | `external_exception` (mic capture requires `https` + user gesture; same-origin via `/tools/mic-level` works too, but CSP must allow `microphone`) |

## Counts

| classification | count |
| --- | --- |
| `same_origin_static` | 1 (ProtoType) |
| `needs_tool_side_fix` | 12 |
| `external_exception` | 1 (mic-level) |
| `not_integrable_yet` | 0 |
| **total** | **14** |

## Critical findings

1. **12 of 14 tools are Next.js component libraries**, not standalone applications.
   They expose `main: ./src/index.ts` for a Next.js host to import.
   None of them have `vite.config.ts` / `index.html` / standalone build
   command. To integrate them via the standalone-artifact contract,
   each Tool repo must add a `tools/<slug>-build.mjs` (or similar) that
   wraps the React component in a static host HTML page.

2. **Only `ProtoType` is currently a true standalone Vite app** — but it
   is heavy (gsap, three.js, recharts, google-spreadsheet). It is the
   pilot candidate (Issue #81) because the contract is the strictest
   test of the orchestration: a heavy multi-route Vite SPA must be
   collectable under `/tools/prototype/`.

3. **`tool-mic-level` is the only `external_exception`** candidate —
   it captures the user's microphone via `getUserMedia`. Same-origin
   hosting works as long as the iframe is served over `https` (which
   the canonical production origin `rebuildup.dev` provides). The
   CSP / `Permissions-Policy: microphone=(self)` requirement is a
   header concern, not an origin concern. It may graduate to
   `same_origin_static` once we add a Tool-side build script.

4. **`tool-pi-game` has `default_branch = develop`**, not `main`. This
   affects the registered gitlink branch in `.gitmodules` if we ever
   decide to float pins; we currently pin SHAs so the branch name
   only matters for `git submodule update`.

5. **`ProtoType` declares no license** — embedding continues despite
   this. The brief explicitly accepts embed-only without redistribution:
   my-web-2026 hosts the artifact at `/tools/prototype/` for its own
   users without redistributing the source. A `LICENSE` field in the
   Tool repo is still preferred for clarity and is tracked as a
   follow-up at the Tool repo's discretion (not blocking #81).

6. **`ProtoType`'s `package.json` declares a `preinstall` script that
   executes obfuscated `eval()`** at install time. my-web-2026's
   build orchestrator pins `pnpm install --ignore-scripts` for
   ProtoType (recorded in `docs/tools/manifest.json` `build.security`).
   The contract treats **any untrusted Tool lifecycle script** as
   out-of-scope: we run the build, but never `postinstall` / `preinstall`
   from third-party repos. The Tool repo is responsible for removing
   the obfuscated preinstall (Issue #81 follow-up at the Tool repo,
   not my-web-2026).

## What this means for Issue #81 pilot selection

Issue #81 picks **`prototype`** as the pilot because:

- It is the **only** Tool that is currently a true standalone Vite app
  (every other Tool needs a Tool-side fix to add a build path).
- It is the **heaviest** standalone app. If `/tools/prototype/` ships
  correctly with all assets (gsap, three.js, recharts), the contract
  holds for everything lighter.
- It is the strictest test of the build orchestrator: large bundle,
  multiple assets, Vite's default `dist/` shape.

Rejected candidates:

- **`text-counter`** (rejected for #81, not in principle) — would be
  the smallest possible end-to-end test of the orchestration, but
  requires a Tool-side fix to add a standalone build (currently
  Next.js component library). That work belongs in the Tool repo,
  not my-web-2026. Issue #81's brief was "ship one Tool end-to-end
  without expanding scope", which `prototype` satisfies more directly.

Issue #81 records the rejected candidates and their reason in its
PR body.

## What this means for Tool-side fixes

For each `needs_tool_side_fix` Tool, the canonical fix is:

1. Add `vite.config.ts` with `base: '/'` (the host will serve under
   `/tools/<slug>/`; the Tool's own router must be aware of the base
   path, OR the host serves the artifact under a same-origin route
   that mirrors the Tool's root).
2. Add `index.html` that mounts `<div id="root">` and the bundled JS.
3. Add `scripts/build.mjs` (or a `build` script in `package.json`)
   that runs `vite build --base=/tools/<slug>/` and outputs to
   `dist/`.
4. The Tool's own CI verifies the build.

The Tool repo becomes self-hosting — the my-web-2026 parent just
invokes the Tool's own `pnpm run build` and copies `dist/` into
`dist/client/tools/<slug>/`.

For `mic-level`, the same standalone build is also possible; the
only difference is that the iframe hosting it must carry
`Permissions-Policy: microphone=(self)` on the host origin.
