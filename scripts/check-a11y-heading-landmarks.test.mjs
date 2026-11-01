/**
 * The Issue #398 gate's own unit tests.
 *
 * The gate is the machine half of the Issue's completion condition
 * ("ページ単位の見出し・ランドマークの構造を機械検査で固定する"), so the
 * rules themselves have to be testable without a browser: a rule that
 * can only fail inside a rendering page is a rule nobody re-runs when
 * it breaks.
 *
 * The FIXTURES are read from disk (`scripts/fixtures/a11y-heading-landmarks/`)
 * and handed to the same {@link evaluateUnit} the gate uses for the
 * repository, so "the fixture is detected" and "the repository is
 * detected" cannot be two different code paths.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	EXEMPTION_RULE,
	EXPECTED_FIXTURES,
	FIXTURE_RULE,
	HUMAN_EVALUATION,
	PAGE_UNITS,
	RULES,
	applyExemptions,
	collectEvidence,
	collectFixtureEvidence,
	evaluateUnit,
	extractHeadings,
	extractMainLandmarks,
	levelSkipViolations,
	renderGateSummary,
} from './check-a11y-heading-landmarks.mjs';

const REPO_ROOT = join(import.meta.dirname, '..');
const FIXTURE_ROOT = join(import.meta.dirname, 'fixtures/a11y-heading-landmarks');

/** Read one fixture file from disk (the gate reads real files too). */
function readFixture(kind, name) {
	const relativePath = `scripts/fixtures/a11y-heading-landmarks/${kind}/${name}`;
	return {
		relativePath,
		source: readFileSync(join(FIXTURE_ROOT, kind, name), 'utf8'),
	};
}

/** The fixture file names of one kind, sorted (so a missing file fails). */
function fixtureNames(kind) {
	return readdirSync(join(FIXTURE_ROOT, kind)).sort();
}

/** Evaluate one fixture file as its own page unit. */
function judgeFixture(kind, name) {
	const file = readFixture(kind, name);
	return evaluateUnit({ id: name, kind: 'page', files: [file] });
}

/** The rules a fixture's evaluation reports. */
function rulesOf(result) {
	return result.violations.map((violation) => violation.rule);
}

test('every passing fixture reports no violation', () => {
	const names = fixtureNames('pass');
	assert.ok(names.length >= 2, 'the Issue asks for at least two passing fixtures');

	for (const name of names) {
		const result = judgeFixture('pass', name);
		assert.deepEqual(rulesOf(result), [], `${name} must not report a violation`);
	}
});

test('a passing fixture still carries the structure it demonstrates', () => {
	// A passing fixture that was EMPTIED reports no violation, so a
	// fixture set alone cannot tell "correct" from "empty". The gate
	// therefore requires a passing fixture to hold a heading AND a
	// main landmark, and reports the empty one as a mismatch.
	for (const name of fixtureNames('pass')) {
		const result = judgeFixture('pass', name);
		assert.ok(result.headings.length > 0, `${name} must render a heading`);
		assert.ok(result.landmarks.length > 0, `${name} must render a main landmark`);
	}
});

test('an emptied passing fixture is reported as a fixture expectation mismatch', () => {
	const evidence = collectFixtureEvidence({
		readDirectory: (directory) =>
			directory.endsWith('/pass')
				? ['pass-landmarks.tsx', 'pass-outline.tsx']
				: fixtureNames('fail'),
		readFile: (relativePath) =>
			relativePath.endsWith('pass-outline.tsx')
				? 'export const A = () => <div>nothing structural</div>;\n'
				: readFileSync(join(REPO_ROOT, relativePath), 'utf8'),
	});

	const mismatches = evidence.violations.filter((violation) => violation.rule === FIXTURE_RULE);
	assert.ok(
		mismatches.length > 0,
		'an emptied passing fixture must not be able to keep the gate green',
	);
	assert.ok(mismatches.some((violation) => violation.file.endsWith('pass-outline.tsx')));
});

