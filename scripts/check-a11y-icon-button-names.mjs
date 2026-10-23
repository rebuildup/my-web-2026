#!/usr/bin/env node

/**
 * check-a11y-icon-button-names — enforce the accessible-name contract on
 * icon-only buttons (Issue #396).
 *
 * What this gate is for
 * ---------------------
 * An icon-only button is readable to a sighted reader and nameless to a
 * screen-reader user: the control is announced as "button" with nothing
 * after it, so the reader cannot tell what it does. This gate is what
 * stops `src/**` from quietly undoing the fix, by rendering an icon
 * without a name, by writing `aria-label=""`, or by pointing
 * `aria-labelledby` at an id the file no longer declares.
 *
 * Every rule corresponds to a claim the verification artefact
 * (`docs/verification/a11y/icon-button-names.webp`) makes:
 *
 *   icon-button-missing-name
 *       An icon-only button has NO mechanism that can supply a name.
 *       "The icon is familiar" is not a name: the contract asks for a
 *       mechanism, not for a good wording.
 *       WCAG 2.2 SC 4.1.2 Name, Role, Value (A) + SC 2.4.6 Headings and
 *       Labels (AA).
 *   icon-button-empty-name
 *       A name was SPECIFIED and it is empty. `aria-label=""` is worse
 *       than no attribute at all: it looks like the button was named,
 *       and the announcement is still nameless.
 *       WCAG 2.2 SC 4.1.2 Name, Role, Value (A).
 *   icon-button-name-target-missing
 *       `aria-labelledby` names an id that does not exist in the same
 *       file. The reference resolves to nothing, so the button is
 *       nameless while the source reads as if it were named.
 *       WCAG 2.2 SC 1.3.1 Info and Relationships (A) + SC 4.1.2 (A).
 *
 * What the gate counts as an icon-only button
 * -------------------------------------------
 * A `<button>` whose descendants (nested elements included) contain no
 * text string at all — JSX text nodes and `{"…"}` string literals — and
 * that contain an icon element (`<svg>`, `<img>`, or a component whose
 * name ends in `Icon`). A button that carries text is not this gate's
 * business: its name comes from the text.
 *
 * Machine-checked vs. human-evaluated
 * -----------------------------------
 * The report prints the two lists separately and never mixes them.
 * Everything below "not machine-checked" is a judgement this gate cannot
 * make: whether the supplied name actually describes the action, whether
 * the wording matches the visible icon, whether a real screen reader
 * announces the button as expected, and whether a sighted reader can
 * still recognise the affordance. `docs/verification/a11y/icon-button-names.md`
 * records who looked at them.
 *
 * Exit codes: 0 = every rule passes, 1 = at least one violation,
 * 2 = the repository could not be scanned.
 */

import { readFileSync } from 'node:fs';
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
export const ISSUE = '#396';

/**
 * The rules this gate reports, in the order they are decided.
 *
 * The first three are the Issue's own rules. The fourth is the gate's
 * own integrity rule: the fixtures are what makes the other three
 * reproducible, so a fixture that stopped reproducing them is a defect
 * of the gate itself.
 */
export const RULES = [
	'icon-button-missing-name',
	'icon-button-empty-name',
	'icon-button-name-target-missing',
	'fixture-expectation-mismatch',
];

/** The Issue's own rules, without the gate's integrity rule. */
export const BUTTON_RULES = RULES.slice(0, 3);

/**
 * Where the fixture DATA lives.
 *
 * The fixtures are example files, not shipped surfaces: they exist so
 * the three rules stay reproducible without a browser. They live under
 * `scripts/` for exactly that reason — a fixture inside `src/` would be
 * a surface the gate has to exempt, and an exemption is a hole.
 */
export const FIXTURE_ROOT = 'scripts/fixtures/a11y-icon-button-names';

