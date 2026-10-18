/**
 * `scripts/check-css-syntax.mjs` — fixture suite (Issue #413).
 *
 * Every rule the CSS gate claims to enforce is proven here against a
 * synthetic repository laid out in a temp directory, plus one assertion
 * against the real repository's own surfaces. The fixtures are the
 * verifiable artefact the Issue asks for: a reader can see, without
 * running the shipped code against the shipped CSS, what fails, what
 * must not false-fail, and which mistakes are impossible to pass
 * silently.
 *
 * The fixtures deliberately reuse the shipped `quality/css-standards.json`
 * vocabulary, so a fixture that "passes" means the real vocabulary accepts
 * the notation — not that a second, looser vocabulary was invented for the
 * test.
 *
 * `node --test scripts/check-css-syntax.test.mjs`
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	ManifestError,
	formatReport,
	loadManifest,
	parseStylesheet,
	runCheck,
	tokenize,
} from './check-css-syntax.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(REPO_ROOT, 'scripts/check-css-syntax.mjs');
const SHIPPED_MANIFEST = join(REPO_ROOT, 'quality/css-standards.json');

/* ------------------------------------------------------------------ *
 * fixture harness
 * ------------------------------------------------------------------ */

/**
 * Lay out a synthetic repository: `src/fixture.css` plus the shipped
 * manifest with its Panda surface replaced by a `files` surface, so the
 * fixture exercises the same code path a real stylesheet does (walk →
 * parse → validate) without invoking Panda.
 */
function fixture(css, t, manifestPatch = {}) {
	const root = mkdtempSync(join(tmpdir(), 'my-web-css-fixture-'));
	t?.after(() => rmSync(root, { recursive: true, force: true }));
	const manifest = JSON.parse(readFileSync(SHIPPED_MANIFEST, 'utf8'));
	manifest.surfaces = [
		{
			id: 'fixture',
			kind: 'files',
			root: 'src/surface',
			extensions: ['.css'],
			role: 'fixture stylesheet',
			min_declarations: 1,
		},
	];
	// The coverage root is wider than the surface root on purpose: that is
	// what lets a stylesheet outside every surface be written and proven to
	// fail rather than to be silently unparsed.
	manifest.coverage = { root: 'src', extensions: ['.css'] };
	manifest.policy.min_declarations = 0;
	// A fixture sheet is a few lines of CSS, so the shipped waivers (all of
	// which are in use by the *real* surfaces) would all read as stale.
	// Each fixture therefore declares exactly the allowlist its own CSS
	// needs — which is also the honest way to prove `allow_unused` works:
	// an entry that matches nothing is a finding whatever produced it.
	const allowlist = {
		vendor_prefixes: [],
		properties: [],
		functions: [],
		at_rules: [],
		...(manifestPatch.allowlist ?? {}),
	};
	const merged = {
		...manifest,
		...manifestPatch,
		surfaces: manifestPatch.surfaces ?? manifest.surfaces,
		policy: { ...manifest.policy, ...(manifestPatch.policy ?? {}) },
		vocabulary: { ...manifest.vocabulary, ...(manifestPatch.vocabulary ?? {}) },
		allowlist,
	};
	mkdirSync(join(root, 'quality'), { recursive: true });
	mkdirSync(join(root, 'src/surface'), { recursive: true });
	writeFileSync(
		join(root, 'quality/css-standards.json'),
		`${JSON.stringify(merged, null, '\t')}\n`,
	);
	if (css !== null) writeFileSync(join(root, 'src/surface/fixture.css'), css);
	return { root, run: () => runCheck({ root, manifestPath: 'quality/css-standards.json' }) };
}

