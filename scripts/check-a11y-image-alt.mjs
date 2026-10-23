#!/usr/bin/env node

/**
 * check-a11y-image-alt — enforce the image alt / decorative-image contract on
 * the shipped surface (Issue #397).
 *
 * What this gate is for
 * ---------------------
 * WCAG 2.2 SC 1.1.1 Non-text Content (level A) asks two different things of
 * the two kinds of image this platform ships: an image that carries meaning
 * carries an `alt` that says what it carries, and an image that carries none
 * is DECLARED decorative. Which image is which is currently a reader's
 * memory; this gate moves that decision into the source, so an `<img>` that
 * stops saying what it is fails a fast gate instead of a screen-reader
 * session nobody runs.
 *
 * The rules
 * ---------
 *   img-missing-alt
 *       The `<img>` declares no `alt` attribute at all. A reader who cannot
 *       see the image gets nothing — not even the knowledge that there was
 *       something there.
 *   img-empty-alt-not-decorative
 *       `alt=""` is a decorative DECLARATION, but nothing says the image is
 *       decorative. The declaration is therefore unverifiable: the next
 *       editor cannot tell "this image is decoration" from "the author
 *       forgot the alt text".
 *   img-alt-blank
 *       `alt=" "` is neither a description nor a decorative declaration. It
 *       reads as an empty label, so it fails the same way a missing alt does
 *       while looking like it was answered.
 *   img-alt-empty
 *       `alt=""` WITH a decorative mark — the intended decorative case. This
 *       is a PASS, and it is printed as `ok` rather than silently dropped,
 *       so a reader of the report can see that the decorative case was
 *       decided and not merely not mentioned.
 *
 * `DECORATIVE_MARKS` is the ONE definition of "this image is decorative".
 * The fixture, the gate and the verification document all read it; there is
 * no second list to drift.
 *
 * Two holes this gate refuses to leave open (cold review, Issue #397)
 * ----------------------------------------------------------------------
 *   1. A VALUE-FREE decorative mark is not enough. `data-decorative` only
 *      counts as a mark when its value is `true` (or it carries no value
 *      at all). `data-decorative={false}` says "NOT decorative", so it must
 *      not be able to turn an empty alt into a pass.
 *   2. An alt that is statically ABSENT is not a dynamic alt. React renders
 *      `alt={undefined}`, `alt={null}` and `alt={false}` as no `alt`
 *      attribute at all, so those three expressions are decided here: they
 *      are `img-missing-alt`, exactly like an image with no `alt`.
 *      Everything else that is an expression (`alt={media.alt}`,
 *      `alt={cond ? 'a' : 'b'}`) is decided at runtime and stays
 *      `dynamic-alt` — a pass this gate reports as "not decidable here",
 *      never as "checked".
 *
 * Machine-checked vs. human-evaluated
 * -----------------------------------
 * This gate decides ATTRIBUTES: whether an `alt` exists, whether it is
 * empty, and whether a decorative mark accompanies an empty alt. It cannot
 * decide whether the alt text is a GOOD description of the image, whether
 * the image is really decorative, or how a screen reader announces it. Those
 * stay human evaluation and are printed separately, never merged into one
 * green mark.
 *
 * Exit codes: 0 = every rule passes, 1 = at least one violation,
 * 2 = the repository could not be scanned.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, lineAt, stripComments, toRepoPath } from './_source-scan.mjs';

/** The criterion every rule in this gate answers to. */
export const WCAG = { sc: '1.1.1', name: 'Non-text Content', level: 'A' };

/** The rule names, in report order. */
export const RULES = [
	'img-missing-alt',
	'img-empty-alt-not-decorative',
	'img-alt-blank',
	'img-alt-empty',
];

