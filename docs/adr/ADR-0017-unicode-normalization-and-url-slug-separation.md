# ADR-0017 — Display text vs URL slug: one obligation, two identities

- Status: Accepted
- Date: 2026-10-18
- Ticket: Issue #433 (`feat(i18n): Unicode正規化とURL slugの扱いを分離`)
- Target release: release-0-6-3
- Module location: new leaf obligation `src/i18n/`
- Evidence: `docs/verification/i18n/unicode-slug-validation.{md,webp}`
- Companion domain doc: `docs/domain/i18n.md`

## 1. Context

The platform has two very different kinds of text and no contract that
tells them apart:

1. **Display text** — project titles, summaries, prose, emoji glyphs.
   Human-facing, authored, and already persisted in D1 as written.
2. **URL slug** — `^[a-z][a-z0-9_]*$` for the reactions catalog
   (`src/reactions/slug-regex.ts`) and `^[a-z0-9][a-z0-9-]{0,127}$` for
   the portfolio (`src/portfolio/schema.ts`). Machine identity, published
   in a path segment, and effectively permanent once shared.

There is a third published URL space that this ADR deliberately does
NOT claim: `/tools/<slug>` (`src/routes/tools.$slug.tsx`), whose
grammar is owned by `src/tools/manifest.schema.json` and whose loader
case-folds the URL parameter instead of classifying it. See §6.4.

The two were already implicitly separated — both grammars are
ASCII-only — but nothing said so, nothing checked it, and each call site
re-derived what "a valid slug" meant. `src/home/reactions/widget.tsx`
carried its own copy of the emoji regex. There was no answer to "if I
paste an NFD title into the slug field, what happens?" beyond "a regex
fails somewhere".

The tempting fix is a slugifier. That is precisely what this ADR
refuses, for a reason that is measurable rather than stylistic.

## 2. Decision

### 2.1 Display text is preserved byte-exact

`src/i18n/unicode.ts` states the rule and provides:

- `foldForComparison` — NFC, and only NFC, used as a lookup key for
  comparison and dedupe. Never written to storage, never written to a
  URL, never written to the DOM.
- `describeUnicode` — reports normalization form, code points, and the
  characters an NFKC fold would change. Reporting only.
- `assertDisplayTextPreserved` — a `===` identity check for a seam
  that *transforms* display text: it compares the raw value captured on
  one side of the transformation with the transformed value on the
  other. It is only meaningful with two distinct values; passing the
  same expression twice is a tautology that can never fail, and
  `rowToProject` was found doing exactly that during review (§5).
  No shipped mapper needs it today, because every display-text mapping
  in the repository is an identity by construction and the unit tests
  pin that property directly.

### 2.2 A slug is authored, never derived

`src/i18n/slug-identity.ts` classifies a candidate against an
owner-supplied grammar and returns a reason:

| reason | meaning |
| --- | --- |
| `not-a-string` | wrong type |
| `empty` | nothing to publish |
| `non-ascii` | **policy refusal**: the platform will not transliterate, fold, or strip marks to make a URL |
| `too-long` | over the owner's bound |
| `grammar-mismatch` | ASCII, but not this owner's grammar |

`non-ascii` is checked *before* length and pattern so the reason a caller
sees is a policy decision, not an accident of a pattern. The two URL
spaces listed in §1 route their candidates through this classifier;
`/tools/$slug` does not, by a recorded owner decision (§6.4).

`findSlugCollisions` audits a catalog for the two failures D1 cannot
catch: `duplicate-url` (two rows claim one path) and
`normalization-alias` (one word, two URLs, because one row is NFC and
the other NFD).

### 2.3 `src/i18n/` is a leaf obligation

It imports nothing from the repository, so `home/`, `portfolio/`,
`reactions/`, `admin/` and `routes/` can all obey the same policy
without depending on each other. `scripts/check-architecture.mjs`
enforces the leaf rule; every `*.test.*` / `*.spec.*` file under the
leaf is exempt, because the decision table's tests assert the policy
against the owner-owned grammars it was written for
(`src/i18n/fixtures.test.ts`). The implementation modules are not
exempt.

