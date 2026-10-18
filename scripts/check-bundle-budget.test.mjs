import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	buildReport,
	checkGraphProvenance,
	evaluateBudgets,
	evaluateToolBudgets,
	measureRoutes,
	measureToolBundles,
	parseRouteAncestors,
	parseRouteTree,
	renderHtml,
} from './check-bundle-budget.mjs';

/**
 * `check-bundle-budget.mjs` tests (Issue #482).
 *
 * The acceptance criterion these tests exist for is "a big piece of
 * unnecessary JS trips the budget". A gate that has never been observed
 * failing is indistinguishable from a gate that always passes, so the
 * failure path is pinned here with a fixture that is exactly that: one
 * route that statically drags in a chunk nobody asked for.
 *
 * Everything runs against in-memory graphs and temp directories — no build
 * output is required, so the suite is fast and deterministic.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A minimal but faithful slice of a generated `src/routeTree.gen.ts`. */
const ROUTE_TREE = `
import { Route as rootRouteImport } from './routes/__root'
import { Route as IndexRouteImport } from './routes/index'
import { Route as AboutRouteImport } from './routes/about'
import { Route as AdminRouteImport } from './routes/admin'
import { Route as AdminIndexRouteImport } from './routes/admin.index'
import { Route as ToolsSlugRouteImport } from './routes/tools.$slug'

const IndexRoute = IndexRouteImport.update({
  id: '/',
  path: '/',
} as any)
const AboutRoute = AboutRouteImport.update({
  id: '/about',
  path: '/about',
} as any)
const AdminRoute = AdminRouteImport.update({
  id: '/admin',
  path: '/admin',
} as any)
const AdminIndexRoute = AdminIndexRouteImport.update({
  id: '/',
  path: '/',
  getParentRoute: () => AdminRoute,
} as any)
const ToolsSlugRoute = ToolsSlugRouteImport.update({
  id: '/tools/$slug',
  path: '/tools/$slug',
} as any)
const AdminRouteWithChildren = AdminRoute._addFileChildren(AdminRouteChildren)

export interface FileRoutesByFullPath {
  '/': typeof IndexRoute
  '/about': typeof AboutRoute
  '/tools/$slug': typeof ToolsSlugRoute
  '/admin': typeof AdminRouteWithChildren
  '/admin/': typeof AdminIndexRoute
}
export interface FileRoutesByTo {
  '/': typeof IndexRoute
  '/about': typeof AboutRoute
  '/admin': typeof AdminIndexRoute
}
`;

function chunk(overrides) {
	return {
		name: 'chunk',
		facade_module_id: null,
		facade_query: null,
		is_entry: false,
		is_dynamic_entry: false,
		bytes: 1000,
		gzip_bytes: 400,
		css_bytes: 0,
		imports: [],
		css: [],
		...overrides,
	};
}

/**
 * A representative client graph:
 *   entry (100 KB, imports `shared` 10 KB, imports the app CSS)
 *   shared -> /            (2 KB route chunk)
 *   about  -> shared       (5 KB route chunk)
 *   admin  -> shared       (1 KB route chunk)
 *   tools.$slug (2 KB route chunk, plus a 3 MB chunk nobody asked for)
 */
