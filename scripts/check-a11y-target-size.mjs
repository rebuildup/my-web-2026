#!/usr/bin/env node

/**
 * check-a11y-target-size — enforce the tap / click target size contract on the
 * surfaces Issue #401 names, and on the target-size fixture (Issue #401).
 *
 * What this gate is for
 * ---------------------
 * WCAG 2.2 SC 2.5.8 Target Size (Minimum), level AA, asks for one thing:
 * a pointer target must be at least 24 × 24 CSS pixels, UNLESS it falls
 * under one of the exceptions the criterion itself names. The criterion is
 * a size claim, so it is a claim about the RENDERED box — and a rendered
 * box is not readable from the source. That is why this Issue has two
 * halves, in the same shape as its sibling Issues:
 *
 *   1. THIS gate — the static half. It reads the shipped source and
 *      decides the DECLARED size of every interactive element on the
 *      surfaces the Issue names, and whether the surface offers a
 *      drag-only operation with no click (or keyboard) alternative.
 *   2. `scripts/capture-a11y-target-size.mjs` — the browser half. It
 *      opens the same surfaces in Chromium, measures the real hit boxes,
 *      and applies the exceptions the source cannot settle (the inline
 *      exception and the spacing exception).
 *
 * Neither half substitutes for the other. The gate says "this element
 * declares a 16 px height" — it cannot say how tall the box ended up, or
 * whether the box is a sentence's inline link. The capture says "this box
 * is 20 px tall and it is an inline link in a paragraph" — it cannot say
 * whether the author meant it.
 *
 * The surfaces (Issue #401 names them)
 * ------------------------------------
 *   - the reaction picker (`src/home/reactions/widget.tsx`),
 *   - the public nav (`src/editorial/nav/PublicNav.tsx`),
 *   - the portfolio facet filter (`src/portfolio/components/FacetFilter.tsx`).
 *
 * The scope is those three surfaces and nothing else. A target on another
 * surface is NOT silently scanned: the exclusion is printed with its
 * reason, so the report always shows where the holes are. Widening the
 * scope without a decision would make the report unreadable and would put
 * this Issue's name on another surface's defects.
 *
 * The rules
 * ---------
 *   shipped-target-undersized
 *       A shipped target DECLARES a hit-area size below 24 CSS px. A
 *       declaration is a claim the author made; a claim that is too small
 *       is a defect whether the rendered box grows afterwards or not.
 *       (SC 2.5.8)
 *   shipped-drag-without-alternative
 *       A shipped target offers a drag gesture and no click (or keyboard)
 *       alternative. A pointer-only operation is unusable for a keyboard
 *       user, so the criterion's "Equivalent" exception does not apply.
 *       (SC 2.5.8, and the criterion's own pointer-gesture reasoning)
 *   target-specimen-undersized
 *       A fixture specimen declares a size below 24 CSS px and does not
 *       declare a valid exception. (SC 2.5.8)
 *   target-specimen-exception-invalid
 *       A fixture specimen declares an exception that is not one of the
 *       four the criterion names, or declares it without a reason. An
 *       exception nobody can check is an exception nobody reads.
 *       (SC 2.5.8)
 *   target-specimen-drag-only
 *       A fixture specimen reproduces a drag-only operation with no click
 *       alternative. (SC 2.5.8)
 *   fixture-pass-no-specimen / fixture-pass-violation /
 *   fixture-fail-not-detected / fixture-fail-unexpected /
 *   fixture-file-missing / fixture-file-unexpected
 *       The fixture must reproduce the states it stands for, or the gate
 *       is green for the wrong reason.
 *
 * The four exceptions of SC 2.5.8
 * ------------------------------
 *   inline
 *       The target is in a sentence, or its size is otherwise constrained
 *       by the line-height of non-target text. DECIDED BY MEASUREMENT: the
 *       capture reads the computed `display` of the box. A declared size
 *       below 24 px does NOT qualify — the exception is for a target whose
 *       size the text flow constrains, not for a target the author sized.
 *   spacing
 *       A 24 CSS px diameter circle centred on the target does not
 *       intersect any other target's circle or bounding box. DECIDED BY
 *       MEASUREMENT, and the author has to CLAIM it: a specimen (or a
 *       shipped surface) declares the exception with a reason, and the
 *       capture then checks the claim against the rendered boxes. A claim
 *       the geometry does not support is a failure, not a pass.
 *   user-agent control
 *       The size of the target is determined by the user agent and is not
 *       modified by the author. DECIDED BY DECLARATION, with a reason.
 *   essential
 *       A particular presentation of the target is essential. DECIDED BY
 *       DECLARATION, with a reason.
 *
 * A declaration without a reason is not an exception; it is a hole with a
 * label on it. `SHIPPED_EXCEPTIONS` is where a shipped surface declares
 * the two declaration-only exceptions, one row per (surface, selector,
 * kind, reason). It is printed with the report, empty or not, so a reader
 * can see that the list was looked at.
 *
 * Machine-checked vs. human-evaluated
 * -----------------------------------
 * This gate decides DECLARATIONS: the size an element claims, the
 * exceptions an element declares, and whether a drag gesture has an
 * alternative. It cannot decide whether a 24 px target is easy to hit,
 * whether a spacing exception is good design, whether a drag gesture is
 * the right interaction at all, or how the surface feels on a phone.
 * Those stay human evaluation and are printed separately, never merged
 * into one green mark.
 *
 * Exit codes: 0 = every rule passes, 1 = at least one violation,
 * 2 = the repository could not be scanned.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, lineAt, stripComments, toRepoPath } from './_source-scan.mjs';

/** The Issue this gate belongs to. */
export const ISSUE = '#401';

/** The criterion every rule in this gate answers to. */
export const WCAG = { sc: '2.5.8', name: 'Target Size (Minimum)', level: 'AA' };