/** The shipped prefix rule, declared on the fixture surface. */
const PREFIX_RULE = {
	id: 'standard-vendor-prefix',
	prefixes: ['-webkit-', '-moz-', '-ms-', '-o-'],
	surfaces: ['fixture'],
	require_known_unprefixed: true,
	reason:
		'fixture: the same counterparty rule the shipped manifest uses — a prefix is only accepted when the unprefixed property is in the vocabulary',
	basis: 'https://www.w3.org/TR/css-variables-1/#vendor-prefixes',
};

const rules = (result) => result.errors.map((entry) => entry.rule);
const hasRule = (result, rule) => rules(result).includes(rule);

/* ------------------------------------------------------------------ *
 * 1. syntax errors fail
 * ------------------------------------------------------------------ */

const SYNTAX_FIXTURES = [
	{
		rule: 'unclosed_block',
		title: 'a rule that is never closed',
		css: '.a {\n  color: red;\n',
	},
	{
		rule: 'stray_close_brace',
		title: 'a `}` with no `{`',
		css: '.a { color: red; }\n}\n.b { color: blue; }\n',
	},
	{
		rule: 'missing_colon',
		title: 'a declaration without `:`',
		css: '.a { color red; }\n',
	},
	{
		rule: 'missing_semicolon',
		title: 'two declarations in one value (a dropped `;`)',
		css: '.a { color: red background-color: blue; }\n',
	},
	{
		rule: 'empty_value',
		title: 'a declaration with no value',
		css: '.a { color: ; }\n',
	},
	{
		rule: 'declaration_at_top_level',
		title: 'a declaration outside any rule',
		css: 'color: red;\n',
	},
	{
		rule: 'invalid_important',
		title: 'a priority keyword that is not `important`',
		css: '.a { color: red !imporant; }\n',
	},
	{
		rule: 'unterminated_comment',
		title: 'a comment with no `*/`',
		css: '/* never closed\n.a { color: red; }\n',
	},
	{
		rule: 'unterminated_string',
		title: 'a string with no closing quote',
		css: '.a::after { content: "oops; }\n',
	},
	{
		rule: 'bad_url',
		title: 'a `url(` with no `)`',
		css: '.a { background-image: url(/media/a.png; }\n',
	},
	{
		rule: 'invalid_keyframe_selector',
		title: 'a keyframe selector that is not from/to/<percentage>',
		css: '@keyframes roll {\n  0, 50% { opacity: 0; }\n}\n',
	},
	{
		rule: 'empty_selector',
		title: 'a block with no selector',
		css: '{ color: red; }\n',
	},
];

for (const fixtureCase of SYNTAX_FIXTURES) {
	test(`syntax: ${fixtureCase.title} fails with ${fixtureCase.rule}`, (t) => {
		const { run } = fixture(fixtureCase.css, t);
		const result = run();
		assert.equal(result.ok, false, `expected a failure for: ${fixtureCase.css}`);
		assert.ok(
			hasRule(result, fixtureCase.rule),
			`expected ${fixtureCase.rule}, got ${rules(result).join(', ') || '(none)'}`,
		);
	});
}

/* ------------------------------------------------------------------ *
 * 2. unknown vocabulary fails
 * ------------------------------------------------------------------ */

