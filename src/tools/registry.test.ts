import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { classifyToolFrameSrc, evaluateToolEmbedPolicy, toEmbedSubject } from './embed-policy';
import {
	getPublicTool,
	getTool,
	listAllTools,
	listPublicTools,
	listTools,
	parseGrantedPermissions,
	toolRouteSecurityPolicy,
} from './registry';

/**
 * Tool Registry — contract tests (Issue #80).
 *
 * The registry is the canonical host-side data source for the
 * `/tools` index page and the `/tools/<slug>` iframe route. The
 * contract is:
 *
 *   1. `listAllTools()` / `listTools()` returns every entry in the manifest.
 *   2. `getTool(slug)` returns the matching entry, or undefined.
 *   3. `listPublicTools()` returns ONLY entries whose
 *      `delivery.kind` is `same_origin_static` or `external_exception`.
 *   4. `host_disabled` and `not_integrable_yet` Tools are NEVER
 *      in the public list — the iframe shell can only mount an
 *      embeddable Tool. They ARE in `listAllTools()` per #195
 *      (show-all policy for the `/tools` index page).
 *   5. `getPublicTool(slug)` matches `getTool(slug)` for any public
 *      Tool, and returns undefined for a non-public Tool.
 *
 * The tests run against the live manifest (`src/tools/manifest.json`).
 * They are the contract — if any of them fails, the registry is wrong.
 */

describe('Tool Registry — listTools / getTool', () => {
	it('returns all 15 Tools known to the manifest', () => {
		assert.equal(listTools().length, 15);
	});

	it('returns all 15 Tools known to the manifest (listAllTools alias)', () => {
		// Issue #195: listAllTools() is the canonical show-all surface.
		// listTools() is retained as an alias so existing callers keep
		// compiling; both MUST return the same count.
		assert.equal(listAllTools().length, 15);
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
			// Issue #498: the declared third-party contacts are part of
			// the public summary on purpose — the consent notice renders
			// them, and the visitor has to be able to read what the page
			// will contact. `basis` stays inside the manifest: it is
			// review metadata, not visitor copy.
			'privacy',
			'slug',
		]);
	});

	it('ProtoType summary carries the declared third-party contacts', () => {
		const summary = getPublicTool('prototype');
		assert.ok(summary);
		// The declaration, not a derived guess: the route renders exactly
		// what the manifest says the Tool may contact.
		assert.deepEqual(summary?.privacy?.third_party_origins, [
			'https://fonts.googleapis.com',
			'https://fonts.gstatic.com',
			'https://script.google.com',
			'https://use.typekit.net',
		]);
	});

	it('a Tool that declares no contact carries the declaration, not its absence', () => {
		const summary = getPublicTool('readmark');
		assert.ok(summary);
		assert.deepEqual(summary?.privacy?.third_party_origins, []);
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
	it('every public Tool has a non-empty, origin-safe entry_html', () => {
		const publicTools = listPublicTools();
		// The registry contract holds whether the manifest currently
		// exposes any Tools or not (the #80 baseline exposes zero).
		// The invariant is what the contract guarantees, not the
		// current count.
		//
		// Issue #465 replaced the old "must start with '/'" assertion
		// with the origin classification the embed policy uses: a
		// `same_origin_static` Tool MUST be a root-relative path
		// (host origin), an `external_exception` Tool may be an https
		// URL, and a protocol-relative `//host/...` src is never
		// acceptable — it reads like a path and is not one.
		for (const tool of publicTools) {
			assert.ok(
				tool.entry_html.length > 0,
				`public Tool ${tool.slug} has empty entry_html — would 404 the iframe`,
			);
			const origin = classifyToolFrameSrc(tool.entry_html);
			assert.ok(
				origin === 'same-origin' || origin === 'cross-origin',
				`public Tool ${tool.slug} entry_html "${tool.entry_html}" is neither a root-relative path nor an http(s) URL`,
			);
			assert.ok(
				!tool.entry_html.startsWith('//'),
				`public Tool ${tool.slug} entry_html must not be protocol-relative`,
			);
		}
	});

	it('every public Tool satisfies the embed policy (Issue #465)', () => {
		// The route fails closed on a policy violation, so a public
		// Tool that violates it would render the "blocked" placeholder
		// instead of the iframe the index page links to.
		for (const tool of listPublicTools()) {
			const entry = getTool(tool.slug);
			assert.ok(entry, `public Tool ${tool.slug} must exist in the manifest`);
			const violations = evaluateToolEmbedPolicy(toEmbedSubject(tool.slug, entry?.delivery ?? {}));
			assert.deepEqual(
				violations.map((v) => v.code),
				[],
				`public Tool ${tool.slug} violates the embed policy`,
			);
		}
	});
});

