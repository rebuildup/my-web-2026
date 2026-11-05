import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PortfolioAdjacent, PortfolioProject } from '../schema';
import { PortfolioDetail } from './PortfolioDetail';

/**
 * The `role` row of the detail header (Issue #813).
 *
 * Same contract as the card: the column mixes the role a person held
 * and the kind of work derived from the facets, and only the first one
 * belongs in it. The detail header shows the facet as its eyebrow word
 * (`· Video`) and as the pill, so a derived value would be a second,
 * weaker copy of a fact the page already states — and, for 5 of the
 * 64 derived values, a contradiction of the eyebrow.
 *
 * The component only sees a stored string, so these cases pin the
 * PUBLIC CONTRACT, not a live path: D1 declares `role` NOT NULL and
 * the loader carries no `role_source`, so no row can be `null` today.
 * The state below arrives with Issue #811's ingest.
 */

function project(overrides: Partial<PortfolioProject> = {}): PortfolioProject {
	return {
		id: 'p-1',
		slug: 'a-project',
		title: 'A project',
		summary: 'A summary.',
		role: null,
		periodStart: 2_020,
		periodEnd: 2_021,
		periodLabel: '2020 — 2021',
		motivationMd: '',
		architectureMd: null,
		constraintsMd: null,
		implementationMd: null,
		evidenceMd: null,
		retrospectiveMd: null,
		facets: ['video'],
		technologies: [],
		visibility: 'public',
		status: 'published',
		evidenceStatus: 'reviewed',
		pinned: false,
		displayOrder: 1,
		createdAt: 0,
		updatedAt: 0,
		links: [],
		media: [],
		...overrides,
	};
}

const adjacent: PortfolioAdjacent = { prev: null, next: null };

describe('PortfolioDetail — the role row (Issue #813)', () => {
	it('drops the role row for a derived value and keeps the facet wording', () => {
		// `role: null` is the value Issue #811's ingest writes for a
		// `facet-derived` row (the column is NOT NULL today, so no live
		// row can be null yet). The kind of work stays where the facets
		// are.
		const html = renderToStaticMarkup(<PortfolioDetail project={project()} adjacent={adjacent} />);
		expect(html).not.toContain('>Role</dt>');
		// The eyebrow word and the pill still name the work.
		expect(html).toContain('· Video');
		expect(html).toContain('>Video<');
		// Neither the derived value nor a kind-of-work label appears.
		expect(html).not.toContain('Video production');
		expect(html).not.toContain('>Kind</dt>');
	});

	it('leaves no empty value cell behind when no role is recorded', () => {
		for (const role of [null, '']) {
			const html = renderToStaticMarkup(
				<PortfolioDetail project={project({ role })} adjacent={adjacent} />,
			);
			expect(html).not.toContain('>Role</dt>');
			expect(html).not.toMatch(/<dd[^>]*>\s*<\/dd>/);
			// The period row is unconditional.
			expect(html).toContain('>Period</dt>');
			expect(html).toContain('2020 — 2021');
		}
	});
});
