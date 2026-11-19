#!/usr/bin/env node
/**
 * Run every `scripts/*.test.mjs` (Issue #566).
 *
 * Usage:
 *   node scripts/run-script-tests.mjs           # run the suite, in order
 *   node scripts/run-script-tests.mjs --list    # diagnostic only, run nothing
 *
 * `--list` is refused when this file is invoked from the `test` npm
 * lifecycle. `test` must execute the suite; a leftover `--list` in
 * `package.json#scripts.test` would otherwise print the file list and
 * exit 0 with every script test skipped.
 *
 * `package.json#scripts.test` is now:
 *
 *   "test": "vitest run && node scripts/run-script-tests.mjs"
 *
 * which is what the acceptance criterion asks for: adding a test is
 * adding a `scripts/<name>.test.mjs` file, with no `package.json` edit
 * and therefore no merge conflict with a concurrent ticket that adds a
 * different test.
 *
 * Semantics preserved from the `&&` chain this replaces:
 * - files run in a deterministic (sorted) order, one child process at a
 *   time, from the repository root;
 * - the run stops at the FIRST failing file and exits with that child's
 *   exit code;
 * - a spawn error is an input error (2), never reported as a test
 *   failure;
 * - no secret value is read (AGENTS.md section 4).
 *
 * Exit codes: 0 = every discovered file passed, N = propagated from the
 * first failing file, 2 = bad input (no test file discovered, spawn
 * error, unknown option).
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverScriptTests, testFileArgv } from './_script-tests.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Run the discovered files in order, stopping at the first failure.
 *
 * Returns the exit code the caller should use.
 */
export function runScriptTests(files, { cwd = repoRoot, stream = process.stdout } = {}) {
	for (const [index, file] of files.entries()) {
		stream.write(`\n[${index + 1}/${files.length}] node ${testFileArgv(file).join(' ')}\n`);
		const result = spawnSync(process.execPath, testFileArgv(file), { cwd, stdio: 'inherit' });
		if (result.error) {
			process.stderr.write(`cannot run ${file}: ${result.error.message}\n`);
			return 2;
		}
		if (result.status !== 0) {
			process.stderr.write(
				`\n${file} failed at file ${index + 1}/${files.length} with exit code ${result.status}\n`,
			);
			return result.status ?? 1;
		}
	}
	return 0;
}

/**
 * Default concurrency for the parallel path (Issue #1007). Each child
 * is a `node --test` process whose cost is dominated by startup and
 * short assertion bursts, so the useful ceiling is well above the core
 * count; 8 keeps memory and fd pressure trivial while overlapping
 * nearly all of the ~430 ms/file serial cost.
 */
export const DEFAULT_JOBS = 8;

/** Resolve `--jobs` / `--jobs=N` out of argv. Returns `{ jobs, rest }`. */
function parseJobs(argv) {
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--jobs') {
			const value = argv[i + 1];
			const jobs = Number(value);
			if (!Number.isInteger(jobs) || jobs < 1) return { error: `invalid --jobs value: ${value}` };
			return { jobs, rest: [...argv.slice(0, i), ...argv.slice(i + 2)] };
		}
		if (arg.startsWith('--jobs=')) {
			const jobs = Number(arg.slice('--jobs='.length));
			if (!Number.isInteger(jobs) || jobs < 1) return { error: `invalid --jobs value: ${arg}` };
			return { jobs, rest: argv.filter((a) => a !== arg) };
		}
	}
	return { jobs: Math.min(DEFAULT_JOBS, Math.max(1, availableParallelism() ?? 1)), rest: argv };
}

/**
 * Run one test file in its own child with a private TMPDIR.
 *
 * The private temp dir is what makes concurrency safe: serial order
 * used to guarantee two files never saw each other's `mkdtemp`
 * output, and several fixtures assert on `os.tmpdir()` contents.
 * `os.tmpdir()` follows `TMPDIR`/`TMP`/`TEMP`, so pointing all three
 * at a per-file directory reproduces that isolation exactly.
 */
