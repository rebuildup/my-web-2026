/**
 * The Issue #395 gate's own unit tests.
 *
 * The gate is the machine half of the Issue ("フォーカスが見えること /
 * フォーカス位置が隠されていないことを機械検査で固定する"), so the rules have
 * to be testable without a browser: a rule that can only fail inside a real
 * page is a rule nobody re-runs when it breaks.
 *
 * The fixture assertions are deliberately strict. A test that only checked
 * "the fixture produced some output" would pass after a fixture file was
 * deleted or after the fixture stopped reproducing its defect, so the roster
 * is compared with the directory listing and every fail fixture is matched
 * against the rule it stands for.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	EXCLUSIONS,
	FIXTURE_EXPECTATIONS,
	FIXTURE_ROOT,
	HUMAN_EVALUATION,
	RULES,
	SCOPE_NOTES,
	auditFixtureFiles,
	buildBindings,
	collectEvidence,
	declaredCompensations,
	enclosingTag,
	evaluateFocusBlock,
	evaluateOverlay,
	isDocumentScrollConsumer,
	nonModalOpenCall,
	parseStyleObject,
	publishedCustomProperties,
	refNameOf,
	renderGateSummary,
	scanSource,
	scanStylesheet,
} from './check-a11y-focus-visible.mjs';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

/** Scan a source snippet the way the gate scans a file. */
function scan(source, bindings = []) {
	return scanSource({ relativePath: 'src/home/example.tsx', source, bindings });
}

test('a focus block that removes the outline is a violation', () => {
	const { violations } = scan(
		'export const A = () => <a className={css({ _focusVisible: { outline: "none" } })} />;\n',
	);

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'focus-indicator-removed');
	assert.equal(violations[0].wcag, '2.4.7');
	assert.match(violations[0].message, /no visible focus/);
});

test('a zero-width outline is the same defect with a different spelling', () => {
	for (const declaration of ['outline: "0"', 'outline: "0px"', 'outlineWidth: "0"']) {
		const { violations } = scan(
			`export const A = () => <a className={css({ _focus: { ${declaration} } })} />;\n`,
		);

		assert.equal(violations.length, 1, `${declaration} must be reported`);
		assert.equal(violations[0].rule, 'focus-indicator-removed');
	}
});

test('an outline style of none removes the indicator too', () => {
	const { violations } = scan(
		'export const A = () => <a className={css({ _focus: { outlineStyle: "none" } })} />;\n',
	);

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'focus-indicator-removed');
});

test('a transparent outline is invisible, not removed', () => {
	const { violations } = scan(
		'export const A = () => <a className={css({ _focus: { outline: "transparent" } })} />;\n',
	);

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'focus-indicator-invisible');
	assert.equal(violations[0].wcag, '2.4.7');
});

test('a transparent outline colour is invisible too', () => {
	const { violations } = scan(
		'export const A = () => <a className={css({ _focus: { outlineColor: "transparent" } })} />;\n',
	);

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'focus-indicator-invisible');
});

test('a replacement indicator keeps the focus visible', () => {
	const { violations } = scan(
		'export const A = () => <a className={css({ _focusVisible: { outline: "none", boxShadow: "0 0 0 2px #2b6cb0" } })} />;\n',
	);

	assert.deepEqual(violations, []);
});

test('a visible outline is not a violation', () => {
	for (const declaration of [
		'outline: "2px solid #2b6cb0"',
		'outline: "2px solid {colors.border.focus}"',
		'outlineWidth: "2px"',
	]) {
		const { violations } = scan(
			`export const A = () => <a className={css({ _focusVisible: { ${declaration} } })} />;\n`,
		);

		assert.deepEqual(violations, [], `${declaration} must be accepted`);
	}
});

test('a focus block that says nothing about the outline keeps the browser default', () => {
	const { violations } = scan(
		'export const A = () => <a className={css({ _focusVisible: { backgroundColor: "bg.surface" } })} />;\n',
	);

	assert.deepEqual(violations, []);
});

test('a focus condition named in a comment is documentation, not a violation', () => {
	const source = [
		'/**',
		' * A `_focusVisible: { outline: "none" }` block would remove the focus.',
		' */',
		'export const A = () => <div />;',
	].join('\n');

	assert.deepEqual(scan(source).violations, []);
});