/**
 * The one definition of "this image is decorative".
 *
 * A mark is an attribute that says the image carries no information of its
 * own. `aria-hidden="true"` removes it from the accessibility tree,
 * `role="presentation"` removes its semantics, and `data-decorative` is the
 * repository's own hook for a surface that wants the fact in the markup.
 *
 * A mark that carries a value counts ONLY when that value is `true`:
 * `data-decorative={false}` is the author saying "this image is NOT
 * decorative", and it must not be able to turn an empty alt into a pass. A
 * value-free `data-decorative` is the `true` shorthand and counts.
 */
export const DECORATIVE_MARKS = [
	{
		id: 'aria-hidden',
		describe: 'aria-hidden="true"',
		matches: (attributes) =>
			attributes.some(
				(attribute) => attribute.name === 'aria-hidden' && attributeValueIs(attribute, 'true'),
			),
	},
	{
		id: 'role',
		describe: 'role="presentation"',
		matches: (attributes) =>
			attributes.some(
				(attribute) =>
					attribute.name === 'role' &&
					(attributeValueIs(attribute, 'presentation') || attributeValueIs(attribute, 'none')),
			),
	},
	{
		id: 'data-decorative',
		describe: 'data-decorative (value true)',
		matches: (attributes) =>
			attributes.some(
				(attribute) => attribute.name === 'data-decorative' && attributeValueIs(attribute, 'true'),
			),
	},
];

/**
 * Expressions that are statically "no alt at all".
 *
 * React drops the attribute for these three values, so the rendered
 * document has no `alt` — the same fact as an image that never declared
 * one. They are decided here rather than waved through as dynamic.
 */
export const STATIC_ABSENT_ALT_VALUES = ['undefined', 'null', 'false'];

/**
 * The scan target: the shipped JSX surface.
 *
 * Only `.tsx` is scanned — a `.ts` file cannot render an `<img>`.
 */
export const SCAN_ROOT = 'src';
export const SCAN_SUFFIX = '.tsx';

/**
 * What is deliberately OUT of scope, and why.
 *
 * The exclusions are printed with the report: an image nobody scans is a
 * hole in the contract, so a reader has to be able to see where the holes
 * are and what justifies them.
 */
