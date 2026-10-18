/**
 * The canonical heading-glyph fixture (Issue #432).
 *
 * What this owns
 * --------------
 * The **data** a glyph-display verification reads: a small set of
 * French / German / Portuguese / Russian heading strings, each one
 * chosen because it exercises a character class the shipped type
 * stack has to render — precomposed accents, decomposed combining
 * marks, a ligature, Cyrillic, and each locale's punctuation and
 * spacing conventions.
 *
 * It is DATA plus pure lookups. Like `./fixtures.ts` (Issue #433) it
 * imports nothing from the repository, so `i18n` stays a leaf
 * obligation and every consumer can read the same table without
 * depending on each other.
 *
 * Three consumers, zero drift:
 *
 *   * `src/i18n/glyphs.test.ts` — the CI assertions (guards, forms,
 *     code points, byte-exact round trips).
 *   * `src/editorial/glyph-headings.stories.tsx` — the Storybook
 *     preview, rendered with the SHIPPED font stack.
 *   * `scripts/capture-glyph-coverage.mjs` — the static verification
 *     report and the browser probe behind
 *     `docs/verification/i18n/diacritic-cyrillic-font.webp`.
 *
 * Where it deliberately stops
 * ---------------------------
 *
 *   * **It declares no font.** `tier` names the type tier
 *     (`heading` / `body`); the stack itself stays owned by
 *     `src/editorial/tokens.ts`. A fixture that carried its own
 *     `font-family` would be a second declaration that could drift
 *     from the product, and the whole point is to measure the
 *     product's stack.
 *   * **It is not copy.** Every string below is a SYNTHETIC fixture
 *     written to exercise a character class. None of it is approved
 *     site copy, and none of it is a translation of anything the
 *     owner publishes. `docs/domain/i18n.md` §5 draws the line:
 *     copy quality is the editor's job and the platform does not
 *     proofread; typography is the font stack's job and this
 *     repository measures it. A fixture must therefore never be
 *     mistaken for a proofreading result — which is also why no
 *     proofreading tool (yomiyasu or otherwise) is wired into this
 *     fixture, its tests, or its capture.
 *   * **It does not negotiate.** Every sample names an explicit
 *     BCP-47 `lang`. Locale is opt-in per sample
 *     (`docs/domain/i18n.md` §6); nothing here derives a locale from
 *     the visitor.
 *
 * Escapes, not literals
 * ---------------------
 * Same rule as `./fixtures.ts`: every non-ASCII character is written
 * as a `\uXXXX` escape with the rendered string in a trailing
 * comment. An NFC spelling and its NFD twin render identically and
 * differ only by invisible marks, so a reader — and a future
 * formatter — has to be able to see which code points are meant.
 * `glyphs.test.ts` asserts that each row really is the form it
 * claims, so a tool that silently normalised this file fails the
 * suite instead of quietly erasing the distinction.
 */

/** Locales the fixture covers. Each one opts in explicitly. */
export const GLYPH_LOCALES = ['fr', 'de', 'pt', 'ru'] as const;

export type GlyphLocale = (typeof GLYPH_LOCALES)[number];

/**
 * The character class a sample exists to render.
 *
 * `typography` rows are about SPACING and PUNCTUATION (guillemets,
 * quote pairs, dashes, group separators); `character` rows are about
 * the letter itself. Keeping the two apart is §5's split, expressed
 * in the type: a change to a space is a typography review, a change
 * to a letter is a copy review.
 */
export type GlyphFocus = 'accent' | 'combining' | 'ligature' | 'cyrillic' | 'typography';

/**
 * What a guard protects.
 *
 * `number` / `negation` / `permission` are the three claims the
 * acceptance criteria name explicitly: a value, a reversal, and an
 * access level. They are substrings of the sample, so any tool that
 * "tidied" the fixture and dropped `ne pas` or turned `nur lesen`
 * into `Lesen` fails the suite instead of quietly publishing a
 * different sentence.
 */
export type GlyphGuardKind = 'character' | 'number' | 'negation' | 'permission';

export interface GlyphGuard {
	/** Stable id — referenced from the test and the report. */
	readonly id: string;
	readonly kind: GlyphGuardKind;
	/** The exact substring that has to survive into the rendering. */
	readonly token: string;
	/** Why this token is load-bearing. */
	readonly note: string;
}

