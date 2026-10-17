/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	createPublicMediaDelivery,
	isPublicMediaKey,
	listPublicMediaKeys,
	sequentialGuessKeys,
} from '../../src/cloudflare/media-visibility';
import { getImageStream, uploadImage } from '../../src/http/reactions/images';
import { composeMediaUrl } from '../../src/portfolio/media';

/**
 * R2 public / private object boundary, executed against the local
 * workerd R2 binding (Issue #459).
 *
 * The threat this file exists for: the `MEDIA` bucket is delivered
 * through a **public R2 custom domain**, so the Cloudflare edge serves
 * any key that exists. Two attacks follow, and both are run here
 * against real objects rather than a mock:
 *
 *   1. **Enumeration** — walk `bucket.list()` and see which unpublished
 *      objects exist.
 *   2. **Sequential guessing** — probe the predictable published-key
 *      layout (`portfolio/<slug>/cover-<n>.webp`) for unpublished
 *      material.
 *
 * Everything runs against the local Miniflare R2 fixture. No production
 * bucket, no deploy, no remote mutation: `env.MEDIA` here is the
 * test-pool binding declared in `vitest.config.ts`.
 *
 * Fixture objects (all synthetic bytes, no personal content):
 *
 *   portfolio/aulymo/cover.webp        published      → served
 *   portfolio/aulymo/cover-3.webp      present, NOT published → refused
 *   portfolio/aulymo/cover-17.webp     present, NOT published → refused
 *   private/draft/secret.webp          private        → refused
 *   staging/wip.webp                   private        → refused
 *   wip/unlisted.webp                  unlisted       → refused
 */

const R2 = () => env.MEDIA;
const D1 = () => env.DB;

/** Public namespaces the fixture writes into. */
const FIXTURE_PREFIXES = ['portfolio/aulymo/', 'private/', 'staging/', 'wip/', 'reactions/'];

const PUBLISHED_KEY = 'portfolio/aulymo/cover.webp';
const UNPUBLISHED_KEYS = ['portfolio/aulymo/cover-3.webp', 'portfolio/aulymo/cover-17.webp'];
const PRIVATE_KEYS = ['private/draft/secret.webp', 'staging/wip.webp'];
const UNLISTED_KEY = 'wip/unlisted.webp';

/** Approval predicate standing in for "the D1 row says published". */
const isPublished = async (key: string) => key === PUBLISHED_KEY;

const MIGRATIONS = [
	{
		name: '0003_reactions_for_visibility',
		queries: [
			`CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY,
        target_key TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        principal TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('emoji', 'image')),
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (target_key, principal, actor_id, kind, value)
    )`,
			`CREATE TABLE IF NOT EXISTS reaction_images (
        id TEXT PRIMARY KEY,
        content_hash TEXT UNIQUE NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        r2_key TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL
    )`,
		],
	},
];

/** 1×1 PNG. Synthetic; the boundary tests never decode pixels. */
const PNG_BYTES = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
	0x42, 0x60, 0x82,
]);

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

beforeAll(async () => {
	await applyD1Migrations(D1(), MIGRATIONS);
	// Seed the local fixture. `list` is only used to find leftovers of
	// a previous run in THIS test bucket; nothing leaves the machine.
	for (const prefix of FIXTURE_PREFIXES) {
		const listed = await R2().list({ prefix });
		for (const object of listed.objects) await R2().delete(object.key);
	}
	const fixtureKeys = [PUBLISHED_KEY, ...UNPUBLISHED_KEYS, ...PRIVATE_KEYS, UNLISTED_KEY];
	for (const key of fixtureKeys) {
		await R2().put(key, asArrayBuffer(PNG_BYTES), {
			httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000' },
		});
	}
});

describe('gated delivery — the published object is served', () => {
	it('serves the published key with its stored metadata', async () => {
		const delivery = createPublicMediaDelivery(R2(), { isApproved: isPublished });
		const result = await delivery.fetch(PUBLISHED_KEY);
		expect(result.status).toBe(200);
		if (result.status !== 200) return;
		expect(result.reason).toBe('served');
		expect(result.contentType).toBe('image/png');
	});
});

describe('gated delivery — unpublished and private objects are refused', () => {
	it.each([...UNPUBLISHED_KEYS, ...PRIVATE_KEYS, UNLISTED_KEY])(
		'refuses %s with 404 although the object exists in the bucket',
		async (key) => {
			// Precondition: the object really is in the local bucket, so
			// the 404 below is the boundary and not a missing fixture.
			expect(await R2().head(key)).not.toBeNull();

			const delivery = createPublicMediaDelivery(R2(), { isApproved: isPublished });
			const result = await delivery.fetch(key);
			expect(result.status).toBe(404);
			if (result.status !== 404) return;
			expect(['private_namespace', 'unlisted_namespace', 'refused_unapproved']).toContain(
				result.reason,
			);
		},
	);

	it('never reaches the bucket for a refused key', async () => {
		// The refusal happens before `get`, so a private key cannot
		// even be used as a read-timing oracle.
		let reads = 0;
		const delivery = createPublicMediaDelivery(
			{
				get: async () => {
					reads += 1;
					return null;
				},
			},
			{ isApproved: isPublished },
		);
		await delivery.fetch(PRIVATE_KEYS[0]);
		await delivery.fetch(UNLISTED_KEY);
		await delivery.fetch('../portfolio/aulymo/cover.webp');
		expect(reads).toBe(0);
	});
});

