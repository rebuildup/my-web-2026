# Verification artefacts

Evidence captured for a security control, kept next to the code so a
reviewer can check the claim without a running environment.

## `markdown-xss-fixture.webp`

- **Issue:** #451 (Markdown / Notion-derived HTML XSS boundary).
- **What it shows:** the Portfolio article route
  (`GET /portfolio/<slug>`) served by the LOCAL Worker, rendering a
  `portfolio_project` row whose `motivation_md` is the shared attack
  corpus from `src/portfolio/markdown.xss-fixtures.ts`.
- **How to read it:**
  - Rows labelled *(accepted / text | markdown-link)* are normal
    article copy: bold, italic, an internal link and an external link.
    They must still render as real elements — a sanitiser that deleted
    everything would also "pass" by rendering nothing.
  - Rows labelled *(blocked / raw-html)* show payloads such as
    `<script>`, `<img onerror>`, `<svg onload>` and `<iframe>` as
    **visible escaped text** (`&lt;script&gt;`), never as markup.
  - Rows labelled *(blocked / markdown-link)* show the visible refusal
    marker: the link text followed by `— blocked link (<reason>)`,
    with the refused target kept in `data-blocked-href`. The reasons
    distinguish `scheme-not-allowed`, `encoded-scheme` (character
    reference), `control-character` (TAB) and `data:`/`vbscript:`
    schemes. The marker is a `<span>`, not an anchor: there is
    nothing to click.
- **What it does NOT contain:** no credentials, no `.dev.vars` values,
  no internal hostnames. Every destination in the corpus is
  `example.com` / `example.invalid` (reserved for documentation by
  RFC 2606 / RFC 6761), and each payload only assigns to
  `window.__xssFired`, which the capture script asserts is `undefined`.

## Regenerating

The artefact is reproducible from the repository:

```sh
# local D1 + a fixture row + the local Worker + chromium screenshot,
# then PNG -> WebP (width <= 1600, quality 80, budget 300 KB)
node .tmp/capture-markdown-xss-fixture.mjs
```

The script lives under `.tmp/` (gitignored) on purpose: it is a
generator for a committed artefact, not product code. It writes only
to the LOCAL D1 state (`.tmp/d1state`), starts the Vite dev server on
`127.0.0.1`, deletes the fixture row when it finishes, and never
reads a secret or touches a remote binding.

The automated equivalent of this capture is
`test/integration/markdown-xss-ssr.test.ts`, which asserts the same
properties over the served HTML and therefore runs on every push.

## Format note

The Issue asked for `markdown-xss-fixture.png`. The committed file is
`markdown-xss-fixture.webp` instead: same pixels, ~10x smaller, so the
repository does not carry a large binary. The PNG intermediate is
written to `.tmp/` and is not committed.