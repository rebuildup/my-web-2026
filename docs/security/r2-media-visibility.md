# R2 object visibility — public keys and private objects

> Which `MEDIA` bucket keys may be served from the public delivery
> surface, which may not, where that decision is enforced in code, and
> what this repository deliberately does **not** enforce.

Authoritative implementation:
[`src/cloudflare/media-visibility.ts`](../../src/cloudflare/media-visibility.ts).
Introduced by Issue #459; the read-only bucket key-set audit was added
by Issue #577 (see [What the key-set audit does](#what-the-key-set-audit-does-issue-577-owner-option-a)).

## Read this first — what is enforced where

Issue #459 asks that unpublished material stay invisible to
enumeration and sequential guessing. This repository can satisfy that
**for the code it owns**. It cannot satisfy it **for the R2 custom
domain**, and the difference matters more than anything else on this
page:

| | Enforced in code today? | Where |
| --- | --- | --- |
| Portfolio media URL composition | **yes** | `composeMediaUrl` → `null` |
| Reaction-image read over HTTP | **yes** | `getImageStream` → router 404 |
| Delivery adapter / listing walk | modelled, **no production caller** | `createPublicMediaDelivery`, `listPublicMediaKeys` |
| Anonymous GET of `https://media.rebuildup.dev/<key>` | **no — no repository code runs on that path** | Cloudflare edge |
| Bucket key set (read-only audit) | **yes — release gate, operator-run** | `pnpm run r2:media:audit` (`scripts/check-r2-media-key-set.mjs`) |

