import { describe, expect, it } from 'vitest';
import { externalBoundary } from '../hono';
import { publicApiCatalog, publicApiScopeExclusions } from './catalog';
import {
	type RouteRef,
	orphanedCatalogEntries,
	shadowingExclusions,
	undocumentedRoutes,
} from './drift';

/**
 * Drift test between the public API directory and the registered Hono
 * boundary (`externalBoundary`, `src/http/hono.ts`).
 *
 * The check runs in BOTH directions:
 *
 *   - catalog → boundary: every catalog entry is a route the boundary
 *     really registers. An entry for a route that no longer exists is
 *     an orphaned claim.
 *   - boundary → catalog: every registered route is either catalogued
 *     or explicitly excluded from the public scope (with a reason).
 *     A public route that nobody catalogued fails here — which is the
 *     direction that matters, because the catalog is the published
 *     inventory.
 *
 * Issue #530.
 */

function registeredRoutes(): RouteRef[] {
	const routes = (externalBoundary as unknown as { routes: RouteRef[] }).routes;
	return routes.map((route) => ({
		method: (route.method ?? 'GET').toUpperCase(),
		path: route.path,
	}));
}

describe('api-directory catalog', () => {
	it('catalog is non-empty', () => {
		expect(publicApiCatalog.length).toBeGreaterThan(0);
	});

	it('catalog entries are well formed', () => {
		for (const entry of publicApiCatalog) {
			expect(entry.path).toBeTruthy();
			expect(entry.method).toBeTruthy();
			expect(['GET', 'HEAD', 'POST', 'PUT', 'DELETE']).toContain(entry.method);
			expect(['anonymous', 'credentialed']).toContain(entry.authentication);
			expect(entry.errorForm).toBeTruthy();
			expect(entry.purpose).toBeTruthy();
			expect(entry.responseExample).toBeDefined();
		}
	});

	it('catalog entries reference only registered routes', () => {
		// Direction 1: catalog → boundary. A catalog entry for a route
		// the boundary does not serve is a claim nobody can rely on.
		const orphans = orphanedCatalogEntries(publicApiCatalog, registeredRoutes());
		expect(orphans.map((entry) => `${entry.method} ${entry.path}`)).toEqual([]);
	});

	it('every registered route is catalogued or explicitly excluded', () => {
		// Direction 2: boundary → catalog. A route the boundary serves
		// and that neither the catalog nor the scope exclusions
		// mention is a route the published directory does not describe.
		const undocumented = undocumentedRoutes(
			registeredRoutes(),
			publicApiCatalog,
			publicApiScopeExclusions,
		);
		expect(undocumented.map((route) => `${route.method} ${route.path}`)).toEqual([]);
	});

	it('turns red when a public route is dropped from the catalog', () => {
		// The gate has to have teeth in the direction that breaks the
		// directory: removing an entry must make the comparison fail.
		const withoutHealth = publicApiCatalog.filter(
			(entry) => !(entry.method === 'GET' && entry.path === '/api/v1/health'),
		);
		const undocumented = undocumentedRoutes(
			registeredRoutes(),
			withoutHealth,
			publicApiScopeExclusions,
		);
		expect(undocumented.map((route) => `${route.method} ${route.path}`)).toContain(
			'GET /api/v1/health',
		);
	});

	it('turns red when a newly registered route is not catalogued', () => {
		const undocumented = undocumentedRoutes(
			[...registeredRoutes(), { method: 'GET', path: '/api/v1/not-catalogued' }],
			publicApiCatalog,
			publicApiScopeExclusions,
		);
		expect(undocumented.map((route) => `${route.method} ${route.path}`)).toContain(
			'GET /api/v1/not-catalogued',
		);
	});

	it('scope exclusions carry a reason and do not shadow a catalogued route', () => {
		for (const exclusion of publicApiScopeExclusions) {
			expect(exclusion.reason.trim().length).toBeGreaterThan(0);
		}
		expect(
			shadowingExclusions(publicApiCatalog, publicApiScopeExclusions).map(
				(exclusion) => `${exclusion.method} ${exclusion.path}`,
			),
		).toEqual([]);
	});

	it('catalog excludes management and secret paths', () => {
		// Secret, management and unimplemented prefixes are not
		// present in the catalog.
		const forbiddenPrefixes = [
			'/admin',
			'/_serverFn',
			'/db/ping',
			'/media/ping',
			'/integrations/',
			'/webhooks/',
		];
		for (const entry of publicApiCatalog) {
			for (const forbidden of forbiddenPrefixes) {
				expect(entry.path.startsWith(forbidden)).toBe(false);
			}
		}
	});
});
