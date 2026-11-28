import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildFixtureProject } from '../../../test/fixtures/large-portfolio-fixture';
import type { PortfolioFacet, PortfolioProject } from '../schema';
import { PortfolioArchive } from './PortfolioArchive';

/**
 * PortfolioArchive — the `/portfolio` catalogue layer (Issue #1318).
 *
 * The contract this file pins:
 *
 *   1. **Completeness.** Every project renders exactly one row with a
 *      real `/portfolio/<slug>` link, server-side. The production
 *      smoke (`e2e/prod-portfolio.spec.ts`) finds published slugs in
 *      the `/portfolio` HTML, so a row that only appears after a
 *      client interaction would silently break that contract.
 *
 *   2. **Facet filing.** A work is filed ONCE, under its primary
 *      facet (`facets[0]`, the same rule the card eyebrow applies);
 *      groups render in the closed enum's canonical order and an
 *      untagged work lands in `other` — never dropped, never
 *      duplicated across groups.
 *
 *   3. **Band marking.** A slug the Selected works band exhibits
 *      keeps its row and carries the `Selected` badge — the archive
 *      claims completeness, so hiding band works would make the
 *      claim false.
 */

function projectWith(index: number, overrides: Partial<PortfolioProject> = {}): PortfolioProject {
	return { ...buildFixtureProject(index), ...overrides };
}

function renderArchive(projects: readonly PortfolioProject[], selected: readonly string[] = []) {
	return renderToStaticMarkup(
		<PortfolioArchive projects={projects} selectedSlugs={new Set(selected)} />,
	);
}

describe('PortfolioArchive', () => {
	it('renders every project exactly once as a link to its detail page', () => {
		const projects = [0, 1, 2, 3].map((i) => projectWith(i));
		const html = renderArchive(projects);
		for (const project of projects) {
			expect(html).toContain(`href="/portfolio/${project.slug}"`);
		}
		// One <li> per project — the archive is a list, not a grid of cards.
		expect((html.match(/<li/g) ?? []).length).toBe(projects.length);
		expect(html).not.toContain('<article');
	});

	it('files each work once under its primary facet, in enum order', () => {
		const develop = projectWith(0, { facets: ['develop'] });
		const video = projectWith(1, { facets: ['video'] });
		const design = projectWith(2, { facets: ['design'] });
		const multi = projectWith(3, { facets: ['design', 'develop'] });
		const html = renderArchive([video, design, develop, multi]);

		const groupOrder = ['develop', 'video', 'design'].map((facet) =>
			html.indexOf(`data-facet="${facet}"`),
		);
		expect(groupOrder.every((i) => i >= 0)).toBe(true);
		expect([...groupOrder].sort((a, b) => a - b)).toEqual(groupOrder);

		// `multi` carries develop as its SECOND facet but is filed under
		// `design` (its first) — exactly once.
		expect(html.match(new RegExp(`data-slug="${multi.slug}"`, 'g'))).toHaveLength(1);
		const designGroup = html.slice(html.indexOf('data-facet="design"'));
		expect(designGroup).toContain(`data-slug="${multi.slug}"`);
	});

	it('files an untagged work under `other` instead of dropping it', () => {
		const untagged = projectWith(4, { facets: [] });
		const html = renderArchive([untagged]);
		expect(html).toContain('data-facet="other"');
		expect(html).toContain(`href="/portfolio/${untagged.slug}"`);
	});

	it('marks band exhibits with the Selected badge and data-selected', () => {
		const selected = projectWith(0);
		const plain = projectWith(1);
		const html = renderArchive([selected, plain], [selected.slug]);
		expect(html).toContain('data-selected="true"');
		expect(html).toContain('>Selected</span>');
		const plainRow = html.slice(html.indexOf(`data-slug="${plain.slug}"`));
		expect(plainRow).not.toContain('data-selected');
	});

	it('numbers rows continuously across facet groups', () => {
		const projects = [0, 1, 2, 3].map((i) =>
			projectWith(i, { facets: [(['develop', 'video', 'design', 'other'] as const)[i]] }),
		);
		const html = renderArchive(projects);
		for (const n of ['01', '02', '03', '04']) {
			expect(html).toContain(`>${n}<`);
		}
	});

	it('prints only recorded provenance — no invented role or period', () => {
		const bare = projectWith(5, {
			role: 'Development', // facet-derived kind word: never a role (Issue #813)
			periodLabel: null,
			periodStart: Number.NaN,
		});
		const html = renderArchive([bare]);
		// The row still renders; the meta line is simply absent.
		expect(html).toContain(`href="/portfolio/${bare.slug}"`);
		expect(html).not.toContain('>Development</');
	});
});
