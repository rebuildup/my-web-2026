#!/usr/bin/env node

/**
 * check-a11y-live-region — enforce the live-region / status-message
 * contract on the shipped surface (Issue #405).
 *
 * What this gate is for
 * ---------------------
 * WCAG 2.2 SC 4.1.3 Status Messages (level AA) asks that a status change
 * a sighted visitor sees is also programmatically determinable, so a
 * screen reader can announce it without moving focus. The mechanism is a
 * live region: `role="status"` (polite), `role="alert"` (assertive),
 * `aria-live`, and `aria-busy` to batch an update while it is in flight.
 *
 * The failure mode this gate exists to catch is the OPPOSITE of silence:
 * a region that announces too much. An `assertive` region interrupts the
 * reader mid-sentence; a region nested in another region is announced
 * twice; the same result published by two regions is two messages for one
 * event; an `aria-busy` typo turns batching off silently.
 *
 * The rules
 * ---------
 *   live-region-assertive-not-alert
 *       An element declares `aria-live="assertive"`. The repository's one
 *       assertive announcement is an error, and the spelling for that is
 *       `role="alert"` (which implies assertive). Hand-written
 *       `aria-live="assertive"` is the main cause of interruptive
 *       announcements. (SC 4.1.3)
 *   live-region-nested
 *       A live region is inside another live region. The inner change is
 *       announced by both regions — two announcements for one event.
 *       (SC 4.1.3)
 *   live-region-busy-invalid
 *       `aria-busy` is a literal that is neither `true` nor `false`. The
 *       invalid value is dropped and the batching silently stops.
 *       (SC 4.1.2)
 *   live-region-duplicate-announce
 *       Two live regions in one file publish the same expression. The same
 *       result is announced twice. (SC 4.1.3)
 *
 * Machine-checked vs. human-evaluated
 * -----------------------------------
 * This gate decides DECLARATIONS. It cannot decide whether an
 * announcement is polite enough IN PRACTICE, whether the wording is
 * useful, or what a screen reader actually says. Those stay human
 * evaluation and are printed separately, never merged into one green
 * mark.
 *
 * Exit codes: 0 = every rule passes, 1 = at least one violation,
 * 2 = the repository could not be scanned.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, lineAt, stripComments } from './_source-scan.mjs';

/** The Issue this gate belongs to. */
export const ISSUE = '#405';

/** The criteria every rule in this gate answers to. */
export const WCAG = [
	{ sc: '4.1.3', name: 'Status Messages', level: 'AA' },
	{ sc: '4.1.2', name: 'Name, Role, Value', level: 'A' },
];

/** The rule names, in report order. */
export const RULES = [
	'live-region-assertive-not-alert',
	'live-region-nested',
	'live-region-busy-invalid',
	'live-region-duplicate-announce',
];

/** The WCAG criterion each rule answers to. */
export const WCAG_BY_RULE = {
	'live-region-assertive-not-alert': '4.1.3',
	'live-region-nested': '4.1.3',
	'live-region-busy-invalid': '4.1.2',
	'live-region-duplicate-announce': '4.1.3',
};

/**
 * The ARIA roles that ARE a live region.
 *
 * `status` and `alert` imply `aria-live` (`polite` / `assertive`
 * respectively); `log`, `timer` and `marquee` are the other live roles.
 * A `role` outside this list is not a live region on its own.
 */
export const LIVE_ROLES = ['status', 'alert', 'log', 'timer', 'marquee'];

/** The legal `aria-live` values. */
export const ARIA_LIVE_VALUES = ['off', 'polite', 'assertive'];

/** Expressions that carry no message and are not a duplicate signal. */
export const TRIVIAL_EXPRESSIONS = new Set(['', 'null', 'undefined', 'true', 'false', '0', '1']);

/**
 * The scan target: the shipped JSX surface.
 *
 * Only `.tsx` is scanned — a `.ts` file cannot render a live region.
 */
export const SCAN_ROOT = 'src';
export const SCAN_SUFFIX = '.tsx';

