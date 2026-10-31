/**
 * The Issue #406 gate's own unit tests.
 *
 * The gate is the static half of the Issue ("モーダル / メニューの焦点管理と
 * 復帰を、静的検査と Chromium 実測の 2 段で判定する"), so the rules have to
 * be testable without a browser: a rule that can only fail inside a real
 * page is a rule nobody re-runs when it breaks.
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
	EXCLUSIONS,
	FIXTURE_EXPECTATIONS,
	FIXTURE_ROOT,
	HUMAN_EVALUATION,
	RULES,
	auditFixtureFiles,
	claimsCustomModal,
	closesPanelOnEscape,
	collectEvidence,
	declaresFocusHandBack,
	escapeCloseLabel,
	evaluateModalClose,
	exclusionFor,
	findOpeningTags,
	hasClosePath,
	hasExplicitCloseCall,
	hasFocusReturnContract,
	hasNonModalShowCall,
	hasOpenAttribute,
	hasShowModalCall,
	renderGateSummary,
	rendersDisclosureMenu,
	scanSource,
	suppressesCancelDefault,
	suppressesEscapeKeyClose,
} from './check-a11y-dialog-focus.mjs';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

/** Scan a source snippet the way the gate scans a file. */
function scan(source) {
	return scanSource({ relativePath: 'src/home/example.tsx', source });
}

test('an <dialog> opened with the open attribute is a violation', () => {
	const { violations } = scan('export const A = () => <dialog open={open}>x</dialog>;\n');

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'dialog-non-modal-open');
	assert.equal(violations[0].wcag, '2.1.2');
	assert.equal(violations[0].line, 1);
});

test('a bare open attribute is a violation too', () => {
	const { violations } = scan('export const A = () => <dialog open>x</dialog>;\n');

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'dialog-non-modal-open');
});

test('a <dialog> opened with show() instead of showModal() is a violation', () => {
	const { violations } = scan(
		[
			'export const A = () => <dialog ref={open}>x</dialog>;',
			'const open = (d) => d?.show();',
		].join('\n'),
	);

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'dialog-non-modal-open');
});

test('hasNonModalShowCall matches show() but not showModal()', () => {
	assert.equal(hasNonModalShowCall('dialog.show();'), true);
	assert.equal(hasNonModalShowCall('dialog.showModal();'), false);
});

test('an <dialog> opened with showModal() and a close path is not a violation', () => {
	const { violations } = scan(
		[
			'export const A = () => <dialog ref={open}>x</dialog>;',
			'const open = (d) => d?.showModal();',
			'const close = (d) => d?.close();',
		].join('\n'),
	);

	assert.deepEqual(violations, []);
});

test('a plain native modal is NOT a keyboard trap', () => {
	// The user agent closes a modal `<dialog>` on `Escape`: the DEFAULT
	// ACTION of the `cancel` event IS the close. A file that opens a
	// modal and says nothing about closing it therefore has a close
	// path, and the gate must not report a trap.
	const { violations } = scan(
		[
			'export const A = () => <dialog ref={open}>x</dialog>;',
			'const open = (d) => d?.showModal();',
		].join('\n'),
	);

	assert.deepEqual(violations, []);
});

test('a modal whose native Escape close is suppressed and nothing replaces it IS a keyboard trap', () => {
	// The `cancel` handler takes the user agent's default away
	// (`preventDefault()`), and the file never closes the dialog itself.
	// `Escape` therefore does not close it — a keyboard trap.
	const { violations } = scan(
		[
			'export const A = () => <dialog ref={open} onCancel={handleCancel}>x</dialog>;',
			'const open = (d) => d?.showModal();',
			'const handleCancel = (event) => { event.preventDefault(); };',
		].join('\n'),
	);

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'dialog-escape-close-missing');
	assert.equal(violations[0].wcag, '2.1.2');
});

test('a modal that suppresses the native Escape close but closes the dialog itself is NOT a keyboard trap', () => {
	// The default is suppressed, but the file closes the dialog in the
	// same handler: the modal still has a way out.
	const { violations } = scan(
		[
			'export const A = () => <dialog ref={open} onCancel={handleCancel}>x</dialog>;',
			'const open = (d) => d?.showModal();',
			'const handleCancel = (event) => { event.preventDefault(); d?.close(); };',
		].join('\n'),
	);

	assert.deepEqual(violations, []);
});

