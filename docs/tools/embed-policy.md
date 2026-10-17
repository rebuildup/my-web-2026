# Tool embed policy — sandbox, referrer policy, and message origin (Issue #465)

> Canonical description of the host's iframe / `postMessage` contract
> for Tools. The executable definition is
> [`src/tools/embed-policy.ts`](../../src/tools/embed-policy.ts);
> this document explains why each rule exists and how to change it
> safely.

## Why this document exists

ADR-0006 §3 defines *how* a Tool is delivered (build artefact →
`/tools/<slug>/app/`) and explicitly leaves the embed security
question open:

> "A Tool needs a runtime API surface beyond a static iframe (e.g.
> cross-origin `postMessage` for collaboration). That is a new
> architectural decision — revisit the iframe sandbox rules in
> `delivery.iframe.sandbox` and the `Permissions-Policy` header."

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
| `embeddable` | entry satisfies every rule below                                  | `<iframe>` with the **declared** sandbox / referrer policy |
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
therefore replaced by an unconditional rejection.

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
| `same_origin_static`   | root-relative path (`/tools/<slug>/app/index.html`)       | `//host/...`, `https://host/...`, non-http schemes     |
| `external_exception`   | `https://...` from `external_url`                         | `http://...`, protocol-relative, missing `external_url` |
| `host_disabled`        | not framed, not policed                                    | —                                                     |

`//host/...` is called out separately because it is the realistic
form of this mistake: it reads like a path and is a foreign origin.

### 5. The message channel is opt-in

```jsonc
"host_message": {
  "expected_origin": "self",            // or an explicit https origin
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
- Host → Tool (`postToToolWindow`) refuses `targetOrigin: '*'` and any
  target origin that is not the declared one.

## Where the rules are enforced

| surface                                | when                       | on violation                                     |
| -------------------------------------- | -------------------------- | ------------------------------------------------ |
| `scripts/check-tools-manifest.mjs`     | `pnpm run tools:check` (inside `validate:fast`) | exit 1, commit blocked                            |
| `src/routes/tools.$slug.tsx`           | per request                | `blocked` placeholder, no iframe                  |
| `src/tools/use-tool-host-message.ts`   | per mount                  | no listener attached                             |

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

## Changing a rule

1. Edit `src/tools/embed-policy.ts` and its tests in the same commit.
2. `pnpm run tools:check` (the module is the single source of truth —
   there is nothing else to update).
3. If the change weakens isolation (a new free sandbox token, a new
   accepted referrer policy, a wildcard origin), it needs an ADR
   revision: ADR-0006's re-evaluation trigger covers exactly this
   decision.

## Not decided here

`host_message` is undeclared for every Tool today. The first Tool that
declares one also needs:

- a `Permissions-Policy` review for the header (ADR-0006 trigger),
- an ADR revision if the channel is cross-origin,
- a host-side action behind `onToolMessage`
  (`src/routes/tools.$slug.tsx`), which is currently a deliberate
  no-op seam rather than a missing feature.