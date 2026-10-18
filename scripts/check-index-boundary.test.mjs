/**
 * Index-boundary contract tests (Issue #423).
 *
 * Run with `node --test scripts/check-index-boundary.test.mjs`
 * (wired into `pnpm run test` — see `scripts/check-test-wiring.mjs`).
 *
 * What is under test
 * ------------------
 * The failure modes this gate exists to prevent, each as its own case:
 *
 *   - an unintended SITE-WIDE noindex (`Disallow: /`) shipping unnoticed;
 *   - a `Disallow` rule that silently shadows an indexable public route;
 *   - a gated route (or machine boundary) losing its `Disallow` rule;
 *   - a URL appearing in the sitemap that no route serves (an
 *     unimplemented route passing as "implemented"), or an indexable
 *     page that quietly dropped out of the sitemap;
 *   - a public route carrying a `noindex` meta;
 *   - a page declaring a `canonical` that disagrees with its sitemap URL;
 *   - a NEW route shipping with no declared index intent at all, and a
 *     DELETED route leaving a stale intent entry behind.
 *
 * Every fixture is built from a route tree that mirrors the real
 * generated file, so the assertions exercise the same code path CI runs
 * — with the mutation applied.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	CANONICAL_ORIGIN,
	SITEMAP_PATH,
	buildRobotsTxt,
	buildSitemapXml,
	classifyRoutes,
	evaluateIndexBoundary,
	parseRobotsTxt,
	parseRouteTree,
	parseSitemapLocs,
	robotsRuleCovers,
	routeModuleCandidates,
} from './_index-boundary.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ORIGIN = CANONICAL_ORIGIN;

/** Every route the real tree serves, with the module that owns each path. */
const FIXTURE_ROUTES = [
	['/', './routes/index'],
	['/about', './routes/about'],
	['/contact', './routes/contact'],
	['/design-system', './routes/design-system'],
	['/portfolio/', './routes/portfolio/index'],
	['/portfolio/$slug', './routes/portfolio/$slug'],
	['/tools/', './routes/tools.index'],
	['/tools/$slug', './routes/tools.$slug'],
	['/admin', './routes/admin'],
	['/admin/', './routes/admin.index'],
	['/admin/login', './routes/admin.login'],
	['/admin/keys', './routes/admin.keys'],
	['/admin/images', './routes/admin.images'],
	['/admin/invitations', './routes/admin.invitations'],
	['/admin/invitations/accept', './routes/admin.invitations_.accept'],
	['/admin/emoji-catalog', './routes/admin.emoji-catalog'],
];

const NOINDEX_META =
	"\thead: () => ({ meta: [{ name: 'robots', content: 'noindex, nofollow' }] }),";

function routeTreeSource(routes = FIXTURE_ROUTES) {
	const imports = routes
		.map(
			([fullPath, file], index) =>
				`import { Route as R${index}Import } from '${file.replace(/\.tsx?$/, '')}'`,
		)
		.join('\n');
	const updates = routes
		.map(([fullPath], index) => `const R${index} = R${index}Import.update({\n  id: '${fullPath}'`)
		.join('\n');
	const fullPaths = routes
		.map(([fullPath], index) => `  '${fullPath}': typeof R${index}`)
		.join('\n');
	return [
		'/* generated fixture */',
		imports,
		updates,
		'export interface FileRoutesByFullPath {',
		fullPaths,
		'}',
	].join('\n');
}

/**
 * Route-module sources consistent with the contract: sitemap pages
 * declare their canonical URL, gated pages declare the noindex meta.
 */
function routeFileSources(routes = FIXTURE_ROUTES) {
	const sources = new Map();
	for (const [fullPath, file] of routes) {
		if (sources.has(file)) continue;
		const path = fullPath.length > 1 ? fullPath.replace(/\/$/, '') : fullPath;
		let source = 'export const Route = createFileRoute({});\n';
		if (['/', '/about', '/contact', '/design-system', '/portfolio', '/tools'].includes(path)) {
			source += `const links = [{ rel: 'canonical', href: '${ORIGIN}${path}' }];\n`;
		}
		if (path === '/admin' || path === '/tools/$slug') {
			source += NOINDEX_META;
		}
		sources.set(file, source);
	}
	return sources;
}

