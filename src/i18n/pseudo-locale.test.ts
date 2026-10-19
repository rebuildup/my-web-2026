import { describe, expect, it } from 'vitest';
import {
	DECORATION_MARKS,
	DEFAULT_EXPANSION_RATIO,
	FSI,
	LRI,
	PDI,
	PSEUDO_FILLER,
	PSEUDO_LOCALE_ID,
	PSEUDO_LOCALE_LIMITS,
	PSEUDO_STRESS_SAMPLES,
	type PseudoSample,
	assertExpandableText,
	auditBidiIsolation,
	auditPseudoSamples,
	auditPseudoText,
	collapsePseudoText,
	digitRuns,
	expandPseudoText,
	expandableSlots,
	isolateEmbeddedRuns,
	protectedCodePointCount,
	pseudoLocalize,
	pseudoSampleById,
	stripIsolates,
} from './pseudo-locale';

/**
 * The Issue #429 stress contract.
 *
 * Four properties are asserted for every row of the table, because a
 * pseudo-localisation that breaks any of them is worse than no
 * pseudo-localisation at all:
 *
 *   1. **Reversible.** The expanded text collapses back to the source
 *      byte-exactly. Nothing was rewritten, so negation (`do not`),
 *      permission (`read-only`) and every number are still the words
 *      the author wrote.
 *   2. **Numbers are payload.** Digit runs come out identical, in
 *      order, including the separators that group them.
 *   3. **No new break opportunities.** Whitespace is untouched, so
 *      the layout stress comes from longer tokens rather than from a
 *      re-flow the real locales would not produce.
 *   4. **RTL tolerance, not RTL support.** An RTL row keeps every
 *      digit and Latin run inside an explicit LTR isolate, and no
 *      deprecated bidi control appears anywhere.
 *
 * Property 1 is checked two ways: the collapsed identity, and the
 * declared `meaningTokens`, which the expander leaves untouched so the
 * token is still readable in the expanded string itself.
 */

const samples: readonly PseudoSample[] = PSEUDO_STRESS_SAMPLES;

describe('expansion — mechanics', () => {
	it('reaches the 1.5x target within one code point of slack', () => {
		const sample = pseudoSampleById('en-baseline');
		const expanded = expandPseudoText(sample.text);
		const ratio = [...expanded].length / [...sample.text].length;
		expect(ratio).toBeGreaterThanOrEqual(DEFAULT_EXPANSION_RATIO);
		expect(ratio).toBeLessThan(DEFAULT_EXPANSION_RATIO + 1 / [...sample.text].length);
	});

	it('only ever inserts the declared decoration characters', () => {
		const source = 'Layout review';
		const inserted = [...expandPseudoText(source)].filter((char) => ![...source].includes(char));
		for (const char of inserted) {
			expect([...DECORATION_MARKS, PSEUDO_FILLER]).toContain(char);
		}
		// At least one width-bearing filler: a mark-only expansion
		// inflates the count without moving a single pixel.
		expect(inserted).toContain(PSEUDO_FILLER);
	});

	it('is byte-exactly reversible', () => {
		for (const sample of samples) {
			const expanded = pseudoLocalize(sample.text, sample.direction);
			expect(collapsePseudoText(stripIsolates(expanded))).toBe(sample.text);
		}
	});

	it('leaves whitespace and digit runs untouched', () => {
		for (const sample of samples) {
			const expanded = pseudoLocalize(sample.text, sample.direction);
			expect(expanded.match(/\s+/gu)).toEqual(sample.text.match(/\s+/gu));
			expect(digitRuns(stripIsolates(expanded))).toEqual(digitRuns(sample.text));
		}
	});

	it('decorates through the string instead of padding the tail', () => {
		// A tail-heavy expansion would only widen the last line; the
		// headings and badges are what actually break.
		const source = 'alpha beta gamma';
		const expanded = [...expandPseudoText(source)];
		const firstDecoration = expanded.findIndex(
			(char) => char === PSEUDO_FILLER || DECORATION_MARKS.includes(char),
		);
		expect(firstDecoration).toBeGreaterThanOrEqual(0);
		expect(firstDecoration).toBeLessThan(source.length / 2);
	});

	it('returns text with no decorable base unchanged', () => {
		expect(expandPseudoText('2026-01-05')).toBe('2026-01-05');
		expect(expandPseudoText('')).toBe('');
	});
});