function runOneScriptTest(file, index, total, cwd) {
	const childTmp = join(tmpdir(), `mwst-${index}-${basename(file, '.test.mjs')}`);
	mkdirSync(childTmp, { recursive: true });
	return new Promise((resolve) => {
		const child = spawn(process.execPath, testFileArgv(file), {
			cwd,
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
			resolve({ index, file, code, signal, spawnError, stdout, stderr });
		});
	});
}

/**
 * Bounded-concurrency runner (Issue #1007).
 *
 * Files are pulled in sorted order by `jobs` workers. The first
 * completed failure stops NEW work from being scheduled; in-flight
 * files still finish so no child is orphaned mid-assertion. The
 * reported failure is the lowest sorted index among the files that
 * ran — deterministic regardless of which finished first.
 */
export async function runScriptTestsParallel(
	files,
	{ cwd = repoRoot, stream = process.stdout, jobs } = {},
) {
	const width = Math.max(1, Math.min(jobs, files.length));
	const total = files.length;
	const results = new Array(total);
	let nextIndex = 0;
	let stopScheduling = false;

	async function worker() {
		while (!stopScheduling && nextIndex < total) {
			const index = nextIndex;
			nextIndex += 1;
			const outcome = await runOneScriptTest(files[index], index, total, cwd);
			results[index] = outcome;
			stream.write(
				`\n[${index + 1}/${total}] node ${testFileArgv(files[index]).join(' ')}\n${outcome.stdout}${outcome.stderr}`,
			);
			if ((outcome.spawnError || outcome.code !== 0) && !stopScheduling) {
				stopScheduling = true;
			}
		}
	}

	await Promise.all(Array.from({ length: width }, () => worker()));

	const failures = results.filter(
		(outcome) => outcome && (outcome.spawnError || outcome.code !== 0),
	);
	if (failures.length === 0) {
		// Files past nextIndex never ran because a failure stopped
		// scheduling — but then failures.length would be > 0, so this
		// branch means every file ran and passed.
		return 0;
	}
	const first = failures.reduce((a, b) => (a.index < b.index ? a : b));
	if (first.spawnError) {
		process.stderr.write(`cannot run ${first.file}: ${first.spawnError.message}\n`);
		return 2;
	}
	process.stderr.write(
		`\n${first.file} failed at file ${first.index + 1}/${total} with exit code ${first.code ?? 1}\n`,
	);
	return first.code ?? 1;
}

export async function main(argv, { lifecycleEvent = process.env.npm_lifecycle_event } = {}) {
	const parsed = parseJobs(argv);
	if (parsed.error) {
		process.stderr.write(`${parsed.error}\n`);
		return 2;
	}
	const { jobs, rest } = parsed;
	const unknownFlags = rest.filter((argument) => argument !== '--list');
	if (unknownFlags.length > 0) {
		process.stderr.write(`unknown option(s): ${unknownFlags.join(', ')}\n`);
		return 2;
	}
	if (argv.includes('--list') && lifecycleEvent === 'test') {
		process.stderr.write(
			'--list is a read-only diagnostic and must not be the body of the `test` script. ' +
				'Run the suite instead.\n',
		);
		return 2;
	}

	let files;
	try {
		files = discoverScriptTests(resolve(repoRoot, 'scripts'));
	} catch (error) {
		process.stderr.write(`cannot read scripts/: ${error.message}\n`);
		return 2;
	}
	if (files.length === 0) {
		process.stderr.write('no scripts/*.test.mjs found — the discovery rule matches nothing\n');
		return 2;
	}

	if (rest.includes('--list')) {
		for (const file of files) process.stdout.write(`${file}\n`);
		return 0;
	}

	const status = jobs <= 1 ? runScriptTests(files) : await runScriptTestsParallel(files, { jobs });
	if (status === 0) process.stdout.write(`\nscript tests OK — ${files.length} file(s)\n`);
	return status;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	// `process.exitCode`, not `process.exit(code)`: the runner writes
	// progress and `--list` output through the async stdout queue, and
	// `process.exit` discards whatever is still queued when stdout is
	// a pipe — CI observed the listing cut off mid-alphabet
	// (`check-test-wiring.test.mjs` "lists exactly the files the runner
	// would execute"). Letting the event loop drain flushes the queue
	// before the process ends.
	main(process.argv.slice(2)).then((code) => {
		process.exitCode = code;
	});
}
