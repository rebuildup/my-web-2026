/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { signWebhookPayload } from '../../src/http/webhooks/signature.ts';

/**
 * Worker-level proof that no inbound webhook entry point is published
 * (Issue #463).
 *
 * `src/http/webhooks/boundary.test.ts` asserts the same 404 against the
 * Hono app directly. This file drives the real Worker through
 * `SELF.fetch`, which is the only layer that can catch a *routing*
 * regression: if `src/server.ts` ever stopped dispatching `/webhooks/*`
 * to the external boundary, or a TanStack Start route started answering
 * the path, the boundary-level test would keep passing while production
 * quietly exposed an unverified entry point.
 *
 * No production traffic is generated — the Worker runs in the local
 * workerd pool, and the request below carries a locally computed
 * fixture signature.
 */
describe('inbound webhook entry point through the real Worker (Issue #463)', () => {
	it('answers 404 for a correctly signed, never-seen delivery', async () => {
		const body = '{"entry":{"id":"entry-4711"},"action":"published"}';
		const signature = await signWebhookPayload({
			// Local fixture key. Not a credential: it exists only so this
			// request is *shaped* like a genuine delivery — GitHub signs
			// the raw body and sends no timestamp header.
			secret: 'self-test-hmac-key-not-a-credential',
			body,
		});

		const res = await SELF.fetch('https://example.com/webhooks/github', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-hub-signature-256': signature,
				'x-github-delivery': 'delivery-self-probe',
			},
			body,
		});

		expect(res.status).toBe(404);
		const payload = (await res.json()) as { error?: string };
		expect(payload.error).toBe('not_found');
	});

	it('never answers a webhook request with 2xx', async () => {
		for (const method of ['GET', 'POST']) {
			const res = await SELF.fetch('https://example.com/webhooks/cms', {
				method,
				headers: { 'content-type': 'application/json' },
				body: method === 'POST' ? '{}' : undefined,
			});
			expect(res.status, `${method} /webhooks/cms`).toBeGreaterThanOrEqual(400);
		}
	});
});
