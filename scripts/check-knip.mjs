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

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const update = argv.includes('--update');
const rootIdx = argv.indexOf('--root');
const ROOT = rootIdx !== -1 ? argv[rootIdx + 1] : join(SCRIPT_DIR, '..');
const BASELINE_PATH = join(ROOT, 'quality', 'knip-baseline.json');
const KNIP_BIN = join(SCRIPT_DIR, '..', 'node_modules', 'knip', 'bin', 'knip.js');

// Issue categories we gate on. `files`, `dependencies`/`devDependencies`,
// `exports`/`types` and `unlisted` are the categories knip reports; each
// entry is normalized to "category file[:symbol]" for diffing.
const GATED_KEYS = [
	'files',
	'dependencies',
	'devDependencies',
	'optionalPeerDependencies',
	'exports',
	'types',
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
	if (result.error || !result.stdout) {
		const err = result.stderr || result.error?.message || 'no output';
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
	for (const key of GATED_KEYS) {
		for (const item of issue[key] ?? []) {
			// Files have {name}; symbols have {name, line, col}; deps have {name, filePath}.
			entries.push(`${key} ${issue.file} ${item.name}`);
		}
	}
	return entries;
}

const issues = runKnip();
const current = issues.flatMap(normalizeEntry).sort();
const currentSet = new Set(current);

if (update) {
	mkdirSync(dirname(BASELINE_PATH), { recursive: true });
	writeFileSync(
		BASELINE_PATH,
		`${JSON.stringify(
			{
				_schema: 1,
				// Regenerate with `pnpm run knip:update`. Do not hand-edit to
				// silence findings: remove the underlying cause instead (Issue #531).
				updated_with: 'scripts/check-knip.mjs --update',
				findings: current,
			},
			null,
			'\t',
		)}\n`,
	);
	console.log(`knip baseline updated: ${current.length} findings -> quality/knip-baseline.json`);
	process.exit(0);
}

let baseline = { findings: [] };
if (rootIdx === -1) {
	try {
		baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
	} catch {
		console.error(
			`::error::baseline missing or unreadable: ${BASELINE_PATH}. Run \`pnpm run knip:update\` and review the diff.`,
		);
		process.exit(1);
	}
}
const baselineSet = new Set(baseline.findings);

const added = current.filter((e) => !baselineSet.has(e));
const resolved = [...baselineSet].filter((e) => !currentSet.has(e));

console.log(
	`knip: ${current.length} findings (${baselineSet.size} baselined, ${added.length} new)`,
);

if (resolved.length > 0) {
	console.log(
		`knip: ${resolved.length} baselined findings no longer appear. Run \`pnpm run knip:update\` so the baseline reflects the resolved debt.`,
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
