# `/.well-known/security.txt` (RFC 9116)

Issue #468. The vulnerability-reporting **document**: what a researcher
or scanner is told, and — as importantly — the fact that the platform
has nothing to tell them yet.

## Endpoint

### `GET /.well-known/security.txt`

| Outcome | Status | `Content-Type` | Body |
| --- | --- | --- | --- |
| An approved, unexpired policy exists | `200` | `text/plain; charset=utf-8` | the RFC 9116 document |
| Nothing is approved, or the policy expired | `404` | `text/plain; charset=utf-8` | `no security.txt is published` |

Both outcomes carry `Cache-Control: public, max-age=300, must-revalidate`
— the same freshness window `/sitemap.xml` uses. It is chosen so that
approving a policy reaches scanners within five minutes, without a
deploy: approval is a data change in `policy.json`, not a code change.

`/.well-known/security.txt` is the ONLY path served. The legacy
`/security.txt` fallback (RFC 9116 §3.2) is deliberately not published,
so there is exactly one canonical URL and one `Canonical:` value.

## Why it is `404` today

The document is assembled from `policy.json`, and that file says
`approval.status: "pending"`. The reason is a missing human answer, not
an unfinished mechanism:

- `src/contact/channels.json` publishes the owner's GitHub identities
  and public domains and deliberately contains **no address**;
- `docs/security.md` routes urgent reports through an operator channel
  that is written down nowhere public.

RFC 9116 §2 requires the document to carry a reporting channel the
operator actually stands behind. Inventing one would produce a document
that strangers and scanners record as authoritative and that nobody
monitors — strictly worse than the `404` the endpoint answers today. So
the publication gate is closed until an owner approves a channel
(Issue #468: 公開しないメールを推測で追加しない).

Everything else is complete and proven: the RFC 9116 §6 field grammar,
the field-order rules, the value validation, the expiry gate, the HTTP
contract, and the browser screenshot (rendered from a local fixture,
never from production).

## Approving it

```jsonc
// src/http/security-txt/policy.json
{
  "approval": { "status": "approved", "approved_at": "<RFC 3339>", "approved_by": "<who>" },
  "contacts": ["mailto:<a mailbox the operator monitors>"],
  "expires": "<RFC 3339, in the future>",
  // …optional: encryption, acknowledgments, preferred_languages,
  //             policy, hiring, csaf
}
```

Then `pnpm exec vitest run src/http/security-txt` — the gate flips from
`404` to `200` with no code change and no deploy.

Rules the schema enforces (`schema.ts`):

| Rule | RFC | Why it fails closed |
| --- | --- | --- |
| `approval.status` must be `approved`, with `approved_at` + `approved_by` | §2 | an approval nobody can attribute is indistinguishable from a hurried edit |
| at least one of `Contact` / `Encryption` / `Acknowledgments` / `Policy` | §2 | a document with no way to report anything is not a degraded document, it is a false one |
| `Contact` is `mailto:` or `https:` | §2.1 | `javascript:` / `file:` must never reach a client that may follow the reference |
| no line break or control character in any value | §7 | the grammar has no escaping, so a `\n` would inject a second field |
| `Expires` is an RFC 3339 instant and is still in the future | §2.5.1 | once it passes, the advertised channel may be unattended; the endpoint answers `404` on the next request |
| `Preferred-Languages` entries are BCP 47 tags | §2.4 | a language tag a reader cannot parse is a preference it cannot honour |

## What may appear

`Policy` currently points at
`https://github.com/rebuildup/my-web-2026/blob/main/docs/security.md`
— the disclosure policy this repository already publishes. It is a
`Policy:` value, **not** a reporting `Contact:`: RFC 9116 §2.2 says
`Policy` is the human-readable document, and the reporting channel is a
separate field the owner has not filled in.

## Guards

| Guard | Runtime | Fails when |
| --- | --- | --- |
| `src/http/security-txt/document.test.ts` | workerd (pure module) | the RFC 9116 §6 grammar regresses: `Contact` is not on the start line, `Expires` is not the last line, a field name is not in the allowed set, a comment line appears, or the deadline is treated as valid in the past / unreadable. |
| `src/http/security-txt/policy.test.ts` | workerd (schema + manifest) | `policy.json` stops parsing, an approved manifest names no channel, an approval loses its attribution, or a value can inject a field. |
| `src/http/security-txt/router.test.ts` | workerd (DI seam, `externalBoundary`, `SELF`) | the status, media type, cache policy or refusal body changes; the deadline gate stops holding; or the surface stops being reachable through `src/server.ts`. |

The suite asserts `404` for the deployed surface. That is the current,
intended state — it is a claim about the approval gate, and it flips to
a `200` assertion only when an owner approves a channel.

## Why Hono serves this

TanStack Start 1.168 has no raw-response route primitive, so a route
file cannot answer with a `text/plain` body. `/.well-known` is
registered in `EXTERNAL_BOUNDARY_PREFIXES` (`src/server.ts`) and
mounted on `externalBoundary` (`src/http/hono.ts`), exactly as
`src/http/seo/README.md` describes for `/sitemap.xml` and `/robots.txt`.
The whole `.well-known` namespace is boundary-owned: a `.well-known`
document is by definition a machine-readable file rather than a rendered
page, and the SSR shell must never answer one with a `200` HTML page.

## Regenerating the verification screenshot

```bash
pnpm run verify:security-txt-screenshot
# serves the REAL router over an APPROVED local fixture and writes
# docs/verification/security/security-txt-browser.webp
```

It runs offline (no `pnpm run dev`, so no Infisical dependency), reads
no secret, touches no Cloudflare resource and issues no request to
production. The fixture is built from RFC 2606 reserved names
(`example.invalid`), so the screenshot can never be mistaken for a
published address. Intermediate artefacts stay in
`.tmp/security-txt-verification/`; only the WebP is committed.

The screenshot deliberately shows the **approved** rendering rather
than today's `404`: the acceptance condition asks for a browser-readable
document with the right MIME type and expiry, and a `404` screenshot
would prove nothing about the rendering path. The deployed `404` is
proven by the test suite instead, where the assertion belongs.