import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { mapDocuments, mapNotionPage, parseLinks } from './_notion-mapper.mjs';
import {
	MediaIngestError,
	buildSnapshot,
	checkSnapshotShape,
	contentDigest,
	findCredentialLeak,
	parseArgs,
	readRightsInventory,
	rightsForR2Key,
	syncNotion,
} from './sync-portfolio-notion.mjs';

const NOW = new Date('2026-10-31T12:00:00.000Z');
const FIXTURE = join(import.meta.dirname, 'fixtures/notion-portfolio/portfolio.json');
const TOKEN = 'ntn_abcdefghijklmnopqrstuvwx';

function silent() {
	return { write() {} };
}

function tempOut() {
	const dir = mkdtempSync(join(tmpdir(), 'notion-portfolio-'));
	return join(dir, 'snapshot.json');
}

function readCapture() {
	const chunks = [];
	return {
		stream: { write: (chunk) => chunks.push(String(chunk)) },
		text: () => chunks.join(''),
	};
}

function fixtureDocument() {
	return JSON.parse(readFileSync(FIXTURE, 'utf8'));
}

function basePage(overrides = {}) {
	const document = fixtureDocument();
	const page = structuredClone(document.pages[0].page);
	return { page: { ...page, ...overrides }, blocks: document.pages[0].blocks };
}

function supports(pageId) {
	return (url, init) => {
		if (url.endsWith(`/blocks/${pageId}/children?page_size=100`)) {
			return Promise.resolve(
				new Response(
					JSON.stringify({ results: fixtureDocument().pages[0].blocks, has_more: false }),
					{
						status: 200,
					},
				),
			);
		}
		if (init?.method === 'POST' && url.endsWith('/data_sources/ds-1/query')) {
			return Promise.resolve(
				new Response(
					JSON.stringify({ results: [fixtureDocument().pages[0].page], has_more: false }),
					{
						status: 200,
					},
				),
			);
		}
		if (url.endsWith('/databases/db-1')) {
			return Promise.resolve(
				new Response(
					JSON.stringify({ id: 'db-1', data_sources: [{ id: 'ds-1', name: 'Portfolio' }] }),
					{
						status: 200,
					},
				),
			);
		}
		throw new Error(`unexpected request: ${init?.method ?? 'GET'} ${url}`);
	};
}

async function runFixture(fixture = FIXTURE, extra = {}) {
	const outPath = tempOut();
	const stderr = readCapture();
	const stdout = readCapture();
	const exitCode = await syncNotion({
		fixture,
		outPath,
		now: NOW,
		stdout: stdout.stream,
		stderr: stderr.stream,
		...extra,
	});
	return { exitCode, outPath, stdout: stdout.text(), stderr: stderr.text() };
}

describe('mapDocuments', () => {
	it('maps every page and leaves publication to the projection', () => {
		const { records, errors } = mapDocuments(fixtureDocument().pages);
		assert.deepEqual(errors, []);
		assert.equal(records.length, 3);
		const bySlug = new Map(records.map((record) => [record.slug, record]));
		assert.equal(bySlug.get('sample-work-in-progress')?.status, 'draft');
		assert.equal(bySlug.get('sample-work-in-progress')?.visibility, 'unlisted');
	});

	it('keeps the author’s ordering fields as inputs', () => {
		const { records } = mapDocuments(fixtureDocument().pages);
		const pinned = records.find((record) => record.slug === 'sample-doc-site');
		assert.equal(pinned?.pinned, true);
		assert.equal(pinned?.displayOrder, 10);
	});

	it('collects refusals across pages instead of stopping at the first', () => {
		const document = fixtureDocument();
		const broken = structuredClone(document.pages[0]);
		broken.blocks = [
			{
				object: 'block',
				id: 'h-1',
				type: 'heading_2',
				heading_2: { rich_text: [{ type: 'text', text: { content: 'Motivation' } }] },
			},
			{
				object: 'block',
				id: 'callout-1',
				type: 'callout',
				callout: { rich_text: [{ type: 'text', text: { content: 'notice' } }] },
			},
		];
		const { records, errors } = mapDocuments([document.pages[0], broken]);
		assert.equal(records.length, 1);
		assert.deepEqual(
			errors.map((error) => error.code),
			['unsupported_block'],
		);
	});
});