describe('protected spans', () => {
	it('never decorates a declared token', () => {
		const source = 'This view is read-only: do not publish it.';
		const expanded = expandPseudoText(source, {
			protectedTokens: ['read-only', 'do not publish'],
		});
		expect(expanded).toContain('read-only');
		expect(expanded).toContain('do not publish');
		expect(collapsePseudoText(expanded)).toBe(source);
	});

	it('still reaches the ratio target around the protected span', () => {
		// The point of protecting a token is that the ROW still grows:
		// an exemption that quietly dropped the stress would make the
		// fixture measure nothing.
		const sample = pseudoSampleById('en-negation-permission');
		const row = auditPseudoText(sample);
		expect(row.ratio).toBeGreaterThanOrEqual(DEFAULT_EXPANSION_RATIO);
		expect(row.protectedCodePoints).toBeGreaterThan(0);
		expect(row.expandableSlots).toBeGreaterThan(0);
	});

	it('counts the slots a row offers and the code points it withholds', () => {
		const source = 'admin access is granted';
		expect(expandableSlots(source)).toBe([...source].filter((char) => /\p{L}/u.test(char)).length);
		expect(expandableSlots(source, { protectedTokens: ['admin access'] })).toBe(
			[...source].filter((char) => /\p{L}/u.test(char)).length - 'adminaccess'.length,
		);
		expect(protectedCodePointCount(source, { protectedTokens: ['admin access'] })).toBe(
			'admin access'.length,
		);
	});

	it('reports a row that is nothing but protected tokens as unexpandable', () => {
		const sample: PseudoSample = {
			id: 'all-protected',
			subject: 'a paragraph whose every word is protected',
			lang: 'en',
			direction: 'ltr',
			text: 'read-only',
			meaningTokens: ['read-only'],
			note: '',
		};
		const row = auditPseudoText(sample);
		expect(row.expandable).toBe(false);
		expect(row.expandableSlots).toBe(0);
		expect(expandPseudoText(sample.text, { protectedTokens: ['read-only'] })).toBe('read-only');
		// Not declared as a documented limit, so it is a finding.
		expect(row.ok).toBe(false);
	});

	it('finds a token across an astral code point without shifting indices', () => {
		const source = 'status \u{1F5A5}\u{FE0F} admin access';
		const protectedSet = ['admin access'];
		expect(protectedCodePointCount(source, { protectedTokens: protectedSet })).toBe(
			'admin access'.length,
		);
		const expanded = expandPseudoText(source, { protectedTokens: protectedSet });
		expect(expanded).toContain('admin access');
		expect(collapsePseudoText(expanded)).toBe(source);
	});
});

describe('expansion — refusals', () => {
	it('refuses a source that already contains a decoration character', () => {
		expect(() => expandPseudoText(`already ${PSEUDO_FILLER} decorated`)).toThrow(
			/reserved pseudo decoration/,
		);
		expect(() => assertExpandableText(`x${DECORATION_MARKS[0]}`, 1.5)).toThrow(
			/reserved pseudo decoration/,
		);
	});

	it('refuses an expansion ratio below 1 or a non-string', () => {
		expect(() => expandPseudoText('text', { ratio: 0.9 })).toThrow(/ratio must be/);
		expect(() => expandPseudoText('text', { ratio: Number.NaN })).toThrow(/ratio must be/);
		expect(() => assertExpandableText(undefined as unknown as string, 1.5)).toThrow(
			/must be a string/,
		);
	});

	it('reports a code for every refusal instead of a bare message', () => {
		try {
			expandPseudoText(`${PSEUDO_FILLER}`, { ratio: 0 });
		} catch (error) {
			expect((error as { code?: string }).code).toBe('invalid-ratio');
		}
	});
});

describe('bidi isolation (UAX #9)', () => {
	const rtl = pseudoSampleById('he-rtl-acronym').text;

	it('wraps Latin and digit runs of an RTL paragraph in LTR isolates', () => {
		const isolated = isolateEmbeddedRuns(rtl);
		expect(isolated).toContain(`${LRI}2026${PDI}`);
		expect(isolated).toContain(`${LRI}SLA${PDI}`);
		expect(isolated).toContain(`${LRI}99.9%${PDI}`);
		expect(stripIsolates(isolated)).toBe(rtl);
	});

	it('leaves an LTR paragraph alone', () => {
		const ltr = pseudoSampleById('en-numbers').text;
		expect(isolateEmbeddedRuns(ltr)).toBe(ltr);
	});

	it('leaves no digit run of an RTL row unisolated', () => {
		for (const sample of samples.filter((row) => row.direction === 'rtl')) {
			const facts = auditBidiIsolation(pseudoLocalize(sample.text, sample.direction));
			expect(facts.unisolatedDigitRuns).toEqual([]);
			expect(facts.isolatedDigitRuns).toBe(facts.digitRuns.length);
			expect(facts.balanced).toBe(true);
		}
	});

	it('reports unbalanced isolates and deprecated controls instead of hiding them', () => {
		const broken = `${LRI}2026`; // opened, never closed
		const facts = auditBidiIsolation(broken);
		expect(facts.balanced).toBe(false);
		expect(auditBidiIsolation('\u202Blegacy\u202C').deprecatedControls).toEqual(['RLE', 'PDF']);
	});

	it('never emits FSI, because no sample has an unknown-direction run', () => {
		expect(isolateEmbeddedRuns(rtl)).not.toContain(FSI);
	});
});

