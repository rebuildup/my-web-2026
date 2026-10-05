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
import { AUDIT_ONLY_SECRETS, REQUIRED_RUNTIME_SECRETS } from './_cloudflare-contract.mjs';
import { ACCOUNT_ID } from './_cloudflare-identity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'check-cf-secrets.mjs');

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const WRANGLER_PRODUCTION_PATH = resolve(HERE, '..', 'wrangler.production.jsonc');

function loadBuildWranglerDiagnosticEnv() {
	const source = readFileSync(SCRIPT, 'utf8');
	const match = source.match(/function\s+buildWranglerDiagnosticEnv\s*\([\s\S]*?\n\}/m);
	if (!match) {
		throw new Error('Could not extract buildWranglerDiagnosticEnv');
	}
	const factory = new Function(`${match[0]}\nreturn buildWranglerDiagnosticEnv;`);
	return factory();
}

/**
 * Issue #243 — load `resolveWorkerContract` from source, matching this
 * file's existing extraction convention.
 */
function loadResolveWorkerContract() {
	const source = readFileSync(SCRIPT, 'utf8');
	const match = source.match(/export function\s+resolveWorkerContract[\s\S]*?\n\}/m);
	if (!match) throw new Error('Could not extract resolveWorkerContract');
	const body = match[0].replace('export ', '');
	// The 'final' set is the REAL imported contract rather than a local
	// copy: this extraction evaluates the function outside its module, so
	// a hand-written duplicate here could drift from the source it is
	// meant to test. Issue #247 moved that set into
	// `_cloudflare-contract.mjs`.
	const factory = new Function(
		'REQUIRED_RUNTIME_SECRETS',
		'PRE_DEPLOY_TRANSITION_WORKER_SECRETS',
		`${body}\nreturn resolveWorkerContract;`,
	);
	return factory(REQUIRED_RUNTIME_SECRETS, [
		'BETTER_AUTH_SECRETS',
		'BETTER_AUTH_SECRET',
		'MY_WEB_2026_CONSUMER_API_KEY',
	]);
}

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
	// Issue #247: check-cf-secrets reads the Build Output binding
	// contract, so the isolated repo needs the shared module too.
	writeFileSync(
		join(scriptsDir, '_cf-build-output.mjs'),
		readFileSync(resolve(HERE, '_cf-build-output.mjs'), 'utf8'),
	);
	// Issue #247: canonical identity and the runtime contract are
	// imported modules, so the isolated repo needs them too. A missing
	// one surfaces as ERR_MODULE_NOT_FOUND rather than a contract
	// failure, which is how a new shared module gets forgotten here.
	for (const dep of ['_cloudflare-identity.mjs', '_cloudflare-contract.mjs']) {
		writeFileSync(join(scriptsDir, dep), readFileSync(resolve(HERE, dep), 'utf8'));
	}

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
    "required": ["BETTER_AUTH_SECRET", "MY_WEB_2026_CONSUMER_API_KEY", "GOOGLE_ANALYTICS_MEASUREMENT_ID"]
  }
}
`;

const PHASE_3_WRANGLER = `{
  "name": "my-web-2026",
  "main": "./src/server.ts",
  "vars": {},
  "secrets": {
    "required": ["BETTER_AUTH_SECRETS", "MY_WEB_2026_CONSUMER_API_KEY", "GOOGLE_ANALYTICS_MEASUREMENT_ID"]
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
	/**
	 * The secret names a dry-run reports for a given live-Worker contract.
	 *
	 * Parsed as whole names. The audit-only `BETTER_AUTH_SECRET` is a
	 * substring of the required `BETTER_AUTH_SECRETS`, so any `includes`
	 * check on the raw line would conflate the two.
	 */
	function parseContractLine(stdout, contractLabel) {
		const line = stdout.split('\n').find((l) => l.includes(`against the ${contractLabel}`));
		assert.ok(line, `stdout should describe the ${contractLabel}: ${stdout}`);
		const parens = line.slice(line.indexOf('(') + 1, line.indexOf(')'));
		return parens
			.split(',')
			.map((n) => n.trim())
			.filter(Boolean);
	}

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

		it('rejects invalid --worker-contract value', () => {
			const result = runInIsolatedRepo(['--worker-contract=bogus'], {
				wranglerContent: PHASE_3_WRANGLER,
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /--worker-contract must be 'auto', 'transition' or 'final'/);
		});

		it('rejects --environment with non-{prod,dev} value', () => {
			const result = runInIsolatedRepo(['--environment=staging'], {
				wranglerContent: PHASE_1_2_WRANGLER,
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /must be 'prod' or 'dev'/);
		});
	});

	describe('canonical identity and shared contract (Issue #247)', () => {
		it('reports the imported account and Worker, not a regex over a config file', () => {
			const result = runInIsolatedRepo([]);
			assert.equal(result.exitCode, 0, result.stderr);
			assert.ok(
				result.stdout.includes(`account=${ACCOUNT_ID}`),
				`stdout should carry the canonical account: ${result.stdout}`,
			);
			assert.ok(result.stdout.includes('worker=my-web-2026'));
		});

		it('rejects an account override that would retarget production', () => {
			// The old reader returned whatever CLOUDFLARE_ACCOUNT_ID held,
			// so a stray value silently pointed the live check at a
			// different account. An override is now only allowed to
			// REPEAT the canonical id.
			const result = runInIsolatedRepo([], {
				env: { CLOUDFLARE_ACCOUNT_ID: '0'.repeat(32) },
			});
			assert.notEqual(result.exitCode, 0);
			assert.match(result.stderr + result.stdout, /does not match the canonical account/);
		});

		it('accepts an override that merely repeats the canonical id', () => {
			const result = runInIsolatedRepo([], { env: { CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID } });
			assert.equal(result.exitCode, 0, result.stderr);
		});

		it('rejects --config rather than ignoring it', () => {
			// Silently ignoring a removed flag would let a caller believe
			// it had selected a target.
			const result = runInIsolatedRepo(['--config=wrangler.production.jsonc']);
			assert.notEqual(result.exitCode, 0);
			assert.match(result.stderr + result.stdout, /--config is no longer accepted/);
		});

		it('needs no Wrangler config file to determine the expected set', () => {
			// The isolated repo deliberately contains no wrangler*.jsonc.
			const result = runInIsolatedRepo([]);
			assert.equal(result.exitCode, 0, result.stderr);
			for (const name of REQUIRED_RUNTIME_SECRETS) {
				assert.ok(result.stdout.includes(name), `stdout should carry ${name}`);
			}
		});
	});

	describe('dry-run mode (default)', () => {
		it('does NOT call the Infisical API (unreachable host does not fail)', () => {
			// An unreachable API URL must not fail a dry run: the whole
			// point of --dry-run is that no API is called.
			const result = runInIsolatedRepo([], { env: { INFISICAL_API_URL: 'http://127.0.0.1:9' } });
			assert.equal(result.exitCode, 0, result.stderr);
			assert.match(result.stdout, /no Infisical \/ Cloudflare API call made/);
		});

		it('prints the expected Infisical runtime contract (required + audit-only)', () => {
			const result = runInIsolatedRepo([]);
			assert.equal(result.exitCode, 0, result.stderr);
			assert.match(result.stdout, /Infisical prod contains runtime 4-name contract/);
			for (const name of [...REQUIRED_RUNTIME_SECRETS, ...AUDIT_ONLY_SECRETS]) {
				assert.ok(result.stdout.includes(name), `stdout should carry ${name}`);
			}
		});

		it('prints the final live Worker expectation, without the audit-only name', () => {
			const result = runInIsolatedRepo(['--worker-contract=final', '--require-live-worker']);
			assert.equal(result.exitCode, 0, result.stderr);
			// Match WHOLE names. `BETTER_AUTH_SECRETS` contains
			// `BETTER_AUTH_SECRET` as a substring, so a substring check
			// would report the audit-only name as present in the final
			// contract — and fail for entirely the wrong reason.
			const names = parseContractLine(result.stdout, 'final contract');
			for (const name of REQUIRED_RUNTIME_SECRETS) {
				assert.ok(names.includes(name), `final contract should carry ${name}: ${names}`);
			}
			for (const name of AUDIT_ONLY_SECRETS) {
				assert.ok(!names.includes(name), `final contract must not carry ${name}: ${names}`);
			}
		});

		it('keeps the transition contract, which still carries the legacy name', () => {
			const result = runInIsolatedRepo(['--worker-contract=transition', '--require-live-worker']);
			assert.equal(result.exitCode, 0, result.stderr);
			const line = result.stdout
				.split('\n')
				.find((l) => l.includes('against the transition contract'));
			assert.ok(line, `stdout should describe the transition contract: ${result.stdout}`);
			assert.ok(line.includes('BETTER_AUTH_SECRET'), 'transition still carries the legacy name');
		});

		it('mentions Tier 3 eligibility without requiring a token', () => {
			const result = runInIsolatedRepo([]);
			assert.equal(result.exitCode, 0, result.stderr);
			assert.match(result.stdout, /Tier 3/);
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
		it('accepts a pre-authenticated INFISICAL_TOKEN without client credentials', () => {
			const result = runInIsolatedRepo(['--execute'], {
				wranglerContent: PHASE_3_WRANGLER,
				env: {
					INFISICAL_TOKEN: 'parent-token',
					INFISICAL_API_URL: 'https://this-host-does-not-exist.invalid',
				},
			});
			assert.notEqual(result.exitCode, 0);
			assert.match(result.stdout, /Using pre-authenticated INFISICAL_TOKEN/);
			assert.doesNotMatch(result.stderr, /INFISICAL_CLIENT_ID.*required/);
		});

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

	describe('Wrangler diagnostic credential boundary', () => {
		it('does not propagate Infisical credentials to Wrangler', () => {
			const buildEnv = loadBuildWranglerDiagnosticEnv();
			const env = buildEnv({
				PATH: '/usr/bin',
				CLOUDFLARE_API_TOKEN: 'cloudflare-token',
				INFISICAL_TOKEN: 'infisical-token',
				INFISICAL_CLIENT_ID: 'client-id',
				INFISICAL_CLIENT_SECRET: 'client-secret',
			});
			assert.equal(env.PATH, '/usr/bin');
			assert.equal(env.CLOUDFLARE_API_TOKEN, 'cloudflare-token');
			assert.equal('INFISICAL_TOKEN' in env, false);
			assert.equal('INFISICAL_CLIENT_ID' in env, false);
			assert.equal('INFISICAL_CLIENT_SECRET' in env, false);
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
			assert.match(result.stdout, /--require-live-worker/);
		});
	});
});

// Suppress unused imports (pathToFileURL kept for future ESM-direct import tests).
void pathToFileURL;

/* -- Issue #243: live-Worker contract auto-detection --------------------- */

describe('resolveWorkerContract (Issue #243)', () => {
	const resolveWorkerContract = loadResolveWorkerContract();
	const FINAL = [
		'BETTER_AUTH_SECRETS',
		'MY_WEB_2026_CONSUMER_API_KEY',
		'GOOGLE_ANALYTICS_MEASUREMENT_ID',
	];
	const TRANSITION = ['BETTER_AUTH_SECRETS', 'BETTER_AUTH_SECRET', 'MY_WEB_2026_CONSUMER_API_KEY'];

	it('picks `final` for the post-transition Worker (the real production set)', () => {
		// The live set after the release deploy + --delete-legacy-only.
		assert.equal(
			resolveWorkerContract([
				'BETTER_AUTH_SECRETS',
				'GOOGLE_ANALYTICS_MEASUREMENT_ID',
				'MY_WEB_2026_CONSUMER_API_KEY',
			]),
			'final',
		);
	});

	it('picks `transition` for the migration-window Worker', () => {
		assert.equal(resolveWorkerContract(TRANSITION), 'transition');
	});

	it('is order-insensitive', () => {
		assert.equal(resolveWorkerContract([...FINAL].reverse()), 'final');
		assert.equal(resolveWorkerContract([...TRANSITION].reverse()), 'transition');
	});

	it('does not excuse a drifted Worker (it still mismatches its chosen contract)', () => {
		// Neither contract matches, so `final` is chosen and the existing
		// missing/extra check reports the drift. The point is that a
		// drifted set is never silently treated as healthy.
		const drifted = ['BETTER_AUTH_SECRETS', 'GOOGLE_ANALYTICS_MEASUREMENT_ID'];
		const chosen = resolveWorkerContract(drifted);
		const expected = chosen === 'final' ? FINAL : TRANSITION;
		const actual = new Set(drifted);
		assert.notEqual(expected.length, actual.size);
		assert.ok(expected.some((n) => !actual.has(n)));
	});
});
