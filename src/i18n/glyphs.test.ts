import { describe, expect, it } from 'vitest';
import {
	GLYPH_HEADING_FIXTURES,
	GLYPH_LOCALES,
	type GlyphHeadingSample,
	glyphCodePointUsage,
	glyphSampleById,
	glyphSampleCodePoints,
	glyphSampleIds,
	glyphSamples,
} from './glyphs.fixture';
import { describeUnicode, findCompatibilityFoldChanges } from './unicode';

/**
 * Contract tests for the heading-glyph fixture (Issue #432).
 *
 * What is asserted here is the half of the Issue that does not need a
 * browser: the fixture's bytes, its claims, and the four properties
 * that must survive any pipeline that touches it - the value, the
 * negation, the permission, and the author's code points.
 *
 * The rendering half (does the shipped font stack have a glyph for
 * these code points, and does copy/paste hand them back) needs a
 * browser and lives in `scripts/capture-glyph-coverage.mjs`; see
 * `docs/verification/i18n/diacritic-cyrillic-font.md`. Splitting it
 * this way is deliberate: a measurement that cannot run in CI is not
 * a gate, and a gate that needs a network fetch is not a gate either.
 */

/** Group separator each locale writes for the same magnitude. */
const GROUP_SEPARATORS = {
	fr: '\u202F', // NARROW NO-BREAK SPACE
	de: '.', // FULL STOP
	pt: '.', // FULL STOP
	ru: '\u00A0', // NO-BREAK SPACE
} as const;

/**
 * Guards whose token a compatibility fold WOULD change.
 *
 * Four of them are a non-breaking space: U+202F and U+00A0 both fold
 * to U+0020 under NFKC. That is the §5 split in miniature — folding
 * changes no letter, so the fold "looks safe", while it changes where
 * the line may break. The fifth is the presentation ligature U+FB01,
 * which folds to two ASCII letters. The list is pinned so a new
 * foldable guard has to be added here on purpose, with the reason,
 * instead of arriving by accident.
 *
 * `ru-guillemets` is deliberately NOT here: Russian sets guillemets
 * tight against the word, so that guard holds no space code point for
 * a compatibility fold to rewrite.
 */
const FOLD_AFFECTED_GUARDS = [
	'fr-fi-ligature',
	'fr-guillemets',
	'fr-number',
	'fr-permission',
	'ru-number',
];

/**
 * Every guard token, pinned HERE rather than only in the fixture.
 *
 * `keeps every guard token inside its own heading` can only catch an
 * edit to ONE side of the pair: guard and heading live in the same
 * literal, so a "correction" that rewrote both — a U+202F turned into a
 * plain space in the row AND in the guard — would pass every other
 * assertion. Pinning the bytes outside the fixture file is what makes
 * the domain document's "a proofread that touches a guard fails the
 * suite" claim a fact instead of a self-consistency check: the change
 * then has to be made in two files, and a reviewer sees both.
 *
 * Escapes, like the fixture. No non-ASCII literal appears in a source
 * file unless a policy asks for it.
 */
const EXPECTED_GUARD_TOKENS: Record<string, string> = {
	// fr
	'fr-accent-e': '\u00C9',
	'fr-cafe-nfc-accent': '\u00E9',
	'fr-cafe-nfd-mark': 'Cafe\u0301',
	'fr-fi-ligature': '\uFB01',
	'fr-guillemets': '\u00AB\u202Flecture\u202Fseule\u202F\u00BB',
	'fr-negation': 'ne pas modifier',
	'fr-negation-2': 'ne pas traduire',
	'fr-number': '1\u202F234,56',
	'fr-oe': '\u0153',
	'fr-permission': 'lecture\u202Fseule',
	// de
	'de-diaeresis': 'u\u0308',
	'de-negation': 'nicht \u00FCbersetzen',
	'de-number': '1.234,56',
	'de-o-umlaut': '\u00F6',
	'de-permission': 'nur lesen',
	'de-quote-open': '\u201E',
	'de-sharp-s': '\u00DF',
	'de-sharp-s-nfc': '\u00DF',
	'de-sharp-s-nfd': '\u00DF',
	'de-sharp-s-quoted': '\u00DF',
	'de-u-umlaut-nfc': '\u00FC',
	// pt
	'pt-cedilla': '\u00E7',
	'pt-cedilla-mark': 'c\u0327',
	'pt-cedilla-nfc': '\u00E7',
	'pt-negation': 'n\u00E3o',
	'pt-number': '1.234,56',
	'pt-permission': 'somente leitura',
	'pt-quote-pair': '\u201C',
	'pt-tilde-a': '\u00E3',
	'pt-tilde-mark': 'a\u0303',
	'pt-tilde-nfc': '\u00E3',
	// ru
	'ru-breve': '\u0418\u0306',
	'ru-cyrillic-i': '\u0419',
	'ru-guillemets': '\u00AB\u0419\u043E\u0433\u0438\u00BB',
	'ru-negation': '\u043D\u0435 \u043F\u0435\u0440\u0435\u0432\u043E\u0434\u0438\u0442\u044C',
	'ru-number': '1\u00A0234,56',
	'ru-permission':
		'\u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u0447\u0442\u0435\u043D\u0438\u044F',
	'ru-yo': '\u0451',
	'ru-yo-nfd': '\u0451',
};