/** What is deliberately OUT of scope, and why. */
export const EXCLUSIONS = [
	{
		id: 'test-files',
		describe: '*.test.tsx',
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
 */
export const SCOPE_NOTES = [
	{
		id: 'implicit-output-role',
		describe: 'the implicit live role of `<output>`',
		reason:
			'`<output>` carries an implicit `status` role, but this gate only reads explicit `aria-live` / `role` declarations. An `<output>` that is SILENT (no explicit attribute) is not collected as a live region here',
	},
];

/**
 * The fixture the gate actually reads.
 *
 * The fixture is not a decoration: `pass/` must produce zero violations
 * and `fail/` must produce the named rule, or the gate reports the
 * fixture as broken. A fixture that quietly stopped reproducing the
 * defect would otherwise leave a green gate proving nothing.
 */
export const FIXTURE_ROOT = 'scripts/fixtures/a11y-live-region';

/**
 * The exact fixture roster, per directory.
 *
 * `pass` — files that must produce NO violation.
 * `fail` — files that must produce exactly the named rule.
 */
export const FIXTURE_EXPECTATIONS = {
	pass: {
		'01-status-region.tsx': [],
		'02-alert-error.tsx': [],
		'03-polite-region.tsx': [],
	},
	fail: {
		'01-assertive-not-alert.tsx': ['live-region-assertive-not-alert'],
		'02-nested-regions.tsx': ['live-region-nested'],
		'03-busy-invalid.tsx': ['live-region-busy-invalid'],
		'04-duplicate-announce.tsx': ['live-region-duplicate-announce'],
	},
};

/** Things this gate deliberately does not decide. */
export const HUMAN_EVALUATION = [
	'whether an announcement is polite enough IN PRACTICE (timing, queueing, interruption)',
	'whether the announced wording tells the visitor what changed',
	'a real screen-reader pass (VoiceOver / NVDA / TalkBack) over the state transitions',
	'whether the visual state and the announced state agree',
	'whether a `role="alert"` is warranted for a given failure (urgency is a judgement)',
];

/** Whether an exclusion applies to a repo-relative path (pure). */
export function exclusionFor(relativePath) {
	if (/\.test\.tsx$/.test(relativePath)) return EXCLUSIONS[0];
	if (/\.stories\.tsx$/.test(relativePath)) return EXCLUSIONS[1];
	if (relativePath.includes('/fixtures/')) return EXCLUSIONS[2];
	if (relativePath.startsWith('src/routes/design-system/')) return EXCLUSIONS[3];
	return null;
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

/**
 * Parse one JSX opening tag's attributes (pure).
 *
 * Values are reported as written, so the caller can tell a literal from a
 * runtime expression. The parser is a reduced copy of the image-alt
 * gate's: bracing and quoting are handled, a spread is skipped.
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
		const name = text.slice(index, nameEnd).toLowerCase();
		index = nameEnd;
		let cursor = index;
		while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
		if (text[cursor] !== '=') {
			attributes.push({ name, kind: 'boolean', value: '' });
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
 * The statically known text of an attribute, or `null` when it is a
 * runtime value this gate cannot decide (pure).
 */
export function resolvedAttributeValue(attribute) {
	if (!attribute) return null;
	if (attribute.kind === 'string') return attribute.value;
	if (attribute.kind === 'boolean') return '';
	const literal = /^(['"])([\s\S]*)\1$/.exec(attribute.value.trim());
	return literal ? literal[2] : null;
}

/** The `name` attribute of a tag body, or `undefined` (pure). */
export function attributeOf(tagBody, name) {
	const wanted = name.toLowerCase();
	return parseAttributes(tagBody).find((attribute) => attribute.name === wanted);
}

/**
 * Every JSX element in a source, with its parent chain (pure).
 *
 * A minimal reader, no parser library: an opening tag is bounded by its
 * own closing `>` (a `>` inside a quoted value or a JSX expression does
 * not end it); a closing tag pops the matching element from the stack, so
 * `parent` is the containing element. Self-closing tags never enter the
 * stack.
 */
export function parseElements(code) {
	const elements = [];
	const stack = [];
	let cursor = 0;
	while (cursor < code.length) {
		const lt = code.indexOf('<', cursor);
		if (lt === -1) break;
		if (code.startsWith('<!--', lt)) {
			const close = code.indexOf('-->', lt);
			cursor = close === -1 ? code.length : close + 3;
			continue;
		}
		if (code.startsWith('</', lt)) {
			const match = /^<\/\s*([A-Za-z][A-Za-z0-9_.-]*)/.exec(code.slice(lt));
			const gt = code.indexOf('>', lt);
			cursor = gt === -1 ? code.length : gt + 1;
			if (match) {
				for (let index = stack.length - 1; index >= 0; index -= 1) {
					if (stack[index].name === match[1]) {
						stack[index].closeStart = lt;
						stack[index].closeEnd = cursor;
						stack.length = index;
						break;
					}
				}
			}
			continue;
		}
		const match = /^<([A-Za-z][A-Za-z0-9_.-]*)/.exec(code.slice(lt));
		if (!match) {
			cursor = lt + 1;
			continue;
		}
		const name = match[1];
		const end = findTagEnd(code, lt + 1);
		if (end === -1) break;
		const body = code.slice(lt + 1 + name.length, end);
		const selfClosing = /\/\s*$/.test(body);
		const element = {
			name,
			body,
			start: lt,
			end,
			line: lineAt(code, lt),
			selfClosing,
			parent: stack.length > 0 ? stack[stack.length - 1].index : null,
			closeStart: null,
			closeEnd: null,
			index: elements.length,
		};
		elements.push(element);
		if (!selfClosing) stack.push(element);
		cursor = end + 1;
	}
	return elements;
}

/** The live role an element declares, or `null` (pure). */
export function roleOf(element) {
	const value = resolvedAttributeValue(attributeOf(element.body, 'role'));
	return value !== null && LIVE_ROLES.includes(value) ? value : null;
}

/** The `aria-live` value an element declares, or `null` (pure). */
export function ariaLiveOf(element) {
	const value = resolvedAttributeValue(attributeOf(element.body, 'aria-live'));
	return value !== null && ARIA_LIVE_VALUES.includes(value) ? value : null;
}

/** Whether an element is a live region (pure). */
export function isLiveRegion(element) {
	return ariaLiveOf(element) !== null || roleOf(element) !== null;
}

/**
 * The top-level `{…}` expressions in an element's children (pure).
 *
 * These are the dynamic message slots a live region publishes. Two live
 * regions that publish the same slot are two announcements of the same
 * result.
 */
export function childExpressions(code, element) {
	if (element.selfClosing || element.closeStart === null) return [];
	const children = code.slice(element.end + 1, element.closeStart);
	const found = new Set();
	let cursor = 0;
	while (cursor < children.length) {
		const open = children.indexOf('{', cursor);
		if (open === -1) break;
		const close = matchBrace(children, open);
		if (close === -1) break;
		const expression = children.slice(open + 1, close).trim();
		if (expression.length > 0 && !TRIVIAL_EXPRESSIONS.has(expression)) found.add(expression);
		cursor = close + 1;
	}
	return [...found];
}

/**
 * Classify one source file (pure).
 *
 * Returns the live regions it declares and every rule violation. Used for
 * both a fixture and a shipped file, so the fixture proves the rules the
 * shipped scan applies.
 */
export function evaluateSource({ relativePath, source }) {
	const code = stripComments(source);
	const elements = parseElements(code);
	const liveRegions = elements.filter(isLiveRegion);
	const violations = [];

	for (const element of liveRegions) {
		if (ariaLiveOf(element) === 'assertive' && roleOf(element) !== 'alert') {
			violations.push({
				rule: 'live-region-assertive-not-alert',
				file: relativePath,
				line: element.line,
				wcag: '4.1.3',
				message: `the <${element.name}> declares aria-live="assertive" without role="alert"; an interruptive live region is the main cause of excessive announcements (use role="alert" for an error, role="status" otherwise)`,
			});
		}
	}

	const liveIndexes = new Set(liveRegions.map((element) => element.index));
	for (const element of liveRegions) {
		const ancestors = [];
		let parent = element.parent;
		while (parent !== null) {
			ancestors.push(parent);
			parent = elements[parent].parent;
		}
		const nestedIn = ancestors.find((index) => liveIndexes.has(index));
		if (nestedIn !== undefined) {
			violations.push({
				rule: 'live-region-nested',
				file: relativePath,
				line: element.line,
				wcag: '4.1.3',
				message: `the <${element.name}> live region is inside the <${elements[nestedIn].name}> live region at line ${elements[nestedIn].line}; an inner change is announced by both regions`,
			});
		}
	}

	for (const element of elements) {
		const busy = attributeOf(element.body, 'aria-busy');
		if (!busy) continue;
		const value = resolvedAttributeValue(busy);
		if (value === null) continue;
		if (value !== 'true' && value !== 'false') {
			violations.push({
				rule: 'live-region-busy-invalid',
				file: relativePath,
				line: element.line,
				wcag: '4.1.2',
				message: `the <${element.name}> declares aria-busy="${value}", which is not a boolean; the invalid value is dropped and batching stops silently`,
			});
		}
	}

	const expressionOwner = new Map();
	for (const element of liveRegions) {
		for (const expression of childExpressions(code, element)) {
			if (!expressionOwner.has(expression)) expressionOwner.set(expression, []);
			expressionOwner.get(expression).push(element);
		}
	}
	for (const [expression, owners] of expressionOwner) {
		if (owners.length < 2) continue;
		const lines = owners.map((element) => element.line).join(', ');
		violations.push({
			rule: 'live-region-duplicate-announce',
			file: relativePath,
			line: owners[1].line,
			wcag: '4.1.3',
			message: `the expression \`{${expression}}\` is published by ${owners.length} live regions (lines ${lines}); the same result is announced more than once`,
		});
	}

	return {
		liveRegions: liveRegions.map((element) => ({
			name: element.name,
			line: element.line,
			role: roleOf(element),
			ariaLive: ariaLiveOf(element),
			busy: resolvedAttributeValue(attributeOf(element.body, 'aria-busy')),
		})),
		violations,
	};
}

/**
 * Audit the fixture FILES against the roster (pure), mirroring the other
 * a11y gates.
 */
export function auditFixtureFiles(entries) {
	const violations = [];
	const rows = [];
	for (const entry of entries) {
		const { directory, relativePath, expectedRules, evaluation, regionCount } = entry;
		if (directory === 'pass') {
			if (regionCount === 0) {
				violations.push({
					rule: 'fixture-pass-no-region',
					file: relativePath,
					line: null,
					wcag: null,
					message:
						'the pass fixture declares no live region at all, so it exercises no rule; an empty pass fixture proves nothing and must not keep the gate green',
				});
			}
			if (evaluation.violations.length > 0) {
				violations.push({
					rule: 'fixture-pass-violation',
					file: relativePath,
					line: evaluation.violations[0].line ?? null,
					wcag: null,
					message: `a pass fixture reports ${evaluation.violations.map((violation) => violation.rule).join(', ')}; the pass state is no longer reproduced`,
				});
			}
			rows.push({
				file: relativePath,
				expected: [],
				found: evaluation.violations.map((violation) => violation.rule),
				regions: regionCount,
			});
			continue;
		}
		const found = evaluation.violations.map((violation) => violation.rule);
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
		rows.push({ file: relativePath, expected: [...expectedRules], found, regions: regionCount });
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
			const evaluation = evaluateSource({
				relativePath,
				source: readFileSync(join(absolute, name), 'utf8'),
			});
			entries.push({
				directory,
				name,
				relativePath,
				expectedRules,
				evaluation,
				regionCount: evaluation.liveRegions.length,
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

/** Every shipped `.tsx` file under a directory (pure over the filesystem). */
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
 * Scan the shipped surface (pure over `repoRoot`).
 *
 * `filesScanned` counts the shipped `.tsx` files the rules were applied
 * to; `excluded` records every file that was deliberately left out and
 * under which reason.
 */
export function scanShippedSource(repoRoot = REPO_ROOT) {
	const violations = [];
	const excluded = [];
	const liveRegions = [];
	let filesScanned = 0;
	const scanRoot = join(repoRoot, SCAN_ROOT);
	if (!existsSync(scanRoot)) {
		throw new Error(`cannot scan the repository: ${SCAN_ROOT} is not a directory`);
	}
	for (const file of collectTsxFiles(scanRoot)) {
		const relativePath = file.slice(repoRoot.length + 1);
		const exclusion = exclusionFor(relativePath);
		if (exclusion) {
			excluded.push({ file: relativePath, reason: exclusion.id });
			continue;
		}
		filesScanned += 1;
		const result = evaluateSource({ relativePath, source: readFileSync(file, 'utf8') });
		violations.push(...result.violations);
		liveRegions.push(...result.liveRegions.map((region) => ({ file: relativePath, ...region })));
	}
	return { filesScanned, liveRegions, violations, excluded };
}

/**
 * Scan the repository (pure over `repoRoot`).
 */
export function collectEvidence(repoRoot = REPO_ROOT) {
	const fixture = auditFixture(repoRoot);
	const shipped = scanShippedSource(repoRoot);
	return {
		shipped,
		fixture,
		violations: [...shipped.violations, ...fixture.violations],
		humanEvaluation: HUMAN_EVALUATION,
		wcag: WCAG,
	};
}

/** The human-readable report, with the two kinds of statement separated. */
export function renderGateSummary(evidence) {
	const lines = [];
	lines.push(`live region gate — Issue ${ISSUE}`);
	lines.push(
		`scanned ${evidence.shipped.filesScanned} shipped .tsx file(s) under ${SCAN_ROOT}/, ${evidence.shipped.liveRegions.length} live region(s); fixture: ${evidence.fixture.rows.length} file(s)`,
	);
	lines.push('');
	lines.push('machine-checked:');
	for (const rule of RULES) {
		const shippedCount = evidence.shipped.violations.filter((entry) => entry.rule === rule).length;
		lines.push(
			`  ${shippedCount === 0 ? 'ok  ' : 'FAIL'} ${rule.padEnd(34)} ${shippedCount} shipped violation(s) (SC ${WCAG_BY_RULE[rule]})`,
		);
	}
	lines.push(
		`  ${evidence.fixture.violations.length === 0 ? 'ok  ' : 'FAIL'} ${'fixture'.padEnd(34)} ${evidence.fixture.rows.length} fixture file(s) reproduce the states they stand for`,
	);
	lines.push('');
	lines.push('live regions in the shipped surface:');
	for (const region of evidence.shipped.liveRegions) {
		const role = region.role ?? '-';
		const ariaLive = region.ariaLive ?? '-';
		lines.push(
			`  ${region.file}:${region.line} <${region.name}> role=${role} aria-live=${ariaLive} aria-busy=${region.busy ?? '-'}`,
		);
	}
	lines.push('');
	lines.push('not machine-checked (human evaluation):');
	for (const item of evidence.humanEvaluation) lines.push(`  - ${item}`);
	lines.push('');
	lines.push('out of scope (excluded from the shipped scan, with the reason):');
	for (const exclusion of EXCLUSIONS) {
		const count = evidence.shipped.excluded.filter((entry) => entry.reason === exclusion.id).length;
		lines.push(`  - ${exclusion.describe} (${count} file(s)): ${exclusion.reason}`);
	}
	for (const note of SCOPE_NOTES) {
		lines.push(`  - ${note.describe}: ${note.reason}`);
	}
	lines.push('');
	lines.push('fixture expectations:');
	for (const row of evidence.fixture.rows) {
		lines.push(
			`  ${row.file} — regions=${row.regions}, expected=[${row.expected.join(', ')}], found=[${row.found.join(', ')}]`,
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
