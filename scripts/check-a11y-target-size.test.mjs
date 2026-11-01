/**
 * The Issue #401 gate's own unit tests.
 *
 * The gate is a contract, so its decisions have to be testable without a
 * checkout: a rule that can only be observed by running the whole scan
 * is one nobody re-runs when it breaks.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	EXCEPTION_KINDS,
	FIXTURE_EXPECTATIONS,
	FIXTURE_ROOT,
	MIN_TARGET_PX,
	RULE_CRITERION,
	SIZES,
	SPACING,
	SURFACES,
	WCAG,
	WCAG_DRAGGING,
	auditFixtureFiles,
	collectEvidence,
	cssPropertyFor,
	declaredSize,
	declaresAlternativeOperation,
	describeSpecimen,
	dragAffordancesOf,
	elementStyleDeclarations,
	evaluateFixtureSource,
	evaluateShippedSource,
	evaluateTarget,
	findTags,
	isInteractiveTarget,
	readDeclaredException,
	resolvePx,
} from './check-a11y-target-size.mjs';

test('the minimum is the 24 px the criterion names', () => {
	assert.equal(MIN_TARGET_PX, 24);
});

test('a style literal resolves to CSS px, and an undecidable one to null', () => {
	assert.equal(resolvePx('24px', 'sizes'), 24);
	assert.equal(resolvePx('1.5rem', 'sizes'), 24);
	assert.equal(resolvePx('16px', 'sizes'), 16);
	assert.equal(resolvePx('8', 'sizes'), SIZES[8]);
	assert.equal(resolvePx('8', 'spacing'), SPACING[8]);
	assert.equal(resolvePx('auto', 'sizes'), null);
	assert.equal(resolvePx('100%', 'sizes'), null);
	assert.equal(resolvePx('calc(100% - 2px)', 'sizes'), null);
	assert.equal(resolvePx('', 'sizes'), null);
});

test('a React style key becomes the CSS property it writes', () => {
	assert.equal(cssPropertyFor('h'), 'height');
	assert.equal(cssPropertyFor('minH'), 'min-height');
	assert.equal(cssPropertyFor('w'), 'width');
	assert.equal(cssPropertyFor('minW'), 'min-width');
	assert.equal(cssPropertyFor('minWidth'), 'min-width');
	assert.equal(cssPropertyFor('size'), 'size');
	assert.equal(cssPropertyFor('rowGap'), 'row-gap');
});

test('the declared size is the smallest the declaration allows', () => {
	const declarations = elementStyleDeclarations(
		"<button className={css({ height: '9', minHeight: '8', width: '40px' })}>",
	);
	const size = declaredSize(declarations);
	assert.equal(size.height, 32);
	assert.equal(size.width, 40);
});

test('a min-width of 0 declares the absence of a floor, not a small target', () => {
	const size = declaredSize(
		elementStyleDeclarations("<button className={css({ minWidth: '0' })}>"),
	);
	assert.equal(size.width, null);
	assert.equal(size.height, null);
});

test('a responsive declaration is judged by its smallest step', () => {
	const size = declaredSize(
		elementStyleDeclarations("<button className={css({ height: { base: '6', md: '9' } })}>"),
	);
	assert.equal(size.height, 24);
});

test('an inline style object is read as a declaration too', () => {
	const size = declaredSize(
		elementStyleDeclarations("<button style={{ width: '16px', height: '16px' }}>"),
	);
	assert.equal(size.height, 16);
	assert.equal(size.width, 16);
});

test('a target that declares a size below the minimum is a violation', () => {
	const tags = findTags("<button className={css({ height: '4' })}>x</button>");
	const result = evaluateTarget({
		relativePath: 'src/example.tsx',
		tag: tags[0].tag,
		attributes: tags[0].attributes,
		declarations: elementStyleDeclarations(tags[0].text),
	});
	assert.equal(result.verdict, 'undersized');
	assert.equal(result.violations.length, 1);
	assert.equal(result.violations[0].rule, 'shipped-target-undersized');
	assert.equal(result.violations[0].px, 16);
});

test('a target that declares exactly the minimum is compliant', () => {
	const tags = findTags("<button className={css({ height: '6', width: '6' })}>x</button>");
	const result = evaluateTarget({
		relativePath: 'src/example.tsx',
		tag: tags[0].tag,
		attributes: tags[0].attributes,
		declarations: elementStyleDeclarations(tags[0].text),
	});
	assert.equal(result.verdict, 'compliant');
	assert.equal(result.violations.length, 0);
});

test('a target that declares no size is undecided, never compliant', () => {
	const tags = findTags('<a href="/x">link</a>');
	const result = evaluateTarget({
		relativePath: 'src/example.tsx',
		tag: tags[0].tag,
		attributes: tags[0].attributes,
		declarations: elementStyleDeclarations(tags[0].text),
	});
	assert.equal(result.verdict, 'undecided');
	assert.equal(result.violations.length, 0);
});

test('a drag gesture without a click alternative is a violation', () => {
	const tags = findTags('<div draggable onDragStart={start}>x</div>');
	const result = evaluateTarget({
		relativePath: 'src/example.tsx',
		tag: tags[0].tag,
		attributes: tags[0].attributes,
		declarations: elementStyleDeclarations(tags[0].text),
	});
	assert.deepEqual(result.affordances, ['onDragStart', 'draggable']);
	assert.equal(result.violations.length, 1);
	assert.equal(result.violations[0].rule, 'shipped-drag-without-alternative');
});

test('a drag gesture with a click alternative is not a violation', () => {
	const tags = findTags('<div draggable onDragStart={start} onClick={pick}>x</div>');
	const result = evaluateTarget({
		relativePath: 'src/example.tsx',
		tag: tags[0].tag,
		attributes: tags[0].attributes,
		declarations: elementStyleDeclarations(tags[0].text),
	});
	assert.equal(result.violations.length, 0);
});

test('draggable="false" takes the drag away instead of offering one', () => {
	const tags = findTags('<div draggable="false">x</div>');
	assert.deepEqual(dragAffordancesOf(tags[0].attributes), []);
});

test('a keyboard-operable custom control is an alternative too', () => {
	const tags = findTags('<div draggable tabIndex={0} onKeyDown={handle}>x</div>');
	assert.equal(declaresAlternativeOperation(tags[0].tag, tags[0].attributes), true);
});

test('a drag-only element is caught even when it is not an interactive target', () => {
	// A drag gesture is an OPERATION, and the element that carries it is
	// usually a plain element with no role at all. If the rule only looked
	// at interactive targets, the one element a pointer-only operation
	// actually lives on would be the one the rule skips.
	const source = [
		'export const Card = () => (',
		'\t<div draggable onDragStart={() => {}}>drag me</div>',
		');',
	].join('\n');
	const result = evaluateShippedSource({ relativePath: 'src/example.tsx', source });
	assert.equal(result.violations.length, 1);
	assert.equal(result.violations[0].rule, 'shipped-drag-without-alternative');
	assert.equal(result.targets.length, 0);
});

test('a drag-only element with a click alternative is left alone', () => {
	const source = [
		'export const Card = () => (',
		'\t<div draggable onDragStart={() => {}} onClick={() => {}}>drag me</div>',
		');',
	].join('\n');
	const result = evaluateShippedSource({ relativePath: 'src/example.tsx', source });
	assert.equal(result.violations.length, 0);
});

test('an anchor without an href is not a target, an anchor with one is', () => {
	const plain = findTags('<a>text</a>');
	const linked = findTags('<a href={item.to}>text</a>');
	assert.equal(isInteractiveTarget(plain[0].tag, plain[0].attributes), false);
	assert.equal(isInteractiveTarget(linked[0].tag, linked[0].attributes), true);
});

test('a specimen that declares a size below the minimum is a violation', () => {
	const source = `
		<div data-target-specimen="s" style={{ display: 'flex', gap: '24px' }}>
			<button data-target-target="primary" style={{ width: '16px', height: '16px' }}>A</button>
		</div>
	`;
	const result = evaluateFixtureSource({ relativePath: 'fixture.tsx', source });
	assert.equal(result.violations.length, 2);
	assert.deepEqual(
		result.violations.map((violation) => violation.rule),
		['target-specimen-undersized', 'target-specimen-undersized'],
	);
	assert.deepEqual(
		result.violations.map((violation) => violation.axis),
		['height', 'width'],
	);
});

test('a specimen that declares a valid exception is not a violation', () => {
	const source = `
		<div
			data-target-specimen="s"
			data-target-exception="spacing"
			data-target-reason="the chips are 24 px apart"
			style={{ display: 'flex', gap: '24px' }}
		>
			<button data-target-target="primary" style={{ width: '16px', height: '16px' }}>A</button>
		</div>
	`;
	const result = evaluateFixtureSource({ relativePath: 'fixture.tsx', source });
	assert.equal(result.violations.length, 0);
});

test('an exception without a reason is not an exception', () => {
	const source = `
		<div data-target-specimen="s" data-target-exception="spacing">
			<button data-target-target="primary" style={{ width: '16px', height: '16px' }}>A</button>
		</div>
	`;
	const result = evaluateFixtureSource({ relativePath: 'fixture.tsx', source });
	const rules = result.violations.map((violation) => violation.rule);
	assert.ok(rules.includes('target-specimen-exception-invalid'));
});

test('an exception the criterion does not name is rejected', () => {
	const source = `
		<div data-target-specimen="s" data-target-exception="because" data-target-reason="why">
			<button data-target-target="primary" style={{ width: '16px', height: '16px' }}>A</button>
		</div>
	`;
	const result = evaluateFixtureSource({ relativePath: 'fixture.tsx', source });
	const rules = result.violations.map((violation) => violation.rule);
	assert.ok(rules.includes('target-specimen-exception-invalid'));
});

test('a drag-only specimen is a violation', () => {
	const source = `
		<div data-target-specimen="s">
			<div data-target-target="draggable" draggable onDragStart={() => {}}>A</div>
		</div>
	`;
	const result = evaluateFixtureSource({ relativePath: 'fixture.tsx', source });
	const rules = result.violations.map((violation) => violation.rule);
	assert.ok(rules.includes('target-specimen-drag-only'));
});

test('the specimen reader keeps the ids, the exception and the spacing', () => {
	const source = `
		<div
			data-target-specimen="spacing-exception"
			data-target-exception="spacing"
			data-target-reason="the chips are 24 px apart"
			style={{ display: 'flex', gap: '24px' }}
		>
			<button data-target-target="primary" style={{ width: '16px', height: '16px' }}>A</button>
			<button data-target-target="secondary" style={{ width: '16px', height: '16px' }}>B</button>
		</div>
	`;
	const specimen = describeSpecimen({ relativePath: 'fixture.tsx', source });
	assert.equal(specimen.specimenId, 'spacing-exception');
	assert.equal(specimen.exception.kind, 'spacing');
	assert.equal(specimen.exception.valid, true);
	assert.equal(specimen.gap, 24);
	assert.equal(specimen.targets.length, 2);
	assert.equal(specimen.targets[0].name, 'primary');
});

test('the roster is checked against the files, not trusted', () => {
	const entries = [
		{
			directory: 'pass',
			relativePath: 'pass/a.tsx',
			expected: { staticRules: [], sizeVerdict: 'pass' },
			evaluation: { violations: [] },
			specimen: { specimenId: 'a', targets: [{}] },
		},
		{
			directory: 'pass',
			relativePath: 'pass/b.tsx',
			expected: { staticRules: [], sizeVerdict: 'pass' },
			evaluation: { violations: [{ rule: 'target-specimen-undersized' }] },
			specimen: { specimenId: 'b', targets: [{}] },
		},
		{
			directory: 'pass',
			relativePath: 'pass/c.tsx',
			expected: { staticRules: [], sizeVerdict: 'pass' },
			evaluation: { violations: [] },
			specimen: { specimenId: null, targets: [] },
		},
		{
			directory: 'fail',
			relativePath: 'fail/a.tsx',
			expected: { staticRules: ['target-specimen-undersized'], sizeVerdict: 'fail' },
			evaluation: { violations: [] },
			specimen: { specimenId: 'a', targets: [{}] },
		},
		{
			directory: 'fail',
			relativePath: 'fail/b.tsx',
			expected: { staticRules: ['target-specimen-undersized'], sizeVerdict: 'fail' },
			evaluation: { violations: [{ rule: 'target-specimen-drag-only' }] },
			specimen: { specimenId: 'b', targets: [{}] },
		},
	];
	const { violations } = auditFixtureFiles(entries);
	const rules = violations.map((violation) => violation.rule);
	assert.ok(rules.includes('fixture-pass-violation'));
	assert.ok(rules.includes('fixture-pass-no-specimen'));
	assert.ok(rules.includes('fixture-fail-not-detected'));
	assert.ok(rules.includes('fixture-fail-unexpected'));
});

test('the shipped surfaces of this Issue are the three it names', () => {
	assert.deepEqual(
		SURFACES.map((surface) => surface.id),
		['reaction-picker', 'nav', 'filter'],
	);
	for (const surface of SURFACES) {
		assert.ok(surface.reason.length > 0);
	}
});

test('the five exceptions are the ones the criterion names', () => {
	assert.deepEqual(Object.keys(EXCEPTION_KINDS).sort(), [
		'equivalent',
		'essential',
		'inline',
		'spacing',
		'user-agent',
	]);
});

test('the drag rules answer to SC 2.5.7 and the size rules to SC 2.5.8', () => {
	assert.equal(WCAG.sc, '2.5.8');
	assert.equal(WCAG_DRAGGING.sc, '2.5.7');
	assert.equal(RULE_CRITERION['shipped-drag-without-alternative'], '2.5.7');
	assert.equal(RULE_CRITERION['target-specimen-drag-only'], '2.5.7');
	assert.equal(RULE_CRITERION['shipped-target-undersized'], '2.5.8');
	assert.equal(RULE_CRITERION['target-specimen-undersized'], '2.5.8');
	assert.equal(RULE_CRITERION['target-specimen-exception-invalid'], '2.5.8');
});

test('a drag violation carries the dragging criterion, a size violation the size one', () => {
	const dragSource = [
		'export const Card = () => (',
		'\t<div draggable onDragStart={() => {}}>drag me</div>',
		');',
	].join('\n');
	const drag = evaluateShippedSource({ relativePath: 'src/example.tsx', source: dragSource });
	assert.equal(drag.violations.length, 1);
	assert.equal(drag.violations[0].rule, 'shipped-drag-without-alternative');
	assert.equal(drag.violations[0].wcag, '2.5.7');

	const sizeSource = [
		'export const Card = () => (',
		"\t<button className={css({ height: '4' })}>small</button>",
		');',
	].join('\n');
	const size = evaluateShippedSource({ relativePath: 'src/example.tsx', source: sizeSource });
	assert.equal(size.violations.length, 1);
	assert.equal(size.violations[0].rule, 'shipped-target-undersized');
	assert.equal(size.violations[0].wcag, '2.5.8');
});

test('a drag specimen carries the dragging criterion too', () => {
	const source = `
		<div data-target-specimen="s">
			<div data-target-target="draggable" draggable onDragStart={() => {}}>A</div>
		</div>
	`;
	const result = evaluateFixtureSource({ relativePath: 'fixture.tsx', source });
	const drag = result.violations.find(
		(violation) => violation.rule === 'target-specimen-drag-only',
	);
	assert.ok(drag);
	assert.equal(drag.wcag, '2.5.7');
});

test('the drag rule says it reads a declaration, not a function', () => {
	const source = [
		'export const Card = () => (',
		'\t<div draggable onDragStart={() => {}}>drag me</div>',
		');',
	].join('\n');
	const result = evaluateShippedSource({ relativePath: 'src/example.tsx', source });
	assert.match(result.violations[0].message, /DECLARATION/);
	assert.match(result.violations[0].message, /human evaluation/);
});

test('a fixture that stands for another criterion than its rule reports is reported', () => {
	const entries = [
		{
			directory: 'fail',
			relativePath: 'fail/drag.tsx',
			expected: {
				staticRules: ['target-specimen-drag-only'],
				sizeVerdict: 'pass',
				criterion: WCAG_DRAGGING.sc,
			},
			evaluation: { violations: [{ rule: 'target-specimen-drag-only' }] },
			specimen: { specimenId: 'drag', targets: [{}] },
		},
	];
	assert.deepEqual(auditFixtureFiles(entries).violations, []);

	const drifted = [
		{
			...entries[0],
			expected: { ...entries[0].expected, criterion: WCAG.sc },
		},
	];
	const rules = auditFixtureFiles(drifted).violations.map((violation) => violation.rule);
	assert.ok(rules.includes('fixture-fail-criterion-mismatch'));
});

test('the equivalent exception needs a reason AND the name of the control', () => {
	const both = readDeclaredException(
		findTags(
			'<button data-target-exception="equivalent" data-target-reason="the full-size button offers the same function" data-target-equivalent="#full-size-button">A</button>',
		)[0].attributes,
	);
	assert.equal(both.valid, true);
	assert.equal(both.equivalent, '#full-size-button');

	const noControl = readDeclaredException(
		findTags(
			'<button data-target-exception="equivalent" data-target-reason="the full-size button offers the same function">A</button>',
		)[0].attributes,
	);
	assert.equal(noControl.valid, false);

	const noReason = readDeclaredException(
		findTags(
			'<button data-target-exception="equivalent" data-target-equivalent="#full-size-button">A</button>',
		)[0].attributes,
	);
	assert.equal(noReason.valid, false);
});

test('an equivalent declaration without a named control is not an exception', () => {
	const source = `
		<div data-target-specimen="s">
			<button
				data-target-target="primary"
				data-target-exception="equivalent"
				data-target-reason="the same function is offered elsewhere on the page"
				style={{ width: '16px', height: '16px' }}
			>A</button>
		</div>
	`;
	const result = evaluateFixtureSource({ relativePath: 'fixture.tsx', source });
	const rules = result.violations.map((violation) => violation.rule);
	assert.ok(rules.includes('target-specimen-exception-invalid'));
	assert.ok(rules.includes('target-specimen-undersized'));
});

test('an equivalent declaration that names a control is a valid exception', () => {
	const source = `
		<div data-target-specimen="s">
			<button
				data-target-target="primary"
				data-target-exception="equivalent"
				data-target-reason="the full-size button offers the same function"
				data-target-equivalent="#full-size-button"
				style={{ width: '16px', height: '16px' }}
			>A</button>
			<button
				id="full-size-button"
				data-target-target="secondary"
				style={{ width: '24px', height: '24px' }}
			>B</button>
		</div>
	`;
	const result = evaluateFixtureSource({ relativePath: 'fixture.tsx', source });
	assert.deepEqual(result.violations, []);
});

test('the shipped surface of the repository declares no size below the minimum', () => {
	const surface = SURFACES.find((entry) => entry.id === 'nav');
	const result = evaluateShippedSource({
		relativePath: surface.file,
		source: `
			<a href="/" className={css({ display: 'inline-flex' })}>samuido</a>
			<button type="button" className={css({ height: '9' })}>Menu</button>
		`,
	});
	assert.equal(result.violations.length, 0);
	assert.equal(result.targets.length, 2);
});

test('the repository itself is clean: the gate reports no violation', () => {
	const evidence = collectEvidence();
	assert.deepEqual(evidence.violations, []);
	assert.equal(evidence.fixture.rows.length, 10);
	for (const row of evidence.fixture.rows) {
		assert.deepEqual(
			[...row.found].sort(),
			[...row.expected].sort(),
			`${row.file} does not reproduce what it stands for`,
		);
	}
});

test('the roster names every fixture file that exists', () => {
	const expected = Object.values(FIXTURE_EXPECTATIONS).reduce(
		(total, entries) => total + Object.keys(entries).length,
		0,
	);
	assert.equal(expected, 10);
	assert.ok(FIXTURE_ROOT.startsWith('scripts/fixtures/'));
});