/** HTML escaping, the way the report and any SSR renderer does it. */
function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

/** The inverse, in the same order the escaping applied. */
function unescapeHtml(value: string): string {
	return value
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&quot;', '"')
		.replaceAll('&amp;', '&');
}

/**
 * The word a canonical sample demonstrates, in its own spelling.
 *
 * A canonical pair is two ROWS and a row is a sentence, so the test
 * compares the declared `word` rather than guessing where the shared
 * word ends inside it.
 */
function declaredWord(sample: GlyphHeadingSample): string {
	if (!sample.canonicalGroup) return sample.heading;
	if (!sample.word)
		throw new Error(`${sample.id} is in a canonical group without declaring a word`);
	expect(sample.heading.includes(sample.word), sample.id).toBe(true);
	return sample.word;
}

describe('glyph fixture - locales and opt-in', () => {
	it('covers exactly the four locales the Issue names', () => {
		expect(GLYPH_LOCALES).toEqual(['fr', 'de', 'pt', 'ru']);
		expect(GLYPH_HEADING_FIXTURES.map((fixture) => fixture.locale)).toEqual([...GLYPH_LOCALES]);
	});

	it('names an explicit BCP-47 tag per locale, and never an implicit one', () => {
		const tags = GLYPH_HEADING_FIXTURES.map((fixture) => fixture.lang);
		expect(new Set(tags).size).toBe(tags.length);
		for (const fixture of GLYPH_HEADING_FIXTURES) {
			expect(fixture.lang).toMatch(new RegExp(`^${fixture.locale}-[A-Z]{2}$`));
			for (const sample of fixture.samples) {
				expect(sample.lang).toBe(fixture.lang);
			}
		}
	});

	it('declares no font of its own - the stack belongs to the editorial tokens', () => {
		for (const sample of glyphSamples()) {
			expect(['heading', 'body']).toContain(sample.tier);
			const forbidden = ['font', 'fontFamily', 'font-family', 'stack', 'family'];
			expect(Object.keys(sample).filter((key) => forbidden.includes(key))).toEqual([]);
		}
	});

	it('gives every locale a typography note and unique note ids', () => {
		const noteIds: string[] = [];
		for (const fixture of GLYPH_HEADING_FIXTURES) {
			expect(fixture.typography.length).toBeGreaterThan(0);
			noteIds.push(...fixture.typography.map((note) => note.id));
		}
		expect(new Set(noteIds).size).toBe(noteIds.length);
	});

	it('keeps sample ids unique and stable across lookups', () => {
		const ids = glyphSampleIds();
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(glyphSampleById(id)?.id).toBe(id);
		expect(glyphSampleById('does-not-exist')).toBeUndefined();
	});
});

