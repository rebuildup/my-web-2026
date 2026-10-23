#!/usr/bin/env node

/**
 * check-a11y-reflow — enforce the text-reflow contract on the shipped
 * surface and on the reflow fixture (Issue #400).
 *
 * What this gate is for
 * ---------------------
 * WCAG 2.2 asks two related things of a text surface:
 *
 *   - SC 1.4.10 Reflow (level AA): content that scrolls vertically does
 *     not require scrolling in two dimensions at a width equivalent to
 *     320 CSS px (the 400% zoom viewport). A long unbreakable run — a
 *     URL, a long identifier, an expanded pseudo-locale word — is what
 *     breaks that promise, because the line breaker has no opportunity
 *     to wrap it and the widest token becomes the minimum content width.
 *   - SC 1.4.4 Resize Text (level AA): text can be enlarged to 200%
 *     without loss of content or functionality.
 *
 * This gate is the STATIC half. It decides two things:
 *
 *   1. the shipped base stylesheet carries the wrap floor that lets an
 *      unbreakable run break at all (`reflow-wrap-floor-missing`); and
 *   2. each reflow fixture reproduces the state it claims — a specimen
 *      that injects unbreakable content either declares its break
 *      boundary or is reported (`reflow-specimen-without-break`), a
 *      specimen with a fixed width wider than the 320 px budget is
 *      reported (`reflow-specimen-fixed-width`), and a specimen that
 *      forbids wrapping is reported (`reflow-specimen-nowrap`).
 *
 * The browser half of the same evidence is
 * `scripts/capture-a11y-reflow.mjs`, which renders the same specimen
 * kinds in Chromium at 320 px and at 200% text and measures
 * `scrollWidth > clientWidth`. Neither half substitutes for the other:
 * the gate reads the source, the capture reads the rendered box.
 *
 * The rules
 * ---------
 *   reflow-wrap-floor-missing
 *       The shipped `:where(body)` rule declares no break boundary, so
 *       an unbreakable run has nowhere to break. (SC 1.4.10)
 *   reflow-specimen-without-break
 *       A fixture specimen injects unbreakable content but declares no
 *       break boundary for it. (SC 1.4.10)
 *   reflow-specimen-fixed-width
 *       A fixture specimen declares a `width` / `min-width` in px wider
 *       than the 320 px reflow budget, so the box cannot fit. (SC 1.4.10)
 *   reflow-specimen-nowrap
 *       A fixture specimen injects unbreakable content while forbidding
 *       wrapping (`white-space: nowrap`), so no break declaration can
 *       help it. (SC 1.4.10)
 *
 * What "break boundary" means is defined once, in
 * {@link BREAK_DECLARATIONS}: `overflow-wrap: anywhere` /
 * `overflow-wrap: break-word` / `word-break: break-word` /
 * `word-break: break-all`. The base stylesheet, the fixtures and the
 * browser harness all read that one list, so there is no second copy to
 * drift.
 *
 * Machine-checked vs. human-evaluated
 * -----------------------------------
 * This gate decides DECLARATIONS: whether the break floor exists, and
 * whether a specimen carries the boundary it claims. It cannot decide
 * whether the rendered page actually fits (the capture does that), how
 * a broken URL reads, whether a hyphenation dictionary would be better,
 * or how the reflowed page feels to a reader. Those stay human
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
export const ISSUE = '#400';

/**
 * The criteria every rule in this gate answers to.
 *
 * `1.4.10` is the static reflow rule; `1.4.4` is covered by the capture
 * (200% text) and is named here so the WCAG mapping is stated, not
 * implied.
 */
export const WCAG = [
	{ sc: '1.4.10', name: 'Reflow', level: 'AA' },
	{ sc: '1.4.4', name: 'Resize Text', level: 'AA' },
];

