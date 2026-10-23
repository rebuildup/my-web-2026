/**
 * The Issue #396 gate's own unit tests.
 *
 * The gate is the machine half of the Issue's completion condition
 * ("機械検査と人間の評価を区別"), so the rules themselves have to be
 * testable without a browser: a rule that can only fail inside a
 * rendering engine is a rule nobody re-runs when it breaks.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	BUTTON_RULES,
	EXPECTED_FAIL_FIXTURES,
	EXPECTED_PASS_FIXTURES,
	EXCLUSIONS,
	FIXTURE_ROOT,
	HUMAN_EVALUATION,
	RULES,
	auditFixtureRules,
	auditFixtureSets,
	collectEvidence,
	collectIdDeclarations,
	evaluateNameMechanisms,
	exclusionReasons,
	extractText,
	findButtons,
	hasHiddenTextLabel,
	idIsDeclared,
	isIconOnly,
	isTextless,
	parseAttributes,
	renderGateSummary,
	scanViolationsInFile,
	stringLiteralValue,
	templateFragments,
} from './check-a11y-icon-button-names.mjs';
import { REPO_ROOT } from './_source-scan.mjs';

/** The rules a fail fixture is expected to break. */
const EXPECTED_FAIL_RULES = {
	'missing-name.tsx': 'icon-button-missing-name',
	'empty-aria-label.tsx': 'icon-button-empty-name',
	'empty-title.tsx': 'icon-button-empty-name',
	'broken-labelledby.tsx': 'icon-button-name-target-missing',
};

test('an icon-only button with no name mechanism is a violation', () => {
	const violations = scanViolationsInFile({
		relativePath: 'src/home/example.tsx',
		source: [
			'export const A = () => (',
			'\t<button type="button">',
			'\t\t<svg viewBox="0 0 16 16" />',
			'\t</button>',
			');',
		].join('\n'),
	});

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'icon-button-missing-name');
	assert.equal(violations[0].wcag, '4.1.2');
	assert.equal(violations[0].line, 2);
});

test('a button that carries text is not this gate’s business', () => {
	const violations = scanViolationsInFile({
		relativePath: 'src/home/example.tsx',
		source: '<button type="button">\n\t<svg viewBox="0 0 16 16" />\n\tDelete\n</button>\n',
	});

	assert.deepEqual(violations, []);
});

test('a button with no icon and no text still needs a name', () => {
	// The icon shape is EVIDENCE, not a precondition: a button that
	// renders nothing at all is nameless too.
	const violations = scanViolationsInFile({
		relativePath: 'src/home/example.tsx',
		source: '<button type="button" />\n',
	});

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'icon-button-missing-name');
});

test('a button whose content is a component is checked, whatever the component is called', () => {
	// The reviewer's attack: `<Close />` does not end in "Icon", so an
	// icon-shape precondition would let it out of the check.
	const violations = scanViolationsInFile({
		relativePath: 'src/home/example.tsx',
		source: 'export const A = () => (\n\t<button type="button"><Close /></button>\n);\n',
	});

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'icon-button-missing-name');
});

test('a button whose label is computed is left alone', () => {
	// The gate cannot read a dynamic expression, so a button whose text
	// is computed may still render text. Reporting it would be a false
	// positive on every computed label.
	const violations = scanViolationsInFile({
		relativePath: 'src/home/example.tsx',
		source:
			'export const A = () => (\n\t<button type="button">{busy ? "…" : "enable"}</button>\n);\n',
	});

	assert.deepEqual(violations, []);
});

test('an aria-label names the button', () => {
	const violations = scanViolationsInFile({
		relativePath: 'src/home/example.tsx',
		source: '<button type="button" aria-label="Close">\n\t<svg viewBox="0 0 16 16" />\n</button>\n',
	});

	assert.deepEqual(violations, []);
});

test('an empty aria-label is a violation of its own rule', () => {
	const violations = scanViolationsInFile({
		relativePath: 'src/home/example.tsx',
		source: '<button type="button" aria-label="">\n\t<svg viewBox="0 0 16 16" />\n</button>\n',
	});

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'icon-button-empty-name');
});