### 2.4 The decision table is shared data

`src/i18n/fixtures.ts` holds 17 rows covering NFC/NFD pairs,
compatibility-confusable families (`ﬁ`, `µ`/`μ`, `Å`, fullwidth, `①`,
`Ⅳ`), negation and units, an emoji glyph, and a zero-width space. The
unit tests, the CI gate and the verification capture all read it, so the
three cannot drift.

### 2.5 A CI gate keeps the surface honest

`scripts/check-i18n-policy.mjs` (in `validate:fast`) fails on a
compatibility form in code, any `normalize()` outside `src/i18n`, a
locale-implicit `toLocaleString()` / `new Intl.X()`, and a lossy
derivation helper. It also fails when a fixture row no longer matches
the shipped policy.

"Locale-implicit" means the call names no locale at all — an empty
argument list or an explicit `undefined`. A *variable* locale is not
flagged, because a correct opt-in adapter (Issue #430's typed
`HomeLocale`) and an inherited locale look identical at the call site;
guessing would make the gate fail a right answer. See §6.3.

## 3. Why refusing beats normalising

Every mainstream slugifier ends with a lossy fold (`NFKD` +
"drop combining marks", or NFKC, or a transliteration table). Measured on
the decision table (`naiveSlugify` in the capture script):

| input | naive slug | what changes |
| --- | --- | --- |
| `5 µm tolerance` and `5 μm tolerance` | both `/5-m-tolerance` | MICRO SIGN and GREEK MU are different letters and now share a URL |
| `ＭＵＬＴＩ slicer` and `Multi slicer` | both `/multi-slicer` | the fullwidth spelling claims the ASCII project's URL |
| `N ≠ 3 (非対応)` | `/n-3` | the negation disappears; mark-stripping reduces `≠` to `=` |
| `① 優先` | `/1` | a value changes |
| `Ⅳ 期` | `/iv` | a value changes |

Once two words share a URL the collision is permanent: the URL is
already published, in bookmarks, in other people's links, in
screenshots. Refusing the candidate keeps the mapping injective — a
path segment either denotes exactly the entry that claims it, or
nothing.

The canonical-form case (`café` NFC vs NFD) is handled without
touching URLs at all: display keeps the author's bytes, comparison folds
to NFC, and neither can mint a URL because non-ASCII is refused first.

## 4. Alternatives considered

| alternative | why not |
| --- | --- |
| Ship a slugifier (transliteration + truncation) | transliteration is a language judgement, not a string operation; it silently picks a word. Untestable against "did it merge two entries?" |
| Apply NFKC to storage "once, at the boundary" | fixes the form and loses the bytes; `µ` vs `μ`, `①` vs `1` become indistinguishable everywhere downstream |
| Derive slugs from titles in a background job | same collision risk, plus a rename risk: the URL would change when a title is edited |
| Keep regexes, document the intent only | that is the pre-#433 state: three copies of the emoji regex, no reason codes, no collision audit |
| Adopt a proofreading library (e.g. yomiyasu) | it is an editing aid and a Python dependency; it cannot prove text quality, and Python is not a runtime this platform takes on. Typo detection and this contract are separate obligations |
| Locale-negotiated formatting (`Intl.DateTimeFormat()` bare) | the rendered value would depend on the visitor's environment, so the same record would read differently per visitor — an implicit locale is an implicit meaning |

## 5. Consequences