/**
 * The minimum size, in CSS px, of a pointer target.
 *
 * SC 2.5.8 asks for 24 × 24 CSS px. The number is written once, here,
 * and every half reads it.
 */
export const MIN_TARGET_PX = 24;

/** The rule names, in report order. */
export const RULES = [
	'shipped-target-undersized',
	'shipped-drag-without-alternative',
	'target-specimen-undersized',
	'target-specimen-exception-invalid',
	'target-specimen-drag-only',
	'fixture-pass-no-specimen',
	'fixture-pass-violation',
	'fixture-fail-not-detected',
	'fixture-fail-unexpected',
	'fixture-file-missing',
	'fixture-file-unexpected',
];

/**
 * The surfaces this Issue names, and the file that owns each one.
 *
 * The scope is a decision, not a default: Issue #401 names the reaction
 * picker, the nav and the filter, and this gate covers exactly those
 * three files.
 */
export const SURFACES = [
	{
		id: 'reaction-picker',
		file: 'src/home/reactions/widget.tsx',
		label: 'reaction picker',
		reason:
			'Issue #401 names the reaction picker; the picker button and the aggregate chips live in this file',
	},
	{
		id: 'nav',
		file: 'src/editorial/nav/PublicNav.tsx',
		label: 'public nav',
		reason: 'Issue #401 names the nav; the nav links and the mobile menu trigger live in this file',
	},
	{
		id: 'filter',
		file: 'src/portfolio/components/FacetFilter.tsx',
		label: 'facet filter',
		reason: 'Issue #401 names the filter; the facet chips and the clear button live in this file',
	},
];

/**
 * What is deliberately out of scope, and why.
 *
 * The exclusions are printed with the report: a target nobody scans is a
 * hole in the contract, so a reader has to be able to see where the holes
 * are and what justifies them.
 */
export const EXCLUSIONS = [
	{
		id: 'other-surfaces',
		describe: 'every other file under src/**',
		reason:
			"this Issue names three surfaces (the reaction picker, the nav, the filter); a target on another surface belongs to that surface's own Issue, and scanning it here would put this Issue's name on a defect it does not own",
	},
	{
		id: 'test-files',
		describe: '*.test.tsx',
		reason:
			'a test file asserts on rendered markup; the defect this Issue removes is in the shipped product code, not in its assertions',
	},
	{
		id: 'story-files',
		describe: '*.stories.tsx',
		reason:
			'a Storybook story is a preview harness for a component, not a surface a visitor reaches; the component it renders is scanned on its own',
	},
	{
		id: 'design-system-route',
		describe: 'src/routes/design-system/**',
		reason:
			'the design-system route is the repository-internal component gallery, not a published surface; its demo markup is a specimen of the primitive, and the primitive itself is scanned',
	},
];

/**
 * Panda's `sizes` scale, in CSS px.
 *
 * `h` / `w` / `size` / `minH` / `minW` resolve against this scale (the
 * base preset's, 0.25 rem per step at a 16 px root). The values are the
 * ones the shipped stylesheet actually publishes — the generated
 * `--sizes-*` custom properties — so the gate and the browser agree.
 */
export const SIZES = {
	0: 0,
	1: 4,
	2: 8,
	3: 12,
	4: 16,
	5: 20,
	6: 24,
	7: 28,
	8: 32,
	9: 36,
	10: 40,
	11: 44,
	12: 48,
	14: 56,
	16: 64,
	20: 80,
	24: 96,
	28: 112,
	32: 128,
	36: 144,
	40: 160,
	44: 176,
	48: 192,
	52: 208,
	56: 224,
	60: 240,
	64: 256,
	72: 288,
	80: 320,
	96: 384,
};

/**
 * Panda's `spacing` scale, in CSS px.
 *
 * `p` / `px` / `py` / `gap` / `margin` resolve against this scale. The
 * repository's own `src/editorial/tokens.ts` extends it; the keys the
 * repository defines carry the same values as the base scale, so the
 * merged scale is the base one plus the fractional steps.
 */
export const SPACING = {
	0: 0,
	0.5: 2,
	1: 4,
	1.5: 6,
	2: 8,
	2.5: 10,
	3: 12,
	3.5: 14,
	4: 16,
	4.5: 18,
	5: 20,
	5.5: 22,
	6: 24,
	7: 28,
	8: 32,
	9: 36,
	10: 40,
	11: 44,
	12: 48,
	14: 56,
	16: 64,
	20: 80,
	24: 96,
	28: 112,
	32: 128,
	36: 144,
	40: 160,
	44: 176,
	48: 192,
	52: 208,
	56: 224,
	60: 240,
	64: 256,
	72: 288,
	80: 320,
	96: 384,
};

/** The root font size the rem-based scales are computed against. */
export const ROOT_FONT_PX = 16;

/**
 * The properties that decide a target's hit area, and the scale each one
 * resolves against.
 *
 * A `min-*` of 0 is not a size: it declares that the element has no
 * floor, which is the opposite of a small target. Such a declaration is
 * skipped rather than reported.
 */
export const SIZE_PROPERTIES = {
	height: { axis: 'height', category: 'sizes' },
	'min-height': { axis: 'height', category: 'sizes' },
	width: { axis: 'width', category: 'sizes' },
	'min-width': { axis: 'width', category: 'sizes' },
	size: { axis: 'both', category: 'sizes' },
};

/** The properties that decide the space between two targets. */
export const SPACING_PROPERTIES = {
	gap: { category: 'spacing' },
	'row-gap': { category: 'spacing' },
	'column-gap': { category: 'spacing' },
};

/**
 * The four exceptions SC 2.5.8 names, and how each one is decided.
 *
 * `measured` means the browser settles it; `declared` means the author
 * claims it with a reason and the gate checks the claim's shape.
 */
