/**
 * `src/i18n/` — the platform's Unicode text policy (Issue #433).
 *
 * Two identities, two rules, one obligation:
 *
 *   - **Display text** (`./unicode.ts`) is preserved byte-exact as the
 *     author wrote it. The only normalization performed is a read-only
 *     NFC fold used for comparison, plus a diagnostic report of what a
 *     compatibility fold (NFKC/NFKD) would destroy.
 *   - **URL slug** (`./slug-identity.ts`) is authored, never derived.
 *     A candidate is accepted only when it already satisfies the
 *     owner's ASCII grammar; non-ASCII is refused with a reason rather
 *     than transliterated, folded, or diacritic-stripped.
 *
 * `./fixtures.ts` is the shared decision table the unit tests, the CI
 * policy gate and the Issue #433 verification capture all read, so the
 * three cannot drift apart. `./glyphs.fixture.ts` is the same kind of
 * shared table for Issue #432: the fr / de / pt / ru heading samples a
 * glyph-display verification measures, read by the unit tests, the
 * Storybook preview and the coverage capture.
 *
 * Import specifiers in this obligation carry the `.ts` extension on
 * purpose, and so do the other modules the Node-side gate imports
 * (`src/portfolio/schema.ts`). `scripts/check-i18n-policy.mjs` and
 * `scripts/capture-i18n-unicode-slug.mjs` load the shipped TypeScript
 * directly so the CI evidence comes from the code the Worker runs; the
 * Node type-stripping loader resolves ESM specifiers literally and
 * raises `ERR_MODULE_NOT_FOUND` for an extensionless `./unicode`, so
 * `tsconfig.json#allowImportingTsExtensions` is what lets TypeScript
 * accept the same specifiers. Every other `src/` import in the
 * repository stays extensionless — the relaxation is scoped to what
 * the evidence path needs, not adopted repo-wide.
 *
 * Leaf obligation: no repository imports, no platform bindings. See
 * `docs/adr/ADR-0017-unicode-normalization-and-url-slug-separation.md`
 * and `docs/domain/i18n.md`.
 */

export {
	assertDisplayTextPreserved,
	type CodePointFact,
	type CompatibilityFoldChange,
	describeCodePoint,
	describeUnicode,
	findCompatibilityFoldChanges,
	findNonAscii,
	foldForComparison,
	type NormalizationForm,
	toCodePointHex,
	type UnicodeFacts,
} from './unicode.ts';

export {
	assertNoSlugCollisions,
	classifySlugCandidate,
	describeSlugGrammar,
	describeSlugRejection,
	findSlugCollisions,
	formatSlugCollisions,
	type SlugAccepted,
	type SlugCollision,
	type SlugCollisionKind,
	type SlugGrammar,
	type SlugIdentityEntry,
	type SlugRejected,
	type SlugRejectionReason,
	type SlugVerdict,
} from './slug-identity.ts';

export {
	type GlyphCodePointUsage,
	type GlyphFocus,
	type GlyphForm,
	type GlyphGuard,
	type GlyphGuardKind,
	type GlyphHeadingSample,
	GLYPH_HEADING_FIXTURES,
	GLYPH_LOCALES,
	type GlyphLocale,
	type GlyphLocaleFixture,
	type GlyphTier,
	glyphCodePointUsage,
	glyphSampleById,
	glyphSampleCodePoints,
	glyphSampleIds,
	glyphSamples,
	type GlyphTypographyNote,
} from './glyphs.fixture.ts';

export {
	type SlugExpectation,
	type SlugGrammarId,
	UNICODE_FIXTURES,
	type UnicodeFixture,
	unicodeFixtureById,
	unicodeFixtureIds,
} from './fixtures.ts';
