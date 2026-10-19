# Tool embed privacy — declared third-party contacts and the consent gate (Issue #498)

> Canonical description of what an embedded Tool is allowed to do to a
> visitor's network, and of the gate that keeps it from doing it before
> anyone asked. The executable definition is
> [`src/tools/embed-privacy.ts`](../../src/tools/embed-privacy.ts); this
> document explains why each rule exists and how to change it safely.
>
> Verification record: [`docs/verification/legal/embed-privacy-consent.md`](../verification/legal/embed-privacy-consent.md).

## Why this document exists

[`embed-policy.md`](./embed-policy.md) (Issue #465) decides whether a
Tool **may** be framed: sandbox tokens, referrer policy, frame origin,
message channel. It says nothing about what the framed document does
once it is mounted — and the gap was not theoretical. Measured against
the two Tools the registry ships, `/tools/prototype` mounted a
document that, before the visitor touched anything, contacted:

| origin | how the artefact reaches it |
| --- | --- |
| `https://fonts.googleapis.com` | `<link rel=preconnect>` + stylesheet in the artefact's own `index.html` |
| `https://fonts.gstatic.com` | `<link rel=preconnect crossorigin>` + the font files it points at |
| `https://use.typekit.net` | Adobe Typekit loader script injected by an inline script in the artefact's `index.html` |
| `https://script.google.com` | a Google Apps Script endpoint in `src/gamesets/022_Login.ts`, reachable from `src/components/002_Header.tsx`; its `checkPassword()` puts `id` / `password` in the query string |

Every visitor to `/tools/prototype` paid for that, including the ones
who closed the tab immediately. Nothing about it was visible on the
host page.

This Issue adds the missing half: the host **publishes** which origins
each Tool may contact, and it **loads nothing** until the visitor
activates the load.

## Scope

In scope: what an embedded Tool (`/tools/<slug>`, ADR-0006 delivery)
costs a visitor's network before and after activation, and how that is
declared, gated, tested and reported.

Out of scope, deliberately, because they belong to other owners:

- **The host document's own third-party surface.** Every page —
  including `/tools/<slug>` — mounts GA4 and Google Fonts in the site
  chrome (Issue #171 mounted GA4; Issue #447 measured the origin
  inventory). That is a deliberate product decision and a larger
  surface than the embed's. This Issue does not change it.
- **Outbound third-party API reads.** `src/external-api/**` (Issue
  #499) owns those, and it is not wired to a route.
- **A consent store.** No cookie, no `localStorage`, no server-side
  record. See §5.

## The contract

### 1. `delivery.privacy` is required for every embeddable Tool

```jsonc
"privacy": {
  "third_party_origins": ["https://fonts.googleapis.com", "…"],
  "purpose": { "ja": "…", "en": "…" },
  "basis": "measured against the pinned <tool> source at <sha>; re-measure after a submodule bump"
}
```

`src/tools/manifest.schema.json` describes the block;
`src/tools/embed-privacy.ts` is the authority and
`pnpm run tools:check` (`scripts/check-tools-manifest.mjs`) evaluates
it over every manifest entry with the **same function** the
`/tools/<slug>` loader runs per request.

An empty `third_party_origins` array is a **written declaration** that
the Tool contacts nobody — not an omission. `host_disabled` and
`not_integrable_yet` entries are not policed, because nobody frames
them; a Tool that graduates must declare its contacts first.

### 2. Consent is derived, never declared

There is deliberately **no** `consent_mode` field. The host computes
it:

```text
click_to_load  ⇔  the frame is cross-origin  OR  third_party_origins is non-empty
not_required   ⇔  otherwise
```

So there is nothing to switch off. An operator cannot write
`"consent_mode": "not_required"` and ship a Tool that phones home; the
only way to `not_required` is to prove the Tool is same-origin **and**
declares no contact.

### 3. A foreign frame must name itself

An `external_exception` frame is a document request to a foreign
origin by definition, so its own origin must appear in
`third_party_origins`. A manifest cannot embed an external document
without publishing which origin serves it.

### 4. Declared origins are bare origins

`https://host[:port]` and nothing else. Rejected: wildcards
(`https://*.google.com` — not a disclosure of one party), paths,
queries and fragments (`https://x.test/track?id=1` is a tracking URL,
not an origin), `http:`, credentials in the authority, and repeats.

### 5. The gate stores nothing

Activation is per visit. The route holds one boolean of React state;
no cookie is set, nothing is written to storage, and a reload asks
again. A consent record would be a new published data surface with its
own retention story — that is an owner decision, not this Issue's
call. `e2e/tools-prototype.spec.ts` asserts the reload behaviour so
the current choice stays deliberate rather than accidental.

## What the gate looks like

`src/routes/tools.$slug.tsx`:

- `evaluateEmbedPrivacy()` runs in the **loader**. A violation renders
  the existing blocked placeholder (both violation families are listed
  there) — no iframe, ever.
- A clean `click_to_load` verdict renders
  `ToolConsentNotice` (`src/tools/embed-consent-notice.tsx`): the
  Tool name, the sentence that nothing is loaded and nothing is
  contacted yet, the **declared origin list**, the declared purpose in
  both locales, the "no consent record is stored" note, and one
  `<button type=button>`.
- Pressing it flips the state and mounts the ordinary
  `ToolEmbedShell` — same sandbox, same referrer policy, same message
  contract as before this Issue.

The notice has no visitor-specific content (no analytics id, no
account, no personal data): it is rendered for every visitor of the
route, crawlers included.

## Verification

| Question | Where it is answered |
| --- | --- |
| Policy over hostile fixtures (wildcards, undeclared external frame, missing purpose, …) | `src/tools/embed-privacy.test.ts` |
| Notice markup carries no request-bearing URL | `src/tools/embed-consent-notice.test.tsx` |
| The served document contacts nothing before activation, and the detector is not vacuous | `test/integration/embed-privacy.test.ts` |
| Activation is what mounts the frame; the origin list is shown | `e2e/tools-prototype.spec.ts`, `e2e/lazy-media.spec.ts` |
| Measured record + screenshot | `docs/verification/legal/embed-privacy-consent.md` |

The integration suite's headline assertion is a subset, not a count:
the third-party URLs a Tool document references must be a **subset of
the ones an embed-free page (`/contact`) already references**. The
baseline is asserted non-empty, so the subset cannot pass vacuously.

## Re-measuring after a submodule bump

`pnpm run tools:check` verifies the declaration's *shape*, never its
*truth* — the host cannot observe a framed document's network
behaviour. Re-declaring is therefore a manual duty on every Tool bump:

1. Read the new `pinned_sha`'s `index.html`, `public/**` and the
   modules reachable from its entry point; collect every `https://`
   host it references.
2. Ignore the ones that cannot be fetched: XML namespace identifiers
   (`www.w3.org`), licence/doc links, `<a href>` navigation targets
   (the Tool frame is sandboxed without `allow-top-navigation` /
   `allow-popups`, so a link cannot fire a request).
3. Write the remainder into `third_party_origins`, update `purpose`
   and `basis`, and re-run `pnpm run verify:embed-privacy-screenshot`.
4. A new origin shows up as a publication-surface delta
   (`pnpm run publication:check`) — record it deliberately with
   `pnpm run publication:write`.

## Open owner decisions

1. **Consent persistence** (§5). Per-visit re-asking is the current,
   privacy-minimal behaviour. A remembered consent, a cookie banner, or
   a "necessary vs. functional" classification are all owner calls
   that need their own record.
2. **ProtoType's Apps Script endpoint.** The declaration publishes it,
   so the visitor is told, but the host cannot fix it: the Tool sends a
   `password` query parameter to a third-party endpoint inside a frame
   the visitor activated. Whether ProtoType keeps that call, drops it,
   or moves it to its own origin is a ProtoType-side decision, and it
   is the strongest reason a future Tool should not need a consent
   gate at all.
3. **YouTube / X / Discord embeds.** None ship here, and none are
   planned. If one is added, it enters through `delivery.external_url`
   and is gated by this contract automatically — but the *publication*
   of that host also needs a `publication:write` record, and the
   privacy copy a visitor reads would need an owner decision about what
   the site says about third-party embeds in general.