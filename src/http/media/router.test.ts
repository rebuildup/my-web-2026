import { describe, expect, it } from 'vitest';
import type { MediaObjectBody, MediaObjectSource } from '../../cloudflare/media-visibility';
import { REACTION_IMAGE_CACHE_CONTROL } from '../reactions/images';
import {
	PORTFOLIO_MEDIA_CACHE_CONTROL,
	REACTION_MEDIA_CACHE_CONTROL,
	createMediaRouter,
	isApprovedMediaKey,
	isDeliverableMediaContentType,
	mediaCacheControlFor,
} from './router';

/**
 * The delivery gate's refusal contract (Issue #634).
 *
 * These tests use fakes for both dependencies, so each test states one
 * gate and one outcome. The request-level proof that the Worker entry
 * actually routes `/media/*` here lives in
 * `test/integration/media-delivery.test.ts`; this file is about the
 * decision, not the wiring.
 */

interface FakeObject {
	bytes: string;
	contentType?: string;
	cacheControl?: string;
}

function fakeSource(objects: Record<string, FakeObject>): MediaObjectSource {
	return {
		async get(key: string): Promise<MediaObjectBody | null> {
			const object = objects[key];
			if (!object) return null;
			return {
				body: new Response(object.bytes).body,
				httpEtag: `"etag-${key}"`,
				httpMetadata: {
					contentType: object.contentType ?? 'image/webp',
					cacheControl: object.cacheControl,
				},
			};
		},
	};
}

/** Only the two approval queries run; both answer from one key set. */
function fakeDb(approved: Iterable<string>): D1Database {
	const set = new Set(approved);
	const seen: string[] = [];
	const db = {
		prepare(sql: string) {
			seen.push(sql);
			return {
				bind(value: string) {
					return {
						async first() {
							return set.has(value) ? { one: 1 } : null;
						},
					};
				},
			};
		},
	};
	Object.defineProperty(db, 'seenSql', { value: seen });
	return db as unknown as D1Database;
}

const ENV_BASE = {} as Env;

function request(
	path: string,
	env: { DB: D1Database; MEDIA: MediaObjectSource },
	method = 'GET',
): Promise<Response> {
	const app = createMediaRouter();
	return Promise.resolve(app.request(path, { method }, { ...ENV_BASE, ...env } as unknown as Env));
}

const APPROVED_KEY = 'portfolio/published/cover.webp';
const REACTION_KEY = `reactions/${'a'.repeat(64)}.webp`;

function standardSource(): MediaObjectSource {
	return fakeSource({
		[APPROVED_KEY]: { bytes: 'approved-bytes' },
		[REACTION_KEY]: { bytes: 'reaction-bytes', contentType: 'image/webp' },
		'private/secret.webp': { bytes: 'secret-bytes' },
		'unlisted/thing.webp': { bytes: 'unlisted-bytes' },
		'portfolio/published/page.html': { bytes: '<html>', contentType: 'text/html' },
	});
}

