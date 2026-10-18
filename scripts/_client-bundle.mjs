/**
 * Pure client-bundle analysis for the bundle map report (Issue #483).
 *
 * Why a separate module
 * --------------------
 * `scripts/report-client-bundle.mjs` owns every side effect: walking the
 * built output, reading files, driving a browser, writing files. This
 * module is total functions over already-collected plain data, so
 * `scripts/_client-bundle.test.mjs` can prove every finding against
 * synthetic fixtures instead of a real `vite build`.
 *
 * What it answers
 * ---------------
 *   1. route dependency — which emitted chunks a route loads, and what
 *      each one costs (raw + gzip estimate);
 *   2. duplicate bundle — chunks whose emitted bytes are identical, and
 *      chunks loaded by more than one route (the shared backbone);
 *   3. unused code — chunks no entry chunk can reach;
 *   4. Tool isolation — bytes under `tools/**` that a host route loads,
 *      which is the "does Home pull in the heavy Tool libraries?"
 *      question the bundle map exists to answer.
 *
 * What it deliberately does NOT do
 * --------------------------------
 * It never writes to disk, never spawns a process, and never imports a
 * runtime dependency. It also does not decide whether a number is
 * acceptable: it reports findings with a pass/fail status and the
 * caller decides what to do with them. This is a report, not a gate
 * (quality/profile.yaml records that it is wired into no `validate:*`
 * entry point).
 */

/** Everything the Cloudflare static-asset directory serves under `/assets/`. */
export const HOST_PREFIX = 'assets/';
/** Tool artifacts, mirrored into the asset directory by build-tools.mjs. */
export const TOOL_PREFIX = 'tools/';

/**
 * `from"./chunk.js"` — the statically-resolved Rollup import form.
 * The `./` prefix is required: a bare `from"` also appears inside
 * minified member expressions such as `visitColumn(t){return t.from}`,
 * which are not imports at all.
 */
const STATIC_FROM = /\bfrom\s*["']\.\/([^"']+)["']/g;
/** `import"./chunk.js"` — a side-effect-only static import. */
const STATIC_BARE = /\bimport\s*["']\.\/([^"']+)["']/g;
/** `import("./chunk.js")` — a lazy (route-split) import. */
const DYNAMIC_IMPORT = /\bimport\(\s*["']\.\/([^"']+)["']\s*\)/g;

function collectMatches(source, pattern) {
	const found = new Set();
	for (const match of source.matchAll(pattern)) found.add(match[1]);
	return [...found].sort();
}

/**
 * Split an emitted chunk into the chunks it statically imports and the
 * chunks it lazily imports.
 *
 * @param {string} source emitted chunk source
 * @returns {{ staticImports: string[], dynamicImports: string[] }}
 */
export function parseChunkImports(source) {
	const dynamic = collectMatches(source, DYNAMIC_IMPORT);
	// A dynamic import also matches nothing in the static patterns
	// (`import("./x")` has no `from`), so the two sets stay disjoint.
	const statics = new Set([
		...collectMatches(source, STATIC_FROM),
		...collectMatches(source, STATIC_BARE),
	]);
	return { staticImports: [...statics].sort(), dynamicImports: dynamic };
}

/**
 * Classify one path relative to the static-asset root.
 *
 * @param {string} path posix-style relative path, e.g. `assets/entry-abc.js`
 * @returns {'host-js' | 'host-css' | 'host-other' | 'tool' | 'static'}
 */
export function classifyAssetPath(path) {
	if (path.startsWith(TOOL_PREFIX)) return 'tool';
	if (path.startsWith(HOST_PREFIX)) {
		if (path.endsWith('.js') || path.endsWith('.mjs')) return 'host-js';
		if (path.endsWith('.css')) return 'host-css';
		return 'host-other';
	}
	return 'static';
}

function dirname(path) {
	const index = path.lastIndexOf('/');
	return index === -1 ? '' : path.slice(0, index + 1);
}

/**
 * Resolve an emitted `./name` import specifier against the importing
 * chunk's own directory. All client chunks of one Vite environment land
 * in the same directory, but resolving relative keeps the analysis
 * correct if that ever changes.
 */