test('a modal whose Escape key press is swallowed and nothing replaces it IS a keyboard trap', () => {
	// Preventing the default of the `Escape` key press stops the user
	// agent from making the close request at all, so the `cancel` event
	// is never dispatched.
	const { violations } = scan(
		[
			'export const A = () => <dialog ref={open} onKeyDown={handleKeyDown}>x</dialog>;',
			'const open = (d) => d?.showModal();',
			'const handleKeyDown = (event) => {',
			"\tif (event.key !== 'Escape') return;",
			'\tevent.preventDefault();',
			'};',
		].join('\n'),
	);

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'dialog-escape-close-missing');
});

test('the native Escape default IS a close path until the file suppresses it', () => {
	// Nothing in the file has to say "Escape closes this dialog" — the
	// user agent does it.
	assert.equal(hasClosePath('const open = (d) => d?.showModal();'), true);
	assert.equal(hasClosePath('<dialog onCancel={close}>'), true);
	assert.equal(hasClosePath('addEventListener("cancel", close)'), true);
	assert.equal(hasClosePath('<dialog onClose={close}>'), true);
	assert.equal(hasClosePath("if (event.key !== 'Escape') return;"), true);
	// The file closes the dialog itself: that is a close path too, and
	// it survives a suppressed default.
	assert.equal(hasClosePath('dialog.close();'), true);
	assert.equal(hasClosePath('dialogRef.current?.close();'), true);
	// The default is suppressed and nothing replaces it: no way out.
	assert.equal(hasClosePath('onCancel={(event) => { event.preventDefault(); }}'), false);
	assert.equal(
		hasClosePath('onCancel={(event) => { event.preventDefault(); dialog.close(); }}'),
		true,
	);
});

test('the gate reads whether the native cancel default is suppressed', () => {
	// The default is taken away at the `cancel` event …
	assert.equal(suppressesCancelDefault('onCancel={(event) => { event.preventDefault(); }}'), true);
	assert.equal(
		suppressesCancelDefault(
			'const handleCancel = (event) => { event.preventDefault(); }; onCancel={handleCancel}',
		),
		true,
	);
	assert.equal(
		suppressesCancelDefault(
			'dialog.addEventListener("cancel", (event) => { event.preventDefault(); });',
		),
		true,
	);
	// … or not.
	assert.equal(suppressesCancelDefault('onCancel={handleCancel}'), false);
	assert.equal(suppressesCancelDefault('const open = (d) => d?.showModal();'), false);
	// The key level: only an `Escape` handler swallows the `Escape`.
	assert.equal(
		suppressesEscapeKeyClose(
			'onKeyDown={(event) => { if (event.key === "Escape") event.preventDefault(); }}',
		),
		true,
	);
	assert.equal(
		suppressesEscapeKeyClose('onKeyDown={(event) => { event.preventDefault(); }}'),
		false,
	);
	assert.equal(suppressesEscapeKeyClose('const open = (d) => d?.showModal();'), false);
});

test('the modal close is evaluated as native, explicit or none', () => {
	const native = evaluateModalClose('const open = (d) => d?.showModal();');
	assert.equal(native.state, 'native');
	assert.equal(native.trap, false);
	assert.equal(native.explicit, false);

	const explicit = evaluateModalClose(
		'const open = (d) => d?.showModal(); const close = (d) => d?.close();',
	);
	assert.equal(explicit.state, 'explicit');
	assert.equal(explicit.trap, false);
	assert.equal(explicit.explicit, true);

	const none = evaluateModalClose(
		'const handleCancel = (event) => { event.preventDefault(); }; onCancel={handleCancel}',
	);
	assert.equal(none.state, 'none');
	assert.equal(none.trap, true);
	assert.equal(hasExplicitCloseCall('const close = (d) => d?.close();'), true);
	assert.equal(hasExplicitCloseCall('const open = (d) => d?.showModal();'), false);
});

test('an inert <dialog> that is never opened is not a modal', () => {
	const { violations, dialogs } = scan('export const A = () => <dialog>x</dialog>;\n');

	assert.deepEqual(violations, []);
	assert.equal(dialogs.length, 1);
	assert.equal(dialogs[0].modal, false);
});

test('a custom role="dialog" without a focus-return contract is a violation', () => {
	const { violations } = scan(
		'export const A = () => <div role="dialog" aria-modal="true">x</div>;\n',
	);

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'custom-dialog-focus-return-missing');
	assert.equal(violations[0].wcag, '2.4.3');
});

