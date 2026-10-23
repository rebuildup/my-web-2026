/**
 * The Issue #400 gate's own unit tests.
 *
 * The gate is the static half of the Issue ("長文 / 言語拡張 fixture を
 * 静的検査と Chromium 実測の 2 段で判定する"), so the rules have to be
 * testable without a browser: a rule that can only fail inside a real page
 * is a rule nobody re-runs when it breaks.
 *
 * The fixture assertions are deliberately strict. A test that only checked
 * "the fixture produced some output" would pass after a fixture file was
 * deleted or after the fixture stopped reproducing its defect, so the
 * roster is compared with the directory listing and every fail fixture is
 * matched against the rule it stands for.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	BASE_SELECTOR,
	BASE_STYLES_PATH,
	BREAK_DECLARATIONS,
	FIXTURE_EXPECTATIONS,
	FIXTURE_ROOT,
	HUMAN_EVALUATION,
	REFLOW_BUDGET_PX,
	RULES,
	UNBREAKABLE_KINDS,
	auditFixtureFiles,
	breakDeclarationsIn,
	collectEvidence,
	evaluateFixtureSource,
	fixedWidthsIn,
	forbidsWrapIn,
	hasBreakBoundary,
	renderGateSummary,
	specimenKindsIn,
} from './check-a11y-reflow.mjs';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

/** Scan a source snippet the way the gate scans a fixture. */
function scan(source) {
	return evaluateFixtureSource({ relativePath: 'scripts/fixtures/a11y-reflow/pass/x.tsx', source });
}

const SPECIMEN = (kind, style) =>
	`export const A = () => (<div data-reflow-specimen="x" data-reflow-kind="${kind}" style={${style}}>Content</div>);`;

test('every break declaration is recognised', () => {
	for (const declaration of BREAK_DECLARATIONS) {
		assert.equal(
			hasBreakBoundary(`${declaration.property}: ${declaration.value};`),
			true,
			`${declaration.property}: ${declaration.value} must count`,
		);
	}
	// The React / Panda object-key spelling counts too.
	assert.equal(hasBreakBoundary("overflowWrap: 'anywhere'"), true);
	assert.equal(hasBreakBoundary("wordBreak: 'break-all'"), true);
});

test('a value that is not a break boundary does not count', () => {
	assert.equal(hasBreakBoundary('overflow-wrap: normal'), false);
	assert.equal(hasBreakBoundary("wordBreak: 'keep-all'"), false);
	assert.equal(hasBreakBoundary('white-space: nowrap'), false);
});

test('a break boundary named only in a comment is documentation, not a declaration', () => {
	const source = `/** overflow-wrap: anywhere would fix this */\n${SPECIMEN('long-url', '{}')}`;
	assert.deepEqual(scan(source).breaks, []);
	assert.equal(
		scan(source)
			.violations.map((violation) => violation.rule)
			.includes('reflow-specimen-without-break'),
		true,
	);
});

test('an unbreakable specimen with a break boundary passes', () => {
	const result = scan(SPECIMEN('long-word', "{ overflowWrap: 'anywhere' }"));
	assert.deepEqual(result.violations, []);
	assert.deepEqual(result.kinds, ['long-word']);
});

test('an unbreakable specimen without a break boundary is a violation', () => {
	const result = scan(SPECIMEN('long-url', '{}'));
	assert.equal(result.violations.length, 1);
	assert.equal(result.violations[0].rule, 'reflow-specimen-without-break');
	assert.equal(result.violations[0].wcag, '1.4.10');
	assert.match(result.violations[0].message, /break boundary/);
});

test('a fixed width wider than the budget is a violation', () => {
	const result = scan(SPECIMEN('long-word', "{ overflowWrap: 'anywhere', minWidth: '640px' }"));
	assert.equal(result.violations.length, 1);
	assert.equal(result.violations[0].rule, 'reflow-specimen-fixed-width');
	assert.match(result.violations[0].message, /640px/);
});

test('the budget itself is not a violation, and a percentage is not comparable', () => {
	assert.deepEqual(fixedWidthsIn('min-width: 320px'), []);
	assert.deepEqual(
		fixedWidthsIn('width: 321px').map((entry) => entry.px),
		[321],
	);
	assert.deepEqual(fixedWidthsIn("maxWidth: '100%'"), []);
	assert.deepEqual(fixedWidthsIn("minWidth: '40rem'"), []);
});

test('wrapping forbidden on unbreakable content is a violation', () => {
	const result = scan(SPECIMEN('long-url', "{ overflowWrap: 'anywhere', whiteSpace: 'nowrap' }"));
	assert.deepEqual(
		result.violations.map((violation) => violation.rule),
		['reflow-specimen-nowrap'],
	);
	assert.equal(forbidsWrapIn('white-space: pre'), true);
	assert.equal(forbidsWrapIn('white-space: normal'), false);
});

