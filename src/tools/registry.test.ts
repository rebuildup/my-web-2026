import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { classifyToolFrameSrc, evaluateToolEmbedPolicy, toEmbedSubject } from './embed-policy';
import {
	createToolRegistry,
	getPublicTool,
	getTool,
	listAllTools,
	listPublicTools,
	listTools,
	parseGrantedPermissions,
	toolRouteSecurityPolicy,
} from './registry';
import type { Manifest, ManifestTool } from './registry';

/**
 * Tool Registry — contract tests (Issue #80, re-scoped by Issue #861).
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
 * Issue #861 — where each half of that contract is verified:
 *
 *   - The "準備中（host_disabled）契約" is verified against a SYNTHETIC
 *     manifest, through `createToolRegistry()`. It must not depend on
 *     the shipped Tool set: the last waiting Tool
 *     (business-mail-block / history-quiz / ae-expression) is about to
 *     land, and a contract test that needs a waiting Tool to exist
 *     would turn the last landing PR red.
 *   - The SHIPPED manifest is asserted only on STRUCTURAL invariants
 *     (unique slugs, a non-empty `disabled_reason` on every waiting
 *     Tool, a non-empty Japanese description, embeddable kinds only in
 *     the public list) — never on a frozen count or a frozen slug.
 */

/**
 * One synthetic manifest entry.
 *
 * Deliberately minimal and deliberately NOT a copy of a shipped entry:
 * the point of the synthetic manifest is that it can hold a waiting
 * Tool (or not) whatever the shipped Tool set does.
 */
function syntheticTool(
	slug: string,
	delivery: ManifestTool['delivery'],
	overrides: Partial<ManifestTool> = {},
): ManifestTool {
	return {
		slug,
		display_name: slug,
		description_ja: `${slug} の合成描述。`,
		source: {
			canonical_repo: `https://github.com/rebuildup/tool-${slug}.git`,
			submodule_path: `external/${slug}`,
			pinned_sha: '0'.repeat(40),
			branch: 'main',
		},
		build: {
			command: 'bun install --frozen-lockfile && bun run build',
			output_dir: 'dist',
			package_manager: 'bun',
		},
		delivery,
		classification:
			delivery.kind === 'host_disabled' ? 'needs_tool_side_fix' : 'same_origin_static',
		license: 'MIT',
		...overrides,
	};
}

/** A manifest with one embeddable Tool and one waiting Tool. */
function manifestWithWaitingTool(): Manifest {
	return {
		version: 1,
		tools: [
			syntheticTool('served-tool', {
				kind: 'same_origin_static',
				artifact_path: '/tools/served-tool/app',
				entry_html: '/tools/served-tool/app/index.html',
				iframe: { referrer_policy: 'no-referrer' },
			}),
			syntheticTool('waiting-tool', {
				kind: 'host_disabled',
				disabled_reason: 'standalone build が上流にまだ無い。',
			}),
		],
	};
}

/** A manifest with no waiting Tool at all. */
function manifestWithoutWaitingTool(): Manifest {
	return {
		version: 1,
		tools: [
			syntheticTool('served-tool', {
				kind: 'same_origin_static',
				artifact_path: '/tools/served-tool/app',
				entry_html: '/tools/served-tool/app/index.html',
				iframe: { referrer_policy: 'no-referrer' },
			}),
		],
	};
}

describe('Tool Registry — createToolRegistry (Issue #861)', () => {
	it('answers from the manifest it was given, not from the shipped one', () => {
		const registry = createToolRegistry(manifestWithWaitingTool());
		assert.deepEqual(
			registry.listAllTools().map((t) => t.slug),
			['served-tool', 'waiting-tool'],
		);
		assert.equal(registry.getTool('prototype'), undefined);
	});

	it('leaves the shipped registry untouched', () => {
		const before = listAllTools().map((t) => t.slug);
		createToolRegistry(manifestWithWaitingTool());
		createToolRegistry(manifestWithoutWaitingTool());
		assert.deepEqual(
			listAllTools().map((t) => t.slug),
			before,
			'a synthetic registry must not mutate the shipped one',
		);
	});

	it('resolves the per-path security policy against its own manifest', () => {
		const registry = createToolRegistry({
			version: 1,
			tools: [
				syntheticTool('granted-tool', {
					kind: 'host_disabled',
					disabled_reason: 'まだ無い。',
					iframe: { referrer_policy: 'no-referrer', allow: 'microphone' },
				}),
			],
		});
		assert.deepEqual(registry.toolRouteSecurityPolicy('/tools/granted-tool')?.grantedPermissions, [
			'microphone',
		]);
		assert.equal(registry.toolRouteSecurityPolicy('/tools/prototype'), undefined);
	});
});