describe('GET /media/<key>', () => {
	it('serves an approved key with its stored metadata', async () => {
		const response = await request(`/media/${APPROVED_KEY}`, {
			DB: fakeDb([APPROVED_KEY]),
			MEDIA: standardSource(),
		});
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('approved-bytes');
		expect(response.headers.get('content-type')).toBe('image/webp');
		expect(response.headers.get('cache-control')).toBe(PORTFOLIO_MEDIA_CACHE_CONTROL);
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('etag')).toBe(`"etag-${APPROVED_KEY}"`);
	});

	it('keeps a stored cache-control instead of the default', async () => {
		const source = fakeSource({
			[APPROVED_KEY]: { bytes: 'x', cacheControl: 'public, max-age=86400' },
		});
		const response = await request(`/media/${APPROVED_KEY}`, {
			DB: fakeDb([APPROVED_KEY]),
			MEDIA: source,
		});
		expect(response.headers.get('cache-control')).toBe('public, max-age=86400');
	});

	it('gives a content-addressed reaction key the immutable default', async () => {
		const response = await request(`/media/${REACTION_KEY}`, {
			DB: fakeDb([REACTION_KEY]),
			MEDIA: standardSource(),
		});
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe(REACTION_MEDIA_CACHE_CONTROL);
	});

	it.each([
		// The draft-project case is the same shape as this one in the
		// unit fake (an existing object the approval check rejects);
		// the real `status` / `visibility` distinction is fixed at the
		// request level in `test/integration/media-delivery.test.ts`.
		['unapproved published-namespace key', APPROVED_KEY, []],
		['declared private namespace', 'private/secret.webp', ['private/secret.webp']],
		['undeclared namespace', 'unlisted/thing.webp', ['unlisted/thing.webp']],
		['traversal attempt', 'portfolio/../private/secret.webp', ['portfolio/../private/secret.webp']],
		['approved key with no object', 'portfolio/gone/cover.webp', ['portfolio/gone/cover.webp']],
	])('%s answers the shared 404', async (_label, key, approved) => {
		const response = await request(`/media/${key}`, {
			DB: fakeDb(approved),
			MEDIA: standardSource(),
		});
		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.text()).toBe('');
	});

	it('refuses an approved key whose object is not a media type', async () => {
		const key = 'portfolio/published/page.html';
		const response = await request(`/media/${key}`, {
			DB: fakeDb([key]),
			MEDIA: standardSource(),
		});
		expect(response.status).toBe(404);
		expect(await response.text()).toBe('');
	});

	it('answers HEAD with the same headers and no body', async () => {
		const response = await request(
			`/media/${APPROVED_KEY}`,
			{ DB: fakeDb([APPROVED_KEY]), MEDIA: standardSource() },
			'HEAD',
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/webp');
		expect(await response.text()).toBe('');
	});

	it('asks the bucket for metadata only on HEAD', async () => {
		let heads = 0;
		let gets = 0;
		const source: MediaObjectSource = {
			async get() {
				gets += 1;
				return { body: new Response('never-downloaded').body };
			},
			async head() {
				heads += 1;
				return { httpEtag: '"head-etag"', httpMetadata: { contentType: 'image/webp' } };
			},
		};
		const response = await request(
			`/media/${APPROVED_KEY}`,
			{ DB: fakeDb([APPROVED_KEY]), MEDIA: source },
			'HEAD',
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('etag')).toBe('"head-etag"');
		expect(await response.text()).toBe('');
		expect(heads).toBe(1);
		expect(gets).toBe(0);
	});
});

describe('approval composition', () => {
	it('asks the portfolio owner for a portfolio key', async () => {
		const db = fakeDb([APPROVED_KEY]) as D1Database & { seenSql: string[] };
		expect(await isApprovedMediaKey(db, APPROVED_KEY)).toBe(true);
		expect(db.seenSql.join('\n')).toContain('portfolio_media');
	});

	it('asks the reactions owner for a reactions key', async () => {
		const db = fakeDb([REACTION_KEY]) as D1Database & { seenSql: string[] };
		expect(await isApprovedMediaKey(db, REACTION_KEY)).toBe(true);
		expect(db.seenSql.join('\n')).toContain('reaction_images');
	});

	it('refuses a key outside both owned namespaces without a query', async () => {
		const db = fakeDb([]) as D1Database & { seenSql: string[] };
		expect(await isApprovedMediaKey(db, 'other/thing.webp')).toBe(false);
		expect(db.seenSql).toHaveLength(0);
	});
});

describe('content type and cache defaults', () => {
	it('reuses the reactions owner’s immutable policy', () => {
		// One literal, owned by the module that writes and reads the
		// header elsewhere; this delivery path must not diverge.
		expect(REACTION_MEDIA_CACHE_CONTROL).toBe(REACTION_IMAGE_CACHE_CONTROL);
	});

	it('accepts only the media types the producers write', () => {
		for (const type of ['image/webp', 'image/png', 'image/jpeg', 'image/gif', 'video/mp4']) {
			expect(isDeliverableMediaContentType(type)).toBe(true);
		}
		for (const type of ['text/html', 'image/svg+xml', 'application/octet-stream', '']) {
			expect(isDeliverableMediaContentType(type)).toBe(false);
		}
		expect(isDeliverableMediaContentType('IMAGE/WEBP; charset=binary')).toBe(true);
	});

	it('falls back by namespace only when no stored policy exists', () => {
		expect(mediaCacheControlFor('portfolio/a.webp', null)).toBe(PORTFOLIO_MEDIA_CACHE_CONTROL);
		expect(mediaCacheControlFor('reactions/a.webp', '  ')).toBe(REACTION_MEDIA_CACHE_CONTROL);
		expect(mediaCacheControlFor('portfolio/a.webp', 'private, max-age=0')).toBe(
			'private, max-age=0',
		);
	});
});
