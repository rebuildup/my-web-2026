/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { OUTBOUND_BLOCKED_STATUS } from '../../scripts/_vitest-outbound-policy.mjs';

/**
 * The test pool's outbound policy is WIRED (Issue #261).
 *
 * `scripts/_vitest-outbound-policy.test.mjs` proves the policy FUNCTION
 * answers a request with the blocked status; this file proves the pool
 * actually USES it. The two are different claims. Without this test,
 * deleting `outboundService: createOutboundPolicy()` from
 * `vitest.config.ts` leaves the suite green while it silently returns to
 * reaching the public internet — the regression the cold review found.
 *
 * The URL is TEST-NET-1 (`192.0.2.0/24`, RFC 5737), a range that is
 * guaranteed unroutable. The pool answers it before any host is
 * contacted, so a passing assertion is proof the request never left the
 * machine. With the wiring removed the same request cannot be answered
 * with the policy status.
 *
 * This file imports `SELF`, so `scripts/_vitest-warmup-scan.mjs` puts it
 * in the warm-up set and the pool is connected before the timed test.
 */
describe('test pool outbound policy (Issue #261)', () => {
	it('answers an outbound request with the blocked status', async () => {
		const res = await fetch('http://192.0.2.1/api/v1/reactions');

		expect(res.status).toBe(OUTBOUND_BLOCKED_STATUS);
		expect(await res.text()).toContain('blocked by the test pool');
	});

	it('keeps the worker itself reachable through SELF', async () => {
		const res = await SELF.fetch('https://example.com/api/v1/health');

		expect(res.status).toBe(200);
	});
});
