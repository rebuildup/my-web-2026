#!/usr/bin/env node

/**
 * check-a11y-focus-visible — enforce the focus visibility / focus not obscured
 * contract on the shipped surface (Issue #395).
 *
 * What this gate is for
 * ---------------------
 * Two WCAG 2.2 criteria meet on the same question — "when a visitor tabs
 * through the page, can they see where they are, and can they see the thing
 * they focused?".
 *
 *   SC 2.4.7 Focus Visible (AA)
 *       The focused component has a visible focus indicator. In a codebase
 *       that styles every interactive element, the way that is lost is
 *       silent: one `outline: 'none'` in one focus block removes the
 *       indicator for that element and nothing else in the repository
 *       changes. This gate reads the focus blocks and fails when an
 *       indicator is REMOVED and nothing replaces it.
 *
 *   SC 2.4.11 Focus Not Obscured (Minimum, AA)
 *       The focused component is not entirely hidden by author-created
 *       content. The repository's own author-created overlays (a fixed
 *       consent banner, a fixed panel) are exactly that content, and the
 *       browser's default scroll-into-view puts a focused element at the
 *       edge of the viewport — where a fixed bottom overlay sits. This gate
 *       requires every author-created overlay to be BOUND to a focus
 *       compensation: the overlay's own file publishes the offset, and the
 *       document consumes it in a scroll compensation.
 *
 * The rules
 * ---------
 *   focus-indicator-removed
 *       A focus block (Panda `_focus` / `_focusVisible` / `&:focus` /
 *       `&:focus-visible`) removes the focus indicator — `outline: 'none'`,
 *       `outline: '0'`, `outlineWidth: '0'`, `outlineStyle: 'none'` — and
 *       declares no replacement indicator (no `boxShadow`, no colour, no
 *       border, no underline). The element then has NO visible focus.
 *   focus-indicator-invisible
 *       A focus block declares an outline that cannot be seen —
 *       `outline: 'transparent'` or `outlineColor: 'transparent'` — and
 *       declares no replacement indicator. The outline is there in the
 *       markup and invisible on the screen, which is the same defect with
 *       a different spelling.
 *   focus-obscured-no-compensation
 *       An author-created overlay (`position: 'fixed'` / `position:
 *       'sticky'`) is shipped and is not bound to a focus compensation.
 *       A native modal `<dialog>` opened with `showModal()` is NOT an
 *       overlay in this sense: the user agent makes the rest of the
 *       document inert, so nothing outside the dialog can be focused
 *       while it is open.
 *
 * What a compensation IS
 * ----------------------
 * A compensation is a two-part chain, and both parts have to exist:
 *
 *   1. the DOCUMENT consumes a scroll compensation that reads the offset —
 *      `scroll-padding-bottom: var(--<offset>)` in the global stylesheet
 *      (or in a `css({...})` call), and
 *   2. the OVERLAY'S OWN FILE publishes that offset — a
 *      `document.documentElement.style.setProperty('--<offset>', …)` call,
 *      a `--<offset>` key in a style object, or a `--<offset>: …`
 *      declaration.
 *
 * Part 1 alone is a dead declaration: `var(--x, 0px)` with nothing setting
 * `--x` reserves nothing. Part 2 alone is an unused variable. The chain
 * is what actually keeps a focused element out from under a fixed banner,
 * and the gate checks the chain, not one end of it.
 *
 * Machine-checked vs. human-evaluated
 * -----------------------------------
 * This gate decides the SHAPE of the contract: whether an indicator was
 * removed, whether an overlay exists, and whether the compensation chain
 * is closed. It cannot decide whether a focus ring is legible against the
 * background it sits on (that is the colour-contrast contract, Issue #399),
 * whether the compensation is TALL enough for the overlay at the current
 * viewport, or whether a focus order is sensible. Those stay human
 * evaluation and are printed separately, never merged into one green mark.
 *
 * Exit codes: 0 = every rule passes, 1 = at least one violation,
 * 2 = the repository could not be scanned.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, lineAt, stripComments, toRepoPath } from './_source-scan.mjs';

/** The criteria every rule in this gate answers to. */
export const WCAG = [
	{ sc: '2.4.7', name: 'Focus Visible', level: 'AA' },
	{ sc: '2.4.11', name: 'Focus Not Obscured (Minimum)', level: 'AA' },
];

/** The rule names, in report order. */
export const RULES = [
	'focus-indicator-removed',
	'focus-indicator-invisible',
	'focus-indicator-removed-in-css',
	'focus-obscured-no-compensation',
];

/**
 * The style keys that open a focus block.
 *
 * Panda's conditions (`_focus`, `_focusVisible`, `_focusWithin`) and the
 * raw CSS selectors (`&:focus`, `&:focus-visible`, `&:focus-within`) are
 * the two spellings this repository uses; both are read.
 */
export const FOCUS_CONDITIONS = [
	'_focus',
	'_focusVisible',
	'_focusWithin',
	'&:focus',
	'&:focus-visible',
	'&:focus-within',
];

/**
 * The declarations that can REPLACE a removed outline.
 *
 * A focus block that removes the outline but changes one of these still
 * shows the focus: the change is the indicator. `outline` itself is in the
 * list because a block may remove the outline and set a visible one in the
 * same declaration.
 */
