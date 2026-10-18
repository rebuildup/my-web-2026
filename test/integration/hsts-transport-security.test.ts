/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * HTTPS delivery / HSTS contract (Issue #446).
 *
 * These tests drive the real Worker through `SELF.fetch` because the
 * header is applied in the Worker entry (`src/server.ts`), after the
 * dispatch decision and before the response leaves the isolate. A unit
 * test on the policy function would not catch a branch that skipped
 * applying it, nor a header the runtime refuses to attach.
 *
 * The literal below is the shipped contract, restated so that a
 * change to `src/server.ts` fails here instead of silently redefining
 * the policy. `scripts/check-hsts-policy.mjs` requires the two to stay
 * byte-identical (and rejects `includeSubDomains` / `preload` in
 * either), so this file cannot drift away from the runtime.
 *
 * Nothing in this file reads a secret or reaches a real Cloudflare
 * resource: the pool's bindings are the test-only dummies described
 * in `vitest.config.ts`, and `/api/v1/health` touches no binding at
 * all.
 */

const HSTS_HEADER = 'strict-transport-security';

/** Intended value — must equal `HSTS_DIRECTIVE` in `src/server.ts`. */
const INTENDED_DIRECTIVE = 'max-age=31536000';

/** Directives that must stay off until the per-subdomain audit lands. */
const FORBIDDEN_DIRECTIVES = ['includesubdomains', 'preload'];

interface Observed {
	status: number;
	contentType: string | null;
	/** Every `strict-transport-security` header value, in order. */
	values: string[];
}

/**
 * Count header values rather than reading one: two `Strict-Transport-
 * Security` headers combine into a comma-separated list in some
 * clients, which is a different policy from the one we ship.
 */
function observe(url: string): Promise<Observed> {
	return SELF.fetch(url, { redirect: 'manual' }).then((res) => ({
		status: res.status,
		contentType: res.headers.get('content-type'),
		values: [...res.headers]
			.filter(([name]) => name.toLowerCase() === HSTS_HEADER)
			.map(([, value]) => value),
	}));
}

const SURFACES = [
	// SSR document (loader-free route; see html-cache-policy.test.ts for
	// why `/contact` and not `/`).
	'https://rebuildup.test/contact',
	// External Hono boundary — proves the policy is applied on the
	// branch that bypasses the TanStack Start pipeline.
	'https://rebuildup.test/api/v1/health',
	// Auth redirect (no body, no content-type) — the redirect shape is
	// exactly the one a transport policy is easy to miss.
	'https://rebuildup.test/admin',
];

describe('HTTPS delivery — positive case (Issue #446)', () => {
	it.each(SURFACES)('https %s carries the intended HSTS directive', async (url) => {
		const observed = await observe(url);
		expect(observed.values).toEqual([INTENDED_DIRECTIVE]);
	});

	it('covers a document and a JSON response on different dispatch branches', async () => {
		// One assertion per branch, stated separately so a failure names
		// which side stopped carrying the header.
		const document = await observe(SURFACES[0]);
		const api = await observe(SURFACES[1]);
		expect(document.contentType).toContain('text/html');
		expect(api.contentType).toContain('application/json');
		expect(document.values).toHaveLength(1);
		expect(api.values).toHaveLength(1);
	});
});

describe('HTTPS delivery — negative case (Issue #446)', () => {
	it.each([
		['SSR document', 'http://rebuildup.test/contact'],
		['external boundary', 'http://rebuildup.test/api/v1/health'],
	])('a plaintext http request to the %s carries no HSTS header', async (_label, url) => {
		// RFC 6797 §7.2: a user agent MUST ignore an HSTS header received
		// over insecure transport. Emitting one here would be inert, and
		// its presence would read as "HTTPS is configured" for a
		// plaintext response that proves nothing.
		const observed = await observe(url);
		expect(observed.values).toEqual([]);
	});

	it.each(SURFACES)('https %s carries neither includeSubDomains nor preload', async (url) => {
		// The negative half of the Issue's constraint: the policy is
		// deliberately host-scoped. `includeSubDomains` would extend it
		// to hostnames this repository cannot verify
		// (`media.rebuildup.dev`, and any subdomain added later), and
		// `preload` is a months-long commitment.
		for (const value of (await observe(url)).values) {
			const directives = value
				.toLowerCase()
				.split(';')
				.map((part) => part.trim());
			for (const forbidden of FORBIDDEN_DIRECTIVES) {
				expect(directives).not.toContain(forbidden);
			}
			expect(directives).toContain(INTENDED_DIRECTIVE);
		}
	});
});