/**
 * Normalization form the sample is authored in.
 *
 * `mixed` is a real state, not an error: a text can carry a
 * precomposed `ё` (U+0451) and a decomposed `й` in the same line and
 * then be neither NFC nor NFD as a whole. The platform keeps whatever
 * the author wrote, so the fixture records the state instead of
 * normalising towards it.
 */
export type GlyphForm = 'NFC' | 'NFD' | 'mixed';

/**
 * Which tier of the shipped type scale renders a sample.
 *
 * A tier is a TYPE TIER, never a font: the stacks stay owned by
 * `src/editorial/tokens.ts`. The tier is what tells a measurement which
 * stack the row is drawn with, because the heading tier and the body
 * tier are two DIFFERENT stacks — a code point that appears only in body
 * rows has to be judged against the body stack's `.notdef`, or the
 * verdict is about a stack that never drew it.
 */
export type GlyphTier = 'heading' | 'body';

export interface GlyphHeadingSample {
	readonly id: string;
	readonly locale: GlyphLocale;
	/** BCP-47 tag the preview declares on the element — the opt-in. */
	readonly lang: string;
	readonly focus: GlyphFocus;
	/** Which tier of the shipped type scale renders this sample. */
	readonly tier: GlyphTier;
	/** The display text exactly as an author wrote it. */
	readonly heading: string;
	readonly form: GlyphForm;
	/**
	 * Code points the sample must actually carry, `U+XXXX` style.
	 *
	 * Pinned so a "helpful" NFC rewrite of a decomposed row, or a
	 * build step that drops a combining mark, fails the suite with a
	 * name instead of rendering one accent short.
	 */
	readonly probe: readonly string[];
	/** Samples sharing a group are ONE word in two spellings. */
	readonly canonicalGroup?: string;
	/**
	 * The word this sample demonstrates, in its own spelling.
	 *
	 * A canonical pair is two ROWS, and a row is a sentence, so the word
	 * has to be named separately: `Grüße Ausgabe (NFC)` and
	 * `Grüße Ausgabe (NFD)` share "Grüße", not their whole text.
	 * Declaring the word makes that explicit and lets the test compare
	 * the two spellings directly instead of guessing where one ends.
	 */
	readonly word?: string;
	readonly guards: readonly GlyphGuard[];
	readonly note: string;
}

/**
 * A typography convention of one locale.
 *
 * These are the observations a reader would otherwise have to
 * rediscover from the rendered image: three locales group digits
 * with three DIFFERENT code points, and two of them use a space that
 * is invisible in the source.
 */
export interface GlyphTypographyNote {
	readonly id: string;
	/** The convention, in one clause. */
	readonly claim: string;
	/** The code points involved, or why it matters for rendering. */
	readonly note: string;
}

export interface GlyphLocaleFixture {
	readonly locale: GlyphLocale;
	readonly lang: string;
	readonly typography: readonly GlyphTypographyNote[];
	readonly samples: readonly GlyphHeadingSample[];
}

/** Guard notes referenced by several rows, kept here so the table stays flat. */
const GUARD_NOTES = {
	number:
		'The digits and the decimal mark are the claim. A "cleanup" that ' +
		'changes 1 234,56 into 1234.56 has changed the number.',
	negation:
		'A negation is the claim, not a style choice. Dropping or ' +
		'softening it reverses the sentence.',
	permission:
		'An access level is a published promise. Reading it as the ' +
		'stronger or weaker claim is a security change, not a copy fix.',
	character:
		'The character is the row under test: dropping it, folding it to ' +
		'ASCII, or letting the font substitute it changes the words.',
} as const;