const VOCABULARY_FIXTURES = [
	{
		rule: 'unknown_property',
		title: 'a property no specification defines',
		css: '.a {\n  colr: red;\n}\n',
	},
	{
		rule: 'unknown_at_rule',
		title: 'an at-rule the project does not declare',
		css: '@paralax {\n  .a { color: red; }\n}\n',
	},
	{
		rule: 'unknown_function',
		title: 'a value function no specification defines',
		css: '.a {\n  transform: transl8te(4px);\n}\n',
	},
	{
		rule: 'invalid_enum_value',
		title: 'a keyword outside the property grammar',
		css: '.a {\n  position: fixedd;\n}\n',
	},
	{
		rule: 'descriptor_outside_font_face',
		title: 'a `@font-face` descriptor outside `@font-face`',
		css: '.a {\n  size-adjust: 94%;\n}\n',
	},
	{
		rule: 'property_not_allowed_in_font_face',
		title: 'an ordinary property inside `@font-face`',
		css: '@font-face {\n  font-family: "Fixture";\n  position: absolute;\n}\n',
	},
	{
		rule: 'invalid_at_rule_prelude',
		title: 'a media query written as a declaration',
		css: '@media min-width: 40rem {\n  .a { color: red; }\n}\n',
	},
	{
		rule: 'nonempty_at_rule_prelude',
		title: 'a prelude on an at-rule that takes none',
		css: '@font-face "Fixture" {\n  font-family: "Fixture";\n}\n',
	},
	{
		rule: 'invalid_at_rule_prelude',
		title: 'a `@supports` block with no condition',
		css: '@supports {\n  .a { color: red; }\n}\n',
	},
	{
		rule: 'invalid_at_rule_prelude',
		title: 'a `@property` rule without a custom property name',
		css: '@property color {\n  syntax: "<color>";\n}\n',
	},
];

for (const fixtureCase of VOCABULARY_FIXTURES) {
	test(`vocabulary: ${fixtureCase.title} fails with ${fixtureCase.rule}`, (t) => {
		const { run } = fixture(fixtureCase.css, t);
		const result = run();
		assert.equal(result.ok, false);
		assert.ok(
			hasRule(result, fixtureCase.rule),
			`expected ${fixtureCase.rule}, got ${rules(result).join(', ') || '(none)'}`,
		);
	});
}

/* ------------------------------------------------------------------ *
 * 3. accepted notation must not false-fail
 * ------------------------------------------------------------------ */

const ACCEPTED_FIXTURES = [
	{
		title: 'vendor prefixes whose unprefixed property is in the vocabulary',
		allowlist: { vendor_prefixes: [PREFIX_RULE] },
		css: [
			'.a {',
			'  -webkit-text-size-adjust: 100%;',
			'  -moz-tab-size: 4;',
			'  -webkit-appearance: none;',
			'  tab-size: 4;',
			'}',
			'',
		].join('\n'),
	},
	{
		title: 'an allowlisted engine-specific property',
		css: '.a {\n  -webkit-font-smoothing: antialiased;\n}\n',
		allowlist: {
			properties: [
				{
					id: 'fixture-webkit-font-smoothing',
					name: '-webkit-font-smoothing',
					kind: 'engine-specific',
					surfaces: ['fixture'],
					reason:
						'fixture: the same engine-only property the shipped manifest waives, scoped to the fixture surface',
					basis: 'https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-font-smoothing',
				},
			],
		},
	},
	{
		title: 'custom properties, including an empty value',
		css: ':root {\n  --blur: ;\n  --made-with-panda: "panda";\n}\n.a { filter: var(--blur); }\n',
	},
	{
		title: 'CSS-wide keywords and var() in an enumerated property',
		css: '.a { position: inherit; }\n.b { position: var(--where); }\n.c { box-sizing: initial; }\n',
	},
	{
		title: 'an enumerated value written as a keyword list',
		css: ':root { color-scheme: light dark; }\n.a { color-scheme: only dark; }\n',
	},
	{
		title: '@layer as a statement and as a block, with @media inside',
		css: [
			'@layer reset, base, tokens;',
			'@layer base {',
			'  .a { color: red; }',
			'  @media (prefers-color-scheme: dark) {',
			'    .a { color: white; }',
			'  }',
			'}',
			'',
		].join('\n'),
	},
	{
		title: '@keyframes with from/to, percentages and a comma list',
		css: [
			'@keyframes roll {',
			'  from { opacity: 0; }',
			'  60% { opacity: 1; }',
			'  75%,100% { opacity: 0; }',
			'}',
			'',
		].join('\n'),
	},
	{
		title: 'escaped Panda class names in a selector',
		css: [
			'  .grid-tc_minmax\\(0\\,_2fr\\)_auto_auto {',
			'    grid-template-columns: repeat(2, minmax(0, 1fr));',
			'}',
			'  .sm\\:text-red {',
			'    color: red;',
			'}',
			'',
		].join('\n'),
	},
	{
		title: 'a last declaration without its semicolon, and a nested rule',
		css: '.a {\n  color: red\n}\n.b {\n  color: blue;\n  &:hover { color: green; }\n}\n',
	},
	{
		title: 'CSS nesting inside @media and an empty rule',
		css: '@media (min-width: 40rem) {\n  .a { color: red; }\n}\n.b {}\n',
	},
	{
		title: '@font-face descriptors, including url() and local()',
		css: [
			'@font-face {',
			'  font-family: "Fixture Fallback";',
			'  src: local("Fixture W3");',
			'  font-weight: 400;',
			'  size-adjust: 94%;',
			'  ascent-override: 123%;',
			'  descent-override: 30%;',
			'}',
			'',
		].join('\n'),
	},
	{
		title: 'comments everywhere (including inside a declaration list)',
		css: '/* lead */\n.a /* mid */ {\n  /* pre */ color: red; /* post */\n}\n',
	},
];

