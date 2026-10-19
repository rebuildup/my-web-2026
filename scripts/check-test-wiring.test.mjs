import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	NODE_TEST_FLAGS,
	RUNNER_RELATIVE_PATH,
	SCRIPT_TEST_SUFFIX,
	discoverScriptTests,
	testFileArgv,
} from './_script-tests.mjs';
import { evaluateTestWiring } from './check-test-wiring.mjs';

/**
 * Fixture coverage for the test-wiring contract (Issue #566).
 *
 * The guarantee is unchanged — "every `scripts/*.test.mjs` is reachable
 * from an entry point" — but it is now proved against the discovery rule
 * the runner uses instead of against one enumerated line in
 * `package.json`. That only holds if the rule itself is proven: a runner
 * nothing invokes would make every file look wired while nothing runs
 * it, which is the exact failure this gate was written for.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS_DIR = join(REPO_ROOT, 'scripts');

const temporaryDirs = [];

after(() => {
	for (const dir of temporaryDirs) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway `scripts/` directory holding the given file names. */
function scriptsDirWith(files) {
	const dir = mkdtempSync(join(tmpdir(), 'test-wiring-'));
	temporaryDirs.push(dir);
	for (const name of files) writeFileSync(join(dir, name), '// fixture\n');
	return dir;
}

const RUNNER_SCRIPT = {
	scripts: { test: `vitest run && node ${RUNNER_RELATIVE_PATH}` },
};

describe('discoverScriptTests', () => {
	it('returns every *.test.mjs under scripts/, sorted, repo-relative', () => {
		const dir = scriptsDirWith(['b.test.mjs', 'a.test.mjs', 'helper.mjs', 'notes.test.ts']);
		assert.deepEqual(discoverScriptTests(dir), ['scripts/a.test.mjs', 'scripts/b.test.mjs']);
	});

	it('names the suffix the convention is defined by', () => {
		assert.equal(SCRIPT_TEST_SUFFIX, '.test.mjs');
	});

	it('passes type stripping and the test runner to every file', () => {
		assert.deepEqual(testFileArgv('scripts/a.test.mjs'), [
			...NODE_TEST_FLAGS,
			'scripts/a.test.mjs',
		]);
		assert.ok(NODE_TEST_FLAGS.includes('--test'));
		assert.ok(NODE_TEST_FLAGS.includes('--experimental-strip-types'));
	});
});

describe('evaluateTestWiring', () => {
	it('wires every discovered file once the runner is in an npm script', () => {
		const dir = scriptsDirWith(['a.test.mjs', 'b.test.mjs']);
		const result = evaluateTestWiring({ scriptsDir: dir, pkg: RUNNER_SCRIPT });
		assert.deepEqual(result.runnerScripts, ['test']);
		assert.deepEqual(result.orphans, []);
		assert.equal(result.discovered.length, 2);
	});

	it('finds nothing wired when no npm script invokes the runner', () => {
		const dir = scriptsDirWith(['a.test.mjs']);
		const result = evaluateTestWiring({
			scriptsDir: dir,
			pkg: { scripts: { test: 'vitest run' } },
		});
		assert.deepEqual(result.runnerScripts, []);
		assert.deepEqual(result.orphans, ['scripts/a.test.mjs']);
	});

	it('still counts a file an npm script names directly', () => {
		const dir = scriptsDirWith(['a.test.mjs', 'b.test.mjs']);
		const result = evaluateTestWiring({
			scriptsDir: dir,
			pkg: { scripts: { 'validate:fast': 'node --test scripts/a.test.mjs' } },
		});
		assert.deepEqual(result.literal, ['scripts/a.test.mjs']);
		assert.deepEqual(result.orphans, ['scripts/b.test.mjs']);
	});

	it('reads a manifest with no scripts block at all as "nothing wired"', () => {
		const dir = scriptsDirWith(['a.test.mjs']);
		const result = evaluateTestWiring({ scriptsDir: dir, pkg: {} });
		assert.deepEqual(result.orphans, ['scripts/a.test.mjs']);
		assert.deepEqual(result.staleExceptions, []);
	});
});

describe('this repository', () => {
	const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
	const result = evaluateTestWiring({ scriptsDir: SCRIPTS_DIR, pkg });

	it('reaches every scripts/*.test.mjs from the entry point', () => {
		assert.deepEqual(result.runnerScripts, ['test']);
		assert.deepEqual(result.orphans, []);
		assert.deepEqual(result.staleExceptions, []);
		assert.ok(result.discovered.length > 100, 'the suite should be non-trivial');
	});

	it('runs `pnpm run test` through the discovery runner', () => {
		assert.match(String(pkg.scripts.test), /vitest run && node scripts\/run-script-tests\.mjs$/);
	});

	it('lists exactly the files the runner would execute', () => {
		const listed = execFileSync(
			process.execPath,
			[join(REPO_ROOT, RUNNER_RELATIVE_PATH), '--list'],
			{
				cwd: REPO_ROOT,
				encoding: 'utf8',
			},
		)
			.trim()
			.split('\n');
		assert.deepEqual(listed, result.discovered);
	});

	it('fails when a test file is added but the runner is dropped', () => {
		const withoutRunner = evaluateTestWiring({
			scriptsDir: SCRIPTS_DIR,
			pkg: { scripts: { test: 'vitest run' } },
		});
		assert.deepEqual(withoutRunner.runnerScripts, []);
		assert.equal(withoutRunner.orphans.length, result.discovered.length);
	});
});
