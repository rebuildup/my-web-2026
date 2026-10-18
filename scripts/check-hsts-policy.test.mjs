import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	driftedDirectives,
	hstsDirectivesIn,
	normalizeDirective,
	policyViolations,
	readCanonicalDirective,
	runGate,
} from './check-hsts-policy.mjs';

/**
 * Fixture coverage for the HSTS policy gate (Issue #446).
 *
 * The gate's whole value is refusing a directive nobody has audited,
 * so it is only worth running if it fails when it should. The staged
 * trees below plant one violation of each shape the gate claims to
 * catch; the final case runs it against this repository so a change to
 * the scanner cannot turn it into a silent no-op.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function stage(files) {
	const root = mkdtempSync(join(tmpdir(), 'check-hsts-policy-'));
	for (const [relativePath, contents] of Object.entries(files)) {
		const full = join(root, relativePath);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, contents);
	}
	return root;
}

function withStaged(files, run) {
	const root = stage(files);
	try {
		return run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const ENTRY = { 'src/server.ts': "export const HSTS_DIRECTIVE = 'max-age=31536000';\n" };

describe('check-hsts-policy — source of truth', () => {
	it('reads the canonical directive from the Worker entry', () => {
		withStaged(ENTRY, (root) => {
			const { directive, violations } = readCanonicalDirective({ root });
			assert.equal(directive, 'max-age=31536000');
			assert.deepEqual(violations, []);
		});
	});

	it('fails when the declaration is missing', () => {
		withStaged({ 'src/server.ts': 'export default { fetch() {} };\n' }, (root) => {
			const { directive, violations } = readCanonicalDirective({ root });
			assert.equal(directive, null);
			assert.equal(violations.length, 1);
			assert.match(violations[0], /source of truth/);
		});
	});

	it('fails when the declaration is duplicated', () => {
		// TypeScript would reject this file; the gate reads text, and the
		// scenario it guards is a copy-pasted second "definition" of the
		// policy in the same entry file.
		const source = [
			ENTRY['src/server.ts'],
			"export const HSTS_DIRECTIVE = 'max-age=63072000';\n",
		].join('\n');
		withStaged({ 'src/server.ts': source }, (root) => {
			const { violations } = readCanonicalDirective({ root });
			assert.equal(violations.length, 1);
			assert.match(violations[0], /declares HSTS_DIRECTIVE 2 times/);
		});
	});
});

describe('check-hsts-policy — directive rules', () => {
	it('accepts the shipped value', () => {
		assert.deepEqual(policyViolations('max-age=31536000'), []);
	});

	it('rejects includeSubDomains in any casing or arity', () => {
		for (const directive of [
			'max-age=31536000; includeSubDomains',
			'max-age=31536000; includesubdomains',
			'max-age=31536000; includeSubDomains=1',
		]) {
			const violations = policyViolations(directive);
			assert.equal(violations.length, 1, directive);
			assert.match(violations[0], /beyond this host/, directive);
		}
	});

	it('rejects preload', () => {
		const violations = policyViolations('max-age=31536000; preload');
		assert.equal(violations.length, 1);
		assert.match(violations[0], /beyond this host/);
	});

	it('rejects a max-age outside the allowed band', () => {
		assert.match(policyViolations('max-age=300')[0], /outside the allowed band/);
		assert.match(policyViolations('max-age=63072001')[0], /outside the allowed band/);
	});

	it('rejects a non-numeric max-age', () => {
		assert.match(policyViolations('max-age="31536000"')[0], /decimal seconds/);
		assert.match(policyViolations('max-age=1y')[0], /decimal seconds/);
	});

	it('rejects an unknown directive and a missing/duplicated max-age', () => {
		assert.match(policyViolations('max-age=31536000; foo=1')[0], /RFC 6797/);
		assert.ok(
			policyViolations('includeSubDomains').some((violation) =>
				/exactly one max-age/.test(violation),
			),
			'a directive with no max-age says nothing about how long the guarantee lasts',
		);
		assert.ok(
			policyViolations('max-age=31536000; max-age=31536000').some((violation) =>
				/exactly one max-age/.test(violation),
			),
			'two max-age values are ambiguous to read and easy to contradict',
		);
		assert.match(policyViolations('')[0], /empty/);
	});
});

describe('check-hsts-policy — HSTS-shaped literals only', () => {
	it('does not mistake a cookie attribute for an HSTS policy', () => {
		const source = "const COOKIE = 'Max-Age=31536000; Path=/; HttpOnly; Secure';\n";
		assert.deepEqual(hstsDirectivesIn('src/a.ts', source), []);
	});

	it('does not mistake Cache-Control max-age for an HSTS policy', () => {
		const source = 'Cache-Control: public, max-age=0, must-revalidate\n';
		assert.deepEqual(hstsDirectivesIn('public/_headers', source), []);
	});

	it('does not mistake a quoted Cache-Control value for an HSTS policy', () => {
		// Issue #460's cache policy spells its lifetime as a quoted string,
		// so the drift scan sees `max-age` next to directives RFC 6797
		// does not define. Sibling directives are what tell the two apart.
		const source = "const IMMUTABLE = 'public, max-age=31536000, immutable';\n";
		assert.deepEqual(hstsDirectivesIn('src/http/middleware/cache-policy.ts', source), []);
	});

	it('does not read a doc comment writing the cache rule as a policy', () => {
		// Backticks in prose are markdown, not a header value.
		const source = [
			'/**',
			' * `s-maxage` overrides `max-age` for a shared cache, so',
			' * `max-age=0` means "do not serve from cache".',
			' */',
		].join('\n');
		assert.deepEqual(hstsDirectivesIn('src/http/middleware/cache-policy.ts', source), []);
	});

	it('does not read a bare directive NAME as a policy', () => {
		// Naming the directive states no lifetime, and this repository
		// quotes the names to explain why they are withheld.
		const source = ["const FORBIDDEN = ['includeSubDomains', 'preload', 'max-age'];", ''].join(
			'\n',
		);
		assert.deepEqual(hstsDirectivesIn('src/server.ts', source), []);
	});

	it('still reads a widened HSTS directive written in a comment-free literal', () => {
		const source = "const D = 'max-age=63072000; preload';\n";
		assert.deepEqual(hstsDirectivesIn('src/server.ts', source), ['max-age=63072000; preload']);
	});

	it('reads a Strict-Transport-Security rule out of _headers', () => {
		const source = [
			'/assets/*',
			'  Cache-Control: public, max-age=31556952, immutable',
			'',
			'/*',
			'  Strict-Transport-Security: max-age=31536000',
			'',
		].join('\n');
		assert.deepEqual(hstsDirectivesIn('public/_headers', source), ['max-age=31536000']);
	});

	it('reads a quoted directive out of source without reading the header name', () => {
		const source = [
			"const HSTS_HEADER = 'strict-transport-security';",
			"const INTENDED_DIRECTIVE = 'max-age=31536000';",
		].join('\n');
		assert.deepEqual(hstsDirectivesIn('test/a.test.ts', source), ['max-age=31536000']);
	});

	it('normalises whitespace so spacing cannot fake a mismatch', () => {
		assert.equal(
			normalizeDirective('max-age=31536000 ; includeSubDomains'),
			normalizeDirective('max-age=31536000;includeSubDomains'),
		);
	});
});