function graph({ heavyToolsChunk = false } = {}) {
	const chunks = {
		'assets/entry.js': chunk({
			name: 'index',
			facade_module_id: 'src/client.tsx',
			is_entry: true,
			bytes: 100_000,
			imports: ['assets/shared.js'],
			css: ['assets/app.css'],
		}),
		'assets/shared.js': chunk({ name: 'shared', bytes: 10_000 }),
		'assets/index.js': chunk({
			name: 'index',
			facade_module_id: 'src/routes/index.tsx',
			facade_query: 'tsr-split=component',
			is_dynamic_entry: true,
			bytes: 2_000,
			imports: ['assets/shared.js'],
		}),
		'assets/about.js': chunk({
			name: 'about',
			facade_module_id: 'src/routes/about.tsx',
			facade_query: 'tsr-split=component',
			is_dynamic_entry: true,
			bytes: 5_000,
			imports: ['assets/shared.js'],
		}),
		'assets/admin.js': chunk({
			name: 'admin',
			facade_module_id: 'src/routes/admin.tsx',
			facade_query: 'tsr-split=component',
			is_dynamic_entry: true,
			bytes: 1_000,
			imports: ['assets/shared.js'],
		}),
		'assets/admin.index.js': chunk({
			name: 'admin.index',
			facade_module_id: 'src/routes/admin.index.tsx',
			facade_query: 'tsr-split=component',
			is_dynamic_entry: true,
			bytes: 800,
			imports: ['assets/shared.js'],
		}),
		'assets/tools.$slug.js': chunk({
			name: 'tools._slug',
			facade_module_id: 'src/routes/tools.$slug.tsx',
			facade_query: 'tsr-split=component',
			is_dynamic_entry: true,
			bytes: 2_000,
			imports: heavyToolsChunk
				? ['assets/shared.js', 'assets/unnecessary.js']
				: ['assets/shared.js'],
		}),
		'assets/tools.$slug.notFound.js': chunk({
			name: 'tools._slug',
			facade_module_id: 'src/routes/tools.$slug.tsx',
			facade_query: 'tsr-split=notFoundComponent',
			is_dynamic_entry: true,
			bytes: 50_000,
		}),
	};
	if (heavyToolsChunk) {
		chunks['assets/unnecessary.js'] = chunk({ name: 'unnecessary', bytes: 3_000_000 });
	}
	return {
		schema_version: 1,
		generator: 'test',
		out_dir: '/build/assets',
		assets: { 'assets/app.css': { bytes: 30_000, gzip_bytes: 8_000 } },
		chunks,
	};
}

function budgetOf(routes) {
	return {
		schema_version: 1,
		measurement: { mode: 'test' },
		// Copy the route map so a test that deletes or replaces an entry
		// cannot reach through into the shared baseline and poison the
		// tests that run after it.
		routes: structuredClone(routes),
		tool_iframe: {
			max_js_bytes_per_tool: 10_000,
			max_css_bytes_per_tool: 1_000,
			reason: 'Tool bundles are separate builds measured outside the host route budgets.',
		},
	};
}

const GENEROUS = {
	'/': { initial_js_bytes: 200_000, initial_css_bytes: 40_000 },
	'/about': { initial_js_bytes: 200_000, initial_css_bytes: 40_000 },
	'/admin': { initial_js_bytes: 200_000, initial_css_bytes: 40_000 },
	'/admin/': { initial_js_bytes: 200_000, initial_css_bytes: 40_000 },
	'/tools/$slug': { initial_js_bytes: 200_000, initial_css_bytes: 40_000 },
};

describe('parseRouteTree (Issue #482)', () => {
	it('maps every full path to the file that renders it', () => {
		const routes = parseRouteTree(ROUTE_TREE);
		assert.equal(routes.get('/'), 'src/routes/index.tsx');
		assert.equal(routes.get('/about'), 'src/routes/about.tsx');
		assert.equal(routes.get('/tools/$slug'), 'src/routes/tools.$slug.tsx');
	});

	it('resolves the layout ancestors of a nested route, outermost first', () => {
		const ancestors = parseRouteAncestors(ROUTE_TREE);
		// `/admin/` is rendered inside the /admin layout, so the admin layout
		// file is part of its first paint. `/about` has no layout route of its
		// own, so it has no ancestors.
		assert.deepEqual(ancestors.get('/admin/'), ['src/routes/admin.tsx']);
		assert.equal(ancestors.get('/about'), undefined);
	});

	it('keeps the layout route and its index route as separate entries', () => {
		const routes = parseRouteTree(ROUTE_TREE);
		assert.equal(routes.get('/admin'), 'src/routes/admin.tsx');
		assert.equal(routes.get('/admin/'), 'src/routes/admin.index.tsx');
	});

	it('does not use FileRoutesByTo, which collapses /admin and /admin/', () => {
		const routes = parseRouteTree(ROUTE_TREE);
		assert.equal(routes.size, 5);
	});

	it('throws instead of returning an empty map when the tree is not the generated shape', () => {
		assert.throws(() => parseRouteTree('export const nothing = 1'), /FileRoutesByFullPath/);
	});
});

