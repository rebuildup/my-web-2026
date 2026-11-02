import { describe, expect, it } from 'vitest';
import type { NotionRecord, ReadSnapshot } from './contract';
import { compareProjects, isPublicRecord, publicProjects, publishedMedia } from './publish';

/**
 * Publication tests for CMS records (Issue #765).
 *
 * These are the tests that stand between a Notion checkbox and a public
 * URL, so each one asserts a refusal as often as it asserts a projection.
 */

function record(overrides: Partial<NotionRecord> = {}): NotionRecord {
	return {
		pageId: 'page-1',
		slug: 'sample-project',
		title: 'Sample Project',
		summary: 'One sentence.',
		role: 'Implementation',
		periodStart: 2024,
		periodEnd: null,
		periodLabel: '2024',
		facets: ['develop'],
		technologies: ['TypeScript'],
		status: 'published',
		visibility: 'public',
		pinned: false,
		displayOrder: 0,
		sections: {
			motivation: 'Why.',
			architecture: null,
			constraints: null,
			implementation: null,
			evidence: null,
			retrospective: null,
		},
		links: [],
		media: [],
		editedAt: '2026-10-24T03:12:00.000Z',
		...overrides,
	};
}

function media(
	overrides: Partial<NotionRecord['media'][number]> = {},
): NotionRecord['media'][number] {
	return {
		r2Key: 'portfolio/sample/cover.webp',
		contentType: 'image/webp',
		width: 1200,
		height: 630,
		alt: 'A sample cover',
		caption: null,
		isCover: false,
		displayOrder: 0,
		rights: 'recorded',
		...overrides,
	};
}

function snapshot(
	records: NotionRecord[],
	availability: ReadSnapshot['availability'] = 'public',
): ReadSnapshot {
	return {
		availability,
		unavailableReason: availability === 'unavailable' ? 'source_error' : null,
		fetchedAt: '2026-10-31T12:00:00.000Z',
		observedAt: '2026-10-31T12:00:00.000Z',
		records,
	};
}

describe('isPublicRecord', () => {
	it('requires both published status and public visibility', () => {
		expect(isPublicRecord(record())).toBe(true);
		expect(isPublicRecord(record({ visibility: 'unlisted' }))).toBe(false);
		expect(isPublicRecord(record({ visibility: 'draft' }))).toBe(false);
		expect(isPublicRecord(record({ status: 'draft' }))).toBe(false);
	});

	it('does not list an archived project, because the D1 boundary never does either', () => {
		expect(isPublicRecord(record({ status: 'archived' }))).toBe(false);
		expect(publicProjects(snapshot([record({ status: 'archived' })]))).toEqual([]);
	});
});

describe('publishedMedia', () => {
	it('drops every asset whose rights are not recorded', () => {
		const kept = publishedMedia(
			record({
				media: [
					media({ r2Key: 'portfolio/sample/a.webp', rights: 'recorded' }),
					media({ r2Key: 'portfolio/sample/b.webp', rights: 'unrecorded', displayOrder: 1 }),
				],
			}),
		);
		expect(kept.map((entry) => entry.r2Key)).toEqual(['portfolio/sample/a.webp']);
	});

	it('puts the cover first, then follows display order', () => {
		const kept = publishedMedia(
			record({
				media: [
					media({ r2Key: 'second', displayOrder: 1 }),
					media({ r2Key: 'cover', isCover: true, displayOrder: 9 }),
					media({ r2Key: 'third', displayOrder: 2 }),
				],
			}),
		);
		expect(kept.map((entry) => entry.r2Key)).toEqual(['cover', 'second', 'third']);
	});
});

describe('publicProjects', () => {
	it('publishes nothing from a null snapshot', () => {
		expect(publicProjects(null)).toEqual([]);
	});

	it('maps a published record into the shape the pages already render', () => {
		const [project] = publicProjects(snapshot([record()]));
		expect(project?.id).toBe('notion:page-1');
		expect(project?.slug).toBe('sample-project');
		expect(project?.motivationMd).toBe('Why.');
		expect(project?.updatedAt).toBe(Date.parse('2026-10-24T03:12:00.000Z'));
		// The loader owns the origin; a projection must not invent one.
		expect(project?.media).toEqual([]);
	});

	it('omits a draft rather than relabelling it', () => {
		expect(publicProjects(snapshot([record({ status: 'draft' })]))).toEqual([]);
	});

	it('omits an unlisted project from the list', () => {
		expect(publicProjects(snapshot([record({ visibility: 'unlisted' })]))).toEqual([]);
	});

	it('keeps the last known records while the source is unavailable', () => {
		expect(publicProjects(snapshot([record()], 'unavailable'))).toHaveLength(1);
	});

	it('never emits a URL for an asset with unrecorded rights', () => {
		const [project] = publicProjects(
			snapshot([record({ media: [media({ rights: 'unrecorded' })] })]),
		);
		expect(project?.media).toEqual([]);
	});
});

describe('compareProjects', () => {
	it('orders pinned first, then display order, then recency, then id', () => {
		const pinned = {
			pinned: true,
			displayOrder: 99,
			updatedAt: 1,
			id: 'notion:a',
		};
		const firstByOrder = { pinned: false, displayOrder: 1, updatedAt: 1, id: 'notion:b' };
		const secondByOrder = { pinned: false, displayOrder: 2, updatedAt: 99, id: 'notion:c' };
		const ordered = [secondByOrder, firstByOrder, pinned].sort(compareProjects);
		expect(ordered.map((entry) => entry.id)).toEqual(['notion:a', 'notion:b', 'notion:c']);
	});

	it('breaks a tie on the id so two equal sources stay stable', () => {
		const left = { pinned: false, displayOrder: 0, updatedAt: 5, id: 'notion:a' };
		const right = { pinned: false, displayOrder: 0, updatedAt: 5, id: 'notion:0' };
		expect([right, left].sort(compareProjects).map((entry) => entry.id)).toEqual([
			'notion:0',
			'notion:a',
		]);
	});
});
