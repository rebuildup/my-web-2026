/**
 * The Issue #405 gate's own unit tests.
 *
 * The gate is the machine half of the Issue ("過剰 announce を防ぐ"), so
 * the rules have to be testable without a browser: a rule that can only
 * fail inside a real page is a rule nobody re-runs when it breaks.
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
	ARIA_LIVE_VALUES,
	FIXTURE_EXPECTATIONS,
	FIXTURE_ROOT,
	HUMAN_EVALUATION,
	LIVE_ROLES,
	RULES,
	attributeOf,
	auditFixtureFiles,
	childExpressions,
	collectEvidence,
	evaluateSource,
	isLiveRegion,
	parseElements,
	resolvedAttributeValue,
	renderGateSummary,
} from './check-a11y-live-region.mjs';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

/** Scan a source snippet the way the gate scans a file. */
function scan(source) {
	return evaluateSource({ relativePath: 'src/home/example.tsx', source });
}

/** The rules a snippet reports. */
function rulesOf(source) {
	return scan(source).violations.map((violation) => violation.rule);
}

test('a role="status" element is a live region', () => {
	const [element] = parseElements('<div role="status">x</div>');
	assert.equal(isLiveRegion(element), true);
	assert.equal(attributeOf(element.body, 'role').value, 'status');
});

test('the live roles are the ARIA live roles', () => {
	for (const role of ['status', 'alert', 'log', 'timer', 'marquee']) {
		assert.ok(LIVE_ROLES.includes(role), `${role} must be a live role`);
		const [element] = parseElements(`<div role="${role}">x</div>`);
		assert.equal(isLiveRegion(element), true, `${role} must be a live region`);
	}
	const [plain] = parseElements('<div role="main">x</div>');
	assert.equal(isLiveRegion(plain), false);
});

test('aria-live makes a plain element a live region', () => {
	for (const value of ARIA_LIVE_VALUES) {
		const [element] = parseElements(`<div aria-live="${value}">x</div>`);
		assert.equal(isLiveRegion(element), true, `${value} must be a live region`);
	}
	const [element] = parseElements('<div aria-live="polite">x</div>');
	assert.equal(resolvedAttributeValue(attributeOf(element.body, 'aria-live')), 'polite');
});

test('a hand-written assertive region that is not an alert is a violation', () => {
	assert.deepEqual(rulesOf('<div aria-live="assertive">x</div>'), [
		'live-region-assertive-not-alert',
	]);
});

test('role="alert" is the sanctioned assertive spelling', () => {
	assert.deepEqual(rulesOf('<p role="alert">x</p>'), []);
});

test('a live region inside a live region is a violation', () => {
	assert.deepEqual(rulesOf('<div role="status"><span role="alert">Saved</span></div>'), [
		'live-region-nested',
	]);
});

test('an aria-busy value that is not a boolean is a violation', () => {
	assert.deepEqual(rulesOf('<div role="status" aria-busy="yes">x</div>'), [
		'live-region-busy-invalid',
	]);
	assert.deepEqual(rulesOf('<div role="status" aria-busy="true">x</div>'), []);
	assert.deepEqual(rulesOf('<div role="status" aria-busy={pending}>x</div>'), []);
});

test('the same expression in two live regions is a duplicate announcement', () => {
	assert.deepEqual(
		rulesOf('<><div role="status">{message}</div><div role="status">{message}</div></>'),
		['live-region-duplicate-announce'],
	);
	assert.deepEqual(
		rulesOf('<><div role="status">{first}</div><div role="status">{second}</div></>'),
		[],
	);
});

test('an element reads its own parent, so nesting is decided by the tag tree', () => {
	const elements = parseElements('<div role="status"><span role="alert">x</span></div>');
	const inner = elements.find((element) => element.name === 'span');
	assert.equal(inner.parent, 0);
});

test('child expressions are the top-level dynamic slots', () => {
	const [element] = parseElements('<div role="status">{a}{b ? c : d}</div>');
	const expressions = childExpressions('<div role="status">{a}{b ? c : d}</div>', element);
	assert.deepEqual(expressions.sort(), ['a', 'b ? c : d']);
});

test('only the declared live roles count', () => {
	for (const role of ['status', 'alert', 'log', 'timer', 'marquee']) {
		assert.deepEqual(rulesOf(`<div role="${role}" aria-busy="false">x</div>`), []);
	}
});

test('every rule the Issue names is a rule the gate knows', () => {
	for (const rule of [
		'live-region-assertive-not-alert',
		'live-region-nested',
		'live-region-busy-invalid',
		'live-region-duplicate-announce',
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

test('every pass fixture produces no violation and holds a live region', () => {
	for (const [name] of Object.entries(FIXTURE_EXPECTATIONS.pass)) {
		const file = join(REPO_ROOT, FIXTURE_ROOT, 'pass', name);
		const result = evaluateSource({
			relativePath: `${FIXTURE_ROOT}/pass/${name}`,
			source: readFileSync(file, 'utf8'),
		});

		assert.deepEqual(
			result.violations.map((violation) => violation.rule),
			[],
			`${name} must stay a pass fixture`,
		);
		assert.ok(result.liveRegions.length > 0, `${name} must declare a live region`);
	}
});

test('every fail fixture reproduces exactly the rule it stands for', () => {
	for (const [name, expectedRules] of Object.entries(FIXTURE_EXPECTATIONS.fail)) {
		const file = join(REPO_ROOT, FIXTURE_ROOT, 'fail', name);
		const result = evaluateSource({
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
			evaluation: { liveRegions: [], violations: [] },
			regionCount: 0,
		},
	]);

	assert.equal(audited.violations.length, 1);
	assert.equal(audited.violations[0].rule, 'fixture-pass-no-region');
});

test('the shipped repository passes the gate', () => {
	const evidence = collectEvidence();

	assert.deepEqual(evidence.violations, []);
	assert.ok(evidence.shipped.filesScanned > 0);
	assert.ok(evidence.shipped.liveRegions.length > 0);
	assert.equal(evidence.fixture.violations.length, 0);
});

test('the report separates machine-checked facts from human evaluation', () => {
	const report = renderGateSummary(collectEvidence());

	assert.match(report, /machine-checked:/);
	assert.match(report, /not machine-checked \(human evaluation\):/);
	assert.ok(report.indexOf('machine-checked:') < report.indexOf('not machine-checked'));
	assert.match(report, /SC 4\.1\.3/);
	for (const item of HUMAN_EVALUATION) assert.ok(report.includes(item));
});

test('the report states what was left out of scope, and why', () => {
	const report = renderGateSummary(collectEvidence());

	assert.match(report, /out of scope \(excluded from the shipped scan, with the reason\):/);
	assert.match(report, /<output>/);
});
