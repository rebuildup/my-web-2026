import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
	buildPlan,
	buildSlugIndex,
	decideCaption,
	imageBlock,
	normalizeMime,
	normalizeSlug,
	parseArgs,
	planPageCounts,
	readState,
	run,
	sniffMime,
	stateKey,
	writeState,
} from './write-portfolio-to-notion.mjs';

/** A placeholder, never a credential: letters only, so no detector fires. */
const TOKEN = 'ntn_placeholdervaluefortheleakassertion';
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const ASCII_BYTES = Buffer.from('not an image at all');

const temporaryDirectories = [];

function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), 'write-portfolio-notion-'));
	temporaryDirectories.push(dir);
	return dir;
}

after(() => {
	for (const dir of temporaryDirectories) rmSync(dir, { recursive: true, force: true });
});

function capture() {
	const out = [];
	const err = [];
	return {
		stdout: { write: (chunk) => out.push(String(chunk)) },
		stderr: { write: (chunk) => err.push(String(chunk)) },
		text: () => out.join(''),
		errors: () => err.join(''),
	};
}

function mediaRow(overrides = {}) {
	const bytes = overrides.bytes ?? PNG_HEADER;
	return {
		mediaId: 'm-1',
		filename: 'picture.png',
		declaredMime: 'image/png',
		alt: null,
		byteLength: bytes.byteLength,
		bytes,
		...overrides,
	};
}

function notionPage(pageId, slug) {
	return { id: pageId, properties: { Slug: { rich_text: [{ plain_text: slug }] } } };
}

function indexOf(...pages) {
	return buildSlugIndex(pages).index;
}

describe('normalizeSlug', () => {
	it('lowercases and turns an underscore into a hyphen', () => {
		assert.equal(normalizeSlug('NullOto'), 'nulloto');
		assert.equal(normalizeSlug('M5_Clock'), 'm5-clock');
		assert.equal(normalizeSlug('aulymo_v02'), 'aulymo-v02');
	});

	it('leaves an already normalised slug alone', () => {
		assert.equal(normalizeSlug('kosen-fes2025-ending'), 'kosen-fes2025-ending');
		assert.equal(normalizeSlug('  LiteGlow '), 'liteglow');
	});
});

describe('sniffMime', () => {
	it('recognises every format the legacy corpus declares', () => {
		assert.equal(sniffMime(PNG_HEADER), 'image/png');
		assert.equal(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'image/jpeg');
		assert.equal(sniffMime(Buffer.from('GIF89a...')), 'image/gif');
		assert.equal(sniffMime(Buffer.from('GIF87a...')), 'image/gif');
		assert.equal(sniffMime(Buffer.from('RIFF....WEBPVP8 ')), 'image/webp');
		assert.equal(sniffMime(Buffer.from('<?xml version="1.0"?><svg></svg>')), 'image/svg+xml');
		assert.equal(
			sniffMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
			'image/svg+xml',
		);
	});

	it('returns null for bytes it cannot identify', () => {
		assert.equal(sniffMime(ASCII_BYTES), null);
		assert.equal(sniffMime(Buffer.alloc(0)), null);
	});

	it('reads a Uint8Array the same way as a Buffer', () => {
		// A database BLOB arrives as a Uint8Array, whose toString() ignores
		// the encoding argument — GIF would silently become "71,73,70,...".
		const gif = new Uint8Array(Buffer.from('GIF89a...'));
		assert.equal(sniffMime(gif), 'image/gif');
	});
});

describe('normalizeMime', () => {
	it('drops parameters and case', () => {
		assert.equal(normalizeMime('image/PNG; charset=binary'), 'image/png');
		assert.equal(normalizeMime(null), '');
	});
});

