#!/usr/bin/env node

/**
 * check-a11y-dialog-focus — enforce the modal / menu focus contract on the
 * shipped surface (Issue #406).
 *
 * What this gate is for
 * ---------------------
 * WCAG 2.2 SC 2.4.3 Focus Order (A) and SC 2.1.2 No Keyboard Trap (A) meet
 * on the same question: when a modal opens, does the keyboard user stay
 * inside it, can they leave it, and do they come back to where they were?
 *
 * The repository opens its picker in a NATIVE `<dialog>`. A native dialog
 * has that whole contract for free — focus trap, `Escape` closing and
 * focus return to the invoker — but ONLY when it is opened with
 * `showModal()`. The `open` attribute (and `dialog.show()`) opens the SAME
 * element NON-modally, with no trap and no focus return. The two are one
 * attribute apart in the source and indistinguishable in a screenshot of
 * the open dialog, so the difference has to be read from the source.
 *
 * The rules
 * ---------
 *   dialog-non-modal-open
 *       A native `<dialog>` is opened with the DOM `open` attribute. The
 *       user agent then does not trap the focus, does not close on
 *       `Escape` and does not return the focus to the invoker — the
 *       modal contract is absent (SC 2.1.2, SC 2.4.3).
 *   dialog-close-path-missing
 *       A native `<dialog>` is opened with `showModal()` but the file
 *       declares no close path (`close()`, `onClose`, `onCancel`, a
 *       `cancel`/`close` listener or an `Escape` handler). A modal with
 *       no way out is a keyboard trap (SC 2.1.2).
 *   custom-dialog-focus-return-missing
 *       A CUSTOM modal (`role="dialog"`, or `aria-modal="true"` on a
 *       non-`<dialog>` element) declares no focus-return contract (a
 *       `document.activeElement` save plus a `.focus()` restore). The
 *       user agent does not do it for a custom element, so the file has
 *       to (SC 2.4.3).
 *   menu-focus-return-missing
 *       A disclosure MENU (a panel that is `hidden` while it is closed,
 *       opened by an `aria-expanded` trigger) is closed by `Escape` and
 *       the file declares no focus hand-back. Hiding the panel removes
 *       the focused element from the accessibility tree, and the browser
 *       drops the focus to the document body — the keyboard user loses
 *       their place and has to rediscover the trigger (SC 2.4.3). This
 *       is the shape of the defect Issue #394 found and fixed in
 *       `src/editorial/nav/PublicNav.tsx`.
 *
 * What the gate does NOT decide
 * -----------------------------
 * Whether the focus ring is visible (that is the colour contract, Issue
 * #399), whether the dialog's Tab order matches the reading order, and
 * whether a real screen reader announces the dialog and its label. Those
 * stay human evaluation and are printed separately, never merged into one
 * green mark.
 *
 * Exit codes: 0 = every rule passes, 1 = at least one violation,
 * 2 = the repository could not be scanned.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	REPO_ROOT,
	collectSourceFiles,
	lineAt,
	stripComments,
	toRepoPath,
} from './_source-scan.mjs';

/** The Issue this gate enforces. */
export const ISSUE = '#406';

/** The criteria every rule in this gate answers to. */
export const WCAG = [
	{ sc: '2.1.2', name: 'No Keyboard Trap', level: 'A' },
	{ sc: '2.4.3', name: 'Focus Order', level: 'A' },
	{ sc: '2.4.7', name: 'Focus Visible', level: 'AA' },
];

/** The rule names, in report order. */
export const RULES = [
	'dialog-non-modal-open',
	'dialog-close-path-missing',
	'custom-dialog-focus-return-missing',
	'menu-focus-return-missing',
];

/** The scan target: the shipped JSX / TS surface. */
export const SCAN_ROOT = 'src';

/**
 * What is deliberately OUT of scope, and why.
 *
 * The exclusions are printed with the report: a surface nobody scans is a
 * hole in the contract, so a reader has to be able to see where the holes
 * are and what justifies them.
 */
