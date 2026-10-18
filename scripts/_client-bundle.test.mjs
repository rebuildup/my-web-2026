/**
 * Fixture-driven tests for the client bundle map analysis (Issue #483).
 *
 * The analysis is deliberately separated from the I/O in
 * `scripts/report-client-bundle.mjs` so every finding can be proven here
 * against synthetic build output — including the failing shapes the real
 * repository does not have (an orphaned chunk, byte-identical chunks, a
 * host chunk importing a Tool artifact). A regression detector nobody can
 * make fail is not a detector.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
	buildChunkGraph,
	classifyAssetPath,
	collectClientInventory,
	evaluateBundleFindings,
	formatBytes,
	parseChunkImports,
	renderMarkdownReport,
	sharedEntryChunks,
	summarizeRouteLoads,
} from './_client-bundle.mjs';

const entry = 'assets/entry-abc123.js';
const home = 'assets/home-def456.js';
const about = 'assets/about-ghi789.js';
const shared = 'assets/shared-shared.js';
const orphan = 'assets/orphan-orph01.js';
const toolChunk = 'tools/prototype/app/assets/index-tool.js';

function file(path, content) {
	const bytes = Buffer.byteLength(content);
	return {
		path,
		bytes,
		gzipBytes: Math.round(bytes / 2),
		sha256: createHash('sha256').update(content).digest('hex'),
	};
}

/** A build output with one entry chunk and two lazy route chunks. */
function healthyBuild() {
	const chunks = [
		{
			path: entry,
			content: `import"./${shared.split('/')[1]}";import("./${home.split('/')[1]}");import("./${about.split('/')[1]}");`,
		},
		{ path: home, content: `import"./${shared.split('/')[1]}";export const page = "home";` },
		{ path: about, content: `import"./${shared.split('/')[1]}";export const page = "about";` },
		{ path: shared, content: 'export const shared = 1;' },
	];
	return [
		file(entry, chunks[0].content),
		file(home, chunks[1].content),
		file(about, chunks[2].content),
		file(shared, chunks[3].content),
		file('assets/site.css', '.a{color:red}'),
	];
}

/**
 * A build output whose chunks form a cycle: nothing is a graph root, so
 * reachability cannot be seeded without a measurement. This is the shape
 * a naive "count the unreachable chunks" detector would report as clean.
 */
function rootlessChunks() {
	return [
		{ path: home, imports: { staticImports: [shared.split('/')[1]], dynamicImports: [] } },
		{ path: shared, imports: { staticImports: [home.split('/')[1]], dynamicImports: [] } },
	];
}

test('classifyAssetPath separates host chunks, Tool artifacts and static files', () => {
	assert.equal(classifyAssetPath('assets/entry-abc.js'), 'host-js');
	assert.equal(classifyAssetPath('assets/site.css'), 'host-css');
	assert.equal(classifyAssetPath('assets/nested/thing.txt'), 'host-other');
	assert.equal(classifyAssetPath(toolChunk), 'tool');
	assert.equal(classifyAssetPath('favicon.svg'), 'static');
});

test('parseChunkImports splits static, side-effect and lazy imports', () => {
	const source = [
		'import{a}from"./shared.js";',
		'import"./side-effect.js";',
		'const lazy = () => import("./route.js");',
		// A member expression that merely contains `from` must not parse
		// as an import — the real client bundle is full of these.
		'class T{visitColumn(t){return t.from}}',
	].join('');
	const parsed = parseChunkImports(source);
	assert.deepEqual(parsed.staticImports, ['shared.js', 'side-effect.js']);
	assert.deepEqual(parsed.dynamicImports, ['route.js']);
});

test('buildChunkGraph resolves specifiers against the importing chunk directory', () => {
	const chunks = [
		{
			path: entry,
			imports: { staticImports: ['shared-shared.js'], dynamicImports: ['home-def456.js'] },
		},
		{ path: home, imports: { staticImports: [], dynamicImports: [] } },
		{ path: shared, imports: { staticImports: [], dynamicImports: [] } },
	];
	const graph = buildChunkGraph(chunks, { entryChunks: [entry] });
	assert.deepEqual(graph.entryChunks, [entry]);
	assert.deepEqual(graph.unreachableChunks, []);
	assert.deepEqual(graph.edges.get(entry), {
		static: [shared],
		dynamic: [home],
	});
	assert.deepEqual(graph.danglingEdges, []);
});

test('buildChunkGraph reports a rootless build as unresolved, not clean', () => {
	const graph = buildChunkGraph(rootlessChunks());
	assert.equal(graph.entriesResolved, false);
	assert.deepEqual(graph.graphRoots, []);
});

