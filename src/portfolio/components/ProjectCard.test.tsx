import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PortfolioFacet, PortfolioProject } from '../schema';
import { ProjectCard } from './ProjectCard';

/**
 * ProjectCard — category cue is never colour alone (Issue #411).
 *
 * WCAG 2.2 SC 1.4.1 Use of Color (Level A) says colour must not be
 * the only visual means of conveying information. The category rule
 * this card used to paint (`accent.category.<facet>`) was four hues of
 * one identical bar; Issue #794 removed it (owner decision,
 * 2026-11-01 — no left rule, no left border), so the tests below pin
 * the two things that carry the category now that no hue remains:
 *
 *   1. **the mark** — every facet maps to its own `StateMark` kind
 *      (`data-state-mark`), so no two categories share one entry of
 *      the shape vocabulary. What each entry DRAWS is pinned
 *      separately by `src/editorial/primitives/StateMark.test.tsx`,
 *      which compares the resolved silhouette (inline `clip-path` +
 *      utility classes). This file cannot see geometry: it would stay
 *      green if two kinds were renamed apart while drawing the same
 *      polygon, which is the regression SC 1.4.1 forbids;
 *   2. **the word** — the category still renders as upper-case text
 *      beside the mark, and the facet pills still name the facet for
 *      the accessibility tree.
 *
 * The mark itself is decorative. If a future change made it the
 * accessible name (`aria-hidden` removed) the redundancy would be
 * one channel instead of two, which is the failure this file exists
 * to catch.
 *
 * Issue #794 also pins the ABSENCE of the cue that was removed: no
 * absolutely positioned bar, no left border, and no `accent.category.*`
 * colour on this surface. A regression that re-added one of them would
 * restore a hue-only channel beside the shape, which is exactly what
 * the owner's decision forbids.
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

/** The `<article>` element's class attribute (the card's own plane). */
function articleClass(html: string): string {
	return html.match(/<article[^>]*class="([^"]*)"/)?.[1] ?? '';
}

describe('ProjectCard category cue (Issue #411)', () => {
	it('gives every category its own silhouette', () => {
		const rendered = (['design', 'develop', 'video', 'other'] as const).map((facet) =>
			marks(renderToStaticMarkup(<ProjectCard project={project([facet])} />)),
		);
		expect(rendered).toEqual([['design'], ['code'], ['tool'], ['writing']]);
		// The property under test: one vocabulary entry per category,
		// so no two categories are even asking for the same mark. The
		// silhouettes those entries resolve to are checked in
		// `src/editorial/primitives/StateMark.test.tsx`.
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
		expect(html).toContain('<span aria-hidden="true" data-state-mark="tool"');
		expect(html).toContain('aria-label="facets"');
	});

	it('renders no category cue for a project without facets', () => {
		const html = renderToStaticMarkup(<ProjectCard project={project([])} />);
		expect(marks(html)).toEqual([]);
		expect(html).not.toContain('data-category=');
	});

	it('paints its own surface and no left category rule (Issue #794)', () => {
		const html = renderToStaticMarkup(<ProjectCard project={project(['design'])} />);
		// The face is the card's own fill — a luminance step, not a hue.
		expect(articleClass(html)).toContain('bg-c_bg.surface');
		// The removed cue must stay removed: no absolutely positioned
		// bar, no 4px rule, and no category colour on this surface, so
		// the owner's "no left rule, no left border" holds against a
		// future edit as well.
		expect(html).not.toMatch(/pos_absolute|w_4px|bd-s|borderInlineStart/);
		expect(html).not.toContain('accent.category');
	});

	it('maps each facet to the documented category', () => {
		for (const [facet, category] of Object.entries(FACET_CATEGORY) as [PortfolioFacet, string][]) {
			expect(renderToStaticMarkup(<ProjectCard project={project([facet])} />)).toContain(
				`data-category="${category}"`,
			);
		}
	});
});