for (const fixtureCase of ACCEPTED_FIXTURES) {
	test(`accepted: ${fixtureCase.title} passes`, (t) => {
		const { run } = fixture(fixtureCase.css, t, {
			...(fixtureCase.allowlist ? { allowlist: fixtureCase.allowlist } : {}),
		});
		const result = run();
		assert.deepEqual(
			result.errors,
			[],
			`expected no findings, got:\n${result.errors.map((entry) => `  ${entry.rule}: ${entry.message}`).join('\n')}`,
		);
		assert.equal(result.ok, true);
	});
}

/* ------------------------------------------------------------------ *
 * 4. no silent pass
 * ------------------------------------------------------------------ */

test('no silent pass: a surface that validates nothing fails (surface_empty)', (t) => {
	const { run } = fixture('/* only a comment */\n', t);
	const result = run();
	assert.equal(result.ok, false);
	assert.ok(hasRule(result, 'surface_empty'));
});

test('no silent pass: a stylesheet owned by no surface fails (surface_uncovered)', (t) => {
	const { root, run } = fixture('.a { color: red; }\n', t);
	mkdirSync(join(root, 'src/elsewhere'), { recursive: true });
	writeFileSync(join(root, 'src/elsewhere/second.css'), '.b { color: blue; }\n');
	const result = run();
	assert.equal(result.ok, false);
	assert.ok(hasRule(result, 'surface_uncovered'));
	assert.match(
		result.errors.find((entry) => entry.rule === 'surface_uncovered').message,
		/src\/elsewhere\/second\.css/,
	);
});

test('no silent pass: a total declaration count under the policy floor fails', (t) => {
	const { run } = fixture('.a { color: red; }\n', t, { policy: { min_declarations: 1000 } });
	const result = run();
	assert.equal(result.ok, false);
	assert.ok(hasRule(result, 'vocabulary_underfloor'));
});

test('no silent pass: an allowlist entry that waives nothing fails (allow_unused)', (t) => {
	const { run } = fixture('.a { color: red; }\n', t, {
		allowlist: {
			properties: [
				{
					id: 'stale-waiver',
					name: '-webkit-made-up',
					kind: 'engine-specific',
					surfaces: ['fixture'],
					reason: 'fixture: an entry nobody re-reviews any more must not survive silently',
					basis: 'https://example.invalid/stale',
				},
			],
		},
	});
	const result = run();
	assert.equal(result.ok, false);
	assert.ok(hasRule(result, 'allow_unused'));
	assert.match(
		result.errors.find((entry) => entry.rule === 'allow_unused').message,
		/stale-waiver/,
	);
});