describe('glyph fixture - the four claims that must survive', () => {
	it('keeps every guard token inside its own heading, byte-exact', () => {
		for (const sample of glyphSamples()) {
			for (const guard of sample.guards) {
				expect(sample.heading.includes(guard.token), `${sample.id} / ${guard.id}`).toBe(true);
			}
		}
	});

	it('pins every guard token outside the fixture, byte-exact', () => {
		const guards = glyphSamples().flatMap((sample) => sample.guards);
		const ids = guards.map((guard) => guard.id);
		expect(new Set(ids).size, 'guard ids must be unique').toBe(ids.length);
		expect([...ids].sort()).toEqual(Object.keys(EXPECTED_GUARD_TOKENS).sort());
		for (const guard of guards) {
			expect(guard.token, guard.id).toBe(EXPECTED_GUARD_TOKENS[guard.id]);
		}
	});

	it('exercises a number, a negation and a permission in EVERY locale', () => {
		for (const fixture of GLYPH_HEADING_FIXTURES) {
			const kinds = new Set(fixture.samples.flatMap((sample) => sample.guards.map((g) => g.kind)));
			for (const kind of ['number', 'negation', 'permission'] as const) {
				expect(kinds.has(kind), `${fixture.locale} has no ${kind} guard`).toBe(true);
			}
		}
	});

	it('groups the same magnitude with a different separator per locale', () => {
		for (const fixture of GLYPH_HEADING_FIXTURES) {
			const separators = fixture.samples
				.flatMap((sample) => sample.guards.filter((guard) => guard.kind === 'number'))
				.map((guard) => guard.token.replace(/[\d,]+/g, ''))
				.filter((separator) => separator.length > 0);
			expect(separators, fixture.locale).not.toEqual([]);
			for (const separator of separators) {
				expect(separator).toBe(GROUP_SEPARATORS[fixture.locale]);
			}
		}
	});

	it('names exactly the guards a compatibility fold would change', () => {
		const affected = glyphSamples()
			.flatMap((sample) => sample.guards)
			.filter((guard) => findCompatibilityFoldChanges(guard.token).length > 0)
			.map((guard) => guard.id)
			.sort();
		expect(affected).toEqual([...FOLD_AFFECTED_GUARDS].sort());
	});

	it('keeps ß a letter: no Unicode fold rewrites it', () => {
		// The German sharp s is the case a proofreading tool is most
		// likely to "fix" into "ss". That is a copy change, so the
		// platform neither does nor permits it - and the fixture holds
		// the character so a reviewer can see that the guard is real.
		expect(findCompatibilityFoldChanges('Gro\u00DFe')).toEqual([]);
		for (const sample of glyphSamples()) {
			if (!sample.heading.includes('\u00DF')) continue;
			expect(sample.guards.some((guard) => guard.token.includes('\u00DF'))).toBe(true);
		}
	});
});