test('a missing fixture is reported as a fixture expectation mismatch', () => {
	const evidence = collectFixtureEvidence({
		readDirectory: (directory) =>
			directory.endsWith('/pass') ? ['pass-landmarks.tsx'] : fixtureNames('fail'),
		readFile: (relativePath) => readFileSync(join(REPO_ROOT, relativePath), 'utf8'),
	});

	const mismatches = evidence.violations.filter((violation) => violation.rule === FIXTURE_RULE);
	assert.ok(mismatches.length > 0, 'a deleted fixture must not be able to keep the gate green');
	assert.ok(mismatches.some((violation) => violation.file.endsWith('pass-outline.tsx')));
});

test('the fixture set is exactly the expected one', () => {
	const evidence = collectFixtureEvidence({
		readDirectory: (directory) =>
			directory.endsWith('/pass')
				? [...fixtureNames('pass'), 'pass-extra.tsx']
				: fixtureNames('fail'),
		readFile: (relativePath) =>
			relativePath.endsWith('pass-extra.tsx')
				? 'export const A = () => <div>nothing structural</div>;\n'
				: readFileSync(join(REPO_ROOT, relativePath), 'utf8'),
	});

	const mismatches = evidence.violations.filter((violation) => violation.rule === FIXTURE_RULE);
	assert.ok(mismatches.some((violation) => violation.file.endsWith('pass-extra.tsx')));

	// The committed tree matches the expectation exactly.
	assert.deepEqual(fixtureNames('pass'), [...EXPECTED_FIXTURES.pass].sort());
	assert.deepEqual(fixtureNames('fail'), [...EXPECTED_FIXTURES.fail].sort());
});

test('a fixture with two h1 elements is reported as page-multiple-h1', () => {
	const result = judgeFixture('fail', 'fail-multiple-h1.tsx');

	assert.ok(rulesOf(result).includes('page-multiple-h1'));
	assert.equal(result.headings.filter((heading) => heading.level === 1).length, 2);
});

test('a fixture without an h1 element is reported as page-missing-h1', () => {
	const result = judgeFixture('fail', 'fail-missing-h1.tsx');

	assert.ok(rulesOf(result).includes('page-missing-h1'));
});

test('a fixture that skips a heading level is reported as page-heading-level-skip', () => {
	const result = judgeFixture('fail', 'fail-heading-level-skip.tsx');

	assert.ok(rulesOf(result).includes('page-heading-level-skip'));
	// The violation is reported on the heading that SKIPPED the level,
	// on the line the developer opens.
	const source = readFixture('fail', 'fail-heading-level-skip.tsx').source;
	const skippedLine = source.split('\n').findIndex((line) => line.trim().startsWith('<h3>')) + 1;
	assert.equal(result.violations[0].line, skippedLine);
});

test('a fixture without a main landmark is reported as page-missing-landmark', () => {
	const result = judgeFixture('fail', 'fail-missing-landmark.tsx');

	assert.ok(rulesOf(result).includes('page-missing-landmark'));
});

test('a fixture with two main landmarks is reported as landmark-duplicated', () => {
	const result = judgeFixture('fail', 'fail-duplicated-landmark.tsx');

	assert.ok(rulesOf(result).includes('landmark-duplicated'));
});

test('a fixture that lost both its h1 and its main landmark reports both rules', () => {
	// The negative control for the unit KIND: a page is a page
	// because the unit table says so, not because it still renders
	// something. Losing both the <h1> and the landmark has to be
	// reported, not read as "this is a component surface".
	const result = judgeFixture('fail', 'fail-missing-page-outline.tsx');

	const rules = rulesOf(result);
	assert.ok(rules.includes('page-missing-h1'));
	assert.ok(rules.includes('page-missing-landmark'));
});

test('the failing fixtures cover every rule the gate can report', () => {
	const reported = new Set();
	for (const name of fixtureNames('fail')) {
		for (const rule of rulesOf(judgeFixture('fail', name))) reported.add(rule);
	}

	for (const rule of RULES) {
		assert.ok(reported.has(rule), `no failing fixture reports ${rule}`);
	}
});

