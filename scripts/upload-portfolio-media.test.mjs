import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * `upload-portfolio-media.mjs` pure helper tests.
 *
 * The script's `--apply` path shells out to `wrangler r2 object put`
 * and `wrangler d1 execute` (real CLI sub-processes) which we cannot
 * exercise from a unit test. We instead extract the pure classifier
 * functions and assert their behaviour directly.
 *
 * Helpers covered:
 *   - `classifyAsset(src)`         — external_video / local_file / external_other / unknown
 *   - `deriveSlug(legacyId)`       — shared with the migration script (re-tested here for
 *                                    confidence)
 *   - `contentTypeFromExt(name)`   — file extension → MIME type
 *   - `escapeSql(value)`           — SQL literal escape
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'upload-portfolio-media.mjs');

function extract(name) {
	const source = readFileSync(SCRIPT, 'utf8');
	const re = new RegExp(`function\\s+${name}\\s*\\([\\s\\S]*?\\n\\}`, 'm');
	const match = source.match(re);
	if (!match) throw new Error(`could not extract ${name} from ${SCRIPT}`);
	return match[0];
}

function loadHelpers() {
	return {
		classifyAsset: new Function(`${extract('classifyAsset')}; return classifyAsset;`)(),
		deriveSlug: new Function(`${extract('deriveSlug')}; return deriveSlug;`)(),
		contentTypeFromExt: new Function(
			`${extract('contentTypeFromExt')}; return contentTypeFromExt;`,
		)(),
		escapeSql: new Function(`${extract('escapeSql')}; return escapeSql;`)(),
	};
}

const { classifyAsset, deriveSlug, contentTypeFromExt, escapeSql } = loadHelpers();

describe('classifyAsset', () => {
	it('recognises YouTube hosts as external_video', () => {
		assert.equal(classifyAsset('https://youtu.be/9pNjS_Ahfjc').kind, 'external_video');
		assert.equal(classifyAsset('https://www.youtube.com/watch?v=xyz').kind, 'external_video');
		assert.equal(classifyAsset('https://youtube-nocookie.com/embed/xyz').kind, 'external_video');
	});

	it('recognises Vimeo / nicovideo as external_video', () => {
		assert.equal(classifyAsset('https://vimeo.com/123').kind, 'external_video');
		assert.equal(classifyAsset('https://www.vimeo.com/123').kind, 'external_video');
		assert.equal(classifyAsset('https://www.nicovideo.jp/watch/sm123').kind, 'external_video');
	});

	it('recognises other http(s) URLs as external_other', () => {
		assert.equal(classifyAsset('https://example.com/asset.png').kind, 'external_other');
		assert.equal(classifyAsset('https://361do.booth.pm/items/6932001').kind, 'external_other');
	});

	it('recognises relative paths as local_file', () => {
		assert.equal(classifyAsset('assets/foo.webp').kind, 'local_file');
		assert.equal(classifyAsset('images/cover.png').kind, 'local_file');
	});

	it('treats empty src as unknown', () => {
		assert.equal(classifyAsset('').kind, 'unknown');
		assert.equal(classifyAsset(null).kind, 'unknown');
		assert.equal(classifyAsset(undefined).kind, 'unknown');
	});
});

describe('contentTypeFromExt', () => {
	it('maps common image extensions to image/* MIME types', () => {
		assert.equal(contentTypeFromExt('foo.webp'), 'image/webp');
		assert.equal(contentTypeFromExt('FOO.PNG'), 'image/png');
		assert.equal(contentTypeFromExt('bar.jpg'), 'image/jpeg');
		assert.equal(contentTypeFromExt('bar.jpeg'), 'image/jpeg');
		assert.equal(contentTypeFromExt('baz.gif'), 'image/gif');
		assert.equal(contentTypeFromExt('qux.svg'), 'image/svg+xml');
	});

	it('maps video extensions to video/* MIME types', () => {
		assert.equal(contentTypeFromExt('clip.mp4'), 'video/mp4');
		assert.equal(contentTypeFromExt('clip.webm'), 'video/webm');
	});

	it('falls back to application/octet-stream for unknown extensions', () => {
		assert.equal(contentTypeFromExt('foo.xyz'), 'application/octet-stream');
		assert.equal(contentTypeFromExt('noext'), 'application/octet-stream');
	});
});

describe('deriveSlug (sanity)', () => {
	it('still derives the same slug for shared legacy ids', () => {
		assert.equal(deriveSlug('aulymo_v02'), 'aulymo-v02');
		assert.equal(deriveSlug('kosen-procon-pv'), 'kosen-procon-pv');
	});
});

describe('escapeSql (sanity)', () => {
	it('returns NULL for null / undefined', () => {
		assert.equal(escapeSql(null), 'NULL');
		assert.equal(escapeSql(undefined), 'NULL');
	});

	it('escapes single quotes by doubling', () => {
		assert.equal(escapeSql("don't"), "'don''t'");
	});
});
