import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_PAGE_SIZE,
	LARGE_FIXTURE_SIZE,
	buildLargePortfolioFixture,
	toListPages,
} from '../../../test/fixtures/large-portfolio-fixture';
import { ProjectCard } from './ProjectCard';

/**
 * Large-catalogue list boundary on a 100+ row fixture (Issue #490).
 *
 * Why this test exists
 * --------------------
 * The shipped portfolio catalogue is a handful of rows, so the list
 * never reaches the pagination boundary the loader is built for
 * (`clampLimit`'s default page size is 100). Nothing in CI ever
 * rendered 100 cards, let alone measured what one card costs in DOM
 * nodes or what it contributes to an accessibility violation. Issue
 * #490 asks for exactly that boundary to be inspected with a large
 * fixture, so this file pins the two properties that scale:
 *
 *   1. **One card must stay one card.** The card's markup is a fixed
 *      cost per catalogue row, so the node count must grow LINEARLY
 *      with the catalogue and the per-card cost must stay under a
 *      ceiling. A quadratic shape (a wrapper per facet, per
 *      technology, per link) fails here instead of in a browser.
 *
 *   2. **A label nobody can hear is a per-row accessibility
 *      violation.** `aria-label` on an element whose role is
 *      `generic` (a bare `<div>` / `<span>`) is a prohibited
 *      attribute: the accessibility API drops the name. On a list
 *      surface that is not one mistake, it is one mistake per card —
 *      120 rows, 120 violations. The invariant below fails the build
 *      when a card reintroduces it.
 *
 * What this test does NOT claim
 * -----------------------------
 * It does not measure milliseconds, memory or a Lighthouse score.
 * Those need a real browser and a real page; `scripts/perf-large-list.mjs`
 * is that surface, and its report is committed under
 * `docs/verification/perf/large-list-pagination.md`. It is also not a
 * quality GATE: turning any of these numbers into a release-blocking
 * threshold is Issue #385 / #386, deliberately not this file.
 *
 * Why static markup instead of a DOM
 * -----------------------------------
 * `PortfolioList` needs a TanStack Router match (`FacetFilter` calls
 * `useSearch`), which the workerd pool cannot fabricate, and the
 * DOM-capable pool (`vitest.client.config.ts`) is not part of
 * `validate:fast`. Static markup keeps this check inside the suite CI
 * actually runs. The rendered-page interaction (a real click on
 * "Load more") is covered by `PortfolioList.pagination.client.test.tsx`
 * (happy-dom) and by the recorded browser measurement.
 */

/**
 * Per-card DOM node ceiling; mirrors `PER_CARD_NODE_CEILING` in the harness.
 *
 * Issue #411 moved it from 20 to 22 because every card now renders the
 * `StateMark` (Issue #411): ONE `<span>` per card, no children. The
 * measured card is 20 nodes (21 when pinned), so the ceiling still
 * leaves exactly one node of headroom — the property this gate protects
 * is that the per-card cost stays CONSTANT, not that it stays at 19.
 */
const PER_CARD_NODE_CEILING = 22;

/** Count the elements in a markup string. Self-closing and paired tags both count once. */
function countElements(html: string): number {
	return (html.match(/<[a-zA-Z][^>]*>/g) ?? []).length;
}

function renderCards(projects: readonly { id: string; slug: string; facets: readonly string[] }[]) {
	return projects.map((project) =>
		renderToStaticMarkup(<ProjectCard project={project as never} />),
	);
}

const fixture = buildLargePortfolioFixture(LARGE_FIXTURE_SIZE);
const [firstPage, secondPage] = toListPages(fixture, DEFAULT_PAGE_SIZE);