/**
 * Files that are NOT shipped surfaces, and are therefore out of scope.
 *
 * Each exclusion carries a REASON, and the reason is printed with the
 * report: an exemption nobody can explain is an exemption nobody can
 * trust.
 */
export const EXCLUSIONS = [
	{
		id: 'test-file',
		reason: 'a unit test asserts markup, it is not a shipped surface',
		match: (relativePath) => /\.test\.tsx$/.test(relativePath),
	},
	{
		id: 'story-file',
		reason: 'a Storybook story is a preview surface, not a shipped surface',
		match: (relativePath) => /\.stories\.tsx$/.test(relativePath),
	},
	{
		id: 'fixture-directory',
		reason: 'a fixture exists to exercise a rule on purpose, including its failure',
		match: (relativePath) => relativePath.includes('/fixtures/'),
	},
	{
		id: 'design-system-route',
		reason: 'the design-system route renders a state matrix for designers, not a shipped surface',
		match: (relativePath) => relativePath.startsWith('src/routes/design-system/'),
	},
];

/**
 * Things this gate deliberately does not decide. Printed with the
 * report so a reader never mistakes a green run for "accessible".
 */
export const HUMAN_EVALUATION = [
	'whether the supplied name describes the action the button actually performs',
	'whether the name matches the icon the sighted reader sees',
	'a real screen-reader pass (VoiceOver / NVDA) announcing the button with its name',
	'whether the accessible name stays meaningful when the button is disabled',
];

/** Class names that mean "visually hidden but still in the accessibility tree". */
export const HIDDEN_CLASS_NAMES = ['visually-hidden', 'visuallyHidden', 'sr-only', 'srOnly'];

/** The attribute a surface can use to mark a visually hidden label. */
export const HIDDEN_ATTRIBUTE = 'data-visually-hidden';

/** Icon shapes an icon-only button may be built from. */
export const ICON_PATTERNS = [/<svg[\s/>]/i, /<img[\s/>]/i, /<[A-Z][A-Za-z0-9_]*Icon[\s/>]/];

/**
 * Find the `>` that closes a JSX tag starting at `index`.
 *
 * Quote- and brace-aware, because a tag may carry `title="a > b"` or
 * `onClick={() => setOpen(true)}`. Returns -1 when the tag is not
 * closed inside the source.
 */
export function findTagEnd(code, index) {
	let i = index + 1;
	let quote = null;
	let depth = 0;
	while (i < code.length) {
		const char = code[i];
		if (quote !== null) {
			if (char === '\\') {
				i += 2;
				continue;
			}
			if (char === quote) quote = null;
			i += 1;
			continue;
		}
		if (char === '"' || char === "'" || char === '`') {
			quote = char;
			i += 1;
			continue;
		}
		if (char === '{') {
			depth += 1;
			i += 1;
			continue;
		}
		if (char === '}') {
			depth -= 1;
			i += 1;
			continue;
		}
		if (char === '>' && depth === 0) return i;
		i += 1;
	}
	return -1;
}

/** Find the `}` that closes the JSX expression opening at `index`. */
export function findClosingBrace(code, index) {
	let i = index + 1;
	let quote = null;
	let depth = 1;
	while (i < code.length) {
		const char = code[i];
		if (quote !== null) {
			if (char === '\\') {
				i += 2;
				continue;
			}
			if (char === quote) quote = null;
			i += 1;
			continue;
		}
		if (char === '"' || char === "'" || char === '`') {
			quote = char;
			i += 1;
			continue;
		}
		if (char === '{') depth += 1;
		if (char === '}') {
			depth -= 1;
			if (depth === 0) return i;
		}
		i += 1;
	}
	return -1;
}

/**
 * Parse the attributes of one start tag.
 *
 * Each value keeps its KIND, because the kind decides what the gate may
 * conclude: a literal string can be read, an expression can only be
 * assumed to hold something.
 */