test('a fixed overlay without a compensation is a violation', () => {
	const { violations } = scan(
		'export const A = () => <div className={css({ position: "fixed", bottom: "0" })} />;\n',
	);

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'focus-obscured-no-compensation');
	assert.equal(violations[0].wcag, '2.4.11');
	assert.match(violations[0].message, /compensation/);
});

test('a sticky overlay without a compensation is a violation', () => {
	const { violations } = scan(
		'export const A = () => <header className={css({ position: "sticky", top: "0" })} />;\n',
	);

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'focus-obscured-no-compensation');
});

test('an overlay bound to a published offset is compensated', () => {
	const source = [
		'export const A = () => (',
		'\t<body className={css({ scrollPaddingBottom: "var(--surface-offset)" })}>',
		'\t\t<div className={css({ position: "fixed" })} />',
		'\t</body>',
		');',
		'document.documentElement.style.setProperty("--surface-offset", "12rem");',
	].join('\n');
	const bindings = buildBindings([
		{
			relativePath: 'src/home/example.tsx',
			published: publishedCustomProperties(source),
			compensations: declaredCompensations(source),
		},
	]);

	const { violations, overlays } = scan(source, bindings);

	assert.deepEqual(violations, []);
	assert.equal(overlays.length, 1);
	assert.equal(overlays[0].position, 'fixed');
});

test('a compensation that nothing publishes is a dead declaration', () => {
	// The document reserves the space, but no file publishes the offset,
	// so the chain is open and the overlay is uncompensated.
	const source = [
		'export const A = () => (',
		'\t<div className={css({ scrollPaddingBottom: "var(--surface-offset)" })}>',
		'\t\t<div className={css({ position: "fixed" })} />',
		'\t</div>',
		');',
	].join('\n');
	const bindings = buildBindings([
		{
			relativePath: 'src/home/example.tsx',
			published: publishedCustomProperties(source),
			compensations: declaredCompensations(source),
		},
	]);

	const { violations } = scan(source, bindings);

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'focus-obscured-no-compensation');
});

test('an offset published in another file does not compensate this overlay', () => {
	// The publication exists, but in a DIFFERENT file than the overlay:
	// the overlay's own file has to publish the offset it occupies.
	const source = 'export const A = () => <div className={css({ position: "fixed" })} />;\n';
	const bindings = buildBindings([
		{
			relativePath: 'src/home/other.tsx',
			published: publishedCustomProperties('setProperty("--surface-offset", "1rem");'),
			compensations: [],
		},
	]);

	const { violations } = scan(source, bindings);

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'focus-obscured-no-compensation');
});

test('a native modal dialog is not an overlay that can obscure the focus', () => {
	const source = [
		'export const A = () => (',
		'\t<dialog className={css({ position: "fixed" })}>',
		'\t\t<p>Example</p>',
		'\t</dialog>',
		');',
		'dialog.showModal();',
	].join('\n');

	const { violations, overlays } = scan(source);

	assert.deepEqual(violations, []);
	assert.equal(overlays.length, 1);
	assert.equal(overlays[0].modal, true);
});

test('the modal exemption needs the dialog to be opened modally', () => {
	const source = [
		'export const A = () => <dialog className={css({ position: "fixed" })}>Example</dialog>;',
	].join('\n');

	const { violations, overlays } = scan(source);

	assert.equal(overlays[0].modal, false);
	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'focus-obscured-no-compensation');
});

test('a non-modal dialog in a file that also opens a modal one is not exempt', () => {
	// The modal exemption is decided per ELEMENT, not per file: a
	// `<dialog open>` in a file that also calls `showModal()` is still
	// non-modal and can still obscure a focused element.
	const source = [
		'export const A = () => (',
		'\t<>',
		'\t\t<dialog className={css({ position: "fixed" })}>Modal</dialog>',
		'\t\t<dialog open className={css({ position: "fixed", bottom: "0" })}>Non-modal</dialog>',
		'\t</>',
		');',
		'dialog.showModal();',
	].join('\n');

	const { violations, overlays } = scan(source);

	assert.equal(overlays.length, 2);
	assert.equal(overlays[0].modal, true);
	assert.equal(overlays[1].modal, false);
	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'focus-obscured-no-compensation');
});

