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
	HUMAN_EVALUATION,
	PAGE_UNITS,
	RULES,
	collectEvidence,
	evaluateUnit,
	extractHeadings,
	extractMainLandmarks,
	levelSkipViolations,
	renderGateSummary,
} from './check-a11y-heading-landmarks.mjs';

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
	return evaluateUnit({ id: name, files: [file] });
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
	// A shared component (no h1, no main landmark) is not a page: it
	// must not be told to carry the page's h1 or the page's landmark.
	const result = evaluateUnit({
		id: 'component',
		files: [
			{
				relativePath: 'src/editorial/example.tsx',
				source: 'export const A = () => (<><h3>a</h3><h4>b</h4></>);\n',
			},
		],
	});

	assert.equal(result.isComponentSurface, true);
	assert.deepEqual(rulesOf(result), []);
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
