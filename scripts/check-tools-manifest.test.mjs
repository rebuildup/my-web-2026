import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateToolEmbedPolicy, toEmbedSubject } from '../src/tools/embed-policy.ts';

/**
 * Pure-helper extraction tests for the Tool Registry manifest
 * verifier. The verifier itself shells out to `git ls-tree` and
 * reads from disk, so we exercise its validation rules via fixtures
 * instead of subprocess roundtrips.
 *
 * The convention matches `bootstrap-home-api-key.test.mjs` and
 * `migrate-portfolio-from-2025.test.mjs`: extract pure regex /
 * shape checks via Function-constructor and assert behaviour
 * directly.
 */

const SHA_REGEX = /^[0-9a-f]{40}$/;
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,127}$/;
const SUBMODULE_PATH_REGEX = /^external\/[a-z0-9][a-z0-9-]{0,127}$/;
const ARTIFACT_PATH_REGEX = /^\/tools\/[a-z0-9][a-z0-9-]{0,127}(\/.*)?$/;

describe('Tool manifest — SHA format', () => {
	it('accepts a real 40-char hex SHA', () => {
		assert.equal(SHA_REGEX.test('18e925272ca274e428e143c45194950d562bc096'), true);
	});

	it('rejects a 39-char SHA', () => {
		assert.equal(SHA_REGEX.test('18e925272ca274e428e143c45194950d562bc09'), false);
	});

	it('rejects uppercase hex (gitlink SHAs are lowercase)', () => {
		assert.equal(SHA_REGEX.test('18E925272CA274E428E143C45194950D562BC096'), false);
	});
});

describe('Tool manifest — slug format', () => {
	it('accepts lowercase letters + digits + dashes', () => {
		assert.equal(SLUG_REGEX.test('text-counter'), true);
		assert.equal(SLUG_REGEX.test('qr-generator'), true);
		assert.equal(SLUG_REGEX.test('mic-level'), true);
	});

	it('rejects uppercase', () => {
		assert.equal(SLUG_REGEX.test('TextCounter'), false);
	});

	it('rejects leading dash', () => {
		assert.equal(SLUG_REGEX.test('-counter'), false);
	});

	it('rejects 129-char slugs (regex bound: first char + 0-127 = 128 max)', () => {
		assert.equal(SLUG_REGEX.test('a'.repeat(129)), false);
		assert.equal(SLUG_REGEX.test('a'.repeat(128)), true);
		assert.equal(SLUG_REGEX.test('a'.repeat(127)), true);
	});
});

describe('Tool manifest — submodule path', () => {
	it('must start with external/', () => {
		assert.equal(SUBMODULE_PATH_REGEX.test('external/prototype'), true);
		assert.equal(SUBMODULE_PATH_REGEX.test('tools/prototype'), false);
		assert.equal(SUBMODULE_PATH_REGEX.test('src/external/prototype'), false);
	});

	it('slug segment must match the same slug grammar as the slug field', () => {
		assert.equal(SUBMODULE_PATH_REGEX.test('external/text-counter'), true);
		assert.equal(SUBMODULE_PATH_REGEX.test('external/Text-Counter'), false);
	});
});

describe('Tool manifest — artifact path', () => {
	it('must start with /tools/<slug>', () => {
		assert.equal(ARTIFACT_PATH_REGEX.test('/tools/prototype'), true);
		assert.equal(ARTIFACT_PATH_REGEX.test('/tools/prototype/'), true);
		assert.equal(ARTIFACT_PATH_REGEX.test('/tools/prototype/app/'), true);
		assert.equal(ARTIFACT_PATH_REGEX.test('/portfolio/prototype'), false);
	});

	it('rejects paths outside /tools/', () => {
		assert.equal(ARTIFACT_PATH_REGEX.test('/tools/'), false);
		assert.equal(ARTIFACT_PATH_REGEX.test('/tool/prototype'), false);
	});
});