describe('enumeration — bucket listing leaks nothing', () => {
	it('withholds private and unpublished keys from a listing walk', async () => {
		const listing = await listPublicMediaKeys(R2(), { isApproved: isPublished });
		expect(listing.keys).toEqual([PUBLISHED_KEY]);
		expect(listing.keys).not.toContain(UNPUBLISHED_KEYS[0]);
		for (const key of PRIVATE_KEYS) expect(listing.keys).not.toContain(key);
		expect(listing.withheld).toBeGreaterThan(0);
		// Withheld objects are counted, never named: the audit output
		// must not become a secondary disclosure channel.
		expect(JSON.stringify(listing)).not.toContain('secret.webp');
		expect(JSON.stringify(listing)).not.toContain('cover-3.webp');
	});

	it('a raw bucket listing does see them — which is why the app never exposes one', async () => {
		// The counter-test that keeps the suite honest: without the
		// filter, the private fixture keys ARE enumerable. The control
		// has to fail for the assertion above to mean anything.
		const raw = await R2().list();
		const rawKeys = raw.objects.map((object) => object.key);
		expect(rawKeys).toContain(PRIVATE_KEYS[0]);
		expect(rawKeys).toContain(UNPUBLISHED_KEYS[0]);
	});
});

describe('sequential guessing — cover-<n> sweep', () => {
	it('answers every probed key with 404 across the published key layout', async () => {
		const candidates = sequentialGuessKeys('aulymo', 40);
		// Two of the forty objects really exist in the bucket.
		expect(candidates).toContain(UNPUBLISHED_KEYS[0]);
		expect(candidates).toContain(UNPUBLISHED_KEYS[1]);

		const delivery = createPublicMediaDelivery(R2(), { isApproved: isPublished });
		const results = await Promise.all(candidates.map((key) => delivery.fetch(key)));

		const served = results.filter((result) => result.status === 200);
		// The sweep walks straight over both unpublished objects and
		// learns nothing about either of them.
		expect(served).toHaveLength(0);
		expect(results.every((result) => result.status === 200 || result.status === 404)).toBe(true);

		// Control: the one published cover in the same namespace IS
		// served, so the 404s above are the boundary and not a broken
		// delivery path.
		const control = await delivery.fetch(PUBLISHED_KEY);
		expect(control.status).toBe(200);
	});

	it('does not leak existence through the response shape', async () => {
		const delivery = createPublicMediaDelivery(R2(), { isApproved: isPublished });
		const hit = await delivery.fetch(UNPUBLISHED_KEYS[0]);
		const miss = await delivery.fetch('portfolio/aulymo/cover-9999.webp');
		expect(hit.status).toBe(404);
		expect(miss.status).toBe(404);
		expect(Object.keys(hit).sort()).toEqual(Object.keys(miss).sort());
	});
});

describe('URL composition — namespace gate at the composition point', () => {
	const env = {
		MEDIA: R2(),
		MEDIA_PUBLIC_BASE_URL: 'https://media.example.com',
	};

	it('composes a URL for a public-namespace key', () => {
		expect(composeMediaUrl(env, PUBLISHED_KEY)).toBe(`https://media.example.com/${PUBLISHED_KEY}`);
		// A draft project's cover is a well-formed key inside the
		// `portfolio/` namespace, and composition has no row to ask.
		// The publication decision is made one layer up: the loader
		// (`src/portfolio/load.ts`) filters to
		// `status='published' AND visibility='public'`, so a draft
		// project's media row never reaches composition at all. The
		// adapter's approval gate is the same decision, stated for a
		// caller that does hold an unpublished key.
		expect(composeMediaUrl(env, UNPUBLISHED_KEYS[0])).toBe(
			`https://media.example.com/${UNPUBLISHED_KEYS[0]}`,
		);
	});

	it.each([...PRIVATE_KEYS, UNLISTED_KEY])('returns null for %s', (key) => {
		// The loader still returns the media row (metadata stays
		// reachable); only the URL is withheld, so the UI renders its
		// documented placeholder instead of a broken image.
		expect(composeMediaUrl(env, key)).toBeNull();
	});
});

describe('HTTP boundary — GET /api/v1/reaction-images/:id', () => {
	it('serves an uploaded reaction image', async () => {
		const upload = await uploadImage(D1(), R2(), {
			contentType: 'image/png',
			bytes: asArrayBuffer(PNG_BYTES),
			uploadedBy: 'tester',
		});
		// The upload key layout must stay inside a public namespace,
		// or every reaction image would start 404-ing.
		expect(isPublicMediaKey(upload.image.r2_key)).toBe(true);

		const res = await SELF.fetch(`https://example.com/api/v1/reaction-images/${upload.image.id}`);
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('image/png');
	});

	it('404s a row whose r2_key sits in a private namespace', async () => {
		const id = '00000000-0000-4000-8000-00000000459a';
		await D1()
			.prepare(
				`INSERT INTO reaction_images
         (id, content_hash, content_type, size, r2_key, uploaded_by, uploaded_at)
       VALUES (?1, ?2, 'image/png', 1, ?3, 'tester', 0)`,
			)
			.bind(id, `fixture-${id}`, PRIVATE_KEYS[0])
			.run();
		// The object is in the bucket; only the row is the reason a
		// caller could otherwise reach it.
		expect(await R2().head(PRIVATE_KEYS[0])).not.toBeNull();

		const res = await SELF.fetch(`https://example.com/api/v1/reaction-images/${id}`);
		expect(res.status).toBe(404);
		expect(await getImageStream(D1(), R2(), id)).toBeNull();
	});
});