test('a heading written in a comment is documentation, not a heading', () => {
	const headings = extractHeadings(
		[
			'/**',
			' * A `<h1>` in a comment is not a heading.',
			' */',
			'export const A = () => <h2>x</h2>;',
		].join('\n'),
	);

	assert.deepEqual(
		headings.map((heading) => heading.level),
		[2],
	);
});

test('a SectionHeading call is read as the level the primitive renders', () => {
	const headings = extractHeadings('export const A = () => <SectionHeading title="x" />;\n', 2);

	assert.deepEqual(
		headings.map((heading) => [heading.level, heading.kind]),
		[[2, 'primitive']],
	);
});

test('a main element and a main role are both the main landmark, counted once', () => {
	assert.equal(extractMainLandmarks('export const A = () => <main>x</main>;\n').length, 1);
	assert.equal(
		extractMainLandmarks('export const A = () => <div role="main">x</div>;\n').length,
		1,
	);
	assert.equal(
		extractMainLandmarks('export const A = () => <main role="main">x</main>;\n').length,
		1,
	);
	assert.equal(
		extractMainLandmarks('export const A = () => <><main>x</main><main>y</main></>;\n').length,
		2,
	);
});

test('the level rule starts at the first heading of the file', () => {
	// A file that starts at h2 (a shared component, or a section whose
	// page owns the h1 elsewhere) is judged from its own first heading,
	// so only h2 → h4 is a skip there.
	assert.deepEqual(
		levelSkipViolations(
			extractHeadings('export const A = () => (<><h2>a</h2><h3>b</h3></>);\n'),
			'src/home/example.tsx',
		),
		[],
	);
	const skip = levelSkipViolations(
		extractHeadings('export const A = () => (<><h2>a</h2><h4>b</h4></>);\n'),
		'src/home/example.tsx',
	);
	assert.equal(skip.length, 1);
	assert.equal(skip[0].rule, 'page-heading-level-skip');
});

test('a component surface is not asked for a page outline', () => {
	// A shared component (declared `kind: 'component'`) is not a
	// page: it must not be told to carry the page's h1 or the page's
	// landmark.
	const result = evaluateUnit({
		id: 'component',
		kind: 'component',
		files: [
			{
				relativePath: 'src/editorial/example.tsx',
				source: 'export const A = () => (<><h3>a</h3><h4>b</h4></>);\n',
			},
		],
	});

	assert.equal(result.isComponentSurface, true);
	assert.equal(result.kind, 'component');
	assert.deepEqual(rulesOf(result), []);
});

test('a page unit that renders neither an h1 nor a main landmark is still a page', () => {
	// The hole the cold review found: inferring "component surface"
	// from what a unit renders lets a page that lost BOTH its <h1>
	// and its landmark pass with zero violations. The kind is
	// declared, so the page unit reports both rules.
	const source = 'export const A = () => (<div><section><h2>a</h2></section></div>);\n';

	const asPage = evaluateUnit({
		id: 'page',
		kind: 'page',
		files: [{ relativePath: 'src/routes/example.tsx', source }],
	});
	const asComponent = evaluateUnit({
		id: 'component',
		kind: 'component',
		files: [{ relativePath: 'src/editorial/example.tsx', source }],
	});

	const pageRules = rulesOf(asPage);
	assert.ok(pageRules.includes('page-missing-h1'));
	assert.ok(pageRules.includes('page-missing-landmark'));
	assert.deepEqual(rulesOf(asComponent), []);
});

test('a unit that declares no kind is judged as a page', () => {
	// Fail-closed: an undeclared unit is never quietly excused.
	const result = evaluateUnit({
		id: 'undeclared',
		files: [
			{
				relativePath: 'src/routes/example.tsx',
				source: 'export const A = () => (<div><section><h2>a</h2></section></div>);\n',
			},
		],
	});

	assert.equal(result.kind, 'page');
	assert.ok(rulesOf(result).includes('page-missing-h1'));
	assert.ok(rulesOf(result).includes('page-missing-landmark'));
});

