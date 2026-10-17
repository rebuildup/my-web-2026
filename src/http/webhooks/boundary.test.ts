import { describe, expect, it } from 'vitest';
import { externalBoundary } from '../hono.ts';
import { signWebhookPayload } from './signature.ts';

/**
 * `/webhooks/*` is dispatched to the external HTTP boundary
 * (`src/server.ts`), but **nothing is mounted there** — by design
 * (Issue #463).
 *
 * The adapter in `src/http/webhooks/signature.ts` exists so the first
 * sender (GitHub, or a CMS later) has a reviewed answer for signature,
 * freshness, and replay. It does not, by itself, make a public entry
 * point safe: the replay store is per-isolate, and no HMAC key is
 * registered in Infisical / `wrangler*.jsonc#secrets.required` yet.
 *
 * So this file pins the *absence*: even a perfectly signed, fresh,
 * never-seen delivery gets `404`. A future ticket that promotes the
 * route must change this test in the same PR — which is the point. If
 * the route can appear without anyone reading this file, the guard is
 * decoration.
 */
describe('inbound webhook entry point is not published (Issue #463)', () => {
	const timestamp = '1767225600';
	const secret = 'boundary-test-hmac-key-not-a-credential';

	it('answers 404 for a POST to /webhooks/github', async () => {
		const signature = await signWebhookPayload({ secret, timestamp, body: '{"zen":"x"}' });
		const res = await externalBoundary.request(
			'/webhooks/github',
			{
				method: 'POST',
				body: '{"zen":"x"}',
				headers: {
					'content-type': 'application/json',
					'x-hub-signature-256': signature,
					'x-hub-request-timestamp': timestamp,
					'x-github-delivery': 'delivery-404-probe',
				},
			},
			{} as Env,
		);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'not_found', path: '/webhooks/github' });
	});

	it('answers 404 for an unsigned POST to any webhook path', async () => {
		for (const path of [
			'/webhooks',
			'/webhooks/',
			'/webhooks/cms/publish',
			'/webhooks/github/ping',
		]) {
			const res = await externalBoundary.request(
				path,
				{ method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } },
				{} as Env,
			);
			expect(res.status, path).toBe(404);
		}
	});

	it('answers 404 for a GET on the webhook prefix', async () => {
		const res = await externalBoundary.request('/webhooks/github', undefined, {} as Env);
		expect(res.status).toBe(404);
	});

	it('never turns a webhook request into a success response', async () => {
		// A 404 from the notFound handler is the contract. The negative
		// assertion is what fails if someone mounts a handler that forgets
		// to reject unsigned payloads — the acceptance criterion "do not
		// publish the entry point without the security guarantees".
		const res = await externalBoundary.request(
			'/webhooks/github',
			{ method: 'POST', body: '{"zen":"x"}' },
			{} as Env,
		);
		expect(res.status).toBeGreaterThanOrEqual(400);
	});
});