/** Evaluate the boundary for a fixture, with optional mutations. */
function evaluate(overrides = {}) {
	const routes = overrides.routes ?? FIXTURE_ROUTES;
	const sources = routeFileSources(routes);
	const tree = routeTreeSource(routes);
	const { classified } = classifyRoutes(parseRouteTree(tree).routes);
	const baseRobots = buildRobotsTxt(classified, ORIGIN);
	const robotsTxt =
		overrides.robotsTxt ??
		(overrides.robotsMutate ? overrides.robotsMutate(baseRobots) : baseRobots);
	const sitemapXml = overrides.sitemapXml ?? buildSitemapXml(classified, ORIGIN);
	return evaluateIndexBoundary({
		routeTreeSource: tree,
		robotsTxt,
		sitemapXml,
		serverSource: overrides.serverSource ?? readFileSync(join(REPO_ROOT, 'src/server.ts'), 'utf8'),
		readRouteFile: (file) => {
			if (overrides.fileOverrides && file in overrides.fileOverrides) {
				return overrides.fileOverrides[file];
			}
			const source = sources.get(file);
			if (!source) throw new Error(`no fixture source for ${file}`);
			return source;
		},
	});
}

function codes(result) {
	return result.violations.map((violation) => violation.code);
}

describe('parseRouteTree', () => {
	it('normalises index paths and keeps the layout module as head owner', () => {
		const { routes } = parseRouteTree(routeTreeSource());
		const admin = routes.find((route) => route.path === '/admin');
		// `/admin` and `/admin/` are the same URL: the layout module owns
		// the head contract, so it must win over `admin.index`.
		assert.equal(admin.file, './routes/admin');
		assert.equal(routes.filter((route) => route.path === '/admin').length, 1);
		assert.equal(
			routes.find((route) => route.path === '/portfolio').file,
			'./routes/portfolio/index',
		);
		assert.equal(
			routes.find((route) => route.path === '/tools/$slug').file,
			'./routes/tools.$slug',
		);
	});
});

describe('robots.txt parsing and matching', () => {
	it('reads sitemap directives and disallow rules, ignoring comments', () => {
		const parsed = parseRobotsTxt(
			'# comment\nUser-agent: *\nAllow: /\nDisallow: /admin$\n\nSitemap: https://rebuildup.dev/sitemap.xml\n',
		);
		assert.deepEqual(parsed.sitemaps, ['https://rebuildup.dev/sitemap.xml']);
		assert.deepEqual(parsed.disallow, ['/admin$']);
	});

	it('treats `$` as exact-match and `/` as subtree-match', () => {
		assert.equal(robotsRuleCovers('/admin$', '/admin'), true);
		assert.equal(robotsRuleCovers('/admin$', '/admin/keys'), false);
		assert.equal(robotsRuleCovers('/admin/', '/admin/keys'), true);
		assert.equal(robotsRuleCovers('/admin/', '/administrator'), false);
	});
});

describe('the generated artefacts', () => {
	it('never emits a site-wide Disallow and pairs every gated prefix with `$` + `/`', () => {
		const { classified } = classifyRoutes(parseRouteTree(routeTreeSource()).routes);
		const robots = buildRobotsTxt(classified, ORIGIN);
		assert.equal(robots.includes('Disallow: /\n'), false);
		for (const rule of parseRobotsTxt(robots).disallow) {
			assert.ok(rule.endsWith('$') || rule.endsWith('/'), `rule ${rule} is not exact or subtree`);
		}
		assert.ok(robots.includes(`Sitemap: ${ORIGIN}${SITEMAP_PATH}`));
	});

	it('lists only indexable routes in the sitemap', () => {
		const { classified } = classifyRoutes(parseRouteTree(routeTreeSource()).routes);
		const locs = parseSitemapLocs(buildSitemapXml(classified, ORIGIN));
		assert.deepEqual(locs, [
			`${ORIGIN}/`,
			`${ORIGIN}/about`,
			`${ORIGIN}/contact`,
			`${ORIGIN}/design-system`,
			`${ORIGIN}/portfolio`,
			`${ORIGIN}/tools`,
		]);
	});
});

describe('evaluateIndexBoundary — the clean fixture passes', () => {
	it('reports no violation', () => {
		const result = evaluate();
		assert.deepEqual(result.violations, []);
		assert.equal(result.summary.origin, ORIGIN);
		assert.equal(result.summary.sitemapEntries, 6);
	});
});

