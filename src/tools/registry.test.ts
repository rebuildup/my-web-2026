import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { getPublicTool, getTool, listPublicTools, listTools } from './registry';

/**
 * Tool Registry — contract tests (Issue #80).
 *
 * The registry is the canonical host-side data source for the
 * `/tools` index page and the `/tools/<slug>` iframe route. The
 * contract is:
 *
 *   1. `listTools()` returns every entry in the manifest.
 *   2. `getTool(slug)` returns the matching entry, or undefined.
 *   3. `listPublicTools()` returns ONLY entries whose
 *      `delivery.kind` is `same_origin_static` or `external_exception`.
 *   4. `host_disabled` and `not_integrable_yet` Tools are NEVER
 *      in the public list — the brief forbids showing Tools that
 *      are not actually integrated.
 *   5. `getPublicTool(slug)` matches `getTool(slug)` for any public
 *      Tool, and returns undefined for a non-public Tool.
 *
 * The tests run against the live manifest (`src/tools/manifest.json`).
 * They are the contract — if any of them fails, the registry is wrong.
 */

describe('Tool Registry — listTools / getTool', () => {
	it('returns all 14 Tools known to the manifest', () => {
		assert.equal(listTools().length, 14);
	});

	it('returns the same Tool instance for a known slug', () => {
		const tool = getTool('prototype');
		assert.ok(tool);
		assert.equal(tool?.slug, 'prototype');
		assert.equal(tool?.display_name, 'ProtoType');
		// Issue #81 closure: ProtoType#4 (rebuildup/ProtoType PR #5)
		// landed the sandbox-safe storage layer + standalone CI + MIT
		// LICENSE, so the submodule pointer moved from 18e9252… (pre-#4)
		// to 335e0e8… (the merge commit of PR #5 on
		// `rebuildup/ProtoType@main`). Bump here in lock-step with
		// `src/tools/manifest.json`.
		assert.equal(tool?.source.pinned_sha, '335e0e861009049336e581dc266dc4e2f019e5c7');
	});

	it('returns undefined for an unknown slug', () => {
		assert.equal(getTool('does-not-exist'), undefined);
	});
});

describe('Tool Registry — public surface', () => {
	it('every entry in listPublicTools has a same_origin_static / external_exception delivery.kind', () => {
		const allowedKinds = new Set(['same_origin_static', 'external_exception']);
		for (const tool of listPublicTools()) {
			assert.ok(
				allowedKinds.has(getTool(tool.slug)?.delivery.kind ?? ''),
				`public Tool ${tool.slug} has a delivery.kind that must NOT be in listPublicTools`,
			);
		}
	});

	it('ProtoType (Issue #81 pilot) is in the public list', () => {
		// At end of #81, ProtoType is the only public Tool.
		// As Tool-side fixes land, more entries will graduate here.
		const publicSlugs = listPublicTools().map((t) => t.slug);
		assert.ok(publicSlugs.includes('prototype'));
	});

	it('host_disabled Tools never appear in listPublicTools', () => {
		// text-counter is currently host_disabled. If this fails, either
		// text-counter flipped to same_origin_static / external_exception
		// (and the test should be updated) or listPublicTools regressed.
		const publicSlugs = new Set(listPublicTools().map((t) => t.slug));
		assert.ok(!publicSlugs.has('text-counter'), 'text-counter is host_disabled');
	});

	it('ProtoType summary strips private fields', () => {
		const summary = getPublicTool('prototype');
		assert.ok(summary);
		const keys = Object.keys(summary).sort();
		assert.deepEqual(keys, [
			'classification',
			'description',
			'display_name',
			'entry_html',
			'iframe',
			'license',
			'slug',
		]);
	});

	it('ProtoType summary flattens delivery.iframe', () => {
		const summary = getPublicTool('prototype');
		assert.ok(summary);
		assert.equal(summary?.iframe.sandbox, 'allow-scripts');
		assert.equal(summary?.iframe.referrer_policy, 'no-referrer');
	});

	it('ProtoType summary carries the canonical /app/ entry_html', () => {
		const summary = getPublicTool('prototype');
		assert.ok(summary);
		// Per ADR-0006 §1: artefact namespace is /tools/<slug>/app/
		assert.equal(summary?.entry_html, '/tools/prototype/app/index.html');
	});

	it('returns undefined for a host_disabled slug', () => {
		assert.equal(getPublicTool('text-counter'), undefined);
	});

	it('returns undefined for an unknown slug', () => {
		assert.equal(getPublicTool('does-not-exist'), undefined);
	});
});

describe('Tool Registry — public surface invariants', () => {
	it('every public Tool has a non-empty absolute entry_html', () => {
		const publicTools = listPublicTools();
		// The registry contract holds whether the manifest currently
		// exposes any Tools or not (the #80 baseline exposes zero).
		// The invariant is what the contract guarantees, not the
		// current count.
		for (const tool of publicTools) {
			assert.ok(
				tool.entry_html.length > 0,
				`public Tool ${tool.slug} has empty entry_html — would 404 the iframe`,
			);
			assert.ok(
				tool.entry_html.startsWith('/'),
				`public Tool ${tool.slug} entry_html must be absolute (same-origin)`,
			);
		}
	});
});