describe('measureRoutes (Issue #482)', () => {
	it('charges the entry closure plus the route chunk, deduplicating shared chunks', () => {
		const measured = measureRoutes(graph(), parseRouteTree(ROUTE_TREE));
		const about = measured.routes.find((r) => r.route === '/about');
		// entry 100000 + shared 10000 + about 5000
		assert.equal(about.initial_js_bytes, 115_000);
		assert.equal(about.route_js_bytes, 5_000);
		assert.equal(about.route_added_js_bytes, 5_000);
		assert.equal(about.initial_css_bytes, 30_000);
	});

	it('charges a shared chunk only once no matter how many routes pull it in', () => {
		const measured = measureRoutes(graph(), parseRouteTree(ROUTE_TREE));
		const home = measured.routes.find((r) => r.route === '/');
		assert.equal(home.initial_js_bytes, 112_000);
	});

	it('picks the component split, not the not-found split, for a split route', () => {
		const measured = measureRoutes(graph(), parseRouteTree(ROUTE_TREE));
		const tools = measured.routes.find((r) => r.route === '/tools/$slug');
		assert.equal(tools.chunk, 'assets/tools.$slug.js');
		assert.equal(tools.initial_js_bytes, 112_000);
	});

	it('picks the component split even when the graph lists the not-found split first', () => {
		// `graph.chunks` order is a bundler implementation detail. If the winner
		// were decided by arrival, this ordering would silently measure the
		// not-found chunk (50,000 B) instead of the rendered one (2,000 B) and
		// the gate would still print PASS.
		const base = graph();
		const chunks = {};
		for (const key of Object.keys(base.chunks)) {
			if (key === 'assets/tools.$slug.js') continue;
			chunks[key] = base.chunks[key];
			if (key === 'assets/shared.js')
				chunks['assets/tools.$slug.notFound.js'] = base.chunks['assets/tools.$slug.notFound.js'];
		}
		chunks['assets/tools.$slug.js'] = base.chunks['assets/tools.$slug.js'];
		const measured = measureRoutes({ ...base, chunks }, parseRouteTree(ROUTE_TREE));
		const tools = measured.routes.find((r) => r.route === '/tools/$slug');
		assert.equal(tools.chunk, 'assets/tools.$slug.js');
		assert.equal(tools.initial_js_bytes, 112_000);
	});

	it('prefers an unsplit facade chunk over a not-found split', () => {
		const base = graph();
		const measured = measureRoutes(
			{
				...base,
				chunks: {
					...base.chunks,
					// Same facade, no split: the whole route module, which is what
					// is fetched to render the page.
					'assets/tools.$slug.js': chunk({
						name: 'tools._slug',
						facade_module_id: 'src/routes/tools.$slug.tsx',
						facade_query: null,
						is_dynamic_entry: true,
						bytes: 3_000,
						imports: ['assets/shared.js'],
					}),
				},
			},
			parseRouteTree(ROUTE_TREE),
		);
		const tools = measured.routes.find((r) => r.route === '/tools/$slug');
		assert.equal(tools.chunk, 'assets/tools.$slug.js');
		assert.equal(tools.initial_js_bytes, 113_000);
	});

	it('charges the layout chunks a nested route renders with it', () => {
		// `admin.index.js` (800 B) does not import `admin.js` (1,000 B), yet
		// `/admin/` is rendered inside the admin layout — so the layout bytes
		// are part of that page's first paint and have to be charged.
		const measured = measureRoutes(
			graph(),
			parseRouteTree(ROUTE_TREE),
			parseRouteAncestors(ROUTE_TREE),
		);
		const adminIndex = measured.routes.find((r) => r.route === '/admin/');
		assert.equal(adminIndex.initial_js_bytes, 111_800);
		assert.equal(adminIndex.layout_js_bytes, 1_000);
		// A route with no layout of its own is unchanged.
		const about = measured.routes.find((r) => r.route === '/about');
		assert.equal(about.initial_js_bytes, 115_000);
		assert.equal(about.layout_js_bytes, 0);
	});

	it('refuses to guess when the graph has no single client entry', () => {
		const broken = graph();
		broken.chunks['assets/other-entry.js'] = chunk({ is_entry: true });
		assert.throws(
			() => measureRoutes(broken, parseRouteTree(ROUTE_TREE)),
			/exactly 1 client entry/,
		);
	});
});

