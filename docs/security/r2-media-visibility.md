# R2 object visibility — public keys and private objects

> Which `MEDIA` bucket keys may be served from the public delivery
> surface, which may not, where that decision is made, and what the
> repository deliberately cannot enforce.

Authoritative implementation:
[`src/cloudflare/media-visibility.ts`](../../src/cloudflare/media-visibility.ts).
Introduced by Issue #459.

## The threat

Portfolio media is delivered through a **public R2 custom domain**
(`https://media.rebuildup.dev/<key>` — see
[`docs/portfolio/decisions.md`](../portfolio/decisions.md) Decision 5).
A custom domain bypasses the Worker: the Cloudflare edge fetches the
object and returns it. There is no session check, no API key, no
signed URL, and no line of our code in that path.

So the only thing standing between an unpublished asset and a stranger
is **the key namespace**: if an object exists in the bucket, anyone who
can guess its key can fetch it. Two attacks follow, and both are cheap:

| Attack | What it needs | What it yields |
| --- | --- | --- |
| **Object listing** | a listing surface over the bucket, or a leaked manifest | every key that exists, private ones included |
| **Sequential guessing** | nothing — the published key layout is predictable (`portfolio/<slug>/cover-<n>.webp`) | the content of unpublished assets stored next to published ones |

The repository-side answer is therefore not "authenticate the fetch" —
that would mean abandoning the custom domain — but "never create the
situation": no URL for a non-public key, no read of a non-public key,
and no listing that emits one.

## The contract

Two gates compose. Both must pass before an object is served.

| Gate | Question | Owner of the answer | Rule |
| --- | --- | --- | --- |
| **Namespace** | may this *class* of key ever be public? | `PUBLIC_MEDIA_PREFIXES` in the module | allowlist: `portfolio/`, `reactions/`, `public/`. Declared private prefixes are refused first (`private/`, `draft/`, `staging/`, `internal/`, `backup/`, `tmp/`). Anything else is `unlisted_namespace` — an undeclared prefix fails closed, so a new producer cannot publish by accident. |
| **Approval** | is this *particular* object published right now? | the caller (a D1 row) | passed in as an approval check. Portfolio: the loader filters `status='published' AND visibility='public'` before it ever sees a media row. Reaction images: the row itself is the approval. |

The namespace gate is deliberately an **allowlist**. A denylist would
make "I forgot to name the prefix" publish by default, which is the
failure this Issue exists to remove.

`public namespace ≠ published`. A draft project's cover is a perfectly
well-formed `portfolio/…` key; what keeps it dark is the approval gate,
not the prefix.

## Where the decision is made

| Surface | Where | Behaviour on refusal |
| --- | --- | --- |
| Portfolio media URL composition | `composeMediaUrl` (`src/portfolio/media.ts`) | `null` → the UI renders its documented placeholder (`media-empty`); the media row and its metadata still load |
| Reaction image read over HTTP | `getImageStream` (`src/http/reactions/images.ts`) → `GET /api/v1/reaction-images/:id` | `null` → router answers **404** |
| Object listing | `listPublicMediaKeys` (`src/cloudflare/media-visibility.ts`) | the key is dropped; only a withheld **count** is reported |

Every refusal is a **404, never a 403**. A 403 confirms that the object
exists, which is precisely the oracle an enumeration sweep wants. The
refusal also short-circuits before the bucket read, so a private key
cannot be used as a read-timing oracle either.

`listPublicMediaKeys` reports `withheld` as a number and never as key
names: an audit trail that printed the keys it hid would become a
second disclosure channel.

The key grammar (`isValidMediaKey`) also lives in this module.
`src/portfolio/media.ts#isValidR2Key` remains as a portfolio-facing
export but delegates, so there is exactly one definition — a private
key is a *valid* key and still not servable, and the two questions are
never confused.

## Test inputs

`test/integration/r2-media-visibility.test.ts` seeds the local workerd
R2 binding with synthetic 1×1 PNG bytes. Nothing leaves the machine;
there is no production bucket, deploy, or remote mutation.

