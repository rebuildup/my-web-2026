import { describe, expect, it } from 'vitest';
import { PORTFOLIO_SLUG_GRAMMAR } from '../portfolio/schema';
import { EMOJI_SLUG_GRAMMAR } from '../reactions/slug-regex';
import {
	type SlugGrammar,
	UNICODE_FIXTURES,
	type UnicodeFixture,
	unicodeFixtureById,
	unicodeFixtureIds,
} from './fixtures';
import { type SlugRejectionReason, classifySlugCandidate } from './slug-identity';
import { describeUnicode, foldForComparison } from './unicode';

/**
 * The shared decision table, verified against the SHIPPED grammars.
 *
 * This is the test that makes `src/i18n/fixtures.ts` a contract rather
 * than documentation: every row is classified with the real policy and
 * the real owner-owned grammar, so a change to `EMOJI_SLUG_REGEX`,
 * `SLUG_REGEX`, the classification order or the Unicode reporting
 * fails here instead of quietly invalidating the Issue #433 evidence
 * in `docs/verification/i18n/`.
 *
 * It is also the only place in the repository where the `i18n`
 * obligation reads another obligation. Tests are exempt from the leaf
 * rule in `scripts/check-architecture.mjs` for exactly this reason: the
 * assertion has to be made against the owners, not against a copy.
 */

const GRAMMARS: Record<'emoji-slug' | 'portfolio-slug', SlugGrammar> = {
	'emoji-slug': EMOJI_SLUG_GRAMMAR,
	'portfolio-slug': PORTFOLIO_SLUG_GRAMMAR,
};

const fixture = (id: string): UnicodeFixture => {
	const found = unicodeFixtureById(id);
	if (!found) throw new Error(`unknown fixture: ${id}`);
	return found;
};

describe('fixture table — shape', () => {
	it('has unique ids', () => {
		const ids = unicodeFixtureIds();
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('names a grammar that actually exists', () => {
		for (const row of UNICODE_FIXTURES) {
			for (const expectation of row.expectations) {
				expect(Object.keys(GRAMMARS)).toContain(expectation.grammar);
			}
		}
	});

	it('states a reason for every refusal it expects', () => {
		for (const row of UNICODE_FIXTURES) {
			for (const expectation of row.expectations) {
				if (expectation.outcome === 'rejected') expect(expectation.reason).toBeDefined();
			}
		}
	});
});

describe('fixture table — display text is preserved, never folded', () => {
	it.each(unicodeFixtureIds())('%s — the display body survives describeUnicode unchanged', (id) => {
		const row = fixture(id);
		const facts = describeUnicode(row.displayText);
		expect(facts.text).toBe(row.displayText);
		expect(facts.changesUnderCompatibilityFold).toBe(row.compatFoldRisk);
	});

	it('covers both NFC and NFD spellings of one word, and they fold together', () => {
		const nfc = fixture('nfc-accented-title');
		const nfd = fixture('nfd-accented-title');
		expect(describeUnicode(nfc.displayText).form).toBe('NFC');
		expect(describeUnicode(nfd.displayText).form).toBe('NFD');
		expect(foldForComparison(nfd.displayText)).toBe(foldForComparison(nfc.displayText));
		expect(nfd.displayText).not.toBe(nfc.displayText);
	});

	it('keeps canonically equivalent rows in one group', () => {
		const groups = new Map<string, string[]>();
		for (const row of UNICODE_FIXTURES) {
			if (!row.canonicalGroup) continue;
			const key = foldForComparison(row.displayText);
			groups.set(row.canonicalGroup, [...(groups.get(row.canonicalGroup) ?? []), key]);
		}
		expect(groups.size).toBeGreaterThan(0);
		for (const keys of groups.values()) {
			expect(new Set(keys).size).toBe(1);
		}
	});
});

describe('fixture table — slug candidates get the declared verdict', () => {
	it.each(unicodeFixtureIds())('%s', (id) => {
		const row = fixture(id);
		for (const expectation of row.expectations) {
			const verdict = classifySlugCandidate(row.slugCandidate, GRAMMARS[expectation.grammar]);
			if (expectation.outcome === 'accepted') {
				expect(verdict).toEqual({ ok: true, slug: row.slugCandidate });
				continue;
			}
			expect(verdict.ok).toBe(false);
			if (verdict.ok) return;
			expect(verdict.reason satisfies SlugRejectionReason).toBe(expectation.reason);
		}
	});

	it('never turns a non-ASCII candidate into an ASCII slug', () => {
		const accepted: string[] = [];
		for (const row of UNICODE_FIXTURES) {
			for (const grammar of Object.values(GRAMMARS)) {
				const verdict = classifySlugCandidate(row.slugCandidate, grammar);
				if (verdict.ok) accepted.push(verdict.slug);
			}
		}
		// This is the Issue #433 guarantee in one assertion: every slug
		// the platform publishes is byte-identical to what the author
		// typed. No transliteration, no folding, no diacritic stripping.
		for (const slug of accepted) {
			expect(slug).toBe(slug.normalize('NFC'));
			expect([...slug].every((char) => (char.codePointAt(0) ?? 0) <= 0x7f)).toBe(true);
		}
		expect(accepted.every((slug) => slug === slug.toLowerCase())).toBe(true);
	});

	it('refuses the zero-width slug even though the visible text is a valid slug', () => {
		const row = fixture('zero-width-slug');
		expect(row.slugCandidate.replace(/\u200b/g, '')).toBe('thumbsup');
		const verdict = classifySlugCandidate(row.slugCandidate, EMOJI_SLUG_GRAMMAR);
		if (verdict.ok) throw new Error('expected a refusal');
		expect(verdict.reason).toBe('non-ascii');
		expect(verdict.offenders[0].hex).toBe('U+200B');
	});
});