export const GLYPH_HEADING_FIXTURES: readonly GlyphLocaleFixture[] = [
	{
		locale: 'fr',
		lang: 'fr-FR',
		typography: [
			{
				id: 'fr-narrow-space',
				claim: 'French groups digits with U+202F NARROW NO-BREAK SPACE.',
				note:
					'Same magnitude as the other rows, a different code point from the Russian ' +
					"row's U+00A0 and from the German row's U+002E. Folding that space to U+0020 " +
					'turns a line break into a legal one at the wrong place.',
			},
			{
				id: 'fr-guillemets',
				claim: 'Guillemets take the same narrow space inside them.',
				note:
					'U+00AB … U+00BB with U+202F on both inner edges, which is why the rendered ' +
					'line looks like it has a leading space.',
			},
			{
				id: 'fr-precomposed',
				claim: 'French accents are precomposed single code points.',
				note:
					'U+00E9 is one code point; the decomposed row below is the same word in two. ' +
					'Both must render identically and both must keep their own bytes.',
			},
		],
		samples: [
			{
				id: 'fr-accent-nfc',
				locale: 'fr',
				lang: 'fr-FR',
				focus: 'accent',
				tier: 'heading',
				heading: '\u00C9tude \u00E0 Paris\u202F: 1\u202F234,56 \u20AC \u2014 ne pas modifier',
				// Étude à Paris : 1 234,56 € — ne pas modifier
				form: 'NFC',
				probe: ['U+00C9', 'U+00E0', 'U+202F', 'U+20AC', 'U+2014'],
				guards: [
					{
						id: 'fr-accent-e',
						kind: 'character',
						token: '\u00C9',
						note: GUARD_NOTES.character,
					},
					{
						id: 'fr-number',
						kind: 'number',
						token: '1\u202F234,56',
						note: GUARD_NOTES.number,
					},
					{
						id: 'fr-negation',
						kind: 'negation',
						token: 'ne pas modifier',
						note: GUARD_NOTES.negation,
					},
				],
				note:
					'Precomposed accents plus the two French spacing rules in one line: the ' +
					'narrow no-break space before the high colon and inside the digit group.',
			},
			{
				id: 'fr-cafe-nfc',
				locale: 'fr',
				lang: 'fr-FR',
				focus: 'accent',
				tier: 'heading',
				heading: 'Caf\u00E9 typographique (NFC)',
				// Café typographique (NFC)
				form: 'NFC',
				probe: ['U+00E9'],
				canonicalGroup: 'fr-cafe',
				word: 'Caf\u00E9',
				guards: [
					{
						id: 'fr-cafe-nfc-accent',
						kind: 'character',
						token: '\u00E9',
						note: GUARD_NOTES.character,
					},
				],
				note: 'The precomposed half of the pair. Same word, one code point for the accent.',
			},
			{
				id: 'fr-cafe-nfd',
				locale: 'fr',
				lang: 'fr-FR',
				focus: 'combining',
				tier: 'heading',
				heading: 'Cafe\u0301 typographique (NFD)',
				// Café typographique (NFD) — "e" + U+0301
				form: 'NFD',
				probe: ['U+0301'],
				canonicalGroup: 'fr-cafe',
				word: 'Cafe\u0301',
				guards: [
					{
						id: 'fr-cafe-nfd-mark',
						kind: 'character',
						token: 'Cafe\u0301',
						note:
							'The base letter and its combining acute are TWO code points. The ' +
							'fixture stores them as two so a normalising pipeline cannot collapse ' +
							'this row into its NFC twin.',
					},
				],
				note:
					'The decomposed half of the pair. Renders identically to fr-cafe-nfc; ' +
					'copy/paste must hand back the two code points, not one.',
			},
			{
				id: 'fr-typography',
				locale: 'fr',
				lang: 'fr-FR',
				focus: 'typography',
				tier: 'body',
				heading: '\u00AB\u202Flecture\u202Fseule\u202F\u00BB \u2014 ne pas traduire',
				// « lecture seule » — ne pas traduire
				form: 'NFC',
				probe: ['U+00AB', 'U+00BB', 'U+202F', 'U+2014'],
				guards: [
					{
						id: 'fr-permission',
						kind: 'permission',
						token: 'lecture\u202Fseule',
						note: GUARD_NOTES.permission,
					},
					{
						id: 'fr-negation-2',
						kind: 'negation',
						token: 'ne pas traduire',
						note: GUARD_NOTES.negation,
					},
					{
						id: 'fr-guillemets',
						kind: 'character',
						token: '\u00AB\u202Flecture\u202Fseule\u202F\u00BB',
						note:
							'The quoted span includes its inner spaces. Rendering it with plain ' +
							'spaces is a typography change; rendering it without the quotation ' +
							'marks would change who is speaking.',
					},
				],
				note:
					'Quotation and permission in one row. The guillemets plus narrow spaces are ' +
					'the locale\u2019s convention; the words inside them are the claim.',
			},
			{
				id: 'fr-ligature',
				locale: 'fr',
				lang: 'fr-FR',
				focus: 'ligature',
				tier: 'heading',
				heading: '\uFB01n de ligne \u2014 \u0153uf, c\u0153ur',
				// fin de ligne — œuf, cœur
				form: 'NFC',
				probe: ['U+FB01', 'U+0153', 'U+2014'],
				guards: [
					{
						id: 'fr-oe',
						kind: 'character',
						token: '\u0153',
						note:
							'U+0153 is a LETTER of the French alphabet, not a presentation form. A ' +
							'compatibility fold leaves it alone, and the platform keeps it.',
					},
					{
						id: 'fr-fi-ligature',
						kind: 'character',
						token: '\uFB01',
						note:
							'U+FB01 is a PRESENTATION form: the font may draw one ligature glyph ' +
							'for it or none at all. Either way the code point in the document must ' +
							'stay U+FB01 — the glyph is typography, the code point is the text.',
					},
				],
				note:
					'Two different kinds of "one shape" in one row: a real ligature letter and a ' +
					'presentation ligature the webfont may not carry.',
			},
		],
	},
	{
		locale: 'de',
		lang: 'de-DE',
		typography: [
			{
				id: 'de-period-group',
				claim: 'German groups digits with a full stop and writes a decimal comma.',
				note:
					'U+002E as the group separator is the same idea as the French narrow space, ' +
					'with a different code point and no line-break risk at all.',
			},
			{
				id: 'de-quotes',
				claim: 'German quotes are „ … “ (U+201E, U+201C).',
				note:
					'A different pair from the French guillemets and the Portuguese curly quotes. ' +
					'Which pair a sentence uses is an editorial decision; that the renderer shows ' +
					'the pair it was given is not.',
			},
			{
				id: 'de-sharp-s',
				claim: 'ß is a letter, and stays ß.',
				note:
					'No Unicode fold rewrites U+00DF, so the platform keeps it. A proofreading ' +
					'tool that "corrects" ß to ss changes the author\u2019s word — see §5.',
			},
		],
		samples: [
			{
				id: 'de-gruesse-nfc',
				locale: 'de',
				lang: 'de-DE',
				focus: 'accent',
				tier: 'heading',
				heading: 'Gr\u00FC\u00DFe Ausgabe (NFC)',
				// Grüße Ausgabe (NFC)
				form: 'NFC',
				probe: ['U+00FC', 'U+00DF'],
				canonicalGroup: 'de-gruesse',
				word: 'Gr\u00FC\u00DFe',
				guards: [
					{
						id: 'de-u-umlaut-nfc',
						kind: 'character',
						token: '\u00FC',
						note: GUARD_NOTES.character,
					},
					{ id: 'de-sharp-s-nfc', kind: 'character', token: '\u00DF', note: GUARD_NOTES.character },
				],
				note:
					'The precomposed half of the pair: one code point for the umlauted u, and the ' +
					'sharp s that needs no mark of its own.',
			},
			{
				id: 'de-gruesse-nfd',
				locale: 'de',
				lang: 'de-DE',
				focus: 'combining',
				tier: 'heading',
				heading: 'Gru\u0308\u00DFe Ausgabe (NFD)',
				// Grüße Ausgabe (NFD) — u + U+0308, then ß
				form: 'NFD',
				probe: ['U+0308', 'U+00DF'],
				canonicalGroup: 'de-gruesse',
				word: 'Gru\u0308\u00DFe',
				guards: [
					{
						id: 'de-diaeresis',
						kind: 'character',
						token: 'u\u0308',
						note:
							'TWO code points for one glyph: u + COMBINING DIAERESIS. The mark has ' +
							'zero advance of its own, so it has to be shaped by whatever face ' +
							'renders the base letter.',
					},
					{ id: 'de-sharp-s-nfd', kind: 'character', token: '\u00DF', note: GUARD_NOTES.character },
				],
				note:
					'The decomposed half of the pair, next to a precomposed ß in the same row: ' +
					'the file is genuinely mixed, and the platform does not tidy it.',
			},
			{
				id: 'de-umlaut',
				locale: 'de',
				lang: 'de-DE',
				focus: 'accent',
				tier: 'heading',
				heading:
					'Gr\u00F6\u00DFe, \u00D6l und Fu\u00DFg\u00E4nger \u2014 1.234,56 \u20AC (nur lesen)',
				// Größe, Öl und Fußgänger — 1.234,56 € (nur lesen)
				form: 'NFC',
				probe: ['U+00F6', 'U+00D6', 'U+00E4', 'U+00DF', 'U+20AC', 'U+2014'],
				guards: [
					{ id: 'de-o-umlaut', kind: 'character', token: '\u00F6', note: GUARD_NOTES.character },
					{ id: 'de-sharp-s', kind: 'character', token: '\u00DF', note: GUARD_NOTES.character },
					{ id: 'de-number', kind: 'number', token: '1.234,56', note: GUARD_NOTES.number },
					{
						id: 'de-permission',
						kind: 'permission',
						token: 'nur lesen',
						note: GUARD_NOTES.permission,
					},
				],
				note:
					'Four umlauts, two ß, one grouped number, one permission. The permission ' +
					'word is the load-bearing part: "nur lesen" must not be shortened to "lesen".',
			},
			{
				id: 'de-typography',
				locale: 'de',
				lang: 'de-DE',
				focus: 'typography',
				tier: 'body',
				heading: '\u201EStra\u00DFe\u201C \u2013 nicht \u00FCbersetzen',
				// „Straße“ – nicht übersetzen
				form: 'NFC',
				probe: ['U+201E', 'U+201C', 'U+2013', 'U+00FC', 'U+00DF'],
				guards: [
					{ id: 'de-quote-open', kind: 'character', token: '\u201E', note: GUARD_NOTES.character },
					{
						id: 'de-sharp-s-quoted',
						kind: 'character',
						token: '\u00DF',
						note: GUARD_NOTES.character,
					},
					{
						id: 'de-negation',
						kind: 'negation',
						token: 'nicht \u00FCbersetzen',
						note: GUARD_NOTES.negation,
					},
				],
				note:
					'The German quote pair and an en dash. The negation sits inside the quoted ' +
					'span, which is exactly the kind of place a proofreading pass can quietly ' +
					'edit without changing the character count much.',
			},
		],
	},
	{
		locale: 'pt',
		lang: 'pt-BR',
		typography: [
			{
				id: 'pt-tilde',
				claim: 'Portuguese marks are precomposed: ã, õ, ç are one code point each.',
				note:
					'U+00E3 / U+00F5 / U+00E7 are the NFC spelling. The decomposed row below is ' +
					'what the same word looks like after a legacy encoder touched it.',
			},
			{
				id: 'pt-quotes',
				claim: 'Portuguese quotes are “ … ” (U+201C, U+201D).',
				note: 'A third quotation convention in this fixture: guillemets, German quotes, curly quotes.',
			},
			{
				id: 'pt-number',
				claim: 'pt-BR groups digits with a full stop and writes a decimal comma.',
				note: 'Identical to the German row — which is why the fixture asserts the substring, not the habit.',
			},
		],
		samples: [
			{
				id: 'pt-tilde-nfc',
				locale: 'pt',
				lang: 'pt-BR',
				focus: 'accent',
				tier: 'heading',
				heading:
					'A\u00E7\u00E3o, cora\u00E7\u00E3o e informa\u00E7\u00F5es \u2014 1.234,56 (somente leitura)',
				// Ação, coração e informações — 1.234,56 (somente leitura)
				form: 'NFC',
				probe: ['U+00E7', 'U+00E3', 'U+00F5', 'U+2014'],
				guards: [
					{ id: 'pt-cedilla', kind: 'character', token: '\u00E7', note: GUARD_NOTES.character },
					{ id: 'pt-tilde-a', kind: 'character', token: '\u00E3', note: GUARD_NOTES.character },
					{ id: 'pt-number', kind: 'number', token: '1.234,56', note: GUARD_NOTES.number },
					{
						id: 'pt-permission',
						kind: 'permission',
						token: 'somente leitura',
						note: GUARD_NOTES.permission,
					},
				],
				note: 'The precomposed half of the pair: three marked letters in one line.',
			},
			{
				id: 'pt-coracao-nfc',
				locale: 'pt',
				lang: 'pt-BR',
				focus: 'accent',
				tier: 'heading',
				heading: 'cora\u00E7\u00E3o (NFC)',
				// coração (NFC)
				form: 'NFC',
				probe: ['U+00E7', 'U+00E3'],
				canonicalGroup: 'pt-coracao',
				word: 'cora\u00E7\u00E3o',
				guards: [
					{ id: 'pt-cedilla-nfc', kind: 'character', token: '\u00E7', note: GUARD_NOTES.character },
					{ id: 'pt-tilde-nfc', kind: 'character', token: '\u00E3', note: GUARD_NOTES.character },
				],
				note: 'The precomposed half of the pair: one code point for each mark.',
			},
			{
				id: 'pt-coracao-nfd',
				locale: 'pt',
				lang: 'pt-BR',
				focus: 'combining',
				tier: 'heading',
				heading: 'corac\u0327a\u0303o (NFD)',
				// coração (NFD) — c + U+0327, a + U+0303
				form: 'NFD',
				probe: ['U+0327', 'U+0303'],
				canonicalGroup: 'pt-coracao',
				word: 'corac\u0327a\u0303o',
				guards: [
					{
						id: 'pt-cedilla-mark',
						kind: 'character',
						token: 'c\u0327',
						note:
							'The cedilla is a COMBINING mark (U+0327) here, not the precomposed ' +
							'U+00E7 of the row above. Two code points, one glyph.',
					},
					{
						id: 'pt-tilde-mark',
						kind: 'character',
						token: 'a\u0303',
						note: 'A tilde that is a mark below the cap line, so it can collide with the row underneath.',
					},
				],
				note:
					'The decomposed half of the pair, and the densest combining-mark row in the ' +
					'fixture: a mark under a letter and a mark above it, two code units apart in ' +
					'the buffer and one glyph on screen.',
			},
			{
				id: 'pt-typography',
				locale: 'pt',
				lang: 'pt-BR',
				focus: 'typography',
				tier: 'body',
				heading: '\u201CFrases com travess\u00E3o \u2014 n\u00E3o\u201D',
				// “Frases com travessão — não”
				form: 'NFC',
				probe: ['U+201C', 'U+201D', 'U+00E3', 'U+2014'],
				guards: [
					{ id: 'pt-quote-pair', kind: 'character', token: '\u201C', note: GUARD_NOTES.character },
					{ id: 'pt-negation', kind: 'negation', token: 'n\u00E3o', note: GUARD_NOTES.negation },
				],
				note:
					'The negation sits at the end of the sentence, where a line break or a ' +
					'truncation could hide it. Rendered last on purpose.',
			},
		],
	},
	{
		locale: 'ru',
		lang: 'ru-RU',
		typography: [
			{
				id: 'ru-nbsp-group',
				claim: 'Russian groups digits with U+00A0 NO-BREAK SPACE.',
				note:
					'A THIRD space code point for the same magnitude, next to the French narrow ' +
					'space and the German full stop. The image of the three rows is the evidence ' +
					'that grouping is locale data.',
			},
			{
				id: 'ru-guillemets-nbsp',
				claim: 'Russian guillemets take a no-break space inside them.',
				note: 'U+00AB + U+00A0 … U+00A0 + U+00BB — visually close to the French row, a different code point.',
			},
			{
				id: 'ru-webfont',
				claim: 'The shipped heading webfont ships a cyrillic subset.',
				note:
					'Whether the browser actually uses it for a given letter is measured, not ' +
					'assumed — see the coverage report.',
			},
		],
		samples: [
			{
				id: 'ru-yogi-nfc',
				locale: 'ru',
				lang: 'ru-RU',
				focus: 'cyrillic',
				tier: 'heading',
				heading:
					'\u0419\u043E\u0433\u0438 \u0438 \u0451\u0436\u0438 \u2014 \u0441\u044A\u0451\u043C\u043A\u0430 1\u00A0234,56 \u20BD (\u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u0447\u0442\u0435\u043D\u0438\u044F, \u043D\u0435 \u043F\u0435\u0440\u0435\u0432\u043E\u0434\u0438\u0442\u044C)',
				// Йоги и ёжи — съёмка 1 234,56 ₽ (только для чтения, не переводить)
				form: 'NFC',
				probe: ['U+0419', 'U+0438', 'U+0451', 'U+00A0', 'U+20BD', 'U+2014'],
				canonicalGroup: 'ru-yogi',
				word: '\u0419\u043E\u0433\u0438',
				guards: [
					{ id: 'ru-cyrillic-i', kind: 'character', token: '\u0419', note: GUARD_NOTES.character },
					{ id: 'ru-yo', kind: 'character', token: '\u0451', note: GUARD_NOTES.character },
					{ id: 'ru-number', kind: 'number', token: '1\u00A0234,56', note: GUARD_NOTES.number },
					{
						id: 'ru-permission',
						kind: 'permission',
						token:
							'\u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u0447\u0442\u0435\u043D\u0438\u044F',
						note: GUARD_NOTES.permission,
					},
					{
						id: 'ru-negation',
						kind: 'negation',
						token: '\u043D\u0435 \u043F\u0435\u0440\u0435\u0432\u043E\u0434\u0438\u0442\u044C',
						note: GUARD_NOTES.negation,
					},
				],
				note:
					'Every Russian guard in one row: Cyrillic letters, the no-break-space digit ' +
					'group, the permission and the negation. A transliteration that mapped Cyrillic ' +
					'to Latin would keep the shape of the sentence and change every word in it.',
			},
			{
				id: 'ru-yogi-nfd',
				locale: 'ru',
				lang: 'ru-RU',
				focus: 'combining',
				tier: 'heading',
				heading: '\u0418\u0306\u043E\u0433\u0438 \u0438 \u0451\u0436\u0438 (NFD)',
				// Йоги и ёжи (NFD) — И + U+0306, then a precomposed ё
				form: 'mixed',
				probe: ['U+0418', 'U+0306', 'U+0451'],
				canonicalGroup: 'ru-yogi',
				word: '\u0418\u0306\u043E\u0433\u0438',
				guards: [
					{
						id: 'ru-breve',
						kind: 'character',
						token: '\u0418\u0306',
						note:
							'CYRILLIC CAPITAL I + COMBINING BREVE. The breve sits above a capital ' +
							'that already has a flat top, which is where a mismatched fallback face ' +
							'becomes visible.',
					},
					{ id: 'ru-yo-nfd', kind: 'character', token: '\u0451', note: GUARD_NOTES.character },
				],
				note:
					'Decomposed Й next to a PRECOMPOSED ё in the same row, so the string is ' +
					'neither NFC nor NFD as a whole. That mixed state is the author\u2019s, and the ' +
					'platform keeps it: normalising it would be a copy change with no reviewer.',
			},
			{
				id: 'ru-typography',
				locale: 'ru',
				lang: 'ru-RU',
				focus: 'typography',
				tier: 'body',
				heading:
					'\u00AB\u00A0\u0419\u043E\u0433\u0438\u00A0\u00BB \u2014 \u0440\u0430\u0437\u0434\u0435\u043B\u0438\u0442\u044C \u043D\u0430 \u0434\u0432\u0430 \u0441\u043B\u043E\u0432\u0430',
				// « Йоги » — разделить на два слова
				form: 'NFC',
				probe: ['U+00AB', 'U+00BB', 'U+00A0', 'U+2014'],
				guards: [
					{
						id: 'ru-guillemets',
						kind: 'character',
						token: '\u00AB\u00A0\u0419\u043E\u0433\u0438\u00A0\u00BB',
						note:
							'Guillemets plus the no-break spaces on their inner edges. The Russian ' +
							'space is U+00A0, the French one in the row above is U+202F.',
					},
				],
				note:
					'The punctuation row: quotes, spaces and an em dash. Nothing here is a claim, ' +
					'which is the point — it is typography, and it is measured as typography.',
			},
		],
	},
];