test('buildChunkGraph flags an orphaned chunk and a dangling import', () => {
	const chunks = [
		{ path: entry, imports: { staticImports: [], dynamicImports: ['gone.js'] } },
		{ path: orphan, imports: { staticImports: [], dynamicImports: [] } },
	];
	const graph = buildChunkGraph(chunks, { entryChunks: [entry] });
	assert.deepEqual(graph.unreachableChunks, [orphan]);
	assert.deepEqual(graph.danglingEdges, [`${entry} -> assets/gone.js`]);
});

test('sharedEntryChunks returns the host chunks every measured route loads', () => {
	const measurements = [
		{ route: '/', assets: [{ path: entry }, { path: home }, { path: shared }] },
		{ route: '/about', assets: [{ path: entry }, { path: about }, { path: shared }] },
		{ route: '/tools', assets: [{ path: entry }, { path: 'tools/index-x.js' }, { path: shared }] },
	];
	assert.deepEqual(sharedEntryChunks(measurements), [entry, shared]);
	// A single route cannot prove "loaded by every route".
	assert.deepEqual(sharedEntryChunks(measurements.slice(0, 1)), []);
});

test('collectClientInventory buckets files and finds byte-identical chunks', () => {
	const inventory = collectClientInventory([
		file(entry, 'import "./x.js";'),
		file('assets/copy-one.js', 'export const same = 1;'),
		file('assets/copy-two.js', 'export const same = 1;'),
		file('assets/site.css', '.a{}'),
		file(toolChunk, 'console.log(1)'),
		file('favicon.svg', '<svg/>'),
	]);
	assert.equal(inventory.hostJs.length, 3);
	assert.equal(inventory.hostCss.length, 1);
	assert.equal(inventory.tool.length, 1);
	assert.equal(inventory.totals.toolFileCount, 1);
	assert.equal(inventory.duplicates.length, 1);
	assert.deepEqual(inventory.duplicates[0].paths, ['assets/copy-one.js', 'assets/copy-two.js']);
});

test('summarizeRouteLoads separates Tool bytes from host bytes per route', () => {
	const summary = summarizeRouteLoads([
		{
			route: '/',
			status: 200,
			assets: [
				{ path: entry, bytes: 1000, gzipBytes: 400 },
				{ path: home, bytes: 200, gzipBytes: 80 },
			],
		},
		{
			route: '/tools/prototype',
			status: 200,
			assets: [
				{ path: entry, bytes: 1000, gzipBytes: 400 },
				{ path: toolChunk, bytes: 5000, gzipBytes: 1500 },
				{ path: '/_serverFn/abc', bytes: null, gzipBytes: null },
			],
		},
	]);
	const [homeRoute, toolRoute] = summary.routes;
	assert.equal(homeRoute.toolBytes, 0);
	assert.equal(homeRoute.bytes, 1200);
	assert.equal(toolRoute.toolBytes, 5000);
	assert.equal(toolRoute.unknownAssetCount, 1);
	assert.deepEqual(
		summary.shared.map((entryRow) => entryRow.path),
		[entry],
	);
});

test('summarizeRouteLoads keeps SSR documents out of the asset totals', () => {
	const summary = summarizeRouteLoads([
		{
			route: '/',
			status: 200,
			assets: [
				{ path: '/', kind: 'document', bytes: null, gzipBytes: null },
				{ path: entry, kind: 'asset', bytes: 1000, gzipBytes: 400 },
				{ path: 'assets/not-emitted.js', kind: 'asset', bytes: null, gzipBytes: null },
			],
		},
	]);
	const [home] = summary.routes;
	assert.equal(home.documentCount, 1);
	assert.equal(home.assetCount, 2);
	assert.deepEqual(home.unknownAssetPaths, ['assets/not-emitted.js']);
	assert.equal(home.bytes, 1000);
});

test('evaluateBundleFindings fails when a route requests an unbuilt asset', () => {
	const inventory = collectClientInventory(healthyBuild());
	const graph = buildChunkGraph(
		[{ path: entry, imports: { staticImports: [], dynamicImports: [] } }],
		{ entryChunks: [entry] },
	);
	const routeSummary = summarizeRouteLoads([
		{
			route: '/',
			status: 200,
			assets: [
				{ path: '/', kind: 'document', bytes: null, gzipBytes: null },
				{ path: entry, kind: 'asset', bytes: 10, gzipBytes: 5 },
				{ path: 'assets/ghost.js', kind: 'asset', bytes: null, gzipBytes: null },
			],
		},
		{ route: '/about', status: 200, assets: [{ path: entry, kind: 'asset', bytes: 10 }] },
	]);
	const findings = evaluateBundleFindings({ inventory, graph, routeSummary, homeRoute: '/' });
	const missing = findings.find((item) => item.id === 'no-missing-assets');
	assert.equal(missing.status, 'fail');
	assert.deepEqual(missing.evidence.missing, ['/ -> assets/ghost.js']);
});

