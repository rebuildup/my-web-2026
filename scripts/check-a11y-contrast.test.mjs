/**
 * The Issue #399 gate's own unit tests.
 *
 * The gate is the machine half of the Issue ("比率を機械で計測し、基準を
 * 下回る組み合わせだけを直す"), so the arithmetic, the token resolution and
 * the fixture expectations have to be testable without a browser: a rule
 * that can only fail inside a capture is a rule nobody re-runs when it
 * breaks.
 */

import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	APPEARANCES,
	CONTRAST_PAIRS,
	CONTRAST_RULES,
	EXCLUDED_TOKENS,
	FIXTURE_FAIL_DIR,
	FIXTURE_MIN_FILES,
	FIXTURE_PASS_DIR,
	FIXTURE_ROOT,
	HUMAN_EVALUATION,
	RULES,
	THRESHOLDS,
	UNRESOLVED_RULE,
	auditFixture,
	auditPairs,
	collectEvidence,
	contrastRatio,
	formatRatio,
	parseHexColor,
	relativeLuminance,
	renderGateSummary,
	resolveFixtureColor,
	resolveRawColor,
	resolveSemanticValue,
} from './check-a11y-contrast.mjs';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

/* ------------------------------------------------------------------ *
 * colour arithmetic
 * ------------------------------------------------------------------ */

test('a hex literal parses into 8-bit channels', () => {
	assert.deepEqual(parseHexColor('#ffffff'), { r: 255, g: 255, b: 255 });
	assert.deepEqual(parseHexColor('#0f172a'), { r: 15, g: 23, b: 42 });
	assert.deepEqual(parseHexColor('#fff'), { r: 255, g: 255, b: 255 });
	assert.equal(parseHexColor('rebeccapurple'), null);
	assert.equal(parseHexColor('#12345'), null);
	assert.equal(parseHexColor(undefined), null);
});

test('the relative luminance follows the WCAG formula', () => {
	assert.equal(relativeLuminance({ r: 255, g: 255, b: 255 }), 1);
	assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0);
	// The mid grey of the sRGB ramp is well below the linear 0.5 value.
	assert.ok(relativeLuminance({ r: 128, g: 128, b: 128 }) < 0.25);
});

test('the contrast ratio is symmetric and reaches 21:1', () => {
	assert.equal(Math.round(contrastRatio('#ffffff', '#000000')), 21);
	assert.equal(contrastRatio('#ffffff', '#000000'), contrastRatio('#000000', '#ffffff'));
	assert.equal(contrastRatio('#123456', '#123456'), 1);
	assert.equal(contrastRatio('#not-a-colour', '#000000'), null);
});

test('the reported ratio is rounded DOWN to two decimals', () => {
	// A value that rounds up would be printed as a pass it does not have.
	assert.equal(formatRatio(4.499999), '4.49');
	assert.equal(formatRatio(4.5), '4.50');
	assert.equal(formatRatio(null), 'n/a');
});

/* ------------------------------------------------------------------ *
 * token resolution
 * ------------------------------------------------------------------ */

test('a raw token resolves through its dotted path', () => {
	const rawTokens = { colors: { brand: { 700: { value: '#0369a1' } } } };
	assert.equal(resolveRawColor(rawTokens, 'colors.brand.700'), '#0369a1');
	assert.equal(resolveRawColor(rawTokens, 'colors.brand.999'), null);
	assert.equal(resolveRawColor(rawTokens, 'colors.nope'), null);
});

test('a semantic token resolves per appearance condition', () => {
	const semanticTokens = {
		colors: {
			text: {
				muted: { value: { base: '{colors.neutral.600}', _dark: '{colors.charcoal.400}' } },
			},
		},
	};
	assert.equal(
		resolveSemanticValue(semanticTokens, 'text.muted', 'base').reference,
		'colors.neutral.600',
	);
	assert.equal(
		resolveSemanticValue(semanticTokens, 'text.muted', '_dark').reference,
		'colors.charcoal.400',
	);
	assert.equal(
		resolveSemanticValue(semanticTokens, 'text.muted', 'base').raw,
		'{colors.neutral.600}',
	);
	assert.equal(resolveSemanticValue(semanticTokens, 'text.nope', 'base').reference, null);
});

test('the shipped token modules resolve every token the matrix names', async () => {
	const evidence = await collectEvidence();
	const unresolved = evidence.violations.filter((entry) => entry.rule === UNRESOLVED_RULE);
	assert.deepEqual(unresolved, []);
	assert.equal(evidence.rows.length, CONTRAST_PAIRS.length * APPEARANCES.length);
});

/* ------------------------------------------------------------------ *
 * the pair matrix
 * ------------------------------------------------------------------ */