export function parseAttributes(tagBody) {
	const attributes = new Map();
	let i = 0;
	while (i < tagBody.length) {
		const char = tagBody[i];
		if (/\s/.test(char) || char === '/') {
			i += 1;
			continue;
		}
		let name = '';
		while (i < tagBody.length && /[A-Za-z0-9_:.$-]/.test(tagBody[i])) {
			name += tagBody[i];
			i += 1;
		}
		if (name === '') {
			i += 1;
			continue;
		}
		let j = i;
		while (j < tagBody.length && /\s/.test(tagBody[j])) j += 1;
		if (tagBody[j] !== '=') {
			attributes.set(name, { kind: 'bare', value: '' });
			continue;
		}
		j += 1;
		while (j < tagBody.length && /\s/.test(tagBody[j])) j += 1;
		const quote = tagBody[j];
		if (quote === '"' || quote === "'") {
			const end = tagBody.indexOf(quote, j + 1);
			attributes.set(name, {
				kind: 'string',
				value: tagBody.slice(j + 1, end === -1 ? tagBody.length : end),
			});
			i = end === -1 ? tagBody.length : end + 1;
			continue;
		}
		if (quote === '{') {
			const end = findClosingBrace(tagBody, j);
			attributes.set(name, {
				kind: 'expression',
				value: tagBody.slice(j + 1, end === -1 ? tagBody.length : end),
			});
			i = end === -1 ? tagBody.length : end + 1;
			continue;
		}
		let end = j;
		while (end < tagBody.length && !/\s/.test(tagBody[end])) end += 1;
		attributes.set(name, { kind: 'bare', value: tagBody.slice(j, end) });
		i = end;
	}
	return attributes;
}

/**
 * The literal string an expression holds, or null when it holds
 * something the gate cannot read.
 *
 * `"close"` is a name; `close ? 'a' : 'b'` is a name too, but the gate
 * cannot read WHICH, so it treats it as present rather than guessing.
 */
export function stringLiteralValue(expression) {
	const trimmed = expression.trim();
	const quote = trimmed[0];
	if (quote !== '"' && quote !== "'" && quote !== '`') return null;
	if (trimmed.length < 2 || trimmed[trimmed.length - 1] !== quote) return null;
	let i = 1;
	while (i < trimmed.length) {
		const char = trimmed[i];
		if (char === '\\') {
			i += 2;
			continue;
		}
		if (char === quote) {
			return i === trimmed.length - 1 ? trimmed.slice(1, -1) : null;
		}
		i += 1;
	}
	return null;
}

/**
 * Whether a start tag marks its element as visually hidden.
 *
 * Either a known hidden class (`visually-hidden` / `visuallyHidden` /
 * `sr-only` / `srOnly` — the last two are the Panda spellings this
 * repository uses) or the `data-visually-hidden` attribute.
 */
export function isHiddenElement(tagBody) {
	const attributes = parseAttributes(tagBody);
	const className = attributes.get('className');
	const classText = className ? className.value : '';
	const hiddenByClass = HIDDEN_CLASS_NAMES.some((hidden) => classText.includes(hidden));
	const hiddenByAttribute = attributes.has(HIDDEN_ATTRIBUTE);
	return hiddenByClass || hiddenByAttribute;
}

/**
 * Every text string a JSX fragment renders.
 *
 * JSX text nodes and string-literal expressions count; a dynamic
 * expression does not, because the gate cannot know what it renders and
 * a guess would be a false name. Nested elements contribute their own
 * text, but NOT their attribute values — an attribute is metadata, not
 * a rendered word.
 *
 * With `skipHidden`, the content of a visually hidden element is left
 * out: a label no sighted reader can see is not a visible label, and
 * the gate has to be able to say "this button shows only an icon".
 */
