import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
/**
 * `deploy-with-secrets.mjs` unit tests.
 *
 * The interesting invariants are:
 *   1. Argument parsing: --dry-run default, --execute explicit, conflicting
 *      mode flags rejected, --environment restricted to {prod, preview},
 *      --config defaults per environment.
 *   2. .infisical.json shape: missing / malformed / non-object / unknown
 *      keys / missing workspaceId all rejected.
 *   3. Stale tempdir cleanup (24h+).
 *   4. Dry-run mode: NO Universal Auth, NO infisical run, NO wrangler
 *      deploy. Argparse + .infisical.json + tempdir lifecycle only.
 *   5. --execute gate: missing INFISICAL_CLIENT_ID / INFISICAL_CLIENT_SECRET
 *      rejected before any auth call.
 *   6. argv / log / error-message secret-handling invariant: no
 *      INFISICAL_TOKEN / CLIENT_SECRET / runtime secret ever appears.
 */
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'deploy-with-secrets.mjs');
const INNER_SCRIPT = resolve(HERE, 'run-deploy-inner.mjs');

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const TEMPDIR_PREFIX = 'my-web-2026-deploy-';

/**
 * Run the deploy script in an isolated `<repo>/scripts/...` layout and
 * return the tempdir path + exit code + captured output. Used when a
 * test needs to assert on log content or exit code.
 */