export const EXCEPTION_KINDS = {
	inline: {
		decided: 'measured',
		describe:
			'the target is in a sentence, or its size is constrained by the line-height of non-target text',
	},
	spacing: {
		decided: 'measured-after-declaration',
		describe:
			"a 24 CSS px diameter circle centred on the target does not intersect any other target's circle or bounding box",
	},
	'user-agent': {
		decided: 'declared',
		describe:
			'the size of the target is determined by the user agent and is not modified by the author',
	},
	essential: {
		decided: 'declared',
		describe: 'a particular presentation of the target is essential',
	},
};

/**
 * The shipped surfaces' declaration-only exceptions.
 *
 * One row per (surface, selector, kind, reason). The reason is part of
 * the row on purpose: an exception without a reason is a hole the next
 * editor will widen without knowing. The list is empty today — the
 * shipped surfaces need no declaration-only exception — and it is printed
 * with the report either way, so a reader can see that it was looked at.
 */
export const SHIPPED_EXCEPTIONS = [];

/** The attribute a fixture specimen uses to declare its exception. */
export const EXCEPTION_ATTRIBUTE = 'data-target-exception';

/** The attribute a fixture specimen uses to declare its exception reason. */
export const REASON_ATTRIBUTE = 'data-target-reason';

/** The attribute that names a fixture specimen. */
export const SPECIMEN_ATTRIBUTE = 'data-target-specimen';

/** The attribute that names one target inside a specimen. */
export const TARGET_ATTRIBUTE = 'data-target-target';

/**
 * The fixture the gate actually reads.
 *
 * The fixture is not a decoration: `pass/` must produce zero violations
 * and `fail/` must produce the named rule, or the gate reports the
 * fixture as broken. A fixture that quietly stopped reproducing its
 * defect would otherwise leave a green gate proving nothing.
 */
export const FIXTURE_ROOT = 'scripts/fixtures/a11y-target-size';

/**
 * The exact fixture roster, per directory.
 *
 * `staticRules` — the rules the static half must report for the file.
 * `sizeVerdict` — what the browser half must measure for the file:
 * `pass` (every target in the specimen meets the criterion) or `fail`
 * (at least one target does not).
 *
 * The two columns are separate because the two halves judge different
 * things: a drag-only specimen is a static defect and a compliant box,
 * so it belongs in `fail/` with `sizeVerdict: 'pass'`.
 */
export const FIXTURE_EXPECTATIONS = {
	pass: {
		'01-minimum-target.tsx': { exportName: 'MinimumTarget', staticRules: [], sizeVerdict: 'pass' },
		'02-oversized-target.tsx': {
			exportName: 'OversizedTarget',
			staticRules: [],
			sizeVerdict: 'pass',
		},
		'03-inline-target.tsx': { exportName: 'InlineTarget', staticRules: [], sizeVerdict: 'pass' },
		'04-spacing-exception.tsx': {
			exportName: 'SpacingException',
			staticRules: [],
			sizeVerdict: 'pass',
		},
	},
	fail: {
		'01-undersized-target.tsx': {
			exportName: 'UndersizedTarget',
			staticRules: ['target-specimen-undersized'],
			sizeVerdict: 'fail',
		},
		'02-tight-neighbours.tsx': {
			exportName: 'TightNeighbours',
			staticRules: [],
			sizeVerdict: 'fail',
		},
		'03-drag-only.tsx': {
			exportName: 'DragOnlyTarget',
			staticRules: ['target-specimen-drag-only'],
			sizeVerdict: 'pass',
		},
	},
};

/** Things this gate deliberately does not decide. */
export const HUMAN_EVALUATION = [
	'whether a 24 px target is comfortable to hit with a thumb on a phone',
	'whether the spacing exception is a good design decision rather than a lucky measurement',
	'whether a drag gesture is the right interaction at all, or whether the click alternative should be the only one',
	'how the picker, the nav and the filter feel under a slow tap or a tremor',
	'a real device pass (a physical phone, a stylus, a trackpad)',
];

/* ------------------------------------------------------------------ *
 * Source reading
 * ------------------------------------------------------------------ */

/**
 * The CSS spelling of a React / Panda style key.
 *
 * The fixture writes `minH`, the browser writes `min-height`. Both
 * halves speak CSS, so the key is translated once, here.
 */
export function cssPropertyFor(key) {
	switch (key) {
		case 'h':
			return 'height';
		case 'minH':
			return 'min-height';
		case 'w':
			return 'width';
		case 'minW':
			return 'min-width';
		case 'p':
			return 'padding';
		case 'px':
			return 'padding-inline';
		case 'py':
			return 'padding-block';
		case 'pt':
			return 'padding-top';
		case 'pb':
			return 'padding-bottom';
		case 'pl':
			return 'padding-left';
		case 'pr':
			return 'padding-right';
		case 'mt':
			return 'margin-top';
		case 'mb':
			return 'margin-bottom';
		case 'ml':
			return 'margin-left';
		case 'mr':
			return 'margin-right';
		case 'm':
			return 'margin';
		default:
			return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
	}
}

/** The index of the matching `}` for the `{` at `start` (pure). */
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