describe('evaluateBudgets — a big piece of unnecessary JS must be detected (Issue #482)', () => {
	it('fails the route that statically pulls in a 3 MB chunk nobody asked for', () => {
		const measured = measureRoutes(graph({ heavyToolsChunk: true }), parseRouteTree(ROUTE_TREE));
		const result = evaluateBudgets({ routes: measured.routes, budget: budgetOf(GENEROUS) });

		const violation = result.violations.find((v) => v.kind === 'budget-exceeded');
		assert.ok(violation, 'expected a budget-exceeded violation');
		assert.equal(violation.route, '/tools/$slug');
		assert.equal(violation.metric, 'initial_js_bytes');
		assert.equal(violation.measured, 3_112_000);
		assert.equal(violation.limit, 200_000);
		assert.equal(violation.overage, 2_912_000);
		// Every other route stays green — the failure is attributed, not global.
		assert.deepEqual(
			result.violations.filter((v) => v.route !== '/tools/$slug'),
			[],
		);
	});

	it('passes the same graph once the unnecessary import is gone', () => {
		const measured = measureRoutes(graph(), parseRouteTree(ROUTE_TREE));
		const result = evaluateBudgets({ routes: measured.routes, budget: budgetOf(GENEROUS) });
		assert.deepEqual(result.violations, []);
		assert.deepEqual(result.exceptions, []);
	});

	it('fails a route added to the tree without a budget entry', () => {
		const measured = measureRoutes(graph(), parseRouteTree(ROUTE_TREE));
		const routes = { ...GENEROUS };
		Reflect.deleteProperty(routes, '/about');
		const result = evaluateBudgets({ routes: measured.routes, budget: budgetOf(routes) });
		assert.equal(result.violations.length, 1);
		assert.equal(result.violations[0].kind, 'unbudgeted-route');
		assert.equal(result.violations[0].route, '/about');
	});

	it('fails rather than silently reporting 0 bytes when a route produced no chunk', () => {
		const stripped = graph();
		Reflect.deleteProperty(stripped.chunks, 'assets/about.js');
		const measured = measureRoutes(stripped, parseRouteTree(ROUTE_TREE));
		const result = evaluateBudgets({ routes: measured.routes, budget: budgetOf(GENEROUS) });
		assert.ok(result.violations.some((v) => v.kind === 'unmeasured-route' && v.route === '/about'));
	});

	it('warns about a budget entry whose route no longer exists', () => {
		const measured = measureRoutes(graph(), parseRouteTree(ROUTE_TREE));
		const budget = budgetOf({
			...GENEROUS,
			'/removed': { initial_js_bytes: 1, initial_css_bytes: 1 },
		});
		const result = evaluateBudgets({ routes: measured.routes, budget });
		assert.ok(result.warnings.some((w) => w.kind === 'stale-budget' && w.route === '/removed'));
		assert.deepEqual(result.violations, []);
	});
});

describe('budget exceptions must be reasoned (Issue #482)', () => {
	const exceeded = () =>
		measureRoutes(graph({ heavyToolsChunk: true }), parseRouteTree(ROUTE_TREE));

	it('reports an acknowledged, reasoned overage as an exception instead of a failure', () => {
		const budget = budgetOf({
			...GENEROUS,
			'/tools/$slug': {
				initial_js_bytes: 200_000,
				initial_css_bytes: 40_000,
				exception: {
					metric: 'initial_js_bytes',
					reason:
						'The embedded markdown renderer is loaded eagerly on purpose until the lazy split lands in Issue #501.',
				},
			},
		});
		const result = evaluateBudgets({ routes: exceeded().routes, budget });
		assert.deepEqual(result.violations, []);
		assert.equal(result.exceptions.length, 1);
		assert.equal(result.exceptions[0].route, '/tools/$slug');
	});

	it('does not let an exception for one metric excuse another metric', () => {
		const budget = budgetOf({
			...GENEROUS,
			'/tools/$slug': {
				initial_js_bytes: 200_000,
				initial_css_bytes: 40_000,
				exception: {
					metric: 'initial_css_bytes',
					reason: 'A reasoned exception that is about CSS, not about JS bytes at all.',
				},
			},
		});
		const result = evaluateBudgets({ routes: exceeded().routes, budget });
		assert.ok(result.violations.some((v) => v.metric === 'initial_js_bytes'));
	});

	it('flags an exception that is no longer needed, so it cannot rot into a free pass', () => {
		const budget = budgetOf({
			...GENEROUS,
			'/tools/$slug': {
				initial_js_bytes: 4_000_000,
				initial_css_bytes: 40_000,
				exception: {
					metric: 'initial_js_bytes',
					reason: 'A reasoned exception that no longer applies to the current measurement.',
				},
			},
		});
		const measured = measureRoutes(graph(), parseRouteTree(ROUTE_TREE));
		const result = evaluateBudgets({ routes: measured.routes, budget });
		assert.deepEqual(result.violations, []);
		assert.ok(
			result.warnings.some((w) => w.kind === 'stale-exception' && w.route === '/tools/$slug'),
		);
	});
});

