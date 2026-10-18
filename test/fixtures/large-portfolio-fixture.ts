import type {
	PortfolioFacet,
	PortfolioListPage,
	PortfolioProject,
} from '../../src/portfolio/schema';

/**
 * Synthetic large-catalogue fixture for the `/portfolio` list
 * boundary (Issue #490).
 *
 * Why this exists
 * ---------------
 * The shipped catalogue is small (a handful of published rows),
 * so `/portfolio`'s pagination boundary — the default page size
 * and the "Load more" append path — is never exercised against
 * the size that would actually stress it. Issue #490 asks for a
 * 100+ row fixture so the initial render, the append, the DOM
 * node count, the JS heap and the accessibility invariants can
 * be measured on a representative list.
 *
 * These rows are SYNTHETIC ON PURPOSE
 * -----------------------------------
 * Nothing here is a real project, a real employer, a real date
 * range, or a real person. Every title / summary is a numbered
 * placeholder, the facets and technologies are drawn from the
 * closed enums, and the dates are a fixed constant. A
 * performance fixture must never be able to invent portfolio
 * facts, so nothing here can be mistaken for content that would
 * one day be published.
 *
 * Determinism
 * -----------
 * No `Math.random`, no `Date.now()`. Two calls with the same
 * `count` return byte-identical rows, so a measurement recorded
 * in `docs/verification/perf/large-list-pagination.md` can be
 * re-run and compared. `displayOrder` / `updatedAt` decrease
 * monotonically with the index, which is the canonical sort
 * order the D1 loader uses (`pinned DESC, display_order ASC,
 * updated_at DESC, id ASC`), so a fixture built here paginates
 * the same way rows read out of D1 would.
 *
 * Consumers
 * ---------
 *   - `src/portfolio/components/PortfolioList.pagination.client.test.tsx`
 *     (happy-dom; DOM count + a11y invariants at the boundary)
 *   - `docs/verification/perf/large-list-pagination.md`
 *     (the recorded browser measurement; same row count, same
 *     shape, seeded through the local D1 binding)
 */

/** Fixed clock so the fixture never depends on when it runs. */
export const FIXTURE_EPOCH_MS = 1_700_000_000_000;

/** Default catalogue size — Issue #490 requires "100+". */
export const LARGE_FIXTURE_SIZE = 120;

/** Default page size, mirroring `clampLimit`'s default in `src/portfolio/load.ts`. */
export const DEFAULT_PAGE_SIZE = 100;

const FACET_CYCLE: readonly PortfolioFacet[] = ['develop', 'design', 'video', 'other'];
const TECHNOLOGY_CYCLE: readonly string[] = [
	'TypeScript',
	'React',
	'Cloudflare Workers',
	'Panda CSS',
];

const slugify = (index: number): string => `fixture-project-${String(index).padStart(3, '0')}`;

/**
 * One synthetic public project row.
 *
 * `pinned` is true for every 10th row so the fixture exercises the
 * `pinned DESC` branch of the canonical sort order rather than a
 * uniform tail.
 */
export function buildFixtureProject(index: number): PortfolioProject {
	const pinned = index % 10 === 0;
	return {
		id: `fx-${String(index).padStart(4, '0')}`,
		slug: slugify(index),
		title: `Fixture project ${String(index).padStart(3, '0')}`,
		summary: `Synthetic row ${index} generated for the Issue #490 large-list boundary measurement. Not a real project.`,
		role: 'Synthetic fixture role',
		periodStart: FIXTURE_EPOCH_MS,
		periodEnd: null,
		periodLabel: '2026',
		motivationMd: '',
		architectureMd: null,
		constraintsMd: null,
		implementationMd: null,
		evidenceMd: null,
		retrospectiveMd: null,
		facets: [FACET_CYCLE[index % FACET_CYCLE.length] as PortfolioFacet],
		technologies: [TECHNOLOGY_CYCLE[index % TECHNOLOGY_CYCLE.length] as string],
		visibility: 'public',
		status: 'published',
		pinned,
		displayOrder: index,
		createdAt: FIXTURE_EPOCH_MS - index,
		updatedAt: FIXTURE_EPOCH_MS - index,
		links: [],
		media: [
			{
				id: `fx-media-${String(index).padStart(4, '0')}`,
				r2Key: `portfolio/${slugify(index)}/cover.webp`,
				contentType: 'image/webp',
				width: 1280,
				height: 720,
				alt: `Synthetic cover artwork for fixture project ${index}`,
				caption: null,
				isCover: true,
				displayOrder: 0,
				// No media host is configured in the local measurement
				// environment, so the list renders its documented
				// placeholder branch. The measurement therefore
				// records the text-only card shape — see the report.
				url: null,
			},
		],
	};
}

/** `count` deterministic synthetic public projects, in canonical sort order. */
export function buildLargePortfolioFixture(count = LARGE_FIXTURE_SIZE): PortfolioProject[] {
	return Array.from({ length: count }, (_, index) => buildFixtureProject(index));
}

/**
 * Split a catalogue into cursor-shaped pages, the way
 * `listPortfolioProjects` returns them: `pageSize` rows plus an
 * opaque cursor that is `null` only on the final page.
 *
 * The cursor here is a fixture-local token, not a real
 * `PortfolioCursor` encoding: `PortfolioList` only tests it for
 * presence, and the real encoding is covered by
 * `src/portfolio/load.test.ts`.
 */
export function toListPages(
	projects: readonly PortfolioProject[],
	pageSize = DEFAULT_PAGE_SIZE,
): PortfolioListPage[] {
	const pages: PortfolioListPage[] = [];
	for (let offset = 0; offset < projects.length; offset += pageSize) {
		const slice = projects.slice(offset, offset + pageSize);
		const isLast = offset + pageSize >= projects.length;
		pages.push({
			projects: slice,
			nextCursor: isLast ? null : `fixture-cursor:${offset + pageSize}`,
		});
	}
	return pages;
}