test('no silent pass: a vendor prefix with no spec-defined counterpart fails', (t) => {
	const { run } = fixture('.a {\n  -webkit-totally-made-up: 1;\n}\n', t, {
		allowlist: { vendor_prefixes: [PREFIX_RULE] },
	});
	const result = run();
	assert.equal(result.ok, false);
	assert.ok(hasRule(result, 'vendor_prefix_unresolved'));
	assert.match(
		result.errors.find((entry) => entry.rule === 'vendor_prefix_unresolved').message,
		/totally-made-up/,
	);
});

test('no silent pass: an allowlist entry scoped to another surface does not waive here', (t) => {
	const { run } = fixture('.a {\n  -webkit-font-smoothing: antialiased;\n}\n', t, {
		surfaces: [
			{
				id: 'fixture',
				kind: 'files',
				root: 'src/surface',
				extensions: ['.css'],
				role: 'fixture stylesheet',
				min_declarations: 1,
			},
			{
				id: 'other',
				kind: 'files',
				root: 'other',
				extensions: ['.other'],
				role: 'a surface this fixture never feeds',
				min_declarations: 0,
			},
		],
		allowlist: {
			properties: [
				{
					id: 'other-surface',
					name: '-webkit-font-smoothing',
					kind: 'engine-specific',
					surfaces: ['other'],
					reason: 'fixture: the waiver is scoped to a surface that does not include this CSS',
					basis: 'https://example.invalid/other-surface',
				},
			],
		},
	});
	const result = run();
	assert.equal(result.ok, false);
	assert.ok(hasRule(result, 'unknown_property'));
});

/* ------------------------------------------------------------------ *
 * 5. manifest integrity
 * ------------------------------------------------------------------ */

test('manifest: an empty vocabulary is a manifest error, not a pass', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'my-web-css-manifest-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, 'css-standards.json');
	writeFileSync(
		path,
		JSON.stringify({ schema_version: 1, policy: { name: 'x', min_declarations: 1 } }),
	);
	assert.throws(() => loadManifest(path), ManifestError);
});

test('manifest: a property listed by two spec modules is a manifest error', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'my-web-css-manifest-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, 'css-standards.json');
	writeFileSync(
		path,
		JSON.stringify({
			schema_version: 1,
			policy: { name: 'x', min_declarations: 1 },
			surfaces: [{ id: 's', kind: 'inline', role: 'r', min_declarations: 0, path: 'a.css' }],
			coverage: { root: 'src', extensions: ['.css'] },
			vocabulary: {
				properties: { 'https://a.invalid/': ['color'], 'https://b.invalid/': ['color'] },
				at_rules: { none: ['font-face'] },
				functions: ['var'],
				enum_values: {},
			},
			allowlist: { vendor_prefixes: [], properties: [], functions: [], at_rules: [] },
		}),
	);
	assert.throws(() => loadManifest(path), /two spec modules/);
});

test('manifest: a prefix rule without the unprefixed-counterparty requirement is rejected', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'my-web-css-manifest-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, 'css-standards.json');
	writeFileSync(
		path,
		JSON.stringify({
			schema_version: 1,
			policy: { name: 'x', min_declarations: 1 },
			surfaces: [{ id: 's', kind: 'inline', role: 'r', min_declarations: 0, path: 'a.css' }],
			coverage: { root: 'src', extensions: ['.css'] },
			vocabulary: {
				properties: { 'https://a.invalid/': ['color'] },
				at_rules: { none: ['font-face'] },
				functions: ['var'],
				enum_values: {},
			},
			allowlist: {
				vendor_prefixes: [
					{
						id: 'p',
						prefixes: ['-webkit-'],
						surfaces: ['s'],
						reason: 'x'.repeat(50),
						basis: 'https://a.invalid/',
					},
				],
				properties: [],
				functions: [],
				at_rules: [],
			},
		}),
	);
	assert.throws(() => loadManifest(path), /require_known_unprefixed/);
});

