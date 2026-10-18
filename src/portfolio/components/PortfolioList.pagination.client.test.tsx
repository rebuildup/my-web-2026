import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_PAGE_SIZE,
	LARGE_FIXTURE_SIZE,
	buildLargePortfolioFixture,
	toListPages,
} from '../../../test/fixtures/large-portfolio-fixture';
import { PortfolioList } from './PortfolioList';

/**
 * "Load more" pagination boundary on a 100+ row fixture (Issue #490).
 *
 * `list-scale.test.tsx` proves the per-card shape through static
 * markup in the workerd pool. This file proves the other half — the
 * INTERACTION — in a real DOM: the boundary control exists while a
 * next page is pending, pressing it asks for exactly one more page,
 * and the appended page lands in the list without duplicating or
 * reordering what was already there.
 *
 * The 100+ scale is the point. A 3-row fixture would pass the same
 * assertions while proving nothing about what happens at the loader's
 * default page size.
 *
 * `FacetFilter` is URL-synced through the TanStack router, which this
 * component-level test does not mount, so the router module is
 * stubbed. Everything else on the surface is the real thing.
 *
 * This file runs under `vitest.client.config.ts`
 * (`pnpm run test:client`), not under `validate:fast` — see
 * `docs/verification/perf/large-list-pagination.md` §5.
 */

vi.mock('@tanstack/react-router', () => ({
	useRouter: () => ({ navigate: vi.fn() }),
	useSearch: () => ({}),
}));

const pages = toListPages(buildLargePortfolioFixture(LARGE_FIXTURE_SIZE), DEFAULT_PAGE_SIZE);
const [firstPage, secondPage] = pages;

function renderList(overrides: Partial<Parameters<typeof PortfolioList>[0]> = {}) {
	return render(
		<PortfolioList
			initialPage={firstPage}
			activeFacets={[]}
			hasMore={firstPage.nextCursor !== null}
			busy={false}
			error={null}
			onLoadMore={() => {}}
			extra={[]}
			{...overrides}
		/>,
	);
}

describe('PortfolioList — 100+ row pagination boundary', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('renders a full first page and the boundary control', () => {
		renderList();
		expect(screen.getAllByRole('listitem')).toHaveLength(DEFAULT_PAGE_SIZE);
		const loadMore = screen.getByRole('button', { name: /load more/i });
		expect(loadMore.getAttribute('aria-busy')).toBe('false');
		expect(loadMore.hasAttribute('disabled')).toBe(false);
	});

	it('asks for exactly one more page per press', () => {
		const onLoadMore = vi.fn();
		renderList({ onLoadMore });
		screen.getByRole('button', { name: /load more/i }).click();
		expect(onLoadMore).toHaveBeenCalledTimes(1);
	});

	it('disables the control and marks it busy while a page is in flight', () => {
		renderList({ busy: true });
		const loadMore = screen.getByRole('button', { name: /loading/i });
		expect(loadMore.getAttribute('aria-busy')).toBe('true');
		expect((loadMore as HTMLButtonElement).disabled).toBe(true);
	});

	it('appends the second page without losing or duplicating the first', () => {
		const { rerender } = renderList();
		rerender(
			<PortfolioList
				initialPage={firstPage}
				activeFacets={[]}
				hasMore={secondPage.nextCursor !== null}
				busy={false}
				error={null}
				onLoadMore={() => {}}
				extra={secondPage.projects}
			/>,
		);
		const items = screen.getAllByRole('listitem');
		expect(items).toHaveLength(LARGE_FIXTURE_SIZE);
		// Order is preserved across the boundary: the first page is
		// still exactly the first page.
		expect(items[0].textContent).toContain(firstPage.projects[0].title);
		expect(items[firstPage.projects.length - 1].textContent).toContain(
			firstPage.projects[firstPage.projects.length - 1].title,
		);
		expect(items[firstPage.projects.length].textContent).toContain(secondPage.projects[0].title);
		expect(document.querySelectorAll('#portfolio-list ol > li')).toHaveLength(LARGE_FIXTURE_SIZE);
	});

	it('retires the control once the last page has been appended', () => {
		renderList({
			hasMore: false,
			extra: secondPage.projects,
		});
		expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
		expect(screen.getAllByRole('listitem')).toHaveLength(LARGE_FIXTURE_SIZE);
	});

	it('surfaces an append failure as an alert without dropping the loaded page', () => {
		renderList({ error: 'failed to load more', extra: secondPage.projects });
		expect(screen.getByRole('alert').textContent).toContain('failed to load more');
		expect(screen.getAllByRole('listitem')).toHaveLength(LARGE_FIXTURE_SIZE);
	});

	it('keeps the facet group of every card reachable as a named group', () => {
		const { container } = renderList();
		const groups = container.querySelectorAll(
			'#portfolio-list [role="group"][aria-label="facets"]',
		);
		expect(groups).toHaveLength(DEFAULT_PAGE_SIZE);
		// No labelled generic element survives anywhere in the list.
		for (const el of container.querySelectorAll('#portfolio-list [aria-label]')) {
			expect(el.getAttribute('role')).not.toBeNull();
		}
	});
});
