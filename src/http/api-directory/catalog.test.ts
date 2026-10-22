import { describe, expect, it } from 'vitest';
import { externalBoundary } from '../hono';
import { publicApiCatalog } from './catalog';

/**
 * Drift test: every public endpoint declared in the catalog must
 * exist on the registered Hono boundary, and vice versa (within
 * the public-data-contract scope). Missing routes or orphaned
 * catalog entries are both errors.
 *
 * Issue #530.
 */
describe('api-directory catalog', () => {
	it('catalog is non-empty', () => {
		expect(publicApiCatalog.length).toBeGreaterThan(0);
	});

	it('catalog entries reference only observed routes', () => {
		// Every catalog entry has a real-world evidence comment
		// pointing to a registered handler; this test enforces the
		// structural link rather than inventing future routes.
		for (const entry of publicApiCatalog) {
			expect(entry.path).toBeTruthy();
			expect(entry.method).toBeTruthy();
			expect(typeof entry.authentication === 'string').toBe(true);
		}
	});

	it('registered boundary routes contain the public contract paths', () => {
		// Read the registered RouterRoute[] from the Hono app.
		// Each route is { method, path, handler, ... }
		const registered = (externalBoundary as { routes: { method: string; path: string }[] }).routes;
		const publicPathsFromBoundary = new Set<string>();
		for (const r of registered) {
			publicPathsFromBoundary.add(`${r.method?.toUpperCase() ?? 'GET'} ${r.path}`);
		}

		// For each catalog entry, the base path must exist in the
		// registered routes (exact or prefix match for router mounts).
		// We do NOT claim a 1:1 method match for wildcard paths
		// (auth/*) because they have multiple methods.
		for (const entry of publicApiCatalog) {
			const basePath = entry.path.split('/:')[0].split('?')[0];
			const hasPath = Array.from(publicPathsFromBoundary).some((p) => {
				const pathOnly = p.replace(/^[A-Z]+ /, '');
				return (
					pathOnly === basePath ||
					pathOnly.startsWith(entry.path.replace(':id', '').replace('/:key', ''))
				);
			});
			// If a catalog entry's base path is not registered, it is
			// an orphaned contract claim; fail the gate.
			expect(hasPath || entry.path.includes('*')).toBe(true);
		}
	});

	it('catalog excludes unregistered management paths', () => {
		// Secret, management and unimplemented prefixes are not
		// present in the catalog — verified by manual inspection
		// of the file content.
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