test('an empty title is a violation of its own rule', () => {
	const violations = scanViolationsInFile({
		relativePath: 'src/home/example.tsx',
		source: '<button type="button" title="">\n\t<svg viewBox="0 0 16 16" />\n</button>\n',
	});

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'icon-button-empty-name');
});

test('a broken aria-labelledby reference is reported, not guessed at', () => {
	const violations = scanViolationsInFile({
		relativePath: 'src/home/example.tsx',
		source:
			'<button type="button" aria-labelledby="nowhere">\n\t<svg viewBox="0 0 16 16" />\n</button>\n',
	});

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'icon-button-name-target-missing');
	assert.equal(violations[0].wcag, '1.3.1');
	assert.match(violations[0].message, /nowhere/);
});

test('an aria-labelledby reference that resolves is left alone', () => {
	const violations = scanViolationsInFile({
		relativePath: 'src/home/example.tsx',
		source: [
			'<span id="label">Search</span>',
			'<button type="button" aria-labelledby="label">',
			'\t<svg viewBox="0 0 16 16" />',
			'</button>',
		].join('\n'),
	});

	assert.deepEqual(violations, []);
});

test('a visually hidden label names the button', () => {
	const violations = scanViolationsInFile({
		relativePath: 'src/home/example.tsx',
		source: [
			'<button type="button">',
			'\t<svg viewBox="0 0 16 16" />',
			'\t<span className="sr-only">Open menu</span>',
			'</button>',
		].join('\n'),
	});

	assert.deepEqual(violations, []);
});

test('a visually hidden label does not make the button show anything', () => {
	// The button still SHOWS only an icon, so it is an icon button —
	// it is simply a named one.
	const source = [
		'<button type="button">',
		'\t<svg viewBox="0 0 16 16" />',
		'\t<span className="sr-only">Open menu</span>',
		'</button>',
	].join('\n');

	const button = findButtons(source)[0];

	assert.equal(isIconOnly(button.children), true);
	assert.equal(hasHiddenTextLabel(button.children), true);
});

test('a non-empty title names the button', () => {
	const violations = scanViolationsInFile({
		relativePath: 'src/home/example.tsx',
		source: '<button type="button" title="Open menu">\n\t<svg viewBox="0 0 16 16" />\n</button>\n',
	});

	assert.deepEqual(violations, []);
});

test('a button written in a comment is documentation, not a violation', () => {
	const violations = scanViolationsInFile({
		relativePath: 'src/home/example.tsx',
		source: [
			'/**',
			' * A `<button>` with only an `<svg>` inside loses its name.',
			' * Give it an aria-label.',
			' */',
			'export const A = () => <div />;',
		].join('\n'),
	});

	assert.deepEqual(violations, []);
});

test('the text of a button is read from JSX text and string literals only', () => {
	assert.equal(extractText('<span>Menu</span>').trim(), 'Menu');
	assert.equal(extractText('<span>{"Menu"}</span>').trim(), 'Menu');
	// A dynamic expression cannot be read, so it is not counted as text.
	assert.equal(extractText('<span>{label}</span>').trim(), '');
	// An attribute value is metadata, not a rendered word.
	assert.equal(extractText('<span title="Menu" />').trim(), '');
});

test('a literal string is read, a computed one is not', () => {
	assert.equal(stringLiteralValue('"Close"'), 'Close');
	assert.equal(stringLiteralValue("'Close'"), 'Close');
	assert.equal(stringLiteralValue('""'), '');
	assert.equal(stringLiteralValue("close ? 'a' : 'b'"), null);
	assert.equal(stringLiteralValue('"a" + "b"'), null);
});

test('attributes keep their kind, because the kind decides what may be concluded', () => {
	const attributes = parseAttributes('type="button" aria-label="Close" hidden');

	assert.equal(attributes.get('type').kind, 'string');
	assert.equal(attributes.get('type').value, 'button');
	assert.equal(attributes.get('aria-label').value, 'Close');
	assert.equal(attributes.get('hidden').kind, 'bare');
});

test('a dynamically built id is not reported as a broken reference', () => {
	const source = [
		'const baseId = "panel";',
		'<section id={`${baseId}-caption`}>Caption</section>',
		'<button type="button" aria-labelledby={`${baseId}-caption`}>',
		'\t<svg viewBox="0 0 16 16" />',
		'</button>',
	].join('\n');

	const violations = scanViolationsInFile({ relativePath: 'src/home/example.tsx', source });

	assert.deepEqual(violations, []);
});