describe('glyph fixture - authored forms and code points', () => {
	it('keeps each row in the normalization form it claims', () => {
		for (const sample of glyphSamples()) {
			const facts = describeUnicode(sample.heading);
			const observed = facts.form === 'none' ? 'mixed' : facts.form;
			expect(observed, sample.id).toBe(sample.form);
		}
	});

	it('keeps the NFC and NFD twins of a word distinct in every canonical group', () => {
		const groups = new Map<string, GlyphHeadingSample[]>();
		for (const sample of glyphSamples()) {
			if (!sample.canonicalGroup) continue;
			const bucket = groups.get(sample.canonicalGroup) ?? [];
			bucket.push(sample);
			groups.set(sample.canonicalGroup, bucket);
		}
		expect(groups.size).toBeGreaterThan(0);
		for (const [group, twins] of groups) {
			expect(twins.length, group).toBe(2);
			const [first, second] = twins;
			// One word, two spellings: the same comparison key, different bytes.
			expect(describeUnicode(declaredWord(first)).foldKey).toBe(
				describeUnicode(declaredWord(second)).foldKey,
			);
			expect(declaredWord(first)).not.toBe(declaredWord(second));
			expect(declaredWord(first).length).not.toBe(declaredWord(second).length);
			// The WORD carries the spelling; the ROW around it may be mixed
			// (the Russian NFD row also contains a precomposed ё), which is
			// why the form is asserted on the word and not on the heading.
			const wordForms = twins.map((sample) => describeUnicode(declaredWord(sample)));
			expect(wordForms.filter((facts) => facts.isNfc)).toHaveLength(1);
			expect(wordForms.filter((facts) => facts.isNfd)).toHaveLength(1);
		}
	});

	it('lists the non-ASCII code points each row claims, and only those', () => {
		for (const sample of glyphSamples()) {
			const actual = glyphSampleCodePoints(sample);
			for (const claimed of sample.probe) {
				expect(claimed, `${sample.id} claims ${claimed}`).toMatch(/^U\+[0-9A-F]{4,6}$/);
				expect(actual, `${sample.id} is missing ${claimed}`).toContain(claimed);
			}
			expect([...sample.probe].sort()).toEqual([...new Set(sample.probe)].sort());
		}
	});

	it('derives the probe work list from the fixture itself', () => {
		const usage = glyphCodePointUsage();
		const ids = new Set(glyphSampleIds());
		expect(usage.length).toBeGreaterThan(20);
		let previous = 0;
		for (const entry of usage) {
			expect(entry.codePoint).toBeGreaterThan(0x7f);
			expect(entry.codePoint).toBeGreaterThan(previous);
			previous = entry.codePoint;
			expect(entry.hex).toBe(`U+${entry.codePoint.toString(16).toUpperCase().padStart(4, '0')}`);
			expect(String.fromCodePoint(entry.codePoint)).toBe(entry.char);
			expect(entry.sampleIds.length).toBeGreaterThan(0);
			// A row is a row. A code point repeated five times inside ONE
			// heading is one sample, so the work list must not count
			// occurrences — the report's rows column would repeat the row
			// name and any consumer reading `sampleIds.length` as a row
			// count would be reading a number about nothing.
			expect(new Set(entry.sampleIds).size, entry.hex).toBe(entry.sampleIds.length);
			for (const id of entry.sampleIds) expect(ids.has(id)).toBe(true);
			expect(entry.focuses.length).toBeGreaterThan(0);
		}
		// Every declared probe code point is in the work list. The list
		// itself is derived from the fixture text, so a row can never be
		// measured against a table somebody maintained by hand.
		const measured = new Set(usage.map((entry) => entry.hex));
		for (const sample of glyphSamples()) {
			for (const claimed of sample.probe) expect(measured.has(claimed)).toBe(true);
		}
	});

	it('attributes every code point to the tiers its rows render with', () => {
		const usage = glyphCodePointUsage();
		// The fixture has to exercise BOTH tiers, or a tier-aware
		// measurement has nothing to be tier-aware about.
		expect([...new Set(glyphSamples().map((sample) => sample.tier))].sort()).toEqual([
			'body',
			'heading',
		]);
		for (const entry of usage) {
			const samples = entry.sampleIds.map((id) => {
				const sample = glyphSampleById(id);
				if (!sample) throw new Error(`${entry.hex} names an unknown sample ${id}`);
				return sample;
			});
			expect([...entry.tiers].sort(), entry.hex).toEqual(
				[...new Set(samples.map((sample) => sample.tier))].sort(),
			);
			// One entry per row, and the rows are exactly the ones whose
			// heading carries the character.
			const carrying = glyphSamples().filter((sample) => sample.heading.includes(entry.char));
			expect(entry.sampleIds, entry.hex).toEqual(carrying.map((sample) => sample.id));
		}
		// And at least one code point lives ONLY in body rows: that is the
		// case a heading-stack-only `.notdef` comparison would judge
		// against a stack that never draws it.
		expect(usage.some((entry) => entry.tiers.length === 1 && entry.tiers[0] === 'body')).toBe(true);
	});

	it('flags the combining marks that need a face shaped for the base letter', () => {
		const combining = glyphCodePointUsage().filter((entry) => entry.combining);
		expect(combining.map((entry) => entry.hex)).toEqual([
			'U+0301',
			'U+0303',
			'U+0306',
			'U+0308',
			'U+0327',
		]);
		// Each one belongs to a row that says it is about combining marks.
		for (const entry of combining) {
			expect(entry.focuses).toContain('combining');
		}
	});
});

describe('glyph fixture - copy / paste keeps the bytes', () => {
	it('survives a JSON round trip unchanged', () => {
		for (const sample of glyphSamples()) {
			const round = JSON.parse(JSON.stringify({ heading: sample.heading })) as {
				heading: string;
			};
			expect(round.heading).toBe(sample.heading);
		}
	});

	it('survives HTML escaping and unescaping unchanged', () => {
		for (const sample of glyphSamples()) {
			const escaped = escapeHtml(sample.heading);
			expect(unescapeHtml(escaped)).toBe(sample.heading);
			for (const guard of sample.guards)
				expect(escaped.includes(escapeHtml(guard.token))).toBe(true);
		}
	});

	it('keeps the NFC and NFD twins distinguishable after serialisation', () => {
		// The failure this pins is a pipeline that "helpfully" normalises
		// text on its way to the renderer: the two rows would collapse
		// into one and the decomposed spelling would be gone.
		for (const group of ['fr-cafe', 'de-gruesse', 'pt-coracao'] as const) {
			const twins = glyphSamples().filter((sample) => sample.canonicalGroup === group);
			const escaped = twins.map((sample) => escapeHtml(JSON.stringify(declaredWord(sample))));
			expect(new Set(escaped).size).toBe(2);
		}
	});

	it('round-trips every guard through the same escape + JSON pipeline', () => {
		for (const sample of glyphSamples()) {
			for (const guard of sample.guards) {
				const encoded = escapeHtml(JSON.stringify(guard.token));
				expect(JSON.parse(unescapeHtml(encoded)) as string, `${sample.id} / ${guard.id}`).toBe(
					guard.token,
				);
			}
		}
	});
});