describe('Tool manifest — classification / delivery.kind coherence', () => {
	function classificationDeliveryMismatch(tool) {
		if (
			tool.classification === 'needs_tool_side_fix' &&
			tool.delivery?.kind === 'same_origin_static'
		) {
			return 'classification=needs_tool_side_fix but delivery.kind=same_origin_static';
		}
		return null;
	}

	it('reports mismatch when classification=needs_tool_side_fix but delivery.kind=same_origin_static', () => {
		const tool = {
			classification: 'needs_tool_side_fix',
			delivery: { kind: 'same_origin_static' },
		};
		assert.equal(
			classificationDeliveryMismatch(tool),
			'classification=needs_tool_side_fix but delivery.kind=same_origin_static',
		);
	});

	it('passes when classification=same_origin_static and delivery.kind=host_disabled (awaiting integration)', () => {
		const tool = {
			classification: 'same_origin_static',
			delivery: { kind: 'host_disabled' },
		};
		assert.equal(classificationDeliveryMismatch(tool), null);
	});

	it('passes when classification=same_origin_static and delivery.kind=same_origin_static (live)', () => {
		const tool = {
			classification: 'same_origin_static',
			delivery: { kind: 'same_origin_static' },
		};
		assert.equal(classificationDeliveryMismatch(tool), null);
	});

	it('passes when classification=needs_tool_side_fix and delivery.kind=host_disabled', () => {
		const tool = {
			classification: 'needs_tool_side_fix',
			delivery: { kind: 'host_disabled' },
		};
		assert.equal(classificationDeliveryMismatch(tool), null);
	});
});

describe('Tool manifest — embed policy gate (Issue #465)', () => {
	// `scripts/check-tools-manifest.mjs` imports `evaluateToolEmbedPolicy`
	// from `src/tools/embed-policy.ts` and prints every violation it
	// returns, so this block asserts the gate's real decisions through
	// the same function rather than a restated copy of the rules. If a
	// rule is relaxed in the policy module, these fail — and so does
	// `pnpm run tools:check`, which is the point.

	function violationCodes(delivery) {
		return evaluateToolEmbedPolicy(toEmbedSubject('fixture', delivery)).map((v) => v.code);
	}

	const okIframe = { sandbox: 'allow-scripts', referrer_policy: 'no-referrer' };

	it('passes the current manifest shape', () => {
		assert.deepEqual(
			violationCodes({
				kind: 'same_origin_static',
				artifact_path: '/tools/fixture/app',
				entry_html: '/tools/fixture/app/index.html',
				iframe: okIframe,
			}),
			[],
		);
	});

	it('fails the build for allow-scripts + allow-same-origin (was: "document the reason")', () => {
		assert.deepEqual(
			violationCodes({
				kind: 'same_origin_static',
				artifact_path: '/tools/fixture/app',
				entry_html: '/tools/fixture/app/index.html',
				iframe: { sandbox: 'allow-scripts allow-same-origin', referrer_policy: 'no-referrer' },
			}).sort(),
			['embed.sandbox.forbidden-token', 'embed.sandbox.same-origin-escape'],
		);
	});

	it('fails the build when delivery.iframe is absent (no implicit default)', () => {
		assert.deepEqual(
			violationCodes({
				kind: 'same_origin_static',
				artifact_path: '/tools/fixture/app',
				entry_html: '/tools/fixture/app/index.html',
			}),
			['embed.iframe.missing'],
		);
	});

	it('fails the build when referrer_policy is absent', () => {
		assert.deepEqual(
			violationCodes({
				kind: 'same_origin_static',
				artifact_path: '/tools/fixture/app',
				entry_html: '/tools/fixture/app/index.html',
				iframe: { sandbox: 'allow-scripts' },
			}),
			['embed.referrer-policy.missing'],
		);
	});

	it('fails the build for a cross-origin src on a same_origin_static entry', () => {
		assert.deepEqual(
			violationCodes({
				kind: 'same_origin_static',
				artifact_path: '/tools/fixture/app',
				entry_html: '//evil.example/app/index.html',
				iframe: okIframe,
			}),
			['embed.frame-src.cross-origin'],
		);
	});

	it('fails the build for a src that only LOOKS root-relative', () => {
		// Review of #569 (P2): `/\evil.example/app/index.html` starts
		// with `/`, but the URL parser maps `\` to `/` for special
		// schemes, so the browser loads `https://evil.example/...`. The
		// gate must fail the commit rather than render a foreign frame.
		for (const entry_html of [
			'/\\evil.example/app/index.html',
			'/\\\\evil.example/app/index.html',
			'/\t/evil.example/app/index.html',
			'/\r/evil.example/app/index.html',
		]) {
			assert.deepEqual(
				violationCodes({
					kind: 'same_origin_static',
					artifact_path: '/tools/fixture/app',
					entry_html,
					iframe: okIframe,
				}),
				['embed.frame-src.cross-origin'],
				entry_html,
			);
		}
	});

	it('fails the build for a wildcard host_message expected_origin', () => {
		assert.deepEqual(
			violationCodes({
				kind: 'same_origin_static',
				artifact_path: '/tools/fixture/app',
				entry_html: '/tools/fixture/app/index.html',
				iframe: okIframe,
				host_message: { expected_origin: '*', allowed_types: ['tool:ready'] },
			}),
			['host-message.origin.wildcard'],
		);
	});

	it('does not police host_disabled entries (nothing is framed)', () => {
		assert.deepEqual(
			violationCodes({ kind: 'host_disabled', disabled_reason: 'Tool-side fix pending' }),
			[],
		);
	});
});

