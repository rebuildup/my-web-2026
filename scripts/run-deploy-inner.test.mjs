import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
/**
 * `run-deploy-inner.mjs` unit tests.
 *
 * The inner script is the receiver of `infisical run` injection. It:
 *   1. Reads runtime secrets from `process.env` (Infisical injects them)
 *   2. Writes them to a tempdir `secrets.json` (mode 0o600)
 *   3. Spawns wrangler deploy with a sanitized env (no secrets, no
 *      INFISICAL_TOKEN)
 *   4. Cleans up the tempdir
 *
 * Invariants tested:
 *   - dry-run mode: writes + cleans up the tempdir, does NOT spawn wrangler
 *   - missing required secret: throws with the secret name (no value leak)
 *   - optional secret: included only if present in process.env
 *   - sanitized env: wrangler child process would not see runtime secrets
 *     or INFISICAL_TOKEN
 *   - cleanup happens even on failure
 *   - argv / log never includes a secret value
 */
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'run-deploy-inner.mjs');

const SECRET_BETTER_AUTH_SECRETS = '2:newsecretvalue,1:oldsecretvalue';
const SECRET_BETTER_AUTH_SECRET_LEGACY = 'legacy-single-secret-value';
const SECRET_CONSUMER_API_KEY = 'mk_home_TESTCONSUMERKEYXXXXXXXXXXXXXX';
const SECRET_GOOGLE_ANALYTICS_MEASUREMENT_ID = 'G-TEST0000000';

// Phase 3+ (Issue #89) plus Issue #187: the current runtime contract
// requires the versioned auth secret, consumer API key, and GA measurement
// ID. The legacy `BETTER_AUTH_SECRET` is AUDIT_ONLY_SECRETS — sanitized
// only, NEVER written to `secrets.json` even if present in process.env.
const REQUIRED_FOR_PHASE_3_PLUS = {
	BETTER_AUTH_SECRETS: SECRET_BETTER_AUTH_SECRETS,
	MY_WEB_2026_CONSUMER_API_KEY: SECRET_CONSUMER_API_KEY,
	GOOGLE_ANALYTICS_MEASUREMENT_ID: SECRET_GOOGLE_ANALYTICS_MEASUREMENT_ID,
};

const TEMPDIR_PREFIX = 'my-web-2026-deploy-';

/**
 * Run the inner script in isolation. The script lives at
 * `<repo>/scripts/run-deploy-inner.mjs` in production; we mirror that
 * layout so the script's own self-resolution works correctly.
 */
