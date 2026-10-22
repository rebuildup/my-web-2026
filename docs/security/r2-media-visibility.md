# R2 object visibility — public keys and private objects

> Which `MEDIA` bucket keys may be served from the public delivery
> surface, which may not, where that decision is enforced in code, and
> what this repository deliberately does **not** enforce.

Authoritative implementation:
[`src/cloudflare/media-visibility.ts`](../../src/cloudflare/media-visibility.ts).
Introduced by Issue #459; the read-only bucket key-set audit was added
by Issue #577 (see [What the key-set audit does](#what-the-key-set-audit-does-issue-577-owner-option-a));
Issue #634 put the delivery adapter on the request path
([What the Worker delivery path does](#what-the-worker-delivery-path-does-issue-634)).

## Read this first — what is enforced where

Issue #459 asks that unpublished material stay invisible to
enumeration and sequential guessing. Since Issue #634 the repository
serves public media **itself**, so the gates below run on the request
path; the only half still outside the repository is the R2 **custom
domain**, if one is still attached to the bucket.

| | Enforced in code today? | Where |
| --- | --- | --- |
| Portfolio media URL composition | **yes** | `composeMediaUrl` → `null` |
| Reaction-image read over HTTP | **yes** | `getImageStream` → router 404 |
| Delivery adapter (namespace + approval) | **yes — production request path** | `GET /media/<key>` → `createPublicMediaDelivery` (`src/http/media/router.ts`) |
| Listing walk | modelled, no production caller — and no listing route exists | `listPublicMediaKeys` |
| Publication approval audit | modelled, no production caller | `auditPublicMediaPublication` |
| Anonymous GET of `https://media.rebuildup.dev/<key>` | **no — no repository code runs on that path** | Cloudflare edge (operator residual) |
| Bucket key set (read-only audit) | **yes — release gate, operator-run** | `pnpm run r2:media:audit` (`scripts/check-r2-media-key-set.mjs`) |

Production no longer hands out custom-domain URLs:
`wrangler.production.jsonc#vars.MEDIA_PUBLIC_BASE_URL` is
`https://rebuildup.dev/media`, so every image the site renders is
fetched through the Worker route below. That makes the code gates the
*effective* delivery path rather than a model behind a public edge.

What remains outside the repository is the attachment itself. A public
custom domain on the `MEDIA` bucket is Decision 5
([`docs/portfolio/decisions.md`](../portfolio/decisions.md)); while the
attachment exists the edge serves every key in the bucket, with no
session, no API key, no signed URL, and no line of our code involved.
Issue #577's key-set audit is the repository's answer to that half — it
stops an out-of-namespace object from existing at all, but cannot stop
an in-namespace object from being served by the edge while it is
unpublished. The concrete failure case and the rollback both live under
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
| Object delivery through Worker code | `createPublicMediaDelivery` (`src/cloudflare/media-visibility.ts`) via `GET`/`HEAD /media/<key>` (`src/http/media/router.ts`) | yes — production delivery path | 404 with an empty body and `no-store`, identical value for every refusal |
| Object listing | `listPublicMediaKeys` (`src/cloudflare/media-visibility.ts`) | **no caller** — no listing route exists, and `/media/` with no key is a 404 | the key is dropped; neither the key nor a withheld **count** is returned |

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
- **Publication approval audit** — `auditPublicMediaPublication` walks
  the same bucket against the same approval predicate and returns
  `{ verdict: 'violation', publicKeys: 3, approvedKeys: 1,
  unapprovedKeys: 2 }` with no key name in the result. A second leg
  approves everything and expects `ok`; the counts are the evidence,
  and the key names are what the audit must not become.

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

## What the Worker delivery path does (Issue #634)

`GET`/`HEAD /media/<key>` is the production delivery path. The path is
listed in `EXTERNAL_BOUNDARY_PREFIXES` (`src/server.ts`, mirrored in
`scripts/_index-boundary.mjs`, asserted equal by
`index:boundary:check`), so the Worker entry hands it to the Hono
boundary; `src/http/media/router.ts` mounts the route and composes the
two gates in the order this document defines them.

| Step | Code | Refusal |
| --- | --- | --- |
| 1. key grammar + namespace | `createPublicMediaDelivery` → `classifyMediaKey` | 404 |
| 2. owner approval | `isApprovedMediaKey` → `src/portfolio/media-approval.ts` / `src/http/reactions/images.ts` | 404 |
| 3. bucket read | `c.env.MEDIA.get(key)` | 404 |
| 4. content type | `isDeliverableMediaContentType` | 404 (not 415) |
| 5. serve | route response | — |

Step 2 is the part a model could only describe: the approval is a D1
read **owned by the obligation that publishes the object**, not by this
route. Portfolio asks `portfolio_media ⋈ portfolio_project` for
`status = 'published' AND visibility = 'public'`; reactions asks
`reaction_images` for the key. `src/http/media/router.ts` knows those
two namespaces and nothing about what published means — the same
boundary that keeps `http/` from importing `home/`. A new producer adds
its namespace to `PUBLIC_MEDIA_PREFIXES` **and** its approval query in
the same review, and cannot publish by forgetting.

Step 4 exists because this route is same-origin as the site: a stray
`text/html` object served from `/media/…` would be an XSS primitive on
`rebuildup.dev`. Only the media types the two producers write are
served; anything else is treated as absent. `x-content-type-options:
nosniff` is set on every 200.

Cache policy follows the key: a stored `Cache-Control` on the object
wins; otherwise `reactions/` keys (SHA-256 addressed) get
`public, max-age=31536000, immutable` and `portfolio/` keys get
`public, max-age=3600` because unpublishing must take effect quickly.
The refusal path is `no-store`.

Proven at two levels: `src/http/media/router.test.ts` states each gate
with fakes, and `test/integration/media-delivery.test.ts` issues real
requests through the Worker entry against a local D1 + R2 fixture whose
bucket deliberately holds an object for **every** refusal case — so a
404 cannot be mistaken for a missing object.

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

1. **Do not put unpublished objects in the public bucket.** While a
   custom domain is attached, the edge serves every key it holds.
   Worker delivery does not change that: it changes which hostname the
   *site* uses, not what the edge answers on the other one.
2. **Retire the custom domain, and do not attach a new one.** The
   delivery path in this repository no longer needs it. Detaching
   `media.rebuildup.dev` (or redirecting it) is the operator step that
   closes the residual, and it is recorded as such in the Issue #634
   release notes. Attaching a custom domain is a Cloudflare account
   setting; the repository can only state the expectation (Decision 5's
   release prerequisite already tracks the attachment itself).
3. **Rollback is one variable.** Pointing
   `MEDIA_PUBLIC_BASE_URL` back at `https://media.rebuildup.dev`
   restores edge delivery for composed URLs without a code change —
   and restores exactly the exposure this section describes. It is a
   break-glass action, not a tuning knob.

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

## Publication approval audit (Issue #459, modelled only)

The key-set audit answers "does an out-of-namespace key exist?". The
other half of Issue #459's first acceptance item is "does an
**in-namespace** key exist that no publication row approves?". That
question needs two sources the delivery path never holds together: the
bucket listing and the D1 publication rows. `auditPublicMediaPublication`
models the reconciliation between them:

```ts
const audit = await auditPublicMediaPublication(source, isApproved, {
  prefix: 'portfolio/',
});
// { verdict, publicKeys, approvedKeys, unapprovedKeys, enumeration }
```

The result carries **counts only** — no key, no key fragment, no
per-key verdict. That is safe for an operator tool walking a prefix it
controls, and it is why the function has no production caller: a
request handler that forwarded a visitor-supplied prefix would turn
the counts into the existence oracle the delivery adapter avoids.

The fail-closed states mirror the key-set audit: an empty public key
set is `undecidable`, a truncated page without a cursor is
`undecidable`, and any unapproved key is `violation`. The approval
predicate is required, so the audit cannot pass by forgetting the
decision it exists to verify. Out-of-namespace keys are not counted
here — Issue #577's audit is the single owner of that rule.

**Not wired.** Turning this into a production release gate requires a
read-only D1 credential and a decision about release scope and
credential supply — the same owner boundary Issue #577 crossed for the
key-set audit. Until that decision exists, the model is exercised only
against the local fixture, and the custom-domain failure case below
remains the operational rule.

## Media restore (Issue #462)

Visibility decides what may be *served*; it says nothing about what
happens when an object is **gone**. Nothing in this repository
re-creates a portfolio image — `portfolio_media` points at an R2 key
and the bucket holds the bytes — so a deleted public image is only
recoverable from a **retained source captured before the deletion**.
`src/cloudflare/media-restore.ts` owns that procedure, and it
re-reads this module's rule instead of trusting a caller's list:

1. `classifyMediaKey` runs **before any write**, so a restore can
   never republish a private or undeclared namespace — a restore is
   the one operation that publishes on purpose;
2. the retained bytes are compared with the manifest (sha256, byte
   length, content type) **before** the upload;
3. the object is **read back** and compared again, so a truncated or
   mislabelled write is a failed restore rather than a silent success.

```ts
const result = await restoreMediaObject(store, retainedSource, manifestEntry);
// { verdict, reason, checks } — no key, no key fragment, no namespace
```

The result is status-only **by construction**: the store and the
source receive the key, the result never holds one. `restored` and
`already_intact` are the only passes; `refused_key`,
`missing_source`, `metadata_drift` and `undecidable` are exits 1 or 2,
so "could not check" never shares a signal with "checked and fine".

Proven against the local workerd R2 fixture by an object that is
really deleted and then really restored
(`test/integration/r2-media-restore.test.ts`), and by a
credential-free fixture proof over seven recorded cases
(`pnpm run r2:restore:proof`). **No production write is performed by
the repository** — a real restore needs an R2-scoped credential that
no workflow here holds, so it stays an operator step. Procedure,
deletion handling and the metadata contract:
[`docs/runbook/r2-media-restore.md`](../runbook/r2-media-restore.md).

Known residual: `portfolio_media` records `r2_key` and `content_type`
but no digest and no byte length (`migrations/0007_portfolio.sql`), so
the manifest a restore is verified against is an operator-side
artefact today. Adding the columns is a separate schema decision and
is deliberately not taken here.

## How to re-verify

```bash
# policy + local R2 fixture + HTTP leg (workerd pool, no network)
pnpm exec vitest run test/integration/r2-media-visibility.test.ts
pnpm exec vitest run src/cloudflare/media-visibility.test.ts

# the production delivery route (Issue #634): decision and wiring
pnpm exec vitest run src/http/media/router.test.ts
pnpm exec vitest run test/integration/media-delivery.test.ts

# regenerate the review artefact from that run
pnpm run r2:visibility:report

# the key-set audit itself (Issue #577): policy, fail-closed states,
# and the status-only output contract, with no bucket and no network
node --test scripts/check-r2-media-key-set.test.mjs
pnpm run r2:media:audit -- --fixture=quality/fixtures/r2-media-key-set/out-of-allowlist.json
pnpm run r2:media:audit:report   # -> .tmp/r2-media-key-set-report.html

# the restore procedure (Issue #462): a deleted public image, its
# refusal and fail-closed states, and the status-only output contract
node --test scripts/r2-media-restore-proof.test.mjs
pnpm exec vitest run test/integration/r2-media-restore.test.ts
pnpm run r2:restore:proof          # seven recorded cases, no credential
pnpm run r2:restore:proof:report   # -> .tmp/r2-restore-proof.html
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
- `src/http/media/router.ts` — the `/media/*` delivery route
  (Issue #634): namespace + approval, content-type allowlist, uniform
  404, cache policy.
- `src/portfolio/media-approval.ts` — portfolio's publication
  approval, owned by the portfolio obligation rather than the route.
- `test/integration/media-delivery.test.ts` — the request-level proof
  through the Worker entry.
- `scripts/check-r2-media-key-set.mjs` — the read-only key-set audit
  (Issue #577); procedure in
  [`docs/runbook/r2-media-key-set-audit.md`](../runbook/r2-media-key-set-audit.md).
- `docs/portfolio/decisions.md` Decision 5 — why delivery is a public
  custom domain at all.
- `src/cloudflare/media-restore.ts` — the restore contract: gate
  first, manifest before the upload, read-back before the claim.
- `docs/runbook/r2-media-restore.md` — operator procedure for a
  deleted public image (Issue #462).
- [`docs/security.md`](../security.md) — policy index.