export function extractText(children, { skipHidden = false } = {}) {
	let text = '';
	let i = 0;
	while (i < children.length) {
		const char = children[i];
		if (char === '{') {
			const end = findClosingBrace(children, i);
			const expression = children.slice(i + 1, end === -1 ? children.length : end);
			const literal = stringLiteralValue(expression);
			if (literal !== null) text += literal;
			i = end === -1 ? children.length : end + 1;
			continue;
		}
		if (char === '<') {
			if (children.startsWith('<!--', i)) {
				const end = children.indexOf('-->', i);
				i = end === -1 ? children.length : end + 3;
				continue;
			}
			const end = findTagEnd(children, i);
			if (end === -1) {
				i = children.length;
				continue;
			}
			if (skipHidden) {
				const tagBody = children.slice(i + 1, end);
				const nameMatch = /^([A-Za-z][A-Za-z0-9._-]*)/.exec(tagBody);
				if (isHiddenElement(tagBody) && nameMatch) {
					const closeIndex = closingTagIndex(children, end, nameMatch[1]);
					if (closeIndex !== -1) {
						i = closeIndex;
						continue;
					}
				}
			}
			i = end + 1;
			continue;
		}
		text += char;
		i += 1;
	}
	return text;
}

/**
 * The index of the `</name>` that closes an element, or -1.
 */
export function closingTagIndex(code, fromIndex, tagName) {
	const closing = `</${tagName}`;
	const index = code.indexOf(closing, fromIndex);
	if (index === -1) return -1;
	const end = code.indexOf('>', index);
	return end === -1 ? -1 : end + 1;
}

/** Whether the children contain an icon shape. */
export function containsIcon(children) {
	return ICON_PATTERNS.some((pattern) => pattern.test(children));
}

/**
 * The ids a file declares literally, plus the ones it builds at
 * runtime.
 *
 * A literal id is `id="x"` / `id={'x'}`. A runtime id (`id={`${base}-x`}`)
 * cannot be resolved statically, so the raw id string is searched for
 * instead: if the string appears somewhere other than the reference
 * itself, the id exists but is built dynamically.
 */
export function collectDeclaredIds(source) {
	const literal = new Set();
	for (const match of source.matchAll(
		/\bid=(?:"([^"]*)"|'([^']*)'|\{\s*(['"`])([^'"`]*)\3\s*\})/g,
	)) {
		literal.add(match[1] ?? match[2] ?? match[4] ?? '');
	}
	return literal;
}

/** Whether `id` is declared by `source`, literally or at runtime. */
export function idIsDeclared(source, id, declared = collectDeclaredIds(source)) {
	if (declared.has(id)) return true;
	// A dynamically built id appears as a literal piece inside a
	// template: count the occurrences and require more than the
	// reference itself.
	const occurrences = source.split(id).length - 1;
	return occurrences > 1;
}

/**
 * Whether the children carry a visually hidden text label.
 *
 * The hidden label is a legitimate way to name a button, and it is the
 * only one that needs no new wording: the label is already on the page.
 */
export function hasHiddenTextLabel(children) {
	let i = 0;
	while (i < children.length) {
		const char = children[i];
		if (char !== '<') {
			i += 1;
			continue;
		}
		if (children.startsWith('<!--', i)) {
			const end = children.indexOf('-->', i);
			i = end === -1 ? children.length : end + 3;
			continue;
		}
		const tagEnd = findTagEnd(children, i);
		if (tagEnd === -1) return false;
		const tagBody = children.slice(i + 1, tagEnd);
		const nameMatch = /^([A-Za-z][A-Za-z0-9._-]*)/.exec(tagBody);
		if (isHiddenElement(tagBody)) {
			const label = labelTextOf(children, tagEnd, nameMatch?.[1] ?? '');
			if (label !== null && label.trim() !== '') return true;
		}
		i = tagEnd + 1;
	}
	return false;
}

/**
 * The text an element carries, read from just after its start tag.
 *
 * The closing tag of the same name is the first one that follows, which
 * is enough for a label element: a label is a leaf.
 */