/** The rule names, in report order. */
export const RULES = [
	'reflow-wrap-floor-missing',
	'reflow-specimen-without-break',
	'reflow-specimen-fixed-width',
	'reflow-specimen-nowrap',
];

/** The WCAG criterion each rule answers to. */
export const WCAG_BY_RULE = {
	'reflow-wrap-floor-missing': '1.4.10',
	'reflow-specimen-without-break': '1.4.10',
	'reflow-specimen-fixed-width': '1.4.10',
	'reflow-specimen-nowrap': '1.4.10',
};

/**
 * The reflow budget: 320 CSS px is the width a 1280 px viewport reduces
 * to at 400% zoom (WCAG 2.2 SC 1.4.10). A box wider than this cannot
 * reflow.
 */
export const REFLOW_BUDGET_PX = 320;

/**
 * The kinds of unbreakable content the fixture injects.
 *
 * Each kind is a token the line breaker cannot split at whitespace, so a
 * surface that renders one and does not allow an emergency break forces
 * a horizontal scrollbar at the budget width.
 */
export const UNBREAKABLE_KINDS = ['long-word', 'long-url', 'unbroken-run', 'pseudo-locale'];

/**
 * The one definition of "this content is allowed to break".
 *
 * The value may be written as a React style key (`overflowWrap:
 * 'anywhere'`), a Panda style key (same), or a CSS declaration
 * (`overflow-wrap: anywhere`). Whitespace is irrelevant; the value is
 * what counts.
 */
export const BREAK_DECLARATIONS = [
	{ id: 'overflow-wrap-anywhere', property: 'overflow-wrap', value: 'anywhere' },
	{ id: 'overflow-wrap-break-word', property: 'overflow-wrap', value: 'break-word' },
	{ id: 'word-break-break-word', property: 'word-break', value: 'break-word' },
	{ id: 'word-break-break-all', property: 'word-break', value: 'break-all' },
];

/**
 * The shipped base stylesheet, and the selector whose block must carry
 * the wrap floor.
 *
 * The floor is inherited (`overflow-wrap` is an inherited property), so
 * one declaration on the body reach every text surface.
 */
export const BASE_STYLES_PATH = 'src/styles.css';
export const BASE_SELECTOR = ':where(body)';

/**
 * The fixture the gate actually reads.
 *
 * The fixture is not a decoration: `pass/` must produce zero violations
 * and `fail/` must produce the named rule, or the gate reports the
 * fixture as broken. A fixture that quietly stopped reproducing the
 * defect would otherwise leave a green gate proving nothing.
 */
export const FIXTURE_ROOT = 'scripts/fixtures/a11y-reflow';

/**
 * The exact fixture roster, per directory.
 *
 * `pass` — files that must produce NO violation.
 * `fail` — files that must produce exactly the named rule.
 */
export const FIXTURE_EXPECTATIONS = {
	pass: {
		'01-long-word.tsx': [],
		'02-long-url.tsx': [],
		'03-pseudo-locale.tsx': [],
	},
	fail: {
		'01-without-break.tsx': ['reflow-specimen-without-break'],
		'02-fixed-width.tsx': ['reflow-specimen-fixed-width'],
		'03-nowrap.tsx': ['reflow-specimen-nowrap'],
	},
};

/** Things this gate deliberately does not decide. */
export const HUMAN_EVALUATION = [
	'whether a broken URL or identifier still reads correctly',
	'whether `overflow-wrap: anywhere` breaks a word a reader needed whole',
	'whether a hyphenation dictionary would reflow a given language better',
	'how the reflowed page feels at 320 px with 200% text',
	'a real browser zoom / text-only-zoom pass on a physical device',
];