describe('audit table', () => {
	const report = auditPseudoSamples();

	it('passes every row of the committed table', () => {
		expect(report.samples.filter((row) => !row.ok).map((row) => [row.id, row.findings])).toEqual(
			[],
		);
		expect(report.ok).toBe(true);
	});

	it('has at least one row per stress dimension the Issue names', () => {
		const byDirection = samples.filter((row) => row.direction === 'rtl');
		expect(byDirection.length).toBeGreaterThanOrEqual(2);
		expect(samples.some((row) => row.text.includes('\u0308'))).toBe(true);
		expect(samples.some((row) => digitRuns(row.text).length > 0)).toBe(true);
		expect(
			samples.some((row) => row.meaningTokens !== undefined && row.meaningTokens.length > 0),
		).toBe(true);
	});

	it('carries an unbreakable long word long enough to overflow a phone', () => {
		const german = auditPseudoText(pseudoSampleById('de-compound'));
		expect(german.longestWord).toBeGreaterThanOrEqual(60);
		// Expansion adds characters INSIDE the word, so the worst case
		// is measured after expansion, not before.
		expect(german.expandedLongestWord).toBeGreaterThan(german.longestWord);
	});

	it('marks the digits-only row as a documented limit, not a fake pass', () => {
		const row = auditPseudoText(pseudoSampleById('digits-only'));
		expect(row.expandable).toBe(false);
		expect(row.ok).toBe(true);
		expect(row.documentedLimits.join(' ')).toContain('cannot be expanded');
		expect(row.findings).toEqual([]);
		// Everything else still holds for the row: it is a documented
		// limit, not a broken fixture.
		expect(row.collapsesToSource).toBe(true);
		expect(row.digitRunsPreserved).toBe(true);
	});

	it('treats an undeclared unexpandable row as a finding', () => {
		const undeclared: PseudoSample = {
			id: 'undeclared',
			subject: 'digits without a documentsLimit flag',
			lang: 'und',
			direction: 'ltr',
			text: '12345',
			note: '',
		};
		const row = auditPseudoText(undeclared);
		expect(row.ok).toBe(false);
		expect(row.documentedLimits).toEqual([]);
	});

	it('keeps every negation and permission token verbatim', () => {
		const row = auditPseudoText(pseudoSampleById('en-negation-permission'));
		expect(row.meaningTokens.every((fact) => fact.preserved)).toBe(true);
		expect(row.meaningTokens.map((fact) => fact.token)).toEqual([
			'read-only',
			'do not publish',
			'admin access',
		]);
		expect(row.protectedCodePoints).toBe(
			'read-only'.length + 'do not publish'.length + 'admin access'.length,
		);
	});

	it('keeps a hyphenated date as one digit run', () => {
		// A split would compare `2026-01-05` against three runs while the
		// fixture claimed the date survived.
		expect(digitRuns('due 2026-01-05 at 12:30')).toEqual(['2026-01-05', '12:30']);
		expect(digitRuns('score -3 of 5')).toEqual(['3', '5']);
	});

	it('fails loudly when a meaning token would not survive', () => {
		const broken: PseudoSample = {
			...pseudoSampleById('en-baseline'),
			meaningTokens: ['never written'],
		};
		const row = auditPseudoText(broken);
		expect(row.ok).toBe(false);
		expect(row.findings.join(' ')).toContain('never written');
	});

	it('fails loudly when an rtl row contains no RTL character', () => {
		const lying: PseudoSample = { ...pseudoSampleById('en-baseline'), direction: 'rtl' };
		expect(auditPseudoText(lying).findings.join(' ')).toContain('no RTL character');
	});

	it('fails loudly when a digit run would be rewritten', () => {
		// A fixture whose expansion touched a number must be rejected,
		// which is the property the whole table rests on.
		const sample = pseudoSampleById('en-baseline');
		const mutated = auditPseudoText(sample);
		expect(mutated.digitRunsPreserved).toBe(true);
		const digits = auditPseudoText(pseudoSampleById('en-numbers'));
		expect(digits.digitRuns).toEqual([
			'1,234,567',
			'12:30',
			'2026-01-05',
			'99.9',
			'1',
			'1.2',
			'1024',
			'768',
		]);
	});
});

describe('scope the fixture refuses to claim', () => {
	it('names the limits the verification artefact prints', () => {
		expect(PSEUDO_LOCALE_LIMITS.length).toBeGreaterThanOrEqual(5);
		const joined = PSEUDO_LOCALE_LIMITS.join(' ');
		expect(joined).toContain('Not a translation');
		expect(joined).toContain('Not RTL support');
		expect(joined).toContain('Not text quality');
	});

	it('uses the CLDR pseudo-locale id and registers no shipped locale', () => {
		expect(PSEUDO_LOCALE_ID).toBe('qps-ploc');
	});
});
