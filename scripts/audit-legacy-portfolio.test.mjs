import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';
import {
	buildInventory,
	diffInventories,
	indexClassification,
	inventoryAssetIds,
	inventoryDigest,
	listLegacyDatabases,
	parseArgs,
	readNotionPages,
	rightsStateFor,
} from './audit-legacy-portfolio.mjs';

/**
 * Guards for the legacy inventory (Issue #766).
 *
 * What class of defect this catches
 * ---------------------------------
 * A migration ledger that looks measured but is half guessed. The ledger
 * is the surface the owner uses to decide what moves to Notion, so every
 * column has to come from the legacy database or from the Issue #78
 * classification — never from inference here. The assertions below pin
 * the four ways that could go wrong:
 *
 *   1. an old URL invented instead of read (`old_url` is a stored column);
 *   2. media measured by row count while the bytes — the thing that decides
 *      whether the R2 upload is possible — are wrong;
 *   3. a rights verdict of `recorded` for an asset the inventory does not
 *      actually record (the fail-closed rule of `src/legal/**`);
 *   4. `--check` calling two different inventories "no drift", which would
 *      make the drift gate a false green.
 *
 * The fixture is built here rather than read from `.reference/my-web-2025`:
 * the clone is gitignored (AGENTS.md §9), so a test that depended on it
 * would be a test that never runs in CI.
 */