export function labelTextOf(children, tagEnd, tagName) {
	if (tagName === '') return null;
	const closing = `</${tagName}`;
	const closeIndex = children.indexOf(closing, tagEnd);
	if (closeIndex === -1) return null;
	const closeEnd = children.indexOf('>', closeIndex);
	if (closeEnd === -1) return null;
	return extractText(children.slice(tagEnd + 1, closeIndex));
}

/**
 * The name-supplying mechanisms an icon-only button declares.
 *
 * Each mechanism is `none` / `empty` / `present` / `broken`, so the
 * caller can tell "no attempt" from "an attempt that fails".
 */
export function evaluateNameMechanisms(attributes, source, children) {
	const read = (name) => {
		const attribute = attributes.get(name);
		if (!attribute) return 'none';
		if (attribute.kind === 'string') return attribute.value.trim() === '' ? 'empty' : 'present';
		if (attribute.kind === 'expression') {
			const literal = stringLiteralValue(attribute.value);
			if (literal === null) return 'present';
			return literal.trim() === '' ? 'empty' : 'present';
		}
		return attribute.value.trim() === '' ? 'empty' : 'present';
	};

	const ariaLabel = read('aria-label');
	const title = read('title');

	let labelledby = 'none';
	let missingTargets = [];
	const labelledbyAttribute = attributes.get('aria-labelledby');
	if (labelledbyAttribute) {
		const literal =
			labelledbyAttribute.kind === 'string'
				? labelledbyAttribute.value
				: stringLiteralValue(labelledbyAttribute.value);
		if (literal === null) {
			// A dynamic reference cannot be resolved statically. It is
			// assumed to resolve, because guessing "broken" here would
			// report a defect the gate cannot see.
			labelledby = 'present';
		} else if (literal.trim() === '') {
			labelledby = 'empty';
		} else {
			const declared = collectDeclaredIds(source);
			const ids = literal.trim().split(/\s+/).filter(Boolean);
			missingTargets = ids.filter((id) => !idIsDeclared(source, id, declared));
			labelledby = missingTargets.length === 0 ? 'present' : 'broken';
		}
	}

	const hiddenText = hasHiddenTextLabel(children);
	const named =
		ariaLabel === 'present' ||
		(labelledby === 'present' && missingTargets.length === 0) ||
		title === 'present' ||
		hiddenText;

	return { ariaLabel, labelledby, title, hiddenText, named, missingTargets };
}

/**
 * Every `<button>` element in a source, with the attributes and the
 * children of each.
 *
 * Buttons do not nest in HTML, so the matching `</button>` is the
 * element's own. The bound is documented rather than counted: a nested
 * button would have to make this gate fail loudly rather than silently
 * pass.
 */
export function findButtons(code) {
	const buttons = [];
	const pattern = /<button(?=[\s/>])/g;
	let match = pattern.exec(code);
	while (match !== null) {
		const start = match.index;
		const tagEnd = findTagEnd(code, start);
		if (tagEnd === -1) break;
		const tagBody = code.slice(start + '<button'.length, tagEnd);
		const selfClosing = tagBody.trimEnd().endsWith('/');
		const attributes = parseAttributes(tagBody);
		let children = '';
		let end = tagEnd;
		if (!selfClosing) {
			const closeIndex = code.indexOf('</button>', tagEnd);
			if (closeIndex === -1) {
				children = code.slice(tagEnd + 1);
				end = code.length;
			} else {
				children = code.slice(tagEnd + 1, closeIndex);
				end = closeIndex;
			}
		}
		buttons.push({ start, tagEnd, end, attributes, children, selfClosing });
		pattern.lastIndex = Math.max(tagEnd, start + 1);
		match = pattern.exec(code);
	}
	return buttons;
}

/**
 * Whether a button shows nothing but an icon.
 *
 * "Nothing but an icon" means: no text a sighted reader can see (a
 * visually hidden label does not count as visible text) and at least
 * one icon shape inside.
 */
