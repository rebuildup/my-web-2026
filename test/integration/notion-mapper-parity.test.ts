import { describe, expect, it } from 'vitest';
import { mapDocuments } from '../../scripts/_notion-mapper.mjs';
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