export const REPLACEMENT_PROPERTIES = [
	'boxShadow',
	'borderColor',
	'borderWidth',
	'borderStyle',
	'backgroundColor',
	'color',
	'textDecoration',
	'outline',
];

/**
 * Declaration values that change nothing when applied.
 *
 * `color: 'inherit'` (or `currentColor` / `unset` / `revert` / `initial`)
 * does not change the computed colour, so it is not a replacement focus
 * indicator. Counting it as one would let
 * `_focus: { outline: 'none', color: 'inherit' }` pass while the element
 * has no visible focus at all.
 */
export const NO_OP_VALUES = new Set([
	'',
	'none',
	'transparent',
	'inherit',
	'currentcolor',
	'unset',
	'revert',
	'initial',
]);

/** The properties that place an element outside the normal flow. */
export const OVERLAY_POSITIONS = ['fixed', 'sticky'];

/**
 * The properties that compensate a focused element against an overlay.
 *
 * The camelCase form is the Panda spelling (`scrollPaddingBottom`); the
 * kebab-case form is the CSS spelling (`scroll-padding-bottom`). Both
 * name the same property, so both are read.
 */
export const COMPENSATION_PROPERTIES = [
	'scrollPadding',
	'scrollPaddingTop',
	'scrollPaddingBottom',
	'scrollPaddingInline',
	'scrollPaddingBlock',
	'scrollMargin',
	'scrollMarginTop',
	'scrollMarginBottom',
	'scrollMarginInline',
	'scrollMarginBlock',
	// The room at the END of the document. A scroll compensation alone
	// cannot help the LAST focusable element of a page: the browser
	// cannot scroll past the end of the document, so the element stays
	// at the bottom edge of the viewport — exactly where a fixed bottom
	// overlay is. Reserved space at the end of the document is what
	// lifts that element clear of the overlay.
	'paddingBottom',
];

