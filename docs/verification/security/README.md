# Security verification artefacts

Screenshots the Issues require, regenerated from measurements rather
than hand-written. Each artefact is regenerable from a
repository-controlled command, so a reviewer can reproduce it instead
of trusting the image.

| Artefact | Issue | Regenerate |
| --- | --- | --- |
| [`frame-ancestors-test.webp`](frame-ancestors-test.webp) | #448 | `pnpm run verify:frame-ancestors-screenshot` |
| [`hsts-response.webp`](hsts-response.webp) | #446 | `pnpm run verify:hsts-screenshot` |
| [`redirect-validation.webp`](redirect-validation.webp) | #454 | `pnpm run security:redirect:report` |
| [`markdown-xss-fixture.webp`](markdown-xss-fixture.webp) | #451 | capture generator is **not** in the repository — see [`## markdown-xss-fixture.webp`](#markdown-xss-fixturewebp); the same properties are asserted on every push by `pnpm exec vitest run test/integration/markdown-xss-ssr.test.ts` and by `pnpm run e2e` |
| [`webhook-signature-fixture.webp`](webhook-signature-fixture.webp) | #463 | `pnpm run webhook:fixture:report` |
| [`error-redaction-page.webp`](error-redaction-page.webp) | #457 | `pnpm run capture:error-redaction-report` |

## `webhook-signature-fixture.webp`

The inbound-webhook verification contract table (Issue #463): every
local fixture — signature, freshness window, replay claim — with its
declared and observed verdict. The rows are produced by
`scripts/webhook-signature-fixture-report.mjs` running the **same**
`src/http/webhooks/fixtures.ts` builder the Vitest contract test
asserts on, so the picture cannot disagree with the suite; the script
exits non-zero if any fixture deviates. No key material is rendered.
`/webhooks/*` still has no mounted handler — the report documents an
adapter, not a published entry point. Reading guide:
[`docs/security/webhook-signature-verification.md`](../../security/webhook-signature-verification.md).


## `error-redaction-page.webp` (Issue #457)

Proof that the external HTTP boundary answers failures with
`{ error, message, request_id }` only — no stack, SQL, table name,
secret name, or binding name — while accepted and rejected requests
keep their documented shapes, and that a failing public server
function renders `portfolio_unavailable (ref)` instead of the D1
message. The last rows are real SSR renders of `/portfolio`,
`/about`, and `/`.

Regenerate:

```bash
pnpm run capture:error-redaction-report
# or: node scripts/capture-error-redaction-report.mjs
```

The command runs `test/integration/error-redaction.test.ts` in the
local workerd pool, reads the responses that suite captured, renders
them as a static report in `.tmp/`, and screenshots it with the
Playwright chromium already installed for the E2E suite.

The committed artefact is WebP (width ≤ 1600 px, quality 80), not
PNG: Playwright cannot write WebP, so the script re-encodes the
screenshot buffer with the `sharp` devDependency and never writes an
intermediate PNG. The report is a text-heavy page, so q80 keeps the
bodies and the leak verdicts legible at a fraction of the PNG size,
and the repository does not carry a lossless raster for an artefact
that is regenerated on demand.

Reading the page:

| Badge | Meaning |
| --- | --- |
| 成功 (accepted) | Valid input; the documented public contract is returned unchanged. |
| 拒否 (rejected) | Input the caller got wrong; a stable error code (and at most a repo-authored validator reason) is returned. |
| 失敗・秘匿 (failed) | An internal error occurred; the body carries only the code, a safe message, and the correlation id. The last rows are SSR renders: `/portfolio` and `/about` show `portfolio_unavailable (ref)` and nothing else, and `/` still renders with a degraded reactions widget. |

Nothing secret is captured: the suite authenticates with a literal
stub key through the documented DI seam
(`src/http/api-keys/middleware.ts#withVerifyApiKey`) and never reads
an env var, a `.dev.vars`, or a Worker secret.

The Issue names `error-redaction-page.png`; the artefact ships as WebP
in the same directory, for the same reason as `redirect-validation.webp`
below — Playwright cannot write WebP, so the generator re-encodes the
screenshot buffer with `sharp` and never commits an intermediate PNG.

## `frame-ancestors-test.webp`

The inbound embed policy (Issue #448) exercised over the surfaces that
exist today: public documents, the Tool shell and its artefact, the
Admin redirect and child routes, the Account boundary, the
lookalike paths that must not inherit a denial, and the committed
public static HTML under `public/` (`/share/procon2026/`), which
Static Assets answer before the Worker runs.

The Issue names `frame-ancestors-test.png`; the artefact ships as WebP
in the same directory, because the capture is a dense text table where
PNG costs several times the bytes for no visual gain.
`scripts/make-frame-ancestors-report.mjs` runs the workerd suite with
Vitest's JSON reporter, runs the static gate over `public/_headers` and
over four deliberately broken fixtures, renders both into one report,
and encodes it as WebP in memory (Playwright cannot emit WebP, so the
PNG bytes are captured into a Buffer and re-encoded with `sharp`, width
≤ 1600, quality 80). It refuses to write anything that is not WebP.

The four fixtures are the *rejected* direction the Issue asks to be
reproducible: a Tool artefact rule switched to `'none'`, one opened to
`*`, an `/admin*` rule in `_headers`, and a `public/` HTML document
left with no rule at all (the Tool-only rule set evaluated against the
real `public/` scan — what the review found before the `/share/*` rule
was added). Each is rejected by
`scripts/check-frame-ancestors-policy.mjs`, so the table shows what
"denied" means without reading the source. Nothing secret is in the
picture: the suite runs against the local workerd pool's dummy bindings
and the gate reads two static files and the `public/` tree.

Regenerate with:

```bash
pnpm run verify:frame-ancestors-screenshot
```

The policy table, the enforcement halves, and the unscanned inventory
are in [`docs/security.md`](../../security.md#csp-frame-ancestors).

## `hsts-response.webp`

The HSTS delivery policy (Issue #446) as the runtime actually applies it:
the workerd test pool result plus the static gate verdict.

The Issue names `hsts-response.png`; the artefact ships as WebP in the
same directory. `scripts/make-hsts-verification-report.mjs` runs the
suite with Vitest's JSON reporter, renders a static HTML report, and
captures it in Chromium. Playwright cannot encode WebP, so the capture
stays in a Buffer and `sharp` writes WebP at quality 80; no intermediate
PNG reaches the disk, and the script refuses to write any non-`.webp`
target.

1. **The policy shown is the shipped policy.** The generator reads the
   directive from `src/server.ts` through the same function the static
   gate uses (`readCanonicalDirective`), so the report cannot advertise a
   value the runtime does not serve.
2. **PASS means an exact match.** Each row asserts the observed header
   equals the restated literal exactly, over HTTPS *and* over plaintext,
   across the SSR document, the external boundary and the auth redirect.
   A test whose title no longer exists renders as `MISSING` rather than
   disappearing, so a rename cannot quietly delete a row.
3. **Nothing secret is in the picture.** The bindings are the test-only
   dummies from `vitest.config.ts`, `/api/v1/health` touches no binding,
   and the generator makes no network call — no cookie value, no token,
   no production D1/R2.

Regenerate with:

```bash
pnpm run verify:hsts-screenshot
```

The interpretation of each row is in
[`docs/security.md`](../../security.md#https-強制と-hsts-issue-446).

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
  shared attack corpus from `test/fixtures/markdown-xss-fixtures.ts`.
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
   `test/fixtures/markdown-xss-fixtures.ts` (write it into the local
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
