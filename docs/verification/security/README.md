# Security verification artefacts

Screenshots the Issues require, regenerated from measurements rather
than hand-written.

| Artefact | Issue | Regenerate |
| --- | --- | --- |
| [`redirect-validation.webp`](redirect-validation.webp) | #454 | `pnpm run security:redirect:report` |
| [`headers-browser.webp`](headers-browser.webp) | #449 | `node scripts/security-header-report.mjs` |

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

## `headers-browser.webp`

The screenshot Issue #449 asks for: the
`nosniff` / `Referrer-Policy` / `Permissions-Policy` policy as it is
actually observed, not as it is described. It is stored as a
moderately compressed WebP (width ≤ 1600, quality 80) rather than a
PNG so the verification artefact stays small; the content is
unchanged.

### What is in the image

1. **Worker responses** — measured by
   `test/integration/security-headers.test.ts` running the real Worker in
   the local workerd pool (`SELF.fetch`), over the host page, a 404, the
   external boundary (success + `notFound`), the admin redirect, the admin
   login, and the three Tool shell routes.
2. **Static Assets responses** — measured against the local `pnpm
   preview` Worker (a `curl -D -` dump captured into
   `.tmp/security-headers/static-headers.json`), or, when that capture
   is not supplied, resolved from the shipped `public/_headers` rules by
   `scripts/check-security-headers.mjs` — the same parser the CI gate
   uses. The report labels which of the two it used.
3. **Browser enforcement** — Chromium with a fake capture device asking
   `getUserMedia()` for the microphone on: a host-baseline document, the
   Tool document that carries the `mic-level` grant, and the same grant
   document inside a Tool iframe under both sandbox shapes. This is what
   separates "the header says so" from "the browser agrees".

Nothing secret is involved: the probe server binds `127.0.0.1`, the
policy values are public constants in
`src/http/security-headers.json`, and the capture device is Chromium's
fake one.

### Regenerating

```bash
node scripts/security-header-report.mjs            # Worker + rules + browser
node scripts/security-header-report.mjs \
  --static-measurements=.tmp/security-headers/static-headers.json
```

The second form additionally reports the Static Assets rows as measured
from a running preview (see `docs/security/security-headers.md` §4 for
how to start one and capture the dump). The script re-runs the workerd
measurement, re-resolves the `_headers` rules, re-runs the browser
probes and overwrites the WebP. Commit the regenerated image in the same
change as any policy or manifest-grant edit.

The browser section separates the two gates Chromium actually applies:
the container document's own `Permissions-Policy` is the ceiling for its
frame, and a frame sandboxed without `allow-same-origin` has an opaque
origin that no header can give a capture device back. Both readings, and
the residual they leave, are in
[`docs/security/security-headers.md`](../../security/security-headers.md).