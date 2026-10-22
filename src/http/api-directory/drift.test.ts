import { describe, expect, it } from 'vitest';
import {
	type RouteRef,
	orphanedCatalogEntries,
	shadowingExclusions,
	undocumentedRoutes,
} from './drift';

const boundary = (path: string, method = 'GET'): RouteRef => ({ method, path });

/**
 * `ALL` is what Hono reports for `app.use()` middleware and for a
 * sub-router's `.all()` 405 fallback. Neither is a published contract,
 * so the drift comparison must not ask the catalog to describe them.
 *
 * Issue #530.
 */
describe('api-directory drift', () => {
	it('ignores middleware and 405 fallbacks registered under ALL', () => {
		const routes: RouteRef[] = [
			boundary('/api/v1/health'),
			boundary('/api/v1/*', 'ALL'),
			boundary('*', 'ALL'),
		];
		const catalog = [{ method: 'GET', path: '/api/v1/health' }];

		expect(undocumentedRoutes(routes, catalog, [])).toEqual([]);
	});

	it('still reports a real route the catalog does not describe', () => {
		const routes: RouteRef[] = [
			boundary('/api/v1/health'),
			boundary('/api/v1/hidden'),
			boundary('/api/v1/*', 'ALL'),
		];
		const catalog = [{ method: 'GET', path: '/api/v1/health' }];

		expect(undocumentedRoutes(routes, catalog, []).map((route) => route.path)).toEqual([
			'/api/v1/hidden',
		]);
	});

	it('reports a catalog entry the boundary does not serve', () => {
		const catalog = [
			{ method: 'GET', path: '/api/v1/health' },
			{ method: 'GET', path: '/api/v1/gone' },
		];

		expect(
			orphanedCatalogEntries(catalog, [boundary('/api/v1/health')]).map((e) => e.path),
		).toEqual(['/api/v1/gone']);
	});

	it('reports an exclusion that shadows a catalogued route', () => {
		const catalog = [{ method: 'GET', path: '/api/v1/health' }];
		const exclusions = [{ method: 'GET', path: '/api/v1/health' }];

		expect(shadowingExclusions(catalog, exclusions).length).toBe(1);
	});
});
