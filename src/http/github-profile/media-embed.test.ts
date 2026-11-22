import { describe, expect, it } from 'vitest';
import { MAX_COVER_BYTES, MAX_TOTAL_MEDIA_BYTES, embedWorkMedia } from './media-embed';
import type { ProfileCardWork } from './model';

/**
 * Media-embedding contract (Issue #1170): the SVG is delivered through
 * `<img>`, where external subresources are forbidden — covers must be
 * inlined as `data:` URIs under a byte budget, and every failure must
 * degrade to the placeholder, never break the card.
 */

function work(overrides: Partial<ProfileCardWork> = {}): ProfileCardWork {
	return {
		title: 'Work',
		summary: 'Summary',
		media: [{ r2Key: 'portfolio/p/p/cover.png', contentType: 'image/png' }],
		alt: 'Work',
		...overrides,
	};
}

function fakeBucket(
	objects: Record<string, { size: number; bytes?: number[]; contentType?: string }>,
) {
	return {
		head: async (key: string) => {
			const obj = objects[key];
			return obj
				? { size: obj.size, httpMetadata: { contentType: obj.contentType ?? 'image/png' } }
				: null;
		},
		get: async (key: string) => {
			const obj = objects[key];
			if (!obj) return null;
			const length = obj.bytes?.length ?? obj.size;
			return {
				arrayBuffer: async () => new Uint8Array(length).buffer,
			};
		},
	} as unknown as R2Bucket;
}

describe('embedWorkMedia', () => {
	it('embeds the first fitting candidate as a data URI', async () => {
		const bucket = fakeBucket({
			'portfolio/p/p/cover.png': { size: 100, bytes: [1, 2, 3] },
		});
		const [embedded] = await embedWorkMedia([work()], bucket);
		expect(embedded?.dataUri).toMatch(/^data:image\/png;base64,/);
	});

	it('skips oversized candidates and tries the next one', async () => {
		const bucket = fakeBucket({
			'portfolio/p/p/big.png': { size: MAX_COVER_BYTES + 1 },
			'portfolio/p/p/small.jpg': { size: 50, bytes: [9] },
		});
		const w = work({
			media: [
				{ r2Key: 'portfolio/p/p/big.png', contentType: 'image/png' },
				{ r2Key: 'portfolio/p/p/small.jpg', contentType: 'image/jpeg' },
			],
		});
		const [embedded] = await embedWorkMedia([w], bucket);
		expect(embedded?.dataUri).toMatch(/^data:image\/jpeg;base64,/);
	});

	it('leaves the work untouched when nothing fits or the bucket is absent', async () => {
		const bucket = fakeBucket({});
		const [missing] = await embedWorkMedia([work()], bucket);
		expect(missing?.dataUri).toBeUndefined();
		const [noBucket] = await embedWorkMedia([work()], undefined);
		expect(noBucket?.dataUri).toBeUndefined();
	});

	it('stops embedding once the total budget is exhausted', async () => {
		// 3 × 600 KB covers: the 1.5 MB total budget fits two, not three.
		const size = 600 * 1024;
		const bucket = fakeBucket({
			'portfolio/a/a/cover.png': { size },
			'portfolio/b/b/cover.png': { size },
			'portfolio/c/c/cover.png': { size },
		});
		const works = ['a', 'b', 'c'].map((slug) =>
			work({ media: [{ r2Key: `portfolio/${slug}/${slug}/cover.png`, contentType: 'image/png' }] }),
		);
		const embedded = await embedWorkMedia(works, bucket);
		expect(embedded[0]?.dataUri).toBeDefined();
		expect(embedded[1]?.dataUri).toBeDefined();
		expect(embedded[2]?.dataUri).toBeUndefined();
	});
});
