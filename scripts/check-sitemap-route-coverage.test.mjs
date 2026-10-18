#!/usr/bin/env node

/**
 * Route-coverage guard for the public sitemap (Issue #420).
 *
 * Why this file exists
 * --------------------
 * A sitemap drifts silently. Nothing in the router fails when a new
 * public page ships without a sitemap decision, and a crawler that
 * stops being told about a page is indistinguishable from a page that
 * was deliberately retired. The Issue's acceptance criteria name that
 * failure mode directly: "誤検知と未実装routeを無言の合格にしない".
 *
 * What it asserts (one rule per direction)
 * ---------------------------------------
 *   1. FORWARD — every route in `src/routeTree.gen.ts` is classified:
 *      listed statically, covered by a generated family, or excluded
 *      with a reason. An unclassified route fails.
 *   2. REVERSE — every static inventory entry is a real route. A stale
 *      entry (route renamed or removed) fails.
 *   3. CANONICAL — every listed URL is the `rel="canonical"` the route
 *      file itself declares, so "<loc> == canonical" is checked against
 *      the source of truth rather than against a second copy of it.
 *
 * Why a `node --test` script and not a Vitest file
 * -----------------------------------------------
 * It has to read `src/routeTree.gen.ts` and the route sources from
 * disk. The workerd pool sandboxes `node:fs` to the bundle (probed
 * during this ticket: `readFileSync('src/...')` resolves under
 * `/bundle`), so a `src/**` test cannot do this. Node's test runner
 * can, and the inventory it reads is dependency-free TypeScript, which
 * Node strips directly.
 *
 * Run locally: `node --experimental-strip-types --test scripts/check-sitemap-route-coverage.test.mjs`
 * Run in CI: part of `pnpm run test` (and therefore `validate:fast`).
 * `scripts/check-test-wiring.mjs` fails if this file is ever dropped
 * from that script.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTE_TREE = resolve(REPO_ROOT, 'src/routeTree.gen.ts');

/**
 * `/portfolio/` and `/tools/` are index routes: the generated file
 * spells their `fullPath` with a trailing slash, the router and every
 * canonical URL do not. Normalising here keeps the comparison against
 * the sitemap inventory (and against `rel="canonical"`) honest.
 */
function normalizeRoutePath(path) {
	if (path.length > 1 && path.endsWith('/')) return path.replace(/\/+$/, '');
	return path;
}

/**
 * Route paths declared by the generated route tree, mapped to the
 * route module that implements them.
 *
 * Parsed from the generated file rather than from the file system so
 * the guard follows the router's own contract: if a route is declared
 * in `routeTree.gen.ts`, it is a route.
 *
 * @returns {Map<string, string>} fullPath -> repo-relative source file
 */
function collectRouteSources(source) {
	const importPaths = new Map();
	for (const match of source.matchAll(
		/^import \{ Route as (\w+) \} from '(\.\/routes\/[^']+)'$/gm,
	)) {
		importPaths.set(match[1], match[2]);
	}

	const routes = new Map();
	const blockPattern = /^\s{4}'([^']+)': \{\n(.*?)^\s{4}\}$/gms;
	for (const [, path, body] of source.matchAll(blockPattern)) {
		const fullPath = body.match(/fullPath: '([^']+)'/)?.[1];
		const preLoader = body.match(/preLoaderRoute: typeof (\w+)/)?.[1];
		if (!fullPath || !preLoader) continue;
		const modulePath = importPaths.get(preLoader);
		if (!modulePath) continue;
		routes.set(normalizeRoutePath(fullPath), `${modulePath.replace(/^\./, 'src')}.tsx`);
	}
	return routes;
}

/**
 * Classify one route path against the sitemap inventories.
 *
 * @returns {'listed'|'generated'|'excluded'|'unclassified'}
 */
function classifyRoute(normalizedPath, { entries, dynamicRoutes, exclusions }) {
	if (entries.some((entry) => normalizeRoutePath(entry.path) === normalizedPath)) {
		return 'listed';
	}
	if (dynamicRoutes.some((route) => matchesTemplate(route.template, normalizedPath))) {
		return 'generated';
	}
	for (const exclusion of exclusions) {
		if (exclusion.kind === 'prefix') {
			if (normalizedPath === exclusion.route || normalizedPath.startsWith(`${exclusion.route}/`)) {
				return 'excluded';
			}
		} else if (normalizeRoutePath(exclusion.route) === normalizedPath) {
			return 'excluded';
		}
	}
	return 'unclassified';
}

