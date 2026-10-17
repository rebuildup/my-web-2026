# Verification artefacts — security

Screenshots and evidence captured for security tickets. Each artefact
is regenerable from a repository-controlled command, so a reviewer can
reproduce it instead of trusting the image.

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