describe('Tool Registry — listAllTools / show-all policy', () => {
	// Issue #195 (2026-09-29) flipped the `/tools` index page to list
	// every manifest entry, not just the embeddable subset. `host_disabled`
	// Tools now render with a "Coming soon" placeholder rather than
	// being silently omitted from the index.
	it('listAllTools() returns all 15 entries', () => {
		assert.equal(listAllTools().length, 15);
	});

	it('listAllTools() includes both embeddable and host_disabled Tools', () => {
		const kinds = new Set(listAllTools().map((t) => t.delivery.kind));
		// show-all means at least one entry of each surface kind.
		assert.ok(kinds.has('same_origin_static'), 'show-all must include same_origin_static Tools');
		assert.ok(kinds.has('host_disabled'), 'show-all must include host_disabled Tools');
	});

	it('host_disabled Tools carry a non-empty disabled_reason via listAllTools()', () => {
		// The index page and `/tools/<slug>` placeholder need
		// `disabled_reason` to render the "Coming soon" copy. The
		// field is on the manifest entry itself, so `getTool()` (and
		// by extension `listAllTools()`) carries it through unchanged.
		const hostDisabled = listAllTools().filter((t) => t.delivery.kind === 'host_disabled');
		assert.ok(hostDisabled.length > 0, 'expected at least one host_disabled Tool');
		for (const tool of hostDisabled) {
			if (tool.delivery.kind === 'host_disabled') {
				assert.ok(
					typeof tool.delivery.disabled_reason === 'string' &&
						tool.delivery.disabled_reason.length > 0,
					`host_disabled Tool ${tool.slug} must carry a non-empty disabled_reason`,
				);
			}
		}
	});

	it('listPublicTools() is unchanged (still embeddable-only)', () => {
		// The iframe shell route still consumes listPublicTools().
		// #195 only flipped the /tools INDEX page; the embeddable
		// surface must remain filtered.
		const publicKinds = new Set(listPublicTools().map((t) => t.classification));
		for (const kind of publicKinds) {
			assert.ok(
				kind === 'same_origin_static' || kind === 'external_exception',
				`public Tool classification ${kind} must not be in listPublicTools()`,
			);
		}
		// Sanity: there must be FEWER public Tools than total — otherwise
		// the show-all flip is a no-op.
		assert.ok(
			listPublicTools().length < listAllTools().length,
			'listPublicTools() must be a strict subset of listAllTools() for #195 to be meaningful',
		);
	});

	it('readmark is a same_origin_static entry in listAllTools()', () => {
		// Issue #195 also adds readmark as a same_origin_static Tool.
		const readmark = getTool('readmark');
		assert.ok(readmark, 'readmark must be present');
		assert.equal(readmark?.delivery.kind, 'same_origin_static');
	});
});

describe('Tool Registry — per-path security policy (Issue #449)', () => {
	// The manifest is where a Tool declares the browser capabilities it
	// needs; the host decides how to grant them. These tests pin the
	// resolution half so a Tool grant cannot leak onto another route
	// and so the microphone Tool keeps its grant while it is still
	// `host_disabled`.

	it('grants microphone on the mic-level shell route', () => {
		const policy = toolRouteSecurityPolicy('/tools/mic-level');
		assert.deepEqual(policy?.grantedPermissions, ['microphone']);
		// The shell is a host document: keep the host Referrer-Policy.
		assert.equal(policy?.referrerPolicy, undefined);
	});

	it('grants microphone on the mic-level artifact path too', () => {
		// Forward-looking half of the grant: Static Assets serves this
		// path, but the resolver must answer the same question for it so
		// `public/_headers` and the Worker cannot disagree.
		const policy = toolRouteSecurityPolicy('/tools/mic-level/app/index.html');
		assert.deepEqual(policy?.grantedPermissions, ['microphone']);
		assert.equal(policy?.referrerPolicy, 'no-referrer');
	});

	it('leaves a Tool with no declared grant untouched', () => {
		assert.equal(toolRouteSecurityPolicy('/tools/prototype'), undefined);
		assert.equal(
			toolRouteSecurityPolicy('/tools/prototype/app/index.html')?.grantedPermissions?.length,
			0,
		);
	});

	it('uses the artifact referrer_policy for a served Tool artifact', () => {
		const policy = toolRouteSecurityPolicy('/tools/prototype/app/assets/index.js');
		assert.equal(policy?.referrerPolicy, 'no-referrer');
		assert.deepEqual(policy?.grantedPermissions, []);
	});

	it('never grants anything on an unrelated path', () => {
		for (const path of ['/', '/contact', '/admin/keys', '/api/v1/health', '/share/procon2026/']) {
			assert.equal(
				toolRouteSecurityPolicy(path),
				undefined,
				`${path} must not inherit a Tool policy`,
			);
		}
	});

	it('does not let a lookalike slug inherit a grant', () => {
		// `/tools/mic-level-2` is not `mic-level`; the shell match is
		// exact-segment, mirroring the Worker's exact-prefix-or-/ guard.
		assert.equal(toolRouteSecurityPolicy('/tools/mic-level-2'), undefined);
		assert.equal(toolRouteSecurityPolicy('/toolsfoo/mic-level'), undefined);
	});

	it('parseGrantedPermissions splits feature names and drops empties', () => {
		assert.deepEqual(parseGrantedPermissions('microphone'), ['microphone']);
		assert.deepEqual(parseGrantedPermissions('  microphone   camera '), ['microphone', 'camera']);
		assert.deepEqual(parseGrantedPermissions(''), []);
		assert.deepEqual(parseGrantedPermissions(undefined), []);
	});

	it('exposes the grant to the iframe shell route consumer', () => {
		// `PublicToolSummary.iframe.allow` is what the route turns into
		// `<iframe allow=...>`. Issue #465 keeps it optional so the route
		// renders no attribute at all when the manifest declares none.
		assert.equal(getPublicTool('prototype')?.iframe.allow, undefined);
	});
});
