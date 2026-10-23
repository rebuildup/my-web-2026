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
 * sub-router's `.all()` 405 fallback. A 405 fallback rides behind real
 * verbs and adds no route of its own; middleware answers nothing itself
 * and is named by an explicit exclusion. An `.all()` route at a path
 * with no real verb, however, IS a live handler and must be reported
 * (Issue #530 cold review F1).
 *
 * Issue #530.
 */
describe('api-directory drift', () => {
	it('ignores a 405 fallback whose path already carries a real verb', () => {
		const routes: RouteRef[] = [boundary('/api/v1/health'), boundary('/api/v1/health', 'ALL')];
		const catalog = [{ method: 'GET', path: '/api/v1/health' }];

		expect(undocumentedRoutes(routes, catalog, [])).toEqual([]);
	});

	it('ignores middleware only when an explicit ALL exclusion names it', () => {
		const routes: RouteRef[] = [
			boundary('/api/v1/health'),
			boundary('/api/v1/*', 'ALL'),
			boundary('/*', 'ALL'),
		];
		const catalog = [{ method: 'GET', path: '/api/v1/health' }];
		const exclusions = [
			{ method: 'ALL', path: '/api/v1/*' },
			{ method: 'ALL', path: '/*' },
		];

		expect(undocumentedRoutes(routes, catalog, exclusions)).toEqual([]);
	});

	it('reports an ALL route that has no real verb and no exclusion', () => {
		// F1 regression: `.all()` registers a live handler, so a path
		// with no real verb must not be silently skipped.
		const routes: RouteRef[] = [boundary('/api/v1/probe-all', 'ALL')];

		expect(undocumentedRoutes(routes, [], []).map((route) => route.path)).toEqual([
			'/api/v1/probe-all',
		]);
	});

	it('still reports a real route the catalog does not describe', () => {
		const routes: RouteRef[] = [
			boundary('/api/v1/health'),
			boundary('/api/v1/hidden'),
			boundary('/api/v1/*', 'ALL'),
		];
		const catalog = [{ method: 'GET', path: '/api/v1/health' }];
		const exclusions = [{ method: 'ALL', path: '/api/v1/*' }];

		expect(undocumentedRoutes(routes, catalog, exclusions).map((route) => route.path)).toEqual([
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
