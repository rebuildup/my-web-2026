import { describe, expect, it } from 'vitest';
import { externalBoundary } from '../hono.ts';

/**
 * `/integrations/*` is dispatched to the external HTTP boundary
 * (`src/server.ts`), but **nothing is mounted there** — by design
 * (Issue #464).
 *
 * The adapter in `src/http/integrations/scope-review.ts` answers "may
 * this granted token be used, and if not, why". It does not, by itself,
 * make a public entry point safe: no token store exists, no OAuth client
 * id / secret is registered in Infisical or `wrangler*.jsonc#secrets.required`,
 * and `quality/integration-scope.json#allowlist.entries` is empty because
 * the **owner** has not approved any candidate for automatic
 * publication.
 *
 * So this file pins the *absence*. Even a perfectly-scoped, fresh,
 * fully-consented grant gets `404`. A future ticket that promotes a
 * candidate must change this test in the same PR, add the owner
 * allowlist entry it relies on, and keep every refusal reason in
 * `docs/security/integration-token-scope.md` — which is the point. If a
 * connection endpoint can appear without anyone reading this file, the
 * guard is decoration.
 */
describe('third-party integration entry point is not published (Issue #464)', () => {
	it('answers 404 for an OAuth callback posted to /integrations', async () => {
		const res = await externalBoundary.request(
			'/integrations/github/callback',
			{
				method: 'POST',
				body: '{"code":"local-fixture-code","state":"local-fixture-state"}',
				headers: { 'content-type': 'application/json' },
			},
			{} as Env,
		);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'not_found', path: '/integrations/github/callback' });
	});

	it('answers 404 for every connection path shape', async () => {
		for (const path of [
			'/integrations',
			'/integrations/',
			'/integrations/notion',
			'/integrations/discord/token',
			'/integrations/github/callback',
		]) {
			const res = await externalBoundary.request(
				path,
				{ method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } },
				{} as Env,
			);
			expect(res.status, path).toBe(404);
		}
	});

	it('answers 404 for a GET on the integration prefix', async () => {
		const res = await externalBoundary.request('/integrations/github/status', undefined, {} as Env);
		expect(res.status).toBe(404);
	});

	it('never turns a token exchange into a success response', async () => {
		// The negative assertion is what fails if someone mounts a handler
		// that accepts a grant without running the least-privilege review —
		// the acceptance criterion "do not publish the entry point by
		// skipping the security guarantee".
		const res = await externalBoundary.request(
			'/integrations/github/callback',
			{
				method: 'POST',
				body: '{"access_token":"local-fixture-not-a-credential","scope":"repo"}',
				headers: { 'content-type': 'application/json' },
			},
			{} as Env,
		);
		expect(res.status).toBeGreaterThanOrEqual(400);
	});
});
