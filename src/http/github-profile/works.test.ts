import { describe, expect, it } from 'vitest';
import type { PortfolioProject } from '../../portfolio/schema';
import { WORK_ASSET_DIR, githubProfileWorks } from './works';
import manifest from './works.json';

/**
 * Works manifest contract (Issue #1196, ADR-0025): every curated slug
 * must resolve against the committed public portfolio snapshot, carry
 * a layout role, and point at the deterministic static asset path the
 * README embeds. A slug that leaves the published set drops out of
 * `githubProfileWorks()` — it must never render a placeholder.
 */

describe('githubProfileWorks', () => {
	it('resolves every manifest entry against the public snapshot', () => {
		const works = githubProfileWorks();
		expect(works.length).toBe(manifest.works.length);
		for (const work of works) {
			expect(work.title.length).toBeGreaterThan(0);
			expect(work.portfolioUrl).toBe(`https://rebuildup.dev/portfolio/${work.slug}`);
			expect(work.assetPath).toBe(`${WORK_ASSET_DIR}/${work.slug}.webp`);
		}
	});

	it('declares exactly one hero work', () => {
		const heroes = githubProfileWorks().filter((work) => work.role === 'hero');
		expect(heroes).toHaveLength(1);
		expect(heroes[0]?.slug).toBe('my-web-2025');
	});

	it('uses only hero/grid roles from the manifest', () => {
		const roles = new Set(manifest.works.map((entry) => entry.role));
		expect([...roles].sort()).toEqual(['grid', 'hero']);
	});

	it('skips slugs that are not publicly resolvable', () => {
		const works = githubProfileWorks([]);
		expect(works).toHaveLength(0);
	});

	it('skips projects that are not published+public even when passed in', () => {
		// Issue #1199: the resolver must fail closed on the publication
		// boundary itself, not trust the caller to pre-filter.
		const slug = manifest.works[0]?.slug;
		expect(slug).toBeDefined();
		const draft = {
			id: 'id-draft',
			slug,
			title: 'Draft',
			summary: 'Draft',
			role: 'Developer',
			periodStart: 2025,
			periodEnd: null,
			periodLabel: null,
			motivationMd: '',
			architectureMd: null,
			constraintsMd: null,
			implementationMd: null,
			evidenceMd: null,
			retrospectiveMd: null,
			facets: [],
			technologies: [],
			visibility: 'unlisted',
			status: 'published',
			evidenceStatus: 'unreviewed',
			pinned: false,
			displayOrder: 0,
			createdAt: 0,
			updatedAt: 0,
			links: [],
			media: [],
		} as PortfolioProject;
		expect(githubProfileWorks([draft])).toHaveLength(0);
	});
});
