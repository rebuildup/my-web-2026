/**
 * `check-i18n-policy` unit tests (Issue #433).
 *
 * The gate is only worth its place in `validate:fast` if the gate
 * itself is covered: a scanner that silently stopped matching, or that
 * started flagging comments, would either pass broken source or fail
 * every PR. These tests pin the scanner behaviour, the exemptions, and
 * the one invariant that matters most — the shipped `src/` tree is
 * clean under the policy it claims to enforce.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	RULES,
	collectScanFiles,
	fixtureMismatches,
	formatViolation,
	isScanned,
	lineAt,
	loadPolicy,
	scanSource,
	stripComments,
	summarizeFixtures,
	toScanPath,
} from './check-i18n-policy.mjs';

test('stripComments removes comments but keeps code intact', () => {
	const source = [
		'const a = 1; // trailing note about NFKC',
		'/* block',
		'   NFKD is banned */',
		"const url = 'https://example.com/path';",
		'const re = /\\/\\*not a comment\\*\\//;',
		'const t = `a // ${b} /* c */`;',
	].join('\n');
	const stripped = stripComments(source);
	assert.equal(stripped.includes('NFKC'), false);
	assert.equal(stripped.includes('NFKD'), false);
	assert.equal(stripped.includes('const a = 1;'), true);
	// A URL inside a string must survive: the `//` is not a comment.
	assert.equal(stripped.includes("'https://example.com/path'"), true);
	// A regex literal must survive intact.
	assert.equal(stripped.includes('/\\/\\*not a comment\\*\\//'), true);
	assert.equal(stripped.includes('`a // ${b} /* c */`'), true);
});

test('stripComments preserves line count so reported lines stay accurate', () => {
	const source = 'const a = 1;\n/* two\n   lines */\nconst b = 2;';
	assert.equal(lineAt(stripComments(source), source.indexOf('const b')), 4);
});

test('isScanned keeps the policy owner, tests and generated files out of scope', () => {
	assert.equal(isScanned('src/home/reactions/widget.tsx'), true);
	assert.equal(isScanned('src/portfolio/schema.ts'), true);
	// The obligation states the policy in prose and needs to name the
	// forbidden forms to report them.
	assert.equal(isScanned('src/i18n/unicode.ts'), false);
	assert.equal(isScanned('src/i18n/fixtures.test.ts'), false);
	assert.equal(isScanned('src/portfolio/schema.test.ts'), false);
	assert.equal(isScanned('src/home/reactions/widget.stories.tsx'), false);
	assert.equal(isScanned('src/routeTree.gen.ts'), false);
	assert.equal(isScanned('scripts/check-i18n-policy.mjs'), false);
	assert.equal(isScanned('docs/domain/i18n.md'), false);
});

test('scanSource flags every rule it declares', () => {
	const samples = {
		'no-compatibility-fold':
			"const folded = text.normalize('NFKC');\nconst key = text.normalize(`NFKD`);",
		'no-implicit-normalize': 'const key = text.normalize(form);',
		'explicit-locale': 'const label = count.toLocaleString();',
		'intl-without-locale': 'const format = new Intl.NumberFormat();',
		'no-lossy-derivation': 'const slug = slugify(title);',
	};
	for (const rule of RULES) {
		const violations = scanSource('src/example.ts', samples[rule.id]);
		assert.equal(violations.length > 0, true, `expected ${rule.id} to fire on its sample`);
		assert.ok(
			violations.some((violation) => violation.rule === rule.id),
			`expected the ${rule.id} finding among ${JSON.stringify(violations.map((v) => v.rule))}`,
		);
		assert.ok(violations.every((violation) => violation.file === 'src/example.ts'));
		assert.ok(violations.every((violation) => violation.line >= 1));
	}
});

test('scanSource ignores files outside the scanned surface', () => {
	const source = "const folded = text.normalize('NFKC');";
	assert.deepEqual(scanSource('src/i18n/unicode.ts', source), []);
	assert.deepEqual(scanSource('src/i18n/slug-identity.test.ts', source), []);
	assert.ok(scanSource('src/home/reactions/widget.tsx', source).length > 0);
});

