#!/usr/bin/env node
/**
 * Run one declared quality gate from `quality/profile.yaml` (Issue #566).
 *
 * Usage:
 *   node scripts/run-quality-gates.mjs fast
 *   node scripts/run-quality-gates.mjs integration
 *   node scripts/run-quality-gates.mjs release
 *   node scripts/run-quality-gates.mjs fast --list   # diagnostic only, run nothing
 *   node scripts/run-quality-gates.mjs fast --jobs 2 # bounded gate concurrency
 *
 * Concurrency (Issue #1007, second half)
 * --------------------------------------
 * The plan still executes in the order written — that order is the
 * contract — but components named in
 * `scripts/_quality-gate-parallel.mjs#PARALLEL_SAFE_SCRIPTS` (the
 * audited read-only `pnpm run <script>` checks) may overlap, up to
 * `--jobs` at once (default 4, `QUALITY_GATES_JOBS` overrides, `1`
 * restores the pure serial run). Everything else — builds, reporters,
 * unaudited scripts, raw commands — keeps its serial slot. Inside a
 * parallel segment the first completed failure stops NEW work from
 * being scheduled, in-flight gates finish, and the reported failure
 * is the lowest plan index among the failures — the same contract
 * `scripts/run-script-tests.mjs` uses for script tests. Output stays
 * deterministic: each gate's `[i/N]` header, buffered stdout/stderr
 * and `(Nms)` timing line are flushed in plan order as soon as every
 * earlier gate in the segment has reported, so the log reads exactly
 * like the serial one, only sooner.
 *
 * `--list` is deliberately refused when this file is invoked from the
 * `validate:fast` / `validate:integration` / `validate:release` npm
 * lifecycle. Those entry points must RUN the plan; a merge-resolution
 * leftover that appends `--list` would otherwise print a plan and exit
 * 0 while every gate (typecheck, vitest, secret scan) was skipped.
 *
 * What changed
 * ------------
 * `package.json#scripts["validate:fast"]` was a single `&&`-joined
 * line. Every ticket that added a gate had to rewrite the whole line,
 * so parallel ticket PRs collided on it mechanically (in a trial merge
 * of 20 concurrent tickets, 17 conflicted on it). The
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
 * - Issue #1007 adds one measurement line per step (`  (Nms)` after a
 *   green step, the elapsed time inside the failure line), so the CI
 *   log finally carries the per-component breakdown the serial plan
 *   never recorded. It changes no gate, order or exit code;
 * - no secret value is read (AGENTS.md section 4): this script reads
 *   `quality/profile.yaml` and `package.json`, and runs commands.
 *
 * Exit codes: 0 = every declared step passed, 1 = a declared step
 * failed with exit 1, N = propagated from the failing step, 2 = the
 * plan itself cannot be read or is invalid (usage error).
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { availableParallelism, constants as osConstants, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { segmentPlan } from './_quality-gate-parallel.mjs';
import {
	GATE_NAMES,
	PROFILE_RELATIVE_PATH,
	parseGateProfile,
	resolveGatePlan,
	scriptNamesOf,
	validateGateComponents,
} from './_quality-gate-plan.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** npm lifecycle events that must execute the plan, never list it. */
const RUN_LIFECYCLE_EVENTS = new Set(GATE_NAMES.map((gate) => `validate:${gate}`));

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
 * Default gate-level concurrency (Issue #1007). Each parallel child is
 * a `pnpm run <script>` whose own cost ranges from a ~300 ms biome
 * pass to the ~3 min `test` gate; 4 keeps memory and fd pressure
 * trivial on a 4-core CI runner while still overlapping the heavy
 * gates (`test`, `typecheck`, `storybook:ownership:check`, `knip`,
 * `secret:scan`) with the ~60 sub-second checks.
 */
export const DEFAULT_GATE_JOBS = 4;

/**
 * The exit code a finished child maps to, shared by the serial and
 * parallel paths. A child killed by a signal has `status`/`code`
 * `null`; the historical `&&` chain let the shell report
 * `128 + signal` (e.g. 143 for SIGTERM), so preserve that meaning
 * instead of collapsing every signal into 1.
 */
function childExitCode(code, signal) {
	return code ?? 128 + (osConstants.signals[signal] ?? 0);
}

function childFailureReason(code, signal) {
	return code === null || code === undefined ? `signal ${signal}` : `exit code ${code}`;
}

/**
 * Run one segment of plan items strictly in order with live output —
 * the historical behaviour, kept for serial segments and for
 * `--jobs 1` / `QUALITY_GATES_JOBS=1`.
 */
function runSerialSegment(items, total, { cwd, stream }) {
	for (const { index, command } of items) {
		stream.write(`\n[${index + 1}/${total}] ${command}\n`);
		// Issue #1007: per-component duration. The serial plan had no
		// timing at all, so "which gate dominates validate:fast" could
		// only be guessed. One line per step lands in the CI log next
		// to the step's own output; the parallelisation work that
		// follows is ordered by this measurement, not by intuition.
		const startedAt = Date.now();
		const result = spawnSync(command, { cwd, shell: true, stdio: 'inherit' });
		const elapsedMs = Date.now() - startedAt;
		if (result.error) {
			process.stderr.write(`cannot run "${command}": ${result.error.message}\n`);
			return 2;
		}
		if (result.status !== 0) {
			const exitCode = childExitCode(result.status, result.signal);
			process.stderr.write(
				`\n${command} failed at step ${index + 1}/${total} with ${childFailureReason(result.status, result.signal)} (${elapsedMs}ms)\n`,
			);
			return exitCode;
		}
		stream.write(`  (${elapsedMs}ms)\n`);
	}
	return 0;
}

/**
 * Run one gate inside a parallel segment.
 *
 * stdout / stderr are buffered (not inherited) so the segment can
 * flush each gate's block in plan order — deterministic output is
 * the contract. Each child also gets a private TMPDIR, the same
 * isolation `scripts/run-script-tests.mjs` gives every script test:
 * two gates must never observe each other's `mkdtemp` output.
 */
function runOneGate({ index, command }, { cwd }) {
	const childTmp = mkdtempSync(join(tmpdir(), `mwqg-${index}-`));
	const startedAt = Date.now();
	return new Promise((resolvePromise) => {
		const child = spawn(command, {
			cwd,
			shell: true,
			env: { ...process.env, TMPDIR: childTmp, TMP: childTmp, TEMP: childTmp },
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		let spawnError = null;
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('error', (error) => {
			spawnError = error;
		});
		child.on('close', (code, signal) => {
			rmSync(childTmp, { recursive: true, force: true });
			resolvePromise({
				index,
				command,
				code,
				signal,
				spawnError,
				stdout,
				stderr,
				elapsedMs: Date.now() - startedAt,
			});
		});
	});
}

/**
 * Run one parallel segment with bounded concurrency.
 *
 * Items are pulled in plan order by `jobs` workers. The first
 * completed failure stops NEW work from being scheduled; in-flight
 * gates still finish so no child is orphaned mid-assertion. Output
 * is flushed in plan order: `flushPos` only advances over a
 * contiguous prefix of completed results, so a slow early gate
 * delays later gates' blocks (exactly like the serial run) while a
 * fast gate's block still lands as soon as its turn comes.
 *
 * The reported failure is the lowest plan index among the gates that
 * ran — deterministic regardless of which finished first. Returns
 * the exit code the caller should use (2 for a spawn error).
 */
export async function runParallelSegment(
	items,
	total,
	{ cwd = repoRoot, stream = process.stdout, jobs } = {},
) {
	const width = Math.max(1, Math.min(jobs, items.length));
	const results = new Array(items.length);
	let nextPosition = 0;
	let stopScheduling = false;
	let flushPos = 0;

	const flushReady = () => {
		while (flushPos < results.length && results[flushPos]) {
			const outcome = results[flushPos];
			flushPos += 1;
			stream.write(
				`\n[${outcome.index + 1}/${total}] ${outcome.command}\n${outcome.stdout}${outcome.stderr}`,
			);
			if (!outcome.spawnError && outcome.code === 0) {
				stream.write(`  (${outcome.elapsedMs}ms)\n`);
			}
		}
	};

	async function worker() {
		while (!stopScheduling && nextPosition < items.length) {
			const position = nextPosition;
			nextPosition += 1;
			const outcome = await runOneGate(items[position], { cwd });
			results[position] = outcome;
			flushReady();
			if ((outcome.spawnError || outcome.code !== 0) && !stopScheduling) {
				stopScheduling = true;
			}
		}
	}

	await Promise.all(Array.from({ length: width }, () => worker()));
	flushReady();

	const failures = results.filter(
		(outcome) => outcome && (outcome.spawnError || outcome.code !== 0),
	);
	if (failures.length === 0) return 0;
	const first = failures.reduce((a, b) => (a.index < b.index ? a : b));
	if (first.spawnError) {
		process.stderr.write(`cannot run "${first.command}": ${first.spawnError.message}\n`);
		return 2;
	}
	process.stderr.write(
		`\n${first.command} failed at step ${first.index + 1}/${total} with ${childFailureReason(first.code, first.signal)} (${first.elapsedMs}ms)\n`,
	);
	return childExitCode(first.code, first.signal);
}

/**
 * Execute a plan in order, stopping at the first failure.
 *
 * `jobs > 1` lets the audited parallel-safe components overlap inside
 * their segments (`scripts/_quality-gate-parallel.mjs`); every other
 * component — and the whole plan when `jobs <= 1` — runs through the
 * serial path unchanged. Returns the exit code the caller should use.
 * A spawn error (an unrunnable command) is reported as 2 — an input
 * error, not a gate verdict — so it can never be mistaken for "the
 * gate failed".
 */
export async function runPlan(plan, { cwd = repoRoot, stream = process.stdout, jobs = 1 } = {}) {
	const segments = segmentPlan(plan);
	const total = plan.length;
	const parallel = jobs > 1 && segments.some((segment) => segment.parallel);
	for (const segment of segments) {
		const status =
			parallel && segment.parallel
				? await runParallelSegment(segment.items, total, { cwd, stream, jobs })
				: runSerialSegment(segment.items, total, { cwd, stream });
		if (status !== 0) return status;
	}
	return 0;
}

/**
 * The final line a green gate prints.
 *
 * Exported (and asserted by `scripts/_quality-gate-plan.test.mjs`)
 * because it runs only after a whole plan has passed, which no unit
 * test can reach cheaply — an unimported helper here would otherwise
 * only surface on the slowest possible CI run.
 */
export function successLine(gateName, steps) {
	return `\nvalidate:${gateName} OK — ${steps} declared step(s)\n`;
}

/** Environment variable that overrides the default gate concurrency. */
export const JOBS_ENV_VAR = 'QUALITY_GATES_JOBS';

/**
 * Resolve `--jobs` / `--jobs=N` out of argv, falling back to
 * `QUALITY_GATES_JOBS` and then the default. Returns
 * `{ jobs, rest, error }`; an invalid value is a usage error (2),
 * never a silently serial or unbounded run.
 */
export function parseJobs(argv, env = process.env) {
	const readValue = (raw) => {
		const jobs = Number(raw);
		if (!Number.isInteger(jobs) || jobs < 1) return null;
		return jobs;
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--jobs') {
			const jobs = readValue(argv[i + 1]);
			if (jobs === null) return { error: `invalid --jobs value: ${argv[i + 1]}` };
			return {
				jobs,
				rest: [...argv.slice(0, i), ...argv.slice(i + 2)],
			};
		}
		if (arg.startsWith('--jobs=')) {
			const jobs = readValue(arg.slice('--jobs='.length));
			if (jobs === null) return { error: `invalid --jobs value: ${arg}` };
			return { jobs, rest: argv.filter((a) => a !== arg) };
		}
	}
	const fromEnv = env[JOBS_ENV_VAR];
	if (fromEnv !== undefined && fromEnv !== '') {
		const jobs = readValue(fromEnv);
		if (jobs === null) return { error: `invalid ${JOBS_ENV_VAR}: ${fromEnv}` };
		return { jobs, rest: argv };
	}
	return {
		jobs: Math.min(DEFAULT_GATE_JOBS, Math.max(1, availableParallelism() ?? 1)),
		rest: argv,
	};
}

/**
 * CLI entry point.
 *
 * Returns a promise for the process exit code: 0 when the plan ran
 * green, 2 for a usage / plan error, otherwise the failing step's own
 * code. Async because parallel segments await their children; the
 * caller assigns `process.exitCode` (not `process.exit`) so buffered
 * stdout flushes first — the same reason `run-script-tests.mjs`
 * does.
 *
 * `lifecycleEvent` defaults to `process.env.npm_lifecycle_event`, which
 * pnpm sets to the script name while it runs an npm script. Tests pass
 * it explicitly so the refusal is asserted without spawning npm.
 */
export async function main(
	argv,
	{ lifecycleEvent = process.env.npm_lifecycle_event, env = process.env } = {},
) {
	const parsed = parseJobs(argv, env);
	if (parsed.error) {
		process.stderr.write(`${parsed.error}\n`);
		return 2;
	}
	const { jobs } = parsed;
	const flags = parsed.rest.filter((argument) => argument.startsWith('-'));
	const names = parsed.rest.filter((argument) => !argument.startsWith('-'));
	const listOnly = flags.includes('--list');
	const unknownFlags = flags.filter((flag) => flag !== '--list');

	if (unknownFlags.length > 0) {
		process.stderr.write(`unknown option(s): ${unknownFlags.join(', ')}\n`);
		return 2;
	}
	if (listOnly && RUN_LIFECYCLE_EVENTS.has(lifecycleEvent)) {
		process.stderr.write(
			`--list is a read-only diagnostic and must not be the body of an npm validate script (npm_lifecycle_event=${lifecycleEvent}). Run the gate instead.\n`,
		);
		return 2;
	}
	if (names.length !== 1 || !GATE_NAMES.includes(names[0])) {
		process.stderr.write(
			`usage: node scripts/run-quality-gates.mjs <${GATE_NAMES.join('|')}> [--list] [--jobs N]\n`,
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

	const status = await runPlan(plan, { jobs });
	if (status === 0) process.stdout.write(successLine(gateName, plan.length));
	return status;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	// `process.exitCode`, not `process.exit(code)`: parallel segments
	// flush buffered child output through the async stdout queue, and
	// `process.exit` discards whatever is still queued when stdout is
	// a pipe.
	main(process.argv.slice(2)).then((code) => {
		process.exitCode = code;
	});
}