describe('buildPlan classification', () => {
	it('plans a file whose declared type matches its bytes', () => {
		const sources = [{ db: 'content-nulloto.db', contentId: 'NullOto', rows: [mediaRow()] }];
		const { plan, skipped } = buildPlan(
			sources,
			indexOf(notionPage('page-1', 'nulloto')),
			new Map(),
		);
		assert.equal(plan.length, 1);
		assert.equal(plan[0].pageId, 'page-1');
		assert.equal(plan[0].slug, 'nulloto');
		assert.equal(plan[0].mime, 'image/png');
		assert.deepEqual(skipped, {
			no_notion_page: 0,
			undecidable_db: 0,
			mime_mismatch: 0,
			replayed: 0,
		});
	});

	it('counts a work with no Notion page as no_notion_page', () => {
		const sources = [{ db: 'content-ghost.db', contentId: 'ghost', rows: [mediaRow()] }];
		const { plan, skipped } = buildPlan(
			sources,
			indexOf(notionPage('page-1', 'nulloto')),
			new Map(),
		);
		assert.equal(plan.length, 0);
		assert.equal(skipped.no_notion_page, 1);
	});

	it('refuses every row of a database that does not hold one content row', () => {
		const sources = [
			{
				db: 'content-mawaru-pv.db',
				contentId: null,
				rows: [mediaRow(), mediaRow({ mediaId: 'm-2' })],
			},
		];
		const { plan, skipped } = buildPlan(
			sources,
			indexOf(notionPage('page-1', 'nulloto')),
			new Map(),
		);
		assert.equal(plan.length, 0);
		assert.equal(skipped.undecidable_db, 2);
	});

	it('refuses a file whose bytes do not match the declared type', () => {
		const sources = [
			{
				db: 'content-kakumei.db',
				contentId: 'kakumei',
				rows: [
					mediaRow({
						filename: 'test-upload.png',
						declaredMime: 'image/png',
						bytes: ASCII_BYTES,
					}),
				],
			},
		];
		const { plan, skipped } = buildPlan(
			sources,
			indexOf(notionPage('page-1', 'kakumei')),
			new Map(),
		);
		assert.equal(plan.length, 0);
		assert.equal(skipped.mime_mismatch, 1);
	});

	it('skips a pair the state file already records and plans the rest', () => {
		const sources = [
			{
				db: 'content-nulloto.db',
				contentId: 'NullOto',
				rows: [mediaRow({ mediaId: 'm-done' }), mediaRow({ mediaId: 'm-new' })],
			},
		];
		const state = new Map([[stateKey('NullOto', 'm-done'), { blockId: 'b-1' }]]);
		const { plan, skipped } = buildPlan(sources, indexOf(notionPage('page-1', 'nulloto')), state);
		assert.equal(plan.length, 1);
		assert.equal(plan[0].mediaId, 'm-new');
		assert.equal(skipped.replayed, 1);
	});
});

describe('caption and block shape', () => {
	it('prefers the recorded alt text and falls back to the file name', () => {
		assert.equal(decideCaption('a diagram of the case', 'case.png'), 'a diagram of the case');
		assert.equal(decideCaption(null, 'case.png'), 'case.png');
		assert.equal(decideCaption('   ', 'case.png'), 'case.png');
	});

	it('builds the image block Notion API 2025-09-03 accepts', () => {
		assert.deepEqual(imageBlock({ uploadId: 'up-1', caption: 'case.png' }), {
			object: 'block',
			type: 'image',
			image: {
				type: 'file_upload',
				file_upload: { id: 'up-1' },
				caption: [{ type: 'text', text: { content: 'case.png' } }],
			},
		});
	});
});

describe('state file', () => {
	it('round-trips a replay record', () => {
		const path = join(tempDir(), 'nested', 'state.json');
		const entries = new Map([
			[stateKey('NullOto', 'm-1'), { blockId: 'b-1', sha256: 'ab'.repeat(32), bytes: 12 }],
		]);
		writeState(path, entries);
		const read = readState(path);
		assert.equal(read.size, 1);
		assert.deepEqual(read.get(stateKey('NullOto', 'm-1')), {
			blockId: 'b-1',
			sha256: 'ab'.repeat(32),
			bytes: 12,
		});
	});

	it('returns null when there is no record yet', () => {
		assert.equal(readState(join(tempDir(), 'absent.json')), null);
	});
});

describe('parseArgs', () => {
	it('defaults to a dry run', () => {
		const options = parseArgs([]);
		assert.equal(options.apply, false);
		assert.equal(options.dryRun, true);
		assert.equal(options.state, '.tmp/notion-portfolio-write-state.json');
	});

	it('reads the documented flags', () => {
		const options = parseArgs([
			'--apply',
			'--state',
			'/tmp/state.json',
			'--data-source-id=ds-1',
			'--legacy-dir=/tmp/corpus',
			'--allow-duplicates',
		]);
		assert.equal(options.apply, true);
		assert.equal(options.state, '/tmp/state.json');
		assert.equal(options.dataSourceId, 'ds-1');
		assert.equal(options.legacyDir, '/tmp/corpus');
		assert.equal(options.allowDuplicates, true);
	});

	it('refuses an unknown argument and a contradictory mode', () => {
		assert.throws(() => parseArgs(['--uplaod']), /unknown argument/u);
		assert.throws(() => parseArgs(['--apply', '--dry-run']), /not both/u);
		assert.throws(() => parseArgs(['--state']), /needs a value/u);
	});
});

