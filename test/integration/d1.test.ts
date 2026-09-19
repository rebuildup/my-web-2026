import { SELF } from 'cloudflare:test';
/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { describe, expect, it } from 'vitest';

/**
 * D1 binding SELF smoke for my-web-2026.
 *
 * Runs in the `integration` project (workerd via
 * `@cloudflare/vitest-plugin`). The `cloudflare:test` virtual module
 * exposes the Worker entrypoint through `SELF.fetch(request)` and
 * the bindings declared in `wrangler.jsonc` through helpers like
 * `applyD1Migrations`.
 *
 * Acceptance: /api/v1/db/ping returns 200 and the SELECT 1 row from
 * the D1 binding declared in `wrangler.jsonc`.
 */
describe('D1 binding smoke', () => {
	it('renders the internal D1 result through the home loader', async () => {
		const res = await SELF.fetch('https://example.com/');
		expect(res.status).toBe(200);
		const html = (await res.text()).replaceAll('<!-- -->', '');
		// The 0.2.0 home page renders the D1 status inside the system
		// status section as the row labelled "Internal data" with the
		// D1 binding tag and a "reachable" badge. Asserting on those
		// three tokens keeps the test stable across copy edits while
		// still verifying that the createServerFn probe ran on the
		// server during SSR.
		expect(html).toContain('Internal data');
		expect(html).toContain('D1');
		expect(html).toMatch(/Internal data[\s\S]*?D1[\s\S]*?>\s*reachable\s*</);
	});

	it('responds to /api/v1/db/ping with the binding result', async () => {
		const res = await SELF.fetch('https://example.com/api/v1/db/ping');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: string; binding: string; one: number | null };
		expect(body.binding).toBe('d1');
		expect(body.status).toBe('ok');
		expect(body.one).toBe(1);
	});
});
