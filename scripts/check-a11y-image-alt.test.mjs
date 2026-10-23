/**
 * The Issue #397 gate's own unit tests.
 *
 * The gate is the machine half of the Issue ("どの画像に alt が必要かを機械検査で
 * 固定する"), so the rules have to be testable without a browser: a rule that
 * can only fail inside a real page is a rule nobody re-runs when it breaks.
 *
 * The fixture assertions are deliberately strict. A test that only checked "the
 * fixture produced some output" would pass after a fixture file was deleted or
 * after the fixture stopped reproducing its defect, so the roster is compared
 * with the directory listing and every fail fixture is matched against the
 * rule it stands for.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	DECORATIVE_MARKS,
	EXCLUSIONS,
	FIXTURE_EXPECTATIONS,
	FIXTURE_ROOT,
	HUMAN_EVALUATION,
	RULES,
	collectEvidence,
	evaluateImage,
	findImageTags,
	parseAttributes,
	renderGateSummary,
	scanViolationsInFile,
} from './check-a11y-image-alt.mjs';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

/** Scan a source snippet the way the gate scans a file. */
function scan(source) {
	return scanViolationsInFile({ relativePath: 'src/home/example.tsx', source });
}

test('an <img> with no alt attribute is a violation', () => {
	const { violations } = scan('export const A = () => <img src="/a.png" />;\n');

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'img-missing-alt');
	assert.equal(violations[0].wcag, '1.1.1');
	assert.equal(violations[0].line, 1);
	assert.match(violations[0].message, /no alt attribute/);
});

test('an empty alt without a decorative mark is a violation', () => {
	const { violations } = scan('export const A = () => <img src="/a.png" alt="" />;\n');

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'img-empty-alt-not-decorative');
	assert.match(violations[0].message, /decorative/);
});

test('an empty alt WITH a decorative mark is the intended decorative case', () => {
	for (const mark of ['aria-hidden="true"', 'role="presentation"', 'data-decorative']) {
		const { violations, images } = scan(
			`export const A = () => <img src="/a.png" alt="" ${mark} />;\n`,
		);

		assert.deepEqual(violations, [], `${mark} must be accepted`);
		assert.equal(images[0].verdict, 'decorative');
		assert.ok(images[0].decorativeMarks.length > 0);
	}
});

test('a blank alt is a violation, not a description', () => {
	const { violations } = scan('export const A = () => <img src="/a.png" alt=" " />;\n');

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'img-alt-blank');
	assert.match(violations[0].message, /blank/);
});

test('a meaningful alt passes', () => {
	const { violations, images } = scan(
		'export const A = () => <img src="/a.png" alt="A terminal window" />;\n',
	);

	assert.deepEqual(violations, []);
	assert.equal(images[0].verdict, 'described');
});

test('an alt that is a runtime expression is reported as not statically decidable', () => {
	const { violations, images } = scan(
		'export const A = () => <img src="/a.png" alt={media.alt} />;\n',
	);

	assert.deepEqual(violations, []);
	assert.equal(images[0].verdict, 'dynamic-alt');
});

test('attributes spread over several lines are read as one tag', () => {
	const source = [
		'export const A = () => (',
		'\t<img',
		'\t\tsrc="/a.png"',
		'\t\talt=""',
		'\t\taria-hidden="true"',
		'\t/>',
		');',
	].join('\n');

	assert.deepEqual(scan(source).violations, []);
});

test('an <img> named in a comment is documentation, not a violation', () => {
	const source = [
		'/**',
		' * An `<img>` without an alt attribute loses the picture.',
		' */',
		'export const A = () => <div />;',
	].join('\n');

	assert.deepEqual(scan(source).violations, []);
});

test('a > inside an attribute value does not end the tag', () => {
	const source = 'export const A = () => <img src="/a.png" alt="a > b" />;\n';

	assert.deepEqual(scan(source).violations, []);
	assert.equal(findImageTags(source).length, 1);
});