describe('check-hsts-policy — drift scan', () => {
	it('reports a literal that disagrees with the shipped directive', () => {
		withStaged(
			{
				...ENTRY,
				// A report generator that restates the directive: the
				// realistic drift site outside test files.
				'scripts/make-hsts-report.mjs': "const DIRECTIVE = 'max-age=63072000';\n",
			},
			(root) => {
				const violations = driftedDirectives({ root, canonical: 'max-age=31536000' });
				assert.equal(violations.length, 1);
				assert.match(violations[0], /scripts\/make-hsts-report\.mjs: "max-age=63072000"/);
			},
		);
	});

	it('skips fixture files, which plant violations on purpose', () => {
		withStaged(
			{
				...ENTRY,
				'test/integration/hsts.test.ts': "const D = 'max-age=63072000';\n",
			},
			(root) => {
				assert.deepEqual(driftedDirectives({ root, canonical: 'max-age=31536000' }), []);
			},
		);
	});

	it('reports a widened _headers rule', () => {
		withStaged(
			{
				...ENTRY,
				'public/_headers': '/*\n  Strict-Transport-Security: max-age=31536000; includeSubDomains\n',
			},
			(root) => {
				const violations = driftedDirectives({ root, canonical: 'max-age=31536000' });
				assert.equal(violations.length, 1);
				assert.match(violations[0], /public\/_headers/);
			},
		);
	});

	it('accepts a tree whose literals all agree', () => {
		withStaged(
			{
				...ENTRY,
				'scripts/make-hsts-report.mjs': "const DIRECTIVE = 'max-age=31536000';\n",
				'public/_headers': '/assets/*\n  Cache-Control: public, max-age=0, must-revalidate\n',
			},
			(root) => {
				assert.deepEqual(driftedDirectives({ root, canonical: 'max-age=31536000' }), []);
			},
		);
	});
});

describe('check-hsts-policy — this repository', () => {
	it('ships a host-scoped HSTS policy with no drift', () => {
		const { directive, violations } = runGate({ root: REPO_ROOT });
		assert.deepEqual(
			violations,
			[],
			'HSTS policy violations found — see docs/security.md for the ramp ladder and the audit that unlocks includeSubDomains / preload',
		);
		assert.match(directive, /^max-age=\d+$/);
	});
});
