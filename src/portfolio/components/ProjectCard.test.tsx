import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PortfolioFacet, PortfolioProject } from '../schema';
import { ProjectCard } from './ProjectCard';

/**
 * ProjectCard — category cue is never colour alone (Issue #411).
 *
 * WCAG 2.2 SC 1.4.1 Use of Color (Level A) says colour must not be
 * the only visual means of conveying information. The category rule
 * this card paints (`accent.category.<facet>`) was four hues of one
 * identical bar, so the tests below pin the two things that survive
 * when hue is removed:
 *
 *   1. **the shape** — every facet maps to its own `StateMark`
 *      silhouette (`data-state-mark`), so no two categories collapse
 *      into the same rectangle;
 *   2. **the word** — the category still renders as upper-case text
 *      beside the mark, and the facet pills still name the facet for
 *      the accessibility tree.
 *
 * The mark itself is decorative. If a future change made it the
 * accessible name (`aria-hidden` removed) the redundancy would be
 * one channel instead of two, which is the failure this file exists
 * to catch.
 *
 * Static markup, no DOM: the same reason `list-scale.test.tsx` uses
 * it — this card needs no router and no bindings, and the workerd
 * pool has no DOM to query.
 */

const FACET_CATEGORY: Readonly<Record<PortfolioFacet, string>> = {
	design: 'design',
	develop: 'code',
	video: 'tool',
	other: 'writing',
};

function project(facets: readonly PortfolioFacet[]): PortfolioProject {
	return {
		id: 'p-1',
		slug: 'a-project',
		title: 'A project',
		summary: 'A summary.',
		role: 'Engineer',
		periodStart: 2_020,
		periodEnd: 2_021,
		periodLabel: '2020 — 2021',
		motivationMd: '',
		architectureMd: null,
		constraintsMd: null,
		implementationMd: null,
		evidenceMd: null,
		retrospectiveMd: null,
		facets,
		technologies: [],
		visibility: 'public',
		status: 'published',
		pinned: false,
		displayOrder: 1,
		createdAt: 0,
		updatedAt: 0,
		links: [],
		media: [],
	};
}

/** Every `data-state-mark` value in the rendered markup, in order. */
function marks(html: string): string[] {
	return [...html.matchAll(/data-state-mark="([^"]+)"/g)].map((match) => match[1]);
}

describe('ProjectCard category cue (Issue #411)', () => {
	it('gives every category its own silhouette', () => {
		const rendered = (['design', 'develop', 'video', 'other'] as const).map((facet) =>
			marks(renderToStaticMarkup(<ProjectCard project={project([facet])} />)),
		);
		expect(rendered).toEqual([['design'], ['code'], ['tool'], ['writing']]);
		// The property under test: removing hue cannot collapse two
		// categories into the same shape.
		expect(new Set(rendered.flat()).size).toBe(4);
	});

	it('keeps the category word beside the shape', () => {
		const html = renderToStaticMarkup(<ProjectCard project={project(['develop'])} />);
		expect(html).toContain('Develop');
		expect(html).toContain('data-category="code"');
	});

	it('keeps the shape decorative so the text stays the accessible name', () => {
		const html = renderToStaticMarkup(<ProjectCard project={project(['video'])} />);
		// The mark is `aria-hidden`; the facet pills are what name the
		// category to assistive technology. A mark that carried the name
		// would leave one channel instead of the two 1.4.1 asks for.
		expect(html).toContain('<svg aria-hidden="true" data-state-mark="tool"');
		expect(html).toContain('aria-label="facets"');
	});

	it('renders no category cue for a project without facets', () => {
		const html = renderToStaticMarkup(<ProjectCard project={project([])} />);
		expect(marks(html)).toEqual([]);
		expect(html).not.toContain('data-category=');
	});

	it('maps each facet to the documented category', () => {
		for (const [facet, category] of Object.entries(FACET_CATEGORY) as [PortfolioFacet, string][]) {
			expect(renderToStaticMarkup(<ProjectCard project={project([facet])} />)).toContain(
				`data-category="${category}"`,
			);
		}
	});
});
