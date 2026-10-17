# Security header verification (Issue #449)

`headers-browser.webp` is the screenshot the Issue asks for: the
`nosniff` / `Referrer-Policy` / `Permissions-Policy` policy as it is
actually observed, not as it is described. It is stored as a
moderately compressed WebP (width ≤ 1600, quality 80) rather than a
PNG so the verification artefact stays small; the content is
unchanged.

## What is in the image

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

## Regenerating

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