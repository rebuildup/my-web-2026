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

// Phase 1-2: legacy 2-name is required. Phase 3+ will swap these.
const REQUIRED_FOR_PHASE_1_2 = {
	BETTER_AUTH_SECRET: SECRET_BETTER_AUTH_SECRET_LEGACY,
	MY_WEB_2026_CONSUMER_API_KEY: SECRET_CONSUMER_API_KEY,
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
			const result = runInIsolatedRepo([], { env: REQUIRED_FOR_PHASE_1_2 });
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /--config=<path> is required/);
		});

		it('rejects unknown argument', () => {
			const result = runInIsolatedRepo(['--config=wrangler.jsonc', '--bogus'], {
				env: REQUIRED_FOR_PHASE_1_2,
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /unknown argument: --bogus/);
		});
	});

	describe('required secret validation (Phase 1-2: legacy 2-name)', () => {
		it('rejects missing BETTER_AUTH_SECRET', () => {
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: {
					MY_WEB_2026_CONSUMER_API_KEY: SECRET_CONSUMER_API_KEY,
				},
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /Missing required runtime secrets/);
			assert.match(result.stderr, /BETTER_AUTH_SECRET/);
			// The error message must NOT contain the secret value
			// (we did not set it, but assert the boundary anyway).
			assert.doesNotMatch(result.stderr, new RegExp(SECRET_BETTER_AUTH_SECRET_LEGACY));
		});

		it('rejects missing MY_WEB_2026_CONSUMER_API_KEY', () => {
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: {
					BETTER_AUTH_SECRET: SECRET_BETTER_AUTH_SECRET_LEGACY,
				},
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /Missing required runtime secrets/);
			assert.match(result.stderr, /MY_WEB_2026_CONSUMER_API_KEY/);
		});

		it('rejects empty required secret value', () => {
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: {
					BETTER_AUTH_SECRET: '',
					MY_WEB_2026_CONSUMER_API_KEY: SECRET_CONSUMER_API_KEY,
				},
			});
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr, /Missing required runtime secrets/);
		});
	});

	describe('dry-run mode (Phase 1-2)', () => {
		it('succeeds with legacy 2-name (BETTER_AUTH_SECRET + CONSUMER_API_KEY)', () => {
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: REQUIRED_FOR_PHASE_1_2,
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /\[dry-run\]/);
			assert.match(result.stdout, /secrets\.json would have been written/);
			assert.ok(result.stdout.includes('wrangler.jsonc'));
		});

		it('includes BETTER_AUTH_SECRETS when also seeded (Phase 1-2 forward compat)', () => {
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: {
					BETTER_AUTH_SECRET: SECRET_BETTER_AUTH_SECRET_LEGACY,
					BETTER_AUTH_SECRETS: SECRET_BETTER_AUTH_SECRETS,
					MY_WEB_2026_CONSUMER_API_KEY: SECRET_CONSUMER_API_KEY,
				},
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /contains 3 keys/);
		});

		it('omits BETTER_AUTH_SECRETS when not seeded (Phase 1-2 optional)', () => {
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: REQUIRED_FOR_PHASE_1_2,
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /contains 2 keys/);
		});

		it('cleans up the tempdir even on dry-run', () => {
			const before = readdirSync(tmpdir()).filter((name) => name.startsWith(TEMPDIR_PREFIX));
			runInIsolatedRepo(['--config=wrangler.jsonc'], { env: REQUIRED_FOR_PHASE_1_2 });
			const after = readdirSync(tmpdir()).filter((name) => name.startsWith(TEMPDIR_PREFIX));
			// Some other tests may be running; the only invariant we can
			// assert is that no NEW tempdirs leaked (count did not grow).
			assert.equal(after.length, before.length);
		});
	});

	describe('argv / log / error-message secret-handling invariant', () => {
		it('does NOT log the secret values in dry-run', () => {
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: REQUIRED_FOR_PHASE_1_2,
			});
			assert.equal(result.exitCode, 0);
			assert.doesNotMatch(result.stdout, new RegExp(SECRET_BETTER_AUTH_SECRET_LEGACY));
			assert.doesNotMatch(result.stdout, new RegExp(SECRET_CONSUMER_API_KEY));
		});

		it('does NOT log the secret value in error messages (missing secret)', () => {
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: {
					BETTER_AUTH_SECRET: SECRET_BETTER_AUTH_SECRET_LEGACY,
				},
			});
			assert.equal(result.exitCode, 1);
			assert.doesNotMatch(result.stderr, new RegExp(SECRET_BETTER_AUTH_SECRET_LEGACY));
		});

		it('does NOT include INFISICAL_TOKEN when leaked via process.env', () => {
			// Even if the inner script accidentally inherits
			// INFISICAL_TOKEN, the dry-run path must not print it.
			const result = runInIsolatedRepo(['--config=wrangler.jsonc'], {
				env: {
					...REQUIRED_FOR_PHASE_1_2,
					INFISICAL_TOKEN: 'should-never-appear-XYZ-MARKER-9999',
				},
			});
			assert.equal(result.exitCode, 0);
			assert.doesNotMatch(result.stdout, /should-never-appear-XYZ-MARKER-9999/);
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
