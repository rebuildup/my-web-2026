/**
 * Index-boundary contract tests (Issue #423).
 *
 * Run with
 * `node --experimental-strip-types --test scripts/check-index-boundary.test.mjs`
 * (wired into `pnpm run test` — see `scripts/check-test-wiring.mjs`).
 * Type stripping is needed because the last case imports the SEO owner's
 * real module (`src/http/seo/sitemap.ts`), exactly as the gate does.
 *
 * What is under test
 * ------------------
 * The failure modes this gate exists to prevent, each as its own case:
 *
 *   - an unintended SITE-WIDE noindex (`Disallow: /`) shipping unnoticed;
 *   - a raw-prefix `Disallow` that silently shadows a sibling public route;
 *   - the forbidden combination — a page de-indexed by its own `noindex`
 *     meta that is ALSO kept out of the crawl, which can only ever end
 *     as "Indexed, though blocked by robots.txt";
 *   - a crawl-blocked route that lost its `Disallow` rule;
 *   - a URL appearing in the sitemap that no route serves (an
 *     unimplemented route passing as "implemented"), or an indexable
 *     page that quietly dropped out of the sitemap;
 *   - a public route carrying a `noindex` meta — in a COMMENTED-OUT or
 *     half-declared entry, which is how a text check lies;
 *   - a page declaring a `canonical` that disagrees with its sitemap URL;
 *   - a NEW route shipping with no declared index intent at all, and a
 *     DELETED route leaving a stale intent entry behind.
 *
 * Every fixture is built from a route tree that mirrors the real
 * generated file, so the assertions exercise the same code path CI runs
 * — with the mutation applied. The final group runs against the REAL
 * served documents, so a fixture-only green can never hide a violation
 * in what the site actually serves.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	CANONICAL_ORIGIN,
	EXTERNAL_BOUNDARY_PREFIXES,
	FRAMEWORK_PREFIXES,
	SITEMAP_PATH,
	classifyRoutes,
	declaresNoindexMeta,
	evaluateIndexBoundary,
	missingDisallowViolations,
	noindexBlockedViolations,
	parseRobotsTxt,
	parseRouteTree,
	robotsRuleCovers,
	routeModuleCandidates,
	stripComments,
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
	['/projects/dotfiles', './routes/projects.dotfiles'],
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
		if (
			[
				'/',
				'/about',
				'/contact',
				'/design-system',
				'/portfolio',
				'/projects/dotfiles',
				'/tools',
			].includes(path)
		) {
			source += `const links = [{ rel: 'canonical', href: '${ORIGIN}${path}' }];\n`;
		}
		if (path === '/admin' || path === '/tools/$slug') {
			source += NOINDEX_META;
		}
		sources.set(file, source);
	}
	return sources;
}

/**
 * The robots.txt body the SEO router renders (Issue #420's shape, which
 * this contract verifies rather than generates).
 */
const SERVED_ROBOTS = [
	'User-agent: *',
	'Allow: /',
	'',
	`Sitemap: ${ORIGIN}${SITEMAP_PATH}`,
	'',
].join('\n');

/** The static entries `SITEMAP_ENTRIES` advertises. */
const SERVED_SITEMAP_PATHS = ['/', '/about', '/contact', '/design-system', '/portfolio', '/tools'];

