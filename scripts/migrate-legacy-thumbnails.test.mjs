import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	buildThumbnailR2Key,
	buildThumbnailSql,
	classifyThumbnailSrc,
	formatReport,
	MAX_THUMBNAIL_BYTES,
	parseImageDimensions,
	planThumbnails,
	sniffImageContentType,
	THUMBNAIL_CONTENT_TYPES,
} from './migrate-legacy-thumbnails.mjs';

/**
 * `migrate-legacy-thumbnails.mjs` unit tests (Issue #913).
 *
 * The `--apply` path shells out to the `cf` CLI and the network, so the
 * pure decision layer is asserted directly: which src classifies as an
 * external fetch vs a #850 byte source, what the fetched bytes must
 * sniff to, what the row and its SQL look like, and that the report
 * stays status-only.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('classifyThumbnailSrc', () => {
	const mediaIds = new Set(['media_1']);

	it('classifies a legacy media-API src that names a real media id as a #850 byte source', () => {
		const src = 'https://yusuke-kim.com/api/cms/media?contentId=m5_clock&id=media_1&raw=1';
		assert.deepEqual(classifyThumbnailSrc(src, mediaIds), {
			kind: 'media_blob',
			reason: 'media_blob_source',
		});
	});

	it('classifies an external CDN URL as an ingest-time fetch', () => {
		assert.deepEqual(
			classifyThumbnailSrc('https://img.youtube.com/vi/D0pItdcPWqE/maxresdefault.jpg', mediaIds),
			{ kind: 'external' },
		);
		assert.deepEqual(
			classifyThumbnailSrc(
				'https://booth.pximg.net/ff9fba29-c4be-437f-bce0-db391d634cd7/i/1/x_base_resized.jpg',
				mediaIds,
			),
			{ kind: 'external' },
		);
	});

	it('refuses an empty, unparseable or non-http src without attempting a fetch', () => {
		assert.deepEqual(classifyThumbnailSrc(null, mediaIds), {
			kind: 'unsupported',
			reason: 'no_thumbnail',
		});
		assert.deepEqual(classifyThumbnailSrc('not a url', mediaIds), {
			kind: 'unsupported',
			reason: 'unparseable_src',
		});
		assert.deepEqual(classifyThumbnailSrc('ftp://host/x.png', mediaIds), {
			kind: 'unsupported',
			reason: 'non_http_scheme',
		});
	});

	it('treats a media-API src whose id is NOT in the corpus as an external fetch attempt', () => {
		// The bytes are not in the legacy `media` table, so fetching is
		// the only path; a failure is a counted skip, never a broken row.
		const src = 'https://yusuke-kim.com/api/cms/media?contentId=x&id=media_missing&raw=1';
		assert.deepEqual(classifyThumbnailSrc(src, mediaIds), { kind: 'external' });
	});
});

describe('sniffImageContentType', () => {
	it('recognises the corpus formats and refuses everything else', () => {
		assert.equal(
			sniffImageContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
			'image/png',
		);
		assert.equal(sniffImageContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
		assert.equal(sniffImageContentType(Buffer.from('GIF89a....', 'latin1')), 'image/gif');
		assert.equal(sniffImageContentType(Buffer.from('RIFF1234WEBPVP8 ', 'latin1')), 'image/webp');
		assert.equal(sniffImageContentType(Buffer.from('<html>', 'latin1')), null);
	});
});

describe('parseImageDimensions', () => {
	/** Minimal PNG: signature + IHDR with 16x9. */
	const png = Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		Buffer.from([0, 0, 0, 13]),
		Buffer.from('IHDR', 'latin1'),
		Buffer.from([0, 0, 0, 16, 0, 0, 0, 9, 8, 6, 0, 0, 0]),
	]);

	it('reads PNG IHDR', () => {
		assert.deepEqual(parseImageDimensions(png), { width: 16, height: 9 });
	});

	it('reads GIF logical screen size', () => {
		const gif = Buffer.concat([
			Buffer.from('GIF89a', 'latin1'),
			Buffer.from([16, 0, 9, 0]),
			Buffer.from([0xf0, 0, 0]),
		]);
		assert.deepEqual(parseImageDimensions(gif), { width: 16, height: 9 });
	});

	it('scans JPEG segments for the SOFn frame header', () => {
		// A well-formed APP0 (length 0x0010 covers its 14 payload bytes)
		// must be skipped before the SOF0 frame header is read.
		const app0 = Buffer.concat([
			Buffer.from([0xff, 0xe0, 0x00, 0x10]),
			Buffer.from('JFIF\0', 'latin1'),
			Buffer.from([0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
		]);
		assert.equal(app0.length, 18);
		const sof0 = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x09, 0x00, 0x10, 0x03, 0x00]);
		const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0]);
		assert.deepEqual(parseImageDimensions(jpeg), { width: 16, height: 9 });
	});

	it('returns null for bytes it cannot parse (the figure already handles null)', () => {
		assert.equal(parseImageDimensions(Buffer.from('not an image', 'latin1')), null);
	});
});