export function isIconOnly(children) {
	if (extractText(children, { skipHidden: true }).trim() !== '') return false;
	return containsIcon(children);
}

/** Whether a file is out of scope, and why. */
export function exclusionReasons(relativePath) {
	return EXCLUSIONS.filter((exclusion) => exclusion.match(relativePath)).map(
		(exclusion) => exclusion.id,
	);
}

/**
 * The rules an icon-only button breaks (pure over one file).
 */
export function scanViolationsInFile({ relativePath, source }) {
	const violations = [];
	const code = stripComments(source);
	const record = (rule, index, message) => {
		violations.push({
			rule,
			file: relativePath,
			line: lineAt(code, index),
			wcag: WCAG_BY_RULE[rule] ?? null,
			message,
		});
	};

	for (const button of findButtons(code)) {
		if (!isIconOnly(button.children)) continue;

		const mechanisms = evaluateNameMechanisms(button.attributes, code, button.children);
		const where = `this icon-only button (${describeMechanisms(mechanisms)})`;

		if (mechanisms.labelledby === 'broken') {
			record(
				'icon-button-name-target-missing',
				button.start,
				`${where} points aria-labelledby at ${mechanisms.missingTargets.join(', ')}, which this file does not declare; the reference resolves to nothing`,
			);
		}
		if (mechanisms.named) continue;

		const empty = [
			mechanisms.ariaLabel === 'empty' ? 'aria-label' : null,
			mechanisms.labelledby === 'empty' ? 'aria-labelledby' : null,
			mechanisms.title === 'empty' ? 'title' : null,
		].filter(Boolean);
		if (empty.length > 0) {
			record(
				'icon-button-empty-name',
				button.start,
				`${where} specifies ${empty.join(' and ')} as empty; an empty name is announced as no name at all`,
			);
			continue;
		}
		if (mechanisms.labelledby === 'broken') {
			// The broken reference is already reported above; saying it
			// twice would bury the actionable half of the finding.
			continue;
		}
		record(
			'icon-button-missing-name',
			button.start,
			`${where} has no accessible name; give it aria-label, aria-labelledby, title, or a visually hidden label`,
		);
	}

	return violations;
}

/** The WCAG criterion each rule stands for. */
export const WCAG_BY_RULE = {
	'icon-button-missing-name': '4.1.2',
	'icon-button-empty-name': '4.1.2',
	'icon-button-name-target-missing': '1.3.1',
};

/** A short description of what a button already declares. */
export function describeMechanisms(mechanisms) {
	const parts = [];
	if (mechanisms.ariaLabel !== 'none') parts.push(`aria-label ${mechanisms.ariaLabel}`);
	if (mechanisms.labelledby !== 'none') parts.push(`aria-labelledby ${mechanisms.labelledby}`);
	if (mechanisms.title !== 'none') parts.push(`title ${mechanisms.title}`);
	if (mechanisms.hiddenText) parts.push('visually hidden label');
	return parts.length === 0 ? 'no name mechanism' : parts.join(', ');
}

/**
 * Scan the repository (pure over `directory`, so the rules are unit
 * testable without a checkout).
 */
export function collectEvidence(directory = join(REPO_ROOT, 'src')) {
	const violations = [];
	const candidates = collectSourceFiles(directory).filter((file) => file.endsWith('.tsx'));
	const excluded = [];
	let scanned = 0;
	let iconOnly = 0;
	let named = 0;

	for (const file of candidates) {
		const relativePath = toRepoPath(file);
		const reasons = exclusionReasons(relativePath);
		if (reasons.length > 0) {
			excluded.push({ file: relativePath, reasons });
			continue;
		}
		scanned += 1;
		const source = readFileSync(file, 'utf8');
		const code = stripComments(source);
		for (const button of findButtons(code)) {
			if (!isIconOnly(button.children)) continue;
			iconOnly += 1;
			const mechanisms = evaluateNameMechanisms(button.attributes, code, button.children);
			if (mechanisms.named) named += 1;
		}
		violations.push(...scanViolationsInFile({ relativePath, source }));
	}

	const fixtures = collectFixtureEvidence();
	violations.push(...fixtures.mismatches);

	return {
		filesScanned: scanned,
		iconOnlyButtons: iconOnly,
		namedIconButtons: named,
		violations,
		excluded,
		fixtures,
		humanEvaluation: HUMAN_EVALUATION,
	};
}