/** Evaluate the boundary for a fixture, with optional mutations. */
function evaluate(overrides = {}) {
	const routes = overrides.routes ?? FIXTURE_ROUTES;
	const sources = routeFileSources(routes);
	const tree = routeTreeSource(routes);
	const robotsTxt =
		overrides.robotsTxt ??
		(overrides.robotsMutate ? overrides.robotsMutate(SERVED_ROBOTS) : SERVED_ROBOTS);
	return evaluateIndexBoundary({
		routeTreeSource: tree,
		robotsTxt,
		sitemapPaths: overrides.sitemapPaths ?? SERVED_SITEMAP_PATHS,
		sitemapOrigin: overrides.sitemapOrigin ?? ORIGIN,
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

describe('the served crawler documents', () => {
	it('has no site-wide Disallow and every rule it does carry is exact or subtree', () => {
		const robots = SERVED_ROBOTS;
		assert.equal(robots.includes('Disallow: /\n'), false);
		for (const rule of parseRobotsTxt(robots).disallow) {
			assert.ok(rule.endsWith('$') || rule.endsWith('/'), `rule ${rule} is not exact or subtree`);
		}
		assert.ok(robots.includes(`Sitemap: ${ORIGIN}${SITEMAP_PATH}`));
	});

	it('never blocks a route that is de-indexed by its own noindex meta', () => {
		// The rule the module doc states and the gate now enforces: a
		// page the crawler may not fetch can never deliver its own
		// noindex, so `/admin/**` and `/tools/$slug` must stay
		// crawlable.
		const { classified } = classifyRoutes(parseRouteTree(routeTreeSource()).routes);
		const blocked = noindexBlockedViolations(classified, parseRobotsTxt(SERVED_ROBOTS).disallow);
		assert.deepEqual(blocked, []);
		for (const rule of parseRobotsTxt(SERVED_ROBOTS).disallow) {
			assert.equal(rule.includes('admin'), false, `${rule} blocks a noindex route`);
		}
	});

	it('advertises exactly the routes the contract classifies as indexable', () => {
		const { classified } = classifyRoutes(parseRouteTree(routeTreeSource()).routes);
		assert.deepEqual(
			classified
				.filter((route) => route.intent.index === 'sitemap')
				.map((route) => route.path)
				.sort(),
			SERVED_SITEMAP_PATHS,
		);
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

	it('fails on Disallow: /*', () => {
		const result = evaluate({
			robotsMutate: (text) => text.replace('Allow: /', 'Disallow: /*'),
		});
		assert.ok(codes(result).includes('global-noindex'));
	});

	it('reports an empty Disallow value as a no-op rule, not as a site-wide noindex', () => {
		// RFC 9309: an empty value means "allow everything", so it cannot
		// de-index the site. It gets its own code because the failure is
		// a silently botched edit, not a vanished index.
		const result = evaluate({
			robotsMutate: (text) => text.replace('Allow: /', 'Disallow:    '),
		});
		const found = codes(result);
		assert.ok(found.includes('empty-disallow'));
		assert.equal(found.includes('global-noindex'), false);
	});

	it('fails when a public route module declares a noindex meta', () => {
		const result = evaluate({ fileOverrides: { './routes/contact': `${NOINDEX_META}\n` } });
		assert.ok(codes(result).includes('unexpected-noindex-meta'));
	});
});

describe('a noindex declaration has to be a real one', () => {
	it('does not accept a noindex that only exists in a comment', () => {
		assert.equal(
			declaresNoindexMeta(
				"// meta: [{ name: 'robots', content: 'noindex, nofollow' }]\n/*\nhead: () => ({ meta: [{ name: 'robots', content: 'noindex' }] }),\n*/\n",
			),
			false,
		);
	});

	it('does not accept the robots name and the noindex content from two entries', () => {
		assert.equal(
			declaresNoindexMeta("meta: [{ name: 'robots' }, { content: 'noindex, nofollow' }]"),
			false,
		);
	});

	it('still accepts the real declaration and keeps URL strings intact', () => {
		assert.equal(
			declaresNoindexMeta("head: () => ({ meta: [{ name: 'robots', content: 'noindex' }] }),"),
			true,
		);
		const source = "const u = 'https://rebuildup.dev/contact'; // see https://example.com\n";
		assert.ok(stripComments(source).includes('https://rebuildup.dev/contact'));
		assert.equal(stripComments(source).includes('example.com'), false);
	});

	it('fails a gated route whose noindex survives only as a comment', () => {
		const result = evaluate({
			fileOverrides: {
				'./routes/admin':
					"// head: () => ({ meta: [{ name: 'robots', content: 'noindex, nofollow' }] }),\nexport const Route = createFileRoute({});\n",
			},
		});
		const found = codes(result);
		assert.ok(found.includes('missing-noindex-meta'));
	});
});

describe('evaluateIndexBoundary — noindex must not be paired with a crawl block', () => {
	it('rejects the combination declared in the contract itself', () => {
		// The contract authoring error the module doc calls impossible:
		// `index: 'no'` + `crawl: 'disallow'` on one route.
		const violations = noindexBlockedViolations([
			{ path: '/tools/$slug', intent: { crawl: 'disallow', index: 'no' } },
		]);
		assert.equal(violations.length, 1);
		assert.equal(violations[0].code, 'noindex-blocked');
		assert.match(violations[0].message, /\/tools\/\$slug/);
	});

	it('fails when robots.txt blocks a route that is de-indexed by its own noindex', () => {
		// `Disallow: /tools/` blocks the noindex `/tools/$slug` without
		// touching the public `/tools` index page, so no other code fires.
		const result = evaluate({ robotsMutate: (text) => `${text}Disallow: /tools/\n` });
		const found = codes(result);
		assert.ok(found.includes('noindex-blocked'));
		assert.equal(found.includes('indexable-blocked'), false);
	});

	it('fails when a robots.txt rule blocks a noindex admin page', () => {
		const result = evaluate({ robotsMutate: (text) => `${text}Disallow: /admin/\n` });
		const blocked = result.violations.filter((v) => v.code === 'noindex-blocked');
		assert.equal(blocked.length, 6, 'every gated admin child is de-indexed by the layout meta');
	});
});

describe('evaluateIndexBoundary — robots.txt is not access control, but is not a substitute either', () => {
	it('fails when a crawl-blocked route loses its Disallow rule', () => {
		// The shipped contract declares no crawl-blocked page (the admin
		// subtree must stay crawlable so its own noindex can be read), so
		// the rule is exercised against the extracted checker directly.
		const classified = [{ path: '/private', intent: { crawl: 'disallow' } }];
		assert.deepEqual(missingDisallowViolations(classified, ['/private$', '/private/']), []);
		const violations = missingDisallowViolations(classified, []);
		assert.equal(violations.length, 1);
		assert.equal(violations[0].code, 'missing-disallow');
		assert.match(violations[0].message, /\/private/);
	});

	it('does not demand a Disallow for the machine boundaries', () => {
		// /api/v1 & co. answer 401/404 instead of serving a document;
		// spending crawl budget on them is the SEO owner's call, so the
		// contract must not fail the build over their absence.
		const result = evaluate();
		assert.deepEqual(result.violations, []);
		assert.ok(EXTERNAL_BOUNDARY_PREFIXES.includes('/api/v1'));
		assert.ok(FRAMEWORK_PREFIXES.includes('/_serverFn'));
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
				"const EXTERNAL_BOUNDARY_PREFIXES = ['/api/v1', '/webhooks', '/oauth', '/integrations', '/media', '/robots.txt', '/sitemap.xml', '/.well-known', '/telemetry'];",
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
		const result = evaluate({ sitemapPaths: [...SERVED_SITEMAP_PATHS, '/nope'] });
		assert.ok(codes(result).includes('sitemap-unexpected-entry'));
	});

	it('fails when an indexable page drops out of the sitemap', () => {
		const result = evaluate({
			sitemapPaths: SERVED_SITEMAP_PATHS.filter((path) => path !== '/tools'),
		});
		assert.ok(codes(result).includes('sitemap-missing-entry'));
	});

	it('fails when the sitemap document is rendered off the canonical origin', () => {
		// ADR-0014: one production origin. A `workers.dev` sitemap would
		// advertise the debug host to every crawler.
		const result = evaluate({ sitemapOrigin: 'https://my-web-2026.example.workers.dev' });
		assert.ok(codes(result).includes('sitemap-non-canonical-host'));
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
	it('passes the real gate (served robots.txt / sitemap, src/routes/**)', async () => {
		// The same read the CLI performs — the SEO owner's real output,
		// not a fixture — so a fixture-only green run can never hide a
		// violation in what the site actually serves.
		const seo = await import(pathToFileURL(join(REPO_ROOT, 'src/http/seo/sitemap.ts')).href);
		const result = evaluateIndexBoundary({
			routeTreeSource: readFileSync(join(REPO_ROOT, 'src/routeTree.gen.ts'), 'utf8'),
			serverSource: readFileSync(join(REPO_ROOT, 'src/server.ts'), 'utf8'),
			robotsTxt: seo.renderRobotsTxt(),
			sitemapPaths: seo.SITEMAP_ENTRIES.map((entry) => entry.path),
			sitemapOrigin: seo.SITEMAP_ORIGIN,
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
