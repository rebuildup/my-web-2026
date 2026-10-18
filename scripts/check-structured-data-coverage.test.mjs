import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	checkCoverage,
	isPublicRoute,
	normaliseRoutePath,
	parseRoutePaths,
} from './check-structured-data-coverage.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = JSON.parse(
	readFileSync(join(ROOT, 'src/editorial/structured-data/contract.json'), 'utf8'),
);
const ROUTE_TREE = readFileSync(join(ROOT, 'src/routeTree.gen.ts'), 'utf8');

const ROUTE_PATHS = parseRoutePaths(ROUTE_TREE).map(normaliseRoutePath);

function check(routes, registry = CONTRACT.routes) {
	return checkCoverage({ routePaths: routes, registry, knownTypes: CONTRACT.knownTypes });
}

test('parses fullPath entries out of the generated route tree', () => {
	const paths = parseRoutePaths(ROUTE_TREE);
	assert.ok(paths.includes('/about'));
	assert.ok(paths.includes('/portfolio/$slug'));
	assert.ok(paths.length > 5);
});

test('normalises index trailing slashes and dynamic segments', () => {
	assert.equal(normaliseRoutePath('/tools/'), '/tools');
	assert.equal(normaliseRoutePath('/portfolio/$slug'), '/portfolio/[slug]');
	assert.equal(normaliseRoutePath('/'), '/');
});

test('treats /admin as non-public', () => {
	assert.equal(isPublicRoute('/about'), true);
	assert.equal(isPublicRoute('/admin'), false);
	assert.equal(isPublicRoute('/admin/login'), false);
});

test('the committed registry covers every route the router generates', () => {
	const result = check(ROUTE_PATHS);
	assert.deepEqual(result.errors, []);
	assert.ok(result.publicRoutes.includes('/about'));
	assert.ok(result.publicRoutes.includes('/portfolio/[slug]'));
	assert.ok(result.nonPublicRoutes.includes('/admin/login'));
});

test('a new public route with no decision is an error, not a silent pass', () => {
	const result = check([...ROUTE_PATHS, '/activity']);
	assert.equal(result.errors.length, 1);
	assert.match(result.errors[0], /\/activity has no structured-data decision/);
});

test('a stale registry entry is an error', () => {
	const result = check(ROUTE_PATHS, [
		...CONTRACT.routes,
		{
			path: '/cv',
			public: true,
			status: 'implemented',
			expectedTypes: ['Person'],
			samplePath: '/cv',
			note: 'x',
		},
	]);
	assert.equal(result.errors.length, 1);
	assert.match(result.errors[0], /\/cv does not exist in the router/);
});

test('an entry without a note is rejected — an unexplained entry is an oversight', () => {
	const registry = CONTRACT.routes.map((route) =>
		route.path === '/about' ? { ...route, note: '  ' } : route,
	);
	const result = check(ROUTE_PATHS, registry);
	assert.equal(result.errors.length, 1);
	assert.match(result.errors[0], /has no note/);
});

test('not-implemented may not claim emitted types', () => {
	const registry = CONTRACT.routes.map((route) =>
		route.path === '/tools' ? { ...route, expectedTypes: ['Person'] } : route,
	);
	const result = check(ROUTE_PATHS, registry);
	assert.ok(result.errors.some((error) => /is not-implemented but claims Person/.test(error)));
});

test('an unknown @type is rejected', () => {
	const registry = CONTRACT.routes.map((route) =>
		route.path === '/about' ? { ...route, expectedTypes: ['ProfilePage'] } : route,
	);
	const result = check(ROUTE_PATHS, registry);
	assert.ok(result.errors.some((error) => /unknown @type "ProfilePage"/.test(error)));
});

test('an implemented dynamic route must declare a sample path the suite can fetch', () => {
	const registry = CONTRACT.routes.map((route) =>
		route.path === '/portfolio/[slug]' ? { ...route, samplePath: null } : route,
	);
	const result = check(ROUTE_PATHS, registry);
	assert.ok(result.errors.some((error) => /has no samplePath/.test(error)));
});

test('one route covered twice is ambiguous and rejected', () => {
	const registry = [
		...CONTRACT.routes,
		{
			path: '/about',
			public: true,
			status: 'implemented',
			expectedTypes: ['Person'],
			samplePath: '/about',
			note: 'dup',
		},
	];
	const result = check(ROUTE_PATHS, registry);
	assert.ok(result.errors.some((error) => /covered by 2 entries/.test(error)));
});