/** Every sample in table order. */
export function glyphSamples(): readonly GlyphHeadingSample[] {
	return GLYPH_HEADING_FIXTURES.flatMap((fixture) => fixture.samples);
}

/** Sample ids, in table order. */
export function glyphSampleIds(): readonly string[] {
	return glyphSamples().map((sample) => sample.id);
}

/** Look one sample up by id. */
export function glyphSampleById(id: string): GlyphHeadingSample | undefined {
	return glyphSamples().find((sample) => sample.id === id);
}

/** One code point the coverage probe has to measure. */
export interface GlyphCodePointUsage {
	/** `U+XXXX` style identifier. */
	readonly hex: string;
	readonly codePoint: number;
	/** The character itself — a combining mark is a character on its own. */
	readonly char: string;
	/**
	 * The samples it appears in, once each, in table order.
	 *
	 * A ROW, not an occurrence: a code point repeated five times inside
	 * one heading is still one sample, because the consumers of this
	 * list (the report's rows column, a coverage count) count rows.
	 */
	readonly sampleIds: readonly string[];
	/** Scripts / classes the code point belongs to, as the fixture claims them. */
	readonly focuses: readonly GlyphFocus[];
	/**
	 * The tiers its samples render with, in table order.
	 *
	 * The measurement reads this to decide which stack owns the code
	 * point: `['body']` means only the body stack ever draws it, so only
	 * the body stack's `.notdef` can call it missing.
	 */
	readonly tiers: readonly GlyphTier[];
	/** True when the character is a combining mark (zero advance of its own). */
	readonly combining: boolean;
}

