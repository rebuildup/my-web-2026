# Security verification artefacts

Screenshots the Issues require, regenerated from measurements rather
than hand-written.

| Artefact | Issue | Regenerate |
| --- | --- | --- |
| [`hsts-response.webp`](hsts-response.webp) | #446 | `pnpm run verify:hsts-screenshot` |
| [`redirect-validation.webp`](redirect-validation.webp) | #454 | `pnpm run security:redirect:report` |

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