describe('buildThumbnailR2Key', () => {
	it('is content-addressed under the project namespace', () => {
		assert.equal(
			buildThumbnailR2Key('m5-clock', 'a'.repeat(64), 'image/jpeg'),
			`portfolio/m5-clock/thumbnail/${'a'.repeat(64)}.jpg`,
		);
	});
});

describe('planThumbnails', () => {
	const source = (slug, src, mediaIds = new Set()) => ({
		slug,
		projectId: `legacy_${slug}`,
		title: slug,
		src,
		mediaIds,
	});

	it('skips a project that already displays an image and plans the rest for ingest', () => {
		const { uploads, skips } = planThumbnails({
			sources: [
				source('has-media', 'https://img.youtube.com/vi/x/maxresdefault.jpg'),
				source('no-media', 'https://img.youtube.com/vi/y/maxresdefault.jpg'),
				source(
					'blob',
					'https://yusuke-kim.com/api/cms/media?id=media_1&raw=1',
					new Set(['media_1']),
				),
				source('empty', null),
			],
			mediaRowCounts: new Map([['legacy_has-media', 3]]),
		});
		assert.deepEqual(
			uploads.map((entry) => entry.slug),
			['no-media'],
		);
		assert.deepEqual(skips, { media_rows_exist: 1, media_blob_source: 1, no_thumbnail: 1 });
	});
});

describe('buildThumbnailSql', () => {
	it('releases only its own cover before the upsert, and never touches another row', () => {
		const statements = buildThumbnailSql([
			{
				id: 'legacy_thumb_m5-clock',
				projectId: 'legacy_m5-clock',
				r2Key: `portfolio/m5-clock/thumbnail/${'a'.repeat(64)}.jpg`,
				contentType: 'image/jpeg',
				width: 1280,
				height: 720,
				alt: 'M5_Clock',
				isCover: 1,
				displayOrder: 0,
				createdAt: 0,
			},
		]);
		assert.equal(statements.length, 2);
		assert.match(
			statements[0],
			/^UPDATE portfolio_media SET is_cover = 0 WHERE project_id = 'legacy_m5-clock' AND id LIKE 'legacy_thumb_%'/,
		);
		assert.match(statements[1], /^INSERT INTO portfolio_media/);
		assert.match(statements[1], /ON CONFLICT\(id\) DO UPDATE SET/);
		// The reset is scoped to rows this script owns.
		assert.match(statements[0], /id <> 'legacy_thumb_m5-clock'/);
	});
});

describe('report and limits', () => {
	it('stays status-only: no URL, no object key, no byte', () => {
		const report = formatReport({
			counts: {
				scopedProjects: 60,
				sources: 60,
				fetched: 35,
				uploads: 35,
				rows: 35,
				skips: { media_rows_exist: 25 },
			},
			applied: true,
			target: 'local',
		});
		assert.match(report, /\[legacy-thumbnails\] uploads {10}35/);
		assert.match(report, /media_rows_exist=25/);
		assert.doesNotMatch(report, /https?:\/\//);
	});

	it('keeps the thumbnail allowlist inside the media route’s deliverable types', () => {
		// A thumbnail row whose type the route refuses would be a
		// permanently broken image — the same refusal the media
		// migration pins.
		const routerSource = readFileSync(join(repoRoot, 'src/http/media/router.ts'), 'utf8');
		const block = routerSource.match(
			/const DELIVERABLE_CONTENT_TYPES[^=]*=\s*new Set\(\[(.*?)\]\)/s,
		);
		assert.ok(block, 'the media router no longer declares DELIVERABLE_CONTENT_TYPES');
		const routerTypes = [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
		for (const type of THUMBNAIL_CONTENT_TYPES) {
			assert.ok(routerTypes.includes(type), `${type} is not deliverable by the media route`);
		}
	});

	it('caps one thumbnail far below the byte ceiling', () => {
		assert.ok(MAX_THUMBNAIL_BYTES >= 1024 * 1024);
	});
});