/**
 * Every non-ASCII code point any sample carries, de-duplicated and
 * sorted, with the samples it appears in.
 *
 * This is the probe's work list: the capture measures each of these
 * once, and the report attributes the result back to the rows that
 * need it. ASCII is excluded on purpose — the platform's Latin
 * coverage is not what this Issue is about, and a 95-row table of
 * "renders fine" would bury the four rows that do not.
 */
export function glyphCodePointUsage(): readonly GlyphCodePointUsage[] {
	const usage = new Map<
		number,
		{ sampleIds: string[]; focuses: Set<GlyphFocus>; tiers: Set<GlyphTier> }
	>();
	for (const sample of glyphSamples()) {
		for (const character of sample.heading) {
			const codePoint = character.codePointAt(0);
			if (codePoint === undefined || codePoint <= 0x7f) continue;
			const entry = usage.get(codePoint) ?? {
				sampleIds: [],
				focuses: new Set<GlyphFocus>(),
				tiers: new Set<GlyphTier>(),
			};
			// Table order, one entry per ROW: the same letter appearing
			// three times in one heading is one sample, and a list of
			// occurrences would make every row count a row over.
			if (!entry.sampleIds.includes(sample.id)) entry.sampleIds.push(sample.id);
			entry.focuses.add(sample.focus);
			entry.tiers.add(sample.tier);
			usage.set(codePoint, entry);
		}
	}
	return [...usage.entries()]
		.sort(([a], [b]) => a - b)
		.map(([codePoint, entry]) => {
			const hex = `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
			return {
				hex,
				codePoint,
				char: String.fromCodePoint(codePoint),
				sampleIds: entry.sampleIds,
				focuses: [...entry.focuses],
				tiers: [...entry.tiers],
				// Combining marks live in the Mn block; the platform's own
				// curated table is the authority for names, so this is a
				// range check rather than a second name table.
				combining:
					(codePoint >= 0x0300 && codePoint <= 0x036f) ||
					(codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
					(codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
					(codePoint >= 0x20d0 && codePoint <= 0x20f0),
			};
		});
}

/**
 * The code points each sample must contain, in code point order.
 *
 * Derived from the sample text rather than from `probe`, so the
 * report can show what a row actually carries next to what it
 * claims to carry.
 */
export function glyphSampleCodePoints(sample: GlyphHeadingSample): readonly string[] {
	return [...new Set([...sample.heading].map((character) => character.codePointAt(0) ?? 0))]
		.filter((codePoint) => codePoint > 0x7f)
		.sort((a, b) => a - b)
		.map((codePoint) => `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`);
}