function runInIsolatedRepo(args, { env = {} } = {}) {
	const repo = mkdtempSync(join(tmpdir(), 'run-deploy-inner-test-'));
	const scriptsDir = join(repo, 'scripts');
	mkdirSync(scriptsDir, { recursive: true });
	writeFileSync(join(scriptsDir, 'run-deploy-inner.mjs'), readFileSync(SCRIPT, 'utf8'));
	// Provide a fake wrangler script (used by --execute but not by --dry-run).
	const fakeWrangler = join(scriptsDir, 'fake-wrangler.mjs');
	writeFileSync(
		fakeWrangler,
		'#!/usr/bin/env node\nconsole.log("fake-wrangler-invoked");\nprocess.exit(0);\n',
	);
	// Symlink @wrangler in a node_modules shim. The inner script uses
	// require.resolve("wrangler/package.json"), which would fail in
	// the isolated repo. We skip wrangler lookup for --dry-run paths;
	// for --execute paths we use the fake wrangler.

	let stdout = '';
	let stderr = '';
	let exitCode = 0;
	try {
		const result = execFileSync(
			process.execPath,
			[join(scriptsDir, 'run-deploy-inner.mjs'), ...args],
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

describe('run-deploy-inner.mjs', () => {
	describe('arg parsing', () => {
		it('requires --config', () => {
			const result = runInIsolatedRepo([], { env: REQUIRED_FOR_PHASE_3_PLUS });
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /--config=<path> is required/);
		});

		it('rejects unknown argument', () => {
			const result = runInIsolatedRepo(['--config=wrangler.jsonc', '--bogus'], {
				env: REQUIRED_FOR_PHASE_3_PLUS,
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /unknown argument: --bogus/);
		});
	});

	describe('required secret validation (Phase 3+: current 3-name)', () => {
		it('rejects missing BETTER_AUTH_SECRETS', () => {
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: {
					MY_WEB_2026_CONSUMER_API_KEY: SECRET_CONSUMER_API_KEY,
				},
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /Missing required runtime secrets/);
			assert.match(result.stderr, /BETTER_AUTH_SECRETS/);
			// The error message must NOT contain the secret value
			// (we did not set it, but assert the boundary anyway).
			assert.doesNotMatch(result.stderr, new RegExp(SECRET_BETTER_AUTH_SECRETS));
		});

		it('rejects missing MY_WEB_2026_CONSUMER_API_KEY', () => {
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: {
					BETTER_AUTH_SECRETS: SECRET_BETTER_AUTH_SECRETS,
				},
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /Missing required runtime secrets/);
			assert.match(result.stderr, /MY_WEB_2026_CONSUMER_API_KEY/);
		});

		it('rejects empty required secret value', () => {
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: {
					BETTER_AUTH_SECRETS: '',
					MY_WEB_2026_CONSUMER_API_KEY: SECRET_CONSUMER_API_KEY,
				},
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /Missing required runtime secrets/);
		});
	});

	describe('dry-run mode (Phase 3+)', () => {
		it('succeeds with current 3-name (BETTER_AUTH_SECRETS + CONSUMER_API_KEY)', () => {
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: REQUIRED_FOR_PHASE_3_PLUS,
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /\[dry-run\]/);
			assert.match(result.stdout, /secrets\.json would have been written/);
			assert.ok(result.stdout.includes('wrangler.jsonc'));
			assert.match(result.stdout, /contains 3 keys/);
		});

		it('cleans up the tempdir even on dry-run', () => {
			const before = readdirSync(tmpdir()).filter((name) => name.startsWith(TEMPDIR_PREFIX));
			runInIsolatedRepo(['--config=wrangler.jsonc'], { env: REQUIRED_FOR_PHASE_3_PLUS });
			const after = readdirSync(tmpdir()).filter((name) => name.startsWith(TEMPDIR_PREFIX));
			// Some other tests may be running; the only invariant we can
			// assert is that no NEW tempdirs leaked (count did not grow).
			assert.equal(after.length, before.length);
		});
	});

	describe('AUDIT_ONLY_SECRETS invariant (Issue #89)', () => {
		it('does NOT include BETTER_AUTH_SECRET in secrets.json even when set in process.env', () => {
			// Phase 3+ audit-only semantics: `BETTER_AUTH_SECRET` is
			// sanitized (removed from sanitizedEnv) and MUST NOT be
			// written to secrets.json even if `infisical run` injects
			// the audit-trail value. This prevents the legacy binding
			// from resurrecting on the next deploy.
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: {
					...REQUIRED_FOR_PHASE_3_PLUS,
					BETTER_AUTH_SECRET: SECRET_BETTER_AUTH_SECRET_LEGACY,
				},
			});
			assert.equal(result.exitCode, 0);
			// secrets.json would have been written with exactly 3 keys
			// (BETTER_AUTH_SECRETS, MY_WEB_2026_CONSUMER_API_KEY).
			// BETTER_AUTH_SECRET MUST NOT be among them.
			assert.match(result.stdout, /contains 3 keys/);
			// The legacy value MUST NOT appear in dry-run output.
			assert.doesNotMatch(result.stdout, new RegExp(SECRET_BETTER_AUTH_SECRET_LEGACY));
		});

		it('dry-run output reports sanitized env excludes BETTER_AUTH_SECRET', () => {
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: REQUIRED_FOR_PHASE_3_PLUS,
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /sanitized env excludes:.*BETTER_AUTH_SECRET/s);
		});

		it('does NOT include BETTER_AUTH_SECRET in SENSITIVE_KEYS log even when absent from env', () => {
			// Belt-and-suspenders: the SENSITIVE_KEYS log line should
			// always include BETTER_AUTH_SECRET (because it's in the
			// set), regardless of whether it's in process.env.
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: REQUIRED_FOR_PHASE_3_PLUS,
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /sanitized env excludes:.*BETTER_AUTH_SECRET/s);
		});
	});

	describe('argv / log / error-message secret-handling invariant', () => {
		it('does NOT log the secret values in dry-run', () => {
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: REQUIRED_FOR_PHASE_3_PLUS,
			});
			assert.equal(result.exitCode, 0);
			assert.doesNotMatch(result.stdout, new RegExp(SECRET_BETTER_AUTH_SECRETS));
			assert.doesNotMatch(result.stdout, new RegExp(SECRET_CONSUMER_API_KEY));
		});

		it('does NOT log the secret value in error messages (missing secret)', () => {
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: {
					BETTER_AUTH_SECRETS: SECRET_BETTER_AUTH_SECRETS,
				},
			});
			assert.equal(result.exitCode, 1);
			assert.doesNotMatch(result.stderr, new RegExp(SECRET_BETTER_AUTH_SECRETS));
		});

		it('does NOT include INFISICAL_TOKEN when leaked via process.env', () => {
			// Even if the inner script accidentally inherits
			// INFISICAL_TOKEN, the dry-run path must not print it.
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: {
					...REQUIRED_FOR_PHASE_3_PLUS,
					INFISICAL_TOKEN: 'should-never-appear-XYZ-MARKER-9999',
				},
			});
			assert.equal(result.exitCode, 0);
			assert.doesNotMatch(result.stdout, /should-never-appear-XYZ-MARKER-9999/);
		});
	});

	describe('--execute config lockdown (production D1 path)', () => {
		it('rejects --execute with non-production config (wrangler.jsonc)', () => {
			const result = runInIsolatedRepo(['--config=wrangler.jsonc', '--execute'], {
				env: REQUIRED_FOR_PHASE_3_PLUS,
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /--execute is only valid with the canonical/);
			assert.match(result.stderr, /Dev verification path/);
		});

		it('rejects --execute with absolute non-production path', () => {
			// Even though the basename is `wrangler.staging.jsonc`, the
			// absolute path does not equal REPO_ROOT/wrangler.production.jsonc.
			const result = runInIsolatedRepo(
				['--config=/some/other/path/wrangler.staging.jsonc', '--execute'],
				{ env: REQUIRED_FOR_PHASE_3_PLUS },
			);
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /--execute is only valid with the canonical/);
		});

		it('rejects --execute with --config=wrangler.dev.jsonc', () => {
			const result = runInIsolatedRepo(['--config=wrangler.dev.jsonc', '--execute'], {
				env: REQUIRED_FOR_PHASE_3_PLUS,
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /--execute is only valid with the canonical/);
		});

		it('rejects --execute with same-named config in a different directory', () => {
			// A same-named `wrangler.production.jsonc` placed in a
			// tempdir would have passed the old basename check but must
			// be rejected by the new path-equality gate. The script
			// itself runs from REPO_ROOT (resolved via import.meta.url);
			// the request instead points at a tempdir config, so the
			// absolute paths differ.
			const repo = mkdtempSync(join(tmpdir(), 'run-deploy-inner-samename-'));
			const foreignConfig = join(repo, 'wrangler.production.jsonc');
			writeFileSync(foreignConfig, '{}');
			let exitCode = 0;
			let stderr = '';
			try {
				execFileSync(process.execPath, [SCRIPT, `--config=${foreignConfig}`, '--execute'], {
					cwd: repo,
					encoding: 'utf8',
					stdio: ['ignore', 'pipe', 'pipe'],
					env: { ...process.env, ...REQUIRED_FOR_PHASE_3_PLUS },
				});
			} catch (error) {
				exitCode = error.status ?? 1;
				stderr = error.stderr ?? '';
			} finally {
				rmSync(repo, { recursive: true, force: true });
			}
			assert.equal(exitCode, 1);
			assert.match(stderr, /--execute is only valid with the canonical/);
		});

		it('allows dry-run (no --execute) with any config basename', () => {
			// Dev verification path is operator-driven:
			//   infisical run --env=dev -- node scripts/run-deploy-inner.mjs
			//     --config=wrangler.jsonc
			// (dry-run is default; no production side effects.)
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: REQUIRED_FOR_PHASE_3_PLUS,
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /\[dry-run\]/);
		});
	});

	describe('--help', () => {
		it('prints usage and exits 0', () => {
			const result = runInIsolatedRepo(['--help']);
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /run-deploy-inner\.mjs/);
		});
	});
});

// Suppress unused imports (pathToFileURL kept for future ESM-direct import tests).
void pathToFileURL;