describe('Tool manifest — embed policy gate covers BOTH embeddable kinds (Issue #465)', () => {
	// Regression for the first review of #569: the gate used to run
	// `evaluateToolEmbedPolicy` only inside its `same_origin_static`
	// branch, so an `external_exception` entry shipped any policy
	// violation (plaintext URL, missing `delivery.iframe`,
	// `allow-scripts allow-same-origin`, wildcard `expected_origin`)
	// through `pnpm run tools:check` while the `/tools/<slug>` route
	// refused to frame it. The gate now runs the policy for EVERY
	// entry — `host_disabled` still returns `[]` because nothing is
	// framed — so a manifest that would render a `blocked` placeholder
	// can never be committed.

	function violationCodes(delivery) {
		return evaluateToolEmbedPolicy(toEmbedSubject('fixture', delivery)).map((v) => v.code);
	}

	const okIframe = { sandbox: 'allow-scripts', referrer_policy: 'no-referrer' };

	it('accepts an https external_exception with a declared policy', () => {
		assert.deepEqual(
			violationCodes({
				kind: 'external_exception',
				external_url: 'https://tool.example/app/',
				iframe: okIframe,
			}),
			[],
		);
	});

	it('fails the build for a plaintext external_exception frame', () => {
		assert.deepEqual(
			violationCodes({
				kind: 'external_exception',
				external_url: 'http://tool.example/app/',
				iframe: okIframe,
			}),
			['embed.frame-src.not-https'],
		);
	});

	it('fails the build for a protocol-relative external_exception frame', () => {
		// `//tool.example/app/` reads like a path and is a foreign origin.
		assert.deepEqual(
			violationCodes({
				kind: 'external_exception',
				external_url: '//tool.example/app/',
				iframe: okIframe,
			}),
			['embed.frame-src.not-https'],
		);
	});

	it('fails the build for an external_exception with no declared iframe policy', () => {
		assert.deepEqual(
			violationCodes({
				kind: 'external_exception',
				external_url: 'https://tool.example/app/',
			}),
			['embed.iframe.missing'],
		);
	});

	it('fails the build for allow-scripts + allow-same-origin on an external frame', () => {
		assert.deepEqual(
			violationCodes({
				kind: 'external_exception',
				external_url: 'https://tool.example/app/',
				iframe: { sandbox: 'allow-scripts allow-same-origin', referrer_policy: 'no-referrer' },
			}).sort(),
			['embed.sandbox.forbidden-token', 'embed.sandbox.same-origin-escape'],
		);
	});

	it('fails the build for a leaking referrer policy on an external frame', () => {
		assert.deepEqual(
			violationCodes({
				kind: 'external_exception',
				external_url: 'https://tool.example/app/',
				iframe: { sandbox: 'allow-scripts', referrer_policy: 'unsafe-url' },
			}),
			['embed.referrer-policy.not-allowed'],
		);
	});

	it('fails the build for a wildcard host_message on an external frame', () => {
		assert.deepEqual(
			violationCodes({
				kind: 'external_exception',
				external_url: 'https://tool.example/app/',
				iframe: okIframe,
				host_message: { expected_origin: '*', allowed_types: ['tool:ready'] },
			}),
			['host-message.origin.wildcard'],
		);
	});

	it('still does not police host_disabled entries (nothing is framed)', () => {
		assert.deepEqual(
			violationCodes({
				kind: 'host_disabled',
				disabled_reason: 'Tool-side fix pending',
				iframe: { sandbox: 'allow-scripts allow-same-origin', referrer_policy: 'unsafe-url' },
			}),
			[],
		);
	});
});
