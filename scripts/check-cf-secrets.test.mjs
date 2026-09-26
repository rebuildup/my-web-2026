import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
/**
 * `check-cf-secrets.mjs` unit tests.
 *
 * The interesting invariants are:
 *   1. Arg parsing: --dry-run default, --execute explicit, conflicting
 *      mode flags rejected, --environment restricted to {prod, dev}.
 *   2. Wrangler config shape: missing file / malformed JSON / non-array
 *      `secrets.required` all handled.
 *   3. Phase detection from wrangler config:
 *      - `BETTER_AUTH_SECRET` in required → phase-1-2
 *      - `BETTER_AUTH_SECRETS` in required → phase-3+
 *      - neither → unknown
 *   4. Dry-run mode: NO Infisical API call. Verified by setting
 *      INFISICAL_API_URL to an unreachable host and checking that
 *      dry-run still succeeds.
 *   5. --execute gate: missing INFISICAL_CLIENT_ID / SECRET / WORKSPACE_ID
 *      rejected before any auth call.
 *   6. argv / log / error-message secret-handling invariant: no
 *      secret value, no client secret, no API URL fragment leaks.
 */
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'check-cf-secrets.mjs');

const WRANGLER_PRODUCTION_PATH = resolve(HERE, '..', 'wrangler.production.jsonc');

/**
 * Run the check-cf-secrets script in an isolated `<repo>/scripts/...`
 * layout. The script reads from REPO_ROOT (parent of scripts/) so we
 * mirror that layout. Tests can supply a custom wrangler config via
 * `existingFiles.configPath`.
 */
