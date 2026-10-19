/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyPortfolioSchema, seedPortfolioRow } from './fixtures/portfolio-d1';

/**
 * `/media/<key>` at the Worker entry (Issue #634).
 *
 * The unit suite proves the decision with fakes. This suite proves the
 * half only a real request can: `src/server.ts` hands `/media/*` to
 * the Hono boundary, the Hono boundary reaches the delivery router,
 * the router asks D1 for the owning obligation's approval, and the
 * answer is the status a visitor sees.
 *
 * The bucket deliberately contains one object for every refusal case,
 * so "404" cannot be an artefact of a missing object: an unapproved
 * key that does not exist and an unapproved key that does exist must
 * be indistinguishable from outside.
 */
const PUBLISHED_KEY = 'portfolio/published/cover.webp';
const DRAFT_KEY = 'portfolio/draft/cover.webp';
const ARCHIVED_KEY = 'portfolio/archived/cover.webp';
const GUESSED_KEY = 'portfolio/published/cover-2.webp';
const PRIVATE_KEY = 'private/secret.webp';
const UNLISTED_KEY = 'unlisted/thing.webp';
const HTML_KEY = 'portfolio/published/page.html';
const REACTION_KEY = `reactions/${'b'.repeat(64)}.webp`;
const REACTION_ORPHAN_KEY = `reactions/${'c'.repeat(64)}.webp`;

const REACTION_IMAGES_DDL = `CREATE TABLE IF NOT EXISTS reaction_images (
	id TEXT PRIMARY KEY,
	content_hash TEXT UNIQUE NOT NULL,
	content_type TEXT NOT NULL,
	size INTEGER NOT NULL,
	r2_key TEXT NOT NULL,
	uploaded_by TEXT NOT NULL,
	uploaded_at INTEGER NOT NULL
)`;

async function seedMedia(
	projectId: string,
	id: string,
	key: string,
	contentType: string,
): Promise<void> {
	await env.DB.prepare(
		`INSERT INTO portfolio_media
		   (id, project_id, r2_key, content_type, width, height, alt, caption, is_cover, display_order, created_at)
		 VALUES (?1, ?2, ?3, ?4, NULL, NULL, 'alt', NULL, 0, 0, ?5)`,
	)
		.bind(id, projectId, key, contentType, Date.now())
		.run();
}

beforeAll(async () => {
	await applyPortfolioSchema(env.DB);
	await env.DB.prepare(REACTION_IMAGES_DDL).run();

	const publishedId = await seedPortfolioRow(env.DB, 'published');
	const draftId = await seedPortfolioRow(env.DB, 'draft', { visibility: 'draft' });
	// Archived but `visibility: 'public'`: the approval query requires
	// BOTH columns, and each refusal case must be able to fail on its
	// own. Without this row, dropping `status = 'published'` from the
	// query would keep the draft case green.
	const archivedId = await seedPortfolioRow(env.DB, 'archived', { status: 'archived' });

	await seedMedia(publishedId, 'm_published', PUBLISHED_KEY, 'image/webp');
	await seedMedia(publishedId, 'm_html', HTML_KEY, 'text/html');
	await seedMedia(draftId, 'm_draft', DRAFT_KEY, 'image/webp');
	await seedMedia(archivedId, 'm_archived', ARCHIVED_KEY, 'image/webp');

	await env.DB.prepare(
		`INSERT INTO reaction_images (id, content_hash, content_type, size, r2_key, uploaded_by, uploaded_at)
		 VALUES ('img_1', 'hash-1', 'image/webp', 10, ?1, 'operator', ?2)`,
	)
		.bind(REACTION_KEY, Date.now())
		.run();

	const put = (key: string, bytes: string, contentType = 'image/webp') =>
		env.MEDIA.put(key, bytes, { httpMetadata: { contentType } });
	await put(PUBLISHED_KEY, 'published-bytes');
	await put(DRAFT_KEY, 'draft-bytes');
	await put(ARCHIVED_KEY, 'archived-bytes');
	await put(GUESSED_KEY, 'guessed-bytes');
	await put(PRIVATE_KEY, 'private-bytes');
	await put(UNLISTED_KEY, 'unlisted-bytes');
	await put(HTML_KEY, '<html>not media</html>', 'text/html');
	await put(REACTION_KEY, 'reaction-bytes');
	await put(REACTION_ORPHAN_KEY, 'orphan-bytes');
});

function fetchKey(key: string, method = 'GET'): Promise<Response> {
	return SELF.fetch(`https://example.com/media/${key}`, { method });
}

describe('the Worker serves only approved media keys', () => {
	it('serves an approved portfolio key through the Worker', async () => {
		const response = await fetchKey(PUBLISHED_KEY);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('published-bytes');
		expect(response.headers.get('content-type')).toBe('image/webp');
		expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	}, 30_000);

	it('serves a content-addressed reaction key as immutable', async () => {
		const response = await fetchKey(REACTION_KEY);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('reaction-bytes');
		expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
	}, 30_000);

	it.each([
		['key of a draft project', DRAFT_KEY],
		['key of an archived project with public visibility', ARCHIVED_KEY],
		['sequential guess next to a published key', GUESSED_KEY],
		['declared private namespace', PRIVATE_KEY],
		['undeclared namespace', UNLISTED_KEY],
		['reaction object with no row', REACTION_ORPHAN_KEY],
		['approved row with a non-media content type', HTML_KEY],
	])(
		'%s is the same empty 404',
		async (_label, key) => {
			const response = await fetchKey(key);
			expect(response.status).toBe(404);
			expect(await response.text()).toBe('');
			expect(response.headers.get('cache-control')).toBe('no-store');
		},
		30_000,
	);

	it('answers HEAD for an approved key with no body', async () => {
		const response = await fetchKey(PUBLISHED_KEY, 'HEAD');
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('');
		expect(response.headers.get('content-type')).toBe('image/webp');
	}, 30_000);

	it('does not turn the bucket into a listing surface', async () => {
		const response = await SELF.fetch('https://example.com/media/portfolio/published/');
		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain('cover.webp');
	}, 30_000);
});
