# Tool embed policy — sandbox, referrer policy, and message origin (Issue #465)

> Canonical description of the host's iframe / `postMessage` contract
> for Tools. The executable definition is
> [`src/tools/embed-policy.ts`](../../src/tools/embed-policy.ts);
> this document explains why each rule exists and how to change it
> safely.

## Why this document exists

ADR-0006 §3 defines *how* a Tool is delivered (build artefact →
`/tools/<slug>/app/`), and the ADR's **Re-evaluation triggers** section
(not §3) explicitly leaves the runtime API surface and the sandbox
rules open:

> "A Tool needs a runtime API surface beyond a static iframe (e.g.
> cross-origin `postMessage` for collaboration). That is a new
> architectural decision — revisit the iframe sandbox rules in
> `delivery.iframe.sandbox` and the `Permissions-Policy` header."

Nothing in ADR-0006 states the `allow-same-origin` rule or requires a
written reason for a capability token; both requirements are introduced
by this Issue and by `src/tools/manifest.schema.json`.

Until Issue #465 the only enforcement was one conditional inside
`scripts/check-tools-manifest.mjs` that flagged
`allow-scripts allow-same-origin`. Everything else — referrer policy,
frame origin, the message channel — was convention expressed in
`ADR prose rather than in code.

## The three states of `/tools/<slug>`

`src/routes/tools.$slug.tsx` resolves a slug through
`evaluateToolEmbedPolicy()` **before** deciding to render a frame:

| state        | condition                                                        | rendered                                   |
| ------------ | ---------------------------------------------------------------- | ------------------------------------------ |
| `embeddable` | entry satisfies every rule below                                  | `<iframe>` with the **declared** sandbox / referrer policy / `allow` |
| `blocked`    | entry violates any rule                                           | violation list, **no iframe**               |
| `disabled`   | manifest says `host_disabled`                                     | "Coming soon" placeholder                   |

`blocked` is the point of the exercise: a manifest edit can no longer
silently weaken a live Tool's sandbox, because the route stops
rendering instead of rendering something weaker.

## Rules

### 1. `delivery.iframe` is mandatory (no implicit default)

```jsonc
"delivery": {
  "kind": "same_origin_static",
  "artifact_path": "/tools/<slug>/app",
  "entry_html": "/tools/<slug>/app/index.html",
  "iframe": { "sandbox": "allow-scripts", "referrer_policy": "no-referrer" }
}
```

A missing block is a violation, not a default. A default would be a
silent policy the operator never reviewed.

### 2. sandbox tokens

| class        | tokens                                                                                                                                                              | requirement                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| free         | `allow-scripts`                                                                                                                                                       | none                                                        |
| conditional  | `allow-downloads`, `allow-forms`, `allow-modals`, `allow-orientation-lock`, `allow-pointer-lock`, `allow-popups`, `allow-presentation`                             | `iframe.allow` **and** `iframe.sandbox_rationale` (non-empty) |
| always denied | `allow-same-origin`, `allow-popups-to-escape-sandbox`, `allow-storage-access-by-user-activation`, `allow-top-navigation`, `allow-top-navigation-by-user-activation`, `allow-top-navigation-to-custom-protocols` | cannot be declared                                             |
| unknown      | anything else                                                                                                                                                        | violation (`allow-script` is a typo, not a working sandbox)  |

`allow-same-origin` is the important one. A `same_origin_static`
artefact is served from the **host's own origin**, so
`allow-same-origin` hands the Tool that origin: `document.cookie`,
`localStorage`, `indexedDB`, and same-origin `fetch` to `/api/v1/*`.
The sandbox attribute still reads correctly in review while providing
no isolation at all. The previous "document the reason" wording is
therefore replaced by an unconditional rejection. The knock-on
consequence for the message channel is spelled out in §5.

**`iframe.allow` is applied, not just declared.** The route renders it
verbatim as the `<iframe allow=…>` attribute
(`src/routes/tools.$slug.tsx`), because a conditional token whose grant
is dropped on the floor would be a declaration the gate reports as
valid and the browser ignores. It only takes effect in combination with
a matching host-side `Permissions-Policy` **response header**, which the
host does not send for Tool frames yet — the header is part of
ADR-0006's re-evaluation trigger and is listed under
["Not decided here"](#not-decided-here).

**The `sandbox` pattern in `manifest.schema.json` is advisory.** It
requires `allow-scripts` first and single-space separators, while this
policy (`parseTokenList`) accepts any order and any whitespace. The
stricter definition is safe but is NOT the authority: `src/tools/embed-policy.ts`
is. If ajv validation is ever wired into the verifier, reconcile the two.

### 3. referrer policy

Accepted: `no-referrer`, `same-origin`, `strict-origin`.

Rejected: everything that can send the host's full URL (path + query)
to the Tool — `unsafe-url`, `origin-when-cross-origin`,
`strict-origin-when-cross-origin`, `no-referrer-when-downgrade`, and
plain `origin`. A Tool frame is an embedded surface on someone else's
document, not a navigation the user asked for.

### 4. frame origin

| delivery kind          | accepted `src`                                          | rejected                                             |
| ---------------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| `same_origin_static`   | root-relative path (`/tools/<slug>/app/index.html`)       | `//host/...`, `https://host/...`, non-http schemes, and any src URL resolution sends off-origin (`/\host/...`) |
| `external_exception`   | `https://...` from `external_url`                         | `http://...`, protocol-relative, missing `external_url` |
| `host_disabled`        | not framed, not policed                                    | —                                                     |

`//host/...` is called out separately because it is the realistic
form of this mistake: it reads like a path and is a foreign origin.

**The origin comes from a parse, not from the first character.** A
src that starts with `/` is only `same-origin` if resolving it
actually lands on the host origin. The URL parser maps `\` to `/`
inside an `http(s)` URL and strips raw tab / LF / CR, so
`/\evil.example/tool` resolves to `https://evil.example/tool` — a
prefix check calls it same-origin, and the browser loads a foreign
frame. `classifyToolFrameSrc` therefore resolves every root-relative
src against a stand-in host origin (`https://host.invalid`, never
contacted) and compares origins; anything that lands elsewhere is
`cross-origin` and fails the gate as `embed.frame-src.cross-origin`.
The rules and their traps are pinned by
`src/tools/embed-policy.test.ts` → `Tool embed policy — frame origin`.

### 5. The message channel is opt-in

```jsonc
"host_message": {
  "expected_origin": "self",            // or an explicit https origin — see §5a
  "allowed_types": ["tool:ready", "tool:resize"],
  "source": "iframe_window"             // the only accepted value
}
```

- **No `host_message` block → no `message` listener is attached at
  all.** Today every Tool is in this state, so an unexpected message
  from a Tool frame has no host code to reach.
- With a block, an event must satisfy all of:
  1. `event.origin === expectedOrigin` (exact string equality — checked
     *before* the source, so a hostile frame cannot probe the other
     branch),
  2. `event.source === iframe.contentWindow`,
  3. `data` is a plain object and `data.type ∈ allowed_types`.
- `expected_origin` must be `"self"` or an `https` origin literal.
  `"*"` is never valid, and a declared origin that does not match the
  frame's actual origin is a violation at build time.
- Host → Tool (`postToToolWindow`) resolves the declaration through the
  same `resolveExpectedToolOrigin` the inbound guard uses, so `"self"`
  becomes the concrete host origin; it then refuses `targetOrigin: '*'`,
  any target that is not the resolved origin, and any string
  `postMessage` would reject (`"self"`, a path, a non-URL) — a manifest
  typo can never become an uncaught `SyntaxError` on the host page.

#### 5a. The opaque-origin constraint (every framed Tool)

This policy always denies `allow-same-origin` (§2), so **every**
framed Tool — `same_origin_static` and `external_exception` alike —
runs in an **opaque origin**, whatever URL its `src` names, and every
message it posts reports `event.origin === "null"`. The sandbox, not
the `src`, decides the origin a document runs on. Consequences:

- A `"self"` declaration on a `same_origin_static` Tool passes the
  manifest gate (the declaration is syntactically valid, and the frame
  src really is root-relative), the guard attaches, and then **every**
  event is refused as `origin-mismatch`. It is fail-closed, and inert:
  no Tool declares `host_message` today.
- The other form the gate accepts — an `external_exception` Tool whose
  `https://…` `expected_origin` matches its `external_url` — is
  refused at runtime **for the same reason**: the frame is still
  sandboxed without `allow-same-origin`, so it reports `"null"`, not
  `https://tool.example`. The build gate compares the declaration with
  the origin the **URL** implies; the browser compares the message with
  the origin the **frame** runs on, and under this policy those are
  never the same. (A literal `https://…` `expected_origin` on a
  root-relative `entry_html` is rejected outright at build time —
  `host-message.origin.mismatch`.)
- So no `host_message` declaration of either form can be satisfied
  today, on either embeddable kind. This is a property of the sandbox
  rules, not of the manifest: the channel is fully implemented and
  fully tested, and gated off until the identity question below is
  answered.
- Making one work requires a sandbox-compatible identity, which weakens
  or replaces the exact-origin rule. That is an architectural decision,
  i.e. ADR-0006's own re-evaluation trigger, and is deliberately
  **not** decided here. The current behaviour is pinned by
  `src/tools/embed-policy.test.ts` →
  `Tool embed policy — the opaque-origin constraint on a framed Tool`
  so it cannot be forgotten.

##### The two contracts that would resolve it (owner decision)

Neither exists in the code. Both replace the *identity primitive* the
channel is gated on, so both need an ADR-0006 revision.

**A — opaque-origin marker.** Require `event.origin === "null"` (what
a sandboxed document always reports) in addition to today's
`event.source === iframe.contentWindow`.

- A frame that navigates away from the sandboxed artefact reports a
  real origin and is refused, so the frame-navigation case still fails
  closed.
- But **every** document that ends up in that frame is then inside the
  trust boundary, and `expected_origin` stops meaning an origin.

**B — host-issued nonce.** The host posts a per-render nonce into the
frame — `postMessage(…, "*")`, the only form an opaque-origin frame
accepts — and the Tool echoes it in every message.

- The Tool has to implement a handshake it never asked for, and the
  nonce has to reach the artefact at all (render-time query, or a
  host-authored bootstrap): a Tool-facing contract, not a host-internal
  one.
- The trust boundary becomes "a document that was handed the nonce".

Two sub-questions a decision has to answer before either is adopted:

1. **What is trusted?** Under A the host trusts whatever document
   occupies the Tool frame; under B only a document that was handed the
   nonce. The build gate polices the **manifest**, not the artefact's
   runtime behaviour, so this has to be accepted explicitly.
2. **Outbound.** `postMessage` cannot target an opaque-origin frame
   except with `"*"`, which this policy refuses unconditionally
   (`postToToolWindow` → `wildcard-target-origin`). Under either
   candidate the host → Tool direction therefore stays unavailable
   unless the outbound rule changes as well — a decision of its own.

Until they are answered, the runtime refusal is the correct outcome.

## Where the rules are enforced

| surface                                | when                       | on violation                                     |
| -------------------------------------- | -------------------------- | ------------------------------------------------ |
| `scripts/check-tools-manifest.mjs`     | `pnpm run tools:check` (inside `validate:fast`) | exit 1, commit blocked                            |
| `src/routes/tools.$slug.tsx`           | per request                | `blocked` placeholder, no iframe                  |
| `src/tools/use-tool-host-message.ts`   | per mount                  | no listener attached                             |

The verifier runs `evaluateToolEmbedPolicy` for **every** manifest
entry, not only for `same_origin_static`: both embeddable kinds are
rendered through the same `<iframe>` element with the same declared
policy, so an `external_exception` with a plaintext URL, a missing
`delivery.iframe`, or `allow-scripts allow-same-origin` must fail the
commit instead of shipping a manifest the route will refuse to render.
`host_disabled` returns `[]` because nothing is framed.

All three import the same module, so a rule cannot be relaxed in one
place and enforced in another. `scripts/check-tools-manifest.mjs`
loads the `.ts` module through Node type stripping (`package.json`
requires Node >= 22.18).

## Tests (local fixtures only)

- `src/tools/embed-policy.test.ts` — the live manifest plus hostile
  fixtures for every rule, the runtime guard, listener attachment,
  and the host → Tool direction.
- `scripts/check-tools-manifest.test.mjs` — the same decisions through
  the verifier's own entry point.

No fixture reaches a Tool repository, a Cloudflare resource, or the
network: each is an object literal plus a fake window.

## Verification report / screenshot

```bash
pnpm run tools:embed-policy:report -- --out=.tmp/tool-iframe-sandbox.html
```

Then open that file, or screenshot it with the repo's installed
Playwright chromium — no extra script file is needed:

```bash
node --input-type=module -e "
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await page.goto('file://' + resolve('.tmp/tool-iframe-sandbox.html'));
await page.screenshot({ path: '.tmp/tool-iframe-sandbox.png', fullPage: true });
await browser.close();
"
node -e "require('sharp')('.tmp/tool-iframe-sandbox.png')
  .resize({ width: 1600, withoutEnlargement: true })
  .webp({ quality: 80 })
  .toFile('docs/verification/security/tool-iframe-sandbox.webp')"
```

Committed screenshot: `docs/verification/security/tool-iframe-sandbox.webp`
(1600 px wide, WebP quality 80, ~200 KB). The Issue names a `.png`
path; only the extension differs, chosen to keep the binary small in
the repository. The intermediate PNG is not committed. **This is an
open convention question** — the repository has no screenshot-format
rule of its own, so whether `docs/verification/security/` keeps WebP
or follows the Issue's literal `.png` is an owner call.

The report renders the per-entry verdict, the sandbox token classes,
and the hostile-message matrix from §"Hostile message matrix" below.
It is also a self-check: a fixture whose verdict drifts, or a refused
message that reaches the host action, makes the script exit non-zero.

## Hostile message matrix

Fixtures used by both the unit tests and the report. Host origin
`https://host.invalid` (never contacted); the Tool window is a plain
object.

| injected event                                | verdict | reason             |
| --------------------------------------------- | ------- | ------------------ |
| allowlisted type, exact origin, Tool window   | ACCEPTED| —                  |
| foreign origin, allowlisted type              | REFUSED | `origin-mismatch`  |
| origin that merely starts with the host origin | REFUSED | `origin-mismatch`  |
| opaque origin (`null`) — see §5a               | REFUSED | `origin-mismatch`  |
| host origin, window that is not the Tool frame| REFUSED | `source-mismatch`  |
| host origin, type outside `allowed_types`     | REFUSED | `type-not-allowed` |
| host origin, string / array payload           | REFUSED | `malformed-payload`|

The `"null"` row is the origin a **compliant** same-origin Tool frame
reports (§5a), not a hostile one. It is listed here because the guard
must refuse it too.

## Changing a rule

1. Edit `src/tools/embed-policy.ts` and its tests in the same commit.
2. `pnpm run tools:check` (the module is the single source of truth —
   there is nothing else to update).
3. If the change weakens isolation (a new free sandbox token, a new
   accepted referrer policy, a wildcard origin), it needs an ADR
   revision: ADR-0006's re-evaluation trigger covers exactly this
   decision.
4. If the change touches the `sandbox` token grammar, reconcile
   `manifest.schema.json`'s `pattern` too — it is an advisory subset of
   the policy, not the authority (§2).

## Not decided here

`host_message` is undeclared for every Tool today. The first Tool that
declares one also needs:

- a `Permissions-Policy` review for the header (ADR-0006 trigger) —
  until the host sends that response header, a declared
  `iframe.allow` grant has no effect even though it is rendered,
- an ADR revision if the channel is cross-origin,
- an answer to §5a: how a framed Tool — opaque origin by construction,
  under both delivery kinds — is identified at all. The two candidate
  contracts, and what each one costs, are written out in §5a so the
  decision is a choice rather than a research task,
- a host-side action behind `onToolMessage`
  (`src/routes/tools.$slug.tsx`), which is currently a deliberate
  no-op seam rather than a missing feature.