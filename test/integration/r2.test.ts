import { SELF } from 'cloudflare:test';
/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { describe, expect, it } from 'vitest';

/**
 * R2 binding SELF smoke for my-web-2026.
 *
 * Runs in the `integration` project (workerd via
 * `@cloudflare/vitest-plugin`). We probe a non-existent key
 * (`probe`) and assert that the bucket is reachable: the handler
 * surfaces 404 with `status: 'key_not_found'`, which is the canonical
 * "bucket reachable, key absent" signal from R2.
 *
 * Acceptance: /api/v1/media/ping returns 404 with `status: 'key_not_found'`.
 */
describe('R2 binding smoke', () => {
	it('responds to /api/v1/media/ping with key_not_found', async () => {
		const res = await SELF.fetch('https://example.com/api/v1/media/ping');
		expect(res.status).toBe(404);
		const body = (await res.json()) as { status: string; binding: string };
		expect(body.binding).toBe('r2');
		expect(body.status).toBe('key_not_found');
	});
});