describe('section mapping', () => {
	it('reads English and Japanese section headings into the same slots', () => {
		const { records } = mapDocuments(fixtureDocument().pages);
		const motion = records.find((record) => record.slug === 'sample-motion-study');
		assert.match(motion?.sections.motivation ?? '', /Compare two easing families/u);
		assert.equal(motion?.sections.retrospective, 'The shorter duration read as more deliberate.');
	});

	it('keeps emphasis and code fences as Markdown', () => {
		const { records } = mapDocuments(fixtureDocument().pages);
		const doc = records.find((record) => record.slug === 'sample-doc-site');
		assert.match(doc?.sections.motivation ?? '', /\*\*hard to keep in sync\*\*/u);
		assert.match(doc?.sections.implementation ?? '', /```typescript/u);
		assert.match(doc?.sections.architecture ?? '', /^- One source file per page$/mu);
	});

	it('refuses a level-2 heading that is not a section', () => {
		const page = basePage();
		page.blocks = [
			{
				object: 'block',
				id: 'h-1',
				type: 'heading_2',
				heading_2: { rich_text: [{ type: 'text', text: { content: 'Appendix' } }] },
			},
		];
		const result = mapNotionPage(page.page, page.blocks);
		assert.equal(result.ok, false);
		assert.equal(result.errors[0]?.code, 'unknown_section_heading');
	});

	it('refuses body text before the first section heading', () => {
		const result = mapNotionPage(basePage().page, [
			{
				object: 'block',
				id: 'p-1',
				type: 'paragraph',
				paragraph: { rich_text: [{ type: 'text', text: { content: 'loose text' } }] },
			},
		]);
		assert.equal(result.ok, false);
		assert.equal(result.errors[0]?.code, 'content_before_first_section');
	});

	it('refuses a page with no Motivation section', () => {
		const result = mapNotionPage(basePage().page, [
			{
				object: 'block',
				id: 'h-1',
				type: 'heading_2',
				heading_2: { rich_text: [{ type: 'text', text: { content: 'Architecture' } }] },
			},
			{
				object: 'block',
				id: 'p-1',
				type: 'paragraph',
				paragraph: { rich_text: [{ type: 'text', text: { content: 'Only design notes.' } }] },
			},
		]);
		assert.equal(result.ok, false);
		assert.equal(result.errors[0]?.code, 'missing_motivation');
	});

	it('reads an image block into a descriptor instead of refusing the page', () => {
		const result = mapNotionPage(basePage().page, [
			{
				object: 'block',
				id: 'h-1',
				type: 'heading_2',
				heading_2: { rich_text: [{ type: 'text', text: { content: 'Motivation' } }] },
			},
			{
				object: 'block',
				id: 'p-1',
				type: 'paragraph',
				paragraph: { rich_text: [{ type: 'text', text: { content: 'Why.' } }] },
			},
			{
				object: 'block',
				id: 'img-1',
				type: 'image',
				image: {
					type: 'external',
					external: { url: 'https://example.com/a.png' },
					caption: [],
				},
			},
		]);
		assert.equal(result.ok, true, JSON.stringify(result.errors));
		assert.equal(result.media.length, 1);
		assert.equal(result.media[0].blockId, 'img-1');
		// The record itself carries nothing until the ingest has the bytes.
		assert.deepEqual(result.record.media, []);
	});
});

describe('link parsing', () => {
	it('accepts the documented line format', () => {
		const result = parseLinks(
			'repo https://github.com/example/one One\nshop https://example.com/s',
		);
		assert.equal(result.ok, true);
		assert.deepEqual(
			result.links.map((link) => [link.kind, link.label, link.displayOrder]),
			[
				['repo', 'One', 0],
				['shop', null, 1],
			],
		);
	});

	it('refuses an unknown kind and an insecure URL', () => {
		const unknown = parseLinks('wiki https://example.com');
		assert.equal(unknown.ok, false);
		assert.equal(unknown.errors[0]?.code, 'malformed_link');
		const insecure = parseLinks('repo http://example.com');
		assert.equal(insecure.ok, false);
		assert.equal(insecure.errors[0]?.code, 'insecure_link');
	});
});

describe('snapshot assembly', () => {
	it('is stable across runs and independent of page order', () => {
		const { records } = mapDocuments(fixtureDocument().pages);
		const reversed = [...records].reverse();
		assert.equal(contentDigest(records), contentDigest(reversed));
	});

	it('never marks a reason and availability inconsistently', () => {
		const snapshot = buildSnapshot({
			databaseId: 'db-1',
			records: [],
			now: NOW,
			unavailable: 'rate_limited',
		});
		assert.equal(snapshot.availability, 'unavailable');
		assert.equal(checkSnapshotShape(snapshot), null);

		const broken = { ...snapshot, unavailableReason: null };
		assert.equal(checkSnapshotShape(broken), 'unavailable without a reason');
	});
});

describe('credential containment', () => {
	it('detects the token value and token-shaped literals', () => {
		assert.equal(findCredentialLeak(`{"x":"${TOKEN}"}`, TOKEN), 'token value');
		assert.equal(findCredentialLeak(`{"x":"${TOKEN}"}`, null), 'token-like literal');
		assert.equal(findCredentialLeak('{"x":"nothing"}', null), null);
	});
});

describe('syncNotion exit codes', () => {
	it('writes the snapshot from a fixture', async () => {
		const { exitCode, outPath, stdout } = await runFixture();
		assert.equal(exitCode, 0);
		assert.match(stdout, /^synced records=3/u);
		const written = JSON.parse(readFileSync(outPath, 'utf8'));
		assert.equal(written.schema, 'portfolio-notion-snapshot.v1');
		assert.equal(written.availability, 'public');
		assert.equal(written.records.length, 3);
	});

	it('reports unchanged and does not rewrite when the digest matches', async () => {
		const outPath = tempOut();
		await syncNotion({ fixture: FIXTURE, outPath, now: NOW, stdout: silent(), stderr: silent() });
		const before = readFileSync(outPath);
		const capture = readCapture();
		const exitCode = await syncNotion({
			fixture: FIXTURE,
			outPath,
			now: new Date('2026-11-01T00:00:00.000Z'),
			stdout: capture.stream,
			stderr: silent(),
		});
		assert.equal(exitCode, 0);
		assert.match(capture.text(), /^unchanged records=3/u);
		assert.deepEqual(readFileSync(outPath), before);
	});

	it('writes nothing when a page cannot be mapped', async () => {
		const document = fixtureDocument();
		document.pages[0].blocks = [
			{
				object: 'block',
				id: 'h-1',
				type: 'heading_2',
				heading_2: { rich_text: [{ type: 'text', text: { content: 'Appendix' } }] },
			},
		];
		const fixture = join(mkdtempSync(join(tmpdir(), 'notion-fixture-')), 'broken.json');
		writeFileSync(fixture, JSON.stringify(document));
		const outPath = tempOut();
		writeFileSync(outPath, '{"schema":"portfolio-notion-snapshot.v1","sentinel":true}');
		const before = readFileSync(outPath);

		const { exitCode, stderr } = await runFixture(fixture, { outPath });
		assert.equal(exitCode, 1);
		assert.match(stderr, /unknown_section_heading/u);
		assert.deepEqual(readFileSync(outPath), before);
	});
});

describe('syncNotion live mode', () => {
	it('stops before any request when the token is missing', async () => {
		const outPath = tempOut();
		const capture = readCapture();
		let called = false;
		const exitCode = await syncNotion({
			outPath,
			now: NOW,
			env: {},
			fetchImpl: () => {
				called = true;
				return Promise.resolve(new Response('{}'));
			},
			stdout: silent(),
			stderr: capture.stream,
		});
		assert.equal(exitCode, 3);
		assert.equal(called, false);
		assert.match(capture.text(), /NOTION_TOKEN/u);
		assert.equal(existsSync(outPath), false);
	});

	it('reads the database, its data source, and each page body', async () => {
		const outPath = tempOut();
		const exitCode = await syncNotion({
			outPath,
			now: NOW,
			env: { NOTION_TOKEN: TOKEN, NOTION_PORTFOLIO_DB_ID: 'db-1' },
			fetchImpl: supports(fixtureDocument().pages[0].page.id),
			stdout: silent(),
			stderr: silent(),
		});
		assert.equal(exitCode, 0);
		const written = JSON.parse(readFileSync(outPath, 'utf8'));
		assert.equal(written.source.databaseId, 'db-1');
		assert.equal(written.source.idKind, 'database');
		assert.equal(written.records.length, 1);
	});

	// The id an operator copies out of Notion is often a data source id, not
	// a database id: the data-source model gives one table two ids and only
	// the query endpoint takes the one the UI shows. Accepting both is what
	// keeps the secret they stored from being wrong for a reason that has
	// nothing to do with them.
	it('accepts a data source id when the database read misses', async () => {
		const outPath = tempOut();
		const pageId = fixtureDocument().pages[0].page.id;
		const seen = [];
		const exitCode = await syncNotion({
			outPath,
			now: NOW,
			env: { NOTION_TOKEN: TOKEN, NOTION_PORTFOLIO_DB_ID: 'ds-1' },
			fetchImpl: (url, init) => {
				seen.push(`${init?.method ?? 'GET'} ${url}`);
				if (url.endsWith('/databases/ds-1')) {
					return Promise.resolve(new Response('{}', { status: 404 }));
				}
				return supports(pageId)(url, init);
			},
			stdout: silent(),
			stderr: silent(),
		});
		assert.equal(exitCode, 0);
		const written = JSON.parse(readFileSync(outPath, 'utf8'));
		assert.equal(written.source.databaseId, 'ds-1');
		assert.equal(written.source.idKind, 'data_source');
		assert.equal(written.records.length, 1);
		assert.equal(seen[0], 'GET https://api.notion.com/v1/databases/ds-1');
	});

	it('reports a 404 when neither id resolves', async () => {
		const outPath = tempOut();
		const capture = readCapture();
		const exitCode = await syncNotion({
			outPath,
			now: NOW,
			env: { NOTION_TOKEN: TOKEN, NOTION_PORTFOLIO_DB_ID: 'nowhere' },
			fetchImpl: () => Promise.resolve(new Response('{}', { status: 404 })),
			stdout: silent(),
			stderr: capture.stream,
		});
		assert.equal(exitCode, 3);
		assert.match(capture.text(), /not found while reading the data source/u);
		assert.equal(existsSync(outPath), false);
	});

	it('refuses a database with more than one data source', async () => {
		const outPath = tempOut();
		const capture = readCapture();
		const exitCode = await syncNotion({
			outPath,
			now: NOW,
			env: { NOTION_TOKEN: TOKEN, NOTION_PORTFOLIO_DB_ID: 'db-1' },
			fetchImpl: () =>
				Promise.resolve(
					new Response(
						JSON.stringify({
							id: 'db-1',
							data_sources: [
								{ id: 'ds-1', name: 'A' },
								{ id: 'ds-2', name: 'B' },
							],
						}),
						{ status: 200 },
					),
				),
			stdout: silent(),
			stderr: capture.stream,
		});
		assert.equal(exitCode, 3);
		assert.match(capture.text(), /2 data sources/u);
		assert.equal(existsSync(outPath), false);
	});

	it('writes nothing on a rejected credential', async () => {
		const outPath = tempOut();
		const exitCode = await syncNotion({
			outPath,
			now: NOW,
			env: { NOTION_TOKEN: TOKEN, NOTION_PORTFOLIO_DB_ID: 'db-1' },
			fetchImpl: () => Promise.resolve(new Response('{}', { status: 401 })),
			stdout: silent(),
			stderr: silent(),
		});
		assert.equal(exitCode, 3);
		assert.equal(existsSync(outPath), false);
	});

	it('records unavailable and keeps the last known records on a 5xx', async () => {
		const outPath = tempOut();
		await syncNotion({ fixture: FIXTURE, outPath, now: NOW, stdout: silent(), stderr: silent() });
		const previous = JSON.parse(readFileSync(outPath, 'utf8'));

		const exitCode = await syncNotion({
			outPath,
			now: new Date('2026-11-01T00:00:00.000Z'),
			env: { NOTION_TOKEN: TOKEN, NOTION_PORTFOLIO_DB_ID: previous.source.databaseId },
			fetchImpl: () => Promise.resolve(new Response('{}', { status: 503 })),
			stdout: silent(),
			stderr: silent(),
		});
		assert.equal(exitCode, 0);
		const written = JSON.parse(readFileSync(outPath, 'utf8'));
		assert.equal(written.availability, 'unavailable');
		assert.equal(written.unavailableReason, 'source_error');
		assert.equal(written.records.length, previous.records.length);
		assert.equal(written.source.fetchedAt, previous.source.fetchedAt);
	});
});

describe('parseArgs', () => {
	it('rejects an unknown argument', () => {
		assert.throws(() => parseArgs(['--nope']), /unknown argument/u);
	});

	it('requires a value for --fixture', () => {
		assert.throws(() => parseArgs(['--fixture']), /needs a value/u);
	});

	it('routes --out and --dry-run', () => {
		const options = parseArgs(['--out', '/tmp/x.json', '--dry-run']);
		assert.equal(options.out, '/tmp/x.json');
		assert.equal(options.dryRun, true);
	});

	it('defaults the R2 target to local and only accepts a named target', () => {
		assert.equal(parseArgs([]).r2Target, 'local');
		assert.equal(parseArgs(['--r2-target', 'production']).r2Target, 'production');
		assert.throws(() => parseArgs(['--r2-target', 'remote']), /must be local or production/u);
	});
});

/* -------------------------------------------------------------------------
 * Media ingest (Issue #889)
 * -------------------------------------------------------------------------
 */

const SIGNED_URL =
	'https://secure.notion-static.com/obj?X-Amz-Signature=cafebabe&X-Amz-Expires=3600';
const SIGNED_TOKEN = 'cafebabe';
const IMAGE_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const REFERENCE_URL = 'https://example.com/reference';

function text(content) {
	return [{ type: 'text', text: { content } }];
}

function mediaFixture({ duplicate = false } = {}) {
	const blocks = [
		{
			object: 'block',
			id: 'h-1',
			type: 'heading_2',
			heading_2: { rich_text: text('Motivation') },
		},
		{ object: 'block', id: 'p-1', type: 'paragraph', paragraph: { rich_text: text('Why.') } },
		{
			object: 'block',
			id: 'img-1',
			type: 'image',
			image: {
				type: 'file',
				file: { url: SIGNED_URL, expiry_time: '2026-11-04T14:00:00.000Z' },
				caption: text('A cat'),
			},
		},
		...(duplicate
			? [
					{
						object: 'block',
						id: 'img-2',
						type: 'image',
						image: {
							type: 'external',
							external: { url: 'https://example.com/same-cat.png' },
							caption: [],
						},
					},
				]
			: []),
		{
			object: 'block',
			id: 'bm-1',
			type: 'bookmark',
			bookmark: { url: REFERENCE_URL, caption: [] },
		},
	];
	return {
		databaseId: 'db-1',
		sourceUrl: null,
		pages: [{ page: basePage().page, blocks }],
	};
}

function writeFixture(document) {
	const path = join(mkdtempSync(join(tmpdir(), 'notion-media-')), 'fixture.json');
	writeFileSync(path, JSON.stringify(document));
	return path;
}

function imageFetch({ bytes = IMAGE_BYTES, contentType = 'image/png', status = 200 } = {}) {
	return (url) => {
		if (url !== SIGNED_URL && url !== 'https://example.com/same-cat.png') {
			return Promise.reject(new Error('unexpected media url'));
		}
		return Promise.resolve(
			new Response(bytes, {
				status,
				headers: contentType === null ? {} : { 'content-type': contentType },
			}),
		);
	};
}

function fakeR2({ existing = [], objects = {}, failPut = false, failList = false } = {}) {
	const state = { puts: [] };
	return {
		state,
		async listKeys() {
			if (failList) throw new Error('listing_failed');
			return [...existing];
		},
		async getObject(key) {
			const bytes = objects[key];
			if (bytes === undefined) throw new Error('missing object');
			return bytes;
		},
		async putObject(key, filePath, options) {
			if (failPut) throw new Error('put failed');
			state.puts.push({
				key,
				contentType: options.contentType,
				target: options.target,
				execute: options.execute,
				bytes: readFileSync(filePath),
			});
			return { applied: true, key };
		},
	};
}

function runMediaFixture(options = {}, fixtureOptions = {}) {
	return runFixture(writeFixture(mediaFixture(fixtureOptions)), options);
}

describe('media ingest', () => {
	it('stores the bytes under a content-addressed key and never a Notion URL', async () => {
		const r2 = fakeR2();
		const { exitCode, outPath, stdout } = await runMediaFixture({
			fetchImpl: imageFetch(),
			r2,
			inventory: readRightsInventory(),
		});
		assert.equal(exitCode, 0);
		assert.match(
			stdout,
			/^synced records=1 findings=0 media=1 media_bytes=8 would_upload=1 upload_bytes=8 reused=0/u,
		);
		assert.equal(r2.state.puts.length, 1);
		assert.equal(r2.state.puts[0].contentType, 'image/png');
		assert.equal(r2.state.puts[0].target, 'local');
		assert.equal(r2.state.puts[0].execute, false);
		assert.deepEqual(r2.state.puts[0].bytes, IMAGE_BYTES);

		const written = JSON.parse(readFileSync(outPath, 'utf8'));
		assert.equal(checkSnapshotShape(written), null);
		const [media] = written.records[0].media;
		const sha256 = createHash('sha256').update(IMAGE_BYTES).digest('hex');
		assert.equal(media.r2Key, `portfolio/notion/${sha256}.png`);
		assert.equal(media.contentType, 'image/png');
		assert.equal(media.width, null);
		assert.equal(media.height, null);
		assert.equal(media.alt, 'A cat');
		assert.equal(media.caption, 'A cat');
		assert.equal(media.isCover, true);
		assert.equal(media.displayOrder, 0);
		// The shipped inventory records no portfolio asset, so the honest
		// verdict is `unrecorded` (ADR-0019 / Issue #811: published, and
		// shown as unreviewed — never upgraded to `recorded`).
		assert.equal(media.rights, 'unrecorded');

		// The containment rule: no expiring address, no signature, no URL
		// field anywhere near the committed file.
		const mediaJson = JSON.stringify(written.records[0].media);
		assert.equal(mediaJson.includes('http'), false);
		assert.equal(mediaJson.includes('notion-static'), false);
		assert.equal(mediaJson.includes(SIGNED_TOKEN), false);
		const serialized = readFileSync(outPath, 'utf8');
		assert.equal(serialized.includes(SIGNED_URL), false);
		assert.equal(serialized.includes('X-Amz'), false);
		// The bookmark, by contrast, IS content: it reaches the body as a
		// Markdown link, in document order.
		assert.match(written.records[0].sections.motivation, /example\.com\/reference/u);
	});

	it('downloads and hashes on --dry-run but writes no snapshot and no object', async () => {
		const r2 = fakeR2();
		const { exitCode, outPath, stdout } = await runMediaFixture({
			dryRun: true,
			fetchImpl: imageFetch(),
			r2,
			inventory: readRightsInventory(),
		});
		assert.equal(exitCode, 0);
		assert.equal(existsSync(outPath), false);
		assert.equal(r2.state.puts.length, 0);
		// media_bytes proves the bytes were actually fetched and hashed.
		assert.match(stdout, /media=1 media_bytes=8 would_upload=1/u);
		assert.match(stdout, /written=false/u);
	});

	it('reuses an existing object with identical bytes instead of storing it twice', async () => {
		const legacyKey = 'portfolio/legacy/cat.png';
		const r2 = fakeR2({ existing: [legacyKey], objects: { [legacyKey]: IMAGE_BYTES } });
		const { exitCode, outPath, stdout } = await runMediaFixture({
			fetchImpl: imageFetch(),
			r2,
			inventory: readRightsInventory(),
		});
		assert.equal(exitCode, 0);
		assert.equal(r2.state.puts.length, 0);
		assert.match(stdout, /would_upload=0/u);
		assert.match(stdout, /reused=1/u);
		const written = JSON.parse(readFileSync(outPath, 'utf8'));
		// The Issue #850 overlap: the record points at the object that is
		// already there. Nothing existing is deleted or rewritten.
		assert.equal(written.records[0].media[0].r2Key, legacyKey);
	});

	it('uploads identical bytes once even when two blocks reference them', async () => {
		const r2 = fakeR2();
		const { exitCode, outPath, stdout } = await runMediaFixture(
			{ fetchImpl: imageFetch(), r2, inventory: readRightsInventory() },
			{ duplicate: true },
		);
		assert.equal(exitCode, 0);
		assert.match(stdout, /media=2 media_bytes=16 would_upload=1 upload_bytes=8 reused=1/u);
		assert.equal(r2.state.puts.length, 1);
		const written = JSON.parse(readFileSync(outPath, 'utf8'));
		const [first, second] = written.records[0].media;
		assert.equal(first.r2Key, second.r2Key);
		assert.equal(first.displayOrder, 0);
		assert.equal(second.displayOrder, 1);
		assert.equal(second.isCover, false);
	});

	it('fails closed with a stable code when a byte fetch fails', async () => {
		const r2 = fakeR2();
		const { exitCode, outPath, stderr } = await runMediaFixture({
			fetchImpl: imageFetch({ status: 404 }),
			r2,
			inventory: readRightsInventory(),
		});
		assert.equal(exitCode, 1);
		assert.match(stderr, /code=media_download_failed detail=http_404/u);
		assert.match(stderr, /nothing was written/u);
		assert.equal(existsSync(outPath), false);
		assert.equal(r2.state.puts.length, 0);
	});

	it('maps a mid-body transport failure to the stable code', async () => {
		const failing = new Response(
			new ReadableStream({
				pull() {
					throw new Error('terminated');
				},
			}),
			{ status: 200, headers: { 'content-type': 'image/png' } },
		);
		const r2 = fakeR2();
		const { exitCode, stderr } = await runMediaFixture({
			fetchImpl: () => Promise.resolve(failing),
			r2,
			inventory: readRightsInventory(),
		});
		assert.equal(exitCode, 1);
		assert.match(stderr, /code=media_download_failed detail=stream/u);
		assert.equal(r2.state.puts.length, 0);
	});

	it('refuses a content type the delivery route would not serve', async () => {
		const r2 = fakeR2();
		const { exitCode, stderr } = await runMediaFixture({
			fetchImpl: imageFetch({ contentType: 'text/html' }),
			r2,
			inventory: readRightsInventory(),
		});
		assert.equal(exitCode, 1);
		assert.match(stderr, /code=media_content_type_refused/u);
		assert.equal(r2.state.puts.length, 0);
	});

	it('types a response with no header from its own bytes', async () => {
		const r2 = fakeR2();
		const { exitCode, outPath } = await runMediaFixture({
			fetchImpl: imageFetch({ contentType: null }),
			r2,
			inventory: readRightsInventory(),
		});
		assert.equal(exitCode, 0);
		const written = JSON.parse(readFileSync(outPath, 'utf8'));
		assert.equal(written.records[0].media[0].contentType, 'image/png');
	});

	it('fails closed when an upload fails, without writing the snapshot', async () => {
		const r2 = fakeR2({ failPut: true });
		const { exitCode, outPath, stderr } = await runMediaFixture({
			fetchImpl: imageFetch(),
			r2,
			inventory: readRightsInventory(),
		});
		assert.equal(exitCode, 1);
		assert.match(stderr, /media upload failed code=media_upload_failed/u);
		assert.equal(existsSync(outPath), false);
	});

	it('fails closed when the bucket cannot be listed', async () => {
		const r2 = fakeR2({ failList: true });
		const { exitCode, outPath, stderr } = await runMediaFixture({
			fetchImpl: imageFetch(),
			r2,
			inventory: readRightsInventory(),
		});
		assert.equal(exitCode, 1);
		assert.match(stderr, /media ingest failed code=r2_list_failed/u);
		assert.equal(existsSync(outPath), false);
		assert.equal(r2.state.puts.length, 0);
	});

	it('reads the shipped rights inventory and never fabricates a record', () => {
		const inventory = readRightsInventory();
		assert.equal(rightsForR2Key('portfolio/notion/aa11.png', inventory), 'unrecorded');
		// The lookup is a real rule, not a constant: a covered, verified
		// asset reads as recorded, and one verified with `none` does not.
		const covered = {
			assets: [{ covers: ['portfolio/**'], verification: { method: 'repository-evidence' } }],
		};
		assert.equal(rightsForR2Key('portfolio/x.png', covered), 'recorded');
		const unverified = { assets: [{ covers: ['portfolio/**'], verification: { method: 'none' } }] };
		assert.equal(rightsForR2Key('portfolio/x.png', unverified), 'unrecorded');
	});

	it('refuses to invent a rights inventory it cannot read', () => {
		assert.throws(
			() => readRightsInventory('/nonexistent/asset-license-inventory.json'),
			(error) => error instanceof MediaIngestError && error.code === 'rights_inventory_unreadable',
		);
	});
});