test('only the declared specimen kinds count', () => {
	const source = `data-reflow-kind="long-word" data-reflow-kind="not-a-kind"`;
	assert.deepEqual(specimenKindsIn(source), ['long-word']);
	for (const kind of UNBREAKABLE_KINDS) {
		assert.ok(specimenKindsIn(`data-reflow-kind="${kind}"`).length === 1);
	}
});

test('every rule the Issue names is a rule the gate knows', () => {
	for (const rule of [
		'reflow-wrap-floor-missing',
		'reflow-specimen-without-break',
		'reflow-specimen-fixed-width',
		'reflow-specimen-nowrap',
	]) {
		assert.ok(RULES.includes(rule), `${rule} must be a known rule`);
	}
});

test('the fixture roster matches the fixture directory exactly', () => {
	for (const [directory, expectations] of Object.entries(FIXTURE_EXPECTATIONS)) {
		const absolute = join(REPO_ROOT, FIXTURE_ROOT, directory);
		const present = readdirSync(absolute)
			.filter((name) => name.endsWith('.tsx'))
			.sort();
		const expected = Object.keys(expectations).sort();

		assert.deepEqual(present, expected, `the ${directory} fixture roster drifted`);
		assert.ok(present.length >= 2, `the ${directory} fixture needs at least two files`);
	}
});

test('every pass fixture produces no violation and holds a specimen', () => {
	for (const [name] of Object.entries(FIXTURE_EXPECTATIONS.pass)) {
		const file = join(REPO_ROOT, FIXTURE_ROOT, 'pass', name);
		const result = evaluateFixtureSource({
			relativePath: `${FIXTURE_ROOT}/pass/${name}`,
			source: readFileSync(file, 'utf8'),
		});

		assert.deepEqual(
			result.violations.map((violation) => violation.rule),
			[],
			`${name} must stay a pass fixture`,
		);
		assert.ok(result.kinds.length > 0, `${name} must declare a specimen kind`);
	}
});

test('every fail fixture reproduces exactly the rule it stands for', () => {
	for (const [name, expectedRules] of Object.entries(FIXTURE_EXPECTATIONS.fail)) {
		const file = join(REPO_ROOT, FIXTURE_ROOT, 'fail', name);
		const result = evaluateFixtureSource({
			relativePath: `${FIXTURE_ROOT}/fail/${name}`,
			source: readFileSync(file, 'utf8'),
		});

		assert.deepEqual(
			result.violations.map((violation) => violation.rule),
			expectedRules,
			`${name} must reproduce ${expectedRules.join(', ')}`,
		);
	}
});

test('an emptied pass fixture is reported instead of passing silently', () => {
	const audited = auditFixtureFiles([
		{
			directory: 'pass',
			name: 'empty.tsx',
			relativePath: `${FIXTURE_ROOT}/pass/empty.tsx`,
			expectedRules: [],
			evaluation: {
				kinds: [],
				breaks: [],
				fixedWidths: [],
				forbidsWrap: false,
				violations: [],
			},
			kindCount: 0,
		},
	]);

	assert.equal(audited.violations.length, 1);
	assert.equal(audited.violations[0].rule, 'fixture-pass-no-specimen');
});

test('the shipped base stylesheet carries the wrap floor', () => {
	const evidence = collectEvidence();

	assert.deepEqual(evidence.base.violations, []);
	assert.ok(evidence.base.breaks.length > 0, `${BASE_SELECTOR} must declare a break boundary`);
	assert.equal(evidence.base.selector, BASE_SELECTOR);
	assert.equal(BASE_STYLES_PATH, 'src/styles.css');
});

test('the shipped repository passes the gate', () => {
	const evidence = collectEvidence();

	assert.deepEqual(evidence.violations, []);
	assert.equal(evidence.fixture.violations.length, 0);
	assert.equal(evidence.fixture.rows.length, 6);
});

test('the report separates machine-checked facts from human evaluation', () => {
	const report = renderGateSummary(collectEvidence());

	assert.match(report, /machine-checked:/);
	assert.match(report, /not machine-checked \(human evaluation\):/);
	assert.ok(report.indexOf('machine-checked:') < report.indexOf('not machine-checked'));
	assert.match(report, /SC 1\.4\.10/);
	assert.ok(report.includes(String(REFLOW_BUDGET_PX)));
	for (const item of HUMAN_EVALUATION) assert.ok(report.includes(item));
});
