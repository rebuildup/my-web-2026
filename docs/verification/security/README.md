# Security header verification (Issue #449)

`headers-browser.png` is the screenshot the Issue asks for: the
`nosniff` / `Referrer-Policy` / `Permissions-Policy` policy as it is
actually observed, not as it is described.

## What is in the image

1. **Worker responses** — measured by
   `test/integration/security-headers.test.ts` running the real Worker in
   the local workerd pool (`SELF.fetch`), over the host page, a 404, the
   external boundary (success + `notFound`), the admin redirect, the admin
   login, and the three Tool shell routes.
2. **Static Assets responses** — the `public/_headers` rules resolved
   locally by `scripts/check-security-headers.mjs`, which is the same
   parser the CI gate uses.
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
node scripts/security-header-report.mjs
```

The script re-runs the workerd measurement, re-resolves the `_headers`
rules, re-runs the browser probes and overwrites the PNG. Commit the
regenerated image in the same change as any policy or manifest-grant
edit.

Read the interpretation of each column, and the known sandbox caveat the
measurement exposed, in
[`docs/security/security-headers.md`](../../security/security-headers.md).