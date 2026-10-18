import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	checkRouteQualityCoverage,
	deriveRoutesFromFiles,
	evaluateCoverage,
	isDynamicId,
	isSampleUnderRoute,
	mentionsProbe,
	parseRouteTreeIds,
	publishedPathForId,
	renderReport,
} from './check-route-quality-coverage.mjs';

/**
 * Fixture coverage for the route × quality-gate ledger (Issue #492).
 *
 * The gate is only worth running if it fails when it should. The
 * acceptance criterion that matters most is "adding a route requires a
 * target or a justified exclusion in the PR", so the first fixture
 * plants exactly that drift and asserts the gate names the file. The
 * rest pin the individual rules (evidence must mention the route, an
 * exclusion must be a reason, a planned family cannot claim coverage)
 * and the last case runs the gate against the real repository so a
 * regression in the scanner cannot turn it into a silent no-op.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE_SCRIPT = join(REPO_ROOT, 'scripts/check-route-quality-coverage.mjs');

const FAMILIES = [
	{
		id: 'e2e',
		state: 'implemented',
		evidence_kind: 'spec',
		contract: 'A Playwright spec opens the surface against a running Worker.',
	},
	{
		id: 'a11y',
		state: 'planned',
		evidence_kind: 'spec_or_doc',
		contract: 'An automated axe-core scan runs over the rendered surface.',
	},
];

const ABOUT_ROUTE = {
	source: 'src/routes/about.tsx',
	id: '/about',
	path: '/about',
	dynamic: false,
};

const HOME_ROUTE = {
	source: 'src/routes/index.tsx',
	id: '/',
	path: '/',
	dynamic: false,
};

const SLUG_ROUTE = {
	source: 'src/routes/portfolio/$slug.tsx',
	id: '/portfolio/$slug',
	path: '/portfolio/$slug',
	dynamic: true,
};

function entryFor(route, overrides = {}) {
	return {
		source: route.source,
		path: route.path,
		audience: 'public',
		addressable: true,
		...(route.dynamic ? { sample_path: '/portfolio/my-web-2026' } : {}),
		gates: {
			e2e: { status: 'covered', evidence: ['e2e/about.spec.ts'] },
			a11y: {
				status: 'excluded',
				reason: 'No axe-core scan exists yet, so no surface can be covered by it.',
			},
		},
		...overrides,
	};
}

function manifestWith(entries, families = FAMILIES) {
	return { version: 1, gate_families: families, routes: entries };
}

const EVIDENCE = {
	'e2e/about.spec.ts': "await page.goto('/about');\n",
	'e2e/home.spec.ts': "await page.goto('/');\n",
	'e2e/portfolio.spec.ts': "await page.goto('/portfolio/my-web-2026');\n",
};

describe('route id → published path', () => {
	it('keeps a flat route id as-is', () => {
		assert.equal(publishedPathForId('/about'), '/about');
		assert.equal(publishedPathForId('/'), '/');
	});

	it('drops the index marker of a route id', () => {
		assert.equal(publishedPathForId('/portfolio/'), '/portfolio');
		assert.equal(publishedPathForId('/admin/'), '/admin');
	});

	it('drops the non-nesting marker of a segment', () => {
		assert.equal(publishedPathForId('/admin/invitations_/accept'), '/admin/invitations/accept');
	});
});

describe('dynamic route detection', () => {
	it('is true only when a segment is a $param', () => {
		assert.equal(isDynamicId('/portfolio/$slug'), true);
		assert.equal(isDynamicId('/tools/$slug/app'), true);
		assert.equal(isDynamicId('/portfolio/'), false);
	});

	it('accepts exactly one concrete segment per param', () => {
		assert.equal(isSampleUnderRoute('/portfolio/$slug', '/portfolio/my-web-2026'), true);
		assert.equal(isSampleUnderRoute('/portfolio/$slug', '/portfolio/a/b'), false);
		assert.equal(isSampleUnderRoute('/portfolio/$slug', '/portfolio'), false);
		assert.equal(
			isSampleUnderRoute('/admin/invitations_/accept', '/admin/invitations/accept'),
			true,
		);
	});
});

describe('generated route tree reader', () => {
	it('reads the ids out of the FileRoutesByPath block only', () => {
		const text = [
			"type FileRouteTypes = { id: | '/about' | '/admin' }",
			'interface FileRoutesByPath {',
			"    '/about': {",
			"      id: '/about'",
			'    }',
			"    '/admin/invitations_/accept': {",
			'    }',
			'}',
			'interface RootRouteChildren { about: string }',
		].join('\n');
		assert.deepEqual(parseRouteTreeIds(text), ['/about', '/admin/invitations_/accept']);
	});

	it('returns nothing when the generated file has no block (never fails closed on absence)', () => {
		assert.deepEqual(parseRouteTreeIds('// generated\n'), []);
	});
});

describe('coverage evaluation — a route without a decision', () => {
	it('fails when a published route has no manifest entry', () => {
		const result = evaluateCoverage({
			manifest: manifestWith([entryFor(ABOUT_ROUTE)]),
			routes: [ABOUT_ROUTE, HOME_ROUTE],
			routeTreeIds: ['/about', '/'],
			evidence: EVIDENCE,
		});
		assert.equal(result.errors.length, 1);
		assert.match(
			result.errors[0],
			/src\/routes\/index\.tsx \(\/\) is published but has no manifest entry/,
		);
		assert.match(result.errors[0], /add the gate target, or exclude it with a reason/);
	});

	it('fails when the manifest claims a route that does not exist', () => {
		const result = evaluateCoverage({
			manifest: manifestWith([
				entryFor(ABOUT_ROUTE),
				entryFor({ source: 'src/routes/nowhere.tsx', id: '/nowhere', path: '/nowhere' }),
			]),
			routes: [ABOUT_ROUTE],
			routeTreeIds: ['/about'],
			evidence: EVIDENCE,
		});
		assert.ok(result.errors.some((error) => error.includes('is not a published route')));
	});

	it('fails when a route is renamed but the manifest keeps the old path', () => {
		const result = evaluateCoverage({
			manifest: manifestWith([entryFor(ABOUT_ROUTE, { path: '/about-us' })]),
			routes: [ABOUT_ROUTE],
			routeTreeIds: ['/about'],
			evidence: EVIDENCE,
		});
		assert.ok(
			result.errors.some(
				(error) =>
					error.includes('manifest says "/about-us"') && error.includes('publishes "/about"'),
			),
		);
	});
});

describe('coverage evaluation — the cell itself', () => {
	it('fails when a (route, family) pair is neither covered nor excluded', () => {
		const broken = entryFor(ABOUT_ROUTE, {
			gates: {
				e2e: { status: 'covered', evidence: ['e2e/about.spec.ts'] },
			},
		});
		const result = evaluateCoverage({
			manifest: manifestWith([broken]),
			routes: [ABOUT_ROUTE],
			routeTreeIds: ['/about'],
			evidence: EVIDENCE,
		});
		assert.ok(result.errors.some((error) => error.includes('gates.a11y: unresolved')));
	});

	it('fails when covered evidence never mentions the route', () => {
		const result = evaluateCoverage({
			manifest: manifestWith([
				entryFor(ABOUT_ROUTE, {
					gates: {
						e2e: { status: 'covered', evidence: ['e2e/home.spec.ts'] },
						a11y: { status: 'excluded', reason: 'No axe-core scan exists yet for any surface.' },
					},
				}),
			]),
			routes: [ABOUT_ROUTE],
			routeTreeIds: ['/about'],
			evidence: EVIDENCE,
		});
		assert.ok(
			result.errors.some(
				(error) => error.includes('e2e/home.spec.ts') && error.includes('never mentions "/about"'),
			),
		);
	});

	it('does not accept a nested route path as evidence for its parent route', () => {
		const toolsRoute = {
			source: 'src/routes/tools.index.tsx',
			id: '/tools/',
			path: '/tools',
			dynamic: false,
		};
		const result = evaluateCoverage({
			manifest: manifestWith([
				entryFor(toolsRoute, {
					gates: {
						e2e: { status: 'covered', evidence: ['e2e/prototype.spec.ts'] },
					},
				}),
			]),
			routes: [toolsRoute],
			routeTreeIds: ['/tools/'],
			// `/tools` is a substring of the nested path, so a bare
			// `content.includes()` would have called this coverage.
			evidence: { 'e2e/prototype.spec.ts': "await page.goto('/tools/prototype');\n" },
		});
		assert.ok(
			result.errors.some(
				(error) =>
					error.includes('e2e/prototype.spec.ts') && error.includes('never mentions "/tools"'),
			),
		);
	});

	it('fails when covered evidence points at a file that does not exist', () => {
		const result = evaluateCoverage({
			manifest: manifestWith([
				entryFor(ABOUT_ROUTE, {
					gates: {
						e2e: { status: 'covered', evidence: ['e2e/ghost.spec.ts'] },
						a11y: { status: 'excluded', reason: 'No axe-core scan exists yet for any surface.' },
					},
				}),
			]),
			routes: [ABOUT_ROUTE],
			routeTreeIds: ['/about'],
			evidence: {},
		});
		assert.ok(
			result.errors.some(
				(error) => error.includes('e2e/ghost.spec.ts') && error.includes('does not exist'),
			),
		);
	});

	it('fails when evidence does not match the family evidence_kind', () => {
		const result = evaluateCoverage({
			manifest: manifestWith([
				entryFor(ABOUT_ROUTE, {
					gates: {
						e2e: { status: 'covered', evidence: ['docs/notes.md'] },
						a11y: { status: 'excluded', reason: 'No axe-core scan exists yet for any surface.' },
					},
				}),
			]),
			routes: [ABOUT_ROUTE],
			routeTreeIds: ['/about'],
			evidence: { 'docs/notes.md': '# /about\n' },
		});
		assert.ok(result.errors.some((error) => error.includes('does not match the family')));
	});

	it('fails when an exclusion is a placeholder instead of a reason', () => {
		const result = evaluateCoverage({
			manifest: manifestWith([
				entryFor(ABOUT_ROUTE, {
					gates: {
						e2e: { status: 'covered', evidence: ['e2e/about.spec.ts'] },
						a11y: { status: 'excluded', reason: 'TBD' },
					},
				}),
			]),
			routes: [ABOUT_ROUTE],
			routeTreeIds: ['/about'],
			evidence: EVIDENCE,
		});
		assert.ok(result.errors.some((error) => error.includes('must say why')));
	});

	it('fails when a planned family claims coverage', () => {
		const result = evaluateCoverage({
			manifest: manifestWith([
				entryFor(ABOUT_ROUTE, {
					gates: {
						e2e: { status: 'covered', evidence: ['e2e/about.spec.ts'] },
						a11y: { status: 'covered', evidence: ['e2e/about.spec.ts'] },
					},
				}),
			]),
			routes: [ABOUT_ROUTE],
			routeTreeIds: ['/about'],
			evidence: EVIDENCE,
		});
		assert.ok(result.errors.some((error) => error.includes('family state is "planned"')));
	});

	it('fails when an implemented family is excluded everywhere (dead configuration)', () => {
		const result = evaluateCoverage({
			manifest: manifestWith([
				entryFor(ABOUT_ROUTE, {
					gates: {
						e2e: {
							status: 'excluded',
							reason: 'No spec reaches this surface from an automated run.',
						},
						a11y: { status: 'excluded', reason: 'No axe-core scan exists yet.' },
					},
				}),
			]),
			routes: [ABOUT_ROUTE],
			routeTreeIds: ['/about'],
			evidence: EVIDENCE,
		});
		assert.ok(result.errors.some((error) => error.includes('dead configuration')));
	});

	it('fails when a public addressable route has no covered family', () => {
		const plannedOnly = [
			{
				id: 'a11y',
				state: 'planned',
				evidence_kind: 'spec_or_doc',
				contract: 'An automated axe-core scan runs over the rendered surface.',
			},
			{
				id: 'performance',
				state: 'planned',
				evidence_kind: 'spec_or_doc',
				contract: 'A Lighthouse measurement of the surface exists at a threshold.',
			},
		];
		const result = evaluateCoverage({
			manifest: manifestWith(
				[
					entryFor(ABOUT_ROUTE, {
						gates: {
							a11y: { status: 'excluded', reason: 'No axe-core scan exists yet for any surface.' },
							performance: {
								status: 'excluded',
								reason: 'Lighthouse is not implemented at this release.',
							},
						},
					}),
				],
				plannedOnly,
			),
			routes: [ABOUT_ROUTE],
			routeTreeIds: ['/about'],
			evidence: EVIDENCE,
		});
		assert.deepEqual(result.errors, [
			'routes[src/routes/about.tsx]: a public addressable route needs at least one covered gate family (currently 0)',
		]);
	});

	it('accepts a non-addressable layout route that excludes every family with a reason', () => {
		const plannedOnly = [
			{
				id: 'a11y',
				state: 'planned',
				evidence_kind: 'spec_or_doc',
				contract: 'An automated axe-core scan runs over the rendered surface.',
			},
			{
				id: 'performance',
				state: 'planned',
				evidence_kind: 'spec_or_doc',
				contract: 'A Lighthouse measurement of the surface exists at a threshold.',
			},
		];
		const result = evaluateCoverage({
			manifest: manifestWith(
				[
					entryFor(ABOUT_ROUTE, {
						addressable: false,
						addressable_reason: 'A layout route that renders only an Outlet, with no surface.',
						gates: {
							a11y: {
								status: 'excluded',
								reason: 'A layout route renders no surface of its own to scan.',
							},
							performance: {
								status: 'excluded',
								reason: 'A layout route is not a measurable document.',
							},
						},
					}),
				],
				plannedOnly,
			),
			routes: [ABOUT_ROUTE],
			routeTreeIds: ['/about'],
			evidence: EVIDENCE,
		});
		assert.deepEqual(result.errors, []);
	});

	it('accepts a dynamic route measured at a concrete sample named in its evidence', () => {
		const entry = entryFor(SLUG_ROUTE, {
			gates: {
				e2e: { status: 'covered', evidence: ['e2e/portfolio.spec.ts'] },
				a11y: { status: 'excluded', reason: 'No axe-core scan exists yet for any surface.' },
			},
		});
		const result = evaluateCoverage({
			manifest: manifestWith([entry]),
			routes: [SLUG_ROUTE],
			routeTreeIds: ['/portfolio/$slug'],
			evidence: EVIDENCE,
		});
		assert.deepEqual(result.errors, []);
	});

	it('fails when a dynamic route does not name the sample it was measured at', () => {
		const entry = entryFor(SLUG_ROUTE, { sample_path: undefined });
		const result = evaluateCoverage({
			manifest: manifestWith([entry]),
			routes: [SLUG_ROUTE],
			routeTreeIds: ['/portfolio/$slug'],
			evidence: EVIDENCE,
		});
		assert.ok(result.errors.some((error) => error.includes('must name the concrete path')));
	});
});

describe('coverage evaluation — generated tree drift', () => {
	it('fails when the generated route tree is stale', () => {
		const result = evaluateCoverage({
			manifest: manifestWith([
				entryFor(ABOUT_ROUTE),
				entryFor(HOME_ROUTE, {
					gates: {
						e2e: { status: 'covered', evidence: ['e2e/home.spec.ts'] },
						a11y: { status: 'excluded', reason: 'No axe-core scan exists yet for any surface.' },
					},
				}),
			]),
			routes: [ABOUT_ROUTE, HOME_ROUTE],
			routeTreeIds: ['/about'],
			evidence: EVIDENCE,
		});
		assert.deepEqual(result.errors, [
			'src/routeTree.gen.ts: route id "/" exists in src/routes/ but not in the generated tree — regenerate it (the generated file is stale)',
		]);
	});

	it('fails when the generated tree lists a route with no route file', () => {
		const result = evaluateCoverage({
			manifest: manifestWith([entryFor(ABOUT_ROUTE)]),
			routes: [ABOUT_ROUTE],
			routeTreeIds: ['/about', '/ghost'],
			evidence: EVIDENCE,
		});
		assert.ok(result.errors.some((error) => error.includes('has no route file')));
	});
});

describe('coverage evaluation — manifest shape', () => {
	it('fails when the manifest version is not 1', () => {
		const result = evaluateCoverage({
			manifest: { version: 2, gate_families: FAMILIES, routes: [] },
			routes: [],
			evidence: {},
		});
		assert.ok(result.errors.some((error) => error.includes('`version` must be 1')));
	});

	it('fails when two entries claim the same route file', () => {
		const result = evaluateCoverage({
			manifest: manifestWith([entryFor(ABOUT_ROUTE), entryFor(ABOUT_ROUTE)]),
			routes: [ABOUT_ROUTE],
			routeTreeIds: ['/about'],
			evidence: EVIDENCE,
		});
		assert.ok(result.errors.some((error) => error.includes('duplicate source')));
	});
});

/** Stage a synthetic repository and run the gate over it. */
function stageRepo(files) {
	const root = mkdtempSync(join(tmpdir(), 'check-route-quality-coverage-'));
	for (const [relativePath, contents] of Object.entries(files)) {
		const full = join(root, relativePath);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, contents);
	}
	return root;
}

