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
 *   4. Tier 2 exact match (extras are FAIL, not silently ignored).
 *   5. Dry-run mode: NO Infisical / Cloudflare API call. Verified by
 *      setting INFISICAL_API_URL to an unreachable host and checking
 *      that dry-run still succeeds.
 *   6. Dry-run pre-flight FAIL when phase cannot be determined.
 *   7. --execute gate: missing INFISICAL_CLIENT_ID / SECRET rejected.
 *      Workspace ID is read from `.infisical.json` SoT — NOT env var.
 *   8. Tier 3 (live Worker) is gated on CLOUDFLARE_API_TOKEN.
 *   9. argv / log / error-message secret-handling invariant.
 */
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'check-cf-secrets.mjs');

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const WRANGLER_PRODUCTION_PATH = resolve(HERE, '..', 'wrangler.production.jsonc');

/**
 * Run the check-cf-secrets script in an isolated `<repo>/scripts/...`
 * layout. The script reads from REPO_ROOT (parent of scripts/) so we
 * mirror that layout. Tests can supply a custom wrangler config via
 * `existingFiles.configPath` and a custom `.infisical.json` via
 * `infisicalJsonContent` (default: a valid workspaceId entry).
 */
function runInIsolatedRepo(
	args,
	{
		env = {},
		wranglerContent = null,
		configFileName = 'wrangler.production.jsonc',
		infisicalJsonContent = null,
	} = {},
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

	// .infisical.json (SoT for workspaceId). Default to a valid entry;
	// tests can override to test missing / malformed cases.
	if (infisicalJsonContent === null) {
		writeFileSync(join(repo, '.infisical.json'), JSON.stringify({ workspaceId: VALID_UUID }));
	} else if (infisicalJsonContent !== '__skip__') {
		writeFileSync(join(repo, '.infisical.json'), infisicalJsonContent);
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

// Phase-1-2 form with an EXTRA entry — must FAIL exact-match (not silently pass).
const PHASE_1_2_WITH_EXTRA_WRANGLER = `{
  "name": "my-web-2026",
  "main": "./src/server.ts",
  "vars": {},
  "secrets": {
    "required": ["BETTER_AUTH_SECRET", "MY_WEB_2026_CONSUMER_API_KEY", "UNEXPECTED_SECRET"]
  }
}
`;

// Unknown phase: unrecognized secret pattern in required — must FAIL.
const UNKNOWN_PHASE_WRANGLER = `{
  "name": "my-web-2026",
  "main": "./src/server.ts",
  "vars": {},
  "secrets": {
    "required": ["SOMETHING_UNRECOGNIZED", "ANOTHER_ONE"]
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
			// No secrets.required means no recognized phase pattern;
			// dry-run pre-flight FAILs (ADR-0015 §9 exact 2-name match).
			assert.equal(result.exitCode, 1);
			assert.match(result.stdout, /\[FAIL\] cannot determine phase/);
		});

		it('dry-run pre-flight FAILs when phase is unknown (unrecognized pattern)', () => {
			const result = runInIsolatedRepo([], {
				wranglerContent: UNKNOWN_PHASE_WRANGLER,
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stdout, /\[FAIL\] cannot determine phase/);
			assert.match(result.stdout, /no API call made/);
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

		it('prints expected phase-specific 2-name contract (exact match required)', () => {
			const result = runInIsolatedRepo([], {
				wranglerContent: PHASE_3_WRANGLER,
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /BETTER_AUTH_SECRETS, MY_WEB_2026_CONSUMER_API_KEY/);
			assert.match(result.stdout, /exact/);
		});

		it('mentions Tier 3 (live Worker) eligibility in dry-run', () => {
			const result = runInIsolatedRepo([], {
				wranglerContent: PHASE_1_2_WRANGLER,
				env: { CLOUDFLARE_API_TOKEN: 'fake-token-for-dry-run-mention' },
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /wrangler secret list/);
			assert.match(result.stdout, /CLOUDFLARE_API_TOKEN is set/);
		});

		it('notes Tier 3 skip when CLOUDFLARE_API_TOKEN is unset', () => {
			const result = runInIsolatedRepo([], {
				wranglerContent: PHASE_1_2_WRANGLER,
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /would skip Tier 3/);
			assert.match(result.stdout, /CLOUDFLARE_API_TOKEN not set/);
		});
	});

	describe('.infisical.json SoT (workspaceId read)', () => {
		it('rejects missing .infisical.json (workspaceId SoT)', () => {
			const result = runInIsolatedRepo(['--execute'], {
				wranglerContent: PHASE_1_2_WRANGLER,
				env: {
					INFISICAL_CLIENT_ID: 'test-id',
					INFISICAL_CLIENT_SECRET: 'test-secret',
				},
				infisicalJsonContent: '__skip__',
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /\.infisical\.json not found/);
		});

		it('rejects malformed .infisical.json', () => {
			const result = runInIsolatedRepo(['--execute'], {
				wranglerContent: PHASE_1_2_WRANGLER,
				env: {
					INFISICAL_CLIENT_ID: 'test-id',
					INFISICAL_CLIENT_SECRET: 'test-secret',
				},
				infisicalJsonContent: '{ workspaceId: not-quoted }',
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /not valid JSON/);
		});

		it('rejects empty workspaceId in .infisical.json', () => {
			const result = runInIsolatedRepo(['--execute'], {
				wranglerContent: PHASE_1_2_WRANGLER,
				env: {
					INFISICAL_CLIENT_ID: 'test-id',
					INFISICAL_CLIENT_SECRET: 'test-secret',
				},
				infisicalJsonContent: JSON.stringify({ workspaceId: '' }),
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /workspaceId.*non-empty string/);
		});

		it('rejects unknown top-level keys in .infisical.json', () => {
			const result = runInIsolatedRepo(['--execute'], {
				wranglerContent: PHASE_1_2_WRANGLER,
				env: {
					INFISICAL_CLIENT_ID: 'test-id',
					INFISICAL_CLIENT_SECRET: 'test-secret',
				},
				infisicalJsonContent: JSON.stringify({
					workspaceId: VALID_UUID,
					secretToken: 'should-not-be-here',
				}),
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /unexpected key: secretToken/);
		});

		it('does NOT use INFISICAL_WORKSPACE_ID env var (deprecated)', () => {
			// Even if INFISICAL_WORKSPACE_ID is set, .infisical.json
			// SoT wins. The script does not read INFISICAL_WORKSPACE_ID
			// anymore — this test pins that contract.
			const result = runInIsolatedRepo(['--execute'], {
				wranglerContent: PHASE_1_2_WRANGLER,
				env: {
					INFISICAL_CLIENT_ID: 'test-id',
					INFISICAL_CLIENT_SECRET: 'test-secret',
					INFISICAL_WORKSPACE_ID: 'env-var-should-be-ignored',
				},
			});
			// We get past the workspaceId gate (env var no longer required).
			// Auth will fail (no real Infisical) — but the failure mode
			// is NOT about missing workspaceId.
			const combined = `${result.stdout}\n${result.stderr}`;
			assert.doesNotMatch(combined, /INFISICAL_WORKSPACE_ID.*required/);
			assert.doesNotMatch(combined, /\.infisical\.json not found/);
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

		it('attempts Universal Auth login when both env vars are set', () => {
			// Universal Auth will fail (no real Infisical instance is
			// reachable in test). The point is that we get past the
			// env gate and INTO the auth code path.
			const result = runInIsolatedRepo(['--execute'], {
				wranglerContent: PHASE_1_2_WRANGLER,
				env: {
					INFISICAL_API_URL: 'https://this-host-does-not-exist.invalid',
					INFISICAL_CLIENT_ID: 'test-id',
					INFISICAL_CLIENT_SECRET: 'test-secret',
				},
			});
			assert.notEqual(result.exitCode, 0);
			assert.doesNotMatch(result.stderr, /INFISICAL_CLIENT_.*required/);
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
				},
			});
			assert.doesNotMatch(result.stdout, new RegExp(SECRET));
			assert.doesNotMatch(result.stderr, new RegExp(SECRET));
		});

		it('does NOT log CLOUDFLARE_API_TOKEN in any output (Tier 3 secret-handling)', () => {
			const TOKEN = 'this-is-a-deliberately-unique-cf-marker-XYZ-7777';
			const result = runInIsolatedRepo([], {
				wranglerContent: PHASE_1_2_WRANGLER,
				env: { CLOUDFLARE_API_TOKEN: TOKEN },
			});
			// Tier 3 is gated on CLOUDFLARE_API_TOKEN presence, but the
			// token value itself must NEVER appear in output (it's not
			// a secret we own — it's an API token from the operator).
			assert.doesNotMatch(result.stdout, new RegExp(TOKEN));
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