describe('Tool Registry — listTools / getTool', () => {
	it('returns every Tool the shipped manifest knows', () => {
		// Issue #861: the COUNT is not a contract — a Tool landing
		// changes it — so the assertion is the shape, not the number.
		assert.ok(listTools().length > 0, 'the shipped manifest must expose at least one Tool');
	});

	it('returns every Tool the shipped manifest knows (listAllTools alias)', () => {
		// Issue #195: listAllTools() is the canonical show-all surface.
		// listTools() is retained as an alias so existing callers keep
		// compiling; both MUST return the same set.
		assert.deepEqual(
			listTools().map((t) => t.slug),
			listAllTools().map((t) => t.slug),
		);
	});

	it('returns the same Tool instance for a known slug', () => {
		const tool = getTool('prototype');
		assert.ok(tool);
		assert.equal(tool?.slug, 'prototype');
		assert.equal(tool?.display_name, 'ProtoType');
		// Issue #861: the exact pin is SHIPPED DATA, not a contract — it
		// moves whenever the Tool is re-pinned (Issue #817 moved four of
		// them). The structural fact is that a pin is a full commit SHA.
		assert.match(
			tool?.source.pinned_sha ?? '',
			/^[0-9a-f]{40}$/,
			'prototype must carry a full 40-char commit SHA',
		);
	});

	it('returns undefined for an unknown slug', () => {
		assert.equal(getTool('does-not-exist'), undefined);
	});

	it('every Tool carries a non-empty Japanese description (Issue #785)', () => {
		// The /tools index renders `description_ja` for every entry,
		// including the host_disabled ones, so a missing value is an
		// unexplained row rather than a cosmetic gap.
		for (const tool of listAllTools()) {
			assert.equal(
				typeof tool.description_ja,
				'string',
				`${tool.slug}: description_ja must be a string`,
			);
			assert.ok(
				tool.description_ja.trim().length > 0,
				`${tool.slug}: description_ja must not be empty`,
			);
		}
	});

	it('every shipped slug is unique (Issue #861)', () => {
		const slugs = listAllTools().map((t) => t.slug);
		assert.equal(new Set(slugs).size, slugs.length, 'two manifest entries share one slug');
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
		// Issue #861: the contract is stated against a SYNTHETIC manifest
		// that holds a waiting Tool, so it does not depend on the shipped
		// Tool set (whose last waiting Tool is about to land).
		const registry = createToolRegistry(manifestWithWaitingTool());
		const publicSlugs = new Set(registry.listPublicTools().map((t) => t.slug));
		const disabled = registry.listAllTools().filter((t) => t.delivery.kind === 'host_disabled');
		assert.ok(disabled.length > 0, 'the synthetic fixture must hold one waiting Tool');
		for (const tool of disabled) {
			assert.ok(!publicSlugs.has(tool.slug), `${tool.slug} is host_disabled`);
		}
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
			// the public summary on purpose — the visitor has to be able
			// to read what the page will contact. `basis` stays inside
			// the manifest: it is review metadata, not visitor copy.
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

	it('ProtoType summary flattens delivery.iframe without a sandbox (ADR-0020)', () => {
		const summary = getPublicTool('prototype');
		assert.ok(summary);
		assert.equal(summary?.iframe.sandbox, undefined);
		assert.equal(summary?.iframe.referrer_policy, 'no-referrer');
	});

	it('ProtoType summary carries the canonical /app/ entry_html', () => {
		const summary = getPublicTool('prototype');
		assert.ok(summary);
		// Per ADR-0006 §1: artefact namespace is /tools/<slug>/app/
		assert.equal(summary?.entry_html, '/tools/prototype/app/index.html');
	});

	it('returns undefined for a host_disabled slug', () => {
		// Issue #861: stated against the synthetic manifest, so the
		// contract holds whether or not the shipped set still waits.
		const registry = createToolRegistry(manifestWithWaitingTool());
		const disabled = registry.listAllTools().find((t) => t.delivery.kind === 'host_disabled');
		assert.ok(disabled, 'the synthetic fixture must hold one waiting Tool');
		assert.equal(registry.getPublicTool(disabled.slug), undefined);
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
	it('listAllTools() returns every shipped entry', () => {
		// Issue #861: the count is shipped data, not a contract.
		assert.ok(listAllTools().length > 0, 'the shipped manifest must expose at least one Tool');
	});

	it('listAllTools() includes both embeddable and host_disabled Tools', () => {
		// Issue #861: stated against the synthetic manifest — the
		// shipped set is about to lose its last waiting Tool, and the
		// show-all contract must not disappear with it.
		const registry = createToolRegistry(manifestWithWaitingTool());
		const kinds = new Set(registry.listAllTools().map((t) => t.delivery.kind));
		// show-all means at least one entry of each surface kind.
		assert.ok(kinds.has('same_origin_static'), 'show-all must include same_origin_static Tools');
		assert.ok(kinds.has('host_disabled'), 'show-all must include host_disabled Tools');
	});

	it('host_disabled Tools carry a non-empty disabled_reason via listAllTools()', () => {
		// The index page and `/tools/<slug>` placeholder need
		// `disabled_reason` to render the "Coming soon" copy. The
		// field is on the manifest entry itself, so `getTool()` (and
		// by extension `listAllTools()`) carries it through unchanged.
		//
		// Issue #861: the positive case is stated against the synthetic
		// manifest; the shipped manifest keeps the STRUCTURAL invariant
		// (every waiting Tool that IS there carries the reason).
		const registry = createToolRegistry(manifestWithWaitingTool());
		const syntheticWaiting = registry
			.listAllTools()
			.filter((t) => t.delivery.kind === 'host_disabled');
		assert.ok(syntheticWaiting.length > 0, 'the synthetic fixture must hold one waiting Tool');
		for (const tool of syntheticWaiting) {
			if (tool.delivery.kind === 'host_disabled') {
				assert.ok(
					typeof tool.delivery.disabled_reason === 'string' &&
						tool.delivery.disabled_reason.length > 0,
					`host_disabled Tool ${tool.slug} must carry a non-empty disabled_reason`,
				);
			}
		}
		for (const tool of listAllTools()) {
			if (tool.delivery.kind === 'host_disabled') {
				assert.ok(
					typeof tool.delivery.disabled_reason === 'string' &&
						tool.delivery.disabled_reason.length > 0,
					`shipped host_disabled Tool ${tool.slug} must carry a non-empty disabled_reason`,
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
		// Sanity: the public surface must be a strict SUBSET of the
		// show-all surface whenever a waiting Tool exists. Issue #861:
		// stated against the synthetic manifest, because the shipped set
		// is about to have no waiting Tool at all (and then the two
		// surfaces are equal BY DESIGN, not by a regression).
		const registry = createToolRegistry(manifestWithWaitingTool());
		assert.ok(
			registry.listPublicTools().length < registry.listAllTools().length,
			'listPublicTools() must be a strict subset of listAllTools() for #195 to be meaningful',
		);
	});

	it('a manifest with no waiting Tool still answers every API (Issue #861)', () => {
		// The negative case of the "準備中" contract: with no waiting
		// Tool, the registry must not break — the public surface is the
		// whole surface, and every lookup still answers.
		const registry = createToolRegistry(manifestWithoutWaitingTool());
		assert.equal(registry.listAllTools().length, 1);
		assert.equal(registry.listPublicTools().length, 1);
		assert.equal(registry.listPublicTools().length, registry.listAllTools().length);
		assert.equal(registry.getTool('served-tool')?.slug, 'served-tool');
		assert.equal(registry.getPublicTool('served-tool')?.slug, 'served-tool');
		assert.equal(registry.getTool('waiting-tool'), undefined);
		assert.equal(registry.getPublicTool('waiting-tool'), undefined);
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