test('a literal id that the file does not declare is a broken reference', () => {
	assert.equal(idIsDeclared('<span id="here" />', 'here'), true);
	assert.equal(idIsDeclared('<span id="here" />', 'elsewhere'), false);
});

test('the attribute name is not a declaration: "label" is not declared by "aria-labelledby"', () => {
	// The reviewer's attack: a substring rule made every
	// `aria-labelledby="label"` look resolved, because the attribute
	// NAME contains the value.
	const violations = scanViolationsInFile({
		relativePath: 'src/home/example.tsx',
		source:
			'<button type="button" aria-labelledby="label">\n\t<svg viewBox="0 0 16 16" />\n</button>\n',
	});

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'icon-button-name-target-missing');
	assert.equal(idIsDeclared('<button aria-labelledby="label" />', 'label'), false);
});

test('only an id declaration makes an id declared', () => {
	const declarations = collectIdDeclarations(
		'<span id="here" />\n<span id={\'there\'} />\n<span id={`${base}-panel`} />\n',
	);

	assert.deepEqual([...declarations.literal].sort(), ['here', 'there']);
	assert.deepEqual(templateFragments('`${base}-panel`'), ['-panel']);
});

test('an id built by a template is not reported as broken', () => {
	const source = [
		'const baseId = "panel";',
		'<section id={`${baseId}-caption`}>Caption</section>',
		'<button type="button" aria-labelledby="panel-caption">',
		'\t<svg viewBox="0 0 16 16" />',
		'</button>',
	].join('\n');

	const violations = scanViolationsInFile({ relativePath: 'src/home/example.tsx', source });

	assert.deepEqual(violations, []);
});

test('an id the file builds from an unknown value is not reported either', () => {
	// The gate cannot reason about `id={captionId}`, so it must not
	// claim the reference is broken.
	const source = [
		'const captionId = "panel-caption";',
		'<section id={captionId}>Caption</section>',
		'<button type="button" aria-labelledby="panel-caption">',
		'\t<svg viewBox="0 0 16 16" />',
		'</button>',
	].join('\n');

	const violations = scanViolationsInFile({ relativePath: 'src/home/example.tsx', source });

	assert.deepEqual(violations, []);
});

test('the name mechanisms are reported one by one', () => {
	const attributes = parseAttributes('aria-label="" title="Open"');
	const mechanisms = evaluateNameMechanisms(attributes, '<span />', '');

	assert.equal(mechanisms.ariaLabel, 'empty');
	assert.equal(mechanisms.title, 'present');
	assert.equal(mechanisms.named, true);
});

test('the exclusions carry a reason each', () => {
	for (const exclusion of EXCLUSIONS) {
		assert.ok(exclusion.id.length > 0);
		assert.ok(exclusion.reason.length > 20, `${exclusion.id} needs a reason`);
	}
	assert.deepEqual(exclusionReasons('src/home/a.test.tsx'), ['test-file']);
	assert.deepEqual(exclusionReasons('src/home/a.stories.tsx'), ['story-file']);
	assert.deepEqual(exclusionReasons('src/routes/design-system/DesignSystemPage.tsx'), [
		'design-system-route',
	]);
	assert.deepEqual(exclusionReasons('src/home/a.tsx'), []);
});

test('the Issue names three button rules and the gate reports exactly those', () => {
	assert.deepEqual(BUTTON_RULES, [
		'icon-button-missing-name',
		'icon-button-empty-name',
		'icon-button-name-target-missing',
	]);
	assert.ok(RULES.includes('fixture-expectation-mismatch'));
});

test('the fixtures are read for real: the pass fixtures break nothing', () => {
	const evidence = collectEvidence();

	assert.equal(evidence.fixtures.pass.length, EXPECTED_PASS_FIXTURES.length);
	assert.equal(evidence.fixtures.fail.length, EXPECTED_FAIL_FIXTURES.length);
	for (const entry of evidence.fixtures.pass) {
		assert.deepEqual(entry.violations, [], `${entry.file} must break no rule`);
	}
});