/** The index of the `>` that closes the tag opened before `start` (pure). */
export function findTagEnd(code, start) {
	let depth = 0;
	let quote = null;
	for (let index = start; index < code.length; index += 1) {
		const char = code[index];
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

/** The value of an attribute, when it is statically known (pure). */
export function attributeValueIs(attribute, expected) {
	if (attribute.kind === 'string') return attribute.value === expected;
	if (attribute.kind === 'boolean') return attribute.value === expected;
	const expression = attribute.value.trim();
	if (expression === expected) return true;
	const literal = /^(['"])([\s\S]*)\1$/.exec(expression);
	return literal !== null && literal[2] === expected;
}

/**
 * Parse the attributes of one JSX opening tag (pure).
 *
 * `text` is the tag body between `<tag` and the closing `>`. Values are
 * reported as they were written, so the caller can tell a literal from a
 * runtime expression.
 */
export function parseAttributes(text) {
	const attributes = [];
	let index = 0;
	while (index < text.length) {
		const char = text[index];
		if (/\s/.test(char)) {
			index += 1;
			continue;
		}
		if (char === '{') {
			// A spread (`{...props}`) or a bare expression container.
			const end = matchBrace(text, index);
			if (end === -1) break;
			index = end + 1;
			continue;
		}
		let nameEnd = index;
		while (nameEnd < text.length && /[A-Za-z0-9_:.-]/.test(text[nameEnd])) nameEnd += 1;
		if (nameEnd === index) {
			index += 1;
			continue;
		}
		const name = text.slice(index, nameEnd);
		index = nameEnd;
		let cursor = index;
		while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
		if (text[cursor] !== '=') {
			attributes.push({ name, kind: 'boolean', value: 'true' });
			continue;
		}
		cursor += 1;
		while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
		const valueChar = text[cursor];
		if (valueChar === '"' || valueChar === "'") {
			const end = text.indexOf(valueChar, cursor + 1);
			const stop = end === -1 ? text.length : end;
			attributes.push({ name, kind: 'string', value: text.slice(cursor + 1, stop) });
			index = stop + 1;
			continue;
		}
		if (valueChar === '{') {
			const end = matchBrace(text, cursor);
			const stop = end === -1 ? text.length : end;
			attributes.push({ name, kind: 'expression', value: text.slice(cursor + 1, stop) });
			index = stop + 1;
			continue;
		}
		let end = cursor;
		while (end < text.length && !/\s/.test(text[end])) end += 1;
		attributes.push({ name, kind: 'string', value: text.slice(cursor, end) });
		index = end;
	}
	return attributes;
}

/**
 * Every JSX opening tag in a source, with its attributes (pure).
 *
 * The element is bounded by its own closing `>`: a `>` inside a quoted
 * attribute value or a JSX expression does not end the tag.
 */
export function findTags(code) {
	const tags = [];
	let cursor = 0;
	while (cursor < code.length) {
		const start = code.indexOf('<', cursor);
		if (start === -1) break;
		const nameMatch = /^<([A-Za-z][A-Za-z0-9.]*)/.exec(code.slice(start, start + 64));
		if (!nameMatch) {
			cursor = start + 1;
			continue;
		}
		const end = findTagEnd(code, start + nameMatch[0].length);
		if (end === -1) break;
		tags.push({
			tag: nameMatch[1],
			index: start,
			end,
			line: lineAt(code, start),
			attributes: parseAttributes(code.slice(start + nameMatch[0].length, end)),
			text: code.slice(start, end + 1),
		});
		cursor = end + 1;
	}
	return tags;
}

/**
 * The literal values inside a style object value (pure).
 *
 * A value may be a literal (`'24px'`), a number (`24`), or a nested
 * object (the responsive form: `{ base: '4', md: '6' }`). A nested
 * object contributes all of its leaves, because the smallest of them is
 * the size the target can have.
 */
export function collectLiteralValues(valueText) {
	const text = valueText.trim();
	if (!text) return [];
	if (text.startsWith('{')) {
		const inner = text.slice(1, -1);
		const values = [];
		for (const entry of splitTopLevel(inner)) {
			const separator = entry.indexOf(':');
			if (separator === -1) continue;
			values.push(...collectLiteralValues(entry.slice(separator + 1)));
		}
		return values;
	}
	const literal = /^(['"])([\s\S]*)\1$/.exec(text);
	if (literal) return [literal[2]];
	if (/^-?\d+(\.\d+)?$/.test(text)) return [text];
	return [];
}

/** Split an object body at its top-level commas (pure). */
export function splitTopLevel(body) {
	const entries = [];
	let depth = 0;
	let quote = null;
	let current = '';
	for (let index = 0; index < body.length; index += 1) {
		const char = body[index];
		if (quote) {
			current += char;
			if (char === '\\') {
				current += body[index + 1] ?? '';
				index += 1;
				continue;
			}
			if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'" || char === '`') {
			quote = char;
			current += char;
			continue;
		}
		if (char === '{' || char === '[' || char === '(') depth += 1;
		if (char === '}' || char === ']' || char === ')') depth -= 1;
		if (char === ',' && depth === 0) {
			entries.push(current);
			current = '';
			continue;
		}
		current += char;
	}
	if (current.trim()) entries.push(current);
	return entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

/**
 * The style declarations of one style object (pure).
 *
 * Only the top-level keys of the object are read, and a key whose value
 * is not a literal is skipped: a nested object contributes its leaves
 * through {@link collectLiteralValues}.
 */
export function styleObjectDeclarations(objectBody, offset = 0) {
	const declarations = [];
	for (const entry of splitTopLevel(objectBody)) {
		const separator = entry.indexOf(':');
		if (separator === -1) continue;
		const key = entry
			.slice(0, separator)
			.trim()
			.replace(/^['"]|['"]$/g, '');
		const valueText = entry.slice(separator + 1).trim();
		for (const literal of collectLiteralValues(valueText)) {
			declarations.push({
				property: cssPropertyFor(key),
				key,
				value: literal,
			});
		}
	}
	if (offset) {
		for (const declaration of declarations) declaration.line = offset;
	}
	return declarations;
}

/**
 * The style declarations of one element (pure).
 *
 * Both spellings are read: the Panda `css({ … })` call and the inline
 * `style={{ … }}` object. The inline object is the one the fixture
 * specimens use, so the gate and the browser read the same declaration.
 */
export function elementStyleDeclarations(tagText) {
	const declarations = [];
	for (const match of tagText.matchAll(/\bcss\s*\(/g)) {
		const open = tagText.indexOf('{', match.index);
		if (open === -1) continue;
		const close = matchBrace(tagText, open);
		if (close === -1) continue;
		declarations.push(...styleObjectDeclarations(tagText.slice(open + 1, close)));
	}
	for (const match of tagText.matchAll(/\bstyle\s*=\s*\{\{/g)) {
		const open = match.index + match[0].length - 1;
		const close = matchBrace(tagText, open);
		if (close === -1) continue;
		declarations.push(...styleObjectDeclarations(tagText.slice(open + 1, close)));
	}
	return declarations;
}

/**
 * Resolve one style literal to CSS px (pure).
 *
 * `category` is the token scale the property resolves against. A value
 * the gate cannot decide (`auto`, `100%`, `calc(…)`, a runtime
 * expression) resolves to `null` — "not decidable here", never "small".
 */
export function resolvePx(literal, category) {
	const text = String(literal).trim();
	if (text === '') return null;
	const px = /^(-?\d+(?:\.\d+)?)px$/.exec(text);
	if (px) return Number(px[1]);
	const rem = /^(-?\d+(?:\.\d+)?)rem$/.exec(text);
	if (rem) return Number(rem[1]) * ROOT_FONT_PX;
	if (/^-?\d+(\.\d+)?$/.test(text)) {
		const table = category === 'spacing' ? SPACING : SIZES;
		const value = table[text];
		return value === undefined ? null : value;
	}
	return null;
}

/** The attribute value of an attribute, or `null` (pure). */
export function attributeValue(attributes, name) {
	const attribute = attributes.find((entry) => entry.name === name);
	if (!attribute) return null;
	if (attribute.kind === 'string' || attribute.kind === 'boolean') return attribute.value;
	const literal = /^(['"])([\s\S]*)\1$/.exec(attribute.value.trim());
	return literal ? literal[2] : null;
}

/** Whether the element carries an attribute at all (pure). */
export function hasAttribute(attributes, name) {
	return attributes.some((attribute) => attribute.name === name);
}

/** Whether the element is an interactive target (pure). */
export function isInteractiveTarget(tag, attributes) {
	if (['button', 'input', 'select', 'textarea', 'summary'].includes(tag)) return true;
	if (tag === 'a' && hasAttribute(attributes, 'href')) return true;
	const role = attributeValue(attributes, 'role');
	return role === 'button' || role === 'link' || role === 'menuitem' || role === 'checkbox';
}

/**
 * The drag affordances an element declares (pure).
 *
 * `draggable="false"` is the opposite of a drag affordance: it takes the
 * drag away. A bare `draggable` (the HTML shorthand) is `true`.
 */
export function dragAffordancesOf(attributes) {
	const affordances = [];
	for (const name of [
		'onDragStart',
		'onDragEnd',
		'onDragOver',
		'onDragEnter',
		'onDragLeave',
		'onDrop',
	]) {
		if (attributes.some((attribute) => attribute.name === name)) affordances.push(name);
	}
	const draggable = attributes.find((attribute) => attribute.name === 'draggable');
	if (draggable && !attributeValueIs(draggable, 'false')) affordances.push('draggable');
	return affordances;
}

/**
 * Whether a drag affordance has a click (or keyboard) alternative (pure).
 *
 * The alternative may be the element's own click handler, a natively
 * activatable control, or a keyboard-operable custom control.
 */
export function hasClickAlternative(tag, attributes) {
	if (attributes.some((attribute) => attribute.name === 'onClick')) return true;
	if (['button', 'input', 'select', 'textarea', 'summary'].includes(tag)) return true;
	if (tag === 'a' && hasAttribute(attributes, 'href')) return true;
	const keyboardOperable =
		attributes.some((attribute) => attribute.name === 'onKeyDown') &&
		attributes.some((attribute) => attribute.name === 'tabIndex');
	return keyboardOperable;
}

/**
 * The declared hit-area size of one target (pure).
 *
 * `height` / `width` are the smallest px the declaration allows; a
 * declaration of 0 is not a size (it declares the absence of a floor)
 * and is skipped.
 */
export function declaredSize(declarations) {
	const result = { height: null, width: null, sources: [] };
	for (const declaration of declarations) {
		const rule = SIZE_PROPERTIES[declaration.property];
		if (!rule) continue;
		const px = resolvePx(declaration.value, rule.category);
		if (px === null) continue;
		if (px === 0) continue;
		if (rule.axis === 'height' || rule.axis === 'both') {
			if (result.height === null || px < result.height) result.height = px;
		}
		if (rule.axis === 'width' || rule.axis === 'both') {
			if (result.width === null || px < result.width) result.width = px;
		}
		result.sources.push({ property: declaration.property, value: declaration.value, px });
	}
	return result;
}

/**
 * The exception a specimen (or a shipped surface) declares (pure).
 *
 * `valid` is false when the declared kind is not one of the four the
 * criterion names, or when the declaration carries no reason.
 */
export function readDeclaredException(attributes) {
	const kind = attributeValue(attributes, EXCEPTION_ATTRIBUTE);
	if (kind === null) return { kind: null, reason: null, valid: true, declared: false };
	const reason = attributeValue(attributes, REASON_ATTRIBUTE);
	const known = Object.hasOwn(EXCEPTION_KINDS, kind);
	return {
		kind,
		reason,
		valid: known && typeof reason === 'string' && reason.trim().length > 0,
		declared: true,
	};
}

/**
 * Classify one shipped target (pure).
 *
 * The verdict is one of:
 *   `undersized`  — the target declares a size below the minimum
 *   `compliant`   — the target declares a size at or above the minimum
 *   `undecided`   — the target declares no size, so the source cannot
 *                   say how big the box is (the capture decides)
 */
export function evaluateTarget({ relativePath, tag, attributes, declarations }) {
	const size = declaredSize(declarations);
	const violations = [];
	const axes = [];
	if (size.height !== null && size.height < MIN_TARGET_PX)
		axes.push({ axis: 'height', px: size.height });
	if (size.width !== null && size.width < MIN_TARGET_PX)
		axes.push({ axis: 'width', px: size.width });
	for (const axis of axes) {
		violations.push({
			rule: 'shipped-target-undersized',
			file: relativePath,
			line: null,
			wcag: WCAG.sc,
			axis: axis.axis,
			px: axis.px,
			message: `the target declares a ${axis.axis} of ${axis.px} px, below the ${MIN_TARGET_PX} px minimum of SC ${WCAG.sc}; a declared size is a claim the author made, and a claim below the minimum is a defect whether the rendered box grows afterwards or not`,
		});
	}
	const affordances = dragAffordancesOf(attributes);
	if (affordances.length > 0 && !hasClickAlternative(tag, attributes)) {
		violations.push({
			rule: 'shipped-drag-without-alternative',
			file: relativePath,
			line: null,
			wcag: WCAG.sc,
			affordances,
			message: `the target offers a drag gesture (${affordances.join(', ')}) and no click or keyboard alternative; a pointer-only operation cannot be used with a keyboard`,
		});
	}
	const verdict =
		axes.length > 0
			? 'undersized'
			: size.height === null && size.width === null
				? 'undecided'
				: 'compliant';
	return { verdict, size, violations, affordances };
}

/** The violations of one shipped source file (pure). */
export function evaluateShippedSource({ relativePath, source }) {
	const code = stripComments(source);
	const violations = [];
	const targets = [];
	for (const tag of findTags(code)) {
		const declarations = elementStyleDeclarations(tag.text);
		// The drag rule is about the OPERATION, not about the element's
		// role: a drag-only operation is usually a plain element with no
		// role at all, and that is exactly the case a pointer-only
		// keyboard user cannot reach. So every element that declares a
		// drag affordance is checked, interactive or not.
		const affordances = dragAffordancesOf(tag.attributes);
		if (affordances.length > 0 && !hasClickAlternative(tag.tag, tag.attributes)) {
			violations.push({
				rule: 'shipped-drag-without-alternative',
				file: relativePath,
				line: tag.line,
				wcag: WCAG.sc,
				affordances,
				message: `the target offers a drag gesture (${affordances.join(', ')}) and no click or keyboard alternative; a pointer-only operation cannot be used with a keyboard`,
			});
		}
		if (!isInteractiveTarget(tag.tag, tag.attributes)) continue;
		const evaluation = evaluateTarget({
			relativePath,
			tag: tag.tag,
			attributes: tag.attributes,
			declarations,
		});
		targets.push({
			tag: tag.tag,
			line: tag.line,
			verdict: evaluation.verdict,
			height: evaluation.size.height,
			width: evaluation.size.width,
		});
		for (const violation of evaluation.violations) {
			if (violation.rule === 'shipped-target-undersized') {
				violations.push({ ...violation, line: tag.line });
			}
		}
	}
	return { violations, targets };
}

/* ------------------------------------------------------------------ *
 * The fixture
 * ------------------------------------------------------------------ */

/**
 * The visible text of one element (pure).
 *
 * The text between the opening tag and its closing tag, with the JSX
 * expression containers removed, so the browser half can label a target
 * the way a reader sees it.
 */
export function labelOf(code, tag) {
	const closing = `</${tag.tag}`;
	const index = code.indexOf(closing, tag.end);
	if (index === -1) return '';
	return code
		.slice(tag.end + 1, index)
		.replace(/\{[^{}]*\}/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * The specimen a fixture file declares (pure).
 *
 * The shape is fixed by the roster: one element carries
 * `data-target-specimen`, and the targets inside it carry
 * `data-target-target`. The extractor reads the ids, the declared
 * exception, the container's spacing and each target's own style, so
 * the static half and the browser half judge the same declaration.
 */
export function describeSpecimen({ relativePath, source }) {
	const code = stripComments(source);
	const specimenAttribute = new RegExp(`${SPECIMEN_ATTRIBUTE}\\s*=\\s*["']([^"']+)["']`);
	const specimenMatch = specimenAttribute.exec(code);
	if (!specimenMatch) {
		return {
			relativePath,
			specimenId: null,
			exception: null,
			targets: [],
			gap: null,
			container: null,
		};
	}
	const containerTag = findTags(code).find((tag) =>
		tag.attributes.some((attribute) => attribute.name === SPECIMEN_ATTRIBUTE),
	);
	const containerDeclarations = containerTag ? elementStyleDeclarations(containerTag.text) : [];
	const gapDeclaration = containerDeclarations.find(
		(declaration) => SPACING_PROPERTIES[declaration.property] !== undefined,
	);
	const targets = [];
	for (const tag of findTags(code)) {
		const name = attributeValue(tag.attributes, TARGET_ATTRIBUTE);
		if (name === null) continue;
		const declarations = elementStyleDeclarations(tag.text);
		const exception = readDeclaredException(tag.attributes);
		targets.push({
			name,
			tag: tag.tag,
			label: labelOf(code, tag),
			declarations,
			size: declaredSize(declarations),
			affordances: dragAffordancesOf(tag.attributes),
			hasClickAlternative: hasClickAlternative(tag.tag, tag.attributes),
			exception,
		});
	}
	const specimenTag = containerTag;
	const exception = specimenTag
		? readDeclaredException(specimenTag.attributes)
		: { kind: null, reason: null, valid: true, declared: false };
	return {
		relativePath,
		specimenId: specimenMatch[1],
		exception,
		targets,
		gap: gapDeclaration ? resolvePx(gapDeclaration.value, 'spacing') : null,
		container: specimenTag ? specimenTag.tag.toLowerCase() : null,
	};
}

/**
 * The violations of one fixture file (pure).
 *
 * The rules are about the DECLARATION: a specimen that declares a size
 * below the minimum has to declare an exception, and the exception has
 * to be one of the four the criterion names, with a reason.
 */
export function evaluateFixtureSource({ relativePath, source }) {
	const specimen = describeSpecimen({ relativePath, source });
	const violations = [];
	if (specimen.exception.declared && !specimen.exception.valid) {
		const known = Object.hasOwn(EXCEPTION_KINDS, specimen.exception.kind);
		violations.push({
			rule: 'target-specimen-exception-invalid',
			file: relativePath,
			line: null,
			wcag: WCAG.sc,
			message: known
				? `the specimen declares the "${specimen.exception.kind}" exception without a reason; an exception nobody can check is an exception nobody reads`
				: `the specimen declares the exception "${specimen.exception.kind}", which is not one of the four SC ${WCAG.sc} names (${Object.keys(EXCEPTION_KINDS).join(', ')})`,
		});
	}
	for (const target of specimen.targets) {
		const declaredException = target.exception.declared ? target.exception : specimen.exception;
		const exceptionHonoured = declaredException.declared && declaredException.valid;
		const undersized = [];
		if (target.size.height !== null && target.size.height < MIN_TARGET_PX) {
			undersized.push({ axis: 'height', px: target.size.height });
		}
		if (target.size.width !== null && target.size.width < MIN_TARGET_PX) {
			undersized.push({ axis: 'width', px: target.size.width });
		}
		if (undersized.length > 0 && !exceptionHonoured) {
			for (const axis of undersized) {
				violations.push({
					rule: 'target-specimen-undersized',
					file: relativePath,
					line: null,
					wcag: WCAG.sc,
					axis: axis.axis,
					px: axis.px,
					message: `the specimen declares a ${axis.axis} of ${axis.px} px, below the ${MIN_TARGET_PX} px minimum of SC ${WCAG.sc}, and declares no valid exception`,
				});
			}
		}
		if (target.affordances.length > 0 && !target.hasClickAlternative) {
			violations.push({
				rule: 'target-specimen-drag-only',
				file: relativePath,
				line: null,
				wcag: WCAG.sc,
				affordances: target.affordances,
				message: `the specimen offers a drag gesture (${target.affordances.join(', ')}) and no click or keyboard alternative`,
			});
		}
	}
	return { specimen, violations };
}

/**
 * Audit the fixture FILES against the roster (pure).
 *
 * Kept pure and separate from the filesystem walk so the rules are
 * testable without a checkout — in particular the rule that a PASS
 * fixture must actually EXERCISE a rule: a pass fixture that was emptied
 * proves nothing, and a gate that still reports it as a pass is green for
 * the wrong reason.
 */
export function auditFixtureFiles(entries) {
	const violations = [];
	const rows = [];
	for (const entry of entries) {
		const { directory, relativePath, expected, evaluation, specimen } = entry;
		const found = [...new Set(evaluation.violations.map((violation) => violation.rule))];
		if (directory === 'pass') {
			if (!specimen.specimenId || specimen.targets.length === 0) {
				violations.push({
					rule: 'fixture-pass-no-specimen',
					file: relativePath,
					line: null,
					wcag: null,
					message:
						'the pass fixture declares no specimen target, so it exercises no rule; an empty pass fixture proves nothing and must not keep the gate green',
				});
			}
			if (found.length > 0) {
				violations.push({
					rule: 'fixture-pass-violation',
					file: relativePath,
					line: null,
					wcag: null,
					message: `a pass fixture reports ${found.join(', ')}; the pass state is no longer reproduced`,
				});
			}
			rows.push({
				file: relativePath,
				expected: [],
				found,
				sizeVerdict: expected.sizeVerdict,
			});
			continue;
		}
		const missing = expected.staticRules.filter((rule) => !found.includes(rule));
		const unexpected = found.filter((rule) => !expected.staticRules.includes(rule));
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
			expected: [...expected.staticRules],
			found,
			sizeVerdict: expected.sizeVerdict,
		});
	}
	return { violations, rows };
}

/**
 * Audit the fixture (pure over the filesystem).
 *
 * The fixture is read by the gate, not only by its test: a fixture that
 * stopped reproducing its defect is reported as a violation of the gate's
 * own contract rather than silently passing.
 */
export function auditFixture(repoRoot = REPO_ROOT) {
	const violations = [];
	const entries = [];
	for (const [directory, expectations] of Object.entries(FIXTURE_EXPECTATIONS)) {
		const absolute = join(repoRoot, FIXTURE_ROOT, directory);
		const present = existsSync(absolute)
			? readdirSync(absolute).filter((name) => name.endsWith('.tsx'))
			: [];
		for (const [name, expected] of Object.entries(expectations)) {
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
			const evaluation = evaluateFixtureSource({
				relativePath,
				source: readFileSync(join(absolute, name), 'utf8'),
			});
			entries.push({
				directory,
				name,
				relativePath,
				expected,
				evaluation,
				specimen: evaluation.specimen,
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

/* ------------------------------------------------------------------ *
 * The shipped source scan
 * ------------------------------------------------------------------ */

/** The shipped source root the scan walks. */
export const SHIPPED_SCAN_ROOT = 'src';

/** Every `.tsx` file under the scan root (pure over the filesystem). */
function collectTsxFiles(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectTsxFiles(path));
			continue;
		}
		if (!entry.name.endsWith('.tsx')) continue;
		files.push(path);
	}
	return files;
}

/**
 * Scan the shipped source (filesystem).
 *
 * Every file the scan left out, and every surface it covered, is
 * recorded with its reason — a green run has to show the holes it has.
 */
export function auditShippedSource(repoRoot = REPO_ROOT) {
	const violations = [];
	const excluded = [];
	const surfaces = [];
	let filesScanned = 0;
	const scanRoot = join(repoRoot, SHIPPED_SCAN_ROOT);
	if (!existsSync(scanRoot) || !statSync(scanRoot).isDirectory()) {
		throw new Error(`cannot scan the repository: ${SHIPPED_SCAN_ROOT} is not a directory`);
	}
	const inScope = new Map(SURFACES.map((surface) => [surface.file, surface]));
	for (const file of collectTsxFiles(scanRoot)) {
		const relativePath = toRepoPath(file, repoRoot);
		const surface = inScope.get(relativePath);
		if (!surface) {
			excluded.push({ file: relativePath, id: 'other-surfaces' });
			continue;
		}
		filesScanned += 1;
		const result = evaluateShippedSource({
			relativePath,
			source: readFileSync(file, 'utf8'),
		});
		surfaces.push({
			id: surface.id,
			file: relativePath,
			label: surface.label,
			targets: result.targets,
			compliant: result.targets.filter((target) => target.verdict === 'compliant').length,
			undersized: result.targets.filter((target) => target.verdict === 'undersized').length,
			undecided: result.targets.filter((target) => target.verdict === 'undecided').length,
		});
		for (const violation of result.violations) {
			violations.push(violation);
		}
	}
	for (const surface of SURFACES) {
		if (!surfaces.some((entry) => entry.file === surface.file)) {
			violations.push({
				rule: 'shipped-surface-missing',
				file: surface.file,
				line: null,
				wcag: WCAG.sc,
				message: `the surface "${surface.label}" is not in ${surface.file} any more; the scope of this gate and the shipped code have drifted apart`,
			});
		}
	}
	return { filesScanned, violations, excluded, surfaces };
}

/**
 * Scan the repository (pure over `repoRoot`).
 */
export function collectEvidence(repoRoot = REPO_ROOT) {
	const fixture = auditFixture(repoRoot);
	const shipped = auditShippedSource(repoRoot);
	return {
		shipped,
		fixture,
		violations: [...fixture.violations, ...shipped.violations],
		exceptions: SHIPPED_EXCEPTIONS,
		humanEvaluation: HUMAN_EVALUATION,
		wcag: WCAG,
	};
}

/** The human-readable report, with the two kinds of statement separated. */
export function renderGateSummary(evidence) {
	const lines = [];
	lines.push(`tap / click target size gate — Issue ${ISSUE}`);
	lines.push(
		`shipped: ${evidence.shipped.surfaces.length} surface(s) under ${SHIPPED_SCAN_ROOT}/ (${evidence.shipped.surfaces.map((surface) => surface.file).join(', ')}); fixture: ${evidence.fixture.rows.length} file(s)`,
	);
	lines.push('');
	lines.push('machine-checked:');
	for (const surface of evidence.shipped.surfaces) {
		lines.push(
			`  ${surface.undersized === 0 ? 'ok  ' : 'FAIL'} ${'shipped-target-undersized'.padEnd(32)} ${surface.label}: ${surface.targets.length} target(s), ${surface.compliant} declared at or above ${MIN_TARGET_PX} px, ${surface.undersized} below, ${surface.undecided} not decidable from the source`,
		);
	}
	const dragCount = evidence.shipped.violations.filter(
		(violation) => violation.rule === 'shipped-drag-without-alternative',
	).length;
	lines.push(
		`  ${dragCount === 0 ? 'ok  ' : 'FAIL'} ${'shipped-drag-without-alternative'.padEnd(32)} ${dragCount} drag-only operation(s) without a click or keyboard alternative`,
	);
	for (const rule of [
		'target-specimen-undersized',
		'target-specimen-exception-invalid',
		'target-specimen-drag-only',
	]) {
		const count = evidence.fixture.rows.filter((row) => row.found.includes(rule)).length;
		lines.push(`  ${'ok  '} ${rule.padEnd(32)} ${count} fixture(s) reproduce it`);
	}
	lines.push(
		`  ${evidence.fixture.violations.length === 0 ? 'ok  ' : 'FAIL'} ${'fixture'.padEnd(32)} ${evidence.fixture.rows.length} fixture file(s) reproduce the states they stand for`,
	);
	lines.push('');
	lines.push('declared exceptions (SC 2.5.8):');
	lines.push(
		`  inline          — decided by measurement: the capture reads the computed display of the box (a declared size below ${MIN_TARGET_PX} px does NOT qualify)`,
	);
	lines.push(
		'  spacing         — declared with a reason, then checked against the rendered boxes by the capture',
	);
	lines.push("  user-agent      — declared with a reason (the size is the user agent's)");
	lines.push('  essential       — declared with a reason (the presentation is essential)');
	lines.push(
		`  shipped declaration-only exceptions: ${evidence.exceptions.length} (${evidence.exceptions.length === 0 ? 'none — the shipped surfaces need none' : evidence.exceptions.map((entry) => `${entry.surface} ${entry.selector}`).join(', ')})`,
	);
	lines.push('');
	lines.push('not machine-checked (human evaluation):');
	for (const item of evidence.humanEvaluation) lines.push(`  - ${item}`);
	lines.push('');
	lines.push('out of scope (excluded from the scan, with the reason):');
	for (const exclusion of EXCLUSIONS) {
		const count = evidence.shipped.excluded.filter((entry) => entry.id === exclusion.id).length;
		if (count === 0) continue;
		lines.push(`  - ${exclusion.describe} (${count} file(s)): ${exclusion.reason}`);
	}
	lines.push('');
	lines.push('fixture expectations:');
	for (const row of evidence.fixture.rows) {
		lines.push(
			`  ${row.file} — expected=[${row.expected.join(', ')}], found=[${row.found.join(', ')}], browser verdict=${row.sizeVerdict}`,
		);
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
