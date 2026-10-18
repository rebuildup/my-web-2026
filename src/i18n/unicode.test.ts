import { describe, expect, it } from 'vitest';
import {
	assertDisplayTextPreserved,
	describeCodePoint,
	describeUnicode,
	findCompatibilityFoldChanges,
	findNonAscii,
	foldForComparison,
	toCodePointHex,
} from './unicode';

/**
 * Display-text Unicode policy (Issue #433).
 *
 * The contract under test:
 *
 *   1. Nothing rewrites display text. `describeUnicode` reports; the
 *      only fold it produces is the NFC comparison key.
 *   2. NFC and NFD are one word; a compatibility fold is a decision
 *      the platform refuses to take silently, so it is reported.
 */

describe('describeUnicode — normalization form', () => {
	it('reports ASCII text as NFC and never folds it', () => {
		const facts = describeUnicode('Thumbs up');
		expect(facts.form).toBe('NFC');
		expect(facts.isNfc).toBe(true);
		expect(facts.foldKey).toBe('Thumbs up');
		expect(facts.nonAscii).toHaveLength(0);
		expect(facts.changesUnderCompatibilityFold).toBe(false);
	});

	it('reports the precomposed spelling as NFC', () => {
		const facts = describeUnicode('Caf\u00e9 notes');
		expect(facts.form).toBe('NFC');
		expect(facts.codePoints).toBe('Café notes'.length);
	});

	it('reports the decomposed spelling as NFD and folds it to the same key', () => {
		const precomposed = describeUnicode('Caf\u00e9 notes');
		const decomposed = describeUnicode('Cafe\u0301 notes');

		expect(decomposed.form).toBe('NFD');
		expect(decomposed.isNfd).toBe(true);
		// The two spellings are one word for comparison purposes …
		expect(decomposed.foldKey).toBe(precomposed.foldKey);
		// … and two byte sequences for everything else.
		expect(decomposed.text).not.toBe(precomposed.text);
		expect(decomposed.codePoints).toBe(precomposed.codePoints + 1);
	});

	it('keeps the original bytes in `text` whatever the form is', () => {
		const decomposed = 'Cafe\u0301 notes';
		expect(describeUnicode(decomposed).text).toBe(decomposed);
	});
});

describe('findNonAscii — invisible characters count', () => {
	it('finds a precomposed accent', () => {
		expect(findNonAscii('caf\u00e9').map((fact) => fact.hex)).toEqual(['U+00E9']);
	});

	it('finds the combining mark separately from its base letter', () => {
		expect(findNonAscii('cafe\u0301').map((fact) => fact.hex)).toEqual(['U+0301']);
	});

	it('finds a zero-width space that the eye cannot see', () => {
		const facts = findNonAscii('thumbs\u200bup');
		expect(facts).toHaveLength(1);
		expect(facts[0].hex).toBe('U+200B');
		expect(facts[0].index).toBe(6);
		expect(facts[0].label).toBe('ZERO WIDTH SPACE');
	});

	it('walks a surrogate pair as one code point', () => {
		const facts = findNonAscii('a\u{1f44d}');
		expect(facts).toHaveLength(1);
		expect(facts[0].codePoint).toBe(0x1f44d);
		expect(facts[0].hex).toBe('U+1F44D');
		expect(facts[0].index).toBe(1);
	});

	it('returns nothing for an empty or ASCII string', () => {
		expect(findNonAscii('')).toHaveLength(0);
		expect(findNonAscii('ascii-only_123')).toHaveLength(0);
	});
});

describe('findCompatibilityFoldChanges — reporting, never applying', () => {
	it('reports nothing for text a compatibility fold would leave alone', () => {
		expect(findCompatibilityFoldChanges('Caf\u00e9 notes')).toHaveLength(0);
	});

	it('reports the ligature expansion NFKC would perform', () => {
		const changes = findCompatibilityFoldChanges('\ufb01nance');
		expect(changes).toHaveLength(1);
		expect(changes[0].from.hex).toBe('U+FB01');
		expect(changes[0].replacement).toBe('fi');
		expect(changes[0].changesLength).toBe(true);
	});

	it('reports the micro sign → Greek mu substitution as a same-length swap', () => {
		const changes = findCompatibilityFoldChanges('\u00b5m');
		expect(changes).toHaveLength(1);
		expect(changes[0].from.label).toBe('MICRO SIGN');
		// The replacement is for THAT character, not for the whole string.
		expect(changes[0].replacement).toBe('\u03bc');
		expect(changes[0].changesLength).toBe(false);
	});

	it('reports a circled digit as a value change', () => {
		const changes = findCompatibilityFoldChanges('\u2460');
		expect(changes[0].replacement).toBe('1');
	});

	it('does not rewrite the text it was asked about', () => {
		const text = '\ufb01nance';
		findCompatibilityFoldChanges(text);
		expect(text).toBe('\ufb01nance');
	});

	it('leaves a not-equal sign alone (NFKC has no decomposition for it)', () => {
		// The point is not that ≠ is safe — a mark-stripping fold still
		// reverses the claim — but that "compatibility fold risk" and
		// "diacritic stripping risk" are different risks, and the
		// platform refuses both.
		expect(findCompatibilityFoldChanges('N \u2260 3')).toHaveLength(0);
	});
});

describe('foldForComparison', () => {
	it('is NFC and only NFC', () => {
		expect(foldForComparison('cafe\u0301')).toBe('caf\u00e9');
		// A compatibility fold would ALSO have turned the ligature into
		// plain letters; this fold must not.
		expect(foldForComparison('\ufb01nance')).toBe('\ufb01nance');
		expect(foldForComparison('\u00b5m')).toBe('\u00b5m');
	});
});

describe('assertDisplayTextPreserved', () => {
	it('passes identical bytes through and returns them', () => {
		expect(assertDisplayTextPreserved('Caf\u00e9', 'Caf\u00e9', 'title')).toBe('Caf\u00e9');
	});

	it('rejects a re-composed display field', () => {
		const original = 'Cafe\u0301 notes';
		expect(() => assertDisplayTextPreserved(original, 'Caf\u00e9 notes', 'summary')).toThrow(
			/display text for summary was rewritten/,
		);
	});

	it('does not accept a mark-stripped rewrite either', () => {
		expect(() => assertDisplayTextPreserved('Caf\u00e9', 'Cafe', 'title')).toThrow(
			/was rewritten in transit/,
		);
	});

	it('names the field so the row → model mapping is findable', () => {
		expect(() => assertDisplayTextPreserved('a', 'b', 'title')).toThrow(/"a" → "b"/);
	});
});

describe('code point presentation', () => {
	it('pads hex to four digits', () => {
		expect(toCodePointHex(0x7f)).toBe('U+007F');
		expect(toCodePointHex(0x1f44d)).toBe('U+1F44D');
	});

	it('uses the curated label when there is one', () => {
		expect(describeCodePoint(0x00e9)).toBe('U+00E9 LATIN SMALL LETTER E WITH ACUTE');
	});

	it('stays unambiguous for a character the table does not name', () => {
		expect(describeCodePoint(0x4e2d)).toBe('U+4E2D UNNAMED');
	});
});