describe('project card — 100+ row pagination boundary', () => {
	it('splits the fixture at the loader default page size', () => {
		expect(LARGE_FIXTURE_SIZE).toBeGreaterThanOrEqual(100);
		expect(firstPage.projects).toHaveLength(DEFAULT_PAGE_SIZE);
		expect(secondPage.projects).toHaveLength(LARGE_FIXTURE_SIZE - DEFAULT_PAGE_SIZE);
		expect(firstPage.nextCursor).not.toBeNull();
		expect(secondPage.nextCursor).toBeNull();
	});

	it('keeps the per-card DOM cost under the ceiling at the page boundary', () => {
		const markup = renderCards(firstPage.projects);
		const perCard = markup.map(countElements);
		const cheapest = Math.min(...perCard);
		const worst = Math.max(...perCard);
		// A pinned row carries one extra node (the `Pinned` badge); a
		// shape difference larger than that is a card that stopped
		// being one card. It also keeps the `StateMark` honest: a
		// category whose silhouette needed a second element would
		// show up here as a two-node spread.
		expect(worst - cheapest).toBeLessThanOrEqual(1);
		expect(worst).toBeLessThanOrEqual(PER_CARD_NODE_CEILING);
	});

	it('scales linearly — appending a page adds exactly that page’s nodes', () => {
		const first = renderCards(firstPage.projects);
		const appended = renderCards(secondPage.projects);
		const firstNodes = first.reduce((sum, html) => sum + countElements(html), 0);
		const appendedNodes = appended.reduce((sum, html) => sum + countElements(html), 0);
		const allNodes = renderCards(fixture).reduce((sum, html) => sum + countElements(html), 0);
		expect(allNodes).toBe(firstNodes + appendedNodes);
		// The appended page is the ONLY difference: no duplicated
		// chrome, no re-mounted shell, one card's worth of nodes per
		// new row.
		expect(allNodes - firstNodes).toBe(appendedNodes);
	});

	it('renders one card per row with no empty card body', () => {
		const [markup] = renderCards(firstPage.projects);
		expect((markup.match(/<article/g) ?? []).length).toBe(1);
		expect(markup).toContain(`href="/portfolio/${firstPage.projects[0].slug}"`);
		// Fixture rows are placeholders; a card must never invent one.
		expect(markup).toContain('Fixture project 000');
	});

	it('gives every image an alt attribute', () => {
		for (const markup of renderCards(fixture)) {
			for (const img of markup.match(/<img[^>]*>/g) ?? []) {
				expect(img).toMatch(/\salt="/);
			}
		}
	});

	it('never puts aria-label on an element whose role is generic', () => {
		// A bare <div>/<span>/<p> has the implicit role `generic`, and
		// `aria-label` there is a prohibited attribute — the name is
		// dropped by every accessibility API. Per card, not per page,
		// so this is the invariant that scales with the catalogue.
		// The page-level equivalent (every role, every element) is
		// measured in scripts/perf-large-list.mjs.
		for (const markup of renderCards(fixture)) {
			// The negative lookahead skips an element that declares its
			// own role: `<div role="group" aria-label>` is conformant,
			// `<div aria-label>` is not.
			expect(markup).not.toMatch(/<(div|span|p)\b(?![^>]*\brole=)[^>]*\saria-label=/);
		}
	});

	it('keeps the facet pills reachable as a named group', () => {
		const [markup] = renderCards(firstPage.projects);
		// The facet group must expose its name through a real role,
		// which is what the accessibility tree actually reads.
		expect(markup).toMatch(/role="group"[^>]*aria-label="facets"/);
		// …and the group must not be empty: a named group with no
		// pills announces nothing.
		expect(markup).toContain('aria-label="facets"');
		expect(markup).toContain('Develop');
	});

	it('marks the pinned badge as text, not colour alone', () => {
		const pinned = fixture.find((project) => project.pinned);
		const plain = fixture.find((project) => !project.pinned);
		expect(pinned).toBeDefined();
		expect(renderToStaticMarkup(<ProjectCard project={pinned as never} />)).toContain('Pinned');
		expect(renderToStaticMarkup(<ProjectCard project={plain as never} />)).not.toContain('Pinned');
	});
});