test('the matrix declares the pairs the Issue names, with the SC thresholds', () => {
	const wanted = [
		['text.default', 'bg.canvas', 4.5],
		['text.default', 'bg.surface', 4.5],
		['text.default', 'bg.subtle', 4.5],
		['text.muted', 'bg.canvas', 4.5],
		['text.muted', 'bg.surface', 4.5],
		['text.muted', 'accent.surface', 4.5],
		['text.inverse', 'bg.accent', 4.5],
		['text.inverse', 'bg.inverse', 4.5],
		['text.accent', 'bg.canvas', 4.5],
		['accent.positive', 'bg.canvas', 4.5],
		['accent.negative', 'bg.canvas', 4.5],
		['accent.warning', 'bg.canvas', 4.5],
		['accent.category.design', 'bg.canvas', 3],
		['accent.category.code', 'bg.canvas', 3],
		['accent.category.writing', 'bg.canvas', 3],
		['accent.category.tool', 'bg.canvas', 3],
		['border.focus', 'bg.canvas', 3],
		['border.strong', 'bg.canvas', 3],
	];
	for (const [fg, bg, threshold] of wanted) {
		const pair = CONTRAST_PAIRS.find((entry) => entry.fg === fg && entry.bg === bg);
		assert.ok(pair, `${fg} on ${bg} is missing from the matrix`);
		assert.equal(pair.threshold, threshold);
		assert.equal(pair.threshold, THRESHOLDS[pair.kind]);
		assert.ok(pair.note.length > 5, `${fg} on ${bg} needs a note`);
	}
});

test('the excluded token is stated with a reason, not dropped silently', () => {
	const subtle = EXCLUDED_TOKENS.find((entry) => entry.token === 'border.subtle');
	assert.ok(subtle);
	assert.match(subtle.reason, /decorative/);
});

test('a pair below the threshold is a violation with the matching rule', () => {
	const rawTokens = { colors: { a: { value: '#cccccc' }, b: { value: '#ffffff' } } };
	const semanticTokens = {
		colors: {
			fg: { value: { base: '{colors.a}', _dark: '{colors.a}' } },
			bg: { value: { base: '{colors.b}', _dark: '{colors.b}' } },
		},
	};
	const audited = auditPairs({
		rawTokens,
		semanticTokens,
		pairs: [{ fg: 'fg', bg: 'bg', kind: 'normal', threshold: 4.5, note: 'test' }],
		appearances: [APPEARANCES[0]],
	});
	assert.equal(audited.violations.length, 1);
	assert.equal(audited.violations[0].rule, CONTRAST_RULES.normal);
	assert.equal(audited.violations[0].appearance, 'light');
	assert.match(audited.violations[0].message, /below the 4\.5:1/);
});

test('a reference that does not resolve is a violation, never a guess', () => {
	const rawTokens = { colors: { b: { value: '#ffffff' } } };
	const semanticTokens = {
		colors: {
			fg: { value: { base: '{colors.missing}', _dark: '{colors.missing}' } },
			bg: { value: { base: '{colors.b}', _dark: '{colors.b}' } },
		},
	};
	const audited = auditPairs({
		rawTokens,
		semanticTokens,
		pairs: [{ fg: 'fg', bg: 'bg', kind: 'normal', threshold: 4.5, note: 'test' }],
		appearances: [APPEARANCES[0]],
	});
	assert.equal(audited.violations.length, 1);
	assert.equal(audited.violations[0].rule, UNRESOLVED_RULE);
	assert.match(audited.violations[0].message, /colors\.missing/);
});

test('both appearances are measured, and a failure names the appearance', () => {
	const rawTokens = { colors: { a: { value: '#ffffff' }, b: { value: '#000000' } } };
	const semanticTokens = {
		colors: {
			fg: { value: { base: '{colors.a}', _dark: '{colors.b}' } },
			bg: { value: { base: '{colors.a}', _dark: '{colors.b}' } },
		},
	};
	const audited = auditPairs({
		rawTokens,
		semanticTokens,
		pairs: [{ fg: 'fg', bg: 'bg', kind: 'normal', threshold: 4.5, note: 'test' }],
	});
	assert.equal(audited.violations.length, 2);
	assert.deepEqual(
		audited.violations.map((entry) => entry.appearance),
		['light', 'dark'],
	);
});

/* ------------------------------------------------------------------ *
 * the fixtures
 * ------------------------------------------------------------------ */