/**
 * The fixtures, read for real.
 *
 * A `pass/` fixture must break no rule; a `fail/` fixture must break
 * one. The expectation is checked here so the gate cannot pass with
 * fixtures that stopped reproducing the rules.
 */
export function collectFixtureEvidence(root = join(REPO_ROOT, FIXTURE_ROOT)) {
	const read = (directory) => {
		const files = [];
		try {
			for (const file of collectSourceFiles(directory, () => false)) {
				if (!file.endsWith('.tsx')) continue;
				files.push(file);
			}
		} catch {
			return [];
		}
		return files;
	};

	const scan = (file) => {
		const relativePath = toRepoPath(file);
		const source = readFileSync(file, 'utf8');
		return { file: relativePath, violations: scanViolationsInFile({ relativePath, source }) };
	};

	const pass = read(join(root, 'pass')).map(scan);
	const fail = read(join(root, 'fail')).map(scan);
	const mismatches = [];
	for (const entry of pass) {
		if (entry.violations.length > 0) {
			mismatches.push({
				rule: 'fixture-expectation-mismatch',
				file: entry.file,
				line: null,
				wcag: null,
				message: `a pass fixture breaks ${entry.violations.length} rule(s); the pass fixtures must show the contract being met`,
			});
		}
	}
	for (const entry of fail) {
		if (entry.violations.length === 0) {
			mismatches.push({
				rule: 'fixture-expectation-mismatch',
				file: entry.file,
				line: null,
				wcag: null,
				message:
					'a fail fixture breaks no rule; the failure states the Issue names must stay reproducible',
			});
		}
	}

	return { root: FIXTURE_ROOT, pass, fail, mismatches };
}

/** The human-readable report, with the two kinds of statement separated. */
export function renderGateSummary(evidence) {
	const lines = [];
	lines.push(`icon-button accessible name gate — Issue ${ISSUE}`);
	lines.push(
		`scanned ${evidence.filesScanned} tsx file(s) under src/; ${evidence.iconOnlyButtons} icon-only button(s), ${evidence.namedIconButtons} of them named`,
	);
	lines.push('');
	lines.push('machine-checked:');
	for (const rule of BUTTON_RULES) {
		const count = evidence.violations.filter((entry) => entry.rule === rule).length;
		lines.push(`  ${count === 0 ? 'ok  ' : 'FAIL'} ${rule.padEnd(34)} ${count} violation(s)`);
	}
	const fixtureMismatch = evidence.violations.filter(
		(entry) => entry.rule === 'fixture-expectation-mismatch',
	);
	lines.push(
		`  ${fixtureMismatch.length === 0 ? 'ok  ' : 'FAIL'} ${'fixture-expectation-mismatch'.padEnd(34)} ${evidence.fixtures.pass.length} pass fixture(s), ${evidence.fixtures.fail.length} fail fixture(s)`,
	);
	lines.push('');
	lines.push('not machine-checked (human evaluation):');
	for (const item of evidence.humanEvaluation) lines.push(`  - ${item}`);
	lines.push('');
	lines.push('out of scope (excluded from the scan):');
	for (const exclusion of EXCLUSIONS) {
		const files = evidence.excluded.filter((entry) => entry.reasons.includes(exclusion.id));
		lines.push(`  ${exclusion.id}: ${files.length} file(s) — ${exclusion.reason}`);
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