const ROUTE_FILE = "export const Route = createFileRoute('/about')({});\n";

describe('route discovery from a staged repository', () => {
	it('reads routes from route files and ignores co-located components', () => {
		const root = stageRepo({
			'src/routes/about.tsx': ROUTE_FILE,
			'src/routes/portfolio.$slug.tsx':
				"export const Route = createFileRoute('/tools/$slug')({});\n",
			'src/routes/__root.tsx': 'export const Route = createRootRoute({});\n',
			'src/routes/design-system/DesignSystemPage.tsx': 'export function Page() {}\n',
		});
		try {
			assert.deepEqual(deriveRoutesFromFiles({ root }), [
				{
					source: 'src/routes/about.tsx',
					id: '/about',
					path: '/about',
					dynamic: false,
				},
				{
					source: 'src/routes/portfolio.$slug.tsx',
					id: '/tools/$slug',
					path: '/tools/$slug',
					dynamic: true,
				},
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('fails end to end when a staged repo publishes a route the manifest omits', () => {
		const root = stageRepo({
			'src/routes/about.tsx': ROUTE_FILE,
			'src/routes/notes.tsx': "export const Route = createFileRoute('/notes')({});\n",
			'e2e/about.spec.ts': "await page.goto('/about');\n",
			'quality/route-coverage.json': JSON.stringify(
				manifestWith([entryFor({ source: 'src/routes/about.tsx', id: '/about', path: '/about' })]),
			),
		});
		try {
			const result = checkRouteQualityCoverage({ root });
			assert.equal(result.errors.length, 1);
			assert.match(result.errors[0], /src\/routes\/notes\.tsx \(\/notes\) is published but has no/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('the real repository', () => {
	it('has a manifest that resolves every published route against every gate family', () => {
		const result = checkRouteQualityCoverage({ root: REPO_ROOT });
		assert.deepEqual(result.errors, []);
		assert.ok(result.rows.length >= 10, `expected the published roster, got ${result.rows.length}`);
		assert.ok(result.families.length >= 5);
		const uncovered = result.rows.filter((row) =>
			row.gates.some((gate) => gate.status !== 'covered' && gate.detail === '<unresolved>'),
		);
		assert.deepEqual(uncovered, []);
	});
});

describe('report rendering', () => {
	it('is deterministic for one tree, so the committed screenshot can be regenerated', () => {
		const result = evaluateCoverage({
			manifest: manifestWith([entryFor(ABOUT_ROUTE)]),
			routes: [ABOUT_ROUTE],
			routeTreeIds: ['/about'],
			evidence: EVIDENCE,
		});
		const input = {
			manifest: manifestWith([entryFor(ABOUT_ROUTE)]),
			routes: [ABOUT_ROUTE],
			result,
			sourceSha: 'deadbeefcafe',
		};
		const first = renderReport(input);
		const second = renderReport(input);
		assert.equal(first, second);
		assert.match(first, /deadbeefcafe/);
		assert.match(first, /<code>e2e<\/code>/);
	});
});

describe('the --report writer', () => {
	it('creates the missing parent directory of the report target', () => {
		const root = stageRepo({
			'src/routes/about.tsx': ROUTE_FILE,
			'e2e/about.spec.ts': "await page.goto('/about');\n",
			'quality/route-coverage.json': JSON.stringify(
				manifestWith([entryFor({ source: 'src/routes/about.tsx', id: '/about', path: '/about' })]),
			),
		});
		// `.tmp/` is gitignored, so a clean checkout has no such directory —
		// exactly the state in which the documented reproduction procedure
		// (`pnpm run routes:quality:report`) has to work.
		const target = join(root, '.tmp/nested/route-quality-report.html');
		assert.equal(existsSync(dirname(target)), false);
		try {
			const stdout = execFileSync(
				process.execPath,
				[GATE_SCRIPT, `--root=${root}`, `--report=${target}`],
				{ encoding: 'utf8' },
			);
			assert.match(stdout, /wrote /);
			assert.equal(existsSync(target), true);
			assert.match(readFileSync(target, 'utf8'), /public route × quality gate coverage/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