test('the fixture set is closed: a missing fixture fails the gate', () => {
	// The reviewer's attack: a lower bound ("at least three") let a
	// deleted fixture shrink the coverage without turning the gate red.
	const present = (name) => ({ file: `${FIXTURE_ROOT}/pass/${name}`, violations: [] });
	const missing = EXPECTED_PASS_FIXTURES.filter((name) => name !== 'title.tsx').map(present);

	const mismatches = auditFixtureSets({
		pass: missing,
		fail: EXPECTED_FAIL_FIXTURES.map((name) => ({
			file: `${FIXTURE_ROOT}/fail/${name}`,
			violations: [{ rule: 'icon-button-missing-name' }],
		})),
	});

	assert.equal(mismatches.length, 1);
	assert.equal(mismatches[0].rule, 'fixture-expectation-mismatch');
	assert.match(mismatches[0].message, /title\.tsx/);
});

test('the fixture set is closed: an unexpected fixture fails the gate', () => {
	const present = (name) => ({ file: `${FIXTURE_ROOT}/pass/${name}`, violations: [] });
	const mismatches = auditFixtureSets({
		pass: [...EXPECTED_PASS_FIXTURES.map(present), present('surprise.tsx')],
		fail: EXPECTED_FAIL_FIXTURES.map((name) => ({
			file: `${FIXTURE_ROOT}/fail/${name}`,
			violations: [{ rule: 'icon-button-missing-name' }],
		})),
	});

	assert.equal(mismatches.length, 1);
	assert.equal(mismatches[0].rule, 'fixture-expectation-mismatch');
	assert.match(mismatches[0].message, /surprise\.tsx/);
});

test('the shipped fixtures are exactly the ones the Issue names', () => {
	const evidence = collectEvidence();
	const names = (entries) => entries.map((entry) => entry.file.split('/').pop()).sort();

	assert.deepEqual(names(evidence.fixtures.pass), [...EXPECTED_PASS_FIXTURES].sort());
	assert.deepEqual(names(evidence.fixtures.fail), [...EXPECTED_FAIL_FIXTURES].sort());
	assert.deepEqual(auditFixtureSets(evidence.fixtures), []);
});

test('a fail fixture that stops failing is reported', () => {
	const mismatches = auditFixtureRules({
		pass: [],
		fail: [{ file: `${FIXTURE_ROOT}/fail/missing-name.tsx`, violations: [] }],
	});

	assert.equal(mismatches.length, 1);
	assert.equal(mismatches[0].rule, 'fixture-expectation-mismatch');
});

test('the fixtures are read for real: every fail fixture breaks its rule', () => {
	const evidence = collectEvidence();

	for (const entry of evidence.fixtures.fail) {
		const name = entry.file.split('/').pop();
		const expected = EXPECTED_FAIL_RULES[name];
		assert.ok(expected, `no expected rule recorded for ${name}`);
		assert.deepEqual(
			entry.violations.map((violation) => violation.rule),
			[expected],
			`${name} must break ${expected}`,
		);
	}
});

test('the pass and fail fixtures live where the gate says they do', () => {
	const evidence = collectEvidence();

	assert.equal(evidence.fixtures.root, FIXTURE_ROOT);
	for (const entry of [...evidence.fixtures.pass, ...evidence.fixtures.fail]) {
		assert.ok(entry.file.startsWith(`${FIXTURE_ROOT}/`));
	}
	assert.ok(readFileSync(join(REPO_ROOT, FIXTURE_ROOT, 'pass', 'aria-label.tsx'), 'utf8'));
});

test('the shipped repository passes the gate', () => {
	const evidence = collectEvidence();

	assert.deepEqual(evidence.violations, []);
	assert.ok(evidence.filesScanned > 30);
	assert.equal(evidence.excluded.length > 0, true);
});

test('the report separates machine-checked facts from human evaluation', () => {
	const report = renderGateSummary(collectEvidence());

	assert.match(report, /machine-checked:/);
	assert.match(report, /not machine-checked \(human evaluation\):/);
	assert.ok(report.indexOf('machine-checked:') < report.indexOf('not machine-checked'));
	assert.match(report, /out of scope \(excluded from the scan\):/);
	for (const item of HUMAN_EVALUATION) assert.ok(report.includes(item));
});
