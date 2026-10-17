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

describe('Tool manifest — sandbox + scripts combination', () => {
	// Issue #465: the ad-hoc `isDangerousSandbox` helper below is kept
	// as a historical statement of the ORIGINAL #80 rule (the verifier
	// used to carry its own copy). The authoritative rules now live in
	// `src/tools/embed-policy.ts`, which this verifier imports directly
	// — see the `describe` blocks at the bottom of this file, which
	// assert the same decisions through the real implementation.
	function isDangerousSandbox(sandbox) {
		if (typeof sandbox !== 'string') return false;
		const tokens = sandbox.split(/\s+/);
		return tokens.includes('allow-scripts') && tokens.includes('allow-same-origin');
	}

	it('flags allow-scripts + allow-same-origin as dangerous', () => {
		assert.equal(isDangerousSandbox('allow-scripts allow-same-origin'), true);
	});

	it('does NOT flag allow-scripts alone (default for read-only Tools)', () => {
		assert.equal(isDangerousSandbox('allow-scripts'), false);
	});

	it('does NOT flag empty sandbox (most restrictive)', () => {
		assert.equal(isDangerousSandbox(''), false);
	});

	it('does NOT flag allow-same-origin alone (still no scripts)', () => {
		assert.equal(isDangerousSandbox('allow-same-origin'), false);
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
