# Security verification artefacts

Screenshots the Issues require, regenerated from measurements rather
than hand-written.

| Artefact | Issue | Regenerate |
| --- | --- | --- |
| [`redirect-validation.webp`](redirect-validation.webp) | #454 | `pnpm run security:redirect:report` |
| [`markdown-xss-fixture.webp`](markdown-xss-fixture.webp) | #451 | capture generator is **not** in the repository — see [`## markdown-xss-fixture.webp`](#markdown-xss-fixturewebp); the same properties are asserted on every push by `pnpm exec vitest run test/integration/markdown-xss-ssr.test.ts` and by `pnpm run e2e` |

## `redirect-validation.webp`

The open-redirect guard (Issue #454) exercised over a matrix of
`returnTo` / `callbackURL` values.

The Issue names `redirect-validation.png`; the artefact ships as WebP
in the same directory. The capture is a dense text table, so PNG cost
~390 KB for no visual gain while WebP at `quality: 80` is ~155 KB.
`scripts/redirect-validation-report.mjs` captures a temporary PNG into
`.tmp/`, converts it with `sharp` (width ≤ 1600, quality ladder
80 → 72 → 64 → 56 until the result is under 300 KB), deletes the
temporary file, and refuses to write anything that is not WebP.

1. **Rows are real responses.** `scripts/redirect-validation-report.mjs`
   sends a real `Request` per row through the shipped
   `redirectTargetGuard` middleware (`src/http/security/redirect-guard.ts`)
   mounted on `/api/v1/auth/*`, and records the status and body it gets
   back. The "guard verdict" column is `classifyRedirectTarget`'s own
   decision for the same value.
2. **The last column is the login screen.** It shows what
   `/admin/login?returnTo=` resolves to under the route's own policy
   (`allowedPrefixes: ['/admin']`, no trusted origins) — which is why an
   absolute URL is accepted by the boundary and refused by the page.
3. **Nothing secret is in the picture.** `evil.example` appears as a
   string; the script fetches nothing off-origin, sends no credential,
   and only renders local HTML in Chromium.

Regenerate with:

```bash
pnpm run security:redirect:report
```

Add `--html .tmp/report.html` to dump the markup the image renders. The
script exits non-zero if any response is neither `200` nor a
`400 invalid_redirect_target`, if the image would exceed 300 KB at
quality 80, or if the rendered page overflows horizontally (a clipped
column would make the image misleading).

The same matrix is asserted against the real Worker entry and the real
Better Auth handler by `src/http/security/redirect-guard.test.ts`; this
report exists so the matrix can be *read*, not only trusted. The
interpretation of each row is in
[`docs/security/open-redirect.md`](../../security/open-redirect.md).

## `markdown-xss-fixture.webp`

Evidence for the Portfolio article input boundary (Issue #451), captured
from the **LOCAL** Worker so that the payloads can be shown as they are
written in the corpus, without an attacker-controlled origin anywhere
in the picture.

- **Issue:** #451 (Markdown / Notion-derived HTML XSS boundary).
- **What it shows:** the article route (`GET /portfolio/<slug>`)
  rendering a `portfolio_project` row whose `motivation_md` is the
  shared attack corpus from `src/portfolio/markdown.xss-fixtures.ts`.
- **How to read it:**
  - Rows labelled *(accepted / text | markdown-link)* are normal
    article copy: bold, italic, an internal link and an external link.
    They must still render as real elements — a sanitiser that deleted
    everything would also "pass" by rendering nothing.
  - Rows labelled *(blocked / raw-html)* show payloads such as
    `<script>`, `<img onerror>`, `<svg onload>` and `<iframe>` as
    **visible escaped text** (`&lt;script&gt;`), never as markup.
  - Rows labelled *(blocked / markdown-link)* show the visible refusal
    marker: the link text followed by `— blocked link (<reason>)`, with
    the refused target kept in `data-blocked-href`. The marker is a
    `<span>`, not an anchor: there is nothing to click. The reason is
    one of the five values in `BLOCKED_HREF_REASONS`
    (`src/portfolio/markdown.lexer.ts`) — this corpus produces
    `scheme-not-allowed` (which covers `data:` and `vbscript:` too),
    `encoded-scheme` (character reference, e.g. `javascript&#58;…`) and
    `control-character` (TAB inside the scheme).
- **What it does NOT contain:** no credentials, no `.dev.vars` values,
  no internal hostnames. Every destination in the corpus is
  `example.com` / `example.invalid` (reserved for documentation by
  RFC 2606 / RFC 6761), and each payload only assigns to
  `window.__xssFired`, which the capture asserted to be `undefined`.

### Regenerating

The capture generator is **not committed to this repository**, so this
artefact cannot be regenerated from the tree alone. To rebuild it:

1. Seed the local D1 with the fixture row from the shared corpus:
   `markdownXssFixtureRowValues()` in
   `src/portfolio/markdown.xss-fixtures.ts` (write it into the local
   `.tmp/d1state` binding with `scripts/_d1.mjs`; never into a remote
   binding).
2. Start the local Worker (`pnpm run dev`, or `pnpm preview` after
   `pnpm run build` when a built client is required).
3. Open `/portfolio/<fixture slug>` in the local chromium, assert
   `window.__xssFired === undefined`, and capture the full page to
   `.tmp/`.
4. Convert to WebP with the repo's `sharp` devDependency (width
   ≤ 1600, `quality: 80`, budget 300 KB) and write it back to
   `docs/verification/security/markdown-xss-fixture.webp`.

The automated equivalent of steps 1–3 runs on every push and does not
need the generator: `test/integration/markdown-xss-ssr.test.ts`
asserts the same properties over the served `<article>` region through
`SELF.fetch`, and `e2e/portfolio-markdown-xss.spec.ts` (part of
`pnpm run e2e`) asserts them in a real browser.

### Format note

The Issue asked for `markdown-xss-fixture.png`. The committed file is
`markdown-xss-fixture.webp` instead: same pixels, ~10x smaller, so the
repository does not carry a large binary. The PNG intermediate is
written to `.tmp/` and is not committed.