describe('run', () => {
	const env = { NOTION_TOKEN: TOKEN, NOTION_PORTFOLIO_DB_ID: 'db-1' };

	it('exits 2 without a credential or a target', async () => {
		const missingCredential = capture();
		assert.equal(await run({ argv: [], env: {}, ...missingCredential }), 2);
		assert.match(missingCredential.errors(), /NOTION_TOKEN/u);

		const missingTarget = capture();
		assert.equal(await run({ argv: [], env: { NOTION_TOKEN: TOKEN }, ...missingTarget }), 2);
		assert.match(missingTarget.errors(), /data-source-id/u);
	});

	it('exits 3 when --apply has no state file and no --allow-duplicates', async () => {
		let called = false;
		const streams = capture();
		const code = await run({
			argv: ['--apply', '--state', join(tempDir(), 'absent.json')],
			env,
			fetchImpl: () => {
				called = true;
				throw new Error('the network must not be reached');
			},
			...streams,
		});
		assert.equal(code, 3);
		assert.equal(called, false, 'a refused run must not reach the network');
		assert.match(streams.errors(), /refused: no state file/u);
	});

	it('accepts --apply once a state file exists, then fails on the corpus', async () => {
		const statePath = join(tempDir(), 'state.json');
		writeState(statePath, new Map());
		const streams = capture();
		const code = await run({
			argv: ['--apply', '--state', statePath, '--legacy-dir', join(tempDir(), 'absent-corpus')],
			env,
			fetchImpl: () => {
				throw new Error('the network must not be reached');
			},
			...streams,
		});
		assert.equal(code, 2);
		assert.match(streams.errors(), /missing legacy corpus/u);
	});

	it('plans a real corpus offline and prints no credential and no media byte', async () => {
		const corpus = tempDir();
		const { DatabaseSync } = await import('node:sqlite');
		const db = new DatabaseSync(join(corpus, 'content-nulloto.db'));
		db.exec(
			'CREATE TABLE contents (id TEXT); CREATE TABLE media (id TEXT, content_id TEXT, filename TEXT, mime_type TEXT, size INTEGER, width INTEGER, height INTEGER, alt TEXT, description TEXT, tags TEXT, data BLOB, created_at TEXT, updated_at TEXT);',
		);
		db.prepare('INSERT INTO contents (id) VALUES (?)').run('NullOto');
		const insert = db.prepare(
			'INSERT INTO media (id, content_id, filename, mime_type, size, alt, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
		);
		// A NULL `content_id` still belongs to the work this database holds.
		insert.run(
			'm-a',
			null,
			'with-alt.png',
			'image/png',
			PNG_HEADER.byteLength,
			'alt text',
			PNG_HEADER,
		);
		insert.run('m-b', 'NullOto', 'named.png', 'image/png', PNG_HEADER.byteLength, null, PNG_HEADER);
		insert.run(
			'm-c',
			'NullOto',
			'test-upload.png',
			'image/png',
			ASCII_BYTES.byteLength,
			null,
			ASCII_BYTES,
		);
		db.close();

		let queries = 0;
		const streams = capture();
		const code = await run({
			argv: [
				'--dry-run',
				'--data-source-id',
				'ds-1',
				'--legacy-dir',
				corpus,
				'--state',
				join(corpus, 'state.json'),
			],
			env,
			fetchImpl: async (url) => {
				queries += 1;
				assert.equal(String(url), 'https://api.notion.com/v1/data_sources/ds-1/query');
				return new Response(
					JSON.stringify({ results: [notionPage('page-1', 'nulloto')], has_more: false }),
					{ status: 200 },
				);
			},
			...streams,
		});

		assert.equal(code, 0);
		assert.equal(queries, 1, 'a dry run reads the pages and writes nothing');
		assert.equal(
			streams.text(),
			[
				'plan: upload=2 skip_no_notion_page=0 skip_undecidable_db=0 skip_mime_mismatch=1 replayed=0 bytes=24',
				'page nulloto: upload=2',
				'dry-run: nothing written upload=2 bytes=24',
				'',
			].join('\n'),
		);
		assert.equal(streams.errors(), '');
		assert.ok(!streams.text().includes(TOKEN), 'the token must never be printed');
		assert.ok(!streams.text().includes('Bearer'), 'an authorization header must never be printed');
		// The PNG magic number in base64 — a media byte reaching the output.
		assert.ok(!streams.text().includes('iVBOR'), 'a media byte must never be printed');
	});
});

describe('planPageCounts', () => {
	it('groups by slug in a stable order', () => {
		const sources = [
			{ db: 'a.db', contentId: 'NullOto', rows: [mediaRow({ mediaId: 'm-1' })] },
			{ db: 'b.db', contentId: 'ch4nge', rows: [mediaRow({ mediaId: 'm-2' })] },
			{ db: 'c.db', contentId: 'NullOto', rows: [mediaRow({ mediaId: 'm-3' })] },
		];
		const { plan } = buildPlan(
			sources,
			indexOf(notionPage('p1', 'nulloto'), notionPage('p2', 'ch4nge')),
			new Map(),
		);
		assert.deepEqual(
			[...planPageCounts(plan)],
			[
				['ch4nge', 1],
				['nulloto', 2],
			],
		);
	});
});