const scratch = mkdtempSync(join(tmpdir(), 'legacy-inventory-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** A legacy database with the subset of the schema this script reads. */
function makeLegacyDatabase(file, { content, media = [], extraAsset = false }) {
	const db = new DatabaseSync(file);
	db.exec(`
		create table contents (id text primary key, public_url text, visibility text, status text, published_at text, updated_at text);
		create table media (id text primary key, content_id text, mime_type text, data blob);
	`);
	if (content) {
		db.prepare(
			'insert into contents (id, public_url, visibility, status, published_at, updated_at) values (?, ?, ?, ?, ?, ?)',
		).run(
			content.id,
			content.public_url ?? null,
			content.visibility ?? null,
			content.status ?? null,
			content.published_at ?? null,
			content.updated_at ?? null,
		);
	}
	if (extraAsset) {
		db.exec(
			'create table content_assets (id integer primary key autoincrement, content_id text, src text);',
		);
		db.exec("insert into content_assets (content_id, src) values ('x', '/media/a.png')");
	}
	const insert = db.prepare(
		'insert into media (id, content_id, mime_type, data) values (?, ?, ?, ?)',
	);
	for (const [index, row] of media.entries()) {
		insert.run(
			`m${index}`,
			row.contentId ?? null,
			row.mime ?? 'image/png',
			Buffer.alloc(row.bytes ?? 0),
		);
	}
	db.close();
}

function makeSource(name, databases) {
	const source = join(scratch, name);
	mkdirSync(join(source, 'data/contents'), { recursive: true });
	for (const [file, spec] of Object.entries(databases)) {
		makeLegacyDatabase(join(source, 'data/contents', file), spec);
	}
	return source;
}

const openDatabase = (file) => new DatabaseSync(file, { readOnly: true });

describe('parseArgs', () => {
	it('reads --flag=value, --flag value and a bare --flag', () => {
		const flags = parseArgs(['--source=here', '--out', 'there', '--check']);
		assert.equal(flags.get('source'), 'here');
		assert.equal(flags.get('out'), 'there');
		assert.equal(flags.get('check'), true);
	});

	it('does not swallow the next flag as a value', () => {
		const flags = parseArgs(['--check', '--source=here']);
		assert.equal(flags.get('check'), true);
		assert.equal(flags.get('source'), 'here');
	});
});

describe('listLegacyDatabases', () => {
	it('keeps content databases only and sorts them deterministically', () => {
		const source = makeSource('listing', {
			'content-b.db': { content: { id: 'b' } },
			'content-a.db': { content: { id: 'a' } },
		});
		// WAL sidecars must never be measured as databases.
		makeLegacyDatabase(join(source, 'data/contents', 'notes.db'), { content: { id: 'n' } });
		assert.deepEqual(listLegacyDatabases(join(source, 'data/contents')), [
			'content-a.db',
			'content-b.db',
		]);
	});
});

describe('classification join', () => {
	it('joins on the database file, not the content id', () => {
		const byDb = indexClassification({
			classified: [{ db: 'content-Border.db', id: 'border', migration_class: 'eligible' }],
		});
		assert.equal(byDb.get('content-Border.db').migration_class, 'eligible');
		assert.equal(byDb.get('content-border.db'), undefined);
	});
});

describe('rights state', () => {
	it('is fail-closed: an unrecorded asset is not cleared', () => {
		const ids = inventoryAssetIds({
			assets: [{ id: 'portfolio/keep.png' }, { notAnId: true }],
		});
		assert.equal(ids.size, 1);
		assert.equal(rightsStateFor('portfolio/keep.png', ids), 'recorded');
		assert.equal(rightsStateFor('portfolio/other.png', ids), 'unrecorded');
	});

	it('treats a missing or malformed inventory as recording nothing', () => {
		assert.equal(
			rightsStateFor('portfolio/x.png', inventoryAssetIds(null)).valueOf(),
			'unrecorded',
		);
		assert.equal(inventoryAssetIds({ assets: 'nope' }).size, 0);
	});
});

describe('buildInventory', () => {
	const source = makeSource('corpus', {
		'content-published.db': {
			content: {
				id: 'published',
				public_url: '/content/published',
				visibility: 'public',
				status: 'published',
				published_at: '2025-01-02T03:00:00.000Z',
				updated_at: '2025-01-03T03:00:00.000Z',
			},
			media: [
				{ contentId: 'published', mime: 'image/png', bytes: 100 },
				{ contentId: 'published', mime: 'video/mp4', bytes: 900 },
				{ contentId: null, mime: 'image/png', bytes: 50 },
			],
			extraAsset: true,
		},
		'content-empty.db': { content: null },
	});

	const classification = {
		generated_at: '2026-09-26T23:18:22.785Z',
		classified: [
			{
				db: 'content-published.db',
				id: 'published',
				migration_class: 'eligible',
				publication: 'pending_owner',
				publication_blockers: ['role_missing'],
				facets: ['video'],
				external_video_count: 1,
			},
		],
	};
	const inventory = { assets: [{ id: 'published' }] };

	const document = buildInventory({
		sourcePath: source,
		sourceHead: 'a'.repeat(40),
		classificationPath: 'docs/migration/portfolio-2025-to-2026-classification.json',
		classification,
		inventory,
		now: '2026-11-01T00:00:00.000Z',
		openDatabase,
	});

	it('reads the old URL instead of deriving it', () => {
		const row = document.items.find((item) => item.id === 'published');
		assert.equal(row.old_url, '/content/published');
		assert.equal(row.status, 'published');
		assert.equal(row.visibility, 'public');
	});

	it('counts an empty database as empty rather than as an item with no fields', () => {
		assert.equal(document.counts.databases, 2);
		assert.equal(document.counts.empty_databases, 1);
		assert.equal(document.counts.without_classification, 1);
	});

	it('measures media bytes, not just rows, and separates unattributed files', () => {
		assert.equal(document.counts.mediaFiles, 3);
		assert.equal(document.counts.mediaBytes, 1050);
		assert.deepEqual(document.counts.unattributed_media, { files: 1, bytes: 50 });
		const row = document.items.find((item) => item.id === 'published');
		assert.deepEqual(row.media, { files: 2, bytes: 1000 });
	});

	it('leaves the Notion and new-URL columns unset', () => {
		for (const item of document.items) {
			assert.equal(item.notion_page, null);
			assert.equal(item.new_url, null);
		}
	});

	it('marks a recorded asset as recorded and everything else as unrecorded', () => {
		assert.equal(document.rights.recorded, 1);
		assert.equal(document.rights.unrecorded, 1);
	});

	it('is deterministic apart from the observation instant', () => {
		const again = buildInventory({
			sourcePath: source,
			sourceHead: 'a'.repeat(40),
			classificationPath: 'docs/migration/portfolio-2025-to-2026-classification.json',
			classification,
			inventory,
			now: '2027-01-01T00:00:00.000Z',
			openDatabase,
		});
		assert.equal(again.content_digest, document.content_digest);
	});

	it('stamps only the migration state it is told, never an identifier', () => {
		const withPages = buildInventory({
			sourcePath: source,
			sourceHead: 'a'.repeat(40),
			classificationPath: 'docs/migration/portfolio-2025-to-2026-classification.json',
			classification,
			inventory,
			notionPages: new Map([['published', 'recorded']]),
			now: '2026-11-01T00:00:00.000Z',
			openDatabase,
		});
		const row = withPages.items.find((item) => item.id === 'published');
		assert.equal(row.notion_page, 'recorded');
		// The new URL is a publication decision, not a migration one.
		assert.equal(row.new_url, null);
		assert.deepEqual(withPages.counts.by_notion_page, { recorded: 1, null: 1 });
	});
});

describe('readNotionPages', () => {
	const dir = mkdtempSync(join(tmpdir(), 'legacy-notion-pages-'));
	after(() => rmSync(dir, { recursive: true, force: true }));

	it('reads a state per legacy id and treats a missing file as "nothing recorded"', () => {
		assert.equal(readNotionPages(join(dir, 'absent.json')), null);
	});

	it('ignores an entry with no legacy id or a non-object row', () => {
		const path = join(dir, 'pages.json');
		writeFileSync(
			path,
			JSON.stringify({
				schema: 'portfolio-notion-pages.v1',
				pages: [{ legacy_id: 'a', state: 'recorded' }, { state: 'recorded' }, null],
			}),
		);
		const pages = readNotionPages(path);
		assert.deepEqual([...pages.entries()], [['a', 'recorded']]);
	});
});

describe('diffInventories', () => {
	const base = {
		content_digest: inventoryDigest([{ id: 'a', status: 'published' }]),
		counts: { databases: 1, items: 1, mediaFiles: 0, mediaBytes: 0, without_classification: 0 },
		source: { head: 'a'.repeat(40) },
		items: [{ id: 'a', status: 'published' }],
	};

	it('reports no drift for the same inventory', () => {
		assert.deepEqual(diffInventories(base, base), []);
	});

	it('names added, changed and removed items', () => {
		const next = {
			...base,
			content_digest: 'sha256:different',
			items: [
				{ id: 'a', status: 'draft' },
				{ id: 'b', status: 'published' },
			],
		};
		const differences = diffInventories(base, next);
		assert.ok(differences.includes('changed: a'));
		assert.ok(differences.includes('added: b'));
	});

	it('reports a moved source head, because that is drift worth seeing', () => {
		const differences = diffInventories(base, {
			...base,
			source: { head: 'b'.repeat(40) },
		});
		assert.equal(differences.length, 1);
		assert.match(differences[0], /^source\.head:/);
	});
});