test('an open attribute written after the css call is still read', () => {
	// JSX attribute order is free: `open` may follow `className={css(...)}`.
	// The gate has to read the whole start tag, not only the text before
	// the `css(` call, or the non-modal dialog is exempted.
	const source = [
		'export const A = () => (',
		'\t<>',
		'\t\t<dialog className={css({ position: "fixed" })}>Modal</dialog>',
		'\t\t<dialog className={css({ position: "fixed", bottom: "0" })} open>Non-modal</dialog>',
		'\t</>',
		');',
		'dialog.showModal();',
	].join('\n');

	const { violations, overlays } = scan(source);

	assert.equal(overlays.length, 2);
	assert.equal(overlays[0].modal, true);
	assert.equal(overlays[1].modal, false);
	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'focus-obscured-no-compensation');
});

test('enclosingTag reads the whole start tag, in either attribute order', () => {
	const source = '<dialog className={css({ position: "fixed" })} open>';
	const tag = enclosingTag(source, source.indexOf('css('));

	assert.equal(tag.name, 'dialog');
	assert.match(tag.body, /open/);
});

test('a css call in a sibling expression has no enclosing attribute tag', () => {
	// The nearest `<div>` closed before the `css(` call, so the call is a
	// shared style constant, not an attribute of that div.
	const source = '<div />\nconst style = css({ position: "fixed" });';

	assert.equal(enclosingTag(source, source.indexOf('css(')), null);
});

test('an unrelated show() helper does not strip a modal dialog exemption', () => {
	const source = [
		'export const A = () => (',
		'\t<dialog ref={openModal} className={css({ position: "fixed" })}>Modal</dialog>',
		');',
		'const openModal = (d) => d?.showModal();',
		'function show() {}',
		'show();',
	].join('\n');

	const { violations, overlays } = scan(source);

	assert.equal(overlays[0].modal, true);
	assert.deepEqual(violations, []);
});

test('the non-modal show() call is tied to the element ref', () => {
	const body = ' ref={panelRef} className={css({ position: "fixed" })}';

	assert.equal(refNameOf(body), 'panelRef');
	assert.equal(refNameOf(' className={css({ position: "fixed" })}'), null);
	assert.equal(nonModalOpenCall('panelRef.current.show();', body), true);
	assert.equal(nonModalOpenCall('other.show();', body), false);
	assert.equal(nonModalOpenCall('function show() {}\nshow();', body), false);
	assert.equal(nonModalOpenCall('panelRef.current.showModal();', body), false);
});

test('a compensation on the overlay itself is not a document consumption', () => {
	// Moving the compensation from the document onto the fixed overlay
	// must NOT close the chain: a `scrollPaddingBottom` on the overlay
	// reserves nothing.
	const source = [
		'export const A = () => (',
		'\t<div className={css({ position: "fixed", bottom: "0", scrollPaddingBottom: "var(--surface-offset)" })} />',
		');',
		'document.documentElement.style.setProperty("--surface-offset", "12rem");',
	].join('\n');
	const bindings = buildBindings([
		{
			relativePath: 'src/home/example.tsx',
			published: publishedCustomProperties(source),
			compensations: declaredCompensations(source),
		},
	]);

	const { violations } = scan(source, bindings);

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'focus-obscured-no-compensation');
});

test('a document scroll element is the only consumer that counts', () => {
	assert.equal(
		isDocumentScrollConsumer({ property: 'scrollPaddingBottom', selector: ':root' }),
		true,
	);
	assert.equal(isDocumentScrollConsumer({ property: 'scrollPadding', selector: 'body' }), true);
	assert.equal(isDocumentScrollConsumer({ property: 'paddingBottom', selector: 'body' }), true);
	assert.equal(isDocumentScrollConsumer({ property: 'paddingBottom', selector: ':root' }), false);
	assert.equal(
		isDocumentScrollConsumer({ property: 'scrollPadding', selector: '.overlay' }),
		false,
	);
	assert.equal(isDocumentScrollConsumer({ property: 'scrollPadding', selector: null }), false);
});

