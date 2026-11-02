import { describe, expect, it } from 'vitest';
import { PORTFOLIO_FACETS } from './schema';
import { FACET_LABEL, FACET_LABEL_JA, KIND_LABEL } from './vocabulary';

/**
 * The portfolio vocabulary (Issue #813).
 *
 * These assertions are a contract, not a smoke test. The words here
 * are printed on a public surface, and the label decides what claim
 * the value makes on the reader's behalf. A change to `Kind`, or a
 * facet that gains a label in one language but not the other, is a
 * public-copy change: it has to be argued here and in
 * `docs/domain/portfolio-vocabulary.md`, not discovered later on a
 * rendered page.
 */
describe('portfolio vocabulary', () => {
	it('names every facet in both languages', () => {
		expect(Object.keys(FACET_LABEL).sort()).toEqual([...PORTFOLIO_FACETS].sort());
		expect(Object.keys(FACET_LABEL_JA).sort()).toEqual([...PORTFOLIO_FACETS].sort());
		for (const facet of PORTFOLIO_FACETS) {
			expect(FACET_LABEL[facet].length).toBeGreaterThan(0);
			expect(FACET_LABEL_JA[facet].length).toBeGreaterThan(0);
		}
	});

	it('keeps the Japanese words Japanese', () => {
		// A copy-paste of the English table into the Japanese one would
		// still satisfy "non-empty", and the chips would silently become
		// English on a Japanese page.
		for (const facet of PORTFOLIO_FACETS) {
			expect(FACET_LABEL_JA[facet]).toMatch(/[぀-ヿ一-鿿]/);
		}
	});

	it('labels a facet-derived value as its kind, never as a role', () => {
		// The value is derived from a facet (the project's kind of work),
		// so the label may not claim a personal position. "Role" is the
		// word this ticket removed; it must not come back as a synonym.
		expect(KIND_LABEL).toBe('Kind');
		expect(KIND_LABEL.toLowerCase()).not.toBe('role');
		expect(KIND_LABEL.toLowerCase()).not.toBe('type');
	});
});
