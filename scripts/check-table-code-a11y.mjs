#!/usr/bin/env node

/**
 * check-table-code-a11y — enforce the table / code-block readability
 * contract on the shipped surface (Issue #407).
 *
 * What this gate is for
 * ---------------------
 * The obligation is `src/editorial/table-code.tsx`: *a table and a
 * code block carry their own name and their own scroll*. This gate is
 * what stops the rest of `src/` from quietly undoing it. Every rule
 * corresponds to a claim the verification artefact
 * (`docs/verification/a11y/table-code-mobile.webp`) makes:
 *
 *   - table-outside-primitive
 *     A raw `<table>` outside the editorial primitive is a table whose
 *     caption and header scopes are somebody's memory. The primitive
 *     makes them structural (a `<caption>` the region is named by,
 *     `scope="col"` / `scope="row"` on every header cell), so an
 *     ad-hoc table has to justify re-implementing that by hand.
 *     WCAG 2.2 SC 1.3.1 Info and Relationships (A).
 *   - scroll-container-outside-primitive
 *     `overflow-x: auto` is not free: the box it creates cannot be
 *     scrolled with a keyboard unless it is focusable and named. A
 *     hand-rolled scroll container is where that is forgotten, so the
 *     declaration is owned by the primitive.
 *     WCAG 2.2 SC 1.4.10 Reflow (AA) + SC 2.1.1 Keyboard (A).
 *   - primitive-contract-missing
 *     The primitive's own contract is asserted here rather than only in
 *     unit tests, so deleting an attribute is caught by `validate:fast`
 *     even if the test file is "updated" to match. Each entry is the
 *     one thing that particular attribute buys.
 *   - fixture-state-missing
 *     The Issue's completion condition asks for the states to be
 *     REPRODUCIBLE, so the fixture's four ids are an exact set. A
 *     fixture that quietly dropped the empty or the failure state
 *     fails instead of verifying three of four.
 *
 * Machine-checked vs. human-evaluated
 * -----------------------------------
 * The report prints the two lists separately and never mixes them.
 * Everything below "not machine-checked" is a judgement this gate
 * cannot make: contrast of the chosen tokens, whether the caption text
 * reads well, whether a real screen reader announces the table as
 * expected, and reading comfort at 320 px. `docs/verification/a11y/table-code.md`
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

/** The obligation that owns the contract. */
export const PRIMITIVE = 'src/editorial/table-code.tsx';

/** The fixture states Issue #407 names, in render order. */
export const EXPECTED_CASE_IDS = ['01-normal', '02-empty', '03-failure', '04-compact'];

/**
 * The attributes the primitive must keep, each with the claim it
 * carries. Used both as the rule and as the report's "what was
 * checked" list, so the gate and the artefact cannot disagree about
 * what was verified.
 */
export const CONTRACT_MARKERS = [
	{
		id: 'caption',
		pattern: /<caption\b/,
		wcag: '1.3.1',
		claim: 'the table is named by a visible caption',
	},
	{ id: 'scope-col', pattern: /scope="col"/, wcag: '1.3.1', claim: 'column headers are exposed' },
	{ id: 'scope-row', pattern: /scope="row"/, wcag: '1.3.1', claim: 'row headers are exposed' },
	{
		id: 'scroll-region',
		pattern: /data-table-scroll/,
		wcag: '2.4.6',
		claim: 'the scroll box is a landmark',
	},
	{
		id: 'keyboard-focus',
		pattern: /tabIndex=\{0\}/,
		wcag: '2.1.1',
		claim: 'the scroll box is reachable',
	},
	{
		id: 'region-name',
		pattern: /aria-labelledby=\{captionId\}/,
		wcag: '2.4.6',
		claim: 'the scroll box is named by the caption',
	},
	{
		id: 'confined-scroll',
		pattern: /overflowX: 'auto'/,
		wcag: '1.4.10',
		claim: 'the scroll stays inside the component',
	},
];

/**
 * Things this gate deliberately does not decide. Printed with the
 * report so a reader never mistakes a green run for "accessible".
 */
export const HUMAN_EVALUATION = [
	'contrast of the muted header text and the hairline rule at 200% zoom',
	'whether the caption wording describes the table well',
	'a real screen-reader pass (VoiceOver / NVDA) naming the table and announcing cell headers',
	'reading comfort and density judgement at 320 px and at 400% zoom',
];

