import { describe, expect, it } from 'vitest';
import { mapDocuments, toContractMedia } from '../../scripts/_notion-mapper.mjs';
import fixture from '../../scripts/fixtures/notion-portfolio/portfolio.json';
import { NOTION_SNAPSHOT_SCHEMA, parseSnapshot } from '../../src/portfolio/notion/contract';
import { publicProjects } from '../../src/portfolio/notion/publish';

/**
 * Parity between the offline mapper and the runtime contract (Issue #765).
 *
 * The sync runs as a Node script (`scripts/sync-portfolio-notion.mjs`) and
 * the Worker validates its output with `src/portfolio/notion/contract.ts`.
 * Those two halves are in different languages of record — plain JavaScript
 * on one side, zod on the other — so nothing but this test proves they
 * still agree.
 *
 * Why the test is worth its cost: a mapping change that the contract
 * rejects would not fail the build. The Worker would read the snapshot,
 * refuse it, and publish nothing — fail-closed, and silent. This test
 * turns "silent" into a red suite at the point the change lands.
 *
 * `--fixture` mode runs the same `mapDocuments` this test calls, so the
 * fixture is not a parallel implementation of the sync: it is the sync,
 * minus the network.
 */

function buildSnapshot(records: unknown[]) {
	return {
		schema: NOTION_SNAPSHOT_SCHEMA,
		source: {
			databaseId: fixture.databaseId,
			capabilities: ['read_content'],
			fetchedAt: '2026-10-31T12:00:00.000Z',
			sourceUrl: null,
		},
		availability: 'public',
		unavailableReason: null,
		observedAt: '2026-10-31T12:00:00.000Z',
		contentDigest: `sha256:${'a'.repeat(64)}`,
		records,
	};
}

/**
 * The same fixture page with an image and a bookmark written into it
 * (Issue #889). The image URL is shaped like the real thing — signed,
 * expiring, query-heavy — because the point of this block is that such an
 * address must not survive into the snapshot.
 */
function documentWithMedia() {
	const page = structuredClone(fixture.pages[0]);
	const blocks: unknown[] = [
		...page.blocks,
		{
			object: 'block',
			id: 'img-1',
			type: 'image',
			image: {
				type: 'file',
				file: {
					url: 'https://secure.notion-static.com/obj?X-Amz-Signature=cafebabe',
					expiry_time: '2026-11-04T14:00:00.000Z',
				},
				caption: [{ type: 'text', text: { content: 'A cat' } }],
			},
		},
		{
			object: 'block',
			id: 'bm-1',
			type: 'bookmark',
			bookmark: { url: 'https://example.com/reference', caption: [] },
		},
	];
	return { ...page, blocks };
}

describe('Notion fixture → runtime contract', () => {
	it('maps the committed fixture without a refusal', () => {
		const { errors } = mapDocuments(fixture.pages);
		expect(errors).toEqual([]);
	});

	it('produces a document the Worker contract accepts', () => {
		const { records } = mapDocuments(fixture.pages);
		const parsed = parseSnapshot(buildSnapshot(records));
		expect(parsed).not.toBeNull();
		expect(parsed?.records).toHaveLength(records.length);
	});

	it('publishes exactly the records Notion marks published and public', () => {
		const { records } = mapDocuments(fixture.pages);
		const parsed = parseSnapshot(buildSnapshot(records));
		const published = publicProjects(parsed).map((project) => project.slug);
		expect(published.sort()).toEqual(['sample-doc-site', 'sample-motion-study']);
		// The third fixture page is a draft with unlisted visibility; it must
		// not reach a public surface even though its slug is well-formed.
		expect(published).not.toContain('sample-work-in-progress');
	});
});

describe('resolved media → runtime contract (Issue #889)', () => {
	/** The descriptor shape `mapDocuments` returns, mirrored for TS. */
	interface MediaDescriptor {
		pageId: string;
		blockId: string;
		source: string;
		url: string;
		contentType: string | null;
		caption: string | null;
		alt: string;
		isCover: boolean;
		displayOrder: number;
	}

	/** What the ingest does with a descriptor, minus the network. */
	function resolve(records: readonly Record<string, unknown>[], media: readonly object[]) {
		// `mapDocuments` is JavaScript with a JSDoc return type of
		// `Array<object>`; the descriptor shape is asserted here, once.
		const descriptors = media as MediaDescriptor[];
		return records.map((record) => ({
			...record,
			media: descriptors
				.filter((descriptor) => descriptor.pageId === record.pageId)
				.map((descriptor) =>
					toContractMedia(descriptor, {
						r2Key: `portfolio/notion/${'b'.repeat(64)}.png`,
						contentType: 'image/png',
						rights: 'unrecorded',
					}),
				),
		}));
	}

	it('keeps the descriptor out of the record the snapshot carries', () => {
		const { records, media, errors } = mapDocuments([documentWithMedia()]);
		expect(errors).toEqual([]);
		expect(media).toHaveLength(1);
		expect(records[0].media).toEqual([]);
	});

	it('produces a document the Worker contract accepts with media attached', () => {
		const { records, media } = mapDocuments([documentWithMedia()]);
		const parsed = parseSnapshot(buildSnapshot(resolve(records, media)));
		expect(parsed).not.toBeNull();
		const [mediaEntry] = parsed?.records[0]?.media ?? [];
		expect(mediaEntry?.r2Key).toMatch(/^portfolio\/notion\/[0-9a-f]{64}\.png$/u);
		expect(mediaEntry?.contentType).toBe('image/png');
		expect(mediaEntry?.alt).toBe('A cat');
		expect(mediaEntry?.caption).toBe('A cat');
		expect(mediaEntry?.isCover).toBe(true);
		expect(mediaEntry?.displayOrder).toBe(0);
		// Published as unreviewed, never upgraded (ADR-0019 / Issue #811).
		expect(mediaEntry?.rights).toBe('unrecorded');
		expect(mediaEntry?.width).toBeNull();
		expect(mediaEntry?.height).toBeNull();
	});

	it('never carries the expiring Notion address into the media entry', () => {
		const { records, media } = mapDocuments([documentWithMedia()]);
		const resolved = resolve(records, media);
		const mediaJson = JSON.stringify(resolved[0].media);
		expect(mediaJson).not.toMatch(/https?:\/\//u);
		expect(mediaJson).not.toContain('X-Amz');
		expect(mediaJson).not.toContain('notion-static');
		expect(mediaJson).not.toContain('url');
		// The bookmark, by contrast, is content and does reach the body.
		expect(JSON.stringify(resolved)).toContain('https://example.com/reference');
	});

	it('refuses media whose key is a URL rather than an object name', () => {
		const { records, media } = mapDocuments([documentWithMedia()]);
		const resolved = resolve(records, media);
		resolved[0].media[0].r2Key = 'https://secure.notion-static.com/obj?X-Amz-Signature=cafebabe';
		expect(parseSnapshot(buildSnapshot(resolved))).toBeNull();
	});
});