test('a fixture colour may be a literal, a raw reference or a semantic token', () => {
	const rawTokens = { colors: { brand: { 700: { value: '#0369a1' } } } };
	const semanticTokens = {
		colors: {
			text: { accent: { value: { base: '{colors.brand.700}', _dark: '{colors.brand.700}' } } },
		},
	};
	assert.equal(resolveFixtureColor('#ffffff', { rawTokens, semanticTokens }), '#ffffff');
	assert.equal(resolveFixtureColor('{colors.brand.700}', { rawTokens, semanticTokens }), '#0369a1');
	assert.equal(resolveFixtureColor('text.accent', { rawTokens, semanticTokens }), '#0369a1');
	assert.equal(resolveFixtureColor('text.nope', { rawTokens, semanticTokens }), null);
});

test('a `pass` fixture pair that misses the threshold is a violation', () => {
	const audited = auditFixture(
		{
			pairs: [
				{ id: 'x', fg: '#94a3b8', bg: '#ffffff', kind: 'normal', threshold: 4.5, expect: 'pass' },
			],
		},
		{ rawTokens: {}, semanticTokens: {}, file: 'fixture.json' },
	);
	assert.equal(audited.violations.length, 1);
	assert.equal(audited.violations[0].rule, CONTRAST_RULES.normal);
	assert.equal(audited.violations[0].file, 'fixture.json');
});

test('a `fail` fixture pair is a DETECTION, not a gate violation', () => {
	const audited = auditFixture(
		{
			pairs: [
				{ id: 'x', fg: '#94a3b8', bg: '#ffffff', kind: 'normal', threshold: 4.5, expect: 'fail' },
			],
		},
		{ rawTokens: {}, semanticTokens: {}, file: 'fixture.json' },
	);
	assert.deepEqual(audited.violations, []);
	assert.equal(audited.detections.length, 1);
	assert.equal(audited.detections[0].rule, CONTRAST_RULES.normal);
});

test('a `fail` fixture pair that unexpectedly passes is a mismatch', () => {
	const audited = auditFixture(
		{
			pairs: [
				{ id: 'x', fg: '#000000', bg: '#ffffff', kind: 'normal', threshold: 4.5, expect: 'fail' },
			],
		},
		{ rawTokens: {}, semanticTokens: {}, file: 'fixture.json' },
	);
	assert.equal(audited.violations.length, 1);
	assert.equal(audited.violations[0].rule, 'fixture-expectation-mismatch');
	assert.equal(audited.detections.length, 0);
});

test('the repository carries at least two fixture files in each directory', () => {
	for (const directory of [FIXTURE_PASS_DIR, FIXTURE_FAIL_DIR]) {
		const files = readdirSync(join(REPO_ROOT, directory)).filter((name) => name.endsWith('.json'));
		assert.ok(files.length >= FIXTURE_MIN_FILES, `${directory} needs ${FIXTURE_MIN_FILES} files`);
	}
});

test('the shipped `pass` fixtures hold no violation and the `fail` fixtures are detected', async () => {
	const evidence = await collectEvidence();
	for (const file of evidence.fixtures) {
		if (file.expectation === 'pass') {
			assert.deepEqual(
				file.violations,
				[],
				`${file.path} claims to pass and does not: ${JSON.stringify(file.violations)}`,
			);
			assert.equal(file.detections.length, 0);
		} else {
			assert.ok(file.detections.length > 0, `${file.path} claims to fail but nothing was detected`);
			for (const detection of file.detections) {
				assert.ok(RULES.includes(detection.rule));
			}
		}
	}
});

/* ------------------------------------------------------------------ *
 * the report and the repository state
 * ------------------------------------------------------------------ */

test('the shipped repository passes the contrast contract', async () => {
	const evidence = await collectEvidence();
	assert.deepEqual(
		evidence.violations,
		[],
		`the shipped token layer has contrast violations: ${JSON.stringify(evidence.violations)}`,
	);
});

test('the report separates machine-checked facts from human evaluation', async () => {
	const report = renderGateSummary(await collectEvidence());
	assert.match(report, /machine-checked:/);
	assert.match(report, /not machine-checked \(human evaluation\):/);
	assert.ok(report.indexOf('machine-checked:') < report.indexOf('not machine-checked'));
	assert.match(report, /SC 1\.4\.3/);
	assert.match(report, /border\.subtle/);
	for (const item of HUMAN_EVALUATION) assert.ok(report.includes(item));
});

test('every rule the gate can report is declared', () => {
	for (const rule of Object.values(CONTRAST_RULES)) assert.ok(RULES.includes(rule));
	assert.ok(RULES.includes(UNRESOLVED_RULE));
	assert.ok(RULES.includes('fixture-expectation-mismatch'));
	assert.ok(RULES.includes('fixture-contract-missing'));
});

test('the fixture root is the one the Issue names', () => {
	assert.equal(FIXTURE_ROOT, 'scripts/fixtures/a11y-contrast');
});
