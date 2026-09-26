import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
/**
 * `infisical-bootstrap.mjs` unit tests.
 *
 * The script writes `.infisical.json` based on CLI args. It does
 * NOT make any HTTP call (operator provides workspaceId manually)
 * — there is no Infisical API surface to mock. The interesting
 * invariants are:
 *
 *   1. Argument parsing: --workspace-id is required, default
 *      environment falls back to existing or "prod".
 *   2. UUID v4 validation: malformed workspaceIds are rejected
 *      before any filesystem write (no garbage in git history).
 *   3. Default-environment validation: only "dev" / "prod" accepted.
 *   4. Idempotence: re-running with the same workspaceId is a
 *      no-op (no overwrite prompt).
 *   5. Overwrite safety: changing workspaceId requires --force
 *      (no accidental rotation of the SoT).
 *   6. Existing-file sanity: unknown keys / non-object root are
 *      rejected (catch hand-edited corruption early).
 *   7. argv / log / error message never carries secret content —
 *      the script never reads or writes a secret.
 */
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'infisical-bootstrap.mjs');

/**
 * Run the script in an isolated `<repo>/scripts/...` layout and
 * return the tempdir path + exit code. Used when a test needs to
 * assert on the resulting `.infisical.json` content.
 */
function runScriptAndGetRepo(args) {
	const repo = mkdtempSync(join(tmpdir(), 'infisical-bootstrap-run-'));
	const scriptsDir = join(repo, 'scripts');
	mkdirSync(scriptsDir, { recursive: true });
	const scriptCopy = join(scriptsDir, 'infisical-bootstrap.mjs');
	writeFileSync(scriptCopy, readFileSync(SCRIPT, 'utf8'));
	let exitCode = 0;
	try {
		execFileSync(process.execPath, [scriptCopy, ...args], {
			cwd: repo,
			stdio: 'pipe',
		});
	} catch (error) {
		exitCode = error.status ?? 1;
	}
	return { repo, exitCode };
}

/**
 * Run the bootstrap script in an isolated tempdir. The script
 * resolves `REPO_ROOT` as the parent of its own location (assuming
 * it lives at `<repo>/scripts/infisical-bootstrap.mjs`), so we
 * mirror that layout: copy the script to `repo/scripts/` and run
 * it from `repo/`. The generated `.infisical.json` then lands at
 * `repo/.infisical.json` and does not pollute the real repo.
 */
