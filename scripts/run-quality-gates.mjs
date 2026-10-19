#!/usr/bin/env node
/**
 * Run one declared quality gate from `quality/profile.yaml` (Issue #566).
 *
 * Usage:
 *   node scripts/run-quality-gates.mjs fast
 *   node scripts/run-quality-gates.mjs integration
 *   node scripts/run-quality-gates.mjs release
 *   node scripts/run-quality-gates.mjs fast --list   # print the plan, run nothing
 *
 * What changed
 * ------------
 * `package.json#scripts["validate:fast"]` was a single `&&`-joined
 * line. Every ticket that added a gate had to rewrite the whole line,
 * so parallel ticket PRs collided on it mechanically (17 of 20
 * concurrent 0.6.3 tickets conflicted during a trial merge). The
 * ordered roster now lives one command per line in
 * `quality/profile.yaml#gates.<name>.components`, and these npm scripts
 * are one line each:
 *
 *   "validate:fast":        "node scripts/run-quality-gates.mjs fast"
 *   "validate:integration": "node scripts/run-quality-gates.mjs integration"
 *   "validate:release":     "node scripts/run-quality-gates.mjs release"
 *
 * Semantics preserved (acceptance criterion "existing gate order and
 * failure exit codes do not change"):
 * - steps run in the order written in the profile, which is the order
 *   the `&&` chain used;
 * - the run stops at the FIRST failing step and exits with that step's
 *   exit code, exactly like the shell chain;
 * - a step's stdout / stderr are inherited, so nothing is buffered,
 *   swallowed or reordered;
 * - no secret value is read (AGENTS.md section 4): this script reads
 *   `quality/profile.yaml` and `package.json`, and runs commands.
 *
 * Exit codes: 0 = every declared step passed, 1 = a declared step
 * failed with exit 1, N = propagated from the failing step, 2 = the
 * plan itself cannot be read or is invalid (usage error).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	GATE_NAMES,
	PROFILE_RELATIVE_PATH,
	parseGateProfile,
	resolveGatePlan,
	scriptNamesOf,
	validateGateComponents,
} from './_quality-gate-plan.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readRepoFile(relativePath) {
	return readFileSync(join(repoRoot, relativePath), 'utf8');
}

/**
 * Resolve the declared plan for one gate.
 *
 * Returns `{ plan, problems }`; `problems` explains, per line, why the
 * plan cannot be executed as written (unknown gate, composition cycle,
 * a `pnpm run <script>` that no longer exists).
 */
export function buildPlan(gateName, { profileText, packageJsonText } = {}) {
	const text = profileText ?? readRepoFile(PROFILE_RELATIVE_PATH);
	const pkgText = packageJsonText ?? readRepoFile('package.json');
	const { gates } = parseGateProfile(text);
	const plan = resolveGatePlan(gates, gateName);
	return { plan, problems: validateGateComponents(plan, scriptNamesOf(JSON.parse(pkgText))) };
}

/**
 * Execute a plan in order, stopping at the first failure.
 *
 * Returns the exit code the caller should use. A spawn error (an
 * unrunnable command) is reported as 2 — an input error, not a gate
 * verdict — so it can never be mistaken for "the gate failed".
 */
export function runPlan(plan, { cwd = repoRoot, stream = process.stdout } = {}) {
	for (const [index, command] of plan.entries()) {
		stream.write(`\n[${index + 1}/${plan.length}] ${command}\n`);
		const result = spawnSync(command, { cwd, shell: true, stdio: 'inherit' });
		if (result.error) {
			process.stderr.write(`cannot run "${command}": ${result.error.message}\n`);
			return 2;
		}
		if (result.status !== 0) {
			process.stderr.write(
				`\n${command} failed at step ${index + 1}/${plan.length} with exit code ${result.status}\n`,
			);
			return result.status ?? 1;
		}
	}
	return 0;
}

function main(argv) {
	const flags = argv.filter((argument) => argument.startsWith('-'));
	const names = argv.filter((argument) => !argument.startsWith('-'));
	const listOnly = flags.includes('--list');
	const unknownFlags = flags.filter((flag) => flag !== '--list');

	if (unknownFlags.length > 0) {
		process.stderr.write(`unknown option(s): ${unknownFlags.join(', ')}\n`);
		return 2;
	}
	if (names.length !== 1 || !GATE_NAMES.includes(names[0])) {
		process.stderr.write(
			`usage: node scripts/run-quality-gates.mjs <${GATE_NAMES.join('|')}> [--list]\n`,
		);
		return 2;
	}
	const gateName = names[0];

	let built;
	try {
		built = buildPlan(gateName);
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		return 2;
	}
	const { plan } = built;
	if (built.problems.length > 0) {
		process.stderr.write('the declared gate plan cannot run:\n');
		for (const problem of built.problems) process.stderr.write(`  - ${problem}\n`);
		process.stderr.write(
			`\n${PROFILE_RELATIVE_PATH} is the declaration; fix the line or the script name.\n`,
		);
		return 2;
	}

	if (listOnly) {
		for (const [index, command] of plan.entries()) {
			process.stdout.write(`${index + 1}\t${command}\n`);
		}
		return 0;
	}

	const status = runPlan(plan);
	if (status === 0)
		process.stdout.write(`\nvalidate:${gateName} OK — ${plan.length} declared step(s)\n`);
	return status;
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
	process.exit(main(process.argv.slice(2)));
}
