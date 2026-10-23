#!/usr/bin/env node

/**
 * check-a11y-contrast — enforce the WCAG 2.2 SC 1.4.3 Contrast (Minimum), AA
 * contract on the shipped token layer (Issue #399).
 *
 * What this gate is for
 * ---------------------
 * The obligation is the editorial colour layer: `src/editorial/tokens.ts`
 * (raw values) and `src/editorial/semantic-tokens.ts` (the semantic names
 * components consume). The gate MEASURES that layer instead of trusting the
 * prose in `src/editorial/colors.md`: a publisher who changes a token step
 * must not be able to leave a prose table behind that no longer describes
 * the shipped values.
 *
 * It imports BOTH TypeScript modules and resolves the `{colors.brand.700}`
 * references itself, so the measured number comes from the same objects
 * Panda consumes. A reference that does not resolve is never guessed: it is
 * reported as `unresolved-token-reference`, because a silent fallback would
 * let a broken token pass as a compliant one.
 *
 * The rules
 * ---------
 *   contrast-below-normal
 *       A normal-text pair below 4.5 : 1.
 *   contrast-below-large
 *       A large-text pair (>= 24 px, or >= 18.66 px bold) below 3 : 1.
 *   contrast-below-non-text
 *       A non-text UI component pair (focus ring, boundary rule, identifier
 *       colour) below 3 : 1.
 *   unresolved-token-reference
 *       A semantic token points at a raw token that does not resolve.
 *   fixture-expectation-mismatch
 *       A fixture pair does not behave the way its own expectation says
 *       (a `pass` pair that fails, a `fail` pair that passes).
 *   fixture-contract-missing
 *       A fixture directory is missing or holds fewer files than the Issue
 *       requires, so the fixture proves nothing.
 *
 * The thresholds are WCAG 2.2 SC 1.4.3 (Contrast (Minimum), Level AA):
 * 4.5 : 1 for normal text, 3 : 1 for large text, 3 : 1 for the boundaries
 * and graphical objects that identify a UI component.
 *
 * The pair matrix lives in ONE place — {@link CONTRAST_PAIRS} — and both
 * appearances are measured: light (`base`) and dark (`_dark`). A pair that
 * fails in only one appearance is reported for that appearance only.
 *
 * Machine-checked vs. human-evaluated
 * -----------------------------------
 * This gate decides RATIOS. It cannot decide whether a colour is
 * *semantically* adequate — whether a green reads as "ok" to a reader, or
 * whether a hue family is still distinguishable after the palette moves.
 * Those are judgements; they are printed under "not machine-checked" and
 * recorded in `docs/verification/a11y/contrast.md`.
 *
 * Exit codes: 0 = every rule passes, 1 = at least one violation,
 * 2 = the repository could not be scanned.
 *
 * Usage:
 *   node --experimental-strip-types scripts/check-a11y-contrast.mjs [--quiet] [--json=FILE]
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The modules the gate measures. Both are imported, never re-declared. */
export const RAW_TOKENS_MODULE = 'src/editorial/tokens.ts';
export const SEMANTIC_TOKENS_MODULE = 'src/editorial/semantic-tokens.ts';

/** Where the fixture files live. */
export const FIXTURE_ROOT = 'scripts/fixtures/a11y-contrast';
export const FIXTURE_PASS_DIR = `${FIXTURE_ROOT}/pass`;
export const FIXTURE_FAIL_DIR = `${FIXTURE_ROOT}/fail`;

/** The Issue requires at least two fixture files in each directory. */
export const FIXTURE_MIN_FILES = 2;

/** The two appearances the semantic layer ships. */
export const APPEARANCES = [
	{ id: 'light', condition: 'base', label: 'light (base)' },
	{ id: 'dark', condition: '_dark', label: 'dark (_dark)' },
];

/**
 * The WCAG 2.2 SC 1.4.3 thresholds, per pair kind.
 *
 * `normal` — body text. `large` — >= 24 px, or >= 18.66 px bold.
 * `non-text` — a UI component boundary or an identifier colour.
 */
export const THRESHOLDS = {
	normal: 4.5,
	large: 3,
	'non-text': 3,
};

