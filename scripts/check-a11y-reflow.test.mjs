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
	EXCLUSIONS,
	FIXTURE_EXPECTATIONS,
	FIXTURE_ROOT,
	HUMAN_EVALUATION,
	REFLOW_BUDGET_PX,
	RULES,
	SHIPPED_DECLARATION_EXCLUSIONS,
	SHIPPED_SCAN_ROOT,
	UNBREAKABLE_KINDS,
	allowedOccurrences,
	applyDeclarationExclusions,
	auditFixtureFiles,
	auditShippedSource,
	breakDeclarationsIn,
	collectEvidence,
	deriveSpecimenCases,
	describeSpecimen,
	evaluateFixtureSource,
	evaluateShippedSource,
	exclusionFor,
	fixedWidthsIn,
	forbidsWrapIn,
	hasBreakBoundary,
	readFixtureEntries,
	renderGateSummary,
	specimenKindsIn,
	styleDeclarationsIn,
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

/* ------------------------------------------------------------------ *
 * The shipped source scan
 * ------------------------------------------------------------------ */

test('a maximum is not read as a width', () => {
	const declarations = styleDeclarationsIn('main { max-width: 720px; margin: 0 auto; }');

	assert.deepEqual(
		declarations.map((declaration) => declaration.property),
		['max-width', 'margin'],
	);
	const result = evaluateShippedSource({
		relativePath: 'src/x.ts',
		source: 'main { max-width: 720px; }',
	});
	assert.deepEqual(result.violations, [], 'a maximum does not pin a box wider than the budget');
});

test('a shipped surface that forbids wrapping is a violation', () => {
	const result = evaluateShippedSource({
		relativePath: 'src/home/hero.tsx',
		source: "const s = { whiteSpace: 'nowrap' };",
	});

	assert.equal(result.violations.length, 1);
	assert.equal(result.violations[0].rule, 'shipped-nowrap');
	assert.equal(result.violations[0].wcag, '1.4.10');
	assert.ok(result.violations[0].line > 0, 'the violation carries a line the developer can open');
});

test('a shipped surface pinned wider than the budget is a violation', () => {
	const result = evaluateShippedSource({
		relativePath: 'src/editorial/x.tsx',
		source: "const s = css({ minWidth: '710px' });",
	});

	assert.equal(result.violations.length, 1);
	assert.equal(result.violations[0].rule, 'shipped-fixed-width');
	assert.match(result.violations[0].message, /710px/);
});

test('the CSS syntax is judged like the object syntax', () => {
	assert.equal(
		evaluateShippedSource({ relativePath: 'src/x.css', source: '.a { min-width: 400px; }' })
			.violations[0].rule,
		'shipped-fixed-width',
	);
	assert.equal(
		evaluateShippedSource({ relativePath: 'src/x.css', source: '.a { width: 500px; }' })
			.violations[0].rule,
		'shipped-fixed-width',
	);
	assert.equal(
		evaluateShippedSource({ relativePath: 'src/x.css', source: '.a { white-space: pre; }' })
			.violations[0].rule,
		'shipped-nowrap',
	);
	for (const source of [
		'.a { max-width: 500px; }',
		'.a { width: 100%; }',
		'.a { width: 20rem; }',
		'.a { width: calc(100% - 2rem); }',
	]) {
		assert.deepEqual(
			evaluateShippedSource({ relativePath: 'src/x.css', source }).violations,
			[],
			`${source} must not be a violation`,
		);
	}
});

test('a rem fixed width is converted at the CSS initial 16 px base', () => {
	const over = evaluateShippedSource({
		relativePath: 'src/home/hero.tsx',
		source: "const s = css({ minWidth: '24rem' });",
	});

	assert.equal(over.violations.length, 1);
	assert.equal(over.violations[0].rule, 'shipped-fixed-width');
	assert.equal(over.violations[0].px, 384);
	assert.match(over.violations[0].message, /384px/);

	// 20 rem = 320 px is exactly the budget, not over it.
	const atBudget = evaluateShippedSource({
		relativePath: 'src/home/hero.tsx',
		source: "const s = css({ minWidth: '20rem' });",
	});

	assert.deepEqual(atBudget.violations, []);
});

test('a font-relative unit the gate cannot convert is undecidable, not ignored', () => {
	for (const [value, unit] of [
		['25em', 'em'],
		['40ch', 'ch'],
	]) {
		const result = evaluateShippedSource({
			relativePath: 'src/home/hero.tsx',
			source: `const s = css({ minWidth: '${value}' });`,
		});

		assert.deepEqual(result.violations, [], `${value} must not be a violation`);
		assert.equal(result.undecidable.length, 1, `${value} must be reported as undecidable`);
		assert.equal(result.undecidable[0].unit, unit);
		assert.ok(result.undecidable[0].reason.length > 20);
	}
});