export function scanViolationsInFile({ relativePath, source }) {
	const violations = [];
	const code = stripComments(source);
	const record = (rule, match, detail) => {
		violations.push({
			rule,
			file: relativePath,
			line: lineAt(code, match.index ?? 0),
			wcag: detail.wcag,
			message: detail.message,
		});
	};

	if (relativePath !== PRIMITIVE) {
		for (const match of code.matchAll(/<table[\s>]/g)) {
			record('table-outside-primitive', match, {
				wcag: '1.3.1',
				message:
					'a raw <table> renders no caption and no header scope by construction; render `DataTable` from src/editorial/table-code.tsx instead',
			});
		}
		for (const match of code.matchAll(/overflowX: '(auto|scroll)'/g)) {
			record('scroll-container-outside-primitive', match, {
				wcag: '1.4.10',
				message:
					"a hand-rolled `overflowX: 'auto'` box is not keyboard-scrollable unless it is focusable and named; render `DataTable` / `CodeBlock` instead",
			});
		}
	}
	return violations;
}

/**
 * Scan the repository (pure over `directory`, so the rules are unit
 * testable without a checkout).
 */
export function collectEvidence(directory = join(REPO_ROOT, 'src')) {
	const violations = [];
	const files = collectSourceFiles(directory);
	for (const file of files) {
		violations.push(
			...scanViolationsInFile({
				relativePath: toRepoPath(file),
				source: readFileSync(file, 'utf8'),
			}),
		);
	}

	let primitive = { file: PRIMITIVE, present: false, markers: [], missing: [] };
	try {
		const source = stripComments(readFileSync(join(REPO_ROOT, PRIMITIVE), 'utf8'));
		const markers = CONTRACT_MARKERS.map((marker) => ({
			...marker,
			present: marker.pattern.test(source),
		}));
		primitive = {
			file: PRIMITIVE,
			present: true,
			markers,
			missing: markers.filter((marker) => !marker.present).map((marker) => marker.id),
		};
		for (const marker of primitive.missing) {
			violations.push({
				rule: 'primitive-contract-missing',
				file: PRIMITIVE,
				line: null,
				wcag: CONTRACT_MARKERS.find((entry) => entry.id === marker)?.wcag ?? null,
				message: `the primitive no longer carries ${marker}`,
			});
		}
	} catch {
		violations.push({
			rule: 'primitive-contract-missing',
			file: PRIMITIVE,
			line: null,
			wcag: null,
			message: `the obligation ${PRIMITIVE} is missing; the contract has no owner`,
		});
	}

	let cases = { expected: [...EXPECTED_CASE_IDS], found: [], missing: [...EXPECTED_CASE_IDS] };
	try {
		const source = stripComments(readFileSync(join(REPO_ROOT, PRIMITIVE), 'utf8'));
		const found = EXPECTED_CASE_IDS.filter((id) => source.includes(`'${id}'`));
		cases = {
			expected: [...EXPECTED_CASE_IDS],
			found,
			missing: EXPECTED_CASE_IDS.filter((id) => !found.includes(id)),
		};
		for (const id of cases.missing) {
			violations.push({
				rule: 'fixture-state-missing',
				file: PRIMITIVE,
				line: null,
				wcag: null,
				message: `fixture state ${id} is not part of TABLE_CODE_CASE_IDS; every state the Issue names has to stay reproducible`,
			});
		}
	} catch {
		// Already reported as primitive-contract-missing above.
	}

	return {
		filesScanned: files.length,
		violations,
		primitive,
		cases,
		humanEvaluation: HUMAN_EVALUATION,
	};
}

/** The human-readable report, with the two kinds of statement separated. */
export function renderGateSummary(evidence) {
	const lines = [];
	lines.push('table / code readability gate — Issue #407');
	lines.push(`scanned ${evidence.filesScanned} source file(s) under src/`);
	lines.push('');
	lines.push('machine-checked:');
	for (const marker of evidence.primitive.markers) {
		lines.push(
			`  ${marker.present ? 'ok  ' : 'FAIL'} ${marker.id.padEnd(16)} SC ${marker.wcag} — ${marker.claim}`,
		);
	}
	lines.push(
		`  ${evidence.cases.missing.length === 0 ? 'ok  ' : 'FAIL'} ${'fixture-states'.padEnd(16)} ${evidence.cases.found.length}/${evidence.cases.expected.length} — ${evidence.cases.found.join(', ') || 'none'}`,
	);
	const adHoc = evidence.violations.filter((entry) => entry.rule.endsWith('outside-primitive'));
	lines.push(
		`  ${adHoc.length === 0 ? 'ok  ' : 'FAIL'} ${'no-ad-hoc-boxes'.padEnd(16)} every table and every horizontal scroll box comes from the primitive (${adHoc.length} ad-hoc)`,
	);
	lines.push('');
	lines.push('not machine-checked (human evaluation):');
	for (const item of evidence.humanEvaluation) lines.push(`  - ${item}`);
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