- `validateSlug` keeps its existing messages and accept set exactly;
  `SlugSchema` keeps its accept set, and its ASCII/grammar rejection is
  now rendered from the owner's own pattern (`must match
  ^[a-z0-9][a-z0-9-]{0,127}$`, no `/…/` delimiters) with a Zod issue
  `code` of `custom` rather than `invalid_format`. Both changes are
  reason-compatible rather than byte-identical, and no shipped consumer
  reads either — the two spaces are classified, not string-matched.
  Both gain a reason for non-ASCII candidates.
- `rowToProject` leaves display text byte-exact. That is a property of
  the mapping (it assigns, it does not compute) and it is pinned by
  `src/portfolio/schema.test.ts`, not by a runtime assertion. An earlier
  revision wrapped two fields in `assertDisplayTextPreserved` with the
  same expression on both sides; review showed the guard could never
  fire and that it read as a boundary check, so it was removed rather
  than kept as decoration.
- The home widget no longer owns a private copy of the emoji regex.
- `pnpm run i18n:policy:check` is part of `validate:fast`; a developer
  who writes `text.normalize('NFKC')` or `count.toLocaleString()` in
  `src/` gets a failing gate instead of a runtime surprise. A locale
  passed as a *variable* is not machine-checked — see §6.3.
- The gate and the capture script import TypeScript sources directly,
  which needs Node >= 22.18 (already the `engines` floor and the CI
  version). Node's type-stripping loader resolves ESM specifiers
  literally — an extensionless `./slug-identity` inside a shipped
  module raises `ERR_MODULE_NOT_FOUND` — so every module reachable
  from those two scripts (`src/i18n/**`, `src/portfolio/schema.ts`)
  uses explicit `.ts` specifiers, and
  `tsconfig.json#allowImportingTsExtensions` is what lets TypeScript
  accept them. The rest of `src/` keeps the repo-wide extensionless
  convention.

## 6. Open questions (owner decisions, not decided here)

1. `/portfolio/<non-ASCII>` currently throws out of `SlugSchema.parse`
   in the route loader (a 500). Whether an out-of-grammar slug is a
   404 is a route contract question and belongs to its own ticket.
2. The migration / publish scripts derive slugs from legacy ids with
   their own ASCII-strip implementation. Whether they adopt this policy
   or get a collision audit is an owner decision; today's data is
   ASCII-only.
3. **The visitor-locale question is now partly answered by Issue #430.**
   `src/home/format.ts` (home obligation) landed after this ADR and
   declares a typed `HomeLocale` ('en' | 'ja' | 'ko') plus a `'UTC'`
   default, and documents that auto-negotiation (`Accept-Language`,
   URL prefix, cookie) is deliberately not implemented. That satisfies
   the "opt-in means named" half of `explicit-locale`: the locale is
   named and closed, not inherited. What remains undecided is the half
   this ADR asked for first — if a visitor-locale-respecting surface is
   ever wanted, its negotiation source, its fallback, and its
   SSR/hydration agreement must be defined before it is allowed past
   `explicit-locale`. The gate cannot enforce that part: it flags a
   call that names no locale, not one that names a *variable*, because
   the call site cannot be read to tell the two apart. The contract
   belongs to the obligation that declares it, and `src/home/format.ts`
   declares its own.
4. **`/tools/$slug` is a published URL space that this policy does not
   cover.** `src/routes/tools.$slug.tsx` derives its lookup key with
   `params.slug.toLowerCase()` (Issue #183 display-case tolerance) and
   never calls `classifySlugCandidate`, so `/tools/MultiSlicer` and
   `/tools/multislicer` resolve to the same published identity. The
   grammar itself (`^[a-z0-9][a-z0-9-]{0,127}$`) is already ASCII-only
   and is declared by the tools obligation in
   `src/tools/manifest.schema.json`, so nothing can leak a non-ASCII
   character into that path today; what is unresolved is the
   case-folding tolerance. Two owner decisions are on the table and
   neither is made here:

   - route `params.slug` through `classifySlugCandidate` against a
     `tools-slug` grammar descriptor published by the tools obligation,
     which retires the display-case tolerance; or
   - record the case folding as a deliberate, permanent exception to
     "a slug is authored, never derived", in which case this ADR needs
     an explicit exception clause rather than a note.

   The CI gate does **not** detect `.toLowerCase()` on a route
   parameter, so nothing here will fail if the wiring is forgotten; the
   gap is recorded instead. Deciding it belongs to a ticket of its own
   because it changes Issue #183's shipped behaviour.