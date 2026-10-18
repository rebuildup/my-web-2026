import { describe, expect, it } from 'vitest';
import { ABOUT_DATA } from '../about/data';
import { personFactsFromAbout } from '../about/structured-data';
import { buildCreativeWorkNode, validateStructuredData } from '../editorial/structured-data';
import type { PortfolioMedia, PortfolioProject } from './schema';
import { creativeWorkFactsFromProject, structuredDateFromPeriodLabel } from './structured-data';

/**
 * Portfolio row → `CreativeWork` projection (Issue #422).
 *
 * The row fixture mirrors `src/portfolio/seed.ts#aulymo`, whose
 * period label records a YEAR (`2022 - present`). The projected
 * `dateCreated` is therefore `2022`, not `2022-01-01`: the day in
 * `period_start` is a storage convention, and widening it would
 * fabricate a date the source never recorded.
 */

const AUTHOR = personFactsFromAbout(ABOUT_DATA);

const MEDIA: PortfolioMedia = {
	id: 'm-1',
	r2Key: 'portfolio/aulymo.webp',
	contentType: 'image/webp',
	width: 1200,
	height: 630,
	alt: 'Aulymo interface',
	caption: null,
	isCover: true,
	displayOrder: 0,
	url: null,
};

const PROJECT: PortfolioProject = {
	id: 'p-aulymo',
	slug: 'aulymo',
	title: 'Aulymo — After Effects lyric motion tool',
	summary: 'After Effects で lyric motion を作るための tool。',
	role: 'Solo developer / distributor',
	periodStart: Date.UTC(2022, 0, 1),
	periodEnd: null,
	periodLabel: '2022 - present',
	motivationMd: '',
	architectureMd: null,
	constraintsMd: null,
	implementationMd: null,
	evidenceMd: null,
	retrospectiveMd: null,
	facets: ['develop', 'design'],
	technologies: ['After Effects'],
	visibility: 'public',
	status: 'published',
	pinned: false,
	displayOrder: 10,
	createdAt: Date.UTC(2026, 0, 2),
	updatedAt: Date.UTC(2026, 0, 2),
	links: [],
	media: [],
};

describe('creativeWorkFactsFromProject', () => {
	it('projects the canonical project url', () => {
		expect(creativeWorkFactsFromProject(PROJECT).url).toBe(
			'https://rebuildup.dev/portfolio/aulymo',
		);
	});

	it('keeps the row precision instead of the storage day component', () => {
		expect(creativeWorkFactsFromProject(PROJECT).dateCreated).toBe('2022');
	});

	it('drops the cover image when the media url is not composed (unbound R2)', () => {
		const node = buildCreativeWorkNode(creativeWorkFactsFromProject(PROJECT), AUTHOR);
		expect(node).not.toHaveProperty('image');
	});

	it('includes the cover image when a url exists', () => {
		const withMedia = {
			...PROJECT,
			media: [{ ...MEDIA, url: 'https://media.rebuildup.dev/a.webp' }],
		};
		const node = buildCreativeWorkNode(creativeWorkFactsFromProject(withMedia), AUTHOR);
		expect(node?.image).toBe('https://media.rebuildup.dev/a.webp');
	});

	it('validates clean against the declared contract', () => {
		const node = buildCreativeWorkNode(creativeWorkFactsFromProject(PROJECT), AUTHOR);
		const validation = validateStructuredData([node], {
			approvedSameAs: ABOUT_DATA.externalHandles.map((handle) => handle.href),
		});
		expect(validation.findings).toEqual([]);
		expect(validation.valid).toBe(true);
	});

	it('carries no keyword / award claim', () => {
		const node = buildCreativeWorkNode(creativeWorkFactsFromProject(PROJECT), AUTHOR);
		expect(node).not.toHaveProperty('keywords');
		expect(JSON.stringify(node)).not.toContain('award');
	});
});

describe('structuredDateFromPeriodLabel', () => {
	it.each([
		['2022 - present', '2022'],
		['2025-09 - present', '2025-09'],
		['2026 夏 (Summer 2026)', '2026'],
		['2024-06 - 2026-08', '2024-06'],
	])('derives %s → %s', (label, expected) => {
		expect(structuredDateFromPeriodLabel(label)).toBe(expected);
	});

	it.each([null, '', '   ', 'n/a', '2025-13 - present', '20250'])(
		'fails closed for %j',
		(label) => {
			expect(structuredDateFromPeriodLabel(label)).toBeUndefined();
		},
	);
});
