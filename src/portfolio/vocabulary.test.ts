import { describe, expect, it } from 'vitest';
import { PORTFOLIO_FACETS } from './schema';
import { FACET_LABEL, FACET_LABEL_JA } from './vocabulary';

/**
 * The portfolio vocabulary (Issue #813).
 *
 * These assertions are a contract, not a smoke test. The words here
 * are printed on a public surface, so a change to a facet label, or a
 * facet that gains a label in one language but not the other, is a
 * public-copy change: it has to be argued here and in
 * `docs/domain/portfolio-vocabulary.md`, not discovered later on a
 * rendered page.
 *
 * The facet words live in ONE module because the card, the detail
 * header and the filter used to carry three copies of the same
 * mapping.
 */

/**
 * The source of every public surface that prints a facet word or a
 * role label, read as text.
 *
 * The point of reading the SOURCE (not only the rendered markup) is
 * that the word has to be absent, not merely unused: a label that is
 * defined but not rendered today is one edit away from being
 * rendered.
 */
const surfaceSources = import.meta.glob(
	[
		'./components/ProjectCard.tsx',
		'./components/PortfolioDetail.tsx',
		'./components/FacetFilter.tsx',
		'./vocabulary.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

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

	it('has no label for a kind of work on the public surface', () => {
		// The first version of this ticket relabelled `Role` as `Kind`.
		// The owner rejected it: a person's role and a kind of work
		// cannot share one label. The corrected decision keeps `Role`
		// and projects no kind of work at all, so the word must not
		// come back — not in the rendered markup (pinned by
		// `ProjectCard.test.tsx` / `PortfolioDetail.test.tsx`) and not
		// in the source that renders it.
		expect(Object.keys(surfaceSources).sort()).toEqual([
			'./components/FacetFilter.tsx',
			'./components/PortfolioDetail.tsx',
			'./components/ProjectCard.tsx',
			'./vocabulary.ts',
		]);
		for (const [path, source] of Object.entries(surfaceSources)) {
			expect(source, path).not.toContain('Kind');
		}
	});
});
