/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
	CACHE_POLICY_MATRIX,
	evaluateObservation,
	policyById,
	separationViolations,
} from '../../scripts/_cache-policy.mjs';
import { REACTION_IMAGE_CACHE_CONTROL } from '../../src/http/reactions/images';

/**
 * Runtime half of the cache-policy contract (Issue #484).
 *
 * The static half (`scripts/cache-policy.test.mjs`) reads
 * `public/_headers`, which the Worker bundle never sees. This file
 * covers everything the Worker itself produces, and it does so through
 * `SELF.fetch` rather than by calling the policy functions directly:
 * only the real response carries the headers a browser or an edge
 * cache would actually read, and a unit test would happily pass on a
 * header the runtime seals or drops.
 *
 * What is pinned, class by class (the table itself lives in
 * `scripts/_cache-policy.mjs`, documented in
 * `docs/verification/perf/cache-headers-matrix.md`):
 *
 *   personal page   `/contact`      `no-cache`   no validator
 *   admin surface   `/admin/login`  `no-store`   no validator
 *   API JSON        `/api/v1/*`     `no-store`   no validator
 *   reaction image  `/api/v1/reaction-images/:id`  immutable 1 year
 *
 * The `/` and `/portfolio` routes are deliberately NOT probed here:
 * their loaders need the reactions / portfolio tables, and the policy
 * is decided from the path and the content type, not from a page's
 * data. `/contact` takes the identical branch `/` takes and needs no
 * fixture. The classes are what is under test, not the pages.
 *
 * `/admin*` and the admin redirect are asserted by
 * `test/integration/admin-routing.test.ts` and
 * `test/integration/html-cache-policy.test.ts`; the matrix rows here
 * re-assert the same values so the table and the behaviour cannot
 * drift apart.
 */

interface Observation {
	id: string;
	path: string;
	status: number | null;
	cacheControl: string | null;
	etag: string | null;
	vary: string | null;
}

async function observe(id: string, path: string): Promise<Observation> {
	const res = await SELF.fetch(`https://example.com${path}`, { redirect: 'manual' });
	return {
		id,
		path,
		status: res.status,
		cacheControl: res.headers.get('cache-control'),
		etag: res.headers.get('etag'),
		vary: res.headers.get('vary'),
	};
}

describe('response cache-policy matrix (Issue #484)', () => {
	it('a personal page is revalidated, never frozen', async () => {
		const observation = await observe('personal-page', '/contact');
		expect(observation.status).toBe(200);
		expect(evaluateObservation(observation)).toEqual({ ok: true, problems: [] });
		expect(observation.cacheControl).toBe(policyById('personal-page').cacheControl);
	});

	it('the admin surface is never stored', async () => {
		const observation = await observe('admin-page', '/admin/login');
		expect(observation.status).toBe(200);
		expect(evaluateObservation(observation)).toEqual({ ok: true, problems: [] });
		expect(observation.cacheControl).toBe(policyById('admin-page').cacheControl);
	});

	it('the anonymous /admin redirect is never stored either', async () => {
		// The F2 regression from Issue #291 in matrix form: a redirect has
		// no content-type, and the admin rule is decided by path alone.
		const observation = await observe('admin-page', '/admin');
		expect(observation.status).toBeGreaterThanOrEqual(300);
		expect(observation.status).toBeLessThan(400);
		expect(observation.cacheControl).toBe('no-store');
	});

	it('API JSON is never stored', async () => {
		const observation = await observe('api-json', '/api/v1/health');
		expect(observation.status).toBe(200);
		expect(evaluateObservation(observation)).toEqual({ ok: true, problems: [] });
	});

	it('a rejected API call is never stored', async () => {
		// `/api/v1/reactions` without an API key answers 401. An error
		// envelope is just as per-caller as a success payload, and before
		// Issue #484 it carried no policy at all.
		const observation = await observe('api-json', '/api/v1/reactions?target=home-page');
		expect(observation.status).toBe(401);
		expect(observation.cacheControl).toBe('no-store');
		expect(observation.etag).toBeNull();
	});

	it('an unknown API path is never stored', async () => {
		const observation = await observe('api-json', '/api/v1/definitely-not-a-route');
		expect(observation.status).toBe(404);
		expect(observation.cacheControl).toBe('no-store');
	});

	it('the matrix policy for reaction images matches the source constant', async () => {
		// The 200-with-bytes path needs a migrated D1 and an R2 object, so
		// the router-level assertion lives in
		// `test/integration/reactions-images.test.ts`, where that fixture
		// already exists. What is checked here is the link that would let
		// the two halves describe different worlds: the table, the R2
		// metadata and the response header must be one value.
		expect(policyById('reaction-image').cacheControl).toBe(REACTION_IMAGE_CACHE_CONTROL);
	});

	it('a Worker-generated response never offers a validator', async () => {
		// `no-cache` + `no-store` responses have no ETag on purpose. An
		// ETag here would advertise "ask me if this is still right" for a
		// body that is different for every visitor (hit counter digits,
		// this visitor's own reactions) — a validator nobody may compare.
		for (const path of ['/contact', '/admin/login', '/api/v1/health']) {
			const res = await SELF.fetch(`https://example.com${path}`, { redirect: 'manual' });
			expect(res.headers.get('etag'), `${path} must not carry an ETag`).toBeNull();
		}
	});

	it('acceptance criterion 1: immutable assets and personal pages differ', async () => {
		// The static half of the same invariant, asserted from the Worker
		// side: nothing the Worker emits may claim the asset policy, and
		// the asset policy must stay unique to the asset row.
		expect(separationViolations()).toEqual([]);

		const assetPolicy = policyById('immutable-build-asset').cacheControl;
		for (const row of CACHE_POLICY_MATRIX) {
			if (row.id === 'immutable-build-asset') continue;
			expect(row.cacheControl, `${row.id} must not reuse the immutable asset policy`).not.toBe(
				assetPolicy,
			);
		}

		for (const path of ['/contact', '/admin/login', '/api/v1/health']) {
			const res = await SELF.fetch(`https://example.com${path}`, { redirect: 'manual' });
			expect(res.headers.get('cache-control')).not.toBe(assetPolicy);
		}
	});
});