function runInIsolatedRepo(
	args,
	{ env = {}, wranglerContent = null, configFileName = 'wrangler.production.jsonc' } = {},
) {
	const repo = mkdtempSync(join(tmpdir(), 'check-cf-secrets-test-'));
	const scriptsDir = join(repo, 'scripts');
	mkdirSync(scriptsDir, { recursive: true });
	writeFileSync(join(scriptsDir, 'check-cf-secrets.mjs'), readFileSync(SCRIPT, 'utf8'));

	// Provide a wrangler config in the repo root.
	const configPath = join(repo, configFileName);
	if (wranglerContent !== null) {
		writeFileSync(configPath, wranglerContent);
	} else {
		// Sensible default: copy real wrangler.production.jsonc so the
		// default-mode tests use the actual production contract.
		if (existsSync(WRANGLER_PRODUCTION_PATH)) {
			writeFileSync(configPath, readFileSync(WRANGLER_PRODUCTION_PATH, 'utf8'));
		}
	}

	let stdout = '';
	let stderr = '';
	let exitCode = 0;
	try {
		const result = execFileSync(
			process.execPath,
			[join(scriptsDir, 'check-cf-secrets.mjs'), ...args],
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

const PHASE_1_2_WRANGLER = `{
  "name": "my-web-2026",
  "main": "./src/server.ts",
  "vars": {},
  "secrets": {
    "required": ["BETTER_AUTH_SECRET", "MY_WEB_2026_CONSUMER_API_KEY"]
  }
}
`;

const PHASE_3_WRANGLER = `{
  "name": "my-web-2026",
  "main": "./src/server.ts",
  "vars": {},
  "secrets": {
    "required": ["BETTER_AUTH_SECRETS", "MY_WEB_2026_CONSUMER_API_KEY"]
  }
}
`;

describe('check-cf-secrets.mjs', () => {
	describe('arg parsing', () => {
		it('rejects conflicting mode flags', () => {
			const result = runInIsolatedRepo(['--dry-run', '--execute'], {
				wranglerContent: PHASE_1_2_WRANGLER,
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /conflicting mode flags/);
		});

		it('rejects unknown argument', () => {
			const result = runInIsolatedRepo(['--bogus'], {
				wranglerContent: PHASE_1_2_WRANGLER,
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /unknown argument/);
		});

		it('rejects --environment with non-{prod,dev} value', () => {
			const result = runInIsolatedRepo(['--environment=staging'], {
				wranglerContent: PHASE_1_2_WRANGLER,
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /must be 'prod' or 'dev'/);
		});
	});

	describe('wrangler config shape', () => {
		it('rejects missing wrangler config file', () => {
			const result = runInIsolatedRepo([], {
				wranglerContent: null,
				configFileName: 'wrangler.nonexistent.jsonc',
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /Wrangler config not found/);
		});

		it('rejects malformed wrangler config JSON', () => {
			const result = runInIsolatedRepo([], {
				wranglerContent: '{ not valid json',
			});
			assert.equal(result.exitCode, 1);
		});

		it('handles wrangler config without secrets.required', () => {
			const noSecretsConfig = `{
  "name": "my-web-2026",
  "vars": {}
}
`;
			const result = runInIsolatedRepo([], {
				wranglerContent: noSecretsConfig,
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /detected phase=unknown/);
		});
	});

	describe('phase detection', () => {
		it('detects phase-1-2 from BETTER_AUTH_SECRET in required', () => {
			const result = runInIsolatedRepo([], {
				wranglerContent: PHASE_1_2_WRANGLER,
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /detected phase=phase-1-2/);
		});

		it('detects phase-3+ from BETTER_AUTH_SECRETS in required', () => {
			const result = runInIsolatedRepo([], {
				wranglerContent: PHASE_3_WRANGLER,
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /detected phase=phase-3\+/);
		});
	});

	describe('dry-run mode (default)', () => {
		it('does NOT call the Infisical API (unreachable host does not fail)', () => {
			// Set INFISICAL_API_URL to an unreachable address. If the
			// script attempted any HTTP call in dry-run mode, it
			// would fail. The success of this test proves no call.
			const result = runInIsolatedRepo([], {
				wranglerContent: PHASE_1_2_WRANGLER,
				env: {
					INFISICAL_API_URL: 'https://this-host-does-not-exist.invalid',
					INFISICAL_CLIENT_ID: 'should-not-be-sent',
					INFISICAL_CLIENT_SECRET: 'should-not-be-sent',
					INFISICAL_WORKSPACE_ID: '00000000-0000-4000-8000-000000000000',
				},
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /\[dry-run\] OK/);
		});

		it('prints expected Infisical runtime 3-name contract', () => {
			const result = runInIsolatedRepo([], {
				wranglerContent: PHASE_1_2_WRANGLER,
			});
			assert.equal(result.exitCode, 0);
			assert.match(
				result.stdout,
				/BETTER_AUTH_SECRETS, BETTER_AUTH_SECRET, MY_WEB_2026_CONSUMER_API_KEY/,
			);
		});

		it('prints expected phase-specific 2-name contract', () => {
			const result = runInIsolatedRepo([], {
				wranglerContent: PHASE_3_WRANGLER,
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /BETTER_AUTH_SECRETS, MY_WEB_2026_CONSUMER_API_KEY/);
		});
	});

	describe('--execute gate', () => {
		it('requires INFISICAL_CLIENT_ID env var', () => {
			const result = runInIsolatedRepo(['--execute'], {
				wranglerContent: PHASE_1_2_WRANGLER,
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /INFISICAL_CLIENT_ID.*required/);
		});

		it('requires INFISICAL_CLIENT_SECRET env var', () => {
			const result = runInIsolatedRepo(['--execute'], {
				wranglerContent: PHASE_1_2_WRANGLER,
				env: { INFISICAL_CLIENT_ID: 'test-id' },
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /INFISICAL_CLIENT_SECRET.*required/);
		});

		it('requires INFISICAL_WORKSPACE_ID env var', () => {
			const result = runInIsolatedRepo(['--execute'], {
				wranglerContent: PHASE_1_2_WRANGLER,
				env: {
					INFISICAL_CLIENT_ID: 'test-id',
					INFISICAL_CLIENT_SECRET: 'test-secret',
				},
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /INFISICAL_WORKSPACE_ID.*required/);
		});

		it('attempts Universal Auth login when all env vars are set', () => {
			// Universal Auth will fail (no real Infisical instance is
			// reachable in test). The point is that we get past the
			// env gate and INTO the auth code path.
			const result = runInIsolatedRepo(['--execute'], {
				wranglerContent: PHASE_1_2_WRANGLER,
				env: {
					INFISICAL_API_URL: 'https://this-host-does-not-exist.invalid',
					INFISICAL_CLIENT_ID: 'test-id',
					INFISICAL_CLIENT_SECRET: 'test-secret',
					INFISICAL_WORKSPACE_ID: '00000000-0000-4000-8000-000000000000',
				},
			});
			assert.notEqual(result.exitCode, 0);
			// The error is NOT about missing env vars (we passed all 3).
			assert.doesNotMatch(result.stderr, /INFISICAL_CLIENT_.*required/);
			assert.doesNotMatch(result.stderr, /INFISICAL_WORKSPACE_ID.*required/);
		});
	});

	describe('argv / log / error-message secret-handling invariant', () => {
		it('does NOT log INFISICAL_CLIENT_SECRET in any output', () => {
			const SECRET = 'this-is-a-deliberately-unique-marker-XYZ-9876';
			const result = runInIsolatedRepo(['--execute'], {
				wranglerContent: PHASE_1_2_WRANGLER,
				env: {
					INFISICAL_API_URL: 'https://this-host-does-not-exist.invalid',
					INFISICAL_CLIENT_ID: 'test-id',
					INFISICAL_CLIENT_SECRET: SECRET,
					INFISICAL_WORKSPACE_ID: '00000000-0000-4000-8000-000000000000',
				},
			});
			assert.doesNotMatch(result.stdout, new RegExp(SECRET));
			assert.doesNotMatch(result.stderr, new RegExp(SECRET));
		});
	});

	describe('--help', () => {
		it('prints usage and exits 0', () => {
			const result = runInIsolatedRepo(['--help']);
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /Usage: check-cf-secrets/);
			assert.match(result.stdout, /--execute/);
			assert.match(result.stdout, /--dry-run/);
		});
	});
});

// Suppress unused imports (pathToFileURL kept for future ESM-direct import tests).
void pathToFileURL;