describe('Tool iframe bundles are aggregated separately (Issue #482)', () => {
	function toolDir(files) {
		const dir = mkdtempSync(join(tmpdir(), 'bundle-budget-tools-'));
		for (const [rel, size] of Object.entries(files)) {
			const path = join(dir, rel);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, 'x'.repeat(size));
		}
		return dir;
	}

	it('sums each Tool build independently and ignores non-JS/CSS assets', () => {
		const dir = toolDir({
			'prototype/app/index.html': 40,
			'prototype/app/assets/app.js': 5_000,
			'prototype/app/assets/app.css': 800,
			'prototype/app/assets/sound.wav': 900_000,
			'readmark/app/index.html': 40,
			'readmark/app/assets/app.js': 1_000,
		});
		try {
			const bundles = measureToolBundles(dir);
			assert.equal(bundles.length, 2);
			assert.deepEqual(bundles[0], {
				slug: 'prototype',
				js_bytes: 5_000,
				css_bytes: 800,
				js_files: 1,
				css_files: 1,
			});
			assert.equal(bundles[1].js_bytes, 1_000);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('returns no bundles when no Tool was built, rather than failing', () => {
		assert.deepEqual(measureToolBundles(join(tmpdir(), 'bundle-budget-absent-xyz')), []);
	});

	it('fails a Tool that outgrows its own cap without touching host route budgets', () => {
		const bundles = [
			{ slug: 'prototype', js_bytes: 50_000, css_bytes: 100, js_files: 1, css_files: 1 },
			{ slug: 'readmark', js_bytes: 1_000, css_bytes: 100, js_files: 1, css_files: 1 },
		];
		const violations = evaluateToolBudgets(bundles, budgetOf(GENEROUS));
		assert.equal(violations.length, 1);
		assert.equal(violations[0].route, 'tool:prototype');
		assert.match(violations[0].message, /separate Tool budget/);
	});
});

describe('renderHtml (Issue #482)', () => {
	function reportFor(heavy, routeBudgets = GENEROUS) {
		const measured = measureRoutes(graph({ heavyToolsChunk: heavy }), parseRouteTree(ROUTE_TREE));
		const budget = budgetOf(routeBudgets);
		const result = evaluateBudgets({ routes: measured.routes, budget });
		return {
			schema_version: 1,
			source_sha: 'a'.repeat(40),
			measurement: { mode: 'static bundle graph', browser: 'not applicable' },
			budget: { routes: budget.routes, tool_iframe: budget.tool_iframe },
			entry: measured.entry,
			shell_js_bytes: measured.shellTotals.bytes,
			shell_css_bytes: measured.shellTotals.cssBytes,
			routes: measured.routes,
			tool_iframe: [
				{ slug: 'prototype', js_bytes: 5_000, css_bytes: 800, js_files: 1, css_files: 1 },
			],
			violations: result.violations,
			exceptions: result.exceptions,
			warnings: result.warnings,
		};
	}

	it('renders a self-contained PASS page with the measurement conditions', () => {
		const html = renderHtml(reportFor(false));
		assert.match(html, /<!doctype html>/);
		assert.match(html, /PASS — every route and Tool bundle within budget/);
		assert.match(html, /measured_sha/);
		assert.match(html, /[a]{40}/);
		assert.match(html, /not applicable/);
		// Self-contained: no script tag, no remote asset — the artefact has to
		// render from disk without a server.
		assert.doesNotMatch(html, /<script/i);
		assert.doesNotMatch(html, /<link /i);
	});

	it('renders the failing route and its message when a cap is exceeded', () => {
		const html = renderHtml(reportFor(true));
		assert.match(html, /FAIL — 1 violation\(s\)/);
		assert.match(html, /\/tools\/\$slug initial_js_bytes=3112000/);
	});

	it('renders an acknowledged exception with its measurement, cap and reason', () => {
		// An exception keeps `violations` empty so the run passes, but the
		// bundle IS above its cap. A report that only rendered `violations`
		// would say "No route or Tool bundle exceeds its cap" and hide the
		// reason a reviewer has to approve.
		const reason =
			'The embedded markdown renderer is loaded eagerly on purpose until the lazy split lands in Issue #501.';
		const html = renderHtml(
			reportFor(true, {
				...GENEROUS,
				'/tools/$slug': {
					initial_js_bytes: 200_000,
					initial_css_bytes: 40_000,
					exception: { metric: 'initial_js_bytes', reason },
				},
			}),
		);
		assert.match(html, /Acknowledged exceptions/);
		assert.match(html, /\/tools\/\$slug/);
		assert.match(html, /3,112,000/);
		assert.match(html, /200,000/);
		assert.match(html, /\+2,912,000/);
		assert.match(html, /Issue #501/);
		// The run still passes (`violations` is empty), but the banner must not
		// claim every bundle is within budget while the table above lists one
		// that is 2.78 MiB over its cap.
		assert.match(html, /PASS — 1 acknowledged exception\(s\) above cap/);
		assert.doesNotMatch(html, /PASS — every route and Tool bundle within budget/);
		assert.doesNotMatch(html, /No route or Tool bundle exceeds its cap/);
		assert.match(html, /No unbudgeted overage/);
	});

	it('keeps the clean-PASS wording when there is no exception', () => {
		const html = renderHtml(reportFor(false));
		assert.match(html, /PASS — every route and Tool bundle within budget/);
		assert.match(html, /No route or Tool bundle exceeds its cap/);
		assert.doesNotMatch(html, /acknowledged exception/);
	});

	it('escapes an exception reason instead of trusting it', () => {
		const html = renderHtml(
			reportFor(true, {
				...GENEROUS,
				'/tools/$slug': {
					initial_js_bytes: 200_000,
					initial_css_bytes: 40_000,
					exception: {
						metric: 'initial_js_bytes',
						reason: '<img src=x onerror=alert(3)> a reason that is twenty characters long',
					},
				},
			}),
		);
		assert.doesNotMatch(html, /<img src=x/);
		assert.match(html, /&lt;img src=x/);
	});

	it('escapes interpolated values instead of trusting them', () => {
		const report = reportFor(false);
		report.routes[0].route = '/<script>alert(1)</script>';
		report.violations = [{ route: 'x', message: '<img src=x onerror=alert(2)>' }];
		const html = renderHtml(report);
		assert.doesNotMatch(html, /<script>alert/);
		assert.doesNotMatch(html, /<img src=x/);
		assert.match(html, /&lt;script&gt;/);
		assert.match(html, /&lt;img src=x/);
	});
});

describe('CLI (Issue #482)', () => {
	function fixture({ budget, tools = {} } = {}) {
		const dir = mkdtempSync(join(tmpdir(), 'bundle-budget-cli-'));
		writeFileSync(join(dir, 'bundle-graph.json'), JSON.stringify(graph({ heavyToolsChunk: true })));
		writeFileSync(join(dir, 'routeTree.gen.ts'), ROUTE_TREE);
		writeFileSync(join(dir, 'budget.json'), JSON.stringify(budget));
		const toolsDir = join(dir, 'tools');
		for (const [rel, size] of Object.entries(tools)) {
			const path = join(toolsDir, rel);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, 'x'.repeat(size));
		}
		return dir;
	}

	function run(dir, extraArgs = []) {
		// `spawnSync` rather than `execFileSync`: an acknowledged exception
		// exits 0 and the warning that names it goes to stderr, so a helper
		// that throws away stderr on success cannot assert on it.
		const result = spawnSync(
			process.execPath,
			[
				join(REPO_ROOT, 'scripts', 'check-bundle-budget.mjs'),
				`--graph=${join(dir, 'bundle-graph.json')}`,
				`--budget=${join(dir, 'budget.json')}`,
				`--route-tree=${join(dir, 'routeTree.gen.ts')}`,
				`--tools=${join(dir, 'tools')}`,
				...extraArgs,
			],
			{ encoding: 'utf8' },
		);
		return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
	}

	it('exits 1 and names the offending route when the budget is exceeded', () => {
		const dir = fixture({ budget: budgetOf(GENEROUS) });
		try {
			const result = run(dir);
			assert.equal(result.code, 1);
			assert.match(
				result.stderr,
				/\/tools\/\$slug initial_js_bytes=3112000 \(2\.97 MiB\) exceeds the budget 200000/,
			);
			assert.match(result.stdout, /condition mode: test/);
			assert.match(result.stdout, /source sha : [0-9a-f]{40}/);
			assert.match(result.stdout, /\/tools\/\$slug/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('exits 0 when every route is within budget', () => {
		const clean = graph();
		const dir = mkdtempSync(join(tmpdir(), 'bundle-budget-cli-ok-'));
		try {
			writeFileSync(join(dir, 'bundle-graph.json'), JSON.stringify(clean));
			writeFileSync(join(dir, 'routeTree.gen.ts'), ROUTE_TREE);
			writeFileSync(join(dir, 'budget.json'), JSON.stringify(budgetOf(GENEROUS)));
			const result = run(dir);
			assert.equal(result.code, 0, result.stderr);
			assert.match(result.stdout, /PASS/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('exits 0 but never claims "within budget" when an exception covers the overage', () => {
		const dir = fixture({
			budget: budgetOf({
				...GENEROUS,
				'/tools/$slug': {
					initial_js_bytes: 200_000,
					initial_css_bytes: 40_000,
					exception: {
						metric: 'initial_js_bytes',
						reason: 'The markdown renderer is loaded eagerly until Issue #501 splits it out.',
					},
				},
			}),
		});
		try {
			const result = run(dir);
			assert.equal(result.code, 0, result.stderr);
			assert.match(result.stdout, /PASS — 1 acknowledged exception\(s\) above cap/);
			assert.doesNotMatch(result.stdout, /every route and Tool bundle within budget/);
			assert.match(result.stderr, /ACKNOWLEDGED EXCEPTION \/tools\/\$slug/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('exits 2, not 1, when the build output is missing — a missing measurement is not a pass', () => {
		const dir = mkdtempSync(join(tmpdir(), 'bundle-budget-cli-missing-'));
		try {
			writeFileSync(join(dir, 'budget.json'), JSON.stringify(budgetOf(GENEROUS)));
			const result = run(dir);
			assert.equal(result.code, 2);
			assert.match(result.stderr, /missing client bundle graph/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('exits 2 when an exception carries no usable reason', () => {
		const dir = fixture({
			budget: budgetOf({
				...GENEROUS,
				'/tools/$slug': {
					initial_js_bytes: 4_000_000,
					initial_css_bytes: 40_000,
					exception: { metric: 'initial_js_bytes', reason: 'because' },
				},
			}),
		});
		try {
			const result = run(dir);
			assert.equal(result.code, 2);
			assert.match(result.stderr, /exception\.reason: required/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('exits 2 when the budget names a route the generated tree does not have', () => {
		const dir = fixture({
			budget: budgetOf({ ...GENEROUS, '/ghost': { initial_js_bytes: 1, initial_css_bytes: 1 } }),
		});
		try {
			const result = run(dir);
			assert.equal(result.code, 2);
			assert.match(result.stderr, /routes\["\/ghost"\]: not a route in src\/routeTree\.gen\.ts/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('exits 2 when the Tool cap has no reason', () => {
		const dir = fixture({
			budget: {
				...budgetOf(GENEROUS),
				tool_iframe: { max_js_bytes_per_tool: 1, max_css_bytes_per_tool: 1 },
			},
		});
		try {
			const result = run(dir);
			assert.equal(result.code, 2);
			assert.match(result.stderr, /tool_iframe\.reason: required/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('exits 2 when the Tool cap section is deleted, instead of measuring nothing', () => {
		const budget = budgetOf(GENEROUS);
		Reflect.deleteProperty(budget, 'tool_iframe');
		const dir = fixture({ budget });
		try {
			const result = run(dir);
			assert.equal(result.code, 2);
			assert.match(result.stderr, /tool_iframe: required/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('creates the parent directory of --report and --html before writing', () => {
		// `.tmp/` is gitignored, so a fresh checkout has no such directory and
		// the documented `--report=.tmp/bundle-budget.json` would abort with
		// ENOENT instead of producing the artefact.
		const clean = graph();
		const dir = mkdtempSync(join(tmpdir(), 'bundle-budget-cli-nested-'));
		try {
			writeFileSync(join(dir, 'bundle-graph.json'), JSON.stringify(clean));
			writeFileSync(join(dir, 'routeTree.gen.ts'), ROUTE_TREE);
			writeFileSync(join(dir, 'budget.json'), JSON.stringify(budgetOf(GENEROUS)));
			const reportTarget = join(dir, 'artefacts', 'nested', 'bundle-budget.json');
			const htmlTarget = join(dir, 'artefacts', 'nested', 'bundle-budget.html');
			const result = run(dir, [`--report=${reportTarget}`, `--html=${htmlTarget}`]);
			assert.equal(result.code, 0, result.stderr);
			assert.equal(existsSync(reportTarget), true);
			assert.equal(existsSync(htmlTarget), true);
			assert.equal(JSON.parse(readFileSync(reportTarget, 'utf8')).schema_version, 1);
			assert.match(readFileSync(htmlTarget, 'utf8'), /<!doctype html>/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('writes one parseable JSON document to stdout under --json', () => {
		const clean = graph();
		const dir = mkdtempSync(join(tmpdir(), 'bundle-budget-cli-json-'));
		try {
			writeFileSync(join(dir, 'bundle-graph.json'), JSON.stringify(clean));
			writeFileSync(join(dir, 'routeTree.gen.ts'), ROUTE_TREE);
			writeFileSync(join(dir, 'budget.json'), JSON.stringify(budgetOf(GENEROUS)));
			const result = run(dir, ['--json']);
			assert.equal(result.code, 0);
			// `node scripts/check-bundle-budget.mjs --json | jq` has to work, so
			// the human status lines must not be mixed into stdout.
			const parsed = JSON.parse(result.stdout);
			assert.equal(parsed.schema_version, 1);
			assert.equal(parsed.routes.length, 5);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('the gate cannot be measured around (Issue #482)', () => {
	function reportFor({ toolsDir, graphInput = graph() }) {
		return buildReport({
			graph: graphInput,
			routesByPath: parseRouteTree(ROUTE_TREE),
			ancestorsByPath: parseRouteAncestors(ROUTE_TREE),
			toolsDir,
			budget: budgetOf(GENEROUS),
			sourceSha: 'c'.repeat(40),
		});
	}

	it('names a missing Tool build output instead of reporting zero Tool bytes', () => {
		const report = reportFor({ toolsDir: join(tmpdir(), 'bundle-budget-tools-gone-xyz') });
		assert.deepEqual(report.tool_iframe, []);
		assert.ok(report.warnings.some((w) => w.kind === 'tool-bundles-absent'));
		assert.deepEqual(report.violations, []);
	});

	it('reports a graph whose recorded client assets are gone', () => {
		const warnings = checkGraphProvenance(graph());
		assert.equal(warnings.length, 1);
		assert.equal(warnings[0].kind, 'stale-graph');
	});

	it('says nothing about provenance when the recorded assets are all present', () => {
		const base = graph();
		const dir = mkdtempSync(join(tmpdir(), 'bundle-budget-graph-'));
		try {
			for (const file of Object.keys(base.chunks)) {
				const path = join(dir, file);
				mkdirSync(dirname(path), { recursive: true });
				writeFileSync(path, 'x');
			}
			assert.deepEqual(checkGraphProvenance({ ...base, out_dir: dir }), []);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
