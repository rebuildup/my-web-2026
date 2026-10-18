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
- `assertDisplayTextPreserved` — a `===` identity check a loader can
  use to prove a display field crossed a boundary unmodified.

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
sees is a policy decision, not an accident of a pattern.

`findSlugCollisions` audits a catalog for the two failures D1 cannot
catch: `duplicate-url` (two rows claim one path) and
`normalization-alias` (one word, two URLs, because one row is NFC and
the other NFD).

### 2.3 `src/i18n/` is a leaf obligation

It imports nothing from the repository, so `home/`, `portfolio/`,
`reactions/`, `admin/` and `routes/` can all obey the same policy
without depending on each other. `scripts/check-architecture.mjs`
enforces the leaf rule; test files are exempt so the fixture table can
assert against the grammars it was written for.

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

- `validateSlug` / `SlugSchema` keep their existing messages and accept
  sets; they gain a reason for non-ASCII candidates.
- `rowToProject` now proves display fields crossed the row → model
  boundary unmodified.
- The home widget no longer owns a private copy of the emoji regex.
- `pnpm run i18n:policy:check` is part of `validate:fast`; a developer
  who writes `text.normalize('NFKC')` or `count.toLocaleString()` in
  `src/` gets a failing gate instead of a runtime surprise.
- The gate and the capture script import TypeScript sources directly,
  which needs Node >= 22.18 (already the `engines` floor and the CI
  version).

## 6. Open questions (owner decisions, not decided here)

1. `/portfolio/<non-ASCII>` currently throws out of `SlugSchema.parse`
   in the route loader (a 500). Whether an out-of-grammar slug is a
   404 is a route contract question and belongs to its own ticket.
2. The migration / publish scripts derive slugs from legacy ids with
   their own ASCII-strip implementation. Whether they adopt this policy
   or get a collision audit is an owner decision; today's data is
   ASCII-only.
3. If a visitor-locale-respecting surface is ever wanted, its contract
   (fallback, SSR/hydration agreement) must be defined before it is
   allowed past `explicit-locale`.