function resolveSpecifier(fromPath, specifier) {
	const base = dirname(fromPath);
	const target = `${base}${specifier}`.replace(/^\.\//, '');
	const normalized = [];
	for (const segment of target.split('/')) {
		if (segment === '.' || segment === '') continue;
		if (segment === '..') normalized.pop();
		else normalized.push(segment);
	}
	return normalized.join('/');
}

/**
 * Build the chunk-level import graph of the host client build.
 *
 * Entry chunk detection has two sources, in order:
 *   1. `entryChunks` — supplied by the caller. The measurement pass
 *      derives it from the one host chunk that EVERY measured route
 *      loads, which is the client entry (`src/client.tsx`).
 *   2. chunks nothing else imports — Rollup guarantees a non-entry chunk
 *      has at least one importer, so graph roots are entries.
 *
 * Neither source is available when the shared vendor chunk is imported by
 * every other chunk (the usual Vite layout) and no measurement ran. The
 * result is then `entriesResolved: false` and the caller reports the
 * reachability finding as skipped rather than pretending it passed.
 *
 * @param {{ path: string, imports?: { staticImports: string[], dynamicImports: string[] } }[]} chunks
 * @param {{ entryChunks?: string[] }} [options]
 */
export function buildChunkGraph(chunks, { entryChunks } = {}) {
	const known = new Set(chunks.map((chunk) => chunk.path));
	const edges = new Map();
	const referencedBy = new Map();

	for (const chunk of chunks) {
		const staticImports = chunk.imports?.staticImports ?? [];
		const dynamicImports = chunk.imports?.dynamicImports ?? [];
		const resolveAll = (list) =>
			[...new Set(list.map((specifier) => resolveSpecifier(chunk.path, specifier)))].sort();
		const resolvedStatic = resolveAll(staticImports);
		const resolvedDynamic = resolveAll(dynamicImports);
		edges.set(chunk.path, { static: resolvedStatic, dynamic: resolvedDynamic });
		for (const target of [...resolvedStatic, ...resolvedDynamic]) {
			if (!referencedBy.has(target)) referencedBy.set(target, []);
			referencedBy.get(target).push(chunk.path);
		}
	}

	const graphRoots = chunks
		.map((chunk) => chunk.path)
		.filter((path) => (referencedBy.get(path) ?? []).length === 0);

	const seeds = (entryChunks ?? graphRoots).filter((path) => known.has(path));
	const reachable = new Set();
	const queue = [...seeds];
	while (queue.length > 0) {
		const current = queue.pop();
		if (current === undefined || reachable.has(current)) continue;
		reachable.add(current);
		const edge = edges.get(current);
		if (!edge) continue;
		queue.push(...edge.static, ...edge.dynamic);
	}

	const danglingEdges = [];
	for (const [from, edge] of edges) {
		for (const target of [...edge.static, ...edge.dynamic]) {
			if (!known.has(target)) danglingEdges.push(`${from} -> ${target}`);
		}
	}

	return {
		edges,
		referencedBy,
		graphRoots,
		entryChunks: seeds,
		entriesResolved: seeds.length > 0,
		unreachableChunks: chunks.map((c) => c.path).filter((path) => !reachable.has(path)),
		danglingEdges,
	};
}

/**
 * The host chunks a set of route measurements shares. Every SSR page
 * emits the same module entry, so the intersection over at least two
 * routes is the client entry chunk — the graph seed the reachability
 * finding needs.
 *
 * @param {{ assets: { path: string }[] }[]} measurements
 * @returns {string[]}
 */
export function sharedEntryChunks(measurements) {
	if (measurements.length < 2) return [];
	const sets = measurements.map(
		(measurement) =>
			new Set(
				measurement.assets
					.map((asset) => asset.path)
					.filter((path) => classifyAssetPath(path) === 'host-js'),
			),
	);
	return [...sets[0]].filter((path) => sets.every((set) => set.has(path))).sort();
}

/**
 * Group the collected files into the buckets the report renders.
 *
 * @param {{ path: string, bytes: number, gzipBytes?: number, sha256?: string }[]} files
 */
export function collectClientInventory(files) {
	const buckets = {
		hostJs: [],
		hostCss: [],
		hostOther: [],
		tool: [],
		static: [],
	};
	const duplicatesByHash = new Map();
	for (const file of files) {
		const entry = {
			path: file.path,
			bytes: file.bytes,
			gzipBytes: file.gzipBytes ?? null,
		};
		switch (classifyAssetPath(file.path)) {
			case 'host-js':
				buckets.hostJs.push(entry);
				break;
			case 'host-css':
				buckets.hostCss.push(entry);
				break;
			case 'host-other':
				buckets.hostOther.push(entry);
				break;
			case 'tool':
				buckets.tool.push(entry);
				break;
			default:
				buckets.static.push(entry);
		}
		if (file.sha256) {
			if (!duplicatesByHash.has(file.sha256)) duplicatesByHash.set(file.sha256, []);
			duplicatesByHash.get(file.sha256).push(entry);
		}
	}
	for (const bucket of Object.values(buckets)) {
		bucket.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
	}

	const duplicates = [...duplicatesByHash.entries()]
		.filter(([, paths]) => paths.length > 1)
		.map(([sha256, paths]) => ({
			sha256,
			bytes: paths[0].bytes,
			paths: paths.map((p) => p.path).sort(),
		}))
		.sort((a, b) => b.bytes - a.bytes || a.sha256.localeCompare(b.sha256));

	const sum = (list) => list.reduce((total, file) => total + file.bytes, 0);
	const sumGzip = (list) =>
		list.reduce((total, file) => total + (file.gzipBytes ?? Math.round(file.bytes)), 0);

	return {
		...buckets,
		duplicates,
		totals: {
			fileCount: files.length,
			hostJsBytes: sum(buckets.hostJs),
			hostJsGzipBytes: sumGzip(buckets.hostJs),
			hostCssBytes: sum(buckets.hostCss),
			hostCssGzipBytes: sumGzip(buckets.hostCss),
			toolBytes: sum(buckets.tool),
			toolFileCount: buckets.tool.length,
			otherBytes: sum([...buckets.hostOther, ...buckets.static]),
		},
	};
}

/**
 * Fold the per-route measurements into route totals, the shared
 * backbone (assets loaded by more than one route), and the Tool bytes
 * each route pulled in.
 *
 * @param {{ route: string, status?: number, assets: { path: string, kind?: string, bytes?: number | null, gzipBytes?: number | null }[] }[]} measurements
 */
export function summarizeRouteLoads(measurements) {
	const routes = measurements.map((measurement) => {
		const assets = [...measurement.assets].sort(
			(a, b) => (b.bytes ?? 0) - (a.bytes ?? 0) || a.path.localeCompare(b.path),
		);
		const toolAssets = assets.filter((asset) => classifyAssetPath(asset.path) === 'tool');
		// A navigation response is the SSR'd HTML document, rendered by the
		// Worker — it is not an emitted file, so it has no on-disk size and
		// must never be counted as an emitted asset (nor as a missing one).
		const documents = assets.filter((asset) => asset.kind === 'document');
		const missing = assets.filter((asset) => asset.kind !== 'document' && asset.bytes === null);
		return {
			route: measurement.route,
			status: measurement.status ?? null,
			// A route whose navigation failed is carried through, never
			// dropped: an absent route must not read as a clean one.
			error: measurement.error ?? null,
			assetCount: assets.length - documents.length,
			documentCount: documents.length,
			// A non-document response whose path is not in the emitted output is
			// a real finding: the browser asked for a file the build never
			// produced. It is counted and named, never guessed into the bytes.
			unknownAssetCount: missing.length,
			unknownAssetPaths: missing.map((asset) => asset.path),
			bytes: assets.reduce((total, asset) => total + (asset.bytes ?? 0), 0),
			gzipBytes: assets.reduce(
				(total, asset) => total + (asset.gzipBytes ?? Math.round(asset.bytes ?? 0)),
				0,
			),
			toolBytes: toolAssets.reduce((total, asset) => total + (asset.bytes ?? 0), 0),
			toolAssetCount: toolAssets.length,
			assets,
		};
	});

	const byPath = new Map();
	for (const measurement of measurements) {
		for (const asset of measurement.assets) {
			if (!byPath.has(asset.path)) byPath.set(asset.path, { path: asset.path, routes: [] });
			byPath.get(asset.path).routes.push(measurement.route);
		}
	}
	const shared = [...byPath.values()]
		.filter((entry) => entry.routes.length > 1)
		.map((entry) => ({
			path: entry.path,
			routes: [...new Set(entry.routes)].sort(),
			bytes:
				measurements.flatMap((m) => m.assets).find((asset) => asset.path === entry.path)?.bytes ??
				0,
		}))
		.sort((a, b) => b.routes.length - a.routes.length || b.bytes - a.bytes);

	return { routes, shared };
}

function finding(id, title, status, detail, evidence) {
	return { id, title, status, detail, evidence: evidence ?? null };
}

/**
 * Turn the analysis into the small, explicit set of findings the report
 * renders. Each one is a statement about the build output, not a
 * judgement about whether the number is good enough.
 *
 * @param {{
 *   inventory: ReturnType<typeof collectClientInventory>,
 *   graph: ReturnType<typeof buildChunkGraph>,
 *   routeSummary: ReturnType<typeof summarizeRouteLoads> | null,
 *   homeRoute?: string,
 * }} input
 */
export function evaluateBundleFindings({ inventory, graph, routeSummary, homeRoute = '/' }) {
	const findings = [];

	const home = routeSummary?.routes.find((route) => route.route === homeRoute) ?? null;
	if (routeSummary && !home) {
		findings.push(
			finding(
				'home-measured',
				`Home route (${homeRoute}) was measured`,
				'fail',
				`The measurement pass did not record ${homeRoute}, so the Tool-isolation claim cannot be evidenced.`,
				{ measuredRoutes: routeSummary.routes.map((route) => route.route) },
			),
		);
	} else if (home) {
		findings.push(
			finding(
				'home-tool-isolation',
				`Home (${homeRoute}) loads no Tool artifact`,
				home.toolBytes === 0 ? 'pass' : 'fail',
				`${home.toolBytes} byte(s) under tools/** were requested by ${homeRoute} out of ${home.bytes} total byte(s).`,
				{ toolAssets: home.toolAssetCount, toolBytes: home.toolBytes },
			),
		);
	}

	if (routeSummary) {
		const failed = routeSummary.routes.filter((route) => route.error);
		findings.push(
			finding(
				'routes-loaded',
				'Every measured route finished loading',
				failed.length === 0 ? 'pass' : 'fail',
				`${routeSummary.routes.length - failed.length}/${routeSummary.routes.length} measured route(s) loaded; a route that never loaded is reported, never dropped.`,
				{ failed: failed.map((route) => `${route.route}: ${route.error}`) },
			),
		);
	}

	if (!graph.entriesResolved) {
		findings.push(
			finding(
				'no-unreachable-chunks',
				'Every host chunk is reachable from an entry chunk',
				'skipped',
				'The entry chunk could not be determined (no measured route set and no graph root), so reachability is unknown. Re-run with `--base-url=<url>` to resolve it.',
				{ graphRoots: graph.graphRoots },
			),
		);
	} else {
		findings.push(
			finding(
				'no-unreachable-chunks',
				'Every host chunk is reachable from an entry chunk',
				graph.unreachableChunks.length === 0 ? 'pass' : 'fail',
				`Reachable from ${graph.entryChunks.length} seed chunk(s) (the host chunks every measured route loads); ${graph.unreachableChunks.length} unreachable chunk(s).`,
				{ entryChunks: graph.entryChunks, unreachableChunks: graph.unreachableChunks },
			),
		);
	}

	if (routeSummary) {
		const missing = routeSummary.routes.flatMap((route) =>
			route.unknownAssetPaths.map((path) => `${route.route} -> ${path}`),
		);
		findings.push(
			finding(
				'no-missing-assets',
				'Every asset a measured route requests exists in the build output',
				missing.length === 0 ? 'pass' : 'fail',
				`${missing.length} requested path(s) resolved to no emitted file (SSR documents excluded — the Worker renders those, it does not serve them as assets).`,
				{ missing: missing.slice(0, 10) },
			),
		);
	}

	if (routeSummary) {
		// A stale or half-written preview serves HTML that references chunks
		// the current output does not contain. Those responses come back 4xx/5xx,
		// so the run must fail loudly instead of quietly measuring zero bytes.
		const failedAssets = routeSummary.routes.flatMap((route) =>
			route.assets
				.filter((asset) => asset.kind !== 'document' && asset.status && asset.status >= 400)
				.map((asset) => `${route.route} -> ${asset.path} (${asset.status})`),
		);
		findings.push(
			finding(
				'no-failed-assets',
				'Every asset a measured route requests was served successfully',
				failedAssets.length === 0 ? 'pass' : 'fail',
				`${failedAssets.length} asset response(s) were 4xx/5xx. A non-zero answer here usually means the preview server is serving a build other than the analysed output (stale preview, or a rebuild while it was running).`,
				{ failedAssets: failedAssets.slice(0, 10) },
			),
		);
	}

	findings.push(
		finding(
			'no-duplicate-content',
			'No two host chunks ship byte-identical code',
			inventory.duplicates.length === 0 ? 'pass' : 'fail',
			`${inventory.duplicates.length} duplicated content group(s) among ${inventory.totals.fileCount} emitted file(s).`,
			{ duplicates: inventory.duplicates.slice(0, 10) },
		),
	);

	if (graph.danglingEdges.length > 0) {
		findings.push(
			finding(
				'no-dangling-imports',
				'Every chunk import resolves to an emitted chunk',
				'fail',
				`${graph.danglingEdges.length} import(s) point at a file the client output does not contain.`,
				{ danglingEdges: graph.danglingEdges.slice(0, 10) },
			),
		);
	} else {
		findings.push(
			finding(
				'no-dangling-imports',
				'Every chunk import resolves to an emitted chunk',
				'pass',
				'All parsed static and dynamic imports resolve inside the client output.',
			),
		);
	}

	return findings;
}

export function formatBytes(bytes) {
	if (bytes === null || bytes === undefined) return 'n/a';
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb.toFixed(1)} kB`;
	return `${(kb / 1024).toFixed(2)} MB`;
}

function table(header, rows) {
	if (rows.length === 0) return '_none_\n';
	const lines = [
		`| ${header.join(' | ')} |`,
		`| ${header.map(() => '---').join(' | ')} |`,
		...rows.map((row) => `| ${row.join(' | ')} |`),
	];
	return `${lines.join('\n')}\n`;
}

function code(value) {
	return `\`${String(value).replaceAll('|', '\\|')}\``;
}

