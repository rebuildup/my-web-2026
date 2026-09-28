/**
 * Subprocess regression test for `scripts/rotate-better-auth-secret.mjs`
 * and `scripts/rotate-dev-better-auth-secret.mjs` — Issue #159.
 *
 * Why this file exists (do NOT replace with pure-helper unit tests alone):
 *
 * The `existsSync is not defined` regression in
 * `readInfisicalJson(fsImpl = { readFileSync, existsSync })` was
 * latent at PR #140 first commit (`6e782ec`). All four modes
 * (`--dry-run`, `--execute`, `--verify-only`, `--worker-recovery`)
 * crashed via `main() → readInfisicalJson()` BEFORE any side effect.
 * Unit tests on pure helpers (`generateFreshSecret`,
 * `parseVersionedSecrets`, `buildInfisicalYamlContent`, ...) NEVER
 * reached `readInfisicalJson` and therefore never caught the bug.
 *
 * These tests force the script to take the `main()` path — they
 * `node child_process.spawn` the actual script binary, with the
 * `--dry-run` flag (no side effects, no network access), and assert
 * that:
 *
 *   1. exit code is 0 (not a ReferenceError exit 1)
 *   2. stdout / stderr does NOT contain `existsSync is not defined`
 *   3. stdout shows the `[dry-run] plan:` marker — proving main()
 *      reached past `readInfisicalJson()` into the mode dispatch
 *   4. NO mutation subprocess was spawned (PATH stripped to a
 *      nonexistent directory; `--dry-run` must not require any
 *      binary on PATH)
 *   5. NO plaintext secret value appears in any captured stream
 *      (dry-run prints literal `<fresh>` markers instead)
 *
 * Coverage applies to BOTH drivers — the dev driver imports
 * `readInfisicalJson` from the prod driver and is fixed by the same
 * one-line import addition.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(HERE);

const PROD_SCRIPT = join(REPO_ROOT, 'scripts/rotate-better-auth-secret.mjs');
const DEV_SCRIPT = join(REPO_ROOT, 'scripts/rotate-dev-better-auth-secret.mjs');

/**
 * Spawn the given script as a child process, returning the captured
 * `{status, signal, stdout, stderr}`. `extraEnv` overrides the parent
 * env so the test can disable subprocess resolution by stripping PATH.
 *
 * IMPORTANT: `INFISICAL_TOKEN` / `CLOUDFLARE_API_TOKEN` are NEVER
 * injected. The dry-run mode must succeed without them.
 */
function spawnScript(scriptPath, args, { stripPath = false } = {}) {
	const env = {
		...process.env,
		// Strip any inherited credentials — dry-run must not need them.
		INFISICAL_TOKEN: '',
		CLOUDFLARE_API_TOKEN: '',
		// Keep essential Node + pnpm lookup so the interpreter works.
		NODE_ENV: process.env.NODE_ENV ?? 'test',
	};
	if (stripPath) {
		env.PATH = '/__nonexistent_path_for_subprocess_regression__';
		env.HOME = '/tmp';
	}
	return spawnSync(process.execPath, [scriptPath, ...args], {
		cwd: REPO_ROOT,
		encoding: 'utf8',
		env,
		timeout: 30_000,
		maxBuffer: 1024 * 1024,
	});
}

/**
 * Sanity gate — Issue #159 fix only matters when `.infisical.json`
 * is present (which is the operator-local reality). CI runners may
 * not have it, but the regression test is designed to surface the
 * `existsSync` ReferenceError regardless.
 */
function infisicalJsonPresent() {
	return existsSync(join(REPO_ROOT, '.infisical.json'));
}

function readInfisicalWorkspaceId() {
	const raw = readFileSync(join(REPO_ROOT, '.infisical.json'), 'utf8');
	const parsed = JSON.parse(raw);
	return typeof parsed.workspaceId === 'string' ? parsed.workspaceId : null;
}