/** The rule each pair kind reports under. */
export const CONTRAST_RULES = {
	normal: 'contrast-below-normal',
	large: 'contrast-below-large',
	'non-text': 'contrast-below-non-text',
};

/** The rule for a reference that does not resolve. */
export const UNRESOLVED_RULE = 'unresolved-token-reference';

/** The rules the gate can report. */
export const RULES = [
	...Object.values(CONTRAST_RULES),
	UNRESOLVED_RULE,
	'fixture-expectation-mismatch',
	'fixture-contract-missing',
];

/**
 * The pair matrix — the single declaration of what this repository claims
 * about its own contrast.
 *
 * `fg` / `bg` are SEMANTIC token paths (`text.default`, `bg.canvas`).
 * `threshold` repeats the SC 1.4.3 number so a reader of the report does
 * not have to know the `kind` to know what was demanded; `kind` selects
 * the rule and the threshold, and the two must agree.
 */
export const CONTRAST_PAIRS = [
	{
		fg: 'text.default',
		bg: 'bg.canvas',
		kind: 'normal',
		threshold: 4.5,
		note: 'body copy on the page',
	},
	{
		fg: 'text.default',
		bg: 'bg.surface',
		kind: 'normal',
		threshold: 4.5,
		note: 'body copy on a raised card',
	},
	{
		fg: 'text.default',
		bg: 'bg.subtle',
		kind: 'normal',
		threshold: 4.5,
		note: 'body copy on a subtle inset',
	},
	{
		fg: 'text.muted',
		bg: 'bg.canvas',
		kind: 'normal',
		threshold: 4.5,
		note: 'secondary copy on the page',
	},
	{
		fg: 'text.muted',
		bg: 'bg.surface',
		kind: 'normal',
		threshold: 4.5,
		note: 'secondary copy on a raised card',
	},
	{
		fg: 'text.muted',
		bg: 'bg.subtle',
		kind: 'normal',
		threshold: 4.5,
		note: 'secondary copy on a subtle inset',
	},
	{
		fg: 'text.muted',
		bg: 'accent.surface',
		kind: 'normal',
		threshold: 4.5,
		note: 'secondary copy on the tinted feature region',
	},
	{
		fg: 'text.inverse',
		bg: 'bg.accent',
		kind: 'normal',
		threshold: 4.5,
		note: 'the CTA label on the accent fill',
	},
	{
		fg: 'text.inverse',
		bg: 'bg.inverse',
		kind: 'normal',
		threshold: 4.5,
		note: 'the inverse panel label',
	},
	{
		fg: 'text.accent',
		bg: 'bg.canvas',
		kind: 'normal',
		threshold: 4.5,
		note: 'a link on the page',
	},
	{
		fg: 'text.accent',
		bg: 'accent.surface',
		kind: 'large',
		threshold: 3,
		note: 'a large link / heading on the tinted feature region',
	},
	{
		fg: 'accent.positive',
		bg: 'bg.canvas',
		kind: 'normal',
		threshold: 4.5,
		note: 'the status label "ok"',
	},
	{
		fg: 'accent.negative',
		bg: 'bg.canvas',
		kind: 'normal',
		threshold: 4.5,
		note: 'the status label "error"',
	},
	{
		fg: 'accent.warning',
		bg: 'bg.canvas',
		kind: 'normal',
		threshold: 4.5,
		note: 'the status label "degraded"',
	},
	{
		fg: 'accent.category.design',
		bg: 'bg.canvas',
		kind: 'non-text',
		threshold: 3,
		note: 'the design category identifier',
	},
	{
		fg: 'accent.category.code',
		bg: 'bg.canvas',
		kind: 'non-text',
		threshold: 3,
		note: 'the code category identifier',
	},
	{
		fg: 'accent.category.writing',
		bg: 'bg.canvas',
		kind: 'non-text',
		threshold: 3,
		note: 'the writing category identifier',
	},
	{
		fg: 'accent.category.tool',
		bg: 'bg.canvas',
		kind: 'non-text',
		threshold: 3,
		note: 'the tool category identifier',
	},
	{
		fg: 'border.focus',
		bg: 'bg.canvas',
		kind: 'non-text',
		threshold: 3,
		note: 'the focus indicator',
	},
	{
		fg: 'border.strong',
		bg: 'bg.canvas',
		kind: 'non-text',
		threshold: 3,
		note: 'the emphasis boundary rule',
	},
];

