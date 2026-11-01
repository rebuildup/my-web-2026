import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { mapDocuments, mapNotionPage, parseLinks } from './_notion-mapper.mjs';
import {
	buildSnapshot,
	checkSnapshotShape,
	contentDigest,
	findCredentialLeak,
	parseArgs,
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
				id: 'img-1',
				type: 'image',
				image: { type: 'external', external: { url: 'https://example.com/a.png' } },
			},
		];
		const { records, errors } = mapDocuments([document.pages[0], broken]);
		assert.equal(records.length, 1);
		assert.deepEqual(
			errors.map((error) => error.code),
			['image_block_unsupported'],
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

	it('refuses an image block rather than dropping it', () => {
		const result = mapNotionPage(basePage().page, [
			{
				object: 'block',
				id: 'h-1',
				type: 'heading_2',
				heading_2: { rich_text: [{ type: 'text', text: { content: 'Motivation' } }] },
			},
			{
				object: 'block',
				id: 'img-1',
				type: 'image',
				image: { type: 'external', external: { url: 'https://example.com/a.png' } },
			},
		]);
		assert.equal(result.ok, false);
		assert.equal(result.errors[0]?.code, 'image_block_unsupported');
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
			env: { NOTION_TOKEN: TOKEN, NOTION_PORTFOLIO_DATABASE_ID: 'db-1' },
			fetchImpl: supports(fixtureDocument().pages[0].page.id),
			stdout: silent(),
			stderr: silent(),
		});
		assert.equal(exitCode, 0);
		const written = JSON.parse(readFileSync(outPath, 'utf8'));
		assert.equal(written.source.databaseId, 'db-1');
		assert.equal(written.records.length, 1);
	});

	it('refuses a database with more than one data source', async () => {
		const outPath = tempOut();
		const capture = readCapture();
		const exitCode = await syncNotion({
			outPath,
			now: NOW,
			env: { NOTION_TOKEN: TOKEN, NOTION_PORTFOLIO_DATABASE_ID: 'db-1' },
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
			env: { NOTION_TOKEN: TOKEN, NOTION_PORTFOLIO_DATABASE_ID: 'db-1' },
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
			env: { NOTION_TOKEN: TOKEN, NOTION_PORTFOLIO_DATABASE_ID: previous.source.databaseId },
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
});