test('a raw CSS focus rule that removes the outline is a violation', () => {
	const { violations } = scanStylesheet({
		relativePath: 'src/styles.css',
		source: 'button:focus,\na:focus {\n\toutline: none;\n}\n',
	});

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'focus-indicator-removed-in-css');
	assert.equal(violations[0].wcag, '2.4.7');
});

test('a raw CSS focus rule that keeps the outline is not a violation', () => {
	const { violations } = scanStylesheet({
		relativePath: 'src/styles.css',
		source: ':focus-visible {\n\toutline: 2px solid red;\n}\n',
	});

	assert.deepEqual(violations, []);
});

test("a pointer-only focus rule is not this rule's defect", () => {
	// `:focus:not(:focus-visible)` targets the pointer focus, where the
	// browser default ring is not required; the keyboard indicator is
	// untouched.
	const { violations } = scanStylesheet({
		relativePath: 'src/styles.css',
		source: ':focus:not(:focus-visible) {\n\toutline: none;\n}\n',
	});

	assert.deepEqual(violations, []);
});

test('a transparent outline shorthand is invisible, not visible', () => {
	assert.equal(
		evaluateFocusBlock(parseStyleObject("outline: '2px solid transparent'")),
		'invisible',
	);
	assert.equal(evaluateFocusBlock(parseStyleObject("outline: '2px solid #0000'")), 'invisible');
	assert.equal(
		evaluateFocusBlock(parseStyleObject("outline: '2px solid rgba(0,0,0,0)'")),
		'invisible',
	);
	assert.equal(evaluateFocusBlock(parseStyleObject("outline: '2px solid red'")), 'visible');
});

test('a no-op colour is not a replacement indicator', () => {
	for (const value of ['inherit', 'currentColor', 'unset', 'revert', 'initial']) {
		assert.equal(
			evaluateFocusBlock(parseStyleObject(`outline: 'none'\ncolor: '${value}'`)),
			'removed',
			`color: ${value} must not count as a replacement`,
		);
	}
	assert.equal(evaluateFocusBlock(parseStyleObject("outline: 'none'\ncolor: 'red'")), 'visible');
});

test('a published offset is found through a module constant', () => {
	const source = [
		"const FOCUS_OFFSET_PROPERTY = '--surface-offset';",
		'document.documentElement.style.setProperty(FOCUS_OFFSET_PROPERTY, "12rem");',
	].join('\n');

	assert.deepEqual([...publishedCustomProperties(source)], ['--surface-offset']);
});

test('the focus verdict is decided by the shared rule table', () => {
	assert.equal(evaluateFocusBlock(parseStyleObject('outline: "none"')), 'removed');
	assert.equal(evaluateFocusBlock(parseStyleObject('outline: "transparent"')), 'invisible');
	assert.equal(evaluateFocusBlock(parseStyleObject('outline: "2px solid red"')), 'visible');
	assert.equal(
		evaluateFocusBlock(parseStyleObject('outline: "none"\nboxShadow: "0 0 0 2px red"')),
		'visible',
	);
	assert.equal(evaluateFocusBlock(parseStyleObject('color: "red"')), 'visible');
});

test('the overlay verdict is decided by the shared rule table', () => {
	const overlay = {
		file: 'src/home/example.tsx',
		line: 1,
		tagName: 'div',
		position: 'fixed',
		modal: false,
	};

	assert.equal(evaluateOverlay(overlay, []).verdict, 'uncompensated');
	assert.equal(evaluateOverlay({ ...overlay, modal: true }, []).verdict, 'modal');
	assert.equal(
		evaluateOverlay(overlay, [
			{
				offset: '--x',
				compensation: 'scrollPaddingBottom',
				compensationFile: 'a.tsx',
				offsetPublishedIn: 'src/home/example.tsx',
			},
		]).verdict,
		'compensated',
	);
});

