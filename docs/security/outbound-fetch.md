# Outbound fetch — SSRF / redirect boundary contract (Issue #453)

The shipped contract for every URL a Worker fetches from outside this
repository. Read this before changing `src/http/outbound.ts`,
`src/http/outbound-fetch.ts`, or adding a code path that calls `fetch()`
with a URL that came from a visitor, a stored record, or an upstream
service.

## The rule

**A third-party URL is fetched through `fetchExternalUrl()`, and nothing
else.**

```ts
import { fetchExternalUrl } from '@/http/outbound-fetch';

const result = await fetchExternalUrl(inputUrl, { maxBytes: 512 * 1024 });
if (!result.ok) {
  // `code` is stable; `reason` is safe to log and never carries the URL.
  console.warn('[outbound] refused', { code: result.code, reason: result.reason });
  return null;
}
return decoder.decode(result.bytes);
```

`fetchExternalUrl` never throws. Every outcome — refusal, timeout,
transport error, oversized body, non-2xx — comes back as
`{ ok: false, code, reason, url, redirectChain }` so a handler cannot
turn a refused URL into a 500 that leaks an upstream's error text.

That includes the failure modes a slow upstream produces rather than
returns. Aborting a request *errors* its response body stream per the
fetch spec, so a body that is still streaming when the deadline fires
rejects the pending `read()`; that rejection is mapped to `timeout` (or
to `aborted` when the caller's signal was the cause) instead of
escaping.

`url` on a failure is the URL *under examination*, and it is `null`
whenever that URL failed classification. By then a credential-bearing URL
has already been refused, so there is nothing to redact.

## What `classifyOutboundUrl` decides

One URL in, one verdict out, no I/O.

| Dimension | Rule | Reason code |
| --- | --- | --- |
| shape | parses as an absolute URL, ≤ `MAX_OUTBOUND_URL_LENGTH` (2048) chars, no control characters or whitespace | `invalid_url`, `url_too_long` |
| protocol | `http:` / `https:` only | `protocol_not_allowed` |
| authority | no `user:password@` userinfo | `credentials_in_url` |
| name | multi-label ASCII hostname; reserved / internal zones refused | `host_not_allowed` |
| address | loopback, private, link-local, CGNAT, multicast, reserved, and the IPv4-mapped / NAT64 / 6to4 embeddings of those | `private_address` |
| address | any other IP **literal** | `ip_literal_not_allowed` |
| port | 80 / 443 only | `port_not_allowed` |

### Why control characters are refused outright

The WHATWG URL parser silently strips tab, CR and LF. A value that reads
as `https://evil.example\n@site` is therefore a *different URL* to the
parser than to whoever is reading the log line. Refusing the whole
string is the only way the two can be made to agree, so the adapter
never has to reason about what a downstream consumer would decode.

### Why IP literals are refused, public ones included

A literal cannot be validated against DNS, and the Workers runtime
resolves the name itself. Refusing literals removes "was the resolved
address the one that was checked?" from the failure modes entirely. A
caller that genuinely needs a literal opts in with
`policy.allowIpLiterals`, which is deliberately awkward and visible in
review; it does **not** widen what the runtime will actually connect to
(see below).

### Why `policy.allowedHosts` cannot name an address

The caller allow-list is consulted **after** the address branch, so it
is a list of *names* and nothing else. `allowedHosts: ['127.0.0.1']`
still yields `private_address`, and `allowedHosts: ['169.254.169.254']`
still cannot reach the instance-metadata endpoint.

Had it been matched first, one string in one policy object would have
undone the rule this module exists to enforce — through the least
auditable knob in the policy, on a path no shipped caller exercises
today. `policy.allowIpLiterals` is the separate opt-in for addresses,
and it does not reach the reserved space either.

### Why the name rules refuse whole zones

`OUTBOUND_DENIED_HOSTNAMES` covers `localhost`, `.invalid`, `.test`,
`.example`, `.local`, `.internal`, `.home.arpa`, `.lan`, `.intranet`,
`.corp`, `.private`. None of them can name a host on the public
internet, and each of them does name a host that resolves only inside
someone's network. Refusing them by name closes that class without a
DNS lookup — and without the TTL race a lookup would introduce.

Matching is on **label boundaries**: `metadata.google.internal` is
refused, `evil-internal.example.org` is not.

### Why a non-ASCII host is refused rather than transliterated

`https://日本語.example/` is punycoded by the URL parser before this
module sees it, so a caller that really wants an IDN host passes the
`xn--` form through `policy.allowedHosts`. Transliterating attacker input
inside the boundary would make the decision depend on a normalisation
library's revision history, which is the wrong dependency for a
security control.

## What `fetchExternalUrl` owns on top of the URL decision

| Property | Default | How |
| --- | --- | --- |
| redirect hops | 2 | `fetch(..., { redirect: 'manual' })`; every `Location` is resolved against the current URL and re-classified before the next connection |
| deadline | 5,000 ms | one `AbortController` covering every hop **and** the body read, *and* a race against the adapter's own timer |
| body size | 1 MiB | byte counter over the response stream; `content-length` is a cheap pre-filter, not the bound |
| credentials | none | `Authorization` / `Cookie` / `Proxy-Authorization` are **refused**, not stripped |
| inbound headers | not forwarded | `options.headers` is the complete set, never merged with the inbound `Headers` |

### Why the deadline is a race and not only a signal

Aborting is cooperative: the runtime `fetch` honours `init.signal`, but
the adapter also races each transport and body-read await against its
own timer, so a transport that ignores the signal entirely still comes
back as `timeout` inside the budget. Without the race the deadline would
be advisory — the Worker budget in operator contract #4 would hold only
because the current runtime happens to cooperate.

### Refusing credential headers rather than stripping them

Stripping would turn "the URL is allowed" into "the URL is allowed
*with this request's credentials*" while looking successful in review.
Refusing makes the caller write down what it was trying to do. No
shipped caller needs it: this boundary exists precisely for URLs that
are **not** the project's own origin.

### The hop chain

`redirectChain` lists only hops that were actually requested. The budget
is checked *before* a hop is recorded, so a refused hop is never
presented as followed, and `maxRedirects: 0` means "issue exactly one
request and report the 3xx".

A 3xx **without** a `Location` header is a result, not a hop — some
upstreams answer that way — and it surfaces as `http_error`.

## Failure codes

| Code | Meaning | URL echoed? |
| --- | --- | --- |
| `invalid_url`, `url_too_long`, `protocol_not_allowed`, `credentials_in_url`, `host_not_allowed`, `private_address`, `ip_literal_not_allowed`, `port_not_allowed` | refused before any connection | no (`url: null`) |
| `credential_header_refused` | the caller asked to send a credential header | no (`url: null`) |
| `too_many_redirects` | hop budget exhausted | yes |
| `timeout` | the whole-operation deadline elapsed while the transport was pending **or the body was still streaming** | yes |
| `aborted` | the caller's `signal` fired | yes (or `null` if it fired before the first request) |
| `response_too_large` | body exceeded `maxBytes` | yes |
| `http_error` | upstream answered non-2xx, or 3xx with no `Location` | yes |
| `fetch_failed` | the transport threw | yes (in `url`; see below) |

`reason` on a `fetch_failed` is the transport's own message, and a
transport may quote the URL back — so the submitted URL is redacted out
of it and the text is bounded to 200 characters. `result.url` still
carries the URL under examination, which is the point of the field; it
is the free-text `reason` that must never become a log line carrying
it.

## Where it is mounted

| Surface | Mount |
| --- | --- |
| — | **none yet** |

This is deliberate. There is no shipped feature that fetches a
third-party URL: `docs/domain/integrations.md` records GitHub / Notion /
Discord / Stripe as *not integrated* or *uncommitted*, and
`docs/security.md` names no SSRF surface because none existed. The
adapter ships ahead of its first consumer, which the Issue explicitly
permits.

**The first consumer must call `fetchExternalUrl()`.** A handler that
calls `fetch()` directly with a caller-supplied URL is a defect even if
the URL happens to pass review today, because the policy then has exactly
one enforcement point and that point is not it.

## Operator contract

1. **`global_fetch_strictly_public` must stay enabled** in
   `wrangler.jsonc`, `wrangler.production.jsonc`, `cloudflare.config.ts`
   and `vitest.config.ts`. The policy classifier runs *before* DNS, so it
   cannot see what a hostname resolved to. The flag is what makes the
   runtime refuse a connection to a non-public address. Removing it
   silently downgrades this boundary from two layers to one.
2. **Do not widen the policy from a request handler.** `policy` exists for
   a documented fixed host or port (`allowedHosts`, `allowedPorts`,
   `deniedHostSuffixes`). If a handler needs it, the decision belongs in
   review, not in a per-request branch. `allowedHosts` names hosts; it
   cannot name addresses (see above).
3. **Do not merge inbound headers into `options.headers`.** See "Inbound
   headers are not forwarded" above.
4. **The timeout is a Worker budget, not a preference.** Cloudflare
   charges for the wall clock; 5 s × 2 hops is the ceiling the adapter
   can spend before the next request. A caller that needs longer should
   move the work off the request path, not raise the default. The budget
   is enforced by the adapter's own timer, not only by the transport
   cooperating with `AbortSignal`.

## Verification

- Policy matrix (pure): `src/http/outbound.test.ts`
- Adapter behaviour (hop loop, deadline, size cap, credential refusal):
  `src/http/outbound-fetch.test.ts` — both run in the local workerd pool,
  with an injected transport, so no socket is opened
- Rendered matrix + screenshot:
  [`../verification/security/README.md`](../verification/security/README.md),
  regenerate with `pnpm run security:ssrf:report`

The suite proves the *decision* and the *loop*. It does not prove that
a real public origin answers, nor that a real internal address is
unreachable from a real deployment — the second claim is the runtime
flag's, asserted by Cloudflare, not by this repository.

## Known limits

1. **DNS rebinding is not covered by the classifier.** A public name
   that resolves to `127.0.0.1` passes classification and is stopped by
   `global_fetch_strictly_public` instead. If that flag is ever dropped,
   this boundary is rebinding-vulnerable and must be redesigned (resolve
   → pin → connect) rather than re-tuned.
2. **No allow-list by default.** Any public hostname is fetchable. A
   Notion / GitHub / X integration will want `deniedHostSuffixes` or
   `allowedHosts` narrowed to the providers it actually talks to; doing
   that is part of landing that consumer, not part of this adapter.
3. **Response bodies are buffered whole** (up to `maxBytes`). There is
   no streaming proxy path; a caller that needs to relay a large file
   needs a different contract and a separate Issue.
4. **`GET` only.** The adapter issues no other method, so a
   caller-controlled `POST` to a third party is not expressible through
   it.
5. **The hop budget is 2.** Some real CDN redirect chains are longer;
   raising it is a per-caller decision and widens the surface, so it is
   not a global default.