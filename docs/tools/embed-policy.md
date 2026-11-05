# Tool embed policy — first-party frames, sandbox, referrer policy, and message origin

> Canonical description of the host's iframe / `postMessage` contract
> for Tools. The executable definition is
> [`src/tools/embed-policy.ts`](../../src/tools/embed-policy.ts);
> this document explains why each rule exists and how to change it
> safely.
>
> ADR-0020 (Issue #825) decides the shape this document describes: a
> `same_origin_static` Tool is **first-party**, the iframe is a layout /
> URL / CSS-DOM container rather than a security boundary, and only an
> `external_exception` frame declares a sandbox.

## Why this document exists

ADR-0006 §3 defines *how* a Tool is delivered (build artefact →
`/tools/<slug>/app/`), and the ADR's **Re-evaluation triggers** section
(not §3) explicitly leaves the runtime API surface and the sandbox
rules open:

> "A Tool needs a runtime API surface beyond a static iframe (e.g.
> cross-origin `postMessage` for collaboration). That is a new
> architectural decision — revisit the iframe sandbox rules in
> `delivery.iframe.sandbox` and the `Permissions-Policy` header."

ADR-0020 answers the first-party half of that trigger: a Tool served
from the host's own bytes is bounded by the build / review / release
boundary, not by a browser sandbox. An `external_exception` frame is
still foreign code, so its sandbox rules (and the `allow-same-origin`
rejection) remain in force.

Until Issue #465 the only enforcement was one conditional inside
`scripts/check-tools-manifest.mjs` that flagged
`allow-scripts allow-same-origin`. Everything else — referrer policy,
frame origin, the message channel — was convention expressed in ADR
prose rather than in code.

## The three states of `/tools/<slug>`

`src/routes/tools.$slug.tsx` resolves a slug through
`evaluateToolEmbedPolicy()` **before** deciding to render a frame:

| state        | condition                                                        | rendered                                   |
| ------------ | ---------------------------------------------------------------- | ------------------------------------------ |
| `embeddable` | entry satisfies every rule below                                  | `<iframe>` with the declared referrer policy / `allow` (and, for an external frame only, the declared sandbox) |
| `blocked`    | entry violates any rule                                           | violation list, **no iframe**               |
| `disabled`   | manifest says `host_disabled`                                     | "Coming soon" placeholder                   |

`blocked` is the point of the exercise: a manifest edit can no longer
silently weaken a live Tool's policy, because the route stops rendering
instead of rendering something weaker.