describe('evaluateIndexBoundary — unintended whole-site noindex', () => {
	it('fails on Disallow: / in any group', () => {
		const result = evaluate({
			robotsMutate: (text) => text.replace('Allow: /', 'Disallow: /'),
		});
		assert.ok(codes(result).includes('global-noindex'));
	});

	it('fails on Disallow: /* and on an empty Disallow value', () => {
		for (const rule of ['/*', '   ']) {
			const result = evaluate({
				robotsMutate: (text) => text.replace('Allow: /', `Disallow: ${rule}`),
			});
			assert.ok(
				codes(result).includes('global-noindex'),
				`Disallow: ${rule} must be treated as a whole-site noindex`,
			);
		}
	});

	it('fails when a public route module declares a noindex meta', () => {
		const result = evaluate({ fileOverrides: { './routes/contact': `${NOINDEX_META}\n` } });
		assert.ok(codes(result).includes('unexpected-noindex-meta'));
	});
});

describe('evaluateIndexBoundary — robots.txt is not access control, but is not a substitute either', () => {
	it('fails when the gated admin subtree loses its Disallow rule', () => {
		const result = evaluate({
			robotsMutate: (text) => text.replaceAll(/^Disallow: \/admin.*$/gm, ''),
		});
		assert.ok(codes(result).includes('missing-disallow'));
	});

	it('fails when a machine boundary loses its Disallow rule', () => {
		const result = evaluate({
			robotsMutate: (text) => text.replaceAll(/^Disallow: \/api\/v1.*$/gm, ''),
		});
		assert.ok(codes(result).includes('missing-disallow'));
	});

	it('fails when the Sitemap directive drifts off the canonical origin', () => {
		const result = evaluate({
			robotsMutate: (text) =>
				text.replace(`${ORIGIN}${SITEMAP_PATH}`, 'https://example.workers.dev/sitemap.xml'),
		});
		assert.ok(codes(result).includes('sitemap-directive'));
	});

	it('fails when a raw prefix rule would shadow an indexable route', () => {
		// `Disallow: /tools` is a raw prefix match: it would also swallow
		// the indexable `/tools` index page.
		const result = evaluate({ robotsMutate: (text) => `${text}Disallow: /tools\n` });
		assert.ok(codes(result).includes('robots-overbroad-rule'));
		assert.ok(codes(result).includes('indexable-blocked'));
	});

	it('fails when an indexable route is blocked by an exact rule', () => {
		// A crawl block on an indexable page does not de-index it: the
		// crawler never sees the document, so the URL can only end up
		// "indexed, though blocked by robots.txt". noindex meta is the
		// only correct mechanism.
		const result = evaluate({ robotsMutate: (text) => `${text}Disallow: /portfolio$\n` });
		assert.ok(codes(result).includes('indexable-blocked'));
	});

	it('does not treat a subtree rule as blocking the parent index page', () => {
		// `Disallow: /tools/` covers `/tools/<slug>` but NOT `/tools`, so
		// the public index page stays crawlable and the check stays quiet.
		const result = evaluate({ robotsMutate: (text) => `${text}Disallow: /tools/\n` });
		assert.equal(codes(result).includes('indexable-blocked'), false);
	});

	it('fails when the external-boundary prefix list drifts from src/server.ts', () => {
		const result = evaluate({
			serverSource:
				"const EXTERNAL_BOUNDARY_PREFIXES = ['/api/v1', '/webhooks', '/oauth', '/integrations', '/telemetry'];",
		});
		const drift = result.violations.filter(
			(violation) => violation.code === 'boundary-prefix-drift',
		);
		assert.equal(drift.length, 1);
		assert.match(drift[0].message, /telemetry/);
	});
});