/** The kebab-case property name as camelCase (pure). */
export function normalizeProperty(property) {
	return property.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

/** Whether a property is a focus compensation (pure). */
export function isCompensationProperty(property) {
	const normalized = normalizeProperty(property);
	return COMPENSATION_PROPERTIES.includes(normalized) || /^scroll(Padding|Margin)/.test(normalized);
}

/**
 * The scan target: the shipped source and the global stylesheet.
 *
 * The stylesheet is scanned because the compensation it declares is part
 * of the contract; a gate that only read `src/**\/*.{ts,tsx}` could not
 * see the other end of the chain.
 */
export const SCAN_ROOT = 'src';
export const SCAN_SUFFIXES = ['.ts', '.tsx', '.css'];
export const STYLESHEET_PATH = 'src/styles.css';

/**
 * What is deliberately OUT of scope, and why.
 *
 * The exclusions are printed with the report: an element nobody scans is a
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
			'the design-system route is the repository-internal component gallery, not a published surface; its demo markup is a specimen of the primitive, and the primitive itself is scanned',
	},
];

/**
 * Statements about what the scan does NOT judge, so the report never looks
 * like it judged more than it did.
 *
 * Unlike {@link EXCLUSIONS} these are not file globs: they name a KIND of
 * declaration that the gate deliberately leaves alone. They are printed in
 * the same "out of scope" section, because "scanned the file" must not
 * read as "judged every declaration in it".
 */
export const SCOPE_NOTES = [
	{
		id: 'raw-css-overlay',
		describe: 'raw CSS `position: fixed | sticky` overlays',
		reason:
			'the compensation-chain decision reads the overlay from a TS `css({...})` call, so a `position: fixed | sticky` declared in raw CSS is not collected as an overlay in this gate. Raw CSS focus-outline removal IS scanned (`focus-indicator-removed-in-css`)',
	},
];

/**
 * The fixture the gate actually reads.
 *
 * The fixture is not a decoration: `pass/` must produce zero violations and
 * `fail/` must produce exactly the named rule, or the gate reports the
 * fixture as broken. A fixture that quietly stopped reproducing the defect
 * would otherwise leave a green gate proving nothing.
 */
export const FIXTURE_ROOT = 'scripts/fixtures/a11y-focus-visible';

/**
 * The exact fixture roster, per directory.
 *
 * `pass` — files that must produce NO violation.
 * `fail` — files that must produce exactly the named rule.
 */
export const FIXTURE_EXPECTATIONS = {
	pass: {
		'visible-focus-outline.tsx': [],
		'focus-replacement-shadow.tsx': [],
		'modal-dialog-overlay.tsx': [],
		'compensated-overlay.tsx': [],
		'compensated-overlay-end-of-document.tsx': [],
	},
	fail: {
		'focus-outline-removed.tsx': ['focus-indicator-removed'],
		'focus-outline-transparent.tsx': ['focus-indicator-invisible'],
		'focus-outline-transparent-shorthand.tsx': ['focus-indicator-invisible'],
		'uncompensated-fixed-overlay.tsx': ['focus-obscured-no-compensation'],
		'overlay-self-compensation.tsx': ['focus-obscured-no-compensation'],
		'dialog-open-not-modal.tsx': ['focus-obscured-no-compensation'],
	},
};

/**
 * Things this gate deliberately does not decide. Printed with the report so
 * a green run is never mistaken for "accessible".
 */
export const HUMAN_EVALUATION = [
	'whether a focus indicator is legible against the background it sits on (the colour contract is Issue #399)',
	'whether the focus compensation is TALL enough for the overlay at every viewport width',
	'whether the focus ORDER follows a sensible reading order',
	'whether a native dialog is opened modally in every path that opens it',
	'a real screen-reader pass (VoiceOver / NVDA) announcing the focused element',
];

/** Whether an exclusion applies to a repo-relative path (pure). */
export function exclusionFor(relativePath) {
	if (/\.test\.tsx?$/.test(relativePath)) return EXCLUSIONS[0];
	if (/\.stories\.tsx$/.test(relativePath)) return EXCLUSIONS[1];
	if (relativePath.includes('/fixtures/')) return EXCLUSIONS[2];
	if (relativePath.startsWith('src/routes/design-system/')) return EXCLUSIONS[3];
	return null;
}

/* ------------------------------------------------------------------ *
 * Style-object parsing
 * ------------------------------------------------------------------ */

/** The index of the `}` that matches the `{` at `start` (pure). */
export function matchBrace(text, start) {
	let depth = 0;
	let quote = null;
	for (let index = start; index < text.length; index += 1) {
		const char = text[index];
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
		if (char === '{') depth += 1;
		if (char === '}') {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return -1;
}

/** The index of the `)` that matches the `(` at `start` (pure). */
export function matchParen(text, start) {
	let depth = 0;
	let quote = null;
	for (let index = start; index < text.length; index += 1) {
		const char = text[index];
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
		if (char === '(') depth += 1;
		if (char === ')') {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return -1;
}

/** Whether a `{…}` body is a token expression rather than an object (pure). */
function isExpressionBody(body) {
	const trimmed = body.trim();
	if (trimmed === '') return true;
	// A token reference (`{colors.border.focus}`) or a spread — never an
	// object literal.
	if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(trimmed)) return true;
	if (trimmed.startsWith('...')) return true;
	return !trimmed.includes(':');
}

/**
 * Parse one style object literal (pure).
 *
 * The result is a map of key → declaration:
 *   { kind: 'string' | 'number' | 'boolean' | 'object' | 'expression' | 'other',
 *     value: string, object?: Map<string, declaration> }
 */
export function parseStyleObject(text) {
	const declarations = new Map();
	let index = 0;
	const length = text.length;
	while (index < length) {
		const char = text[index];
		if (/\s/.test(char) || char === ',') {
			index += 1;
			continue;
		}
		// Key.
		let key;
		if (char === '"' || char === "'" || char === '`') {
			const end = text.indexOf(char, index + 1);
			const stop = end === -1 ? text.length : end;
			key = text.slice(index + 1, stop);
			index = stop + 1;
		} else {
			let keyEnd = index;
			while (keyEnd < text.length && !/[:,\s]/.test(text[keyEnd])) keyEnd += 1;
			key = text.slice(index, keyEnd);
			index = keyEnd;
		}
		while (index < length && /\s/.test(text[index])) index += 1;
		if (text[index] !== ':') {
			// A shorthand or a spread — no value to read.
			continue;
		}
		index += 1;
		while (index < length && /\s/.test(text[index])) index += 1;
		const valueChar = text[index];
		if (valueChar === '{') {
			const end = matchBrace(text, index);
			const stop = end === -1 ? text.length : end;
			const body = text.slice(index + 1, stop);
			if (isExpressionBody(body)) {
				declarations.set(key, { kind: 'expression', value: body.trim() });
			} else {
				declarations.set(key, { kind: 'object', value: body, object: parseStyleObject(body) });
			}
			index = stop + 1;
			continue;
		}
		if (valueChar === '[') {
			let depth = 0;
			let end = index;
			for (; end < text.length; end += 1) {
				if (text[end] === '[') depth += 1;
				if (text[end] === ']') {
					depth -= 1;
					if (depth === 0) break;
				}
			}
			declarations.set(key, { kind: 'other', value: text.slice(index, end + 1) });
			index = end + 1;
			continue;
		}
		if (valueChar === '"' || valueChar === "'" || valueChar === '`') {
			const end = text.indexOf(valueChar, index + 1);
			const stop = end === -1 ? text.length : end;
			declarations.set(key, { kind: 'string', value: text.slice(index + 1, stop) });
			index = stop + 1;
			continue;
		}
		let end = index;
		let depth = 0;
		for (; end < text.length; end += 1) {
			const current = text[end];
			if (current === '(' || current === '[' || current === '{') depth += 1;
			if (current === ')' || current === ']' || current === '}') {
				if (depth === 0) break;
				depth -= 1;
			}
			if (current === ',' && depth === 0) break;
		}
		const raw = text.slice(index, end).trim();
		const kind =
			raw === 'true' || raw === 'false'
				? 'boolean'
				: /^-?\d+(\.\d+)?$/.test(raw)
					? 'number'
					: 'other';
		declarations.set(key, { kind, value: raw });
		index = end;
	}
	return declarations;
}

/**
 * Every `css({…})` call in a source, with its parsed object (pure).
 *
 * `css()` is the only style entry point this repository uses, so the gate
 * reads the same objects the browser compiles.
 */
export function findStyleObjects(source) {
	const objects = [];
	let cursor = 0;
	while (cursor < source.length) {
		const start = source.indexOf('css(', cursor);
		if (start === -1) break;
		const open = start + 3;
		const close = matchParen(source, open);
		if (close === -1) break;
		const argument = source.slice(open + 1, close).trim();
		if (argument.startsWith('{')) {
			const end = matchBrace(argument, 0);
			const body = end === -1 ? argument : argument.slice(1, end);
			objects.push({
				index: start,
				line: lineAt(source, start),
				declarations: parseStyleObject(body),
			});
		}
		cursor = close + 1;
	}
	return objects;
}

/**
 * The opening tag a style object belongs to (pure).
 *
 * The search walks backwards from the `css(` call for the nearest opening
 * tag. A style object that is not directly inside a tag (a shared style
 * constant) has no element and returns `null`. The tag BODY is returned
 * too, so the caller can read the element's attributes (a `<dialog open>`
 * is not a modal).
 */
export function enclosingTag(source, index) {
	const before = source.slice(0, index);
	const match = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^<>]*)$/.exec(before);
	return match ? { name: match[1], body: match[2] } : null;
}

/**
 * Whether a JSX tag carries an `open` attribute (pure).
 *
 * A `<dialog open>` (or `open={…}`) is opened NON-modally: the user agent
 * does not make the rest of the document inert, so it can still obscure a
 * focused element. It must not take the modal exemption.
 */
export function hasOpenAttribute(tagBody) {
	return /(?:^|\s)open(?:\s|=|\/|$)/.test(tagBody);
}

/* ------------------------------------------------------------------ *
 * Rule evaluation
 * ------------------------------------------------------------------ */

/** The declaration value as a comparable string (pure). */
function valueText(declaration) {
	if (!declaration) return '';
	return declaration.value;
}

/** Whether a declaration removes the outline (pure). */
export function removesOutline(declarations) {
	const outline = declarations.get('outline');
	if (outline) {
		const value = valueText(outline).trim().toLowerCase();
		if (value === 'none' || value === '0' || value === '0px') return true;
	}
	const width = declarations.get('outlineWidth');
	if (width) {
		const value = valueText(width).trim().toLowerCase();
		if (value === '0' || value === '0px') return true;
	}
	const style = declarations.get('outlineStyle');
	if (style && valueText(style).trim().toLowerCase() === 'none') return true;
	return false;
}

/**
 * Whether a colour value is fully transparent (pure).
 *
 * The spellings a browser treats as invisible: the `transparent` keyword,
 * a zero alpha channel (`rgba(…, 0)`, `rgb(0 0 0 / 0)`, `hsla(…, 0)`),
 * and the hex forms (`#0000`, `#00000000`).
 */
export function isTransparentColor(value) {
	const text = String(value).trim().toLowerCase();
	if (text === 'transparent') return true;
	if (/^#[0-9a-f]{4}$/.test(text)) return text[4] === '0';
	if (/^#[0-9a-f]{8}$/.test(text)) return text.slice(7) === '00';
	const fn = /^(?:rgba?|hsla?)\(([^)]*)\)$/.exec(text);
	if (fn) {
		const body = fn[1];
		let alpha = null;
		if (body.includes('/')) {
			alpha = body.split('/').pop().trim();
		} else {
			const parts = body.split(',').map((part) => part.trim());
			if (parts.length === 4) alpha = parts[3];
		}
		if (alpha !== null) return Number(alpha) === 0;
	}
	return false;
}

/**
 * Whether an `outline` shorthand contains an invisible colour component
 * (pure).
 *
 * `outline: 'transparent'` is only one spelling. `outline: '2px solid
 * transparent'` — an extremely common way to draw a transparent ring —
 * is fully invisible too, and the shorthand is a list of components, so
 * the whole value and each component are checked, plus any colour
 * function or hex token inside it.
 */
export function containsTransparentColor(value) {
	const text = String(value).trim().toLowerCase();
	if (isTransparentColor(text)) return true;
	for (const token of text.split(/\s+/)) {
		if (isTransparentColor(token)) return true;
	}
	for (const match of text.matchAll(/(?:rgba?|hsla?)\([^)]*\)/g)) {
		if (isTransparentColor(match[0])) return true;
	}
	for (const match of text.matchAll(/#[0-9a-f]{4,8}/g)) {
		if (isTransparentColor(match[0])) return true;
	}
	return false;
}

/** Whether a declaration makes the outline impossible to see (pure). */
export function hidesOutline(declarations) {
	const outline = declarations.get('outline');
	if (outline && containsTransparentColor(valueText(outline))) return true;
	const color = declarations.get('outlineColor');
	if (color && isTransparentColor(valueText(color))) return true;
	return false;
}

/** Whether the block declares a visible outline of its own (pure). */
export function declaresVisibleOutline(declarations) {
	const outline = declarations.get('outline');
	if (!outline) return false;
	const value = valueText(outline).trim().toLowerCase();
	if (value === 'none' || value === '0' || value === '0px') return false;
	// `outline: '2px solid transparent'` is a full shorthand that draws
	// nothing; it must not be read as "a visible outline exists".
	if (containsTransparentColor(value)) return false;
	// A visible outline needs a width; `outline: solid red` (no width) is
	// invalid CSS and computes to the medium width, so it counts.
	return true;
}

/** Whether the block replaces the indicator with another visual change (pure). */
export function declaresReplacement(declarations) {
	for (const property of REPLACEMENT_PROPERTIES) {
		const declaration = declarations.get(property);
		if (!declaration) continue;
		if (property === 'outline') {
			if (declaresVisibleOutline(declarations)) return true;
			continue;
		}
		const value = valueText(declaration).trim().toLowerCase();
		if (NO_OP_VALUES.has(value)) continue;
		return true;
	}
	return false;
}

/**
 * The verdict of one focus block (pure).
 *
 *   `visible`    — the block keeps or replaces the indicator (pass)
 *   `removed`    — the indicator is removed and nothing replaces it (violation)
 *   `invisible`  — the indicator is present but cannot be seen (violation)
 */
export function evaluateFocusBlock(declarations) {
	if (declaresReplacement(declarations)) return 'visible';
	if (hidesOutline(declarations)) return 'invisible';
	if (removesOutline(declarations)) return 'removed';
	return 'visible';
}

/** The rule a focus verdict is reported under, or `null` for a pass (pure). */
export function ruleForFocusVerdict(verdict) {
	if (verdict === 'removed') return 'focus-indicator-removed';
	if (verdict === 'invisible') return 'focus-indicator-invisible';
	return null;
}

/**
 * The custom properties a source publishes (pure).
 *
 * A publication is a runtime `setProperty('--x', …)` call, a `--x` key in
 * a style object, or a `--x: …` declaration in a stylesheet. The
 * property name may be written through a module constant
 * (`const OFFSET = '--x'`); the constant is followed, so the contract
 * does not depend on how the name is spelled at the call site.
 */
export function publishedCustomProperties(source) {
	const names = new Set();
	const constants = new Map();
	for (const match of source.matchAll(
		/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"](--[\w-]+)['"]/g,
	)) {
		constants.set(match[1], match[2]);
	}
	for (const match of source.matchAll(/setProperty\(\s*['"](--[\w-]+)['"]/g)) names.add(match[1]);
	for (const match of source.matchAll(/setProperty\(\s*([A-Za-z_$][\w$]*)\s*,/g)) {
		const resolved = constants.get(match[1]);
		if (resolved) names.add(resolved);
	}
	for (const match of source.matchAll(/['"](--[\w-]+)['"]\s*:/g)) names.add(match[1]);
	for (const match of source.matchAll(/(--[\w-]+)\s*:/g)) names.add(match[1]);
	return names;
}

/**
 * The scroll compensations a source declares (pure).
 *
 * `css({ scrollPaddingBottom: '…' })` and `scroll-padding-bottom: …;` in
 * a stylesheet are the same declaration in two spellings.
 */
/**
 * Every raw CSS declaration block with its selector (pure).
 *
 * A minimal reader, no parser library: a block is the text between `{`
 * and its matching `}`; its selector is the text between the previous
 * `}`, `;` or `{` and the `{`. A block that contains a nested `{` is an
 * at-rule / `@layer` wrapper rather than a declaration block, so it is
 * skipped — its inner rules are still found because the walk descends
 * into every block.
 */
export function rawCssRules(source) {
	const rules = [];
	let index = 0;
	while (index < source.length) {
		const open = source.indexOf('{', index);
		if (open === -1) break;
		const close = matchBrace(source, open);
		if (close === -1) break;
		const body = source.slice(open + 1, close);
		let start = open - 1;
		while (start >= 0 && !'};{'.includes(source[start])) start -= 1;
		const selector = source.slice(start + 1, open).trim();
		if (!body.includes('{')) {
			rules.push({ selector, body, line: lineAt(source, open) });
		}
		index = open + 1;
	}
	return rules;
}

/**
 * The declarations of a raw CSS block, keyed like a style object (pure).
 *
 * Kebab-case properties are normalised to camelCase so the same rule
 * functions (`removesOutline`, `declaresReplacement`, …) read a
 * stylesheet block and a `css({...})` object the same way.
 */
export function parseCssDeclarations(body) {
	const declarations = new Map();
	for (const match of body.matchAll(/([a-z-]+)\s*:\s*([^;}]+)/g)) {
		declarations.set(normalizeProperty(match[1]), { kind: 'string', value: match[2].trim() });
	}
	return declarations;
}

/**
 * The scroll compensations a source declares (pure).
 *
 * `css({ scrollPaddingBottom: '…' })` and `scroll-padding-bottom: …;` in
 * a stylesheet are the same declaration in two spellings. Each carries
 * the CONSUMER it is declared on — the raw CSS selector, or the enclosing
 * element's tag name for a `css({...})` object — because a compensation
 * only has an effect on a document scroll element (see
 * `isDocumentScrollConsumer`).
 */
export function declaredCompensations(source) {
	const compensations = [];
	for (const object of findStyleObjects(source)) {
		const tag = enclosingTag(source, object.index);
		for (const [key, declaration] of object.declarations) {
			if (!isCompensationProperty(key)) continue;
			compensations.push({
				property: key,
				value: valueText(declaration),
				line: object.line,
				selector: tag ? tag.name : null,
			});
		}
	}
	for (const rule of rawCssRules(source)) {
		for (const [property, declaration] of parseCssDeclarations(rule.body)) {
			if (!isCompensationProperty(property)) continue;
			compensations.push({
				property,
				value: valueText(declaration),
				line: rule.line,
				selector: rule.selector,
			});
		}
	}
	return compensations;
}

/**
 * Whether a compensation is consumed by the DOCUMENT (pure).
 *
 * A compensation only has an effect where it is declared. `scroll-padding*`
 * is read from the scrolling element (`html` / `body` / `:root`), and the
 * end-of-document room (`padding-bottom`) is read from `body` / `html`.
 * A `scrollPaddingBottom` on the overlay's OWN element is a no-op — it
 * reserves nothing — so it must not close the chain. This is the check
 * that makes "move the compensation onto the fixed overlay" fail.
 *
 * `selector` is the raw CSS selector, or the enclosing element's tag name
 * for a `css({...})` object. An unknown consumer is not a document
 * consumption.
 */
export function isDocumentScrollConsumer(compensation) {
	const selector = (compensation.selector ?? '').trim().toLowerCase();
	if (selector === '') return false;
	const parts = selector.split(',').map((part) => part.trim());
	if (normalizeProperty(compensation.property) === 'paddingBottom') {
		return parts.some((part) => /^(html|body)\b/.test(part));
	}
	return parts.some((part) => /^(html|body|:root)\b/.test(part));
}

/** The custom properties a compensation consumes (pure). */
export function consumedCustomProperties(compensation) {
	const names = new Set();
	for (const match of compensation.value.matchAll(/var\(\s*(--[\w-]+)/g)) names.add(match[1]);
	return names;
}

/**
 * The verdict of one author-created overlay (pure).
 *
 * `overlay` is:
 *   { file, line, tagName, position, modal }
 */
export function evaluateOverlay(overlay, bindings) {
	if (overlay.modal) return { verdict: 'modal', reason: 'native modal dialog' };
	const bound = bindings.filter(
		(binding) => binding.offsetPublishedIn === overlay.file && binding.compensation !== null,
	);
	if (bound.length > 0) return { verdict: 'compensated', reason: bound[0].offset };
	return { verdict: 'uncompensated', reason: null };
}

/* ------------------------------------------------------------------ *
 * Scanning
 * ------------------------------------------------------------------ */

/**
 * The violations of one source file (pure over the file's text).
 *
 * `bindings` is the compensation chain of the whole surface: for every
 * offset, the file that publishes it and the compensation that consumes
 * it. `focusBlocks` and `overlays` are collected here; the rules that need
 * the whole surface (the compensation chain) are decided by the caller.
 */
export function scanSource({ relativePath, source, bindings = [] }) {
	const code = stripComments(source);
	const violations = [];
	const focusBlocks = [];
	const overlays = [];
	const published = publishedCustomProperties(code);
	const modalDialog = /\bshowModal\s*\(/.test(code);
	// A non-modal open (`<dialog open>` or `dialog.show()`) does not make
	// the rest of the document inert, so it must not take the modal
	// exemption even in a file that also calls `showModal()` somewhere.
	const nonModalShow = /\bshow\s*\(/.test(code);

	for (const object of findStyleObjects(code)) {
		for (const [key, declaration] of object.declarations) {
			if (!FOCUS_CONDITIONS.includes(key)) continue;
			if (declaration.kind !== 'object' || !declaration.object) continue;
			const verdict = evaluateFocusBlock(declaration.object);
			focusBlocks.push({ file: relativePath, line: object.line, condition: key, verdict });
			const rule = ruleForFocusVerdict(verdict);
			if (rule === null) continue;
			violations.push({
				rule,
				file: relativePath,
				line: object.line,
				wcag: rule === 'focus-indicator-invisible' ? '2.4.7' : '2.4.7',
				message: messageForFocusVerdict(verdict, key),
			});
		}

		const position = object.declarations.get('position');
		if (!position) continue;
		const value = valueText(position).trim().toLowerCase();
		if (!OVERLAY_POSITIONS.includes(value)) continue;
		const tag = enclosingTag(code, object.index);
		const tagName = tag ? tag.name : null;
		const overlay = {
			file: relativePath,
			line: object.line,
			tagName,
			position: value,
			modal:
				tagName === 'dialog' &&
				modalDialog &&
				!nonModalShow &&
				!hasOpenAttribute(tag ? tag.body : ''),
		};
		overlays.push(overlay);
		const evaluation = evaluateOverlay(overlay, bindings);
		if (evaluation.verdict !== 'uncompensated') continue;
		violations.push({
			rule: 'focus-obscured-no-compensation',
			file: relativePath,
			line: object.line,
			wcag: '2.4.11',
			message: `a \`position: ${value}\` overlay is shipped and no focus compensation is bound to it: the browser scrolls a focused element to the edge of the viewport, where this overlay sits, so the element can be entirely hidden (SC 2.4.11). Publish the overlay's offset from this file and consume it in a scroll compensation`,
		});
	}

	return { violations, focusBlocks, overlays, published };
}

/** The short reason a focus violation is reported (pure). */
export function messageForFocusVerdict(verdict, condition) {
	if (verdict === 'removed') {
		return `the ${condition} block removes the focus indicator and declares no replacement: the element has no visible focus at all (SC 2.4.7)`;
	}
	return `the ${condition} block declares an outline that cannot be seen (transparent) and no replacement: the focus is in the markup and invisible on the screen (SC 2.4.7)`;
}

/**
 * Whether a raw CSS selector targets a focus state this gate reads (pure).
 *
 * `:focus`, `:focus-visible`, `:focus-within` and `[focus-visible]` are
 * the spellings. `:focus:not(:focus-visible)` is deliberately EXCLUDED:
 * that selector targets the POINTER focus, where the browser default ring
 * is not required and the keyboard indicator is untouched, so removing
 * the outline there is not this rule's defect.
 */
export function isFocusRemovalSelector(selector) {
	const text = selector.toLowerCase();
	if (!/(?::focus(?:-visible|-within)?|\[focus-visible\])/.test(text)) return false;
	if (/:not\(\s*:focus-visible\s*\)/.test(text)) return false;
	return true;
}

/**
 * Focus-removal violations in a raw stylesheet (pure).
 *
 * The shipped stylesheet is part of the surface — a global
 * `:focus { outline: none }` is exactly the defect this gate exists to
 * catch — so it is read with the same rule functions as a `css({...})`
 * object, under the `focus-indicator-removed-in-css` rule id.
 */
export function scanStylesheet({ relativePath, source }) {
	const code = stripComments(source);
	const violations = [];
	const focusBlocks = [];
	for (const rule of rawCssRules(code)) {
		if (!isFocusRemovalSelector(rule.selector)) continue;
		const declarations = parseCssDeclarations(rule.body);
		const verdict = evaluateFocusBlock(declarations);
		focusBlocks.push({ file: relativePath, line: rule.line, condition: rule.selector, verdict });
		if (verdict === 'visible') continue;
		violations.push({
			rule: 'focus-indicator-removed-in-css',
			file: relativePath,
			line: rule.line,
			wcag: '2.4.7',
			message: `the raw CSS rule \`${rule.selector}\` ${
				verdict === 'invisible'
					? 'declares an outline that cannot be seen'
					: 'removes the focus indicator'
			} and declares no replacement (SC 2.4.7)`,
		});
	}
	return { violations, focusBlocks };
}

/**
 * The compensation chain of the whole surface (pure over the scanned files).
 *
 * For every custom property, the file that publishes it and the
 * compensation that consumes it. A chain is CLOSED when both ends exist.
 */
export function buildBindings(files) {
	const publishers = new Map();
	for (const file of files) {
		for (const name of file.published) {
			if (!publishers.has(name)) publishers.set(name, []);
			publishers.get(name).push(file.relativePath);
		}
	}
	const bindings = [];
	for (const file of files) {
		for (const compensation of file.compensations) {
			// Only a compensation declared on the document's scrolling
			// element actually reserves space. A `scrollPaddingBottom` on
			// the overlay itself is a no-op and must not close the chain.
			if (!isDocumentScrollConsumer(compensation)) continue;
			for (const name of consumedCustomProperties(compensation)) {
				const publishedIn = publishers.get(name) ?? [];
				bindings.push({
					offset: name,
					compensation: compensation.property,
					compensationFile: file.relativePath,
					offsetPublishedIn: publishedIn[0] ?? null,
				});
			}
		}
	}
	return bindings;
}

/* ------------------------------------------------------------------ *
 * Fixture audit
 * ------------------------------------------------------------------ */

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
		const { directory, relativePath, expectedRules, foundRules, focusBlockCount, overlayCount } =
			entry;
		if (directory === 'pass') {
			if (focusBlockCount === 0 && overlayCount === 0) {
				violations.push({
					rule: 'fixture-pass-no-case',
					file: relativePath,
					line: null,
					wcag: null,
					message:
						'the pass fixture holds neither a focus block nor an overlay, so it exercises no rule; an empty pass fixture proves nothing and must not keep the gate green',
				});
			}
			if (foundRules.length > 0) {
				violations.push({
					rule: 'fixture-pass-violation',
					file: relativePath,
					line: foundRules[0].line ?? null,
					wcag: foundRules[0].wcag ?? null,
					message: `a pass fixture reports ${foundRules.map((rule) => rule.rule).join(', ')}; the pass state is no longer reproduced`,
				});
			}
			rows.push({
				file: relativePath,
				expected: [],
				found: foundRules.map((rule) => rule.rule),
				focusBlocks: focusBlockCount,
				overlays: overlayCount,
			});
			continue;
		}
		const found = foundRules.map((rule) => rule.rule);
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
			focusBlocks: focusBlockCount,
			overlays: overlayCount,
		});
	}
	return { violations, rows };
}

/**
 * Audit the fixture (pure over the filesystem).
 *
 * Every fixture file is scanned ALONE: a fixture that carries its own
 * compensation is compensated, and one that does not is not — the
 * repository-wide compensation must not leak into a fixture and make it
 * pass for the wrong reason.
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
			const {
				violations: found,
				focusBlocks,
				overlays,
			} = scanSource({
				relativePath,
				source,
				bindings: buildBindings([
					{
						relativePath,
						published: publishedCustomProperties(stripComments(source)),
						compensations: declaredCompensations(stripComments(source)),
					},
				]),
			});
			entries.push({
				directory,
				name,
				relativePath,
				expectedRules,
				foundRules: found,
				focusBlockCount: focusBlocks.length,
				overlayCount: overlays.length,
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

/** Every source file under a directory (pure over the filesystem). */
function collectSourceFiles(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectSourceFiles(path));
			continue;
		}
		if (!SCAN_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
		files.push(path);
	}
	return files;
}

/**
 * Scan the repository (pure over `repoRoot`).
 *
 * The scan runs in two passes: the first collects every compensation and
 * every published offset, the second decides the overlays against the
 * chain the first pass found. A single pass could not tell an overlay
 * from its own compensation, because the compensation may live in another
 * file.
 */
export function collectEvidence(repoRoot = REPO_ROOT) {
	const violations = [];
	const excluded = [];
	const focusBlocks = [];
	const overlays = [];
	const files = [];
	let filesScanned = 0;
	const scanRoot = join(repoRoot, SCAN_ROOT);
	if (!existsSync(scanRoot) || !statSync(scanRoot).isDirectory()) {
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
		const source = stripComments(readFileSync(file, 'utf8'));
		files.push({
			relativePath,
			kind: relativePath.endsWith('.css') ? 'css' : 'ts',
			published: publishedCustomProperties(source),
			compensations: declaredCompensations(source),
		});
	}

	const bindings = buildBindings(files);

	for (const file of files) {
		const source = readFileSync(join(repoRoot, file.relativePath), 'utf8');
		if (file.kind === 'css') {
			// A raw stylesheet is read for focus-outline removal (SC 2.4.7).
			const result = scanStylesheet({ relativePath: file.relativePath, source });
			violations.push(...result.violations);
			focusBlocks.push(...result.focusBlocks);
			continue;
		}
		const result = scanSource({ relativePath: file.relativePath, source, bindings });
		violations.push(...result.violations);
		focusBlocks.push(...result.focusBlocks);
		overlays.push(...result.overlays);
	}

	const fixture = auditFixture(repoRoot);
	violations.push(...fixture.violations);
	return {
		filesScanned,
		focusBlocks,
		overlays,
		bindings,
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
	lines.push('focus visibility / focus not obscured gate — Issue #395');
	lines.push(
		`scanned ${evidence.filesScanned} shipped source file(s) under ${SCAN_ROOT}/, ${evidence.focusBlocks.length} focus block(s), ${evidence.overlays.length} overlay(s)`,
	);
	lines.push('');
	lines.push('machine-checked:');
	const removed = evidence.violations.filter(
		(violation) => violation.rule === 'focus-indicator-removed',
	).length;
	const invisible = evidence.violations.filter(
		(violation) => violation.rule === 'focus-indicator-invisible',
	).length;
	const removedInCss = evidence.violations.filter(
		(violation) => violation.rule === 'focus-indicator-removed-in-css',
	).length;
	const obscured = evidence.violations.filter(
		(violation) => violation.rule === 'focus-obscured-no-compensation',
	).length;
	lines.push(
		`  ${removed === 0 ? 'ok  ' : 'FAIL'} ${'focus-indicator-removed'.padEnd(28)} no focus block removes the indicator without a replacement (SC 2.4.7)`,
	);
	lines.push(
		`  ${invisible === 0 ? 'ok  ' : 'FAIL'} ${'focus-indicator-invisible'.padEnd(28)} no focus block declares an outline that cannot be seen (SC 2.4.7)`,
	);
	lines.push(
		`  ${removedInCss === 0 ? 'ok  ' : 'FAIL'} ${'focus-indicator-removed-in-css'.padEnd(28)} no raw CSS focus rule removes the indicator without a replacement (SC 2.4.7)`,
	);
	lines.push(
		`  ${obscured === 0 ? 'ok  ' : 'FAIL'} ${'focus-obscured-no-compensation'.padEnd(28)} every author-created overlay is bound to a focus compensation (SC 2.4.11)`,
	);
	lines.push(
		`  ${evidence.fixture.violations.length === 0 ? 'ok  ' : 'FAIL'} ${'fixture'.padEnd(28)} ${evidence.fixture.rows.length} fixture file(s) reproduce the states they stand for`,
	);
	lines.push('');
	lines.push('not machine-checked (human evaluation):');
	for (const item of evidence.humanEvaluation) lines.push(`  - ${item}`);
	lines.push('');
	lines.push('out of scope (excluded from the scan, with the reason):');
	for (const exclusion of EXCLUSIONS) {
		const count = evidence.excluded.filter((entry) => entry.reason === exclusion.id).length;
		lines.push(`  - ${exclusion.describe} (${count} file(s)): ${exclusion.reason}`);
	}
	for (const note of SCOPE_NOTES) {
		lines.push(`  - ${note.describe}: ${note.reason}`);
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
