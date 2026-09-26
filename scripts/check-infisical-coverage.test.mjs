import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
/**
 * `check-infisical-coverage.mjs` unit tests.
 *
 * The script is a static integrity check: it reads `wrangler.jsonc`,
 * `wrangler.production.jsonc`, and the inner script's
 * `REQUIRED_RUNTIME_SECRETS` constant, then verifies they agree on
 * the phase-specific 2-name contract. Tests use isolated tempdirs
 * with controlled mock files (no real repo files are read).
 */
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'check-infisical-coverage.mjs');

const INNER_SCRIPT_PATH = resolve(HERE, 'run-deploy-inner.mjs');

const PHASE_1_2_WRANGLER = `{
  "name": "my-web-2026",
  "vars": {},
  "secrets": {
    "required": ["BETTER_AUTH_SECRET", "MY_WEB_2026_CONSUMER_API_KEY"]
  }
}
`;

const PHASE_3_WRANGLER = `{
  "name": "my-web-2026",
  "vars": {},
  "secrets": {
    "required": ["BETTER_AUTH_SECRETS", "MY_WEB_2026_CONSUMER_API_KEY"]
  }
}
`;

const EMPTY_WRANGLER = `{
  "name": "my-web-2026",
  "vars": {}
}
`;

/**
 * Run the coverage check in an isolated tempdir. We override the
 * 3 sources by writing fake files with the same names.
 */
