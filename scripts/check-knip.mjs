#!/usr/bin/env node
/**
 * knip diff gate (Issue #531).
 *
 * Runs knip in JSON mode and diffs the result against the committed
 * baseline in `quality/knip-baseline.json`. Existing findings stay in
 * the baseline (they are pre-existing debt tracked for a separate
 * cleanup PR); any NEW finding fails the gate with a non-zero exit.
 *
 * False-green policy: the baseline must never be emptied wholesale.
 * Update it only via `pnpm run knip:update` after the underlying cause
 * is resolved (dependency removed, export deleted, entrypoint wired),
 * and let the diff in that PR show exactly which findings disappeared.
 *
 * Issue #733 (V-6) adds a **ceiling**: the baseline is recorded debt,
 * and a debt that can grow without limit is not a debt but a budget
 * nobody decided. The baseline file carries `ceiling` (the number of
 * findings the repository tolerates) and `ceiling_rationale` (why that
 * number is the number). `--update` refuses to write a baseline larger
 * than the ceiling, so growing the recorded debt is an explicit, hand
 * edited change a reviewer can see — never a side effect of running a
 * command.
 *
 * Usage:
 *   node scripts/check-knip.mjs                  # diff against baseline
 *   node scripts/check-knip.mjs --update         # rewrite the baseline
 *   node scripts/check-knip.mjs --root <dir>     # analyze a fixture dir
 *
 * Exit codes: 0 = no new findings, 1 = new findings or knip failure.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baselineDocument, baselineViolations, planBaselineUpdate } from './_knip-baseline.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const update = argv.includes('--update');
const rootIdx = argv.indexOf('--root');
const ROOT_ARG = rootIdx === -1 ? undefined : argv[rootIdx + 1];
if (rootIdx !== -1 && (!ROOT_ARG || ROOT_ARG.startsWith('--'))) {
	console.error('::error::--root requires a directory argument');
	process.exit(1);
}
if (update && rootIdx !== -1) {
	console.error(
		'::error::--update only rewrites the repository baseline; it cannot be combined with --root. Use --root <dir> to inspect a fixture.',
	);
	process.exit(1);
}
const ROOT = ROOT_ARG ?? join(SCRIPT_DIR, '..');
const BASELINE_PATH = join(ROOT, 'quality', 'knip-baseline.json');
const KNIP_BIN = join(SCRIPT_DIR, '..', 'node_modules', 'knip', 'bin', 'knip.js');

// Issue categories we gate on. This is every key of knip's `ISSUE_TYPES`
// except `cycles`, which is an opt-in dependency-graph analysis rather
// than an unused-code finding: enabling it would turn "unused" into
// "cyclical", which is a different contract with a different owner (see
// quality/knip.md). Keeping the list complete matters: a category that
// knip reports but this gate does not read would be a silently green
// finding rather than a red one.
const GATED_KEYS = [
	'files',
	'dependencies',
	'devDependencies',
	'optionalPeerDependencies',
	'catalog',
	'catalogReferences',
	'exports',
	'nsExports',
	'types',
	'nsTypes',
	'namespaceMembers',
	'enumMembers',
	'unlisted',
	'unresolved',
	'duplicates',
	'binaries',
];

/** Run knip in the target root and return the parsed issue list. */
function runKnip() {
	const result = spawnSync(
		process.execPath,
		[KNIP_BIN, '--reporter', 'json', '--no-progress', '--no-exit-code'],
		{ cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
	);
	// `--no-exit-code` keeps the exit status at 0 while findings exist, so a
	// non-zero status can only mean knip itself did not complete (bad config,
	// unreadable workspace). Fail closed on it rather than parsing whatever
	// partial output happened to be on stdout.
	if (result.error || result.status !== 0 || !result.stdout) {
		const err = result.stderr?.trim() || result.error?.message || 'no output';
		console.error(`::error::knip failed to run: ${err}`);
		process.exit(1);
	}
	let parsed;
	try {
		parsed = JSON.parse(result.stdout);
	} catch {
		console.error('::error::knip output is not valid JSON');
		process.exit(1);
	}
	return parsed.issues ?? [];
}

/** Normalize a per-file issue object into flat "category file[:symbol]" strings. */
function normalizeEntry(issue) {
	const entries = [];
	// Most findings carry a file. Project-level categories (duplicates,
	// binaries) may not, so fall back to a stable label instead of
	// interpolating `undefined` into the baseline entry.
	const file = issue.file ?? '<project>';
	for (const key of GATED_KEYS) {
		for (const item of issue[key] ?? []) {
			// Files have {name}; symbols have {name, line, col}; deps have {name, filePath}.
			const label = item.name ?? item.namePath ?? '<unknown>';
			// For `files` the reported name IS the path, so repeating it would
			// make the baseline read `files <path> <path>`. Emit the two-token
			// form there and keep the three-token form where the label adds
			// information (symbol, dependency, member).
			entries.push(label === file ? `${key} ${file}` : `${key} ${file} ${label}`);
		}
	}
	return entries;
}

const issues = runKnip();
const current = issues.flatMap(normalizeEntry).sort();
const currentSet = new Set(current);

/**
 * The rationale a baseline written from scratch carries.
 *
 * The rationale is the human sentence attached to a policy number; it is
 * never generated from the findings themselves, because a number that
 * explains itself is not a decision anybody made.
 */
if (update) {
	// The ceiling is read, never raised: `--update` may shrink the recorded
	// debt, but it may not grow it. Growing it is a hand edit of
	// `quality/knip-baseline.json` that a reviewer sees in the diff.
	let previous = null;
	try {
		previous = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
	} catch {
		previous = null;
	}
	const plan = planBaselineUpdate(previous, current);
	if (!plan.allowed) {
		console.error(`::error::${plan.reason}`);
		process.exit(1);
	}
	mkdirSync(dirname(BASELINE_PATH), { recursive: true });
	writeFileSync(
		BASELINE_PATH,
		`${JSON.stringify(baselineDocument({ ...plan, findings: current }), null, '\t')}\n`,
	);
	console.log(
		`knip baseline updated: ${current.length} findings (ceiling ${plan.ceiling}) -> quality/knip-baseline.json`,
	);
	process.exit(0);
}

// The repository baseline is mandatory and fail-closed: without it the gate
// would silently degrade into "everything is new". A `--root` fixture may
// legitimately carry no baseline (meaning "no debt recorded yet"), but a
// malformed one is still an error.
let baseline = { findings: [] };
let baselineRead = false;
try {
	baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
	baselineRead = true;
} catch (error) {
	const missing = error?.code === 'ENOENT';
	if (!missing || rootIdx === -1) {
		console.error(
			`::error::baseline missing or unreadable: ${BASELINE_PATH}. Run \`pnpm run knip:update\` and review the diff.`,
		);
		process.exit(1);
	}
}

// Issue #733 (V-6): a recorded debt without a ceiling is unbounded. The
// ceiling is checked here as well as in `--update`, so a hand-edited
// baseline that grew past it is rejected instead of accepted.
if (baselineRead) {
	const violations = baselineViolations(baseline);
	if (violations.length > 0) {
		for (const violation of violations) console.error(`::error::${violation}`);
		process.exit(1);
	}
}
const baselineSet = new Set(baseline.findings);

const added = current.filter((e) => !baselineSet.has(e));
const resolved = [...baselineSet].filter((e) => !currentSet.has(e));

console.log(
	`knip: ${current.length} findings (${baselineSet.size} baselined, ${added.length} new${
		baselineRead ? `, ceiling ${baseline.ceiling}` : ''
	})`,
);

if (resolved.length > 0) {
	// `::warning::` so a shrinking baseline is visible in the GitHub Actions
	// annotations instead of only in the raw log. It stays a warning: the
	// gate contract is "new findings fail", and trunk routinely resolves
	// findings in a different ticket (policy: quality/knip.md).
	console.log(
		`::warning::knip: ${resolved.length} baselined findings no longer appear. Run \`pnpm run knip:update\` so the baseline reflects the resolved debt.`,
	);
}

if (added.length > 0) {
	console.error(
		'::error::knip found NEW unused dependencies / exports / files. Fix them or, if they are legitimate dynamic references, extend knip.json with a documented entrypoint:',
	);
	for (const entry of added) console.error(`  ${entry}`);
	process.exit(1);
}

process.exit(0);