| Key | State in the bucket | Namespace | Expected |
| --- | --- | --- | --- |
| `portfolio/aulymo/cover.webp` | present, published | public | 200 |
| `portfolio/aulymo/cover-3.webp` | present, **not** published | public | 404 `refused_unapproved` |
| `portfolio/aulymo/cover-17.webp` | present, **not** published | public | 404 `refused_unapproved` |
| `private/draft/secret.webp` | present | private | 404 `private_namespace` |
| `staging/wip.webp` | present | private | 404 `private_namespace` |
| `wip/unlisted.webp` | present | undeclared | 404 `unlisted_namespace` |
| `reactions/<sha256>.png` | uploaded through `uploadImage` | public | 200 |

Two attack legs run against those objects:

- **Enumeration** — a raw `bucket.list()` does return the private keys
  (that is the control that makes the filter meaningful), while
  `listPublicMediaKeys` returns only the published key and counts the
  rest.
- **Sequential guessing** — `sequentialGuessKeys('aulymo', 40)` probes
  `cover-1` … `cover-40`, walking straight over the two unpublished
  objects. Every probe answers 404, and the one published cover in the
  same namespace still answers 200 (the control, so a broken delivery
  path cannot pass for a boundary).

The HTTP leg adds `GET /api/v1/reaction-images/:id` for a row whose
`r2_key` points into `private/`: the object is in the bucket, the row
is in D1, and the route still answers 404.

## Failure behaviour

| Condition | Result |
| --- | --- |
| Malformed key (`..`, leading `/`, whitespace, query characters, >512 chars) | 404 `invalid_key`; never reaches the bucket |
| Declared private prefix | 404 `private_namespace`; never reaches the bucket |
| Undeclared prefix | 404 `unlisted_namespace`; never reaches the bucket |
| Public prefix, not published | 404 `refused_unapproved`; never reaches the bucket |
| Public prefix, published, object absent | 404 `not_found` |
| Public prefix, published, object present | 200 + stored `Content-Type` / `Cache-Control` |

Refusals are indistinguishable from a missing object to the caller,
which is the point: the boundary must not be observable to a sweeper.

## What the code cannot do

This is the half that lives outside the repository, and it is not
optional — the code above makes the repository *stop depending* on it,
it does not replace it:

1. **Do not put unpublished objects in the public bucket.** The custom
   domain serves every key it holds. Until a separate bucket (or a
   Worker-side signed delivery path) exists, draft media belongs in a
   non-public bucket, or must not be uploaded at all.
2. **Do not attach the custom domain to a bucket that holds anything
   private.** Attaching it is a Cloudflare account setting; the
   repository can only record the expectation (Decision 5's release
   prerequisite already tracks the attachment itself).

If either is violated, the repository's guarantees are unaffected but
they no longer protect the objects: a `private/draft/secret.webp` in a
custom-domain-served bucket is still readable by anyone who guesses the
key. Closing that gap is an owner decision — split the bucket, or
replace custom-domain delivery with Worker-side signed URLs — and it is
tracked as an open residual, not as a code task.

## How to re-verify

```bash
# policy + local R2 fixture + HTTP leg (workerd pool, no network)
pnpm exec vitest run test/integration/r2-media-visibility.test.ts
pnpm exec vitest run src/cloudflare/media-visibility.test.ts

# regenerate the review artefact from that run
pnpm run r2:visibility:report
```

The committed screenshot
[`docs/verification/security/r2-public-private.webp`](../verification/security/r2-public-private.webp)
is rendered from the JSON reporter output of the integration run, so a
number in the image cannot drift from the assertions that produced it.
It uses the Issue-required `.png` path with the `.webp` extension
(a committed PNG screenshot is several times larger for no evidentiary
gain).

## Cross-references

- `src/cloudflare/media-visibility.ts` — the rule, the adapter, the
  listing walk.
- `src/portfolio/media.ts` — URL composition gate.
- `src/http/reactions/images.ts` — reaction-image read gate.
- `docs/portfolio/decisions.md` Decision 5 — why delivery is a public
  custom domain at all.
- [`docs/security.md`](../security.md) — policy index.