/**
 * Tokens deliberately NOT in the matrix, with the reason.
 *
 * `border.subtle` is the decorative hairline separator: it carries no
 * information of its own, so SC 1.4.3 (which asks for the contrast of a
 * component boundary that IDENTIFIES a component) does not apply to it.
 * Excluding it is a decision, so it is printed with the report instead of
 * being silently dropped.
 */
export const EXCLUDED_TOKENS = [
	{
		token: 'border.subtle',
		reason:
			'decorative separator — it carries no information of its own, so the 3:1 non-text minimum does not apply (SC 1.4.3 requires it only for a boundary that identifies a component)',
	},
];

/**
 * Things this gate deliberately does not decide. Printed with the report so
 * a reader never mistakes a green run for "accessible".
 */
export const HUMAN_EVALUATION = [
	'whether a status colour is semantically adequate (does "green" read as "ok" to a reader)',
	'whether the four category hues stay distinguishable after a palette change',
	'contrast of text over photography, gradients or images (not token pairs)',
	'how the palette reads on an uncalibrated or low-quality display',
];

/* ------------------------------------------------------------------ *
 * colour arithmetic (pure)
 * ------------------------------------------------------------------ */

/**
 * Parse a `#RRGGBB` (or `#RGB`) literal into 8-bit channels.
 *
 * Returns `null` for anything else, so an unparseable value is reported
 * instead of being coerced into a colour nobody chose.
 */
