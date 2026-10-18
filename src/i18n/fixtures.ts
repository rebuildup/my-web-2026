/**
 * The canonical Unicode / slug decision table (Issue #433).
 *
 * One table, three consumers, zero drift:
 *
 *   * `src/i18n/fixtures.test.ts` — asserts every row against the
 *     shipped policy plus the two owner-owned grammars.
 *   * `scripts/check-i18n-policy.mjs` — the CI gate reports the same
 *     rows as its fixture section.
 *   * `scripts/capture-i18n-unicode-slug.mjs` — renders the same rows
 *     into `docs/verification/i18n/unicode-slug-validation.webp`.
 *
 * This module holds DATA only. It deliberately does not import the
 * slug grammars: `i18n` is a leaf obligation, and the grammars belong
 * to `reactions/` and `portfolio/`. Consumers resolve a
 * {@link SlugGrammarId} to the owning obligation's grammar, which is
 * also how the table proves the grammars it was written against.
 *
 * Escapes, not literals: NFC and NFD spellings of the same word render
 * identically and differ only by invisible combining marks, so every
 * non-ASCII character in the table below is written as an explicit
 * `\uXXXX` escape with the rendered character in a comment. A reviewer
 * — and a future formatter — can then see which code point is meant.
 * `fixtures.test.ts` additionally asserts that the NFD row really is
 * NFD, so a tool that silently normalises this file fails the suite
 * instead of quietly erasing the distinction.
 */

/** Identifiers for the grammars the shipped URL spaces declare. */
export type SlugGrammarId = 'emoji-slug' | 'portfolio-slug';

export interface SlugExpectation {
	readonly grammar: SlugGrammarId;
	readonly outcome: 'accepted' | 'rejected';
	/** Required when `outcome` is `rejected`. */
	readonly reason?: 'not-a-string' | 'empty' | 'non-ascii' | 'too-long' | 'grammar-mismatch';
}

export interface UnicodeFixture {
	/** Stable id — referenced from tests, the gate report and the PR. */
	readonly id: string;
	/** What the row demonstrates. English: this is source-adjacent data. */
	readonly subject: string;
	/** The display body exactly as an author wrote it. */
	readonly displayText: string;
	/** What somebody would try to publish in the URL path segment. */
	readonly slugCandidate: string;
	/** True when NFKC would change `displayText` (i.e. folding is lossy here). */
	readonly compatFoldRisk: boolean;
	/** Entries sharing a group are the SAME word in different spellings. */
	readonly canonicalGroup?: string;
	readonly expectations: readonly SlugExpectation[];
	/** Why the platform behaves this way. */
	readonly note: string;
}

/** Notes referenced by several rows, kept here so the table stays flat. */
const NOTES = {
	authored:
		'The slug is authored next to the title, never derived from it: ' +
		'nothing in the pipeline transliterates, folds, or strips marks.',
	grammar:
		'The grammar is owner-specific. The same string is a valid emoji slug ' +
		'and an invalid portfolio slug, so each URL space keeps its own contract.',
	canonical:
		'NFC and NFD are two spellings of ONE word. Display keeps the ' +
		"author's bytes, comparison folds to NFC, and neither can mint a URL.",
	japanese:
		'Non-ASCII is refused, not romanised. Whether the URL says "audi" or ' +
		'"audi-jido" is an author decision, not a Unicode side effect.',
	caseFold:
		'No case folding: the grammar declares the lowercase contract, so an ' +
		'uppercase candidate is refused instead of quietly rewritten.',
	confusable:
		'NFKC would mint a URL that belongs to a different spelling of the word. ' +
		'The refusal is what keeps the URL space injective.',
	value:
		'A compatibility fold changes a VALUE here (a digit, a unit letter, a ' +
		'relation symbol). The published claim is not ours to rewrite.',
	invisible:
		'Invisible characters are non-ASCII and are refused. A URL has to stay ' +
		'readable when somebody quotes it in an issue or a commit message.',
} as const;

/**
 * The table. Ordered roughly as a reviewer reads it: accepted first
 * (show the contract working), then canonical forms, then the
 * compatibility-confusable families, then the non-ASCII tail.
 */