/** Whether an exclusion applies to a repo-relative path (unused today). */
export function exclusionFor(relativePath) {
	if (/\.test\.tsx$/.test(relativePath)) return 'test source — asserts, does not render a surface';
	if (/\.stories\.tsx$/.test(relativePath))
		return 'story — a preview harness, not a shipped surface';
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

/**
 * The body of the first CSS rule whose selector matches `selector` (pure).
 *
 * `null` when the block is absent. Used for the base floor: the shipped
 * `:where(body)` rule is the one that has to carry the declaration.
 */
export function findCssBlock(source, selector) {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = new RegExp(`${escaped}\\s*\\{`).exec(source);
	if (!match) return null;
	const open = source.indexOf('{', match.index);
	const close = matchBrace(source, open);
	if (close === -1) return null;
	return {
		body: source.slice(open + 1, close),
		index: match.index,
		line: lineAt(source, match.index),
	};
}

/**
 * The property names (and their React / Panda spellings) the gate reads.
 *
 * Reading a fixed vocabulary instead of a generic `property: value`
 * scanner matters: a JSX attribute such as `style={{ … }}` contains an
 * `=`, and a generic scanner swallows the object literal that follows it.
 */
export const REFLOW_PROPERTIES = {
	'overflow-wrap': ['overflow-wrap', 'overflowWrap'],
	'word-break': ['word-break', 'wordBreak'],
	'white-space': ['white-space', 'whiteSpace'],
	width: ['width'],
	'min-width': ['min-width', 'minWidth'],
};

/**
 * Every declaration of a property the gate reads (pure).
 *
 * Accepts a CSS declaration (`overflow-wrap: break-word`) and the React /
 * Panda object key (`overflowWrap: 'break-word'`). The value is a single
 * token, which is all the allowlists compare against.
 */
export function declarationsIn(text) {
	const found = [];
	for (const [property, aliases] of Object.entries(REFLOW_PROPERTIES)) {
		const names = aliases.map((alias) => alias.replace(/-/g, '\\-')).join('|');
		const pattern = new RegExp(`(?:${names})\\s*[:=]\\s*['\"]?([a-zA-Z0-9.%-]+)`, 'g');
		for (const match of text.matchAll(pattern)) {
			found.push({ property, value: match[1] });
		}
	}
	return found;
}

/** The ids of the break declarations present in a text (pure). */
export function breakDeclarationsIn(text) {
	const found = new Set();
	for (const declaration of declarationsIn(text)) {
		for (const breakDeclaration of BREAK_DECLARATIONS) {
			if (
				declaration.property === breakDeclaration.property &&
				declaration.value === breakDeclaration.value
			) {
				found.add(breakDeclaration.id);
			}
		}
	}
	return [...found];
}

/** Whether a text carries at least one break declaration (pure). */
export function hasBreakBoundary(text) {
	return breakDeclarationsIn(text).length > 0;
}

/**
 * Every px `width` / `min-width` above the reflow budget (pure).
 *
 * Only px values are considered: a percentage or a token cannot be
 * compared to the budget statically. `min-width` and `width` are both
 * read because either one pins the box wider than the viewport.
 */
export function fixedWidthsIn(text) {
	const found = [];
	for (const declaration of declarationsIn(text)) {
		if (declaration.property !== 'width' && declaration.property !== 'min-width') continue;
		const match = /^(\d+(?:\.\d+)?)px$/.exec(declaration.value);
		if (!match) continue;
		const px = Number(match[1]);
		if (px > REFLOW_BUDGET_PX) found.push({ property: declaration.property, px });
	}
	return found;
}

/** Whether a text forbids wrapping (pure). */
export function forbidsWrapIn(text) {
	return declarationsIn(text).some(
		(declaration) =>
			declaration.property === 'white-space' &&
			(declaration.value === 'nowrap' || declaration.value === 'pre'),
	);
}

/** The `data-reflow-kind` values a source declares (pure). */
export function specimenKindsIn(source) {
	const kinds = [];
	for (const match of source.matchAll(/data-reflow-kind\s*=\s*["']([a-z-]+)["']/g)) {
		if (UNBREAKABLE_KINDS.includes(match[1])) kinds.push(match[1]);
	}
	return kinds;
}

/** The `data-reflow-specimen` ids a source declares (pure). */
export function specimenIdsIn(source) {
	return [...source.matchAll(/data-reflow-specimen\s*=\s*["']([a-z0-9-]+)["']/g)].map(
		(match) => match[1],
	);
}

/**
 * Classify one fixture file (pure).
 *
 * The rules are file-level on purpose: the spec's question is whether the
 * fixture carries the overflow-countermeasure CSS at all, and a fixture
 * is a small hand-written specimen where the boundary and the content sit
 * together.
 */
export function evaluateFixtureSource({ relativePath, source }) {
	const code = stripComments(source);
	const kinds = specimenKindsIn(code);
	const breaks = breakDeclarationsIn(code);
	const fixedWidths = fixedWidthsIn(code);
	const unbreakable = kinds.length > 0;
	const forbids = forbidsWrapIn(code);
	const violations = [];

	if (unbreakable && !forbids && breaks.length === 0) {
		violations.push({
			rule: 'reflow-specimen-without-break',
			file: relativePath,
			line: null,
			wcag: '1.4.10',
			message: `the fixture injects ${kinds.join(', ')} but declares no break boundary (${BREAK_DECLARATIONS.map((entry) => `${entry.property}: ${entry.value}`).join(' / ')}); the unbreakable run forces a horizontal scroll at ${REFLOW_BUDGET_PX} px`,
		});
	}
	if (fixedWidths.length > 0) {
		violations.push({
			rule: 'reflow-specimen-fixed-width',
			file: relativePath,
			line: null,
			wcag: '1.4.10',
			message: `the fixture pins a box to ${fixedWidths.map((entry) => `${entry.property}: ${entry.px}px`).join(', ')}, wider than the ${REFLOW_BUDGET_PX} px reflow budget`,
		});
	}
	if (unbreakable && forbids) {
		violations.push({
			rule: 'reflow-specimen-nowrap',
			file: relativePath,
			line: null,
			wcag: '1.4.10',
			message: `the fixture injects ${kinds.join(', ')} while forbidding wrapping (white-space: nowrap); no break boundary can reflow it`,
		});
	}

	return { kinds, breaks, fixedWidths, forbidsWrap: forbids, violations };
}

/**
 * Audit the fixture FILES against the roster (pure), mirroring the other
 * a11y gates.
 */
export function auditFixtureFiles(entries) {
	const violations = [];
	const rows = [];
	for (const entry of entries) {
		const { directory, relativePath, expectedRules, evaluation, kindCount } = entry;
		if (directory === 'pass') {
			if (kindCount === 0) {
				violations.push({
					rule: 'fixture-pass-no-specimen',
					file: relativePath,
					line: null,
					wcag: null,
					message:
						'the pass fixture declares no data-reflow-kind specimen, so it exercises no rule; an empty pass fixture proves nothing and must not keep the gate green',
				});
			}
			if (evaluation.violations.length > 0) {
				violations.push({
					rule: 'fixture-pass-violation',
					file: relativePath,
					line: null,
					wcag: null,
					message: `a pass fixture reports ${evaluation.violations.map((violation) => violation.rule).join(', ')}; the pass state is no longer reproduced`,
				});
			}
			rows.push({
				file: relativePath,
				expected: [],
				found: evaluation.violations.map((violation) => violation.rule),
				kinds: evaluation.kinds,
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
		rows.push({ file: relativePath, expected: [...expectedRules], found, kinds: evaluation.kinds });
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
			const evaluation = evaluateFixtureSource({
				relativePath,
				source: readFileSync(join(absolute, name), 'utf8'),
			});
			entries.push({
				directory,
				name,
				relativePath,
				expectedRules,
				evaluation,
				kindCount: evaluation.kinds.length,
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

/** The shipped base-stylesheet audit (pure over `repoRoot`). */
export function auditBaseStyles(repoRoot = REPO_ROOT) {
	const absolute = join(repoRoot, BASE_STYLES_PATH);
	if (!existsSync(absolute)) {
		throw new Error(`cannot scan the repository: ${BASE_STYLES_PATH} is missing`);
	}
	const source = readFileSync(absolute, 'utf8');
	const block = findCssBlock(source, BASE_SELECTOR);
	const violations = [];
	if (!block) {
		violations.push({
			rule: 'reflow-wrap-floor-missing',
			file: BASE_STYLES_PATH,
			line: null,
			wcag: '1.4.10',
			message: `the shipped base stylesheet declares no ${BASE_SELECTOR} rule, so there is no place carrying the wrap floor`,
		});
		return { selector: BASE_SELECTOR, breaks: [], violations };
	}
	const breaks = breakDeclarationsIn(block.body);
	if (breaks.length === 0) {
		violations.push({
			rule: 'reflow-wrap-floor-missing',
			file: BASE_STYLES_PATH,
			line: block.line,
			wcag: '1.4.10',
			message: `the ${BASE_SELECTOR} rule declares no break boundary (${BREAK_DECLARATIONS.map((entry) => `${entry.property}: ${entry.value}`).join(' / ')}); an unbreakable run has nowhere to break at ${REFLOW_BUDGET_PX} px`,
		});
	}
	return { selector: BASE_SELECTOR, breaks, violations };
}

/**
 * Scan the repository (pure over `repoRoot`).
 */
export function collectEvidence(repoRoot = REPO_ROOT) {
	const base = auditBaseStyles(repoRoot);
	const fixture = auditFixture(repoRoot);
	const shippedStyles = [BASE_STYLES_PATH].map((relativePath) => ({
		file: relativePath,
		exists: existsSync(join(repoRoot, relativePath)),
	}));
	return {
		shippedStyles,
		base,
		fixture,
		violations: [...base.violations, ...fixture.violations],
		humanEvaluation: HUMAN_EVALUATION,
		wcag: WCAG,
	};
}

/** The human-readable report, with the two kinds of statement separated. */
export function renderGateSummary(evidence) {
	const lines = [];
	lines.push(`text reflow gate — Issue ${ISSUE}`);
	lines.push(
		`shipped: ${evidence.shippedStyles.map((entry) => entry.file).join(', ')} (base rule ${BASE_SELECTOR}); fixture: ${evidence.fixture.rows.length} file(s)`,
	);
	lines.push('');
	lines.push('machine-checked:');
	const baseOk = evidence.base.violations.length === 0;
	lines.push(
		`  ${baseOk ? 'ok  ' : 'FAIL'} ${'reflow-wrap-floor-missing'.padEnd(32)} the ${BASE_SELECTOR} rule carries a break boundary (${evidence.base.breaks.join(', ') || 'none'}) for SC 1.4.10 (${REFLOW_BUDGET_PX} px budget)`,
	);
	for (const rule of RULES.slice(1)) {
		const count = evidence.fixture.rows.filter((row) => row.found.includes(rule)).length;
		lines.push(`  ${'ok  '} ${rule.padEnd(32)} ${count} fixture(s) reproduce it`);
	}
	lines.push(
		`  ${evidence.fixture.violations.length === 0 ? 'ok  ' : 'FAIL'} ${'fixture'.padEnd(32)} ${evidence.fixture.rows.length} fixture file(s) reproduce the states they stand for`,
	);
	lines.push('');
	lines.push('not machine-checked (human evaluation):');
	for (const item of evidence.humanEvaluation) lines.push(`  - ${item}`);
	lines.push('');
	lines.push('fixture expectations:');
	for (const row of evidence.fixture.rows) {
		lines.push(
			`  ${row.file} — kinds=[${row.kinds.join(', ')}], expected=[${row.expected.join(', ')}], found=[${row.found.join(', ')}]`,
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