/**
 * Render the Markdown form of the report. This is the artefact a reader
 * reviews in the PR; the HTML form is the screenshot surface.
 *
 * @param {object} report see `buildReport` in scripts/report-client-bundle.mjs
 */
export function renderMarkdownReport(report) {
	const { conditions, inventory, graph, routeSummary, findings } = report;
	const out = [];

	out.push('# Client bundle map\n');
	out.push(
		'Generated by `pnpm run verify:bundle-map` (Issue #483). This is a **report, not a gate**: no `validate:*` entry point runs it, so it never blocks a build or a release. Regenerate it whenever the client chunking changes.\n',
	);
	out.push(
		`Client output analysed: ${code(report.clientDir)} (${inventory.totals.fileCount} emitted files).\n`,
	);

	out.push('## Reproduction conditions\n');
	out.push(
		table(
			['Condition', 'Value'],
			[
				['source SHA', code(conditions.sourceSha)],
				['source ref', code(conditions.sourceRef)],
				['measured at', code(conditions.measuredAt)],
				['client output', code(report.clientDir)],
				['node', code(conditions.node)],
				['vite', code(conditions.vite)],
				['os / arch', code(`${conditions.os} / ${conditions.arch}`)],
				['cpu', code(conditions.cpu)],
				['browser', code(conditions.browser ?? 'not measured (static pass only)')],
				['network', code(conditions.network)],
				['mode', code(report.mode)],
			],
		),
	);

	out.push('## Findings\n');
	out.push(
		table(
			['Status', 'Finding', 'Detail'],
			findings.map((item) => [
				item.status === 'pass' ? 'PASS' : item.status === 'skipped' ? 'SKIPPED' : '**FAIL**',
				item.title,
				item.detail,
			]),
		),
	);

	out.push('## Emitted client output\n');
	out.push(
		table(
			['Bucket', 'Files', 'Raw', 'gzip -9 (estimate)'],
			[
				[
					'host JS chunks (`assets/**.js`)',
					inventory.hostJs.length,
					formatBytes(inventory.totals.hostJsBytes),
					formatBytes(inventory.totals.hostJsGzipBytes),
				],
				[
					'host CSS (`assets/**.css`)',
					inventory.hostCss.length,
					formatBytes(inventory.totals.hostCssBytes),
					formatBytes(inventory.totals.hostCssGzipBytes),
				],
				[
					'Tool artifacts (`tools/**`)',
					inventory.totals.toolFileCount,
					formatBytes(inventory.totals.toolBytes),
					'n/a',
				],
				[
					'other static files',
					inventory.hostOther.length + inventory.static.length,
					formatBytes(inventory.totals.otherBytes),
					'n/a',
				],
			],
		),
	);
	out.push(
		`Largest host chunks (this is where an unexpectedly heavy dependency shows up):\n\n${table(
			['Chunk', 'Raw', 'gzip -9 (estimate)'],
			inventory.hostJs
				.slice(0, 12)
				.map((chunk) => [code(chunk.path), formatBytes(chunk.bytes), formatBytes(chunk.gzipBytes)]),
		)}`,
	);

	out.push('## Route dependency map\n');
	if (routeSummary) {
		out.push(
			table(
				[
					'Route',
					'Status',
					'Assets',
					'SSR docs',
					'Total',
					'gzip -9 (est.)',
					'Of which Tool artifacts',
					'Not in output',
				],
				routeSummary.routes.map((route) => [
					code(route.route),
					route.error ? `FAILED: ${route.error}` : (route.status ?? 'n/a'),
					route.assetCount,
					route.documentCount,
					formatBytes(route.bytes),
					formatBytes(route.gzipBytes),
					`${formatBytes(route.toolBytes)} (${route.toolAssetCount} file(s))`,
					route.unknownAssetCount,
				]),
			),
		);
		out.push('### Shared backbone (assets loaded by more than one route)\n');
		out.push(
			table(
				['Asset', 'Routes', 'Raw'],
				routeSummary.shared
					.slice(0, 15)
					.map((entry) => [code(entry.path), entry.routes.length, formatBytes(entry.bytes)]),
			),
		);
	} else {
		out.push(
			'_Not measured. Pass `--base-url=<url>` against a production-equivalent preview server to add the route matrix._\n',
		);
	}

	out.push('## Chunk graph\n');
	out.push(
		table(
			['Chunk', 'Static imports', 'Lazy imports'],
			Object.entries(graph.edges)
				.sort((a, b) => a[0].localeCompare(b[0]))
				.filter(([, edge]) => edge.static.length > 0 || edge.dynamic.length > 0)
				.map(([path, edge]) => [
					code(path),
					edge.static.map(code).join(' '),
					edge.dynamic.map(code).join(' '),
				]),
		),
	);

	if (inventory.duplicates.length > 0) {
		out.push('## Duplicated content\n');
		out.push(
			table(
				['sha256 (short)', 'Raw', 'Files'],
				inventory.duplicates.map((duplicate) => [
					code(duplicate.sha256.slice(0, 12)),
					formatBytes(duplicate.bytes),
					duplicate.paths.map(code).join(' '),
				]),
			),
		);
	}

	return out.join('\n');
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

/**
 * Render the HTML form — the "CI report" surface that gets screenshotted
 * for the PR. It is deliberately self-contained (inline CSS, no scripts,
 * no external fonts) so the screenshot cannot depend on the network.
 */
export function renderHtmlReport(report) {
	const { conditions, inventory, graph, routeSummary, findings } = report;
	const rows = (items) =>
		items
			.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
			.join('\n');

	const conditionRows = [
		['source SHA', conditions.sourceSha],
		['source ref', conditions.sourceRef],
		['measured at', conditions.measuredAt],
		['client output', report.clientDir],
		['node', conditions.node],
		['vite', conditions.vite],
		['os / arch', `${conditions.os} / ${conditions.arch}`],
		['cpu', conditions.cpu],
		['browser', conditions.browser ?? 'not measured (static pass only)'],
		['network', conditions.network],
		['mode', report.mode],
	];

	const routeRows = routeSummary
		? routeSummary.routes.map((route) => [
				route.route,
				route.error ? `FAILED: ${route.error}` : String(route.status ?? 'n/a'),
				String(route.assetCount),
				String(route.documentCount),
				formatBytes(route.bytes),
				formatBytes(route.gzipBytes),
				`${formatBytes(route.toolBytes)} (${route.toolAssetCount})`,
				String(route.unknownAssetCount),
			])
		: [['—', 'not measured', '—', '—', '—', '—', '—', '—']];

	const sharedRows = routeSummary
		? routeSummary.shared
				.slice(0, 12)
				.map((entry) => [entry.path, String(entry.routes.length), formatBytes(entry.bytes)])
		: [];

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Client bundle map — Issue #483</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0; padding: 32px; background: #fbfbf9; color: #14140f; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 8px; text-transform: uppercase; letter-spacing: 0.08em; color: #55554c; }
  p.lead { margin: 0 0 20px; color: #55554c; max-width: 90ch; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #e2e2dc; }
  th, td { border-bottom: 1px solid #ecece4; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #f2f2ee; font-weight: 600; }
  tr:last-child td { border-bottom: 0; }
  .pass { color: #0f6b3f; font-weight: 600; }
  .fail { color: #a11a1a; font-weight: 600; }
  .kpis { display: flex; gap: 12px; margin: 16px 0 0; flex-wrap: wrap; }
  .kpi { border: 1px solid #e2e2dc; background: #fff; padding: 10px 14px; min-width: 190px; }
  .kpi b { display: block; font-size: 20px; }
  .kpi span { color: #55554c; font-size: 12px; }
</style>
</head>
<body>
<h1>Client bundle map</h1>
<p class="lead">Issue #483 — route dependency, duplicated chunks and Tool isolation of the emitted client build. Report only: no <code>validate:*</code> entry point runs this, so it is not a gate.</p>
<div class="kpis">
  <div class="kpi"><b>${escapeHtml(formatBytes(inventory.totals.hostJsBytes))}</b><span>host JS emitted (raw)</span></div>
  <div class="kpi"><b>${escapeHtml(formatBytes(inventory.totals.hostJsGzipBytes))}</b><span>host JS gzip -9 (estimate)</span></div>
  <div class="kpi"><b>${escapeHtml(String(inventory.hostJs.length))}</b><span>host JS chunks</span></div>
  <div class="kpi"><b>${escapeHtml(formatBytes(inventory.totals.toolBytes))}</b><span>Tool artifacts (${escapeHtml(String(inventory.totals.toolFileCount))} files)</span></div>
</div>
<h2>Findings</h2>
<table><tr><th>Status</th><th>Finding</th><th>Detail</th></tr>
${rows(findings.map((item) => [item.status === 'pass' ? 'PASS' : item.status === 'skipped' ? 'SKIPPED' : 'FAIL', item.title, item.detail]))}
</table>
<h2>Route dependency map</h2>
<table><tr><th>Route</th><th>Status</th><th>Assets</th><th>SSR docs</th><th>Total</th><th>gzip -9 (est.)</th><th>Tool artifacts</th><th>Not in output</th></tr>
${rows(routeRows)}
</table>
<h2>Shared backbone (loaded by more than one route)</h2>
<table><tr><th>Asset</th><th>Routes</th><th>Raw</th></tr>
${rows(sharedRows)}
</table>
<h2>Largest host chunks</h2>
<table><tr><th>Chunk</th><th>Raw</th><th>gzip -9 (estimate)</th></tr>
${rows(inventory.hostJs.slice(0, 10).map((chunk) => [chunk.path, formatBytes(chunk.bytes), formatBytes(chunk.gzipBytes)]))}
</table>
<h2>Reproduction conditions</h2>
<table><tr><th>Condition</th><th>Value</th></tr>
${rows(conditionRows)}
</table>
<p class="lead">Reachability seeds (host chunks every measured route loads): ${escapeHtml(graph.entryChunks.join(', ') || 'not resolved')} · graph roots: ${escapeHtml(graph.graphRoots.join(', ') || '—')} · unreachable chunks: ${escapeHtml(String(graph.unreachableChunks.length))} · duplicated content groups: ${escapeHtml(String(inventory.duplicates.length))}</p>
</body>
</html>
`;
}
