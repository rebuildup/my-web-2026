/**
 * The Issue #407 gate's own unit tests.
 *
 * The gate is the machine half of the Issue's completion condition
 * ("機械検査と人間の評価を区別"), so the rules themselves have to be
 * testable without a browser: a rule that can only fail inside Chromium
 * is a rule nobody re-runs when it breaks.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	CONTRACT_MARKERS,
	EXPECTED_CASE_IDS,
	HUMAN_EVALUATION,
	PRIMITIVE,
	collectEvidence,
	renderGateSummary,
	scanViolationsInFile,
} from './check-table-code-a11y.mjs';

test('an ad-hoc table element outside the primitive is a violation', () => {
	const violations = scanViolationsInFile({
		relativePath: 'src/home/example.tsx',
		source: 'export const A = () => (\n\t<table>\n\t\t<tr />\n\t</table>\n);\n',
	});

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'table-outside-primitive');
	assert.equal(violations[0].wcag, '1.3.1');
	assert.equal(violations[0].line, 2);
});

test('a table element named in a comment is documentation, not a violation', () => {
	const violations = scanViolationsInFile({
		relativePath: 'src/home/example.tsx',
		source: [
			'/**',
			' * A `<table>` written by hand loses its caption.',
			' * Use DataTable instead.',
			' */',
			'export const A = () => <div />;',
		].join('\n'),
	});

	assert.deepEqual(violations, []);
});

test('a hand-rolled horizontal scroll box outside the primitive is a violation', () => {
	const violations = scanViolationsInFile({
		relativePath: 'src/portfolio/example.tsx',
		source: "const S = { overflowX: 'auto', maxWidth: '100%' };\n",
	});

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'scroll-container-outside-primitive');
	assert.equal(violations[0].wcag, '1.4.10');
});

test('the primitive itself may declare the scroll box it owns', () => {
	const source = [
		"const S = { overflowX: 'auto' };",
		'const T = () => <table><caption>x</caption></table>;',
	].join('\n');

	assert.deepEqual(scanViolationsInFile({ relativePath: PRIMITIVE, source }), []);
});

test('every contract marker maps to a success criterion and a claim', () => {
	assert.ok(CONTRACT_MARKERS.length >= 7);
	for (const marker of CONTRACT_MARKERS) {
		assert.match(marker.id, /^[a-z-]+$/);
		assert.match(marker.wcag, /^\d+\.\d+\.\d+$/);
		assert.ok(marker.claim.length > 10, `${marker.id} needs a claim`);
	}
});

test('the Issue names four fixture states and the gate asserts exactly those', () => {
	assert.deepEqual([...EXPECTED_CASE_IDS], ['01-normal', '02-empty', '03-failure', '04-compact']);
});

test('collecting evidence over the real repository passes', () => {
	const evidence = collectEvidence();

	assert.deepEqual(evidence.violations, []);
	assert.deepEqual(evidence.primitive.missing, []);
	assert.deepEqual(evidence.cases.missing, []);
	assert.equal(evidence.cases.found.length, 4);
	assert.ok(evidence.filesScanned > 100);
});

test('the report separates machine-checked facts from human evaluation', () => {
	const report = renderGateSummary(collectEvidence());

	assert.match(report, /machine-checked:/);
	assert.match(report, /not machine-checked \(human evaluation\):/);
	assert.ok(report.indexOf('machine-checked:') < report.indexOf('not machine-checked'));
	assert.match(report, /SC 1\.3\.1/);
	assert.match(report, /SC 1\.4\.10/);
	assert.match(report, /SC 2\.1\.1/);
	for (const item of HUMAN_EVALUATION) assert.ok(report.includes(item));
});