export function parseHexColor(value) {
	if (typeof value !== 'string') return null;
	const hex = value.trim().replace(/^#/, '');
	if (/^[0-9a-f]{3}$/i.test(hex)) {
		const [r, g, b] = hex.split('');
		return {
			r: Number.parseInt(r + r, 16),
			g: Number.parseInt(g + g, 16),
			b: Number.parseInt(b + b, 16),
		};
	}
	if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
	return {
		r: Number.parseInt(hex.slice(0, 2), 16),
		g: Number.parseInt(hex.slice(2, 4), 16),
		b: Number.parseInt(hex.slice(4, 6), 16),
	};
}

/**
 * The WCAG relative luminance of a colour.
 *
 * `L_channel = c / 12.92` below the 0.03928 break, `((c + 0.055) / 1.055) ^ 2.4`
 * above it; `L = 0.2126 R + 0.7152 G + 0.0722 B`.
 */
export function relativeLuminance(color) {
	const [r, g, b] = [color.r, color.g, color.b].map((channel) => {
		const c = channel / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The WCAG contrast ratio between two colours: `(L1 + 0.05) / (L2 + 0.05)`.
 *
 * The order of the arguments does not matter — the lighter colour is
 * always the numerator.
 */
export function contrastRatio(foreground, background) {
	const fg = typeof foreground === 'string' ? parseHexColor(foreground) : foreground;
	const bg = typeof background === 'string' ? parseHexColor(background) : background;
	if (!fg || !bg) return null;
	const l1 = relativeLuminance(fg);
	const l2 = relativeLuminance(bg);
	const lighter = Math.max(l1, l2);
	const darker = Math.min(l1, l2);
	return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The reported ratio: two decimals, always rounded DOWN.
 *
 * Rounding down means the printed number can never be higher than the
 * measured one, so a pair at 4.499 is never printed as "4.50".
 */
export function formatRatio(ratio) {
	if (ratio === null || ratio === undefined) return 'n/a';
	return (Math.floor(ratio * 100) / 100).toFixed(2);
}

/* ------------------------------------------------------------------ *
 * token resolution (pure)
 * ------------------------------------------------------------------ */

/** Read a dotted path out of a nested object. `null` when it is absent. */
export function lookupPath(source, path) {
	let node = source;
	for (const segment of path.split('.')) {
		if (node === null || node === undefined || typeof node !== 'object') return null;
		node = node[segment];
	}
	return node === undefined ? null : node;
}

/**
 * The raw colour at `path` (e.g. `colors.brand.700`).
 *
 * A raw token is `{ value: '#rrggbb' }`; a bare string is accepted too so
 * the resolver does not depend on one declaration shape.
 */
export function resolveRawColor(rawTokens, path) {
	// A reference may arrive with its braces (`{colors.brand.700}`) or as a
	// bare path (`colors.brand.700`); both name the same raw token.
	const bare = typeof path === 'string' ? path.trim().replace(/^\{/, '').replace(/\}$/, '') : path;
	const node = lookupPath(rawTokens, bare);
	if (node === null) return null;
	const value = typeof node === 'object' && 'value' in node ? node.value : node;
	return typeof value === 'string' ? value : null;
}

/** The reference inside `{…}`, or `null` when the value is not a reference. */
export function parseReference(value) {
	if (typeof value !== 'string') return null;
	const match = /^\{([^}]+)\}$/.exec(value.trim());
	return match ? match[1] : null;
}

/**
 * Resolve a semantic token path (`text.muted`) for one appearance
 * condition (`base` / `_dark`).
 *
 * Returns `{ value, reference }`, where `value` is the raw hex when the
 * reference resolves and `null` when it does not. A reference that does
 * not resolve is never guessed.
 */
export function resolveSemanticValue(semanticTokens, path, condition) {
	const node = lookupPath(semanticTokens?.colors, path);
	if (node === null || typeof node !== 'object' || !('value' in node)) {
		return { raw: null, reference: null };
	}
	const binding = node.value;
	if (binding === null || typeof binding !== 'object') return { raw: null, reference: null };
	const raw = binding[condition];
	const reference = parseReference(raw);
	return { raw: typeof raw === 'string' ? raw : null, reference };
}

/* ------------------------------------------------------------------ *
 * the pair matrix (pure)
 * ------------------------------------------------------------------ */

/**
 * Measure every pair in the matrix, in every appearance.
 *
 * Returns `{ rows, violations }`. A row is one pair in one appearance with
 * the two resolved colours and the measured ratio; a violation is a row
 * whose ratio is below its threshold, plus every reference that did not
 * resolve.
 */
export function auditPairs({
	rawTokens,
	semanticTokens,
	pairs = CONTRAST_PAIRS,
	appearances = APPEARANCES,
}) {
	const rows = [];
	const violations = [];

	for (const pair of pairs) {
		const kind = pair.kind;
		const threshold = pair.threshold ?? THRESHOLDS[kind];
		for (const appearance of appearances) {
			const fg = resolveSemanticValue(semanticTokens, pair.fg, appearance.condition);
			const bg = resolveSemanticValue(semanticTokens, pair.bg, appearance.condition);
			const unresolved = [];
			if (fg.reference === null) unresolved.push(`${pair.fg} (semantic token not found)`);
			else if (resolveRawColor(rawTokens, fg.reference) === null) {
				unresolved.push(`${pair.fg} -> ${fg.reference}`);
			}
			if (bg.reference === null) unresolved.push(`${pair.bg} (semantic token not found)`);
			else if (resolveRawColor(rawTokens, bg.reference) === null) {
				unresolved.push(`${pair.bg} -> ${bg.reference}`);
			}

			if (unresolved.length > 0) {
				for (const detail of unresolved) {
					violations.push({
						rule: UNRESOLVED_RULE,
						appearance: appearance.id,
						fg: pair.fg,
						bg: pair.bg,
						ratio: null,
						threshold,
						message: `${detail} does not resolve to a colour in ${RAW_TOKENS_MODULE}`,
					});
				}
				rows.push({
					fg: pair.fg,
					bg: pair.bg,
					kind,
					note: pair.note,
					appearance: appearance.id,
					threshold,
					fgValue: null,
					bgValue: null,
					ratio: null,
					pass: false,
					resolved: false,
				});
				continue;
			}

			const fgValue = resolveRawColor(rawTokens, fg.reference);
			const bgValue = resolveRawColor(rawTokens, bg.reference);
			const ratio = contrastRatio(fgValue, bgValue);
			const pass = ratio !== null && ratio >= threshold;
			rows.push({
				fg: pair.fg,
				bg: pair.bg,
				kind,
				note: pair.note,
				appearance: appearance.id,
				threshold,
				fgValue,
				bgValue,
				ratio,
				pass,
				resolved: true,
			});
			if (!pass) {
				violations.push({
					rule: CONTRAST_RULES[kind],
					appearance: appearance.id,
					fg: pair.fg,
					bg: pair.bg,
					ratio,
					threshold,
					message: `${pair.fg} (${fgValue}) on ${pair.bg} (${bgValue}) is ${formatRatio(ratio)}:1 in the ${appearance.id} appearance, below the ${threshold}:1 required for ${kind} text`,
				});
			}
		}
	}

	return { rows, violations };
}

/* ------------------------------------------------------------------ *
 * the fixtures (pure)
 * ------------------------------------------------------------------ */

/**
 * Resolve one fixture colour.
 *
 * A fixture may write a colour directly (`#0f172a`), a raw reference
 * (`{colors.neutral.900}`) or a semantic token path (`text.default`,
 * read in the light / `base` condition). Anything else does not resolve.
 */
export function resolveFixtureColor(value, { rawTokens, semanticTokens }) {
	if (typeof value !== 'string') return null;
	const reference = parseReference(value);
	if (reference !== null) return resolveRawColor(rawTokens, reference);
	if (/^#[0-9a-f]{3,8}$/i.test(value.trim())) return value.trim();
	const semantic = resolveSemanticValue(semanticTokens, value.trim(), 'base');
	if (semantic.reference !== null) return resolveRawColor(rawTokens, semantic.reference);
	return null;
}

/**
 * Audit one fixture file against its own expectations.
 *
 * A fixture pair declares what it is: `pass` (must meet the threshold),
 * `fail` (must miss it) or `unresolved` (must not resolve at all). The
 * expected behaviour of a `fail` pair is a DETECTION, not a gate
 * violation — otherwise the repository could never be green while
 * carrying a fixture that demonstrates a failure.
 *
 * Returns `{ rows, detections, violations }`.
 */
export function auditFixture(fixture, { rawTokens, semanticTokens, file }) {
	const rows = [];
	const detections = [];
	const violations = [];

	for (const pair of fixture.pairs ?? []) {
		const kind = pair.kind ?? 'normal';
		const threshold = pair.threshold ?? THRESHOLDS[kind];
		const expectation = pair.expect ?? 'pass';
		const fg = resolveFixtureColor(pair.fg, { rawTokens, semanticTokens });
		const bg = resolveFixtureColor(pair.bg, { rawTokens, semanticTokens });
		const resolved = fg !== null && bg !== null;
		const ratio = resolved ? contrastRatio(fg, bg) : null;
		const meets = ratio !== null && ratio >= threshold;
		const row = {
			id: pair.id ?? null,
			kind,
			threshold,
			expectation,
			fg: pair.fg,
			bg: pair.bg,
			fgValue: fg,
			bgValue: bg,
			ratio,
			resolved,
			meets,
		};
		rows.push(row);

		if (expectation === 'unresolved') {
			if (resolved) {
				violations.push({
					rule: 'fixture-expectation-mismatch',
					file,
					appearance: null,
					fg: pair.fg,
					bg: pair.bg,
					ratio,
					threshold,
					message: `the fixture expects "${pair.fg}" to stay unresolved, but it resolved to ${fg}`,
				});
			} else {
				detections.push({ ...row, rule: UNRESOLVED_RULE });
			}
			continue;
		}

		if (expectation === 'fail') {
			if (!resolved) {
				violations.push({
					rule: 'fixture-expectation-mismatch',
					file,
					appearance: null,
					fg: pair.fg,
					bg: pair.bg,
					ratio: null,
					threshold,
					message: `the fixture expects "${pair.fg}" on "${pair.bg}" to be measurably below ${threshold}:1, but the colours do not resolve`,
				});
			} else if (meets) {
				violations.push({
					rule: 'fixture-expectation-mismatch',
					file,
					appearance: null,
					fg: pair.fg,
					bg: pair.bg,
					ratio,
					threshold,
					message: `the fixture expects "${pair.fg}" on "${pair.bg}" to be below ${threshold}:1, but it measures ${formatRatio(ratio)}:1`,
				});
			} else {
				detections.push({ ...row, rule: CONTRAST_RULES[kind] });
			}
			continue;
		}

		// expectation === 'pass'
		if (!resolved) {
			violations.push({
				rule: UNRESOLVED_RULE,
				file,
				appearance: null,
				fg: pair.fg,
				bg: pair.bg,
				ratio: null,
				threshold,
				message: `the fixture colour "${fg ?? pair.fg}" does not resolve to a colour`,
			});
		} else if (!meets) {
			violations.push({
				rule: CONTRAST_RULES[kind],
				file,
				appearance: null,
				fg: pair.fg,
				bg: pair.bg,
				ratio,
				threshold,
				message: `the fixture pair "${pair.fg}" (${fg}) on "${pair.bg}" (${bg}) is ${formatRatio(ratio)}:1, below the ${threshold}:1 it claims to meet`,
			});
		}
	}

	return { rows, detections, violations };
}

/** Read and parse one fixture file. */
export function readFixture(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

/** The fixture files of one directory, sorted by name. */
export function collectFixtureFiles(directory) {
	if (!existsSync(directory)) return [];
	return readdirSync(directory)
		.filter((name) => name.endsWith('.json'))
		.sort()
		.map((name) => join(directory, name));
}

/**
 * Audit every fixture file of the repository.
 *
 * The directory itself is part of the contract: a missing `pass/` or
 * `fail/` directory, or one that holds fewer than the Issue's minimum,
 * is reported as `fixture-contract-missing` — a fixture that quietly lost
 * a file would otherwise "verify" less than it claims.
 */
export function auditFixtures({ rawTokens, semanticTokens, repoRoot = REPO_ROOT }) {
	const violations = [];
	const files = [];

	for (const [directory, expectation] of [
		[FIXTURE_PASS_DIR, 'pass'],
		[FIXTURE_FAIL_DIR, 'fail'],
	]) {
		const absolute = resolve(repoRoot, directory);
		const found = collectFixtureFiles(absolute);
		if (found.length < FIXTURE_MIN_FILES) {
			violations.push({
				rule: 'fixture-contract-missing',
				file: directory,
				appearance: null,
				fg: null,
				bg: null,
				ratio: null,
				threshold: null,
				message: `${directory} holds ${found.length} fixture file(s); the Issue requires at least ${FIXTURE_MIN_FILES} in the ${expectation} directory`,
			});
			continue;
		}
		for (const path of found) {
			const relativePath = path.slice(repoRoot.length + 1);
			let fixture = null;
			try {
				fixture = readFixture(path);
			} catch (error) {
				violations.push({
					rule: 'fixture-contract-missing',
					file: relativePath,
					appearance: null,
					fg: null,
					bg: null,
					ratio: null,
					threshold: null,
					message: `the fixture cannot be parsed: ${error.message}`,
				});
				continue;
			}
			const audited = auditFixture(fixture, { rawTokens, semanticTokens, file: relativePath });
			files.push({ path: relativePath, expectation, ...audited });
			violations.push(...audited.violations);
		}
	}

	return { files, violations };
}

/* ------------------------------------------------------------------ *
 * the report
 * ------------------------------------------------------------------ */

/** The human-readable report, with the two kinds of statement separated. */
export function renderGateSummary(evidence) {
	const lines = [];
	lines.push('colour contrast AA gate — Issue #399 (WCAG 2.2 SC 1.4.3)');
	lines.push(
		`measured ${evidence.rows.length} pair/appearance row(s) from ${RAW_TOKENS_MODULE} + ${SEMANTIC_TOKENS_MODULE}`,
	);
	lines.push('');
	lines.push('machine-checked:');
	for (const row of evidence.rows) {
		const verdict = row.resolved ? (row.pass ? 'ok  ' : 'FAIL') : 'FAIL';
		const ratio = row.resolved ? `${formatRatio(row.ratio)}:1` : 'unresolved';
		lines.push(
			`  ${verdict} ${row.appearance.padEnd(5)} ${`${row.fg} on ${row.bg}`.padEnd(46)} ${ratio.padStart(8)} (needs ${row.threshold}:1, ${row.kind})`,
		);
	}
	lines.push('');
	lines.push('excluded from the matrix (stated, not dropped silently):');
	for (const entry of evidence.excluded) {
		lines.push(`  - ${entry.token} — ${entry.reason}`);
	}
	lines.push('');
	lines.push('fixture expectations:');
	for (const file of evidence.fixtures) {
		const detections = file.detections.length;
		lines.push(`  ${file.path} — ${file.rows.length} pair(s), ${detections} expected detection(s)`);
	}
	lines.push('');
	lines.push('not machine-checked (human evaluation):');
	for (const item of evidence.humanEvaluation) lines.push(`  - ${item}`);
	lines.push('');
	if (evidence.violations.length > 0) {
		lines.push(`violations (${evidence.violations.length}):`);
		for (const entry of evidence.violations) {
			const where = entry.file ? `${entry.file}` : `${entry.fg} on ${entry.bg}`;
			const appearance = entry.appearance ? ` [${entry.appearance}]` : '';
			lines.push(`  [${entry.rule}] ${where}${appearance} — ${entry.message}`);
		}
	} else {
		lines.push('no violations');
	}
	return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * entry point
 * ------------------------------------------------------------------ */

/** Load the shipped token modules (the gate measures what ships). */
export async function loadTokenModules() {
	try {
		const raw = await import('../src/editorial/tokens.ts');
		const semantic = await import('../src/editorial/semantic-tokens.ts');
		return { rawTokens: raw.rawTokens, semanticTokens: semantic.semanticTokens };
	} catch (error) {
		throw new Error(
			`cannot load the shipped token modules (${error.message}). This gate imports the TypeScript sources directly, which needs Node >= 22.18 (the version in package.json#engines and in CI).`,
		);
	}
}

/** Collect every piece of evidence the gate reports (async: it imports TS). */
export async function collectEvidence() {
	const { rawTokens, semanticTokens } = await loadTokenModules();
	const pairs = auditPairs({ rawTokens, semanticTokens });
	const fixtures = auditFixtures({ rawTokens, semanticTokens });
	return {
		rows: pairs.rows,
		violations: [...pairs.violations, ...fixtures.violations],
		fixtures: fixtures.files,
		excluded: EXCLUDED_TOKENS,
		humanEvaluation: HUMAN_EVALUATION,
	};
}

function usage() {
	process.stderr.write(
		'usage: check-a11y-contrast.mjs [--quiet] [--json=FILE]\n' +
			'  --quiet     print violations only\n' +
			'  --json=FILE write the measured rows as JSON\n',
	);
}

export async function runGate(argv = process.argv.slice(2)) {
	const quiet = argv.includes('--quiet');
	const jsonIndex = argv.indexOf('--json');
	const jsonOut = jsonIndex === -1 ? null : (argv[jsonIndex + 1] ?? null);
	for (const arg of argv) {
		if (arg.startsWith('--') && !['--quiet', '--json'].includes(arg.split('=')[0])) {
			usage();
			throw new Error(`unknown option: ${arg}`);
		}
	}
	if (jsonIndex !== -1 && jsonOut === null) {
		usage();
		throw new Error('--json requires a path');
	}

	const evidence = await collectEvidence();

	if (!quiet) {
		process.stdout.write(`${renderGateSummary(evidence)}\n`);
	}
	for (const violation of evidence.violations) {
		process.stderr.write(`error [${violation.rule}]: ${violation.message}\n`);
	}
	if (jsonOut) {
		mkdirSync(dirname(resolve(REPO_ROOT, jsonOut)), { recursive: true });
		writeFileSync(
			resolve(REPO_ROOT, jsonOut),
			`${JSON.stringify({ issue: '#399', rows: evidence.rows, violations: evidence.violations }, null, 2)}\n`,
		);
		process.stdout.write(`check-a11y-contrast: report ${jsonOut}\n`);
	}
	return evidence.violations.length === 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runGate()
		.then((ok) => {
			if (!ok) process.exit(1);
		})
		.catch((error) => {
			process.stderr.write(`check-a11y-contrast: ${error.message}\n`);
			process.exit(2);
		});
}