export const EXCLUSIONS = [
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
 * The fixture the gate actually reads.
 *
 * The fixture is not a decoration: `pass/` must produce zero violations and
 * `fail/` must produce the named rule, or the gate reports the fixture as
 * broken. A fixture that quietly stopped reproducing the defect would
 * otherwise leave a green gate proving nothing.
 */
export const FIXTURE_ROOT = 'scripts/fixtures/a11y-image-alt';

/**
 * The exact fixture roster, per directory.
 *
 * `pass` — files that must produce NO violation.
 * `fail` — files that must produce exactly the named rule.
 */
export const FIXTURE_EXPECTATIONS = {
	pass: {
		'meaningful-alt.tsx': [],
		'decorative-aria-hidden.tsx': [],
		'decorative-role-presentation.tsx': [],
		'decorative-data-decorative.tsx': [],
		'decorative-data-decorative-true.tsx': [],
	},
	fail: {
		'missing-alt.tsx': ['img-missing-alt'],
		'empty-alt-without-mark.tsx': ['img-empty-alt-not-decorative'],
		'blank-alt.tsx': ['img-alt-blank'],
		'alt-undefined.tsx': ['img-missing-alt'],
		'alt-null.tsx': ['img-missing-alt'],
		'alt-false.tsx': ['img-missing-alt'],
		'data-decorative-false.tsx': ['img-empty-alt-not-decorative'],
	},
};

/**
 * Things this gate deliberately does not decide. Printed with the report so
 * a green run is never mistaken for "accessible".
 */
export const HUMAN_EVALUATION = [
	'whether an alt text actually describes what the image shows',
	'whether an image marked decorative really carries no information of its own',
	'whether a meaningful image needs a longer description than its alt',
	'a real screen-reader pass (VoiceOver / NVDA) announcing each image as intended',
	'whether the visual order of the images matches the reading order',
];

/** Whether an exclusion applies to a repo-relative path (pure). */
export function exclusionFor(relativePath) {
	if (/\.test\.tsx$/.test(relativePath)) return EXCLUSIONS[0];
	if (/\.stories\.tsx$/.test(relativePath)) return EXCLUSIONS[1];
	if (relativePath.includes('/fixtures/')) return EXCLUSIONS[2];
	if (relativePath.startsWith('src/routes/design-system/')) return EXCLUSIONS[3];
	return null;
}

/** The value of an attribute, when it is statically known (pure). */
export function attributeValueIs(attribute, expected) {
	if (attribute.kind === 'string') return attribute.value === expected;
	if (attribute.kind === 'boolean') return attribute.value === expected;
	// An expression: `{true}` is statically known, `{'presentation'}` is a
	// string literal, anything else is a runtime value.
	const expression = attribute.value.trim();
	if (expression === expected) return true;
	const literal = /^(['"])([\s\S]*)\1$/.exec(expression);
	return literal !== null && literal[2] === expected;
}

/**
 * The statically known alt text, or `null` when it is a runtime value.
 *
 * `null` means "this gate cannot decide": the alt is an expression, so
 * whether it is empty depends on data the source does not contain. The
 * report says so instead of pretending the image was checked. The three
 * statically absent values are NOT in this case — they are decided before
 * this function is reached (see {@link evaluateImage}).
 */
export function literalAltValue(attribute) {
	if (attribute.kind === 'string') return attribute.value;
	if (attribute.kind === 'expression') {
		const literal = /^(['"])([\s\S]*)\1$/.exec(attribute.value.trim());
		if (literal) return literal[2];
	}
	return null;
}

/**
 * The expression text of an alt attribute, when it is one (pure).
 *
 * `null` when the attribute is a literal or a value-free shorthand.
 */
export function altExpressionText(attribute) {
	if (attribute.kind !== 'expression') return null;
	return attribute.value.trim();
}

/**
 * Classify one image element (pure).
 *
 * `verdict` is one of:
 *   `missing-alt`  — no `alt` attribute (violation)
 *   `blank-alt`    — `alt` is whitespace only (violation)
 *   `decorative`   — `alt=""` with a decorative mark (pass)
 *   `unmarked-empty` — `alt=""` without a decorative mark (violation)
 *   `described`    — a non-empty alt (pass)
 *   `dynamic-alt`  — an alt whose value is a runtime expression (not decidable)
 */
export function evaluateImage(attributes) {
	const altAttribute = attributes.find((attribute) => attribute.name === 'alt');
	const decorativeMarks = DECORATIVE_MARKS.filter((mark) => mark.matches(attributes)).map(
		(mark) => mark.id,
	);
	if (!altAttribute) {
		return { verdict: 'missing-alt', alt: null, decorativeMarks, absentValue: null };
	}
	// React renders `alt={undefined}` / `alt={null}` / `alt={false}` as no
	// `alt` attribute at all, so these three are statically "the alt is
	// missing" — not a runtime value this gate has to wait for.
	const expression = altExpressionText(altAttribute);
	if (expression !== null && STATIC_ABSENT_ALT_VALUES.includes(expression)) {
		return { verdict: 'missing-alt', alt: null, decorativeMarks, absentValue: expression };
	}
	const literal = literalAltValue(altAttribute);
	if (literal === null) {
		return { verdict: 'dynamic-alt', alt: null, decorativeMarks, absentValue: null };
	}
	if (literal.trim() === '') {
		if (literal === '') {
			return {
				verdict: decorativeMarks.length > 0 ? 'decorative' : 'unmarked-empty',
				alt: literal,
				decorativeMarks,
				absentValue: null,
			};
		}
		return { verdict: 'blank-alt', alt: literal, decorativeMarks, absentValue: null };
	}
	return { verdict: 'described', alt: literal, decorativeMarks, absentValue: null };
}

/** The rule a verdict is reported under, or `null` for a pass. */
export function ruleForVerdict(verdict) {
	switch (verdict) {
		case 'missing-alt':
			return 'img-missing-alt';
		case 'blank-alt':
			return 'img-alt-blank';
		case 'unmarked-empty':
			return 'img-empty-alt-not-decorative';
		default:
			return null;
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

/**
 * Parse the attributes of one JSX opening tag (pure).
 *
 * `text` is the tag body between `<img` and the closing `>`. Values are
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
 * Every `<img>` opening tag in a source, with its attribute text (pure).
 *
 * The element is bounded by its own closing `>`: a `>` inside a quoted
 * attribute value or a JSX expression does not end the tag.
 */
export function findImageTags(code) {
	const tags = [];
	let cursor = 0;
	while (cursor < code.length) {
		const start = code.indexOf('<img', cursor);
		if (start === -1) break;
		const after = code[start + 4];
		if (after !== undefined && !/[\s/>]/.test(after)) {
			cursor = start + 4;
			continue;
		}
		const end = findTagEnd(code, start + 4);
		if (end === -1) break;
		tags.push({
			index: start,
			line: lineAt(code, start),
			attributes: parseAttributes(code.slice(start + 4, end)),
		});
		cursor = end + 1;
	}
	return tags;
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

/**
 * The violations of one source file (pure).
 *
 * Comments are removed first, so an `<img>` named in a doc comment is
 * documentation rather than a violation.
 */
export function scanViolationsInFile({ relativePath, source }) {
	const code = stripComments(source);
	const violations = [];
	const images = [];
	for (const tag of findImageTags(code)) {
		const evaluation = evaluateImage(tag.attributes);
		images.push({ line: tag.line, ...evaluation });
		const rule = ruleForVerdict(evaluation.verdict);
		if (rule === null) continue;
		violations.push({
			rule,
			file: relativePath,
			line: tag.line,
			wcag: WCAG.sc,
			message: messageFor(evaluation),
		});
	}
	return { violations, images };
}

/** The short reason a violation is reported (pure). */
export function messageFor(evaluation) {
	switch (evaluation.verdict) {
		case 'missing-alt':
			return evaluation.absentValue
				? `alt={${evaluation.absentValue}} renders no alt attribute at all: a reader who cannot see the image gets nothing — give it the alt the image carries, or declare it decorative`
				: 'no alt attribute: a reader who cannot see the image gets nothing at all — give it the alt the image carries, or declare it decorative';
		case 'blank-alt':
			return 'alt is blank: it is neither a description nor a decorative declaration — use alt="" with a decorative mark, or describe the image';
		case 'unmarked-empty':
			return 'alt="" declares the image decorative but nothing says so — add aria-hidden="true", role="presentation" or data-decorative (with a true value)';
		default:
			return 'unreachable';
	}
}

/** Every `.tsx` file under a directory (pure over the filesystem). */
function collectTsxFiles(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectTsxFiles(path));
			continue;
		}
		if (!entry.name.endsWith(SCAN_SUFFIX)) continue;
		files.push(path);
	}
	return files;
}

/**
 * Audit the fixture FILES against the roster (pure).
 *
 * `entries` is one record per fixture file:
 *   { directory: 'pass' | 'fail', name, relativePath, expectedRules,
 *     foundRules, imageCount }
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
		const { directory, relativePath, expectedRules, foundRules, imageCount } = entry;
		if (directory === 'pass') {
			if (imageCount === 0) {
				violations.push({
					rule: 'fixture-pass-no-image',
					file: relativePath,
					line: null,
					wcag: WCAG.sc,
					message:
						'the pass fixture holds no <img> at all, so it exercises no rule; an empty pass fixture proves nothing and must not keep the gate green',
				});
			}
			if (foundRules.length > 0) {
				violations.push({
					rule: 'fixture-pass-violation',
					file: relativePath,
					line: foundRules[0].line ?? null,
					wcag: WCAG.sc,
					message: `a pass fixture reports ${foundRules.map((rule) => rule.rule).join(', ')}; the pass state is no longer reproduced`,
				});
			}
			rows.push({
				file: relativePath,
				expected: [],
				found: foundRules.map((rule) => rule.rule),
				images: imageCount,
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
				wcag: WCAG.sc,
				message: `the fail fixture no longer reports ${missing.join(', ')}; the defect it reproduces is not detected any more`,
			});
		}
		if (unexpected.length > 0) {
			violations.push({
				rule: 'fixture-fail-unexpected',
				file: relativePath,
				line: null,
				wcag: WCAG.sc,
				message: `the fail fixture reports ${unexpected.join(', ')}, which it does not stand for`,
			});
		}
		rows.push({ file: relativePath, expected: [...expectedRules], found, images: imageCount });
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
			const { violations: found, images } = scanViolationsInFile({
				relativePath,
				source: readFileSync(join(absolute, name), 'utf8'),
			});
			entries.push({
				directory,
				name,
				relativePath,
				expectedRules,
				foundRules: found,
				imageCount: images.length,
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
 *
 * `filesScanned` counts the shipped `.tsx` files the rules were applied to;
 * `excluded` records every file that was deliberately left out and under
 * which reason.
 */
export function collectEvidence(repoRoot = REPO_ROOT) {
	const violations = [];
	const excluded = [];
	const images = [];
	let filesScanned = 0;
	const scanRoot = join(repoRoot, SCAN_ROOT);
	if (!existsSync(scanRoot) || !statSync(scanRoot).isDirectory()) {
		throw new Error(`cannot scan the repository: ${SCAN_ROOT} is not a directory`);
	}
	for (const file of collectTsxFiles(scanRoot)) {
		const relativePath = toRepoPath(file, repoRoot);
		const exclusion = exclusionFor(relativePath);
		if (exclusion) {
			excluded.push({ file: relativePath, reason: exclusion.id });
			continue;
		}
		filesScanned += 1;
		const result = scanViolationsInFile({
			relativePath,
			source: readFileSync(file, 'utf8'),
		});
		violations.push(...result.violations);
		images.push(...result.images.map((image) => ({ file: relativePath, ...image })));
	}
	const fixture = auditFixture(repoRoot);
	violations.push(...fixture.violations);
	return {
		filesScanned,
		imagesScanned: images.length,
		violations,
		images,
		excluded,
		fixture,
		humanEvaluation: HUMAN_EVALUATION,
		wcag: WCAG,
	};
}

/** The human-readable report, with the two kinds of statement separated. */
export function renderGateSummary(evidence) {
	const lines = [];
	lines.push('image alt / decorative-image gate — Issue #397');
	lines.push(
		`scanned ${evidence.filesScanned} shipped .tsx file(s) under ${SCAN_ROOT}/, ${evidence.imagesScanned} image(s)`,
	);
	lines.push('');
	lines.push('machine-checked:');
	const counted = (verdict) => evidence.images.filter((image) => image.verdict === verdict).length;
	lines.push(
		`  ${counted('missing-alt') === 0 ? 'ok  ' : 'FAIL'} ${'img-missing-alt'.padEnd(28)} every <img> declares an alt attribute (SC ${WCAG.sc} ${WCAG.level})`,
	);
	lines.push(
		`  ${counted('unmarked-empty') === 0 ? 'ok  ' : 'FAIL'} ${'img-empty-alt-not-decorative'.padEnd(28)} every alt="" carries a decorative mark`,
	);
	lines.push(
		`  ${counted('blank-alt') === 0 ? 'ok  ' : 'FAIL'} ${'img-alt-blank'.padEnd(28)} no alt is whitespace only`,
	);
	lines.push(
		`  ${'ok  '} ${'img-alt-empty'.padEnd(28)} ${counted('decorative')} image(s) declared decorative (alt="" + a decorative mark)`,
	);
	lines.push(
		`  ${'ok  '} ${'dynamic-alt'.padEnd(28)} ${counted('dynamic-alt')} image(s) carry an alt whose value is a runtime expression (not statically decidable)`,
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