export const EXCLUSIONS = [
	{
		id: 'test-files',
		describe: '*.test.ts / *.test.tsx',
		reason:
			'a test file asserts on markup; the defect this Issue removes is in the shipped product code, not in its assertions',
	},
	{
		id: 'story-files',
		describe: '*.stories.tsx',
		reason:
			'a Storybook story is a preview harness for a component, not a surface a visitor reaches; the component it renders is scanned on its own',
	},
	{
		id: 'fixture-directories',
		describe: '**/fixtures/**',
		reason:
			'a fixture exists to hold a shape, including a shape this gate rejects; the shipped copy of the same data is scanned',
	},
	{
		id: 'design-system-route',
		describe: 'src/routes/design-system/**',
		reason:
			'the design-system route is the repository-internal component gallery, not a published surface; it MOUNTS the shipped picker (Issue #394) but the component itself is scanned where it lives',
	},
];

/** Whether an exclusion applies to a repo-relative path (pure). */
export function exclusionFor(relativePath) {
	if (/\.test\.tsx?$/.test(relativePath)) return EXCLUSIONS[0];
	if (/\.stories\.tsx$/.test(relativePath)) return EXCLUSIONS[1];
	if (relativePath.includes('/fixtures/')) return EXCLUSIONS[2];
	if (relativePath.startsWith('src/routes/design-system/')) return EXCLUSIONS[3];
	return null;
}

/**
 * The fixture the gate actually reads.
 *
 * The fixture is not a decoration: `pass/` must produce zero violations and
 * `fail/` must produce exactly the named rule, or the gate reports the
 * fixture as broken. A fixture that quietly stopped reproducing the defect
 * would otherwise leave a green gate proving nothing.
 */
export const FIXTURE_ROOT = 'scripts/fixtures/a11y-dialog-focus';

/**
 * The exact fixture roster, per directory.
 *
 * `pass` — files that must produce NO violation.
 * `fail` — files that must produce exactly the named rule.
 */
export const FIXTURE_EXPECTATIONS = {
	pass: {
		'native-modal-contract.tsx': [],
		'custom-modal-with-focus-return.tsx': [],
		'menu-with-focus-return.tsx': [],
	},
	fail: {
		'dialog-open-attribute.tsx': ['dialog-non-modal-open'],
		'dialog-non-modal-show.tsx': ['dialog-non-modal-open'],
		'dialog-no-close-path.tsx': ['dialog-close-path-missing'],
		'custom-modal-no-focus-return.tsx': ['custom-dialog-focus-return-missing'],
		'menu-no-focus-return.tsx': ['menu-focus-return-missing'],
	},
};

/**
 * Things this gate deliberately does not decide. Printed with the report so
 * a green run is never mistaken for "accessible".
 */
export const HUMAN_EVALUATION = [
	'whether the focus ring on the returned element is visible against its background (the colour contract is Issue #399)',
	'whether the Tab order inside the dialog follows the reading order',
	'whether a real screen reader announces the dialog, its label and its role',
	'whether the background is inert to assistive technology for the whole time the modal is open',
];

