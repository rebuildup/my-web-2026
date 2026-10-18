# Security verification artefacts

Screenshots the Issues require, regenerated from measurements rather
than hand-written.

| Artefact | Issue | Regenerate |
| --- | --- | --- |
| [`frame-ancestors-test.webp`](frame-ancestors-test.webp) | #448 | `pnpm run verify:frame-ancestors-screenshot` |
| [`redirect-validation.webp`](redirect-validation.webp) | #454 | `pnpm run security:redirect:report` |

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