function runInIsolatedRepo({
	wranglerDefault = EMPTY_WRANGLER,
	wranglerProduction = PHASE_1_2_WRANGLER,
	innerScript = null,
} = {}) {
	const repo = mkdtempSync(join(tmpdir(), 'check-infisical-coverage-test-'));
	const scriptsDir = join(repo, 'scripts');
	mkdirSync(scriptsDir, { recursive: true });

	// Copy the actual coverage check script.
	writeFileSync(join(scriptsDir, 'check-infisical-coverage.mjs'), readFileSync(SCRIPT, 'utf8'));

	// Write the 3 source files.
	writeFileSync(join(repo, 'wrangler.jsonc'), wranglerDefault);
	writeFileSync(join(repo, 'wrangler.production.jsonc'), wranglerProduction);
	if (innerScript !== null) {
		writeFileSync(join(scriptsDir, 'run-deploy-inner.mjs'), innerScript);
	} else {
		// Copy the real inner script so the check can extract its
		// REQUIRED_RUNTIME_SECRETS constant.
		writeFileSync(
			join(scriptsDir, 'run-deploy-inner.mjs'),
			readFileSync(INNER_SCRIPT_PATH, 'utf8'),
		);
	}

	let stdout = '';
	let stderr = '';
	let exitCode = 0;
	try {
		const result = execFileSync(
			process.execPath,
			[join(scriptsDir, 'check-infisical-coverage.mjs')],
			{
				cwd: repo,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
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

describe('check-infisical-coverage.mjs', () => {
	describe('happy path (Phase 1-2)', () => {
		it('passes when wrangler.production.jsonc + inner script agree on legacy 2-name', () => {
			// wrangler.jsonc is empty (Phase 1-2 default); the real
			// inner script has Phase 1-2 form. Coverage check should
			// note the empty source and pass.
			const result = runInIsolatedRepo({
				wranglerDefault: EMPTY_WRANGLER,
				wranglerProduction: PHASE_1_2_WRANGLER,
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /detected phase: phase-1-2/);
			assert.match(result.stdout, /\[NOTE\] wrangler\.jsonc/);
			assert.match(result.stdout, /\[OK\] wrangler\.production\.jsonc#secrets\.required/);
			assert.match(result.stdout, /\[OK\] scripts\/run-deploy-inner\.mjs#REQUIRED_RUNTIME_SECRETS/);
			assert.match(result.stdout, /all checks OK/);
		});

		it('passes when all 3 sources agree on legacy 2-name', () => {
			const result = runInIsolatedRepo({
				wranglerDefault: PHASE_1_2_WRANGLER,
				wranglerProduction: PHASE_1_2_WRANGLER,
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /all checks OK/);
		});

		it('passes when all 3 sources agree on versioned 2-name (Phase 3+)', () => {
			// Use a custom inner script with Phase 3+ form.
			const innerScript = `#!/usr/bin/env node
const REQUIRED_RUNTIME_SECRETS = ['BETTER_AUTH_SECRETS', 'MY_WEB_2026_CONSUMER_API_KEY'];
const OPTIONAL_RUNTIME_SECRETS = ['BETTER_AUTH_SECRET'];
`;
			const result = runInIsolatedRepo({
				wranglerDefault: PHASE_3_WRANGLER,
				wranglerProduction: PHASE_3_WRANGLER,
				innerScript,
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /detected phase: phase-3\+/);
			assert.match(result.stdout, /all checks OK/);
		});
	});

	describe('drift detection', () => {
		it('fails when wrangler.production.jsonc disagrees with inner script', () => {
			const result = runInIsolatedRepo({
				wranglerDefault: PHASE_1_2_WRANGLER,
				wranglerProduction: PHASE_1_2_WRANGLER,
				innerScript: `#!/usr/bin/env node
const REQUIRED_RUNTIME_SECRETS = ['BETTER_AUTH_SECRETS', 'MY_WEB_2026_CONSUMER_API_KEY'];
const OPTIONAL_RUNTIME_SECRETS = ['BETTER_AUTH_SECRET'];
`,
			});
			assert.equal(result.exitCode, 1);
			// Phase conflict → "cannot determine phase" path. The error
			// may appear on stdout (from main()) or stderr (from a
			// thrown error). We accept either.
			const combined = `${result.stdout}\n${result.stderr}`;
			assert.match(combined, /detected phase: conflict|cannot determine phase|\[FAIL\]/);
		});

		it('fails when wrangler.jsonc has wrong phase-specific 2-name', () => {
			const result = runInIsolatedRepo({
				wranglerDefault: PHASE_3_WRANGLER, // mismatch with production
				wranglerProduction: PHASE_1_2_WRANGLER,
			});
			assert.equal(result.exitCode, 1);
			const combined = `${result.stdout}\n${result.stderr}`;
			assert.match(combined, /detected phase: conflict/);
		});
	});

	describe('empty source handling (Phase 1-2 transition)', () => {
		it('treats empty wrangler.jsonc as NOTE not FAIL', () => {
			const result = runInIsolatedRepo({
				wranglerDefault: EMPTY_WRANGLER,
				wranglerProduction: PHASE_1_2_WRANGLER,
			});
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout, /\[NOTE\] wrangler\.jsonc/);
		});

		it('fails when all sources are empty', () => {
			// The script throws a hard error when the inner script
			// REQUIRED_RUNTIME_SECRETS is empty (parse-time invariant).
			// This is a programming error, not a transient state.
			const emptyInnerScript = `#!/usr/bin/env node
const REQUIRED_RUNTIME_SECRETS = [];
const OPTIONAL_RUNTIME_SECRETS = [];
`;
			const result = runInIsolatedRepo({
				wranglerDefault: EMPTY_WRANGLER,
				wranglerProduction: EMPTY_WRANGLER,
				innerScript: emptyInnerScript,
			});
			assert.equal(result.exitCode, 1);
			const combined = `${result.stdout}\n${result.stderr}`;
			assert.match(combined, /cannot determine phase|no string literals|cannot locate/);
		});
	});

	describe('argv / log / error-message secret-handling invariant', () => {
		it('does NOT include any secret-like value in output', () => {
			// Coverage check is a static integrity check. It should
			// never see or log secret values.
			const result = runInIsolatedRepo({
				wranglerDefault: PHASE_1_2_WRANGLER,
				wranglerProduction: PHASE_1_2_WRANGLER,
			});
			assert.doesNotMatch(result.stdout, /process\.env/);
			assert.doesNotMatch(result.stdout, /password|secret_value|token/i);
		});
	});
});

// Suppress unused imports (pathToFileURL kept for future ESM-direct import tests).
void pathToFileURL;
