import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	evaluateEmbedPolicy,
	evaluateWorkerCanary,
	frameAncestorsValues,
	isUnder,
	main,
	normalizePattern,
	parseHeadersFile,
} from './check-frame-ancestors-policy.mjs';

/**
 * Fixture coverage for the static embed-policy gate (Issue #448).
 *
 * The gate is only worth running if it fails when it should, so each
 * direction it claims to protect is planted here as a fixture: the Tool
 * iframe being broken (`'none'`), third-party framing being re-opened
 * (`*`), a rule aimed at a Worker-owned path that could never apply,
 * and a dead Worker half. The final case runs the gate against the real
 * repository so a regression in the parser cannot turn it into a
 * silent no-op.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Evaluate a `_headers` document and return its violations. */
function violations(text) {
	const { rules, problems } = parseHeadersFile(text);
	return [...problems, ...evaluateEmbedPolicy(rules)];
}

const GOOD = `# comment
/tools/:slug/app/*
  Access-Control-Allow-Origin: *
  Content-Security-Policy: frame-ancestors 'self'

/tools/:slug/app
  Content-Security-Policy: frame-ancestors 'self'

/assets/*
  Cache-Control: public, max-age=31556952, immutable
`;

describe('check-frame-ancestors-policy — parser', () => {
	it('reads rules, headers and ignores comments', () => {
		const { rules, problems } = parseHeadersFile(GOOD);
		assert.deepEqual(problems, []);
		assert.equal(rules.length, 3);
		assert.equal(rules[0].pattern, '/tools/:slug/app/*');
		assert.deepEqual(
			rules[0].headers.map((h) => h.name),
			['Access-Control-Allow-Origin', 'Content-Security-Policy'],
		);
	});

	it('reports a header that appears before any rule pattern', () => {
		const errors = violations("  Content-Security-Policy: frame-ancestors 'self'\n");
		assert.equal(errors.length, 1);
		assert.match(errors[0], /header before any rule pattern/);
	});

	it('reports a line that is neither comment nor "Name: Value"', () => {
		const errors = violations('/assets/*\n  frame-ancestors self\n');
		assert.equal(errors.length, 1);
		assert.match(errors[0], /not a "Name: Value" header/);
	});
});

describe('check-frame-ancestors-policy — pattern classification', () => {
	it('drops wildcards and :param segments', () => {
		assert.equal(normalizePattern('/tools/:slug/app/*'), '/tools/app');
		assert.equal(normalizePattern('/tools/:slug/app'), '/tools/app');
		assert.equal(normalizePattern('/admin*'), '/admin');
	});

	it('keeps a lookalike path out of the denied namespace', () => {
		// The exact-prefix-or-/ rule the Worker policy uses: `/admin*` is
		// an admin rule, `/administrator` is not.
		assert.equal(isUnder('/admin*', '/admin'), true);
		assert.equal(isUnder('/admin/keys', '/admin'), true);
		assert.equal(isUnder('/administrator', '/admin'), false);
		assert.equal(isUnder('/api/v1/authentication', '/api/v1/auth'), false);
		assert.equal(isUnder('/api/v1/auth/get-session', '/api/v1/auth'), true);
	});

	it('reads only real directives, not tokens that start the same way', () => {
		assert.deepEqual(frameAncestorsValues("frame-ancestors 'self'"), ["'self'"]);
		assert.deepEqual(frameAncestorsValues("default-src 'self'; frame-ancestors 'none'"), [
			"'none'",
		]);
		assert.deepEqual(frameAncestorsValues('frame-ancestors-report'), []);
	});
});

describe('check-frame-ancestors-policy — the direction that keeps Tools working', () => {
	it('accepts the shipped Tool rule', () => {
		assert.deepEqual(violations(GOOD), []);
	});

	it('fails when a Tool artefact rule is switched to none', () => {
		const errors = violations(GOOD.replace("frame-ancestors 'self'", "frame-ancestors 'none'"));
		// One error for the rule that changed; the untouched second Tool
		// rule stays valid.
		assert.equal(errors.length, 1);
		assert.match(errors[0], /breaks every integrated Tool/);
	});

	it('fails when a Tool artefact rule drops the CSP header entirely', () => {
		const errors = violations('/tools/:slug/app/*\n  Access-Control-Allow-Origin: *\n');
		assert.equal(errors.length, 1);
		assert.match(errors[0], /sets no content-security-policy/);
	});
});

describe('check-frame-ancestors-policy — the direction that denies third parties', () => {
	it('fails on the permissive values that re-open framing', () => {
		for (const value of ['*', 'https:', "'self' https://evil.example"]) {
			const errors = violations(`/tools/*\n  Content-Security-Policy: frame-ancestors ${value}\n`);
			assert.equal(errors.length, 1, `expected one violation for ${value}`);
			assert.match(errors[0], /is not a value this site ships/);
		}
	});

	it('fails a rule aimed at a Worker-generated path', () => {
		for (const pattern of ['/admin*', '/api/v1/auth/*']) {
			const errors = violations(`${pattern}\n  Content-Security-Policy: frame-ancestors 'none'\n`);
			assert.equal(errors.length, 1);
			assert.match(errors[0], /Worker-generated response/);
		}
	});

	it('fails a CSP that carries no frame-ancestors directive', () => {
		const errors = violations("/tools/*\n  Content-Security-Policy: default-src 'none'\n");
		assert.equal(errors.length, 1);
		assert.match(errors[0], /carries no frame-ancestors directive/);
	});

	it('fails a duplicated frame-ancestors directive', () => {
		const errors = violations(
			"/tools/*\n  Content-Security-Policy: frame-ancestors 'self'; frame-ancestors 'none'\n",
		);
		// Both the dead second opinion and the value it would have applied
		// to a Tool document are reported: the duplicate is misleading AND
		// the value is the one that would break the iframe if a browser
		// honoured it.
		assert.equal(errors.length, 2);
		assert.match(errors[0], /declared 2 times/);
		assert.match(errors[1], /breaks every integrated Tool/);
	});
});

describe('check-frame-ancestors-policy — Worker half canary', () => {
	it('passes on the real src/server.ts', () => {
		const source = readFileSync(join(REPO_ROOT, 'src/server.ts'), 'utf8');
		assert.deepEqual(evaluateWorkerCanary(source), []);
	});

	it('fails when the Worker half disappears', () => {
		// content-security-policy, frame-ancestors, and both policy values.
		assert.equal(evaluateWorkerCanary('export default { fetch() {} };').length, 4);
		assert.match(evaluateWorkerCanary('// frame-ancestors gone')[0], /content-security-policy/);
	});

	it('fails when only one of the two policy values survives', () => {
		const source = "// content-security-policy frame-ancestors 'none'";
		const errors = evaluateWorkerCanary(source);
		assert.equal(errors.length, 1);
		assert.match(errors[0], /'self'/);
	});
});

describe('check-frame-ancestors-policy — against the real repository', () => {
	it('reports no violation for the shipped public/_headers', () => {
		const text = readFileSync(join(REPO_ROOT, 'public/_headers'), 'utf8');
		assert.deepEqual(violations(text), []);
	});

	it('exits 0 when run as a CLI', () => {
		assert.equal(main([]), 0);
	});
});