test('the nowrap value is normalised before it is compared', () => {
	const cssForm = evaluateShippedSource({
		relativePath: 'src/x.css',
		source: '.a { white-space: nowrap !important; }',
	});
	const jsxForm = evaluateShippedSource({
		relativePath: 'src/x.tsx',
		source: "const s = { whiteSpace: 'nowrap !important' };",
	});
	const trailing = evaluateShippedSource({
		relativePath: 'src/x.tsx',
		source: "const s = { whiteSpace: 'nowrap ' };",
	});

	for (const result of [cssForm, jsxForm, trailing]) {
		assert.equal(result.violations.length, 1);
		assert.equal(result.violations[0].rule, 'shipped-nowrap');
	}
	// The CSS syntax and the JSX syntax agree on the same declaration.
	assert.equal(cssForm.violations[0].value, 'nowrap');
	assert.equal(jsxForm.violations[0].value, 'nowrap');
	assert.equal(trailing.violations[0].value, 'nowrap');
});

test('a fixed width with !important is still a fixed width', () => {
	const result = evaluateShippedSource({
		relativePath: 'src/x.tsx',
		source: "const s = css({ minWidth: '24rem !important' });",
	});

	assert.equal(result.violations.length, 1);
	assert.equal(result.violations[0].rule, 'shipped-fixed-width');
	assert.equal(result.violations[0].px, 384);
});

test('a shipped surface inside the budget is not a violation', () => {
	const result = evaluateShippedSource({
		relativePath: 'src/admin/keys/step-up-panel.tsx',
		source: "const s = css({ minWidth: '240px', maxWidth: '640px' });",
	});

	assert.deepEqual(result.violations, []);
});

test('a declaration named in a comment is documentation, not a declaration', () => {
	const result = evaluateShippedSource({
		relativePath: 'src/home/hero.tsx',
		source: '/** white-space: nowrap would be wrong here */\nexport const a = 1;',
	});

	assert.deepEqual(result.violations, []);
});

test('every exclusion carries a reason', () => {
	for (const exclusion of EXCLUSIONS) {
		assert.ok(exclusion.id.length > 0);
		assert.ok(exclusion.describe.length > 0);
		assert.ok(exclusion.reason.length > 20, `${exclusion.id} must explain itself`);
	}
	for (const exclusion of SHIPPED_DECLARATION_EXCLUSIONS) {
		assert.ok(exclusion.file.length > 0);
		assert.ok(exclusion.property.length > 0);
		assert.ok(exclusion.value.length > 0);
		assert.ok(exclusion.reason.length > 20, `${exclusion.id} must explain itself`);
	}
});

test('every declaration exclusion declares how many declarations it allows', () => {
	for (const exclusion of SHIPPED_DECLARATION_EXCLUSIONS) {
		assert.ok(
			Number.isInteger(exclusion.occurrences) && exclusion.occurrences >= 1,
			`${exclusion.id} must declare a positive integer \`occurrences\``,
		);
	}
	// An entry that does not name an allowance allows exactly one
	// declaration, so an omission can never widen a hole.
	assert.equal(allowedOccurrences({ id: 'probe' }), 1);
	assert.equal(allowedOccurrences({ id: 'probe', occurrences: 3 }), 3);
	assert.throws(() => allowedOccurrences({ id: 'probe', occurrences: 0 }), /positive integer/);
	assert.throws(() => allowedOccurrences({ id: 'probe', occurrences: 1.5 }), /positive integer/);
});

