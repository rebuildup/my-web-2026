# Tool embed privacy — declared third-party contacts (Issue #498)

> Canonical description of what an embedded Tool is allowed to do to a
> visitor's network, and of the declaration that publishes it. The
> executable definition is
> [`src/tools/embed-privacy.ts`](../../src/tools/embed-privacy.ts); this
> document explains why each rule exists and how to change it safely.

## Why this document exists

[`embed-policy.md`](./embed-policy.md) (Issue #465, scoped by ADR-0020)
decides whether a Tool **may** be framed: referrer policy, frame origin,
message channel, and the sandbox that only an `external_exception` frame
declares. It says nothing about what the framed document does
once it is mounted — and the gap was not theoretical. Measured against
the two Tools the registry ships, `/tools/prototype` mounted a
document that, before the visitor touched anything, contacted:

| origin | how the artefact reaches it |
| --- | --- |
| `https://fonts.googleapis.com` | `<link rel=preconnect>` + stylesheet in the artefact's own `index.html` |
| `https://fonts.gstatic.com` | `<link rel=preconnect crossorigin>` + the font files it points at |
| `https://use.typekit.net` | Adobe Typekit loader script injected by an inline script in the artefact's `index.html` |
| `https://script.google.com` | a Google Apps Script endpoint in `src/gamesets/022_Login.ts`, reachable from `src/components/002_Header.tsx`; its `checkPassword()` puts `id` / `password` in the query string |

Nothing about that was visible on the host page.

Issue #498 added the missing half: the host **publishes** which origins
each Tool may contact, and fails closed when a Tool would be framed
without that declaration. The click_to_load **gate** that originally
sat in front of the frame was removed by owner decision (PR #914): the
iframe mounts directly, and the declaration is the visitor-facing
disclosure of what the mount will do.

## Scope

In scope: what an embedded Tool (`/tools/<slug>`, ADR-0006 delivery)
costs a visitor's network, and how that is declared, tested and
published.

Out of scope, deliberately, because they belong to other owners:

- **The host document's own third-party surface.** Every page —
  including `/tools/<slug>` — mounts GA4 and Google Fonts in the site
  chrome (Issue #171 mounted GA4; Issue #447 measured the origin
  inventory). That is a deliberate product decision and a larger
  surface than the embed's. This contract does not change it.
- **Outbound third-party API reads.** `src/external-api/**` (Issue
  #499) owns those, and it is not wired to a route.

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
the Tool contacts nobody — not an omission. The inverse also holds: a
`delivery.privacy` block whose `third_party_origins` is missing, `null`
or not an array is a violation (`privacy.origins.missing`), not an
empty list. Before that rule, `privacy: {}` looked like a written
"no contact" declaration, so a manifest could publish an undeclared
contact list by leaving the field out.
`host_disabled` and `not_integrable_yet` entries are not policed,
because nobody frames them; a Tool that graduates must declare its
contacts first.

### 2. The frame mounts directly — the declaration is the disclosure

There is no gate and there is deliberately **no** `consent_mode` field:
nothing a manifest could write would weaken the disclosure. The
`/tools/<slug>` route renders the iframe as soon as the route renders,
after the embed policy and this contract have both passed the entry.

A frame `src` the contract cannot resolve at all (`javascript:`,
`data:`, garbage) is not special-cased here: `embed-policy.ts` refuses
such an `src` outright (`embed.frame-src.invalid-scheme`), so nothing
unresolved is ever framed.

The frame `src` itself is resolved by `resolveToolFrameSrc()` in
`embed-policy.ts` — the SAME function the policy uses — so the privacy
contract and the embed policy can never disagree about which document
the host mounts (a `same_origin_static` entry that declares no
`entry_html` is mounted from `artifact_path`/index.html).

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

## What the route does

`src/routes/tools.$slug.tsx`:

- `evaluateEmbedPrivacy()` runs in the **loader**. A violation renders
  the existing blocked placeholder (both violation families are listed
  there) — no iframe, ever.
- A clean verdict renders the ordinary `ToolEmbedShell` directly (PR
  #914): same referrer policy, same message contract as before Issue
  #498 (a first-party frame has no sandbox — ADR-0020).

The shell has no visitor-specific content (no analytics id, no
account, no personal data): it is rendered for every visitor of the
route, crawlers included.

## Verification

| Question | Where it is answered |
| --- | --- |
| Policy over hostile fixtures (wildcards, undeclared external frame, missing purpose, …) | `src/tools/embed-privacy.test.ts` |
| The served document's host markup adds no third-party request beyond the chrome's own, and the detector is not vacuous | `test/integration/embed-privacy.test.ts` |
| The frame mounts directly; the declared contacts are the disclosure | `e2e/tools-prototype.spec.ts`, `e2e/lazy-media.spec.ts` |

The integration suite's headline assertion is a subset, not a count:
the third-party URLs a Tool document's HOST markup references must be a
**subset of the ones an embed-free page (`/contact`) already
references**. The baseline is asserted non-empty, so the subset cannot
pass vacuously.

## Re-measuring after a submodule bump

`pnpm run tools:check` verifies the declaration's *shape*, never its
*truth* — the host cannot observe a framed document's network
behaviour. Re-declaring is therefore a manual duty on every Tool bump:

1. Read the new `pinned_sha`'s `index.html`, `public/**` and the
   modules reachable from its entry point; collect every `https://`
   host it references.
2. Ignore the ones that cannot be fetched: XML namespace identifiers
   (`www.w3.org`), licence/doc links, `<a href>` navigation targets
   (the Tool frame declares no `allow-top-navigation` / `allow-popups`
   capability and a same-origin link cannot fire a third-party request
   from the host document).
3. Write the remainder into `third_party_origins`, and update `purpose`
   and `basis`.
4. A new origin shows up as a publication-surface delta
   (`pnpm run publication:check`) — record it deliberately with
   `pnpm run publication:write`.

## Open owner decisions

1. **ProtoType's Apps Script endpoint.** The declaration publishes it,
   so the visitor is told, but the host cannot fix it: the Tool sends a
   `password` query parameter to a third-party endpoint inside the
   frame. Whether ProtoType keeps that call, drops it, or moves it to
   its own origin is a ProtoType-side decision.
2. **YouTube / X / Discord embeds.** None ship here, and none are
   planned. If one is added, it enters through `delivery.external_url`
   and is policed by this contract automatically — but the
   *publication* of that host also needs a `publication:write` record,
   and what the site says about third-party embeds in general would
   need an owner decision.