test('every rule the Issue names is a rule the gate knows', () => {
	for (const rule of [
		'focus-indicator-removed',
		'focus-indicator-invisible',
		'focus-indicator-removed-in-css',
		'focus-obscured-no-compensation',
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
		const source = readFileSync(file, 'utf8');
		const { violations } = scanSource({
			relativePath: `${FIXTURE_ROOT}/pass/${name}`,
			source,
			bindings: buildBindings([
				{
					relativePath: `${FIXTURE_ROOT}/pass/${name}`,
					published: publishedCustomProperties(source),
					compensations: declaredCompensations(source),
				},
			]),
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
		const source = readFileSync(file, 'utf8');
		const { violations } = scanSource({
			relativePath: `${FIXTURE_ROOT}/fail/${name}`,
			source,
			bindings: buildBindings([
				{
					relativePath: `${FIXTURE_ROOT}/fail/${name}`,
					published: publishedCustomProperties(source),
					compensations: declaredCompensations(source),
				},
			]),
		});

		assert.deepEqual(
			violations.map((violation) => violation.rule),
			expectedRules,
			`${name} must reproduce ${expectedRules.join(', ')}`,
		);
	}
});

test('every pass fixture holds a focus block or an overlay, so it exercises a rule', () => {
	for (const [name] of Object.entries(FIXTURE_EXPECTATIONS.pass)) {
		const file = join(REPO_ROOT, FIXTURE_ROOT, 'pass', name);
		const source = readFileSync(file, 'utf8');
		const { focusBlocks, overlays } = scanSource({
			relativePath: `${FIXTURE_ROOT}/pass/${name}`,
			source,
		});

		assert.ok(
			focusBlocks.length + overlays.length > 0,
			`${name} must hold a focus block or an overlay to prove anything`,
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
			foundRules: [],
			focusBlockCount: 0,
			overlayCount: 0,
		},
	]);

	assert.equal(audited.violations.length, 1);
	assert.equal(audited.violations[0].rule, 'fixture-pass-no-case');
});

test('a fail fixture that stopped reproducing its defect is reported', () => {
	const audited = auditFixtureFiles([
		{
			directory: 'fail',
			name: 'stopped.tsx',
			relativePath: `${FIXTURE_ROOT}/fail/stopped.tsx`,
			expectedRules: ['focus-indicator-removed'],
			foundRules: [],
			focusBlockCount: 1,
			overlayCount: 0,
		},
	]);

	assert.equal(audited.violations.length, 1);
	assert.equal(audited.violations[0].rule, 'fixture-fail-not-detected');
});

test('the shipped repository passes the gate', () => {
	const evidence = collectEvidence();

	assert.deepEqual(evidence.violations, []);
	assert.ok(evidence.filesScanned > 0);
	assert.ok(evidence.focusBlocks.length > 0);
	assert.equal(evidence.fixture.violations.length, 0);
});

test('the shipped repository binds every overlay to a compensation', () => {
	const evidence = collectEvidence();

	for (const overlay of evidence.overlays) {
		if (overlay.modal) continue;
		const bound = evidence.bindings.some(
			(binding) => binding.offsetPublishedIn === overlay.file && binding.compensation !== null,
		);
		assert.ok(bound, `${overlay.file} must publish the offset it occupies`);
	}
});

test('the report separates machine-checked facts from human evaluation', () => {
	const report = renderGateSummary(collectEvidence());

	assert.match(report, /machine-checked:/);
	assert.match(report, /not machine-checked \(human evaluation\):/);
	assert.ok(report.indexOf('machine-checked:') < report.indexOf('not machine-checked'));
	assert.match(report, /SC 2\.4\.7/);
	assert.match(report, /SC 2\.4\.11/);
	for (const item of HUMAN_EVALUATION) assert.ok(report.includes(item));
});

test('the report states what was left out of scope, and why', () => {
	const report = renderGateSummary(collectEvidence());

	assert.match(report, /out of scope \(excluded from the scan, with the reason\):/);
	for (const exclusion of EXCLUSIONS) {
		assert.ok(report.includes(exclusion.describe));
		assert.ok(report.includes(exclusion.reason));
	}
	for (const note of SCOPE_NOTES) {
		assert.ok(report.includes(note.describe));
		assert.ok(report.includes(note.reason));
	}
});
