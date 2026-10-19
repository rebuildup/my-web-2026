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
— the same freshness window `/sitemap.xml` uses. It is chosen so that a
freshly deployed approval reaches scanners within five minutes instead of
sitting behind a shared cache that already stored the `404`. It does NOT
mean approval is a data-only change: `policy.json` is imported at build
time, so an approval still travels the normal release path (see
**Approving it**).

`/.well-known/security.txt` is the ONLY path served. The legacy
top-level `/security.txt` that RFC 9116 §3 allows for compatibility is
deliberately not published, so there is exactly one canonical URL and one
`Canonical:` value.

## Why it is `404` today

The document is assembled from `policy.json`, and that file says
`approval.status: "pending"`. The reason is a missing human answer, not
an unfinished mechanism:

- `src/contact/channels.json` publishes the owner's GitHub identities
  and public domains and deliberately contains **no address**;
- `docs/security.md` routes urgent reports through an operator channel
  that is written down nowhere public.

RFC 9116 §2.5.3 requires the document to carry a reporting channel the
operator actually stands behind. Inventing one would produce a document
that strangers and scanners record as authoritative and that nobody
monitors — strictly worse than the `404` the endpoint answers today. So
the publication gate is closed until an owner approves a channel
(Issue #468: 公開しないメールを推測で追加しない).

Everything else is complete and proven: the RFC 9116 §4 field grammar,
the field-order rules, the value validation, the expiry gate, the HTTP
contract, and the browser screenshot (rendered from a local fixture,
never from production).

## Approving it

```jsonc
// src/http/security-txt/policy.json
{
  "approval": { "status": "approved", "approved_at": "<RFC 3339>", "approved_by": "<who>" },
  // RFC 9116 §2.5.3: at least one Contact. A Policy / Acknowledgments
  // URL is NOT a reporting channel and is refused on its own.
  "contacts": ["mailto:<a mailbox the operator monitors>"],
  "expires": "<RFC 3339, in the future>",
  // …optional: encryption, acknowledgments, preferred_languages,
  //             policy, hiring, csaf
}
```

There is **no** "edit the file and it appears" step. The sequence is:

1. **Edit `policy.json`.** No code change is needed — the renderer, the
   gate and the router are already shipped.
2. **Run `pnpm exec vitest run src/http/security-txt`.** The
   shipped-state assertions DERIVE their expectation from
   `approval.status` (via `loadSecurityTxtPolicy()`), so the suite is
   green in both the `pending` and the `approved` state and does not
   have to be edited during the flip.
3. **Land it as a normal PR and let the release deploy publish it.**
   `policy.ts` does `import manifestJson from './policy.json'`, so the
   manifest is bundled into the Worker at build time: a merged but
   undeployed change publishes nothing, and the gate only re-reads
   `Expires` per request — never the manifest itself.

Rules the schema enforces (`schema.ts`):

| Rule | RFC 9116 | Why it fails closed |
| --- | --- | --- |
| `approval.status` must be `approved`, with `approved_at` + `approved_by` | §2 | an approval nobody can attribute is indistinguishable from a hurried edit |
| an approved manifest must name at least one `Contact` | §2.5.3 | `Contact` MUST always be present; a disclosure-policy URL is not a reporting channel, and a document a researcher cannot use is a false one |
| `Contact` is `mailto:` or `https:` | §2.5.3 | `javascript:` / `file:` must never reach a client that may follow the reference |
| no line break or control character (incl. U+0085 / U+2028 / U+2029) in any value | §4 | the grammar has no escaping, so a `\n` would inject a second field |
| `Expires` is an RFC 3339 instant and is still in the future | §2.5.5 | once it passes, the advertised channel may be unattended; the endpoint answers `404` on the next request |
| `Preferred-Languages` entries are BCP 47 `langtag`s | §2.5.8 | a language tag a reader cannot parse is a preference it cannot honour |

Two decisions in that table are **owner-level and still open**, not
implementation details:

- **`tel:` Contacts.** RFC 9116 §2.5.3 permits a telephone URI as a
  `Contact`. This repository refuses it because a number published in a
  file that strangers and scanners archive is a personal datum with no
  rotation or revocation. Allowing it changes the published contract and
  needs the owner's approval.
- **`Signatures:`** (the OpenPGP clearsign wrapper, §2.3) is
  deliberately not implemented: it needs an operator key this
  repository does not own and must never invent.

## What may appear

`Policy` currently points at
`https://github.com/rebuildup/my-web-2026/blob/main/docs/security.md`
— the disclosure policy this repository already publishes. It is a
`Policy:` value, **not** a reporting `Contact:`: RFC 9116 §2.5.7 says
`Policy` is the human-readable document, and §2.5.3 requires the
reporting channel itself in `Contact`, which the owner has not filled
in.

## Guards

| Guard | Runtime | Fails when |
| --- | --- | --- |
| `src/http/security-txt/document.test.ts` | workerd (pure module) | the RFC 9116 §4 grammar regresses: the field order no longer matches the ABNF (`Contact` before `Expires` before `Preferred-Languages`), `Preferred-Languages` is emitted once per language instead of once, a field name is not in the allowed set, a comment line appears, or the deadline is treated as valid in the past / unreadable. |
| `src/http/security-txt/policy.test.ts` | workerd (schema + manifest) | `policy.json` stops parsing, an approved manifest names no `Contact`, an approval loses its attribution, or a value can inject a field. |
| `src/http/security-txt/router.test.ts` | workerd (DI seam, `externalBoundary`, `SELF`) | the status, media type, cache policy or refusal body changes; the deadline gate stops holding; or the surface stops being reachable through `src/server.ts`. |

The suite asserts the DEPLOYED status by deriving it from the shipped
manifest (`loadSecurityTxtPolicy()`), not by hard-coding a `404`: the
manifest is `pending` today, and approving a channel flips both the
expectation and the response together instead of breaking a test.

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
# renders the APPROVED fixture through the shipped renderer
# (src/http/security-txt/document.ts) over loopback HTTP and writes
# docs/verification/security/security-txt-browser.webp
```

What the capture does and does not exercise, stated exactly: the script
imports the shipped `renderSecurityTxt` — the same function the Worker
calls — and serves it at the shipped path, with the shipped media type
and cache header, from a loopback HTTP server bound to `127.0.0.1`. It does NOT
drive `createSecurityTxtRouter`, so the HTTP status, the publication
gate and the derived `Canonical:` are NOT in the picture; those are
proven by `router.test.ts` (real router, `externalBoundary`, `SELF`)
and `policy.test.ts` (the gate). TLS is a Cloudflare deployment
property, not something a loopback capture can show — RFC 9116 §5.7
explicitly anticipates a file served without HTTPS "such as localhost"
and asks for extra human validation there instead.

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