test('every page unit declares whether it is a page or a component surface', () => {
	for (const unit of PAGE_UNITS) {
		assert.ok(
			unit.kind === 'page' || unit.kind === 'component',
			`${unit.id} must declare its kind`,
		);
	}
});

test('every page unit names its scope, and no unit covers the route root', () => {
	assert.ok(PAGE_UNITS.length >= 8);
	for (const unit of PAGE_UNITS) {
		assert.match(unit.id, /^[a-z-]+$/);
		assert.ok(unit.files.length > 0, `${unit.id} needs a scope`);
		assert.ok(
			!unit.files.some((file) => file === 'src/routes/__root.tsx'),
			'the route root is the shared shell, not a page',
		);
	}
});

test('the Issue names five rules and the gate reports exactly those', () => {
	assert.deepEqual(RULES, [
		'page-multiple-h1',
		'page-missing-h1',
		'page-heading-level-skip',
		'page-missing-landmark',
		'landmark-duplicated',
	]);
});

test('collecting evidence over the real repository passes', () => {
	const evidence = collectEvidence();

	assert.deepEqual(evidence.violations, []);
	assert.ok(evidence.filesScanned > 30);
	assert.ok(evidence.units.length >= 8);
});

test('the report separates machine-checked facts from human evaluation', () => {
	const report = renderGateSummary(collectEvidence());

	assert.match(report, /machine-checked:/);
	assert.match(report, /not machine-checked \(human evaluation\):/);
	assert.ok(report.indexOf('machine-checked:') < report.indexOf('not machine-checked'));
	assert.match(report, /not scanned \(deliberately out of scope\):/);
	for (const item of HUMAN_EVALUATION) assert.ok(report.includes(item));
});

/**
 * A rule exemption is a DECLARATION with a reason.
 *
 * `/tools` renders no `main` landmark on purpose: the browser-compat
 * contract states `main: 'none'` for that route, and Issue #785 kept
 * that decision when it restored the nav and the breadcrumbs there.
 * These tests pin the three properties that make the exemption honest:
 *
 *   1. the declaration names the rule AND the contract it comes from;
 *   2. the exemption applies to the unit that declares it, and to
 *      nothing else — a unit that declares none is still reported;
 *   3. an invalid declaration (no reason, or an unknown rule) excuses
 *      NOTHING and is reported, so a typo cannot switch a rule off.
 */

/** The tools-index unit, as the gate declares it. */
function toolsIndexUnit() {
	const unit = PAGE_UNITS.find((candidate) => candidate.id === 'tools-index');
	assert.ok(unit, 'the tools-index unit must be declared');
	return unit;
}

/** A page that renders a heading but no main landmark. */
const noLandmarkSource = 'export const A = () => (<div><h1>Tools</h1><h2>Integrated</h2></div>);\n';