/**
 * `/portfolio/$slug` matches `/portfolio/anything` as ONE segment.
 * `$` is the router's only dynamic marker today; a template with more
 * than one would still match segment-by-segment.
 */
function matchesTemplate(template, normalizedPath) {
	const prefix = template.replace(/\$[^/]+$/, '');
	const rest = template.slice(prefix.length);
	if (!rest.startsWith('$')) return normalizeRoutePath(template) === normalizedPath;
	return normalizedPath.startsWith(prefix) && !normalizedPath.slice(prefix.length).includes('/');
}

async function loadInventory() {
	const url = pathToFileURL(resolve(REPO_ROOT, 'src/http/seo/sitemap.ts')).href;
	const inventory = await import(url);
	return {
		entries: inventory.SITEMAP_ENTRIES,
		dynamicRoutes: inventory.SITEMAP_DYNAMIC_ROUTES,
		exclusions: inventory.SITEMAP_EXCLUSIONS,
		origin: inventory.SITEMAP_ORIGIN,
	};
}

test('every route in the generated route tree is classified by the sitemap', async () => {
	const inventory = await loadInventory();
	const routes = collectRouteSources(readFileSync(ROUTE_TREE, 'utf8'));
	assert.ok(routes.size > 0, 'routeTree.gen.ts parse returned no routes — update this guard');

	const unclassified = [...routes.keys()].filter(
		(path) => classifyRoute(path, inventory) === 'unclassified',
	);
	assert.deepEqual(
		unclassified,
		[],
		`routes exist but the sitemap has no decision for them: ${unclassified.join(', ')}. Add them to SITEMAP_ENTRIES, SITEMAP_DYNAMIC_ROUTES, or SITEMAP_EXCLUSIONS (with a reason).`,
	);
});

test('every static sitemap entry is a real route', async () => {
	const inventory = await loadInventory();
	const routes = collectRouteSources(readFileSync(ROUTE_TREE, 'utf8'));

	const stale = inventory.entries
		.map((entry) => normalizeRoutePath(entry.path))
		.filter((path) => !routes.has(path));
	assert.deepEqual(
		stale,
		[],
		`sitemap lists routes that src/routeTree.gen.ts does not declare: ${stale.join(', ')}`,
	);
});

test('every static sitemap entry is generated from a canonical-declaring route', async () => {
	const inventory = await loadInventory();
	const routes = collectRouteSources(readFileSync(ROUTE_TREE, 'utf8'));

	for (const entry of inventory.entries) {
		const path = normalizeRoutePath(entry.path);
		const sourceFile = routes.get(path);
		assert.ok(sourceFile, `no route source resolved for ${path}`);
		const routeSource = readFileSync(resolve(REPO_ROOT, sourceFile), 'utf8');
		const expected = `${inventory.origin}${path === '/' ? '/' : path}`;
		assert.ok(
			routeSource.includes(`rel: 'canonical'`) && routeSource.includes(expected),
			`${sourceFile} must declare rel="canonical" href="${expected}" for the sitemap <loc> to be canonical`,
		);
	}
});

test('the generated portfolio family stays one entry per project', async () => {
	const inventory = await loadInventory();
	assert.deepEqual(
		inventory.dynamicRoutes.map((route) => route.template),
		['/portfolio/$slug'],
	);
	const sourceFile = collectRouteSources(readFileSync(ROUTE_TREE, 'utf8')).get('/portfolio/$slug');
	assert.ok(sourceFile, 'portfolio detail route not found in the route tree');
	const routeSource = readFileSync(resolve(REPO_ROOT, sourceFile), 'utf8');
	// The detail route builds its canonical from a template literal, so
	// the literal `${project.slug}` is compared as text.
	const expected = `${inventory.origin}/portfolio/${'${project.slug}'}`;
	assert.ok(
		routeSource.includes(expected),
		`the portfolio detail route must build its canonical from ${expected} — the same origin + slug the sitemap uses`,
	);
});

test('matchesTemplate only matches a single dynamic segment', () => {
	assert.equal(matchesTemplate('/portfolio/$slug', '/portfolio/tastile'), true);
	assert.equal(matchesTemplate('/portfolio/$slug', '/portfolio/a/b'), false);
	assert.equal(matchesTemplate('/portfolio/$slug', '/portfolios/tastile'), false);
	assert.equal(matchesTemplate('/about', '/about'), true);
	assert.equal(matchesTemplate('/about', '/about/extra'), false);
});
