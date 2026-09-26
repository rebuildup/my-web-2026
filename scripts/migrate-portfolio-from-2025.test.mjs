import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * `migrate-portfolio-from-2025.mjs` pure helper tests.
 *
 * The script's `--apply` path shells out to `wrangler d1 execute`
 * (a real CLI sub-process) which we cannot exercise from a unit
 * test, and its `--dry-run` path reads both the classification
 * artifact AND the legacy SQLite files (also an external side
 * effect). We instead extract the pure helper functions and assert
 * their behaviour directly.
 *
 * Helpers covered:
 *   - `deriveSlug(legacyId)`  — lowercase, dash-joined, regex-bound
 *   - `linkKindFromUrl(href)` — host → portfolio_link.kind inference
 *   - `parseIsoMs(value)`     — ISO 8601 → Unix ms (null on failure)
 *   - `sqlEscape(value)`      — SQL literal escape (NULL or single-quoted)
 *
 * The extraction approach (regex slicing + Function constructor) is
 * identical to `bootstrap-home-api-key.test.mjs` so the convention is
 * stable across the migration scripts.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'migrate-portfolio-from-2025.mjs');

function extract(name) {
	const source = readFileSync(SCRIPT, 'utf8');
	const re = new RegExp(`function\\s+${name}\\s*\\([\\s\\S]*?\\n\\}`, 'm');
	const match = source.match(re);
	if (!match) throw new Error(`could not extract ${name} from ${SCRIPT}`);
	return match[0];
}

function loadHelpers() {
	const slugFn = new Function(`${extract('deriveSlug')}; return deriveSlug;`)();
	const linkFn = new Function(`${extract('linkKindFromUrl')}; return linkKindFromUrl;`)();
	const dateFn = new Function(`${extract('parseIsoMs')}; return parseIsoMs;`)();
	const escFn = new Function(`${extract('sqlEscape')}; return sqlEscape;`)();
	return { deriveSlug: slugFn, linkKindFromUrl: linkFn, parseIsoMs: dateFn, sqlEscape: escFn };
}

const { deriveSlug, linkKindFromUrl, parseIsoMs, sqlEscape } = loadHelpers();

describe('deriveSlug', () => {
	it('lowercases and keeps alphanumerics + dashes', () => {
		assert.equal(deriveSlug('Border'), 'border');
		assert.equal(deriveSlug('kosen-procon-pv'), 'kosen-procon-pv');
		assert.equal(deriveSlug('test-otu-1-3q'), 'test-otu-1-3q');
	});

	it('normalises underscores to dashes', () => {
		assert.equal(deriveSlug('aulymo_v02'), 'aulymo-v02');
		assert.equal(deriveSlug('stretch_v02'), 'stretch-v02');
	});

	it('strips characters outside [a-z0-9-] (CamelCase, dot, slash)', () => {
		assert.equal(deriveSlug('MultiSlicer'), 'multislicer');
		assert.equal(deriveSlug('with.dots'), 'withdots');
		assert.equal(deriveSlug('with/slash'), 'withslash');
		assert.equal(deriveSlug('FOO_bar'), 'foo-bar');
	});

	it('collapses repeated dashes and trims leading / trailing dashes', () => {
		assert.equal(deriveSlug('--foo--bar--'), 'foo-bar');
		assert.equal(deriveSlug('foo___bar'), 'foo-bar');
		assert.equal(deriveSlug('---foo---bar---'), 'foo-bar');
		assert.throws(() => deriveSlug('---'), /cannot derive slug/);
	});

	it('throws on empty result so the owner override is forced', () => {
		assert.throws(() => deriveSlug(''), /cannot derive slug/);
		assert.throws(() => deriveSlug('___'), /cannot derive slug/);
	});

	it('throws when slug exceeds 127 chars', () => {
		const id = 'a'.repeat(128);
		assert.throws(() => deriveSlug(id), /exceeds 127/);
	});
});

describe('linkKindFromUrl', () => {
	it('recognises shop hosts (booth.pm)', () => {
		assert.equal(linkKindFromUrl('https://361do.booth.pm/items/6932001'), 'shop');
		assert.equal(linkKindFromUrl('https://booth.pm/anything'), 'shop');
	});

	it('recognises repo hosts (github / gitlab)', () => {
		assert.equal(linkKindFromUrl('https://github.com/x/y'), 'repo');
		assert.equal(linkKindFromUrl('https://x.github.com/y'), 'repo');
		assert.equal(linkKindFromUrl('https://gitlab.com/x/y'), 'repo');
	});

	it('recognises video hosts (youtube / youtu.be / vimeo / nicovideo)', () => {
		assert.equal(linkKindFromUrl('https://youtu.be/9pNjS_Ahfjc'), 'video');
		assert.equal(linkKindFromUrl('https://www.youtube.com/watch?v=xyz'), 'video');
		assert.equal(linkKindFromUrl('https://youtube-nocookie.com/embed/xyz'), 'video');
		assert.equal(linkKindFromUrl('https://vimeo.com/123'), 'video');
		assert.equal(linkKindFromUrl('https://www.vimeo.com/123'), 'video');
		assert.equal(linkKindFromUrl('https://www.nicovideo.jp/watch/sm123'), 'video');
	});

	it('recognises article hosts (qiita / zenn)', () => {
		assert.equal(linkKindFromUrl('https://qiita.com/x/items/y'), 'article');
		assert.equal(linkKindFromUrl('https://zenn.dev/x/articles/y'), 'article');
		assert.equal(linkKindFromUrl('https://example.zenn.dev/y'), 'article');
	});

	it('falls through to other for unknown hosts', () => {
		assert.equal(linkKindFromUrl('https://example.com/page'), 'other');
		assert.equal(linkKindFromUrl('https://x.com/user/status/123'), 'other');
	});

	it('falls through to other on unparseable URLs', () => {
		assert.equal(linkKindFromUrl('not a url'), 'other');
		assert.equal(linkKindFromUrl(''), 'other');
	});
});

describe('parseIsoMs', () => {
	it('parses canonical ISO 8601 with Z suffix', () => {
		assert.equal(parseIsoMs('2025-07-30T03:00:00.000Z'), Date.parse('2025-07-30T03:00:00.000Z'));
	});

	it('parses ISO 8601 with explicit offset', () => {
		assert.equal(parseIsoMs('2025-07-30T12:00:00+09:00'), Date.parse('2025-07-30T12:00:00+09:00'));
	});

	it('returns null for null / undefined / empty input', () => {
		assert.equal(parseIsoMs(null), null);
		assert.equal(parseIsoMs(undefined), null);
		assert.equal(parseIsoMs(''), null);
	});

	it('returns null for unparseable strings', () => {
		assert.equal(parseIsoMs('not a date'), null);
		assert.equal(parseIsoMs('2025/07/30'), null);
	});
});

describe('sqlEscape', () => {
	it('returns NULL for null / undefined', () => {
		assert.equal(sqlEscape(null), 'NULL');
		assert.equal(sqlEscape(undefined), 'NULL');
	});

	it('wraps string values in single quotes', () => {
		assert.equal(sqlEscape('hello'), "'hello'");
		assert.equal(sqlEscape(123), "'123'");
	});

	it('doubles internal single quotes (SQL literal escape)', () => {
		assert.equal(sqlEscape("don't"), "'don''t'");
		assert.equal(sqlEscape("'leading quote"), "'''leading quote'");
		assert.equal(sqlEscape("trailing quote'"), "'trailing quote'''");
	});
});