test('manifest: a waiver without a reason is rejected (no blanket suppressions)', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'my-web-css-manifest-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, 'css-standards.json');
	writeFileSync(
		path,
		JSON.stringify({
			schema_version: 1,
			policy: { name: 'x', min_declarations: 1 },
			surfaces: [{ id: 's', kind: 'inline', role: 'r', min_declarations: 0, path: 'a.css' }],
			coverage: { root: 'src', extensions: ['.css'] },
			vocabulary: {
				properties: { 'https://a.invalid/': ['color'] },
				at_rules: { none: ['font-face'] },
				functions: ['var'],
				enum_values: {},
			},
			allowlist: {
				vendor_prefixes: [],
				properties: [
					{
						id: 'p',
						name: '-x-made-up',
						kind: 'engine-specific',
						surfaces: ['s'],
						reason: 'too short',
						basis: 'https://a.invalid/',
					},
				],
				functions: [],
				at_rules: [],
			},
		}),
	);
	assert.throws(() => loadManifest(path), /reason/);
});

/* ------------------------------------------------------------------ *
 * 6. tokenizer / parser units and the real repository
 * ------------------------------------------------------------------ */

test('tokenizer: an escaped class name is one ident, not a function call', () => {
	const { tokens } = tokenize('.grid-tc_minmax\\(0\\,_2fr\\)_auto_auto { color: red; }');
	const selectors = tokens.filter((token) => token.type === 'ident' || token.type === 'function');
	assert.deepEqual(
		selectors.slice(0, 2).map((token) => `${token.type}:${token.value}`),
		['ident:grid-tc_minmax(0,_2fr)_auto_auto', 'ident:color'],
	);
	assert.equal(
		tokens.some((token) => token.type === 'function'),
		false,
		'an escaped `\\(` must not open a function block',
	);
});

test('tokenizer: a hex escape decodes to the code point it names', () => {
	const { tokens } = tokenize('.a\\3A b { color: red; }');
	const ident = tokens.find((token) => token.type === 'ident');
	assert.equal(ident.value, 'a:b');
});

test('parser: a comma-separated keyframe selector list is one rule', () => {
	const parsed = parseStylesheet('@keyframes roll { 0%,100% { opacity: 0; } }');
	assert.deepEqual(parsed.diagnostics, []);
	assert.equal(parsed.stats.rules, 1);
	assert.equal(parsed.stats.declarations, 1);
});

test('parser: the shipped stylesheets parse with no diagnostics', () => {
	const stylesheet = readFileSync(join(REPO_ROOT, 'src/styles.css'), 'utf8');
	const parsed = parseStylesheet(stylesheet);
	assert.deepEqual(parsed.diagnostics, []);
	assert.ok(
		parsed.stats.declarations > 20,
		`expected the real sheet to declare, got ${parsed.stats.declarations}`,
	);
});

test('repository: the gate passes against the real surfaces', () => {
	const result = runCheck({ root: REPO_ROOT });
	assert.deepEqual(
		result.errors,
		[],
		`the shipped CSS must pass its own gate:\n${result.errors.map((entry) => `  ${entry.rule}: ${entry.message}`).join('\n')}`,
	);
	assert.ok(result.stats.declarations > 0);
	assert.ok(
		result.allowRows.every((row) => row.uses.length > 0),
		'no allowlist entry may be dead',
	);
	const report = formatReport(result);
	assert.match(report, /Issue #413/);
	assert.doesNotMatch(report, /FAIL/);
});

test('cli: the gate exits 0 on the repository and 1 with --json findings', () => {
	const ok = spawnSync(process.execPath, [CHECKER, '--json'], { cwd: REPO_ROOT, encoding: 'utf8' });
	assert.equal(ok.status, 0, ok.stderr);
	const payload = JSON.parse(ok.stdout);
	assert.equal(payload.ok, true);
	assert.equal(payload.errors.length, 0);
});
