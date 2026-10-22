# `/.well-known/security.txt`

Issue #468. The RFC 9116 vulnerability-reporting document this platform
would publish, and the gate that currently keeps it unpublished.

## Status: not published

`GET https://rebuildup.dev/.well-known/security.txt` answers
**`404 text/plain; charset=utf-8`**. RFC 9116 §3 requires a site that
publishes the file to place it under `/.well-known/`; a site that does
not publish one has no such resource, which is the answer this endpoint
gives and the state intended until an owner approves a reporting
channel.

The mechanism is complete: the RFC 9116 §4 grammar, the field-order
rules, value validation, the expiry gate, the HTTP contract and the
browser screenshot all exist and are tested
([`src/http/security-txt/README.md`](../../src/http/security-txt/README.md)
owns the module contract). What is missing is an owner's answer to a
question this repository cannot answer for itself: **which mailbox or
form is actually monitored?**

Two facts make the answer unavailable here:

- `src/contact/channels.json` publishes the owner's GitHub identities
  and public domains, and contains **no address at all**. That is a
  deliberate property of the file, not an omission.
- [`docs/security.md`](../security.md) routes urgent reports through a
  channel recorded in `CODEOWNERS` / repository Settings → Code
  security — which is written down nowhere public.

Publishing a `Contact:` line without that answer would produce a
document that strangers, scanners and bug-bounty databases record as
authoritative and that nobody is obliged to watch. A `404` is honest;
a dead mailbox is worse. Issue #468 states the same rule: 公開しない
メールを推測で追加しない.

## What a report may use today

Until the gate opens, the repository's existing instructions stand:
open a GitHub Issue on this repository for anything non-sensitive, and
use the operator channel in [`docs/security.md`](../security.md) for
anything urgent (live exploitation, credential disclosure). A leaked
credential is assumed compromised: revoke and rotate immediately.

Once a report is accepted, the intake, triage, fix and publication
procedure is [`docs/runbook/security-disclosure.md`](../runbook/security-disclosure.md)
(Issue #478). Its simulation gate
(`pnpm run security:disclosure:check`) reads only the working tree and
the committed fixtures, and it is the reason this flow can be rehearsed
without publishing a mailbox or touching a secret.

## What approving it changes

One data file, plus the normal release path. There is no
"edit the file and it appears" step:

```jsonc
// src/http/security-txt/policy.json
{
  "approval": {
    "status": "approved",
    "approved_at": "<RFC 3339 instant>",
    "approved_by": "<who approved it>"
  },
  // RFC 9116 §2.5.3: at least one Contact. An approved manifest that
  // carries only a Policy / Acknowledgments URL is REFUSED.
  "contacts": ["mailto:<a mailbox the operator monitors>"],
  "expires": "<RFC 3339 instant, in the future>"
}
```

1. Edit `policy.json` (no code change; the renderer, gate and router
   are already shipped).
2. Run `pnpm exec vitest run src/http/security-txt`. The shipped-state
   assertions derive their expectation from `approval.status`, so the
   suite is green before and after the flip and no test has to be
   edited during it.
3. Land it as a normal PR against the release branch and let the
   Cloudflare Workers Builds deploy publish it. `policy.json` is
   imported at build time, so the manifest's bytes exist only in a
   build: **a deploy is required**, and "merge without deploy"
   publishes nothing.

The endpoint then answers `200` with the rendered document, and keeps
answering it until `Expires` passes — after which it returns to `404`
without any further action, because `isSecurityTxtLive` is evaluated
per request rather than cached at module load. Set a new `expires`
before that date.

Schema rules that must hold before anything is served (see
`src/http/security-txt/schema.ts`):

| Rule | RFC 9116 |
| --- | --- |
| `approval.status: "approved"` with `approved_at` and `approved_by` | §2 (attributable approval) |
| an approved manifest must name at least one `Contact` | §2.5.3 |
| `Contact` restricted to `mailto:` / `https:` | §2.5.3 |
| no control character or line break in any value (an injected `\n` would author a second field) | §4 |
| `Expires` is an RFC 3339 instant and still in the future | §2.5.5 |
| `Policy` must be an `https:` URL | §2.5.7 |
| `Preferred-Languages` entries must be BCP 47 `langtag`s | §2.5.8 |

## What is served once approved

```text
Contact: mailto:<approved mailbox>          (one or more; §2.5.3)
Encryption: https://…/pgp-key.txt            (optional)
Acknowledgments: https://…/security/acknowledgments   (optional)
Canonical: https://rebuildup.dev/.well-known/security.txt
Expires: <RFC 3339 instant>
Preferred-Languages: ja, en                  (optional; one line, comma-separated)
```

The ORDER is the RFC 9116 §4 ABNF's, not an aesthetic choice:
`unsigned = *line (contact-field eol) *line (expires-field eol) *line
[lang-field eol] *line`, so `Contact` comes before `Expires`, and the
optional single `Preferred-Languages` field comes after the deadline.
§2.5.8 also requires that field to appear **once** with comma-separated
values, so `ja` and `en` render as one line, never two. `Canonical` is
derived, never authored: the path is fixed by RFC 9116 §3 and the origin
by ADR-0014.

The `Policy:` value currently points at this repository's
[`docs/security.md`](../security.md) on GitHub — the disclosure policy
this project already publishes. It is a `Policy:` reference, **not** a
reporting `Contact:`: RFC 9116 §2.5.7 defines `Policy` as the
human-readable disclosure document, while §2.5.3 requires the reporting
channel itself in `Contact`, a separate field the owner has not filled
in. An approved manifest without one is refused.

## Verification

```bash
pnpm exec vitest run src/http/security-txt   # contract + gate + expiry
pnpm run verify:security-txt-screenshot      # browser capture (local fixture)
```

The capture renders the **approved** rendering from a local fixture
built on RFC 2606 reserved names, through the shipped
`renderSecurityTxt`, so the document is visible in a browser with the
right MIME type and a live `Expires`. It serves the renderer over
loopback HTTP, so it does NOT show the HTTP status, the publication
gate, the derived `Canonical:` or TLS (RFC 9116 §5.7 explicitly
contemplates a file served without HTTPS "such as localhost" and asks
for extra human validation there); those claims live in
`router.test.ts` and `policy.test.ts`, where they belong. The deployed
`404` is asserted there too, derived from the shipped manifest. See
[`docs/verification/security/security-txt-browser.webp`](../verification/security/security-txt-browser.webp).

## Open decisions (owner level)

Two questions in this document are deliberately NOT decided here:

1. **Which reporting channel to publish** — an operator-monitored
   mailbox or a private advisory form. Until it is answered the
   endpoint stays `404` (Issue #468: 公開しないメールを推測で追加しない).
2. **Whether `tel:` may appear in `Contact`.** RFC 9116 §2.5.3 permits
   a telephone URI; `schema.ts` refuses it as a personal datum in an
   archived, world-readable file. Widening the published contract is the
   owner's call, not an implementation detail.

`Signatures:` (§2.3) and a row in the SEO status contract are likewise
deferred: both change what the platform promises publicly.

No step in this pipeline reads a secret, mutates a Cloudflare binding or
requests a remote origin.