# Security verification artefacts

Screenshots the Issues require, regenerated from measurements rather
than hand-written. Each artefact is regenerable from a
repository-controlled command, so a reviewer can reproduce it instead
of trusting the image.

| Artefact | Issue | Regenerate |
| --- | --- | --- |
| [`error-redaction-page.webp`](error-redaction-page.webp) | #457 | `pnpm run capture:error-redaction-report` |
| [`redirect-validation.webp`](redirect-validation.webp) | #454 | `pnpm run security:redirect:report` |

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
