# Security verification artefacts

Screenshots the Issues require, regenerated from measurements rather
than hand-written.

| Artefact | Issue | Regenerate |
| --- | --- | --- |
| [`ssrf-url-adapter.webp`](ssrf-url-adapter.webp) | #453 | `pnpm run security:ssrf:report` |

## `ssrf-url-adapter.webp`

The outbound URL policy and fetch adapter (Issue #453) exercised over a
matrix of 38 destinations — 3 fetched, 35 refused.

1. **Rows are the shipped code's own verdicts.**
   `scripts/capture-ssrf-url-adapter-report.mjs` imports
   `fetchExternalUrl` (`src/http/outbound-fetch.ts`) and
   `classifyOutboundUrl` (`src/http/outbound.ts`) and records what they
   return for each input. The "結果 / code" column is the adapter's
   `result.code`, and "理由" is its `result.reason`.
2. **Every row declares the outcome it is evidence for.** Each case in
   the matrix carries an `expectCode`, and the run fails before writing
   anything when a measurement contradicts it. A label is prose; without
   that check the two drift apart silently and the image reads as proof
   of a rule nothing exercised. A second guard refuses the run when a
   row that is evidence about a policy rule instead measured a *transport*
   outcome (`fetch_failed`, `http_error`) — which means the matrix asked
   for something the policy allowed, not that the policy refused it.
3. **Nothing leaves the machine.** The transport is a local table keyed by
   URL. A refused URL is never requested, so it is never resolved or
   connected to; the script's own footer line reports how many transport
   calls happened. The only process that opens anything is the Playwright
   Chromium that renders the local HTML.
4. **The artefact is WebP, not PNG.** The Issue names a `.png` path; the
   committed file is the same report as `ssrf-url-adapter.webp`
   (1500 px wide, ~270 KiB) instead of a ~1.2 MiB full-page PNG. The
   generator writes `outFile` from its argument if a PNG is ever wanted.

Regenerate with:

```bash
node scripts/capture-ssrf-url-adapter-report.mjs
```

Add `--html .tmp/report.html` to dump the markup the image renders. The
run fails if a measurement contradicts its row's declared outcome, if a
refusal code is not one the report knows how to render, if a policy row
measured a transport outcome, if a row looks like it carries a
credential, or if the rendered page overflows horizontally (a clipped
column would make the image misleading).

The same rules are asserted against the Worker runtime in
`src/http/outbound.test.ts` and `src/http/outbound-fetch.test.ts`; this
report exists so the matrix can be *read*, not only trusted. The
interpretation of each row is in
[`docs/security/outbound-fetch.md`](../../security/outbound-fetch.md).

# Security verification artefacts

Screenshots the Issues require, regenerated from measurements rather
than hand-written.

| Artefact | Issue | Regenerate |
| --- | --- | --- |
| [`redirect-validation.webp`](redirect-validation.webp) | #454 | `pnpm run security:redirect:report` |

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