Attaching a public custom domain to the `MEDIA` bucket is Decision 5
([`docs/portfolio/decisions.md`](../portfolio/decisions.md)); the
attachment itself is a Cloudflare account setting and a release
prerequisite this repository cannot verify. Conditional on that
attachment, the edge serves every key that exists in the bucket, with
no session, no API key, no signed URL, and no line of our code
involved. What the repository *can* observe is the bucket's key set,
and Issue #577 turns that observation into a release gate — which stops
an out-of-namespace object from existing at all, but cannot stop an
in-namespace object from being served while it is unpublished. The
concrete failure case is written out under
[What the code does not do](#what-the-code-does-not-do).

## The threat

If a public custom domain serves the bucket, then a key that exists is
a key anyone can fetch. Two attacks follow, and both are cheap:

| Attack | What it needs | What it yields |
| --- | --- | --- |
| **Object listing** | a listing surface over the bucket, or a leaked manifest | every key that exists, private ones included |
| **Sequential guessing** | nothing — the published key layout is predictable (`portfolio/<slug>/cover-<n>.webp`) | the content of unpublished assets stored next to published ones |

The repository-side answer is therefore not "authenticate the fetch" —
that would mean abandoning the custom domain — but "never create the
situation from this side": no URL for a non-public key, no read of a
non-public key, and no listing that emits one.

## The contract

Two gates compose. Both must pass before an object is served.

| Gate | Question | Owner of the answer | Rule |
| --- | --- | --- | --- |
| **Namespace** | may this *class* of key ever be public? | `PUBLIC_MEDIA_PREFIXES` in the module | allowlist: `portfolio/`, `reactions/`. Declared private prefixes are refused first (`private/`, `draft/`, `staging/`, `internal/`, `backup/`, `tmp/`). Anything else is `unlisted_namespace` — an undeclared prefix fails closed, so a new producer cannot publish by accident. |
| **Approval** | is this *particular* object published right now? | the caller (a D1 row) | passed in as an approval check. Portfolio: the loader filters `status='published' AND visibility='public'` before it ever sees a media row. Reaction images: the row itself is the approval. |

The namespace gate is deliberately an **allowlist**. A denylist would
make "I forgot to name the prefix" publish by default, which is the
failure this Issue exists to remove.

The allowlist names only namespaces that have a real producer. A
prefix with no producer is **not** pre-declared: `public/` (the Vite
static-asset directory name) was removed in this revision, because a
key written under a namespace nobody re-reviewed would become
publicly servable without anyone revisiting the decision (AGENTS.md
§3). A new producer adds its prefix in the same review that introduces
it.

`public namespace ≠ published`. A draft project's cover is a perfectly
well-formed `portfolio/…` key; what keeps it dark is the approval gate
and the loader's `status='published' AND visibility='public'` filter,
not the prefix.

A prefix match additionally requires a **non-empty remainder**, so the
bare namespace marker itself (`portfolio/`, `reactions/`) classifies as
`unlisted_namespace`. R2 object keys are flat strings, so such a key is
a directory marker rather than an object any producer writes, and the
direction that can publish something is the one that gets the extra
guard.

## Where the decision is enforced

| Surface | Where | Enforced in production code? | Behaviour on refusal |
| --- | --- | --- | --- |
| Portfolio media URL composition | `composeMediaUrl` (`src/portfolio/media.ts`) | yes | `null` → the UI renders its documented placeholder (`media-empty`); the media row and its metadata still load |
| Reaction image read over HTTP | `getImageStream` (`src/http/reactions/images.ts`) → `GET /api/v1/reaction-images/:id` | yes | `null` → router answers **404** |
| Object delivery through Worker code | `createPublicMediaDelivery` (`src/cloudflare/media-visibility.ts`) | **no caller today** — modelled for a future Worker-side delivery path | 404, identical value for every refusal |
| Object listing | `listPublicMediaKeys` (`src/cloudflare/media-visibility.ts`) | **no caller today** — no listing surface over the bucket exists in production | the key is dropped; neither the key nor a withheld **count** is returned |

Every refusal is a **404, never a 403**, and the refusal value carries
**no reason code**: `{ status: 404, key }` is returned whether the key
was malformed, private, undeclared, unapproved, or simply absent. A
distinguishable refusal would be the existence oracle an enumeration
sweep wants, and a reason code in a returned object is one careless
`JSON.stringify` away from becoming one. Which gate fired is observable
through instrumentation instead — a refused key never reaches the
bucket at all, so bucket-read counts separate the cases without the
response ever doing so.

`listPublicMediaKeys` returns only the servable keys and a `truncated`
flag. It deliberately reports **no scan count and no withheld count**:
a listing caller receives a `prefix` argument, and when that prefix is
visitor-supplied, "objects seen" or "objects hidden" answers whether a
guessed key exists — an existence oracle delivered as a number. Audit
counters belong in an operator-side tool that runs against a prefix the
operator controls, never in the public listing response.

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
| `portfolio/aulymo/cover-3.webp` | present, **not** published | public | 404 |
| `portfolio/aulymo/cover-17.webp` | present, **not** published | public | 404 |
| `private/draft/secret.webp` | present | private | 404 |
| `staging/wip.webp` | present | private | 404 |
| `wip/unlisted.webp` | present | undeclared | 404 |
| `reactions/<sha256>.png` | uploaded through `uploadImage` | public | 200 |

Two attack legs run against those objects:

- **Enumeration** — a raw `bucket.list()` does return the private keys
  (that is the control that makes the filter meaningful), while
  `listPublicMediaKeys` returns only the published key — the private
  keys are neither named nor counted.
- **Sequential guessing** — `sequentialGuessKeys('aulymo', 40)` probes
  `cover-1` … `cover-40`, walking straight over the two unpublished
  objects. Every probe answers 404, and the one published cover in the
  same namespace still answers 200 (the control, so a broken delivery
  path cannot pass for a boundary).

The probe itself is **test data, not policy**: it lives in
[`test/helpers/r2-sequential-probe.ts`](../../test/helpers/r2-sequential-probe.ts)
(`test/helpers/better-auth.ts` is the precedent for a shared helper),
so the shipped module carries the rule and not the attacker's script.

The HTTP leg adds `GET /api/v1/reaction-images/:id` for a row whose
`r2_key` points into `private/`: the object is in the bucket, the row
is in D1, and the route still answers 404.

**What these tests prove:** that the gates hold, and that the
composition and HTTP paths refuse a non-public key even when the
object is present in the bucket. **What they do not prove:** that an
anonymous request to the custom domain is filtered. No test in this
repository can prove that, because no repository code sits on that
path.

## Failure behaviour

| Condition | Gate that refuses | Result |
| --- | --- | --- |
| Malformed key (`..`, leading `/`, whitespace, query characters, >512 chars) | key grammar | 404; never reaches the bucket |
| Declared private prefix | namespace | 404; never reaches the bucket |
| Undeclared prefix | namespace | 404; never reaches the bucket |
| Public prefix, not published | approval | 404; never reaches the bucket |
| Public prefix, published, object absent | bucket lookup | 404 |
| Public prefix, published, object present | — | 200 + stored `Content-Type` / `Cache-Control` |

Every 404 in that table is the same value. Refusals are
indistinguishable from a missing object to the caller, which is the
point: the boundary must not be observable to a sweeper.

## What the code does not do

This is the half that lives outside the repository, and it is not
optional — the code above makes the repository *stop depending* on
it, it does not replace it.

**The failure case, concretely.** Put `portfolio/aulymo/cover-3.webp`
— or any `draft/…` object — into the `MEDIA` bucket, then have an
anonymous client `GET https://media.rebuildup.dev/portfolio/aulymo/cover-3.webp`.
With the custom domain attached, the edge serves the object with 200.
No line of this repository runs between the request and the object, so
no gate in this document executes. The suite's own control leg proves
the shape is reachable: `bucket.list()` returns the unpublished
fixture objects from the very bucket the delivery adapter reads.

Consequently:

1. **Do not put unpublished objects in the public bucket.** The custom
   domain serves every key it holds. Until a separate bucket (or a
   Worker-side signed delivery path) exists, draft media belongs in a
   non-public bucket, or must not be uploaded at all.
2. **Do not attach the custom domain to a bucket that holds anything
   private.** Attaching it is a Cloudflare account setting; the
   repository can only record the expectation (Decision 5's release
   prerequisite already tracks the attachment itself).

## What the key-set audit does (Issue #577, owner option (a))

The repository can observe one more thing than its own code: **which
keys the bucket actually holds**. Issue #577 chose that as the
enforcement mechanism, and `pnpm run r2:media:audit` implements it.

```text
[r2-key-set] source=production target=production bucket=my-web-2026
[r2-key-set] verdict=OK
[r2-key-set] reason=-
[r2-key-set] keys_total=… keys_inside_allowlist=… keys_outside_allowlist=0
[r2-key-set] allowlist_prefixes=2 prefix_source=src/cloudflare/media-visibility.ts
[r2-key-set] pages_walked=1 enumeration=complete
[r2-key-set] diff=none
```

The audit classifies the bucket's key set with
`isPublicMediaKey` — the same predicate the two code gates above call,
read from the same module, never re-declared in the script — and fails
when a single key is outside `PUBLIC_MEDIA_PREFIXES`.

**Enforced:** a key outside a declared public namespace may not exist in
the `MEDIA` bucket at all. It is a read-only assertion about the real
production bucket, so it is the half the code paths could never cover.

**Not enforced, deliberately:**

| Not enforced | Why |
| --- | --- |
| An *unpublished* object that lives **inside** `portfolio/` | The namespace says a key may be public at all; the D1 row says whether it is published now. The audit reads no D1 row, so a draft project's cover is still fetchable through the custom domain until the bucket is split. |
| Whether the custom domain is attached at all | A Cloudflare account setting; the repository cannot read or change it (Decision 5's release prerequisite). |
| The object *contents*, and the approval workflow | Owned by `src/portfolio/` (`status='published' AND visibility='public'`). |
| Buckets of 1000 keys or more | The driver cannot page: `cf r2 objects list` prints no pagination cursor and its `--start-after` continuation flag is ignored by the local resource simulation. A full page is reported as `listing_incomplete` (undecidable → failed) rather than being read as a whole bucket. |

Everything the audit cannot decide — a missing R2 credential, an API
error, an unrecognised response shape, an empty production key set, a
full page — exits non-zero. `OK` is the only pass, and there is no
`--allow-unknown` flag.

The output is **status-only**: verdict, counts, and a reason code. No
object key, no key fragment, no credential, and no raw CLI error text,
because the report is meant to be pasted into a PR or an Issue without
turning into a second enumeration surface for the bucket
(`docs/runbook/infisical-secrets.md` is the precedent). The formatter is
checked against the keys it audited before a byte is written.

The gate is **operator-run, not a CI step**: no workflow in
`.github/workflows/` holds a Cloudflare credential, so there is nothing
for CI to authenticate with. Procedure and credential policy:
[`docs/runbook/r2-media-key-set-audit.md`](../runbook/r2-media-key-set-audit.md);
recorded decision: `quality/profile.yaml#r2_media_key_set_audit`.
The committed status-only artefact is
[`docs/verification/security/r2-media-key-set-audit.webp`](../verification/security/r2-media-key-set-audit.webp).

This closes the *key-set* half of the gap. It does not replace the
requirement to keep unpublished objects out of the bucket, and
**Issue #459 must still not be closed on repository gates alone.**

## How to re-verify

```bash
# policy + local R2 fixture + HTTP leg (workerd pool, no network)
pnpm exec vitest run test/integration/r2-media-visibility.test.ts
pnpm exec vitest run src/cloudflare/media-visibility.test.ts

# regenerate the review artefact from that run
pnpm run r2:visibility:report

# the key-set audit itself (Issue #577): policy, fail-closed states,
# and the status-only output contract, with no bucket and no network
node --test scripts/check-r2-media-key-set.test.mjs
pnpm run r2:media:audit -- --fixture=quality/fixtures/r2-media-key-set/out-of-allowlist.json
pnpm run r2:media:audit:report   # -> .tmp/r2-media-key-set-report.html
```

The production verdict comes from `pnpm run r2:media:audit`, which is
run by an operator holding the R2-scoped credential; see
[`docs/runbook/r2-media-key-set-audit.md`](../runbook/r2-media-key-set-audit.md).
It is never taken from CI, because CI holds no Cloudflare credential.

The committed screenshot
[`docs/verification/security/r2-public-private.webp`](../verification/security/r2-public-private.webp)
is rendered from the JSON reporter output of the integration run, so a
number in the image cannot drift from the assertions that produced it.

**Deviation from Issue #459's file path (recorded, not silent):** the
Issue names `docs/verification/security/r2-public-private.png`. This
repository's verification-pipeline rule commits screenshots as
moderately compressed WebP, so the committed artefact keeps the same
path stem with a `.webp` extension. Nothing else about the artefact
differs. The generator is *not* hard-wired to that choice — it accepts
either extension and encodes to match, so
`R2_VISIBILITY_TARGET=docs/verification/security/r2-public-private.png`
produces the Issue's literal path if that decision is ever reversed.

## Cross-references

- `src/cloudflare/media-visibility.ts` — the rule, the adapter, the
  listing walk.
- `test/helpers/r2-sequential-probe.ts` — the attacker's probe, kept
  in test support.
- `src/portfolio/media.ts` — URL composition gate.
- `src/http/reactions/images.ts` — reaction-image read gate.
- `scripts/check-r2-media-key-set.mjs` — the read-only key-set audit
  (Issue #577); procedure in
  [`docs/runbook/r2-media-key-set-audit.md`](../runbook/r2-media-key-set-audit.md).
- `docs/portfolio/decisions.md` Decision 5 — why delivery is a public
  custom domain at all.
- [`docs/security.md`](../security.md) — policy index.
