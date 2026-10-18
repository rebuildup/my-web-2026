import { SELF, applyD1Migrations, env } from 'cloudflare:test';
/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { beforeAll, describe, expect, it } from 'vitest';
import { REACTIONS_MIGRATIONS } from '../helpers/reactions-schema';

/**
 * D1 binding SELF smoke for my-web-2026.
 *
 * Runs in the `integration` project (workerd via
 * `@cloudflare/vitest-plugin`). The `cloudflare:test` virtual module
 * exposes the Worker entrypoint through `SELF.fetch(request)` and
 * the bindings declared in `wrangler.jsonc` through helpers like
 * `applyD1Migrations`.
 *
 * Schema bootstrap: the home route reads both `reactions` and
 * `reaction_emoji_catalog` through the reactions loader (Ticket G,
 * branch 39). These tables live in `migrations/0003_reactions.sql`
 * and `migrations/0004_emoji_catalog.sql` and must exist before the
 * home renders. The inline SQL lives in
 * `test/helpers/reactions-schema.ts` since Issue #487, so a second
 * suite can bootstrap the same tables without keeping a second
 * hand-maintained copy of the schema.
 *
 * The Better Auth schema is already applied by
 * `test/setup/better-auth-schema.ts`; access-counter tables are not
 * queried on the home route's read path (only hit/count via the
 * external API), so they are intentionally NOT bootstrapped here.
 *
 * `REACTIONS_MIGRATIONS` MUST stay byte-identical to the
 * corresponding `migrations/*.sql` files — workerd cannot
 * `fs.readFile` them.
 *
 * Acceptance: /api/v1/db/ping returns 200 and the SELECT 1 row from
 * the D1 binding declared in `wrangler.jsonc`.
 */
const D1 = () => env.DB;

beforeAll(async () => {
	await applyD1Migrations(D1(), REACTIONS_MIGRATIONS);
});

describe('D1 binding smoke', () => {
	it('renders the internal D1 result through the home loader', async () => {
		const res = await SELF.fetch('https://example.com/');
		expect(res.status).toBe(200);
		const html = (await res.text()).replaceAll('<!-- -->', '');
		// The home page renders the D1 status inside the system
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