test('a declaration exclusion allows exactly the declarations it declares', () => {
	const entries = [
		{
			id: 'probe-allowance',
			file: 'src/probe.tsx',
			property: 'white-space',
			value: 'nowrap',
			occurrences: 2,
			reason: 'the probe allows two declarations and no more',
		},
	];
	const violation = (line) => ({
		rule: 'shipped-nowrap',
		file: 'src/probe.tsx',
		line,
		wcag: '1.4.10',
		property: 'white-space',
		value: 'nowrap',
		message: 'the shipped surface forbids wrapping',
	});

	// Up to the allowance, the declarations are excluded.
	const within = applyDeclarationExclusions([violation(1), violation(2)], entries);

	assert.deepEqual(within.violations, [], 'the two allowed declarations are excluded');
	assert.equal(within.excluded.length, 1);
	assert.equal(within.excluded[0].occurrences, 2);
	assert.equal(within.excluded[0].allowed, 2);
	assert.equal(within.excluded[0].id, 'probe-allowance');

	// One declaration beyond the allowance is a violation again.
	const beyond = applyDeclarationExclusions([violation(1), violation(2), violation(3)], entries);

	assert.equal(beyond.violations.length, 1, 'the third declaration is a violation');
	assert.equal(beyond.violations[0].rule, 'shipped-nowrap');
	assert.equal(beyond.violations[0].line, 3);
	assert.equal(beyond.violations[0].exhaustedExclusion.id, 'probe-allowance');
	assert.equal(beyond.violations[0].exhaustedExclusion.allowed, 2);
	assert.match(beyond.violations[0].message, /allows 2 occurrence\(s\)/);
	assert.match(beyond.violations[0].message, /one too many/);
});

test('the exclusion report shows the allowance and the reason', () => {
	const shipped = auditShippedSource();

	for (const entry of shipped.excluded) {
		if (!entry.declaration) continue;
		assert.ok(entry.reason.length > 20, `${entry.file} must be excluded with a reason`);
		assert.ok(
			Number.isInteger(entry.allowed) && entry.allowed >= 1,
			`${entry.file} must report the allowance it consumed`,
		);
		assert.ok(entry.occurrences <= entry.allowed, 'the exclusion never exceeds its allowance');
	}
	const report = renderGateSummary(collectEvidence());

	assert.match(report, /out of scope/);
	assert.match(
		report,
		/src\/editorial\/table-code\.tsx \(white-space: nowrap ×2 \/ allowed 2\)/,
		'the report prints the used and the allowed count',
	);
	for (const exclusion of SHIPPED_DECLARATION_EXCLUSIONS) {
		assert.ok(
			report.includes(exclusion.reason),
			`${exclusion.id} must appear in the report with its reason`,
		);
	}
});

test('the exclusion list is used, not dead code', () => {
	assert.equal(exclusionFor('src/home/hero.test.tsx')?.id, 'test-files');
	assert.equal(exclusionFor('src/home/hero.stories.tsx')?.id, 'story-files');
	assert.equal(exclusionFor('src/routes/design-system/index.tsx')?.id, 'design-system-route');
	assert.equal(exclusionFor('src/home/hero.tsx'), null);
});

test('the shipped source scan finds no violation and shows its holes', () => {
	const shipped = auditShippedSource();

	assert.deepEqual(shipped.violations, [], 'the shipped source must not break the reflow contract');
	assert.ok(shipped.filesScanned > 100, 'the scan must actually read the shipped source');
	for (const entry of shipped.excluded) {
		assert.ok(entry.reason.length > 20, `${entry.file} must be excluded with a reason`);
	}
});

/* ------------------------------------------------------------------ *
 * One definition for both halves
 * ------------------------------------------------------------------ */

test('the browser cases are derived from the fixture files', () => {
	const entries = readFixtureEntries();
	const cases = deriveSpecimenCases(entries);

	assert.equal(cases.length, entries.length);
	for (const entry of entries) {
		const specimen = describeSpecimen(entry);
		assert.ok(specimen.specimenId, `${entry.relativePath} must declare a specimen id`);
		assert.ok(specimen.kind, `${entry.relativePath} must declare a specimen kind`);
		assert.ok(specimen.text, `${entry.relativePath} must render text`);
	}
	assert.equal(
		cases.filter((entry) => entry.expectOverflow).length,
		Object.keys(FIXTURE_EXPECTATIONS.fail).length,
	);
});

test('a fixture without a readable specimen is refused, not rendered as an empty box', () => {
	assert.throws(
		() =>
			deriveSpecimenCases([
				{
					directory: 'pass',
					name: 'broken.tsx',
					relativePath: `${FIXTURE_ROOT}/pass/broken.tsx`,
					source: 'export const A = () => <div>text</div>;',
				},
			]),
		/does not declare a readable specimen/,
	);
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

test('the report shows a declaration the gate cannot convert', () => {
	const evidence = collectEvidence();
	const report = renderGateSummary({
		...evidence,
		shipped: {
			...evidence.shipped,
			undecidable: [
				{
					file: 'src/probe.tsx',
					line: 1,
					property: 'min-width',
					value: '25em',
					unit: 'em',
					reason:
						'`em` depends on the font context the gate does not have; the declaration is not judged',
				},
			],
		},
	});

	assert.match(report, /out of scope/);
	assert.match(report, /src\/probe\.tsx:1 \(min-width: 25em\)/);
});
