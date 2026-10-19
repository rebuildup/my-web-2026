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

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
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

export function main(argv, { lifecycleEvent = process.env.npm_lifecycle_event } = {}) {
	const unknownFlags = argv.filter((argument) => argument !== '--list');
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

	if (argv.includes('--list')) {
		for (const file of files) process.stdout.write(`${file}\n`);
		return 0;
	}

	const status = runScriptTests(files);
	if (status === 0) process.stdout.write(`\nscript tests OK — ${files.length} file(s)\n`);
	return status;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	process.exit(main(process.argv.slice(2)));
}
