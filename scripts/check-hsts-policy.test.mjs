import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	composedHstsExpressionsIn,
	driftedDirectives,
	hstsDirectivesIn,
	normalizeDirective,
	policyViolations,
	readCanonicalDirective,
	runGate,
	stripComments,
	undefinedParts,
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

	it('accepts a non-exported declaration (Worker entries must not export values)', () => {
		withStaged({ 'src/server.ts': "const HSTS_DIRECTIVE = 'max-age=31536000';\n" }, (root) => {
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
		// Backticks in prose are markdown, not a header value. Comments are
		// blanked before the scan, so neither the backtick nor the quoted
		// spelling of a policy can be read out of a comment.
		const source = [
			'/**',
			' * `s-maxage` overrides `max-age` for a shared cache, so',
			' * `max-age=0` means "do not serve from cache".',
			' * The cache policy itself is `public, max-age=31536000, immutable`,',
			' * and `"max-age=63072000; preload"` only appears in this comment.',
			' */',
		].join('\n');
		assert.deepEqual(hstsDirectivesIn('src/http/middleware/cache-policy.ts', source), []);
	});

	it('keeps a declaration that follows prose and string syntax the stripper must not eat', () => {
		// The comment stripper has to track strings, template literals and
		// regex literals: a `'https://…'` literal, a regex holding quotes and
		// an escaped slash all look like comment syntax to a naive reader.
		const source = [
			'const QUOTE = /[\'"]x[\'"]/;',
			'const ESCAPED = /a\\/\\/b/;',
			"const ORIGIN = 'https://rebuildup.dev'; // not a comment start",
			'/* a block comment with `max-age=31536000; preload` */',
			"const D = 'max-age=31536000; includeSubDomains';",
			'const RATIO = width / height / 2;',
		].join('\n');
		assert.deepEqual(hstsDirectivesIn('src/http/middleware/transport.ts', source), [
			'max-age=31536000; includeSubDomains',
		]);
		assert.equal(stripComments('const a = 1; // gone').trim(), 'const a = 1;');
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

	it('reads a widened directive written as a template literal', () => {
		// The shape a Hono middleware naturally takes:
		//   c.header(HSTS_HEADER, `max-age=31536000; includeSubDomains`)
		// A scan that only reads quotes would miss it, which would make the
		// gate decorative exactly where the widening happens.
		const source = [
			"const HSTS_HEADER = 'strict-transport-security';",
			'export function transport(c) {',
			'  c.header(HSTS_HEADER, `max-age=31536000; includeSubDomains`);',
			'}',
		].join('\n');
		assert.deepEqual(hstsDirectivesIn('src/http/middleware/transport.ts', source), [
			'max-age=31536000; includeSubDomains',
		]);
	});

	it('reads a directive whose value is composed at runtime', () => {
		// A source scan cannot know the interpolated value, so the literal is
		// a candidate and is reported as unverifiable rather than skipped.
		const source = ['const D = `max-age=${SECONDS}; includeSubDomains`;', ''].join('\n');
		assert.deepEqual(hstsDirectivesIn('src/http/middleware/transport.ts', source), [
			'max-age=${SECONDS}; includeSubDomains',
		]);
	});

	it('keeps a literal that mixes a scope directive with a token RFC 6797 does not define', () => {
		// Requiring every part to be a known directive would drop the whole
		// string, taking `includeSubDomains` out of the scan with it.
		const source = "const D = 'max-age=31536000; includeSubDomains; report-uri=x';\n";
		assert.deepEqual(hstsDirectivesIn('src/http/middleware/transport.ts', source), [
			'max-age=31536000; includeSubDomains; report-uri=x',
		]);
		assert.deepEqual(undefinedParts('max-age=31536000; includeSubDomains; report-uri=x'), [
			'report-uri=x',
		]);
		assert.deepEqual(undefinedParts('max-age=31536000'), []);
	});

	it('does not mistake a Set-Cookie Max-Age attribute for a policy', () => {
		// `src/home/reactions/cookie.ts` spells the cookie attribute
		// `Max-Age`, the RFC 6265 casing, as the whole literal. RFC 6797
		// HSTS names are case-insensitive, but the cookie survives because
		// this is the attribute's exact spelling and the only part.
		const source = 'const COOKIE = `Max-Age=${ACTOR_COOKIE_MAX_AGE_SECONDS}`;\n';
		assert.deepEqual(hstsDirectivesIn('src/home/reactions/cookie.ts', source), []);
	});

	it('reads a directive assembled from concatenated literals as one value', () => {
		// Reading `'max-age=31536000'` on its own would accept the first half
		// and ignore the half that widens the policy.
		const source = "const D = 'max-age=31536000' + '; includeSubDomains';\n";
		assert.deepEqual(hstsDirectivesIn('src/http/middleware/transport.ts', source), [
			'max-age=31536000; includeSubDomains',
		]);
	});

	it('reads a scope directive whose name is upper-cased', () => {
		// HSTS directive names are case-insensitive, so a browser honours
		// this header and the gate has to read it as a candidate.
		const source = "const D = 'MAX-AGE=31536000; includeSubDomains';\n";
		assert.deepEqual(hstsDirectivesIn('src/http/middleware/transport.ts', source), [
			'MAX-AGE=31536000; includeSubDomains',
		]);
	});

	it('accepts an upper-cased spelling of the canonical value', () => {
		const source = "const D = 'MAX-AGE=31536000';\n";
		assert.deepEqual(hstsDirectivesIn('src/http/middleware/transport.ts', source), [
			'MAX-AGE=31536000',
		]);
	});

	it('reports a candidate concatenated with a non-literal operand as composed', () => {
		const source = "const D = SUFFIX + 'max-age=31536000';\n";
		assert.deepEqual(composedHstsExpressionsIn('src/http/middleware/transport.ts', source), [
			{ value: 'max-age=31536000', reason: 'string concatenation' },
		]);
	});

	it('reports a concatenation of the canonical constant as composed', () => {
		const source = "const D = HSTS_DIRECTIVE + '; includeSubDomains';\n";
		assert.deepEqual(composedHstsExpressionsIn('src/http/middleware/transport.ts', source), [
			{ value: 'HSTS_DIRECTIVE concatenation', reason: 'the canonical constant is concatenated' },
		]);
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

	it('reports a policy widened in a template literal on a runtime path', () => {
		// The regression this Issue's gate exists for: a Hono middleware or
		// middleware constant that widens the directive in a template literal,
		// on a surface the runtime suite does not exercise. `runGate` — not
		// only the helper — has to fail on it.
		withStaged(
			{
				...ENTRY,
				'src/http/middleware/transport.ts':
					'c.header(HSTS_HEADER, `max-age=31536000; includeSubDomains`);\n',
			},
			(root) => {
				const violations = runGate({ root }).violations;
				assert.ok(
					violations.some(
						(violation) =>
							violation.includes('src/http/middleware/transport.ts') &&
							violation.includes('includeSubDomains'),
					),
					`the gate missed a widened template literal: ${JSON.stringify(violations)}`,
				);
			},
		);
	});

	it('names the token RFC 6797 does not define instead of dropping the literal', () => {
		withStaged(
			{
				...ENTRY,
				'scripts/make-hsts-report.mjs':
					"const D = 'max-age=31536000; includeSubDomains; report-uri=x';\n",
			},
			(root) => {
				const violations = driftedDirectives({ root, canonical: 'max-age=31536000' });
				assert.ok(
					violations.some((violation) => /report-uri=x.*RFC 6797/.test(violation)),
					JSON.stringify(violations),
				);
			},
		);
	});

	it('reports a policy widened by string concatenation on a runtime path', () => {
		// The reviewer's reproducer: two literals joined at runtime used to be
		// read as a canonical first half plus an ignored second half.
		withStaged(
			{
				...ENTRY,
				'src/http/middleware/transport.ts':
					"c.header(HSTS_HEADER, 'max-age=31536000' + '; includeSubDomains');\n",
			},
			(root) => {
				const violations = runGate({ root }).violations;
				assert.ok(
					violations.some(
						(violation) =>
							violation.includes('src/http/middleware/transport.ts') &&
							violation.includes('includeSubDomains'),
					),
					`the gate missed a concatenated widening: ${JSON.stringify(violations)}`,
				);
			},
		);
	});

	it('reports an upper-cased widening that a browser would honour', () => {
		withStaged(
			{
				...ENTRY,
				'src/http/middleware/transport.ts':
					"c.header(HSTS_HEADER, 'MAX-AGE=31536000; includeSubDomains');\n",
			},
			(root) => {
				const violations = runGate({ root }).violations;
				assert.ok(
					violations.some(
						(violation) =>
							violation.includes('src/http/middleware/transport.ts') &&
							violation.includes('includeSubDomains'),
					),
					`the gate missed an upper-cased widening: ${JSON.stringify(violations)}`,
				);
			},
		);
	});

	it('does not accept a directive assembled from an unknown operand', () => {
		withStaged(
			{
				...ENTRY,
				'scripts/make-hsts-report.mjs': "const D = SUFFIX + 'max-age=31536000';\n",
			},
			(root) => {
				const violations = driftedDirectives({ root, canonical: 'max-age=31536000' });
				assert.ok(
					violations.some((violation) => /composed at runtime/.test(violation)),
					JSON.stringify(violations),
				);
			},
		);
	});

	it('says a runtime-composed directive cannot be verified', () => {
		withStaged(
			{
				...ENTRY,
				'scripts/make-hsts-report.mjs': 'const D = `max-age=${SECONDS}`;\n',
			},
			(root) => {
				const violations = driftedDirectives({ root, canonical: 'max-age=31536000' });
				assert.ok(
					violations.some((violation) => /composed at runtime/.test(violation)),
					JSON.stringify(violations),
				);
			},
		);
	});

	it('does not report prose that only explains the policy', () => {
		withStaged(
			{
				...ENTRY,
				'src/http/middleware/cache-policy.ts': [
					'/**',
					' * `max-age=0` means "do not serve from cache", and',
					' * `public, max-age=31536000, immutable` is the cache policy.',
					' */',
					"const IMMUTABLE = 'public, max-age=31536000, immutable';",
					'',
				].join('\n'),
			},
			(root) => {
				assert.deepEqual(driftedDirectives({ root, canonical: 'max-age=31536000' }), []);
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