**Where the 「準備中」 (`disabled`) contract is verified (Issue #861).**
The `disabled` state is a contract, but it must not be verified against
a fact that is about to disappear: the last waiting Tool
(`business-mail-block` / `history-quiz` / `ae-expression`) lands with
its own PR, and a test that needs a waiting Tool to EXIST would turn
that PR red. So the contract is split by what each half can know:

- **Unit tests = a synthetic manifest.** `createToolRegistry(manifest)`
  (`src/tools/registry.ts`) builds a registry over any manifest, and
  `src/tools/registry.test.ts` states the contract against a synthetic
  one that holds a waiting Tool (it is in `listAllTools()`, out of
  `listPublicTools()`, `getPublicTool()` is `undefined`, and
  `disabled_reason` is non-empty) and against one that holds none (every
  API still answers). The shipped manifest is asserted only on
  structural invariants (unique slugs, a non-empty `disabled_reason` on
  every waiting Tool, a non-empty Japanese description) — never on a
  frozen count or a frozen slug.
- **E2E = the shipped manifest, derived.** `e2e/nav.spec.ts` and
  `e2e/tools-index.spec.ts` read `src/tools/manifest.json` and branch
  on it: with a waiting Tool they assert the placeholder surface on the
  FIRST waiting slug; with none they assert that the index carries NO
  coming-soon badge and that every card links to its detail route, and
  the placeholder-surface test is skipped **with a reason** (the surface
  does not exist).

## Rules

### 1. `delivery.iframe` is mandatory (no implicit default)

First-party Tool:

```jsonc
"delivery": {
  "kind": "same_origin_static",
  "artifact_path": "/tools/<slug>/app",
  "entry_html": "/tools/<slug>/app/index.html",
  "iframe": { "referrer_policy": "no-referrer" }
}
```

External exception (the only kind that declares a sandbox):

```jsonc
"delivery": {
  "kind": "external_exception",
  "external_url": "https://tool.example/app/",
  "iframe": { "sandbox": "allow-scripts", "referrer_policy": "no-referrer" }
}
```

A missing block is a violation, not a default. A default would be a
silent policy the operator never reviewed. For `same_origin_static`
the required member is `referrer_policy`; for `external_exception` both
`referrer_policy` and `sandbox` are required.

### 2. The first-party frame declares no sandbox (ADR-0020)

A `same_origin_static` artefact is served from the **host's own
origin**. Laying the rest of the page out around it does not change
who authored those bytes: the Tool build is reviewed and released with
the host, and the boundary is that build / review / release gate — not
a browser attribute.

A `sandbox` declaration on a first-party Tool is therefore a violation,
not a weaker declaration:

- `sandbox: "allow-scripts"` gives the frame an opaque origin, so the
  Tool loses `localStorage` / `indexedDB` and every same-origin fetch,
  while the host gains no isolation (it already trusts those bytes).
- `sandbox: "allow-scripts allow-same-origin"` restores the host
  origin and provides no isolation at all, while still reading like a
  boundary in review.
- `sandbox: ""` is not "no sandbox": an empty attribute applies every
  restriction. Absence is the only valid first-party state.

The rule is `embed.sandbox.not-allowed-for-first-party`, and it rejects
ANY string value. It is pinned by
`src/tools/embed-policy.test.ts` and
`scripts/check-tools-manifest.test.mjs`, both of which assert the
violation for `allow-scripts`, `allow-scripts allow-same-origin`, and
the empty string.

Consequences that used to be sandbox-token questions are now ordinary
browser behaviour: a first-party Tool can use `localStorage` /
`indexedDB`, a reset `confirm()` works without `allow-modals`, and a
file export works without `allow-downloads`. The historical A/B
measurements that motivated those tokens are recorded in
`docs/verification/tools/history-quiz-host-activation.md` and in the
manifest's `notes`; they are history, not the current contract.

#### 2a. Sandbox tokens for an `external_exception` frame

An external frame is code the host does not review. It keeps a sandbox,
and the token grammar is unchanged from Issue #465:

| class        | tokens                                                                                                                                                              | requirement                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| free         | `allow-scripts`                                                                                                                                                       | none                                                        |
| conditional  | `allow-downloads`, `allow-forms`, `allow-modals`, `allow-orientation-lock`, `allow-pointer-lock`, `allow-popups`, `allow-presentation`                             | `iframe.allow` **and** `iframe.sandbox_rationale` (non-empty) |
| always denied | `allow-same-origin`, `allow-popups-to-escape-sandbox`, `allow-storage-access-by-user-activation`, `allow-top-navigation`, `allow-top-navigation-by-user-activation`, `allow-top-navigation-to-custom-protocols` | cannot be declared                                             |
| unknown      | anything else                                                                                                                                                        | violation (`allow-script` is a typo, not a working sandbox)  |

`allow-same-origin` is the important one. An external document is a
foreign origin, and `allow-same-origin` would let it keep that origin
inside the frame instead of the opaque origin the sandbox creates:
cookies, storage, and same-origin fetches against `external_url`. The
previous "document the reason" wording is replaced by an unconditional
rejection. The knock-on consequence for the message channel is spelled
out in §5a.

**`iframe.allow` is applied, not just declared.** The route renders it
verbatim as the `<iframe allow=…>` attribute
(`src/routes/tools.$slug.tsx`), because a conditional token whose grant
is dropped on the floor would be a declaration the gate reports as
valid and the browser ignores. It only takes effect in combination with
a matching host-side `Permissions-Policy` **response header**, and since
Issue #449 that header **is** sent for Tool surfaces: the shell route
resolves the manifest declaration through `toolRouteSecurityPolicy()`
(`src/tools/registry.ts`) and `src/server.ts` applies it to the
response, while `public/_headers` carries the same grant for
`/tools/<slug>/app/**`. The values and their origin scoping are
specified in
[`docs/security/security-headers.md`](../security/security-headers.md).

A first-party Tool can still declare a meaningful `iframe.allow` (for
example `fullscreen` on `pi-game` or `microphone` on `mic-level`); it
is a Permissions-Policy delegation to a same-origin frame, not a
sandbox token. `sandbox_rationale` only exists to justify a conditional
sandbox token, so it is external-only.

**The `sandbox` pattern in `manifest.schema.json` is advisory.** It
requires `allow-scripts` first and single-space separators, while this
policy (`parseTokenList`) accepts any order and any whitespace. The
stricter definition is safe but is NOT the authority:
`src/tools/embed-policy.ts` is. If ajv validation is ever wired into
the verifier, reconcile the two.

### 3. referrer policy

Accepted: `no-referrer`, `same-origin`, `strict-origin`.

Rejected: everything that can send the host's full URL (path + query)
to the frame — `unsafe-url`, `origin-when-cross-origin`,
`strict-origin-when-cross-origin`, `no-referrer-when-downgrade`, and
plain `origin`. A Tool frame is an embedded surface on someone else's
document, not a navigation the user asked for. The rule applies to both
delivery kinds: a first-party frame still fetches its own relative
assets, and a referrer policy keeps a future external navigation from
leaking the host URL.

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

#### 5a. Message origin by delivery kind (ADR-0020)

The two delivery kinds no longer share one origin story.

**`same_origin_static` — the host origin, and `'self'` works.** The
frame is not sandboxed, so it runs on the host origin and a message it
posts carries that concrete origin. A `'self'` declaration resolves to
the host origin and **matches** at runtime. This is the normal case
for a first-party Tool, and it is pinned by
`src/tools/embed-policy.test.ts` → `Tool embed policy — message origin
by delivery kind`.

**`external_exception` — still opaque.** The frame is sandboxed
without `allow-same-origin` (§2a), so it runs in an opaque origin and
reports `event.origin === "null"` whatever `external_url` says. The
build gate accepts a declaration whose `https://…` `expected_origin`
matches `external_url`, but the inbound guard refuses every event as
`origin-mismatch`: the gate compares the declaration with the origin
the **URL** implies, the browser compares the message with the origin
the **frame** runs on, and under this policy those are never the same.
(A literal `https://…` `expected_origin` on a root-relative
`entry_html` is rejected outright at build time —
`host-message.origin.mismatch`.) Host → Tool also cannot target an
opaque frame except with `"*"`, which the policy refuses; the outbound
direction is therefore unavailable for an external frame until the
question below is decided.

Making an external channel work requires a sandbox-compatible
identity, which weakens or replaces the exact-origin rule. That is an
architectural decision — ADR-0006's own re-evaluation trigger, now
scoped by ADR-0020 to the external kind — and is deliberately **not**
decided here. The current refusal is pinned by
`src/tools/embed-policy.test.ts` → `Tool embed policy — message origin
by delivery kind` so it cannot be forgotten.

##### The two contracts that would resolve the external channel (owner decision)

Neither exists in the code. Both replace the *identity primitive* the
external channel is gated on, so both need an ADR revision.

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

Until they are answered, the external frame's runtime refusal is the
correct outcome. The first-party channel is unaffected.

## Where the rules are enforced

| surface                                | when                       | on violation                                     |
| -------------------------------------- | -------------------------- | ------------------------------------------------ |
| `scripts/check-tools-manifest.mjs`     | `pnpm run tools:check` (inside `validate:fast`) | exit 1, commit blocked                            |
| `src/routes/tools.$slug.tsx`           | per request                | `blocked` placeholder, no iframe                  |
| `src/tools/use-tool-host-message.ts`   | per mount                  | no listener attached                             |

The verifier runs `evaluateToolEmbedPolicy` for **every** manifest
entry, not only for `same_origin_static`: both embeddable kinds are
rendered through the same `<iframe>` element, so an
`external_exception` with a plaintext URL, a missing
`delivery.iframe`, or `allow-scripts allow-same-origin` must fail the
commit instead of shipping a manifest the route will refuse to render.
`host_disabled` returns `[]` because nothing is framed.

All three import the same module, so a rule cannot be relaxed in one
place and enforced in another. `scripts/check-tools-manifest.mjs`
loads the `.ts` module through Node type stripping (`package.json`
requires Node >= 22.18).

## Tests (local fixtures only)

- `src/tools/embed-policy.test.ts` — the live manifest plus hostile
  fixtures for every rule, the first-party no-sandbox rule (including
  the empty-string case), the external token grammar, the runtime
  guard, listener attachment, and both directions of the message
  channel.
- `src/tools/registry.test.ts` — the registry summary carries no
  sandbox for a first-party Tool.
- `scripts/check-tools-manifest.test.mjs` — the same decisions through
  the verifier's own entry point.
- `test/integration/lazy-media-contract.test.ts` — the rendered shell
  for a shipped Tool contains `referrerPolicy="no-referrer"` and no
  `sandbox=` attribute.

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

The report renders the per-entry verdict, the external-only sandbox
token classes, and the hostile-message matrix from §"Hostile message
matrix" below. It is also a self-check: a fixture whose verdict drifts,
or a refused message that reaches the host action, makes the script
exit non-zero.

## Hostile message matrix

Fixtures used by both the unit tests and the report. Host origin
`https://host.invalid` (never contacted); the Tool window is a plain
object. The fixture contract is `expected_origin: "self"`, i.e. the
first-party shape.

| injected event                                | verdict | reason             |
| --------------------------------------------- | ------- | ------------------ |
| allowlisted type, exact origin, Tool window   | ACCEPTED| —                  |
| foreign origin, allowlisted type              | REFUSED | `origin-mismatch`  |
| origin that merely starts with the host origin | REFUSED | `origin-mismatch`  |
| opaque origin (`null`) — an external frame's origin | REFUSED | `origin-mismatch`  |
| host origin, window that is not the Tool frame| REFUSED | `source-mismatch`  |
| host origin, type outside `allowed_types`     | REFUSED | `type-not-allowed` |
| host origin, string / array payload           | REFUSED | `malformed-payload`|

The `"null"` row is the origin an `external_exception` frame reports
(§5a), not a hostile one. It is listed here because the guard must
refuse it too.

## Changing a rule

1. Edit `src/tools/embed-policy.ts` and its tests in the same commit.
2. `pnpm run tools:check` (the module is the single source of truth —
   there is nothing else to update).
3. If the change weakens isolation (a new free sandbox token for an
   external frame, a new accepted referrer policy, a wildcard origin,
   a sandbox on a first-party Tool), it needs an ADR revision:
   ADR-0006's re-evaluation trigger covers exactly this decision, and
   ADR-0020 fixes the first-party side.
4. If the change touches the external `sandbox` token grammar,
   reconcile `manifest.schema.json`'s `pattern` too — it is an
   advisory subset of the policy, not the authority (§2a).

## What this document does not decide

Whether the framed document **contacts anyone**. That is Issue #498's
contract: [`embed-privacy.md`](./embed-privacy.md) —
[`src/tools/embed-privacy.ts`](../../src/tools/embed-privacy.ts)
requires every embeddable Tool to declare the third-party origins its
artefact may contact, derives the consent mode from that declaration,
and gates the frame behind an explicit activation. Read this document
for *may it be framed*; read that one for *what does it cost the
visitor*.

## Not decided here

`host_message` is undeclared for every Tool today. The first Tool that
declares one also needs:

- a `Permissions-Policy` review for the frame the channel would use
  (ADR-0006 trigger) — the host-side header half already shipped in
  Issue #449 for `/tools/<slug>` and `/tools/<slug>/app/**`
  ([`docs/security/security-headers.md`](../security/security-headers.md)
  §3), so the remaining question is only which origin may host the
  channel, not whether a header is ever sent,
- an ADR revision if the channel is cross-origin,
- for an `external_exception` frame, an answer to §5a: how an opaque
  frame is identified at all. The first-party case no longer needs
  this: its origin is the host origin.
- a host-side action behind `onToolMessage`
  (`src/routes/tools.$slug.tsx`), which is currently a deliberate
  no-op seam rather than a missing feature.
