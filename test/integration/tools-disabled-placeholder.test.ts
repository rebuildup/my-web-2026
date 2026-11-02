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
	// Zero is a legitimate end state: Issue #817 wires every Tool to
	// `same_origin_static`, and the placeholder then has no live entry.
	// This assertion used to require at least one disabled Tool, which
	// would have turned the completion of #817 into a red test — a gate
	// that fires on success is a defect, not a guard. The loop below
	// exercises whatever the manifest holds, so a future disabled entry
	// is still covered without pinning the count.
	it('reads the host_disabled set from the manifest', () => {
		expect(Array.isArray(DISABLED_TOOLS)).toBe(true);
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
			// The manifest is imported as JSON, so the inferred element type
			// is a union of per-entry object shapes and narrowing on
			// `kind` does not reach `disabled_reason` once enough entries
			// are present. The filter above already established that this
			// entry is host_disabled, so read the field through its own
			// shape instead of widening the assertion.
			const reason = (tool.delivery as { disabled_reason?: unknown }).disabled_reason;
			if (typeof reason === 'string' && reason.length > 0) {
				expect(html).not.toContain(reason);
			}
		});
	}
});