/** The index of the `>` that closes a tag opened before `start` (pure). */
export function findTagEnd(source, start) {
	let depth = 0;
	let quote = null;
	for (let index = start; index < source.length; index += 1) {
		const char = source[index];
		if (quote) {
			if (char === '\\') {
				index += 1;
				continue;
			}
			if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'" || char === '`') {
			quote = char;
			continue;
		}
		if (char === '{') {
			depth += 1;
			continue;
		}
		if (char === '}') {
			depth -= 1;
			continue;
		}
		if (char === '>' && depth === 0) return index;
	}
	return -1;
}

/** Every opening tag of `tagName`, with its attribute text (pure). */
export function findOpeningTags(source, tagName) {
	const tags = [];
	const pattern = new RegExp(`<${tagName}\\b`, 'g');
	let match = pattern.exec(source);
	while (match !== null) {
		const bodyStart = match.index + 1 + tagName.length;
		const end = findTagEnd(source, bodyStart);
		const body = end === -1 ? source.slice(bodyStart) : source.slice(bodyStart, end);
		tags.push({ index: match.index, line: lineAt(source, match.index), body });
		pattern.lastIndex = end === -1 ? source.length : end + 1;
		match = pattern.exec(source);
	}
	return tags;
}

/**
 * Whether a JSX tag carries the DOM `open` attribute (pure).
 *
 * A `<dialog open>` is opened NON-modally: the user agent does not trap the
 * focus, does not close on `Escape` and does not return the focus to the
 * invoker.
 */
export function hasOpenAttribute(tagBody) {
	return /(?:^|\s)open(?:\s|=|\/|$)/.test(tagBody);
}

/** Whether the source opens a dialog modally (pure). */
export function hasShowModalCall(code) {
	return /\bshowModal\s*\(/.test(code);
}

/**
 * Whether the source opens a dialog NON-modally with `dialog.show()`
 * (pure).
 *
 * `showModal(` also contains `show`, so the pattern anchors on the method
 * call `.show(` — which does not match `.showModal(`.
 */
export function hasNonModalShowCall(code) {
	return /\.show\s*\(/.test(code);
}

/**
 * Whether the source declares a way to close the dialog (pure).
 *
 * The close path is what makes the modal escapable: a native `close()`
 * call, a React `onClose` / `onCancel` handler, a `cancel` / `close`
 * listener, or an `Escape` key handler. Without any of them a modal traps
 * the keyboard.
 */
export function hasClosePath(code) {
	if (/\.close\s*\(/.test(code)) return true;
	if (/\bonClose\s*=/.test(code)) return true;
	if (/\bonCancel\s*=/.test(code)) return true;
	if (/addEventListener\(\s*['"](?:close|cancel)['"]/.test(code)) return true;
	if (/['"]Escape['"]/.test(code)) return true;
	return false;
}

/**
 * Whether a custom modal declares the focus-return contract (pure).
 *
 * The user agent does not return the focus for a custom element, so the
 * file has to save `document.activeElement` before opening and call
 * `.focus()` on it after closing.
 */
export function hasFocusReturnContract(code) {
	return /document\.activeElement/.test(code) && /\.focus\s*\(/.test(code);
}

/**
 * Whether the file renders a disclosure MENU (pure).
 *
 * A disclosure menu is a panel that is `hidden` while it is closed plus a
 * trigger that says whether it is open (`aria-expanded`). The panel holds
 * links, so it can hold the focus; hiding it can therefore drop the focus
 * to the document body.
 */
export function rendersDisclosureMenu(code) {
	return /aria-expanded\s*=/.test(code) && /<[a-z][^>]*\bhidden\s*=/.test(code);
}

/**
 * Whether the file closes that panel from a keyboard gesture (pure).
 *
 * The gesture is an `Escape` handler that turns the panel's open state
 * off (`setMenuOpen(false)` and friends). A file that closes a panel on
 * a click keeps the focus where it is — the click target is the element
 * that had the focus — so the hand-back is only needed for the keyboard
 * gesture, and only that gesture is read here.
 */
export function closesPanelOnEscape(code) {
	if (!/['"`]Escape['"`]/.test(code)) return false;
	return /set[A-Za-z0-9_]*(?:Open|Visible|Expanded|Shown)\s*\(\s*false\s*\)/.test(code);
}

/**
 * Whether the file declares a focus hand-back (pure).
 *
 * Any `.focus()` call counts: the contract is that the file can put the
 * focus somewhere after the panel is hidden, and WHICH element it picks
 * is the file's own decision.
 */
export function declaresFocusHandBack(code) {
	return /\.focus\s*\(/.test(code);
}

/**
 * The line the hidden panel is rendered on (pure).
 *
 * The report points at the panel, because the panel is what holds the
 * focus when it is hidden.
 */
export function hiddenPanelLine(code) {
	const match = /<[a-z][^>]*\bhidden\s*=/.exec(code);
	return match ? lineAt(code, match.index) : 1;
}

/**
 * Whether the source claims a custom (non-native) modal (pure).
 *
 * `role="dialog"` is the explicit claim. `aria-modal="true"` is the same
 * claim spelled differently, but only when the file has no native
 * `<dialog>` element (a native modal already carries the semantics).
 */
export function claimsCustomModal(code) {
	if (/role\s*=\s*["']dialog["']/.test(code)) return true;
	return /aria-modal\s*=\s*["']true["']/.test(code) && !/<dialog\b/.test(code);
}

/**
 * The violations of one source file (pure).
 *
 * `dialogs` is the inventory of the native `<dialog>` elements the file
 * ships, so the report can show what was enumerated even on a green run.
 */
export function scanSource({ relativePath, source }) {
	const code = stripComments(source);
	const violations = [];
	const dialogs = [];
	const menus = [];
	const showModal = hasShowModalCall(code);
	const nonModalShow = hasNonModalShowCall(code);
	const closePath = hasClosePath(code);

	for (const tag of findOpeningTags(code, 'dialog')) {
		// Non-modal open: the DOM `open` attribute, or a `dialog.show()`
		// call when the file never calls `showModal()`.
		const nonModal = hasOpenAttribute(tag.body) || (nonModalShow && !showModal);
		dialogs.push({
			file: relativePath,
			line: tag.line,
			nonModal,
			modal: !nonModal && showModal,
			closePath,
		});
		if (nonModal) {
			violations.push({
				rule: 'dialog-non-modal-open',
				file: relativePath,
				line: tag.line,
				wcag: '2.1.2',
				message:
					'this `<dialog>` is opened non-modally (the `open` attribute, or `show()` instead of `showModal()`), so the user agent gives it no focus trap, no `Escape` closing and no focus return; open it with `showModal()` (SC 2.1.2 / SC 2.4.3)',
			});
			continue;
		}
		if (showModal && !closePath) {
			violations.push({
				rule: 'dialog-close-path-missing',
				file: relativePath,
				line: tag.line,
				wcag: '2.1.2',
				message:
					'this `<dialog>` is opened with `showModal()` but the file declares no close path (`close()`, `onClose`, `onCancel`, a `cancel`/`close` listener or an `Escape` handler); a modal with no way out is a keyboard trap (SC 2.1.2)',
			});
		}
	}

	// The MENU surface: a disclosure panel that is hidden while it is
	// closed. It is not a modal — the page behind it stays live — but it
	// holds the focus while it is open, so closing it from the keyboard
	// has to hand the focus back.
	if (rendersDisclosureMenu(code)) {
		const closesOnEscape = closesPanelOnEscape(code);
		const handBack = declaresFocusHandBack(code);
		menus.push({ file: relativePath, line: hiddenPanelLine(code), closesOnEscape, handBack });
		if (closesOnEscape && !handBack) {
			violations.push({
				rule: 'menu-focus-return-missing',
				file: relativePath,
				line: hiddenPanelLine(code),
				wcag: '2.4.3',
				message:
					'this file closes a disclosure menu with `Escape` but declares no focus hand-back; hiding the panel removes the focused element from the accessibility tree and the browser drops the focus to the document body, so the keyboard user loses their place (SC 2.4.3 / SC 2.1.2). Restore the focus after the panel is hidden',
			});
		}
	}

	if (claimsCustomModal(code) && !hasFocusReturnContract(code)) {
		violations.push({
			rule: 'custom-dialog-focus-return-missing',
			file: relativePath,
			line: 1,
			wcag: '2.4.3',
			message:
				'a custom modal (`role="dialog"` / `aria-modal`) declares no focus-return contract; the user agent does not restore the focus for a custom element, so the file has to save `document.activeElement` and call `.focus()` on it (SC 2.4.3)',
		});
	}

	return { violations, dialogs, menus, customModal: claimsCustomModal(code) };
}

/**
 * Audit the fixture FILES against the roster (pure).
 *
 * Kept pure and separate from the filesystem walk so the rules are
 * testable without a checkout — in particular the rule that a PASS fixture
 * must actually EXERCISE a rule: a pass fixture that was emptied proves
 * nothing, and a gate that still reports it as a pass is green for the
 * wrong reason.
 */
export function auditFixtureFiles(entries) {
	const violations = [];
	const rows = [];
	for (const entry of entries) {
		const {
			directory,
			relativePath,
			expectedRules,
			foundRules,
			dialogCount,
			menuCount,
			customModal,
		} = entry;
		const found = foundRules.map((rule) => rule.rule);
		if (directory === 'pass') {
			if (dialogCount === 0 && menuCount === 0 && !customModal && found.length === 0) {
				violations.push({
					rule: 'fixture-pass-no-case',
					file: relativePath,
					line: null,
					wcag: null,
					message:
						'the pass fixture holds no dialog, no menu and no custom modal, so it exercises no rule; an empty pass fixture proves nothing and must not keep the gate green',
				});
			}
			if (found.length > 0) {
				violations.push({
					rule: 'fixture-pass-violation',
					file: relativePath,
					line: foundRules[0].line ?? null,
					wcag: foundRules[0].wcag ?? null,
					message: `a pass fixture reports ${found.join(', ')}; the pass state is no longer reproduced`,
				});
			}
			rows.push({ file: relativePath, expected: [], found, dialogCount, menuCount });
			continue;
		}
		const missing = expectedRules.filter((rule) => !found.includes(rule));
		const unexpected = found.filter((rule) => !expectedRules.includes(rule));
		if (missing.length > 0) {
			violations.push({
				rule: 'fixture-fail-not-detected',
				file: relativePath,
				line: null,
				wcag: null,
				message: `the fail fixture no longer reports ${missing.join(', ')}; the defect it reproduces is not detected any more`,
			});
		}
		if (unexpected.length > 0) {
			violations.push({
				rule: 'fixture-fail-unexpected',
				file: relativePath,
				line: null,
				wcag: null,
				message: `the fail fixture reports ${unexpected.join(', ')}, which it does not stand for`,
			});
		}
		rows.push({
			file: relativePath,
			expected: [...expectedRules],
			found,
			dialogCount,
			menuCount,
		});
	}
	return { violations, rows };
}

/**
 * Audit the fixture (pure over the filesystem).
 *
 * Every fixture file is scanned ALONE: a fixture that carries its own
 * close path is closable, and one that does not is not — the
 * repository-wide contract must not leak into a fixture and make it pass
 * for the wrong reason.
 */
export function auditFixture(repoRoot = REPO_ROOT) {
	const violations = [];
	const entries = [];
	for (const [directory, expectations] of Object.entries(FIXTURE_EXPECTATIONS)) {
		const absolute = join(repoRoot, FIXTURE_ROOT, directory);
		const present = existsSync(absolute)
			? readdirSync(absolute).filter((name) => name.endsWith('.tsx'))
			: [];
		for (const [name, expectedRules] of Object.entries(expectations)) {
			const relativePath = `${FIXTURE_ROOT}/${directory}/${name}`;
			if (!present.includes(name)) {
				violations.push({
					rule: 'fixture-file-missing',
					file: relativePath,
					line: null,
					wcag: null,
					message:
						'the fixture file is missing; a fixture that is not there proves nothing about the rule it stands for',
				});
				continue;
			}
			const source = readFileSync(join(absolute, name), 'utf8');
			const { violations: found, dialogs, customModal } = scanSource({ relativePath, source });
			entries.push({
				directory,
				name,
				relativePath,
				expectedRules,
				foundRules: found,
				dialogCount: dialogs.length,
				customModal,
			});
		}
		const extra = present.filter((name) => !(name in expectations));
		for (const name of extra) {
			violations.push({
				rule: 'fixture-file-unexpected',
				file: `${FIXTURE_ROOT}/${directory}/${name}`,
				line: null,
				wcag: null,
				message:
					'the fixture directory holds a file the gate does not expect; either the roster or the file is stale',
			});
		}
	}
	const audited = auditFixtureFiles(entries);
	return { violations: [...violations, ...audited.violations], rows: audited.rows };
}

/**
 * Scan the repository (pure over `repoRoot`).
 */
export function collectEvidence(repoRoot = REPO_ROOT) {
	const violations = [];
	const excluded = [];
	const dialogs = [];
	const menus = [];
	let filesScanned = 0;
	const scanRoot = join(repoRoot, SCAN_ROOT);
	if (!existsSync(scanRoot)) {
		throw new Error(`cannot scan the repository: ${SCAN_ROOT} is not a directory`);
	}
	for (const file of collectSourceFiles(scanRoot)) {
		const relativePath = toRepoPath(file, repoRoot);
		const exclusion = exclusionFor(relativePath);
		if (exclusion) {
			excluded.push({ file: relativePath, reason: exclusion.id });
			continue;
		}
		filesScanned += 1;
		const result = scanSource({ relativePath, source: readFileSync(file, 'utf8') });
		violations.push(...result.violations);
		dialogs.push(...result.dialogs);
		menus.push(...result.menus);
	}

	const fixture = auditFixture(repoRoot);
	violations.push(...fixture.violations);
	return {
		filesScanned,
		dialogs,
		menus,
		violations,
		excluded,
		fixture,
		humanEvaluation: HUMAN_EVALUATION,
		wcag: WCAG,
	};
}

/** The human-readable report, with the two kinds of statement separated. */
export function renderGateSummary(evidence) {
	const lines = [];
	lines.push(`modal / menu focus gate — Issue ${ISSUE}`);
	lines.push(
		`scanned ${evidence.filesScanned} shipped source file(s) under ${SCAN_ROOT}/; ${evidence.dialogs.length} native <dialog> element(s); ${evidence.menus.length} disclosure menu(s)`,
	);
	lines.push('');
	lines.push('machine-checked:');
	for (const rule of RULES) {
		const count = evidence.violations.filter((violation) => violation.rule === rule).length;
		lines.push(`  ${count === 0 ? 'ok  ' : 'FAIL'} ${rule.padEnd(34)} ${count} violation(s)`);
	}
	lines.push(
		`  ${evidence.fixture.violations.length === 0 ? 'ok  ' : 'FAIL'} ${'fixture'.padEnd(34)} ${evidence.fixture.rows.length} fixture file(s) reproduce the states they stand for`,
	);
	lines.push('');
	lines.push('native <dialog> inventory:');
	for (const dialog of evidence.dialogs) {
		const mode = dialog.nonModal
			? 'NON-MODAL (open attribute)'
			: dialog.modal
				? 'modal (showModal)'
				: 'inert (never opened)';
		lines.push(`  - ${dialog.file}:${dialog.line} — ${mode}, close path: ${dialog.closePath}`);
	}
	lines.push('');
	lines.push('disclosure menu inventory:');
	if (evidence.menus.length === 0) {
		lines.push('  - none');
	}
	for (const menu of evidence.menus) {
		lines.push(
			`  - ${menu.file}:${menu.line} — closed by Escape: ${menu.closesOnEscape}, focus hand-back declared: ${menu.handBack}`,
		);
	}
	lines.push('');
	lines.push('not machine-checked (human evaluation):');
	for (const item of evidence.humanEvaluation) lines.push(`  - ${item}`);
	lines.push('');
	lines.push('out of scope (excluded from the scan, with the reason):');
	for (const exclusion of EXCLUSIONS) {
		const count = evidence.excluded.filter((entry) => entry.reason === exclusion.id).length;
		lines.push(`  - ${exclusion.describe} (${count} file(s)): ${exclusion.reason}`);
	}
	lines.push('');
	if (evidence.violations.length > 0) {
		lines.push(`violations (${evidence.violations.length}):`);
		for (const entry of evidence.violations) {
			const where = entry.line ? `${entry.file}:${entry.line}` : entry.file;
			lines.push(`  [${entry.rule}] ${where} — ${entry.message}`);
		}
	} else {
		lines.push('no violations');
	}
	return lines.join('\n');
}

function main() {
	let evidence;
	try {
		evidence = collectEvidence();
	} catch (error) {
		process.stderr.write(`cannot scan the repository: ${error.message}\n`);
		return 2;
	}
	const report = `${renderGateSummary(evidence)}\n`;
	if (evidence.violations.length > 0) process.stderr.write(report);
	else process.stdout.write(report);
	return evidence.violations.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	process.exit(main());
}

export { main };