test('scanSource ignores a rule named in a comment but not in code', () => {
	const source = [
		'// NFKC would rewrite U+00B5 into U+03BC, which is why we refuse it.',
		"/* text.normalize('NFKC') is the thing we do not do here. */",
		"const label = count.toLocaleString('en-US'); // locale stays opt-in",
	].join('\n');
	assert.deepEqual(scanSource('src/example.ts', source), []);
});

test('scanSource treats ANY normalize outside the policy owner as a violation', () => {
	// Even an NFC fold: normalization belongs to src/i18n so that there is
	// exactly one place where it can be reasoned about.
	const violations = scanSource('src/example.ts', "const key = text.normalize('NFC');");
	assert.deepEqual(
		violations.map((violation) => violation.rule),
		['no-implicit-normalize'],
	);
});

test('scanSource reports an explicit locale as clean', () => {
	const source = [
		"const label = count.toLocaleString('en-US');",
		"const format = new Intl.NumberFormat('en-US');",
		"const when = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short' });",
	].join('\n');
	assert.deepEqual(scanSource('src/example.ts', source), []);
});

test('scanSource treats an explicit undefined or variable locale as implicit', () => {
	// `undefined` is not a decision — it is the absence of one, and it
	// resolves to the visitor's environment at runtime. A variable is
	// only as good as its value, so the policy requires the locale to be
	// written at the call site.
	for (const source of [
		'const label = count.toLocaleString(undefined);',
		'const label = count.toLocaleString(LOCALE);',
		'const format = new Intl.NumberFormat(undefined);',
		'const format = new Intl.NumberFormat(LOCALE, opts);',
	]) {
		const violations = scanSource('src/example.ts', source);
		assert.equal(violations.length, 1, `expected exactly one finding for ${source}`);
		assert.match(
			violations[0].rule,
			/^(explicit-locale|intl-without-locale)$/,
			`unexpected rule for ${source}`,
		);
	}
});

test('scanSource handles several violations in one file, in line order', () => {
	const source = [
		'const a = 1;',
		"const b = text.normalize('NFKC');",
		'const c = 3;',
		'const d = slugify(t);',
	].join('\n');
	const violations = scanSource('src/example.ts', source);
	assert.deepEqual(
		violations.map((violation) => [violation.line, violation.rule]),
		[
			[2, 'no-compatibility-fold'],
			[2, 'no-implicit-normalize'],
			[4, 'no-lossy-derivation'],
		],
	);
});

test('formatViolation names the file, the line and what it saw', () => {
	const line = formatViolation({
		rule: 'explicit-locale',
		file: 'src/home/access/tiles.tsx',
		line: 253,
		snippet: 'count.toLocaleString()',
		message: 'pass an explicit locale',
	});
	assert.match(
		line,
		/^src\/home\/access\/tiles\.tsx:253 \[explicit-locale\] pass an explicit locale/,
	);
	assert.match(line, /saw: count\.toLocaleString\(\)/);
});

test('the shipped src/ tree satisfies the policy the gate enforces', () => {
	const files = collectScanFiles();
	assert.ok(files.length > 20, 'expected the scanner to see the repository source');
	const violations = files.flatMap((file) =>
		scanSource(toScanPath(file), readFileSync(file, 'utf8')),
	);
	assert.deepEqual(
		violations.map(formatViolation),
		[],
		'the shipped surface must not normalize, fold, or inherit a locale implicitly (Issue #433)',
	);
});

test('the shipped decision table agrees with the shipped policy', async () => {
	const policy = await loadPolicy();
	const rows = summarizeFixtures(policy);
	assert.equal(rows.length, policy.fixtures.UNICODE_FIXTURES.length);
	assert.deepEqual(fixtureMismatches(rows), []);
});

test('fixtureMismatches reports a row the policy stopped honouring', () => {
	const rows = [
		{
			id: 'example',
			verdicts: [
				{
					grammar: 'emoji-slug',
					ok: false,
					reason: 'non-ascii',
					expected: { outcome: 'accepted' },
				},
			],
		},
	];
	assert.deepEqual(fixtureMismatches(rows), [
		'example / emoji-slug: expected accepted, got rejected:non-ascii',
	]);
});

test('fixtureMismatches reports a grammar with no declared expectation', () => {
	const rows = [
		{ id: 'example', verdicts: [{ grammar: 'portfolio-slug', ok: true, reason: null }] },
	];
	assert.deepEqual(fixtureMismatches(rows), [
		'example: portfolio-slug has no declared expectation',
	]);
});
