import { describe, expect, it } from 'vitest';
import {
	NOTION_SECTIONS,
	NOTION_SNAPSHOT_SCHEMA,
	NotionSnapshotSchema,
	parseSnapshot,
} from './contract';
import defaultSnapshot from './generated/snapshot.json';

/**
 * Contract tests for the Notion CMS snapshot (Issue #765).
 *
 * The reader is the gate (ADR-0018 §2.2), so every case here is about a
 * value the reader must **refuse**. A snapshot that validates but means
 * the wrong thing is the defect the contract exists to prevent.
 */

function record(overrides: Record<string, unknown> = {}) {
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

function snapshot(overrides: Record<string, unknown> = {}) {
	return {
		schema: NOTION_SNAPSHOT_SCHEMA,
		source: {
			databaseId: 'db-1',
			capabilities: ['read_content'],
			fetchedAt: '2026-10-31T12:00:00.000Z',
			sourceUrl: null,
		},
		availability: 'public',
		unavailableReason: null,
		observedAt: '2026-10-31T12:00:00.000Z',
		contentDigest: `sha256:${'0'.repeat(64)}`,
		records: [record()],
		...overrides,
	};
}

describe('NotionSnapshotSchema', () => {
	it('accepts a minimal published snapshot', () => {
		expect(NotionSnapshotSchema.safeParse(snapshot()).success).toBe(true);
	});

	it('accepts the committed default, which is explicitly unconfigured', () => {
		expect(NotionSnapshotSchema.safeParse(defaultSnapshot).success).toBe(true);
	});

	it('refuses a record with an unknown facet', () => {
		const result = NotionSnapshotSchema.safeParse(
			snapshot({ records: [record({ facets: ['photography'] })] }),
		);
		expect(result.success).toBe(false);
	});

	it('refuses a slug that is not the portfolio grammar', () => {
		const result = NotionSnapshotSchema.safeParse(
			snapshot({ records: [record({ slug: 'Sample_Project' })] }),
		);
		expect(result.success).toBe(false);
	});

	it('refuses a link kind this surface cannot render', () => {
		const result = NotionSnapshotSchema.safeParse(
			snapshot({
				records: [
					record({
						links: [{ kind: 'wiki', label: null, url: 'https://example.com', displayOrder: 0 }],
					}),
				],
			}),
		);
		expect(result.success).toBe(false);
	});

	it('refuses a malformed digest', () => {
		expect(
			NotionSnapshotSchema.safeParse(snapshot({ contentDigest: 'sha256:short' })).success,
		).toBe(false);
	});

	it('keeps the six section names stable', () => {
		expect([...NOTION_SECTIONS]).toEqual([
			'motivation',
			'architecture',
			'constraints',
			'implementation',
			'evidence',
			'retrospective',
		]);
	});
});

describe('parseSnapshot', () => {
	it('returns the reader shape for a valid snapshot', () => {
		const parsed = parseSnapshot(snapshot());
		expect(parsed).not.toBeNull();
		expect(parsed?.availability).toBe('public');
		expect(parsed?.records).toHaveLength(1);
	});

	it('returns null rather than defaults for anything unparseable', () => {
		expect(parseSnapshot(null)).toBeNull();
		expect(parseSnapshot({})).toBeNull();
		expect(parseSnapshot(snapshot({ schema: 'portfolio-notion-snapshot.v0' }))).toBeNull();
		expect(parseSnapshot(snapshot({ records: [record({ status: 'live' })] }))).toBeNull();
	});

	it('refuses an unavailable snapshot with no reason', () => {
		expect(
			parseSnapshot(snapshot({ availability: 'unavailable', unavailableReason: null })),
		).toBeNull();
	});

	it('refuses a reason attached to an available snapshot', () => {
		expect(parseSnapshot(snapshot({ unavailableReason: 'rate_limited' }))).toBeNull();
	});

	it('keeps the last known records while the source is unavailable', () => {
		const parsed = parseSnapshot(
			snapshot({ availability: 'unavailable', unavailableReason: 'source_error' }),
		);
		expect(parsed?.records).toHaveLength(1);
		expect(parsed?.unavailableReason).toBe('source_error');
	});
});

describe('committed snapshot', () => {
	it('is readable by the same gate the Worker uses', () => {
		const parsed = parseSnapshot(defaultSnapshot);
		expect(parsed).not.toBeNull();
	});

	it('publishes nothing before a database is connected', () => {
		const parsed = parseSnapshot(defaultSnapshot);
		expect(parsed?.records).toEqual([]);
		expect(parsed?.availability).toBe('unavailable');
	});
});