test('a custom role="dialog" with a focus-return contract is not a violation', () => {
	const { violations } = scan(
		[
			'export const A = () => <div role="dialog">x</div>;',
			'let invoker = document.activeElement;',
			'const close = () => invoker?.focus();',
		].join('\n'),
	);

	assert.deepEqual(violations, []);
});

test('aria-modal on a native <dialog> file is not read as a custom modal', () => {
	// A native modal already carries the semantics; the file has a <dialog>.
	assert.equal(claimsCustomModal('const A = () => <dialog aria-modal="true" />;'), false);
	assert.equal(claimsCustomModal('const A = () => <div aria-modal="true" />;'), true);
	assert.equal(claimsCustomModal('const A = () => <div role="dialog" />;'), true);
});

test('a <dialog> named in a comment is documentation, not a dialog', () => {
	const { violations, dialogs } = scan(
		'/** a <dialog open> would be wrong here */\nexport const a = 1;\n',
	);

	assert.deepEqual(violations, []);
	assert.deepEqual(dialogs, []);
});

test('findOpeningTags reads the whole tag, not the first >', () => {
	const source = '<dialog title="a > b" open>x</dialog>';
	const [tag] = findOpeningTags(source, 'dialog');

	assert.equal(tag.body, ' title="a > b" open');
	assert.equal(hasOpenAttribute(tag.body), true);
});

test('hasShowModalCall does not match a mention in prose', () => {
	assert.equal(hasShowModalCall('dialog.showModal();'), true);
	assert.equal(hasShowModalCall('// call showModal() to open it'), true);
	assert.equal(hasShowModalCall('dialog.show();'), false);
});

test('every rule the Issue names is a rule the gate knows', () => {
	for (const rule of [
		'dialog-non-modal-open',
		'dialog-escape-close-missing',
		'custom-dialog-focus-return-missing',
		'menu-focus-return-missing',
	]) {
		assert.ok(RULES.includes(rule), `${rule} must be a known rule`);
	}
});

test('a disclosure menu closed by Escape with no focus hand-back is a violation', () => {
	const { violations } = scan(
		[
			'const onKeyDown = (event) => {',
			"\tif (event.key === 'Escape') {",
			'\t\tsetMenuOpen(false);',
			'\t}',
			'};',
			'export const A = () => (',
			'\t<button type="button" aria-expanded={menuOpen} aria-controls="menu">Menu</button>',
			'\t<div id="menu" hidden={!menuOpen}>x</div>',
			');',
		].join('\n'),
	);

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'menu-focus-return-missing');
	assert.equal(violations[0].wcag, '2.4.3');
});

test('a disclosure menu that hands the focus back is not a violation', () => {
	const { violations } = scan(
		[
			'const onKeyDown = (event) => {',
			"\tif (event.key === 'Escape') {",
			'\t\tsetMenuOpen(false);',
			'\t\ttriggerRef.current?.focus();',
			'\t}',
			'};',
			'export const A = () => (',
			'\t<button type="button" aria-expanded={menuOpen} aria-controls="menu">Menu</button>',
			'\t<div id="menu" hidden={!menuOpen}>x</div>',
			');',
		].join('\n'),
	);

	assert.deepEqual(violations, []);
});

test('a panel that is not a disclosure menu is not read as one', () => {
	// A `hidden` element without an `aria-expanded` trigger is not a menu
	// the rule knows about, and an Escape handler that does not close a
	// panel does not need a focus hand-back.
	assert.equal(rendersDisclosureMenu('<div hidden>x</div>'), false);
	assert.equal(rendersDisclosureMenu('<button aria-expanded={open}>x</button>'), false);
	assert.equal(
		rendersDisclosureMenu('<button aria-expanded={open}>x</button><div hidden={!open}>x</div>'),
		true,
	);
	assert.equal(closesPanelOnEscape("if (event.key === 'Escape') setQuery('');"), false);
	assert.equal(closesPanelOnEscape("if (event.key === 'Escape') setMenuOpen(false);"), true);
	assert.equal(declaresFocusHandBack('triggerRef.current?.focus();'), true);
	assert.equal(declaresFocusHandBack('setMenuOpen(false);'), false);
});