describe('evaluateIndexBoundary — sitemap ↔ noindex intent', () => {
	it('fails on an extra sitemap entry (a URL no route serves)', () => {
		const base = buildSitemapXml(
			classifyRoutes(parseRouteTree(routeTreeSource()).routes).classified,
			ORIGIN,
		);
		const result = evaluate({
			sitemapXml: base.replace(
				'</urlset>',
				'  <url>\n    <loc>https://rebuildup.dev/nope</loc>\n  </url>\n</urlset>',
			),
		});
		assert.ok(codes(result).includes('sitemap-unexpected-entry'));
	});

	it('fails when an indexable page drops out of the sitemap', () => {
		const base = buildSitemapXml(
			classifyRoutes(parseRouteTree(routeTreeSource()).routes).classified,
			ORIGIN,
		);
		const result = evaluate({
			sitemapXml: base
				.replace('  <url>\n    <loc>https://rebuildup.dev/tools</loc>\n  </url>\n', '')
				.replace('</urlset>', '</urlset>'),
		});
		assert.ok(codes(result).includes('sitemap-missing-entry'));
	});

	it('fails when a sitemap entry is not on the canonical origin', () => {
		const base = buildSitemapXml(
			classifyRoutes(parseRouteTree(routeTreeSource()).routes).classified,
			ORIGIN,
		);
		const result = evaluate({
			sitemapXml: base.replace(`${ORIGIN}/about`, 'https://my-web-2026.example.workers.dev/about'),
		});
		assert.ok(codes(result).includes('sitemap-non-canonical-host'));
		assert.ok(codes(result).includes('sitemap-unexpected-entry'));
	});

	it('fails when a page canonical disagrees with its sitemap URL', () => {
		const result = evaluate({
			fileOverrides: {
				'./routes/contact':
					"const links = [{ rel: 'canonical', href: 'https://rebuildup.dev/contact-us' }];\n",
			},
		});
		assert.ok(codes(result).includes('canonical-sitemap-mismatch'));
	});

	it('fails when a sitemap page declares no canonical at all', () => {
		const result = evaluate({
			fileOverrides: { './routes/tools.index': 'export const Route = createFileRoute({});\n' },
		});
		assert.ok(codes(result).includes('missing-canonical'));
	});
});

describe('evaluateIndexBoundary — route inventory is exhaustive', () => {
	it('fails when a new route has no declared index intent', () => {
		const routes = [...FIXTURE_ROUTES, ['/newsletter', './routes/newsletter']];
		const result = evaluate({ routes });
		const unclassified = result.violations.filter((v) => v.code === 'unclassified-route');
		assert.equal(unclassified.length, 1);
		assert.match(unclassified[0].message, /\/newsletter/);
	});

	it('fails when a deleted route leaves a stale intent entry behind', () => {
		const routes = FIXTURE_ROUTES.filter(([fullPath]) => fullPath !== '/contact');
		const result = evaluate({ routes });
		const stale = result.violations.filter((v) => v.code === 'stale-intent');
		assert.equal(stale.length, 1);
		assert.match(stale[0].message, /\/contact/);
	});

	it('fails when a gated route drops its noindex meta', () => {
		const result = evaluate({
			fileOverrides: { './routes/admin': 'export const Route = createFileRoute({});\n' },
		});
		const codesFound = codes(result);
		assert.ok(codesFound.includes('missing-noindex-meta'));
	});
});

describe('the committed repository state', () => {
	it('passes the real gate (public/robots.txt, public/sitemap.xml, src/routes/**)', () => {
		// The same read the CLI performs, so a fixture-only green run can
		// never hide a drift in the committed artefacts.
		const result = evaluateIndexBoundary({
			routeTreeSource: readFileSync(join(REPO_ROOT, 'src/routeTree.gen.ts'), 'utf8'),
			serverSource: readFileSync(join(REPO_ROOT, 'src/server.ts'), 'utf8'),
			robotsTxt: readFileSync(join(REPO_ROOT, 'public/robots.txt'), 'utf8'),
			sitemapXml: readFileSync(join(REPO_ROOT, 'public/sitemap.xml'), 'utf8'),
			readRouteFile: (specifier) => {
				for (const candidate of routeModuleCandidates(specifier)) {
					return readFileSync(join(REPO_ROOT, candidate), 'utf8');
				}
				throw new Error(`unreachable: no candidate for ${specifier}`);
			},
		});
		assert.deepEqual(
			result.violations,
			[],
			`unexpected index-boundary violations: ${JSON.stringify(result.violations, null, 2)}`,
		);
	});

	it('exits 0 when the CLI runs against the repository', () => {
		const output = execFileSync(
			process.execPath,
			[join(REPO_ROOT, 'scripts/check-index-boundary.mjs')],
			{ encoding: 'utf8' },
		);
		assert.match(output, /index boundary OK/);
	});
});