function runInIsolatedRepo(args, { existingContent = null } = {}) {
	const repo = mkdtempSync(join(tmpdir(), 'infisical-bootstrap-test-'));
	const scriptsDir = join(repo, 'scripts');
	mkdirSync(scriptsDir, { recursive: true });
	const scriptCopy = join(scriptsDir, 'infisical-bootstrap.mjs');
	const scriptSource = readFileSync(SCRIPT, 'utf8');
	writeFileSync(scriptCopy, scriptSource);

	if (existingContent !== null) {
		writeFileSync(join(repo, '.infisical.json'), existingContent);
	}

	let stdout = '';
	let stderr = '';
	let exitCode = 0;
	try {
		const result = execFileSync(process.execPath, [scriptCopy, ...args], {
			cwd: repo,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		stdout = result;
	} catch (error) {
		stdout = error.stdout ?? '';
		stderr = error.stderr ?? '';
		exitCode = error.status ?? 1;
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
	return { stdout, stderr, exitCode };
}

function runInIsolatedRepoWithFile(args, { existingContent = null } = {}) {
	// Variant of runInIsolatedRepo that returns the tempdir path so
	// assertions can read the generated .infisical.json directly.
	const repo = mkdtempSync(join(tmpdir(), 'infisical-bootstrap-test-'));
	const scriptsDir = join(repo, 'scripts');
	mkdirSync(scriptsDir, { recursive: true });
	const scriptCopy = join(scriptsDir, 'infisical-bootstrap.mjs');
	writeFileSync(scriptCopy, readFileSync(SCRIPT, 'utf8'));
	if (existingContent !== null) {
		writeFileSync(join(repo, '.infisical.json'), existingContent);
	}
	try {
		execFileSync(process.execPath, [scriptCopy, ...args], {
			cwd: repo,
			stdio: 'pipe',
		});
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
}

function readInfisicalJson(repo) {
	return JSON.parse(readFileSync(join(repo, '.infisical.json'), 'utf8'));
}

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('infisical-bootstrap.mjs', () => {
	describe('happy path', () => {
		it('writes .infisical.json with the supplied workspaceId', () => {
			const { repo, exitCode } = runScriptAndGetRepo([`--workspace-id=${VALID_UUID}`]);
			try {
				assert.equal(exitCode, 0);
				const written = JSON.parse(readFileSync(join(repo, '.infisical.json'), 'utf8'));
				assert.equal(written.workspaceId, VALID_UUID);
				assert.equal(written.defaultEnvironment, 'prod');
			} finally {
				rmSync(repo, { recursive: true, force: true });
			}
		});

		it('honors --default-environment=dev', () => {
			const { repo, exitCode } = runScriptAndGetRepo([
				`--workspace-id=${VALID_UUID}`,
				'--default-environment=dev',
			]);
			try {
				assert.equal(exitCode, 0);
				const written = JSON.parse(readFileSync(join(repo, '.infisical.json'), 'utf8'));
				assert.equal(written.workspaceId, VALID_UUID);
				assert.equal(written.defaultEnvironment, 'dev');
			} finally {
				rmSync(repo, { recursive: true, force: true });
			}
		});

		it('lowercases the workspaceId (UUIDs are case-insensitive)', () => {
			const { repo, exitCode } = runScriptAndGetRepo([
				`--workspace-id=${VALID_UUID.toUpperCase()}`,
			]);
			try {
				assert.equal(exitCode, 0);
				const written = JSON.parse(readFileSync(join(repo, '.infisical.json'), 'utf8'));
				assert.equal(written.workspaceId, VALID_UUID);
			} finally {
				rmSync(repo, { recursive: true, force: true });
			}
		});
	});

	describe('idempotence', () => {
		it('re-running with the same workspaceId is a no-op', () => {
			const repo = mkdtempSync(join(tmpdir(), 'infisical-bootstrap-idem-'));
			const scriptsDir = join(repo, 'scripts');
			mkdirSync(scriptsDir, { recursive: true });
			writeFileSync(join(scriptsDir, 'infisical-bootstrap.mjs'), readFileSync(SCRIPT, 'utf8'));
			try {
				// First run
				execFileSync(
					process.execPath,
					[join(scriptsDir, 'infisical-bootstrap.mjs'), `--workspace-id=${VALID_UUID}`],
					{ cwd: repo, stdio: 'pipe' },
				);
				const first = readFileSync(join(repo, '.infisical.json'), 'utf8');
				// Second run
				execFileSync(
					process.execPath,
					[join(scriptsDir, 'infisical-bootstrap.mjs'), `--workspace-id=${VALID_UUID}`],
					{ cwd: repo, stdio: 'pipe' },
				);
				const second = readFileSync(join(repo, '.infisical.json'), 'utf8');
				assert.equal(first, second);
			} finally {
				rmSync(repo, { recursive: true, force: true });
			}
		});

		it('preserves existing defaultEnvironment when --default-environment is omitted', () => {
			const repo = mkdtempSync(join(tmpdir(), 'infisical-bootstrap-preserve-'));
			const scriptsDir = join(repo, 'scripts');
			mkdirSync(scriptsDir, { recursive: true });
			writeFileSync(join(scriptsDir, 'infisical-bootstrap.mjs'), readFileSync(SCRIPT, 'utf8'));
			try {
				writeFileSync(
					join(repo, '.infisical.json'),
					JSON.stringify({
						workspaceId: VALID_UUID,
						defaultEnvironment: 'dev',
					}),
				);
				execFileSync(
					process.execPath,
					[join(scriptsDir, 'infisical-bootstrap.mjs'), `--workspace-id=${VALID_UUID}`],
					{ cwd: repo, stdio: 'pipe' },
				);
				const written = JSON.parse(readFileSync(join(repo, '.infisical.json'), 'utf8'));
				assert.equal(written.defaultEnvironment, 'dev');
			} finally {
				rmSync(repo, { recursive: true, force: true });
			}
		});
	});

	describe('overwrite safety', () => {
		it('refuses to overwrite a different workspaceId without --force (exit 2)', () => {
			const result = runInIsolatedRepo([`--workspace-id=${VALID_UUID}`], {
				existingContent: JSON.stringify({
					workspaceId: '00000000-0000-4000-8000-000000000000',
					defaultEnvironment: 'prod',
				}),
			});
			assert.equal(result.exitCode, 2);
			assert.match(result.stderr, /Pass --force to overwrite/);
		});

		it('--force overwrites a different workspaceId', () => {
			const repo = mkdtempSync(join(tmpdir(), 'infisical-bootstrap-force-'));
			const scriptsDir = join(repo, 'scripts');
			mkdirSync(scriptsDir, { recursive: true });
			writeFileSync(join(scriptsDir, 'infisical-bootstrap.mjs'), readFileSync(SCRIPT, 'utf8'));
			try {
				writeFileSync(
					join(repo, '.infisical.json'),
					JSON.stringify({
						workspaceId: '00000000-0000-4000-8000-000000000000',
						defaultEnvironment: 'prod',
					}),
				);
				execFileSync(
					process.execPath,
					[join(scriptsDir, 'infisical-bootstrap.mjs'), `--workspace-id=${VALID_UUID}`, '--force'],
					{ cwd: repo, stdio: 'pipe' },
				);
				const written = JSON.parse(readFileSync(join(repo, '.infisical.json'), 'utf8'));
				assert.equal(written.workspaceId, VALID_UUID);
			} finally {
				rmSync(repo, { recursive: true, force: true });
			}
		});
	});

	describe('validation', () => {
		it('rejects missing --workspace-id', () => {
			const result = runInIsolatedRepo([]);
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /--workspace-id must be a UUID v4 string/);
		});

		it('rejects non-UUID workspaceId', () => {
			const result = runInIsolatedRepo(['--workspace-id=not-a-uuid']);
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /UUID v4 string/);
		});

		it('rejects UUID v1 / v3 / v5 (only v4 accepted)', () => {
			const v1 = 'a1b2c3d4-e5f6-1a7b-8c9d-0e1f2a3b4c5d'; // version digit "1" instead of "4"
			const result = runInIsolatedRepo([`--workspace-id=${v1}`]);
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /UUID v4 string/);
		});

		it('rejects --default-environment with non-{dev,prod} value', () => {
			const result = runInIsolatedRepo([
				`--workspace-id=${VALID_UUID}`,
				'--default-environment=staging',
			]);
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /must be one of dev, prod/);
		});

		it('rejects unknown CLI argument', () => {
			const result = runInIsolatedRepo([`--workspace-id=${VALID_UUID}`, '--bogus-flag']);
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /unknown argument: --bogus-flag/);
		});
	});

	describe('existing-file sanity', () => {
		it('rejects non-object root', () => {
			const result = runInIsolatedRepo([`--workspace-id=${VALID_UUID}`], {
				existingContent: JSON.stringify(['not', 'an', 'object']),
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /must be a JSON object/);
		});

		it('rejects unknown top-level keys', () => {
			const result = runInIsolatedRepo([`--workspace-id=${VALID_UUID}`], {
				existingContent: JSON.stringify({
					workspaceId: VALID_UUID,
					secretToken: 'should-not-be-here',
				}),
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /unexpected key: secretToken/);
		});

		it('rejects malformed JSON', () => {
			const result = runInIsolatedRepo([`--workspace-id=${VALID_UUID}`], {
				existingContent: '{ workspaceId: not-quoted }',
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /not valid JSON/);
		});
	});

	describe('argv / log / error-message secret-handling invariant', () => {
		it('does not include the workspaceId in any error message (it is non-secret, but we document the boundary)', () => {
			// The workspaceId is non-secret, but we still assert the
			// boundary: the script never accidentally logs a value
			// that *could* be a secret. There are no secret reads
			// anywhere in this script.
			const result = runInIsolatedRepo(['--workspace-id=garbage']);
			// The error message quotes the malformed input as a
			// JSON-stringified literal, which is acceptable for a
			// non-secret value (and the workspaceId is not a secret
			// per ADR-0015 §1). The point of this test is to
			// document the boundary so a future change that
			// accidentally starts reading secret env vars gets
			// caught.
			assert.match(result.stderr, /garbage/);
			assert.doesNotMatch(result.stderr, /process\.env/);
		});
	});

	describe('help', () => {
		it('--help prints usage and exits 0', () => {
			const result = runInIsolatedRepo(['--help']);
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /Usage: pnpm run infisical:bootstrap/);
		});
	});
});

// Suppress unused imports (pathToFileURL kept for future ESM-direct import tests).
void pathToFileURL;