function runInIsolatedRepo(args, { existingContent = null, env = {} } = {}) {
	const repo = mkdtempSync(join(tmpdir(), 'deploy-with-secrets-test-'));
	const scriptsDir = join(repo, 'scripts');
	mkdirSync(scriptsDir, { recursive: true });
	writeFileSync(join(scriptsDir, 'deploy-with-secrets.mjs'), readFileSync(SCRIPT, 'utf8'));
	writeFileSync(join(scriptsDir, 'run-deploy-inner.mjs'), readFileSync(INNER_SCRIPT, 'utf8'));
	if (existingContent !== null) {
		writeFileSync(join(repo, '.infisical.json'), existingContent);
	}

	let stdout = '';
	let stderr = '';
	let exitCode = 0;
	try {
		const result = execFileSync(
			process.execPath,
			[join(scriptsDir, 'deploy-with-secrets.mjs'), ...args],
			{
				cwd: repo,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
				env: { ...process.env, ...env },
			},
		);
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

describe('deploy-with-secrets.mjs', () => {
	describe('arg parsing', () => {
		it('rejects conflicting mode flags', () => {
			const result = runInIsolatedRepo(['--dry-run', '--execute'], {
				existingContent: JSON.stringify({ workspaceId: VALID_UUID }),
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /conflicting mode flags/);
		});

		it('rejects unknown argument', () => {
			const result = runInIsolatedRepo(['--bogus-flag'], {
				existingContent: JSON.stringify({ workspaceId: VALID_UUID }),
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /unknown argument/);
		});

		it('rejects --environment with non-{prod,preview} value', () => {
			const result = runInIsolatedRepo(['--environment=staging'], {
				existingContent: JSON.stringify({ workspaceId: VALID_UUID }),
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /must be 'prod' or 'preview'/);
		});

		it('honors --environment=preview', () => {
			const result = runInIsolatedRepo(['--environment=preview'], {
				existingContent: JSON.stringify({ workspaceId: VALID_UUID }),
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /environment=preview/);
			assert.match(result.stdout, /config=wrangler\.jsonc/);
		});
	});

	describe('.infisical.json shape', () => {
		it('rejects missing .infisical.json', () => {
			const result = runInIsolatedRepo([]);
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /\.infisical\.json not found/);
		});

		it('rejects malformed JSON', () => {
			const result = runInIsolatedRepo([], {
				existingContent: '{ workspaceId: not-quoted }',
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /not valid JSON/);
		});

		it('rejects non-object root', () => {
			const result = runInIsolatedRepo([], {
				existingContent: JSON.stringify(['not', 'an', 'object']),
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /must be a JSON object/);
		});

		it('rejects unknown top-level keys', () => {
			const result = runInIsolatedRepo([], {
				existingContent: JSON.stringify({
					workspaceId: VALID_UUID,
					secretToken: 'should-not-be-here',
				}),
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /unexpected key: secretToken/);
		});

		it('rejects empty workspaceId', () => {
			const result = runInIsolatedRepo([], {
				existingContent: JSON.stringify({ workspaceId: '' }),
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /workspaceId.*non-empty string/);
		});
	});

	describe('dry-run mode (default)', () => {
		it('does NOT call Universal Auth (no HTTPS POST)', () => {
			const result = runInIsolatedRepo([], {
				existingContent: JSON.stringify({ workspaceId: VALID_UUID }),
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /mode=dry-run/);
			assert.match(result.stdout, /skipping Universal Auth login and wrangler deploy/);
		});

		it('reports workspaceId / environment / config', () => {
			const result = runInIsolatedRepo([], {
				existingContent: JSON.stringify({ workspaceId: VALID_UUID }),
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, new RegExp(`workspaceId=${VALID_UUID}`));
			assert.match(result.stdout, /environment=prod/);
			assert.match(result.stdout, /config=wrangler\.production\.jsonc/);
		});

		it('verifies the inner script exists', () => {
			const result = runInIsolatedRepo([], {
				existingContent: JSON.stringify({ workspaceId: VALID_UUID }),
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /inner script verified/);
		});

		it('exits with error if inner script is missing', () => {
			// Custom helper: skip the inner script copy.
			const repo = mkdtempSync(join(tmpdir(), 'deploy-no-inner-'));
			const scriptsDir = join(repo, 'scripts');
			mkdirSync(scriptsDir, { recursive: true });
			writeFileSync(join(scriptsDir, 'deploy-with-secrets.mjs'), readFileSync(SCRIPT, 'utf8'));
			writeFileSync(join(repo, '.infisical.json'), JSON.stringify({ workspaceId: VALID_UUID }));
			let exitCode = 0;
			let stderr = '';
			try {
				execFileSync(process.execPath, [join(scriptsDir, 'deploy-with-secrets.mjs')], {
					cwd: repo,
					encoding: 'utf8',
					stdio: ['ignore', 'pipe', 'pipe'],
				});
			} catch (error) {
				exitCode = error.status ?? 1;
				stderr = error.stderr ?? '';
			} finally {
				rmSync(repo, { recursive: true, force: true });
			}
			assert.equal(exitCode, 1);
			assert.match(stderr, /Inner script not found/);
		});
	});

	describe('--execute gate', () => {
		it('requires INFISICAL_CLIENT_ID env var', () => {
			const result = runInIsolatedRepo(['--execute'], {
				existingContent: JSON.stringify({ workspaceId: VALID_UUID }),
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /INFISICAL_CLIENT_ID.*required/);
		});

		it('requires INFISICAL_CLIENT_SECRET env var', () => {
			const result = runInIsolatedRepo(['--execute'], {
				existingContent: JSON.stringify({ workspaceId: VALID_UUID }),
				env: {
					INFISICAL_CLIENT_ID: 'test-client-id',
				},
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /INFISICAL_CLIENT_SECRET.*required/);
		});

		it('attempts Universal Auth login when both env vars are set', () => {
			// Universal Auth will fail with a network error or non-200
			// HTTP code (no real Infisical instance is reachable in
			// test). The point is to assert that we get past the env
			// gate and INTO the auth code path.
			const result = runInIsolatedRepo(['--execute'], {
				existingContent: JSON.stringify({ workspaceId: VALID_UUID }),
				env: {
					INFISICAL_CLIENT_ID: 'test-client-id',
					INFISICAL_CLIENT_SECRET: 'test-client-secret',
				},
			});
			// Exit code is non-zero (auth failed as expected), but the
			// error message should be about auth failure, NOT about
			// missing env vars.
			assert.notEqual(result.exitCode, 0);
			assert.doesNotMatch(result.stderr, /INFISICAL_CLIENT_.*required/);
		});
	});

	describe('argv / log / error-message secret-handling invariant', () => {
		it('does NOT include INFISICAL_CLIENT_SECRET in any log output', () => {
			const SECRET = 'this-is-a-deliberately-unique-marker-XYZ-9876';
			const result = runInIsolatedRepo(['--execute'], {
				existingContent: JSON.stringify({ workspaceId: VALID_UUID }),
				env: {
					INFISICAL_CLIENT_ID: 'test-client-id',
					INFISICAL_CLIENT_SECRET: SECRET,
				},
			});
			assert.doesNotMatch(result.stdout, new RegExp(SECRET));
			assert.doesNotMatch(result.stderr, new RegExp(SECRET));
		});

		it('does NOT include INFISICAL_API_URL content in error messages', () => {
			const result = runInIsolatedRepo([], {
				existingContent: JSON.stringify({ workspaceId: VALID_UUID }),
			});
			// No auth involved in dry-run, so the API URL is never
			// touched. We assert that no auth URL fragments leak.
			assert.doesNotMatch(result.stdout, /secrets\.rebuildup\.dev/);
		});
	});

	describe('stale tempdir cleanup', () => {
		it('removes 24h+ old tempdirs in os.tmpdir()', () => {
			const stale = mkdtempSync(join(tmpdir(), TEMPDIR_PREFIX));
			const young = mkdtempSync(join(tmpdir(), TEMPDIR_PREFIX));
			// Set the stale dir's mtime to 25h ago.
			const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
			utimesSync(stale, oldTime, oldTime);

			const result = runInIsolatedRepo([], {
				existingContent: JSON.stringify({ workspaceId: VALID_UUID }),
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /removed 1 stale tempdir/);

			assert.equal(existsSync(stale), false, 'stale dir should be removed');
			assert.equal(existsSync(young), true, 'fresh dir should be kept');
			rmSync(young, { recursive: true, force: true });
		});

		it('keeps fresh tempdirs (< 24h)', () => {
			const young = mkdtempSync(join(tmpdir(), TEMPDIR_PREFIX));

			const result = runInIsolatedRepo([], {
				existingContent: JSON.stringify({ workspaceId: VALID_UUID }),
			});
			assert.equal(result.exitCode, 0);
			assert.doesNotMatch(result.stdout, /removed .* stale tempdir/);

			assert.equal(existsSync(young), true);
			rmSync(young, { recursive: true, force: true });
		});
	});

	describe('--help', () => {
		it('prints usage and exits 0', () => {
			const result = runInIsolatedRepo(['--help']);
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /Usage: deploy-with-secrets/);
			assert.match(result.stdout, /--execute/);
			assert.match(result.stdout, /--dry-run/);
		});
	});
});

// Suppress unused imports (pathToFileURL kept for future ESM-direct import tests).
void pathToFileURL;