test('evaluateBundleFindings passes a clean build and fails a leaking one', () => {
	const inventory = collectClientInventory(healthyBuild());
	const chunks = [
		{
			path: entry,
			imports: {
				staticImports: [shared.split('/')[1]],
				dynamicImports: [home.split('/')[1], about.split('/')[1]],
			},
		},
		{ path: home, imports: { staticImports: [shared.split('/')[1]], dynamicImports: [] } },
		{ path: about, imports: { staticImports: [shared.split('/')[1]], dynamicImports: [] } },
		{ path: shared, imports: { staticImports: [], dynamicImports: [] } },
	];
	const graph = buildChunkGraph(chunks, { entryChunks: [entry] });
	const routeSummary = summarizeRouteLoads([
		{
			route: '/',
			status: 200,
			assets: [
				{ path: entry, bytes: 10 },
				{ path: home, bytes: 10 },
			],
		},
		{
			route: '/about',
			status: 200,
			assets: [
				{ path: entry, bytes: 10 },
				{ path: about, bytes: 10 },
			],
		},
	]);
	const clean = evaluateBundleFindings({ inventory, graph, routeSummary, homeRoute: '/' });
	assert.equal(
		clean.filter((item) => item.status !== 'pass').length,
		0,
		JSON.stringify(clean, null, 2),
	);

	const leaking = evaluateBundleFindings({
		inventory,
		graph,
		routeSummary: summarizeRouteLoads([
			{
				route: '/',
				status: 200,
				assets: [
					{ path: entry, bytes: 10 },
					{ path: toolChunk, bytes: 900 },
				],
			},
			{ route: '/about', status: 200, assets: [{ path: entry, bytes: 10 }] },
		]),
		homeRoute: '/',
	});
	const isolation = leaking.find((item) => item.id === 'home-tool-isolation');
	assert.equal(isolation.status, 'fail');
	assert.match(isolation.detail, /900 byte\(s\)/);
});

test('evaluateBundleFindings marks reachability skipped when no entry is known', () => {
	const graph = buildChunkGraph(rootlessChunks());
	const findings = evaluateBundleFindings({
		inventory: collectClientInventory([
			file(home, 'import"./shared-shared.js";'),
			file(shared, 'import"./home-def456.js";'),
		]),
		graph,
		routeSummary: null,
		homeRoute: '/',
	});
	const reachability = findings.find((item) => item.id === 'no-unreachable-chunks');
	assert.equal(reachability.status, 'skipped');
	// Without a measurement there is no Home claim to make either.
	assert.equal(
		findings.some((item) => item.id === 'home-tool-isolation'),
		false,
	);
});

test('renderMarkdownReport states the conditions, findings and route map', () => {
	const inventory = collectClientInventory(healthyBuild());
	const graph = buildChunkGraph(
		[
			{ path: entry, imports: { staticImports: [], dynamicImports: [home.split('/')[1]] } },
			{ path: home, imports: { staticImports: [shared.split('/')[1]], dynamicImports: [] } },
			{ path: shared, imports: { staticImports: [], dynamicImports: [] } },
		],
		{ entryChunks: [entry] },
	);
	const routeSummary = summarizeRouteLoads([
		{ route: '/', status: 200, assets: [{ path: entry, bytes: 1000, gzipBytes: 400 }] },
	]);
	const markdown = renderMarkdownReport({
		clientDir: 'dist/client',
		mode: 'static only',
		conditions: {
			sourceSha: 'deadbeef',
			sourceRef: '483',
			measuredAt: '2026-01-01T00:00:00.000Z',
			node: 'v22.18.0',
			vite: '7.1.0',
			os: 'Linux 6.0',
			arch: 'x64',
			cpu: 'fixture cpu',
			browser: null,
			network: 'not measured (static pass only)',
		},
		inventory,
		graph: {
			edges: Object.fromEntries(graph.edges),
			entryChunks: graph.entryChunks,
			graphRoots: graph.graphRoots,
			unreachableChunks: graph.unreachableChunks,
			danglingEdges: graph.danglingEdges,
		},
		routeSummary,
		findings: evaluateBundleFindings({ inventory, graph, routeSummary, homeRoute: '/' }),
	});
	assert.match(markdown, /# Client bundle map/);
	assert.match(markdown, /deadbeef/);
	assert.match(markdown, /fixture cpu/);
	assert.match(markdown, /Route dependency map/);
	assert.match(markdown, /report, not a gate/);
	assert.match(markdown, new RegExp(entry.replace('.', '\\.')));
});

test('formatBytes switches unit at 1024 boundaries', () => {
	assert.equal(formatBytes(512), '512 B');
	assert.equal(formatBytes(2048), '2.0 kB');
	assert.equal(formatBytes(2 * 1024 * 1024), '2.00 MB');
	assert.equal(formatBytes(null), 'n/a');
});