test('an unrelated focus call is not read as a focus hand-back', () => {
	// The file focuses something else — not the trigger — before the panel
	// is closed. That focus is taken away again when the panel is hidden,
	// so it is not a hand-back.
	const unrelated = [
		'const first = () => {',
		'\tsomeInput.current?.focus();',
		'};',
		'const onKeyDown = (event) => {',
		"\tif (event.key === 'Escape') {",
		'\t\tsetMenuOpen(false);',
		'\t}',
		'};',
		'export const A = () => (',
		'\t<button ref={triggerRef} type="button" aria-expanded={menuOpen}>Menu</button>',
		'\t<div id="menu" hidden={!menuOpen}>x</div>',
		');',
	].join('\n');

	assert.equal(declaresFocusHandBack(unrelated), false);

	// The same file focusing the TRIGGER is a hand-back.
	const ordered = [
		'const onKeyDown = (event) => {',
		"\tif (event.key === 'Escape') {",
		'\t\tsetMenuOpen(false);',
		'\t\ttriggerRef.current?.focus();',
		'\t}',
		'};',
		'export const A = () => (',
		'\t<button ref={triggerRef} type="button" aria-expanded={menuOpen}>Menu</button>',
		'\t<div id="menu" hidden={!menuOpen}>x</div>',
		');',
	].join('\n');

	assert.equal(declaresFocusHandBack(ordered), true);
});

test('the shipped repository ships one disclosure menu with a focus hand-back', () => {
	const evidence = collectEvidence();

	assert.equal(evidence.menus.length, 1, 'the shipped nav menu must be enumerated');
	const [menu] = evidence.menus;
	assert.equal(menu.file, 'src/editorial/nav/PublicNav.tsx');
	assert.equal(menu.closesOnEscape, true);
	assert.equal(menu.handBack, true);
});

test('the report enumerates the shipped modal and menu surfaces', () => {
	const report = renderGateSummary(collectEvidence());

	assert.match(report, /native <dialog> inventory:/);
	assert.match(report, /src\/home\/reactions\/widget\.tsx/);
	assert.match(report, /modal \(showModal\)/);
	assert.match(report, /disclosure menu inventory:/);
	assert.match(report, /src\/editorial\/nav\/PublicNav\.tsx/);
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
		const { violations } = scanSource({
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
		const { violations } = scanSource({
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

test('a pass fixture that exercises nothing is reported instead of passing silently', () => {
	const violations = auditFixtureFiles([
		{
			directory: 'pass',
			relativePath: 'pass/empty.tsx',
			expectedRules: [],
			foundRules: [],
			dialogCount: 0,
			menuCount: 0,
			customModal: false,
		},
	]).violations;

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'fixture-pass-no-case');
});

test('a fail fixture that stopped reproducing its defect is reported', () => {
	const violations = auditFixtureFiles([
		{
			directory: 'fail',
			relativePath: 'fail/stopped.tsx',
			expectedRules: ['dialog-non-modal-open'],
			foundRules: [],
			dialogCount: 1,
			menuCount: 0,
			customModal: false,
		},
	]).violations;

	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'fixture-fail-not-detected');
});

test('the shipped repository passes the gate', () => {
	const evidence = collectEvidence();

	assert.deepEqual(evidence.violations, []);
	assert.ok(evidence.filesScanned > 100);
	assert.equal(evidence.fixture.violations.length, 0);
});

test('the shipped repository ships one modal <dialog> with a close path', () => {
	const evidence = collectEvidence();
	const modals = evidence.dialogs.filter((dialog) => dialog.modal);

	assert.ok(modals.length >= 1, 'the shipped picker dialog must be enumerated');
	for (const dialog of modals) {
		assert.equal(dialog.closePath, true, `${dialog.file} must declare a close path`);
	}
});

test('every exclusion carries a reason', () => {
	for (const exclusion of EXCLUSIONS) {
		assert.ok(exclusion.id.length > 0);
		assert.ok(exclusion.describe.length > 0);
		assert.ok(exclusion.reason.length > 20, `${exclusion.id} must explain itself`);
	}
});

test('the exclusion list is used, not dead code', () => {
	assert.equal(exclusionFor('src/home/a.test.tsx')?.id, 'test-files');
	assert.equal(exclusionFor('src/home/a.stories.tsx')?.id, 'story-files');
	assert.equal(exclusionFor('src/home/fixtures/a.tsx')?.id, 'fixture-directories');
	assert.equal(exclusionFor('src/routes/design-system/index.tsx')?.id, 'design-system-route');
	assert.equal(exclusionFor('src/home/a.tsx'), null);
});

test('the report separates machine-checked facts from human evaluation', () => {
	const report = renderGateSummary(collectEvidence());

	assert.match(report, /machine-checked:/);
	assert.match(report, /not machine-checked \(human evaluation\):/);
	assert.ok(report.indexOf('machine-checked:') < report.indexOf('not machine-checked'));
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
