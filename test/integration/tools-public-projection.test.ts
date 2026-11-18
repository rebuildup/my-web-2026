/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import manifest from '../../src/tools/manifest.json';

/**
 * Public projection boundary for the Tool Registry (Issue #1005).
 *
 * `src/tools/manifest.json` is operator data: repository URLs, pinned
 * SHAs, submodule paths, build commands, `notes` provenance and
 * `delivery.privacy.basis` all name internals a visitor cannot act on.
 * The public reads go through `src/tools/public.ts` server functions,
 * which return narrow projections — but a projection is only a promise
 * until the serialized `$_TSR` payload proves it. This test fetches the
 * real Worker documents for `/tools` and every `/tools/<slug>` and
 * asserts that no manifest-internal field name or value appears in the
 * HTML a visitor (or a scraper) receives.
 *
 * Allowed keys (`entry_html`, `iframe`, `privacy`, `classification`,
 * `license`, `host_message`) are part of `PublicToolSummary` and are
 * deliberately NOT in the forbidden list.
 */
const WORKER = 'https://example.com';

/** Manifest fields that must never serialize to a visitor. */
const FORBIDDEN_KEYS = [
	'"canonical_repo"',
	'"submodule_path"',
	'"pinned_sha"',
	'"disabled_reason"',
	'"artifact_path"',
	'"notes"',
	'"build"',
	'"source"',
	'"delivery"',
	'"basis"',
] as const;

interface ManifestDelivery {
	readonly kind: string;
	readonly disabled_reason?: string;
}

interface ManifestTool {
	readonly slug: string;
	readonly source?: {
		readonly canonical_repo?: string;
		readonly submodule_path?: string;
		readonly pinned_sha?: string;
	};
	readonly delivery: ManifestDelivery;
	readonly notes?: string;
}

const tools = manifest.tools as readonly ManifestTool[];

/** Every string value under a manifest-internal field, per Tool. */
function internalValues(tool: ManifestTool): string[] {
	const values: string[] = [];
	const source = tool.source;
	if (source) {
		for (const key of ['canonical_repo', 'submodule_path', 'pinned_sha'] as const) {
			const value = source[key];
			if (typeof value === 'string' && value.length > 0) values.push(value);
		}
	}
	if (tool.delivery.disabled_reason) values.push(tool.delivery.disabled_reason);
	if (tool.notes) values.push(tool.notes);
	return values;
}

describe('/tools public projection — manifest internals stay server-side', () => {
	it('the /tools index serializes no manifest-internal field', async () => {
		const response = await SELF.fetch(`${WORKER}/tools`, { redirect: 'manual' });
		expect(response.status).toBe(200);
		const html = await response.text();
		for (const key of FORBIDDEN_KEYS) {
			expect(html, `index payload leaked ${key}`).not.toContain(key);
		}
		for (const tool of tools) {
			for (const value of internalValues(tool)) {
				expect(html, `index payload leaked a ${tool.slug} internal value`).not.toContain(value);
			}
		}
	});

	for (const tool of tools) {
		it(`/tools/${tool.slug} serializes no manifest-internal field`, async () => {
			const response = await SELF.fetch(`${WORKER}/tools/${tool.slug}`, {
				redirect: 'manual',
			});
			expect(response.status).toBe(200);
			const html = await response.text();
			for (const key of FORBIDDEN_KEYS) {
				expect(html, `${tool.slug} payload leaked ${key}`).not.toContain(key);
			}
			for (const value of internalValues(tool)) {
				expect(html, `${tool.slug} payload leaked an internal value`).not.toContain(value);
			}
		});
	}
});