describe('rotate-better-auth-secret.mjs — main() subprocess regression (Issue #159)', () => {
	it('--dry-run --environment=prod exits 0 (not ReferenceError exit 1)', function context() {
		if (!infisicalJsonPresent()) {
			// Without .infisical.json the script will fail with the
			// missing-file error from readInfisicalJson — which itself
			// proves the existsSync import was added (otherwise the
			// ReferenceError would surface first). Surface the
			// missing-file path separately below.
			this.skip();
			return;
		}
		const result = spawnScript(PROD_SCRIPT, ['--dry-run', '--environment=prod']);
		assert.equal(
			result.status,
			0,
			`expected exit 0, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
		);
	});

	it('--dry-run --environment=prod stdout does NOT contain "existsSync is not defined"', () => {
		const result = spawnScript(PROD_SCRIPT, ['--dry-run', '--environment=prod']);
		const combined = `${result.stdout}\n${result.stderr}`;
		assert.doesNotMatch(
			combined,
			/existsSync is not defined/,
			`ReferenceError surfaced — Issue #159 regression has returned:\n${combined}`,
		);
	});

	it('--dry-run --environment=prod stdout reaches `[dry-run] plan:` (proves main() got past readInfisicalJson)', () => {
		if (!infisicalJsonPresent()) {
			// Without .infisical.json the script terminates inside
			// readInfisicalJson before reaching the plan output —
			// that's the missing-file failure mode, not the bug
			// fix. With .infisical.json the plan output proves the
			// crash path is cleared.
			const result = spawnScript(PROD_SCRIPT, ['--dry-run', '--environment=prod']);
			assert.equal(result.status, 1);
			assert.match(`${result.stdout}\n${result.stderr}`, /\.infisical\.json not found/);
			return;
		}
		const result = spawnScript(PROD_SCRIPT, ['--dry-run', '--environment=prod']);
		assert.match(result.stdout, /\[dry-run\] plan/);
	});

	it('--dry-run --environment=prod with PATH stripped still exits 0 (no mutation subprocess)', () => {
		// The most consequential invariant: --dry-run must NOT spawn
		// any subprocess binary (no `infisical`, no `wrangler`, no
		// `pnpm`). If a future regression accidentally wires a
		// mutation subprocess into dry-run, this test catches it
		// because PATH=/__nonexistent__ would prevent the child from
		// launching.
		if (!infisicalJsonPresent()) {
			const result = spawnScript(PROD_SCRIPT, ['--dry-run', '--environment=prod'], {
				stripPath: true,
			});
			// Without .infisical.json the script errors inside
			// readInfisicalJson — that error is BEFORE any subprocess
			// would be spawned, so PATH-stripping is irrelevant.
			assert.equal(result.status, 1);
			return;
		}
		const result = spawnScript(PROD_SCRIPT, ['--dry-run', '--environment=prod'], {
			stripPath: true,
		});
		assert.equal(
			result.status,
			0,
			`dry-run should not require any subprocess binary; got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
		);
		assert.match(result.stdout, /\[dry-run\] plan/);
	});

	it('--dry-run --environment=prod stdout never contains a 64-char base64url plaintext', () => {
		const result = spawnScript(PROD_SCRIPT, ['--dry-run', '--environment=prod']);
		// The driver generates a fresh 64-char base64url secret
		// in-process only at --execute; --dry-run must NOT have
		// generated one and never shows the literal value.
		assert.match(result.stdout, /<fresh>/);
		assert.doesNotMatch(result.stdout, /[A-Za-z0-9_-]{64}/);
	});
});

describe('rotate-dev-better-auth-secret.mjs — main() subprocess regression (Issue #159)', () => {
	it('--dry-run --environment=dev exits 0 (not ReferenceError exit 1)', function context() {
		if (!infisicalJsonPresent()) {
			this.skip();
			return;
		}
		const result = spawnScript(DEV_SCRIPT, ['--dry-run', '--environment=dev']);
		assert.equal(
			result.status,
			0,
			`expected exit 0, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
		);
	});

	it('--dry-run --environment=dev stdout does NOT contain "existsSync is not defined"', () => {
		const result = spawnScript(DEV_SCRIPT, ['--dry-run', '--environment=dev']);
		const combined = `${result.stdout}\n${result.stderr}`;
		assert.doesNotMatch(
			combined,
			/existsSync is not defined/,
			`ReferenceError surfaced — Issue #159 regression has returned:\n${combined}`,
		);
	});

	it('--dry-run --environment=dev stdout reaches `[dry-run] plan:` (proves main() got past readInfisicalJson)', () => {
		if (!infisicalJsonPresent()) {
			const result = spawnScript(DEV_SCRIPT, ['--dry-run', '--environment=dev']);
			assert.equal(result.status, 1);
			assert.match(`${result.stdout}\n${result.stderr}`, /\.infisical\.json not found/);
			return;
		}
		const result = spawnScript(DEV_SCRIPT, ['--dry-run', '--environment=dev']);
		assert.match(result.stdout, /\[dry-run\] plan/);
	});

	it('--dry-run --environment=dev with PATH stripped still exits 0 (no mutation subprocess)', () => {
		if (!infisicalJsonPresent()) {
			const result = spawnScript(DEV_SCRIPT, ['--dry-run', '--environment=dev'], {
				stripPath: true,
			});
			assert.equal(result.status, 1);
			return;
		}
		const result = spawnScript(DEV_SCRIPT, ['--dry-run', '--environment=dev'], { stripPath: true });
		assert.equal(
			result.status,
			0,
			`dry-run should not require any subprocess binary; got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
		);
		assert.match(result.stdout, /\[dry-run\] plan/);
	});

	it('--dry-run --environment=dev stdout never contains a 64-char base64url plaintext', () => {
		const result = spawnScript(DEV_SCRIPT, ['--dry-run', '--environment=dev']);
		assert.match(result.stdout, /<fresh>/);
		assert.doesNotMatch(result.stdout, /[A-Za-z0-9_-]{64}/);
	});
});

describe('readInfisicalJson import contract — Issue #159 unit-level coverage', () => {
	it('the node:fs import line includes existsSync (the fix)', () => {
		// Pure-source assertion: the import line must include
		// `existsSync`. This is a structural anchor that survives
		// refactoring better than a single end-to-end subprocess
		// test, complementing the subprocess tests above.
		const source = readFileSync(PROD_SCRIPT, 'utf8');
		const importBlock = source.match(/import \{[\s\S]*?\} from 'node:fs';/);
		assert.ok(importBlock, 'expected a `from "node:fs"` import block in the driver');
		assert.match(
			importBlock[0],
			/\bexistsSync\b/,
			'expected existsSync in the node:fs import (Issue #159 regression)',
		);
	});
});

describe('preflight invariant (operator-side, document surface)', () => {
	it('documents the Issue #159 workspace-id source file', () => {
		// The `--dry-run` output is supposed to surface workspaceId
		// for operator inspection (so the operator can confirm the
		// script is reading the correct Infisical workspace). This
		// test asserts the workspace id is bound from `.infisical.json`
		// (not hardcoded) — guards against a regression that would
		// render the dry-run output misleading.
		if (!infisicalJsonPresent()) {
			this.skip();
			return;
		}
		const expectedId = readInfisicalWorkspaceId();
		assert.ok(expectedId && expectedId.length >= 8, '.infisical.json#workspaceId is missing');
		const result = spawnScript(PROD_SCRIPT, ['--dry-run', '--environment=prod']);
		assert.match(result.stdout, new RegExp(`workspaceId=${expectedId}`));
	});
});
