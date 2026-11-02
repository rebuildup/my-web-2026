/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import manifest from '../../src/tools/manifest.json';

/**
 * `/tools/<host_disabled_slug>` public copy boundary (Issue #836).
 *
 * `disabled_reason` is operator documentation: it names build facts
 * ("Next.js component library", branch names, package managers) that a
 * visitor cannot act on, and it was being rendered on the public
 * "coming soon" page. The public page may say what the Tool does
 * (`description_ja`) and that it is not available yet; it may not
 * leak the internal reason or an internal paraphrase of it.
 *
 * The assertion reads the real Worker document, not the component's
 * props, so a future refactor that re-introduces the field — or a new
 * host_disabled entry with the same shape — fails here.
 */
const WORKER = 'https://example.com';

const DISABLED_TOOLS = manifest.tools.filter((tool) => tool.delivery.kind === 'host_disabled');

describe('/tools/<slug> — host_disabled placeholder copy', () => {
	it('has at least one host_disabled Tool to exercise', () => {
		expect(DISABLED_TOOLS.length).toBeGreaterThan(0);
	});

	for (const tool of DISABLED_TOOLS) {
		it(`${tool.slug}: renders the public description and no internal reason`, async () => {
			const response = await SELF.fetch(`${WORKER}/tools/${tool.slug}`, {
				redirect: 'manual',
			});
			expect(response.status).toBe(200);
			const html = await response.text();

			// The visitor-facing description is present.
			expect(html).toContain(tool.description_ja);
			// The "coming soon" state is still communicated.
			expect(html).toContain('Coming soon');

			// Neither the internal reason nor the hook that carried it.
			expect(html).not.toContain('data-tool-disabled-reason');
			expect(html).not.toContain('Next.js component library');
			if (tool.delivery.kind === 'host_disabled') {
				expect(html).not.toContain(tool.delivery.disabled_reason);
			}
		});
	}
});