test('the attribute parser distinguishes a literal from an expression', () => {
	const attributes = parseAttributes(' src="/a.png" alt={media.alt} alt-empty="" hidden');

	assert.deepEqual(
		attributes.map((attribute) => [attribute.name, attribute.kind]),
		[
			['src', 'string'],
			['alt', 'expression'],
			['alt-empty', 'string'],
			['hidden', 'boolean'],
		],
	);
});

test('the decorative marks are one list, and every mark is named', () => {
	assert.ok(DECORATIVE_MARKS.length >= 3);
	for (const mark of DECORATIVE_MARKS) {
		assert.match(mark.id, /^[a-z-]+$/);
		assert.ok(mark.describe.length > 0);
		assert.equal(typeof mark.matches, 'function');
	}
	// The three marks the Issue names are all present.
	const ids = DECORATIVE_MARKS.map((mark) => mark.id);
	assert.ok(ids.includes('aria-hidden'));
	assert.ok(ids.includes('role'));
	assert.ok(ids.includes('data-decorative'));
});

test('every rule the Issue names is a rule the gate knows', () => {
	for (const rule of [
		'img-missing-alt',
		'img-empty-alt-not-decorative',
		'img-alt-blank',
		'img-alt-empty',
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

test('every pass fixture produces no violation', () => {
	for (const [name] of Object.entries(FIXTURE_EXPECTATIONS.pass)) {
		const file = join(REPO_ROOT, FIXTURE_ROOT, 'pass', name);
		const { violations } = scanViolationsInFile({
			relativePath: `${FIXTURE_ROOT}/pass/${name}`,
			source: readFileSync(file, 'utf8'),
		});

		assert.deepEqual(
			violations.map((violation) => violation.rule),
			[],
			`${name} must stay a pass fixture`,
		);
	}
});

test('every fail fixture reproduces exactly the rule it stands for', () => {
	for (const [name, expectedRules] of Object.entries(FIXTURE_EXPECTATIONS.fail)) {
		const file = join(REPO_ROOT, FIXTURE_ROOT, 'fail', name);
		const { violations } = scanViolationsInFile({
			relativePath: `${FIXTURE_ROOT}/fail/${name}`,
			source: readFileSync(file, 'utf8'),
		});

		assert.deepEqual(
			violations.map((violation) => violation.rule),
			expectedRules,
			`${name} must reproduce ${expectedRules.join(', ')}`,
		);
	}
});

test('the shipped repository passes the gate', () => {
	const evidence = collectEvidence();

	assert.deepEqual(evidence.violations, []);
	assert.ok(evidence.filesScanned > 0);
	assert.ok(evidence.imagesScanned > 0);
	assert.equal(evidence.fixture.violations.length, 0);
});

test('the report separates machine-checked facts from human evaluation', () => {
	const report = renderGateSummary(collectEvidence());

	assert.match(report, /machine-checked:/);
	assert.match(report, /not machine-checked \(human evaluation\):/);
	assert.ok(report.indexOf('machine-checked:') < report.indexOf('not machine-checked'));
	assert.match(report, /SC 1\.1\.1/);
	for (const item of HUMAN_EVALUATION) assert.ok(report.includes(item));
});

test('the report states what was left out of scope, and why', () => {
	const report = renderGateSummary(collectEvidence());

	assert.match(report, /out of scope \(excluded from the scan, with the reason\):/);
	for (const exclusion of EXCLUSIONS) {
		assert.ok(report.includes(exclusion.describe));
		assert.ok(report.includes(exclusion.reason));
	}
});

test('the verdict of one image is decided by the shared rule table', () => {
	assert.equal(evaluateImage(parseAttributes('')).verdict, 'missing-alt');
	assert.equal(evaluateImage(parseAttributes('alt=""')).verdict, 'unmarked-empty');
	assert.equal(evaluateImage(parseAttributes('alt="" aria-hidden="true"')).verdict, 'decorative');
	assert.equal(evaluateImage(parseAttributes('alt=" "')).verdict, 'blank-alt');
	assert.equal(evaluateImage(parseAttributes('alt="a"')).verdict, 'described');
});