test('the tools-index unit declares the landmark exemption and the contract it comes from', () => {
	const unit = toolsIndexUnit();
	const exemptions = unit.exemptRules ?? [];

	assert.equal(exemptions.length, 1);
	assert.equal(exemptions[0].rule, 'page-missing-landmark');
	assert.match(exemptions[0].reason, /main: 'none'/);
	assert.match(exemptions[0].reason, /Issue #785/);
});

test('an exempt unit does not report the exempted rule, and the exemption is recorded', () => {
	const result = evaluateUnit({
		id: 'tools-index',
		kind: 'page',
		files: [{ relativePath: 'src/routes/tools.index.tsx', source: noLandmarkSource }],
		exemptRules: toolsIndexUnit().exemptRules,
	});

	assert.deepEqual(rulesOf(result), []);
	assert.equal(result.exemptions.length, 1);
	assert.equal(result.exemptions[0].rule, 'page-missing-landmark');
	assert.equal(result.exemptions[0].excused.length, 1);
	assert.equal(result.exemptions[0].excused[0].rule, 'page-missing-landmark');
});

test('the exemption applies to the declaring unit only', () => {
	// Fail-closed: the same source in a unit that declares no
	// exemption is still reported.
	const declared = evaluateUnit({
		id: 'tools-index',
		kind: 'page',
		files: [{ relativePath: 'src/routes/tools.index.tsx', source: noLandmarkSource }],
		exemptRules: toolsIndexUnit().exemptRules,
	});
	const undeclared = evaluateUnit({
		id: 'other-page',
		kind: 'page',
		files: [{ relativePath: 'src/routes/other.tsx', source: noLandmarkSource }],
	});

	assert.deepEqual(rulesOf(declared), []);
	assert.ok(rulesOf(undeclared).includes('page-missing-landmark'));
});

test('an exemption excuses only the rule it names', () => {
	// The tools-index page must still be reported when it grows a
	// second `main` or loses its `<h1>`.
	const brokenSource =
		'export const A = () => (<div><h2>Integrated</h2><main>a</main><main>b</main></div>);\n';
	const result = evaluateUnit({
		id: 'tools-index',
		kind: 'page',
		files: [{ relativePath: 'src/routes/tools.index.tsx', source: brokenSource }],
		exemptRules: toolsIndexUnit().exemptRules,
	});

	const rules = rulesOf(result);
	assert.ok(rules.includes('page-missing-h1'));
	assert.ok(rules.includes('landmark-duplicated'));
	assert.ok(!rules.includes('page-missing-landmark'));
});

test('an exemption without a reason excuses nothing and is reported', () => {
	const result = evaluateUnit({
		id: 'tools-index',
		kind: 'page',
		files: [{ relativePath: 'src/routes/tools.index.tsx', source: noLandmarkSource }],
		exemptRules: [{ rule: 'page-missing-landmark', reason: '  ' }],
	});

	assert.ok(rulesOf(result).includes('page-missing-landmark'));
	assert.equal(result.exemptions.length, 0);
	assert.equal(result.exemptionProblems.length, 1);
	assert.equal(result.exemptionProblems[0].rule, EXEMPTION_RULE);
	assert.match(result.exemptionProblems[0].message, /carries no reason/);
});

test('an exemption naming a rule the gate does not decide excuses nothing and is reported', () => {
	const result = applyExemptions(
		[
			{
				rule: 'page-missing-landmark',
				file: 'page:tools-index',
				line: null,
				wcag: '1.3.1',
				message: 'the page renders no main landmark',
			},
		],
		[{ rule: 'page-missing-landmarkd', reason: 'a typo' }],
	);

	assert.equal(result.violations.length, 1);
	assert.equal(result.exemptions.length, 0);
	assert.equal(result.problems.length, 1);
	assert.equal(result.problems[0].rule, EXEMPTION_RULE);
	assert.match(result.problems[0].message, /not a rule this gate decides/);
});

test('the report prints the exemption with its reason', () => {
	const evidence = collectEvidence();
	const report = renderGateSummary(evidence);

	assert.ok(evidence.exemptions.length > 0, 'the tools-index exemption must be declared');
	assert.match(report, /exempted rules \(declared, with the reason/);
	for (const exemption of evidence.exemptions) {
		assert.ok(report.includes(exemption.reason), 'the reason must be printed');
		assert.ok(report.includes(`${exemption.unit}: ${exemption.rule}`));
	}
});

test('the repository run declares the tools-index exemption and reports no violation', () => {
	const evidence = collectEvidence();

	assert.deepEqual(evidence.violations, []);
	const exemption = evidence.exemptions.find((entry) => entry.unit === 'tools-index');
	assert.ok(exemption, 'the tools-index unit must declare its exemption');
	assert.equal(exemption.rule, 'page-missing-landmark');
	assert.match(exemption.reason, /Issue #785/);
});
