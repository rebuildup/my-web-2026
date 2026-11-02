# Tool inventory (Issue #80 — fresh state, 2026-09-27; #195 — readmark added 2026-09-29; #773 — ae-expression graduated to `same_origin_static` 2026-11-03; #855 — mic-level graduated to `same_origin_static` 2026-11-03)

> Canonical inventory of the 15 standalone Tool repositories tracked in
> `src/tools/manifest.json`. 14 of these are inherited from
> [my-web-2025 `.gitmodules`](../../.reference/my-web-2025/.gitmodules);
> `readmark` was added in Issue #195 as a new Tool repo
> ([rebuildup/readmark](https://github.com/rebuildup/readmark))
> created 2026-09-26 and intentionally designed to embed as a Tool
> in my-web-2026. Read this before opening any Tool integration
> ticket (Issue #81+). Each row is read from the canonical repo at
> the recorded HEAD SHA; we do NOT carry assumptions forward from
> the my-web-2025 era.

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
| `readmark` | [rebuildup/readmark](https://github.com/rebuildup/readmark) | `906c90e57e51f1d7b3fe739f085cf9978445c0fb` | `main` | MIT | `bun@1.4.2` (`engines.bun >= 1.4.0`) | `tsc -b --noCheck && vite build` (Vite app with `index.html`, `vite.config.ts`, `bun.lock`) | `pdfjs-dist` 5.x (PDF decode via `SharedArrayBuffer`, needs COOP/COEP headers), Dexie (IndexedDB local-first), React Router | `same_origin_static` (PDF reading MVP; MIT; added by #195) |
| `text-counter` | [rebuildup/tool-text-counter](https://github.com/rebuildup/tool-text-counter) | `b0c7ba203df7d822a87387d367fd1415d13382e6` | `main` | MIT | bun | `bun install --frozen-lockfile && bun run build` — standalone Vite SPA (`index.html`) | none (pure text processing) | `same_origin_static`
| `color-palette` | [rebuildup/tool-color-palette](https://github.com/rebuildup/tool-color-palette) | `b3fed92bac4a6d32b48be21c35ad8b8239d4d5e5` | `main` | MIT | bun | `bun install --frozen-lockfile && bun run build` — standalone Vite SPA (`index.html`) | none (pure color math) | `same_origin_static`
| `sequential-png-preview` | [rebuildup/tool-sequential-png-preview](https://github.com/rebuildup/tool-sequential-png-preview) | `ddec2729d8b244ebab3370d2eccb95be25e2a43a` | `main` | MIT | bun | `bun install --frozen-lockfile && bun run build` — standalone Vite SPA (`index.html`) | `<input type="file">` for drag-drop, `<img>`, `URL.createObjectURL` | `same_origin_static`
| `svg2tsx` | [rebuildup/tool-svg2tsx](https://github.com/rebuildup/tool-svg2tsx) | `6289e2c89a484c3a31bd9b8cba368d6b38c414a0` | `main` | MIT | bun | `bun install --frozen-lockfile && bun run build` — standalone Vite SPA (`index.html`) | `<input type="file">`, `URL.createObjectURL` | `same_origin_static`
| `business-mail-block` | [rebuildup/tool-business-mail-block](https://github.com/rebuildup/tool-business-mail-block) | `d1ea054adc87315ed6555751b21109366b16710f` | `main` | MIT | bun | NONE — Next.js component library (no standalone build yet; the manifest keeps the Tool `host_disabled`)  | `@hello-pangea/dnd` (drag-drop), `navigator.clipboard` | `needs_tool_side_fix`
| `code-type-p5` | [rebuildup/tool-code-type-p5](https://github.com/rebuildup/tool-code-type-p5) | `2e1193111faa837d3653d72410aa0e3c97a176b3` | `main` | MIT | bun | `bun install --frozen-lockfile && bun run build` — standalone Vite SPA (`index.html`) | canvas (p5.js) | `same_origin_static`
| `fillgen` | [rebuildup/tool-fillgen](https://github.com/rebuildup/tool-fillgen) | `962ae889790dfe0e5288c6b1fe61ab9c4f36ae9a` | `release-0-1-0` | MIT | bun | `bun install --frozen-lockfile && bun run build` — standalone Vite SPA (`index.html`) | canvas | `same_origin_static`
| `qr-generator` | [rebuildup/tool-qr-generator](https://github.com/rebuildup/tool-qr-generator) | `0df1a99e32cea8d34a56f41dbc580db3e494c8d3` | `main` | MIT | pnpm | `pnpm install --frozen-lockfile && pnpm run build` — standalone Vite SPA (`index.html`) | `qrcode` + `qrcode.react` (canvas / SVG render) | `same_origin_static`
| `pomodoro` | [rebuildup/tool-pomodoro](https://github.com/rebuildup/tool-pomodoro) | `7ce10d78dc6efc1a71aebd2051e29b80216dfd2c` | `main` | MIT | pnpm | `pnpm install --frozen-lockfile && pnpm run build` — standalone Vite SPA (`index.html`) | `Notification`, `Audio` | `same_origin_static`
| `history-quiz` | [rebuildup/tool-history-quiz](https://github.com/rebuildup/tool-history-quiz) | `72328139de1ac5ceee84babbf76cd82899fde8c3` | `main` | MIT | pnpm | NONE — Next.js component library (no standalone build yet; the manifest keeps the Tool `host_disabled`)  | none (quiz state machine) | `needs_tool_side_fix`
| `pi-game` | [rebuildup/tool-pi-game](https://github.com/rebuildup/tool-pi-game) | `e67d9cec91bc431ab10003aa229205466a822425` | `develop` | MIT | pnpm | `pnpm install --frozen-lockfile && pnpm run build` — standalone Vite SPA (`index.html`) | none (typing game) | `same_origin_static`
| `ae-expression` | [rebuildup/tool-ae-expression](https://github.com/rebuildup/tool-ae-expression) | `56bbbbd6174c1baee5b542565466f8154ad633ed` | `main` | MIT | pnpm (`pnpm-lock.yaml`, no `next` peer) | `pnpm install --frozen-lockfile && pnpm run build` — standalone Vite SPA (`index.html`, `base: "./"`; Issue #6 / PR #7) | `navigator.clipboard` (with `document.execCommand("copy")` fallback), `URL.createObjectURL` + `link.download` (file export) | `same_origin_static` (graduated 2026-11-03, Issue #773: embedded from the host's own origin with `sandbox="allow-scripts allow-downloads"` — the export writes a file, and a sandboxed frame drops the download without that token; measured, see `docs/security/security-headers.md` §3) |
| `mic-level` | [rebuildup/tool-mic-level](https://github.com/rebuildup/tool-mic-level) | `9506e4619541d8912346648ced1239607acea199` | `main` | MIT | bun (`bun.lock`, `bun test`) | `bun install --frozen-lockfile && bun run build` — standalone Vite SPA (`index.html`; tool PR #4) | `navigator.mediaDevices.getUserMedia({ audio: true })` | `same_origin_static` (graduated 2026-11-03, Issue #855: shipped from the host's own origin; the microphone is granted per-Tool via `Permissions-Policy: microphone=(self "<serving origin>")` + `<iframe allow="microphone">`; the measurements are in `docs/verification/tools/mic-level-host-activation.md`) |

## Counts

The counts follow the canonical `classification` field of
`src/tools/manifest.json` as of this branch's merge with
`origin/release-0-8-1` = `df766a82` (2026-11-03): 13 Tools are
`same_origin_static`, 2 are `needs_tool_side_fix`, 0 are
`external_exception`. The per-row `build path` / `HEAD SHA` columns
are the 2026-09-27 (#80) / #195 reading of each Tool repo, refreshed
for every row whose pin and classification the manifest now states
differently (the Issue #817 waves and this branch's #773 / #855
changes) — the manifest is the authority for the current pin.

| classification | count |
| --- | --- |
| `same_origin_static` | 13 (ProtoType, readmark, text-counter, color-palette, sequential-png-preview, svg2tsx, qr-generator, code-type-p5, fillgen, pomodoro, pi-game, ae-expression, mic-level) |
| `needs_tool_side_fix` | 2 (business-mail-block, history-quiz) |
| `external_exception` | 0 |
| `not_integrable_yet` | 0 |
| **total** | **15** |

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

3. **`tool-mic-level` graduated to `same_origin_static`** (Issue #855,
   2026-11-03) — the `external_exception` class is now empty. The
   Tool-side standalone build landed (`bun run build` → `dist/`), and
   the microphone is granted per-Tool rather than host-wide: the
   origin-scoped `Permissions-Policy: microphone=(self
   "https://rebuildup.dev")` grant plus `<iframe allow="microphone">`
   on the host route. The framed document keeps an opaque origin under
   the shipped `sandbox="allow-scripts"`, so `getUserMedia` is refused
   until ADR-0020 §2.1 lands — the measurements are in
   `docs/verification/tools/mic-level-host-activation.md`.

4. **`tool-pi-game` has `default_branch = develop`**, not `main`. This
   affects the registered gitlink branch in `.gitmodules` if we ever
   decide to float pins; we currently pin SHAs so the branch name
   only matters for `git submodule update`.

5. **`ProtoType` declares no license** — same-origin hosting of an
   artifact at `/tools/<slug>/app/` IS distribution (the host serves
   the bundle to any visitor of the route), so embed-only-without-
   redistribution is not a sustainable interpretation. The operator-
   ownership question (who is allowed to ship / re-host the source
   under their own brand) is between the two repos and is a Tool-
   repo `LICENSE` concern, NOT a third-party reuse license. The
   Tool-side `LICENSE` file is the canonical fix and is tracked as a
   ProtoType follow-up (see [rebuildup/ProtoType#4](https://github.com/rebuildup/ProtoType/issues/4)).
   Do **not** auto-apply any licence interpretation to third-party
   Tools: each Tool's own repo + licence governs.

6. **`ProtoType`'s `package.json` declares a `preinstall` script that
   executes obfuscated `eval()`** at install time. my-web-2026's
   build orchestrator pins `pnpm install --ignore-scripts` for
   ProtoType (recorded in `docs/tools/manifest.json` `build.security`).
   The contract treats **any untrusted Tool lifecycle script** as
   out-of-scope: we run the build, but never `postinstall` / `preinstall`
   from third-party repos. The Tool repo is responsible for removing
   the obfuscated preinstall ([rebuildup/ProtoType#4](https://github.com/rebuildup/ProtoType/issues/4),
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

For `mic-level`, the standalone build has landed (Issue #855) and the
shipped frame is served from the host's own origin; the only
difference is that the iframe hosting it must carry
`Permissions-Policy: microphone=(self "https://rebuildup.dev")` — the
origin-scoped form `self` alone cannot satisfy, because the framed
document has an opaque origin under the shipped
`sandbox="allow-scripts"` (Issue #449; see
[`docs/security/security-headers.md`](../security/security-headers.md)).

## Policy change (2026-09-29, Issue #195)

The pre-#195 brief forbade showing Tools that are not actually
integrated — `/tools` listed only `same_origin_static` /
`external_exception` entries (i.e. just ProtoType), and
`/tools/<slug>` threw `notFound()` for every `host_disabled`
slug. Issue #195 flipped this so users can see the full my-web
tool roadmap:

- **`/tools` index** now calls `listAllTools()` (every manifest
  entry) instead of `listPublicTools()` (embeddable-only). Tools
  are grouped into **Integrated** (clickable cards) and
  **Coming soon** (non-link cards with a badge + the
  `disabled_reason` text). Sort is alphabetical within each group,
  embeddable first.
- **`/tools/<slug>`** still throws `notFound()` for genuinely
  missing slugs, but renders a "Coming soon" placeholder for
  `host_disabled` Tools that resolves through `getTool()` (so the
  `disabled_reason` is available). The iframe shell still calls
  `getPublicTool()` and is unchanged for embeddable Tools.
- **`src/tools/registry.ts`** exposes `listAllTools()` as the
  canonical show-all surface. `listPublicTools()` and
  `getPublicTool()` remain for the embeddable surface. `listTools()`
  is retained as an alias for `listAllTools()`.
- **`scripts/seed-tools.mjs`** iterates the full manifest
  dynamically (`manifest.tools.length` rows), so adding readmark
  to the manifest automatically produces 15 `INSERT OR REPLACE`
  rows on the next dry-run. No script edit was required.
- **`scripts/check-tools-manifest.mjs`** is unchanged in spirit;
  the URL typo-guard was tightened so it only flags URLs that
  look like a `tool-<slug>.git` pattern with a wrong slug segment
  (e.g. `tool-text-counter.git` recorded with slug `text-counter`).
  URLs that intentionally use a non-`tool-` repo name (readmark
  → `rebuildup/readmark`, ProtoType → `rebuildup/ProtoType`) are
  no longer flagged.