export const UNICODE_FIXTURES: readonly UnicodeFixture[] = [
	{
		id: 'emoji-ascii-slug',
		subject: 'An ASCII slug authored beside its display title',
		displayText: 'Thumbs up',
		slugCandidate: 'thumbs_up',
		compatFoldRisk: false,
		expectations: [
			{ grammar: 'emoji-slug', outcome: 'accepted' },
			{ grammar: 'portfolio-slug', outcome: 'rejected', reason: 'grammar-mismatch' },
		],
		note: NOTES.authored,
	},
	{
		id: 'portfolio-ascii-slug',
		subject: 'The same discipline in the portfolio URL space',
		displayText: 'Multi slicer',
		slugCandidate: 'multi-slicer',
		compatFoldRisk: false,
		expectations: [
			{ grammar: 'portfolio-slug', outcome: 'accepted' },
			{ grammar: 'emoji-slug', outcome: 'rejected', reason: 'grammar-mismatch' },
		],
		note: NOTES.grammar,
	},
	{
		id: 'japanese-title-ascii-slug',
		subject: 'A Japanese title whose slug stays ASCII',
		displayText: 'Audi \u81ea\u52d5\u5316', // Audi 自動化,
		slugCandidate: 'audi',
		compatFoldRisk: false,
		expectations: [
			{ grammar: 'emoji-slug', outcome: 'accepted' },
			{ grammar: 'portfolio-slug', outcome: 'accepted' },
		],
		note: NOTES.japanese,
	},
	{
		id: 'nfc-accented-title',
		subject: 'Precomposed accent (NFC) as a slug candidate',
		displayText: 'Caf\u00e9 notes', // Café notes — U+00E9, one code point,
		slugCandidate: 'caf\u00e9', // café — precomposed,
		compatFoldRisk: false,
		canonicalGroup: 'cafe-title',
		expectations: [
			{ grammar: 'emoji-slug', outcome: 'rejected', reason: 'non-ascii' },
			{ grammar: 'portfolio-slug', outcome: 'rejected', reason: 'non-ascii' },
		],
		note: NOTES.canonical,
	},
	{
		id: 'nfd-accented-title',
		subject: 'Decomposed accent (NFD) as a slug candidate',
		displayText: 'Cafe\u0301 notes', // Café notes — "e" + U+0301, two code points,
		slugCandidate: 'cafe\u0301', // café — decomposed,
		compatFoldRisk: false,
		canonicalGroup: 'cafe-title',
		expectations: [
			{ grammar: 'emoji-slug', outcome: 'rejected', reason: 'non-ascii' },
			{ grammar: 'portfolio-slug', outcome: 'rejected', reason: 'non-ascii' },
		],
		note: NOTES.canonical,
	},
	{
		id: 'uppercase-candidate',
		subject: 'An uppercase slug candidate',
		displayText: 'Multi slicer',
		slugCandidate: 'MultiSlicer',
		compatFoldRisk: false,
		expectations: [
			{ grammar: 'emoji-slug', outcome: 'rejected', reason: 'grammar-mismatch' },
			{ grammar: 'portfolio-slug', outcome: 'rejected', reason: 'grammar-mismatch' },
		],
		note: NOTES.caseFold,
	},
	{
		id: 'ligature-confusable',
		subject: 'The fi ligature — NFKC would expand it',
		displayText: '\ufb01nance report', // finance report,
		slugCandidate: '\ufb01nance', // finance,
		compatFoldRisk: true,
		expectations: [
			{ grammar: 'emoji-slug', outcome: 'rejected', reason: 'non-ascii' },
			{ grammar: 'portfolio-slug', outcome: 'rejected', reason: 'non-ascii' },
		],
		note: NOTES.confusable,
	},
	{
		id: 'micro-sign-slug',
		subject: 'MICRO SIGN — NFKC would swap it for GREEK MU',
		displayText: '5 \u00b5m tolerance', // 5 µm tolerance,
		slugCandidate: '\u00b5m', // µm,
		compatFoldRisk: true,
		expectations: [
			{ grammar: 'emoji-slug', outcome: 'rejected', reason: 'non-ascii' },
			{ grammar: 'portfolio-slug', outcome: 'rejected', reason: 'non-ascii' },
		],
		note: 'NFKC maps U+00B5 to U+03BC, so the micro sign and the Greek mu would share one URL while naming two different letters.',
	},
	{
		id: 'greek-mu-slug',
		subject: 'GREEK SMALL LETTER MU — the other half of that pair',
		displayText: '5 \u03bcm tolerance', // 5 μm tolerance,
		slugCandidate: '\u03bcm', // μm,
		compatFoldRisk: false,
		expectations: [
			{ grammar: 'emoji-slug', outcome: 'rejected', reason: 'non-ascii' },
			{ grammar: 'portfolio-slug', outcome: 'rejected', reason: 'non-ascii' },
		],
		note: 'Refused for the same reason as its look-alike: the URL space must not decide which letter a page meant.',
	},
	{
		id: 'circled-digit-value',
		subject: 'CIRCLED DIGIT ONE — a compatibility fold changes the value',
		displayText: '\u2460 \u512a\u5148', // ① 優先
		slugCandidate: '\u2460', // ①,
		compatFoldRisk: true,
		expectations: [
			{ grammar: 'emoji-slug', outcome: 'rejected', reason: 'non-ascii' },
			{ grammar: 'portfolio-slug', outcome: 'rejected', reason: 'non-ascii' },
		],
		note: NOTES.value,
	},
	{
		id: 'roman-numeral-value',
		subject: 'ROMAN NUMERAL FOUR — a compatibility fold changes the value',
		displayText: '\u2163 \u671f', // Ⅳ 期,
		slugCandidate: '\u2163', // Ⅳ,
		compatFoldRisk: true,
		expectations: [
			{ grammar: 'emoji-slug', outcome: 'rejected', reason: 'non-ascii' },
			{ grammar: 'portfolio-slug', outcome: 'rejected', reason: 'non-ascii' },
		],
		note: NOTES.value,
	},
	{
		id: 'fullwidth-candidate',
		subject: 'Fullwidth letters that NFKC folds to ASCII',
		displayText: '\uff2d\uff35\uff2c\uff34\uff29 slicer', // ＭＵＬＴＩ slicer,
		slugCandidate: '\uff4d\uff55\uff4c\uff54\uff49', // ｍｕｌｔｉ,
		compatFoldRisk: true,
		expectations: [
			{ grammar: 'emoji-slug', outcome: 'rejected', reason: 'non-ascii' },
			{ grammar: 'portfolio-slug', outcome: 'rejected', reason: 'non-ascii' },
		],
		note: 'NFKC folds fullwidth letters to ASCII, so the fullwidth spelling would claim the URL that belongs to the ASCII project.',
	},
	{
		id: 'negation-preserved',
		subject: 'A negation the platform must not quietly reverse',
		displayText: 'N \u2260 3 (\u975e\u5bfe\u5fdc)', // N ≠ 3 (非対応),
		slugCandidate: 'threshold',
		compatFoldRisk: false,
		expectations: [
			{ grammar: 'emoji-slug', outcome: 'accepted' },
			{ grammar: 'portfolio-slug', outcome: 'accepted' },
		],
		note: 'NFKC leaves ≠ alone, but the other half of every slugify recipe — NFKD plus "drop combining marks" — decomposes it into "=" plus an overlay, and the claim is reversed. Both tools are refused, not just the one that happens to be lossy on this row.',
	},
	{
		id: 'measurement-unit-preserved',
		subject: 'A unit glyph: a typography change, or a meaning change?',
		displayText: '10 \u33a1 (\u2264 30)', // 10 ㎡ (≤ 30),
		slugCandidate: 'area-10',
		compatFoldRisk: true,
		expectations: [
			{ grammar: 'portfolio-slug', outcome: 'accepted' },
			{ grammar: 'emoji-slug', outcome: 'rejected', reason: 'grammar-mismatch' },
		],
		note: 'NFKC rewrites ㎡ as "m2". The meaning survives here, so this is a TYPOGRAPHY change rather than a copy error — but the same machinery turns ① into 1 and µ into μ, which are meaning changes. One policy has to refuse the whole family, because the platform cannot tell which case it is looking at.',
	},
	{
		id: 'angstrom-confusable',
		subject: 'ANGSTROM SIGN vs A WITH RING ABOVE',
		displayText: '\u212b capacity', // Å capacity — U+212B,
		slugCandidate: '\u212b', // Å,
		compatFoldRisk: true,
		expectations: [
			{ grammar: 'emoji-slug', outcome: 'rejected', reason: 'non-ascii' },
			{ grammar: 'portfolio-slug', outcome: 'rejected', reason: 'non-ascii' },
		],
		note: 'NFKC folds U+212B to "A" while U+00C5 stays "Å". Strip the marks from both and two different letters end up sharing one URL.',
	},
	{
		id: 'emoji-codepoint-display',
		subject: 'An emoji glyph as display text, an ASCII slug as identity',
		displayText: '\ud83d\udc4d reaction', // 👍 reaction
		slugCandidate: 'thumbs_up',
		compatFoldRisk: false,
		expectations: [
			{ grammar: 'emoji-slug', outcome: 'accepted' },
			{ grammar: 'portfolio-slug', outcome: 'rejected', reason: 'grammar-mismatch' },
		],
		note: 'The glyph and the slug are different identities: the glyph is catalog data, the slug is the URL key.',
	},
	{
		id: 'zero-width-slug',
		subject: 'A zero-width space hidden inside an otherwise valid slug',
		displayText: 'Thumbs up',
		slugCandidate: 'thumbs\u200bup', // thumbs<ZWSP>up,
		compatFoldRisk: false,
		expectations: [
			{ grammar: 'emoji-slug', outcome: 'rejected', reason: 'non-ascii' },
			{ grammar: 'portfolio-slug', outcome: 'rejected', reason: 'non-ascii' },
		],
		note: NOTES.invisible,
	},
];

/** Fixture ids, in table order. */
export function unicodeFixtureIds(): readonly string[] {
	return UNICODE_FIXTURES.map((fixture) => fixture.id);
}

/** Look one row up by id (the gate and the capture both do). */
export function unicodeFixtureById(id: string): UnicodeFixture | undefined {
	return UNICODE_FIXTURES.find((fixture) => fixture.id === id);
}
