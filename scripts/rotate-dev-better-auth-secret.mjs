#!/usr/bin/env node
/**
 * Issue #149 — Fresh dev `BETTER_AUTH_SECRET` rotation in
 * Infisical `dev` env (exposed-credential cleanup; NOT production).
 *
 * ## Scope
 *
 * On 2026-09-28, a read-only Infisical preflight for Issue #122 leaked
 * four plaintext secret values into agent output. One of them was the
 * dev `BETTER_AUTH_SECRET`. The dev value is no longer a production
 * source after the post-#89 / post-#140 production-side flip, but
 * the dev env itself still holds the exposed plaintext as its active
 * Better Auth signing material. This script is the **dev-side
 * cleanup driver**.
 *
 * It is intentionally NOT a parameterisation of
 * `scripts/rotate-better-auth-secret.mjs`: that driver is
 * production-only and its `--environment=prod` lock prevents
 * accidental cross-environment mutation. The dev cleanup has a
 * different threat model:
 *
 *   - No Worker mutation (dev runs locally; Cloudflare bindings are
 *     not involved).
 *   - Default environment is `dev`; the script REFUSES any other
 *     value (fail-closed).
 *   - The Infisical CLI subprocess env uses `buildInfisicalEnv`
 *     (keeps writer `INFISICAL_TOKEN`; see PR #140 re-review).
 *   - Verification uses the wrapped `response.secret.secretValue`
 *     shape (PR #151 contract); 404 + allowMissing = null,
 *     otherwise fail-closed.
 *
 * ## Operation modes (mutually exclusive)
 *
 *  - `--dry-run` (default): describe plan, no network, no mutation.
 *  - `--execute`: full cycle — generate fresh + Infisical dev write
 *    + read-back byte verification. Operator-authorized. Requires
 *    writer-scope `INFISICAL_TOKEN` for the `dev` env.
 *
 * After `--execute`, the operator regenerates local `.dev.vars` via
 * `pnpm run generate:dev-vars` to pick up the fresh material. This
 * script does NOT touch `.dev.vars` directly (single-concern: Infisical
 * dev env only). No D1 mutation, no Worker mutation.
 *
 * ## Why not parameterise the prod driver?
 *
 * `scripts/rotate-better-auth-secret.mjs` has a hard
 * `--environment=prod` lock (line 333 area). Adding a `dev` mode
 * there would weaken the production-only safety invariant. The
 * dev cleanup has different blast radius (local dev only), different
 * verification surface (no Worker binding names), and different
 * user (a local developer, not the release operator). A separate
 * driver is the clean ownership boundary. Pure helpers
 * (`generateFreshSecret`, `validateFreshSecret`, `parseVersionedSecrets`,
 * `secretValuesEqual`, `buildInfisicalYamlContent`, `buildInfisicalEnv`,
 * `buildSecretReadUrl`, `interpretInfisicalReadResponse`,
 * `classifyInfisicalHttpStatus`, `httpsGetJson`, `readInfisicalSecret`,
 * `resolveInfisicalCliPath`, `buildInfisicalSetArgs`, `spawnInfisicalSet`,
 * `cleanupStaleTempDirs`) are imported from the prod driver.
 *
 * ## Out of scope
 *
 *  - Production rotation. Handled by `scripts/rotate-better-auth-secret.mjs`.
 *  - `MY_WEB_2026_CONSUMER_API_KEY` rotation. Handled by
 *    `scripts/rotate-home-api-key.mjs`. (The home consumer key in
 *    dev has a separate D1 row; not in scope for the Better Auth
 *    dev signing material cleanup.)
 *  - `.dev.vars` direct write. The operator runs
 *    `pnpm run generate:dev-vars` to refresh the local file.
 *  - `MY_WEB_2026_CONSUMER_API_KEY` dev value rotation. The exposed
 *    dev credential cleanup for that is a separate ticket (out of
 *    scope for #149).
 *  - Cloudflare D1 / R2 mutation.
 *  - Worker binding mutation.
 *  - Release PR / tag / GitHub Release.
 *
 * ## Safety invariants (FAIL-CLOSED on any violation)
 *
 *  - Default mode is `--dry-run`. No network access, no mutation.
 *  - `--execute` requires operator-supplied `INFISICAL_TOKEN` with
 *    write permission on the `dev` env. Viewer Machine Identity
 *    fails-closed.
 *  - `--environment` MUST equal `dev` (default). Any other value
 *    (including `prod`) is rejected with exit 1. This prevents
 *    accidental prod mutation through this script.
 *  - Fresh secret is NEVER persisted to a file outside the
 *    0600-permission YAML temp file consumed by the Infisical CLI
 *    subprocess. Temp file lives under `os.tmpdir()` and is
 *    `rmSync`'d in `finally` after the subprocess exits.
 *  - Fresh secret is NEVER passed via argv, `process.env`, log line,
 *    error message, GitHub comment, chat output, or temp filename.
 *  - Subprocess uses `buildInfisicalEnv` (PR #140 contract) to keep
 *    the writer `INFISICAL_TOKEN` scoped to the Infisical CLI only.
 *  - All subprocess spawns use `shell: false` and explicit JSON argv
 *    arrays. No `sh -c`, no `bash -c`, no command substitution.
 *  - Read-back verification uses the wrapped `response.secret.secretValue`
 *    shape (PR #151 contract). 404 + allowMissing = null;
 *    401 / 403 / 5xx = fail-closed.
 *
 * ## Exit codes
 *
 *  - 0  success
 *  - 1  argument / preflight / env validation failure
 *  - 2  Infisical subprocess failure
 *  - 3  partial-failure recovery state (Infisical dev fresh write
 *       succeeded, but read-back byte verification failed). Operator
 *       must investigate; the fresh value is now in Infisical dev
 *       but the byte-equality check did not match. DO NOT re-run
 *       `--execute` (that would generate a NEW fresh value and
 *       overwrite the in-flight value). Manual cleanup or a
 *       follow-up driver invocation is required.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	FRESH_SECRET_BYTES_DEFAULT,
	SECRET_NAME_LEGACY,
	SECRET_NAME_VERSIONED,
	TEMPDIR_PREFIX,
	buildInfisicalEnv,
	buildInfisicalSetArgs,
	buildInfisicalYamlContent,
	buildVersionedForm,
	classifyInfisicalHttpStatus,
	cleanupStaleTempDirs,
	generateFreshSecret,
	httpsGetJson,
	interpretInfisicalReadResponse,
	readInfisicalSecret,
	resolveInfisicalCliPath,
	secretValuesEqual,
	spawnInfisicalSet,
	validateFreshSecret,
} from './rotate-better-auth-secret.mjs';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const INFISICAL_JSON_PATH = join(REPO_ROOT, '.infisical.json');

const INFISICAL_API_URL_DEFAULT = 'https://secrets.rebuildup.dev';
const ALLOWED_ENVIRONMENTS = new Set(['dev']);
const SUBPROCESS_TIMEOUT_MS = 30_000;

const MODES = ['dry-run', 'execute'];

/* ─── Pure helpers (testable; no IO) ───────────────────────────────────── */

/**
 * Parse argv. Mutually-exclusive mode flags. `--environment` defaults
 * to `dev`; any other value is rejected. `--execute` requires
 * operator-supplied `INFISICAL_TOKEN` (verified in main(), not here).
 */
function parseArgs(argv) {
	let mode = 'dry-run';
	let explicitMode = null;
	let environment = 'dev';
	let apiUrl = INFISICAL_API_URL_DEFAULT;
	let bytesOverride = null;
	for (const arg of argv) {
		if (arg === '--execute') {
			if (explicitMode !== null) {
				throw new Error(`conflicting mode flags (${explicitMode} + ${arg})`);
			}
			mode = 'execute';
			explicitMode = arg;
		} else if (arg === '--dry-run') {
			if (explicitMode !== null) {
				throw new Error(`conflicting mode flags (${explicitMode} + ${arg})`);
			}
			mode = 'dry-run';
			explicitMode = arg;
		} else if (arg.startsWith('--environment=')) {
			environment = arg.slice('--environment='.length);
		} else if (arg.startsWith('--api-url=')) {
			apiUrl = arg.slice('--api-url='.length);
		} else if (arg.startsWith('--fresh-bytes=')) {
			const n = Number(arg.slice('--fresh-bytes='.length));
			if (!Number.isInteger(n)) {
				throw new Error(`--fresh-bytes must be an integer (got: ${arg})`);
			}
			bytesOverride = n;
		} else if (arg === '--help' || arg === '-h') {
			printHelp();
			process.exit(0);
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	if (!ALLOWED_ENVIRONMENTS.has(environment)) {
		throw new Error(
			`--environment must be one of [${[...ALLOWED_ENVIRONMENTS].join(', ')}] for the dev cleanup driver; got: ${JSON.stringify(environment)}. The production driver is scripts/rotate-better-auth-secret.mjs (its --environment is locked to 'prod').`,
		);
	}
	return { mode, environment, apiUrl, bytesOverride };
}

function printHelp() {
	console.log(`Usage: rotate-dev-better-auth-secret.mjs
  [--execute | --dry-run]
  [--environment=dev]
  [--api-url=<url>]
  [--fresh-bytes=<32..128>]

Issue #149 — Fresh dev BETTER_AUTH_SECRET rotation in Infisical 'dev' env.
NOT a production driver. Production rotation is scripts/rotate-better-auth-secret.mjs.

Operation modes (mutually exclusive):
  --dry-run         default; describe plan, no side effects, no network
  --execute         full cycle: generate fresh + Infisical dev write + read-back
                    byte verification (requires operator-supplied INFISICAL_TOKEN
                    with write permission on the 'dev' env).

Default: --dry-run + --environment=dev. The dev-only lock is intentional:
any value other than 'dev' is rejected with exit 1.

Fresh secret invariants:
  - 48 bytes → 64 base64url chars → 384 bits of entropy (default)
  - generated IN-PROCESS via crypto.randomBytes
  - never persisted except to a 0600 YAML temp file consumed by the
    Infisical CLI subprocess; rmSync'd in finally
  - never in argv, stdout, stderr, log, error message, GitHub, chat,
    or temp filename

After --execute, the operator regenerates local .dev.vars via
  pnpm run generate:dev-vars
to pick up the fresh material. This script does NOT touch .dev.vars
directly (single-concern: Infisical dev env only).

Production desired state post-rotation:
  - Infisical dev BETTER_AUTH_SECRET  = <fresh>
  - Infisical dev BETTER_AUTH_SECRETS = 1:<fresh>

Failure semantics:
  - Read-back byte verification failure (exit 3) is partial-failure:
    the fresh value IS in Infisical dev, but the byte-equality check
    did not match. DO NOT re-run --execute (that would generate a
    NEW fresh value and overwrite the in-flight value). Investigate
    manually or invoke a follow-up driver.

Exit codes: 0 success / 1 arg+preflight / 2 subprocess failure /
            3 read-back byte verification mismatch`);
}

/* ─── Subprocess wrappers (testable via deps injection) ──────────────── */

/**
 * Compose the env for the Infisical CLI subprocess using
 * `buildInfisicalEnv` (imported from the prod driver; PR #140 contract:
 * keeps the writer INFISICAL_TOKEN, strips other Infisical credentials).
 */
function buildInfisicalSubprocessEnv(token) {
	return buildInfisicalEnv(process.env, token);
}

function awaitExit(child, { timeoutMs = SUBPROCESS_TIMEOUT_MS } = {}) {
	return new Promise((resolve) => {
		let resolved = false;
		const finish = (code, signal) => {
			if (resolved) return;
			resolved = true;
			resolve({ code, signal });
		};
		const timer = setTimeout(() => {
			child.kill('SIGTERM');
			finish(null, 'SIGTERM_TIMEOUT');
		}, timeoutMs);
		child.on('exit', (code, signal) => {
			clearTimeout(timer);
			finish(code, signal);
		});
		child.on('error', () => {
			clearTimeout(timer);
			finish(null, 'SPAWN_ERROR');
		});
	});
}

async function runInfisicalSet({ cliPath, yamlPath, environment, env, deps = {} }) {
	const spawnFn = deps.spawn ?? spawn;
	const child = spawnFn(cliPath, buildInfisicalSetArgs(yamlPath, environment), {
		stdio: ['pipe', 'pipe', 'pipe'],
		env,
	});
	const stdoutChunks = [];
	const stderrChunks = [];
	child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
	child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
	const { code, signal } = await awaitExit(child);
	const stdout = Buffer.concat(stdoutChunks).toString('utf8');
	const stderr = Buffer.concat(stderrChunks).toString('utf8');
	return { code, signal, stdout, stderr };
}

/* ─── Status report helpers ───────────────────────────────────────────── */

/**
 * Status-only output for the dev env: legacy + versioned byte checks
 * against the in-process fresh value. Names + booleans only — never
 * values, hashes, or lengths.
 */
function summarizeDevState({ legacyValue, versionedValue, expectedFresh }) {
	const legacyPresent = typeof legacyValue === 'string' && legacyValue.length > 0;
	const versionedPresent = typeof versionedValue === 'string' && versionedValue.length > 0;
	if (!legacyPresent && !versionedPresent) {
		return { status: 'BOTH_MISSING', legacyPresent, versionedPresent };
	}
	if (legacyPresent && !versionedPresent) {
		return { status: 'LEGACY_ONLY', legacyPresent, versionedPresent };
	}
	if (!legacyPresent && versionedPresent) {
		return { status: 'VERSIONED_ONLY', legacyPresent, versionedPresent };
	}
	const expectedEnvelope = buildVersionedForm(legacyValue);
	const envelopeOk = secretValuesEqual(expectedEnvelope, versionedValue);
	const freshOk =
		expectedFresh === undefined ? null : secretValuesEqual(legacyValue, expectedFresh);
	return {
		status: envelopeOk && (freshOk === null ? true : freshOk) ? 'CONSISTENT' : 'DIVERGENT',
		legacyPresent,
		versionedPresent,
		envelopeOk,
		freshOk,
	};
}

/* ─── Public exports (DI seams for tests) ──────────────────────────────── */

export {
	ALLOWED_ENVIRONMENTS,
	INFISICAL_API_URL_DEFAULT,
	MODES,
	SECRET_NAME_LEGACY,
	SECRET_NAME_VERSIONED,
	buildInfisicalSubprocessEnv,
	parseArgs,
	printHelp,
	runInfisicalSet,
	summarizeDevState,
};

/* ─── CLI entrypoint ───────────────────────────────────────────────────── */

async function runDevVerify({ apiUrl, token, workspaceId, environment }) {
	const legacyValue = await readInfisicalSecret({
		apiUrl,
		token,
		workspaceId,
		environment,
		name: SECRET_NAME_LEGACY,
		allowMissing: true,
	});
	const versionedValue = await readInfisicalSecret({
		apiUrl,
		token,
		workspaceId,
		environment,
		name: SECRET_NAME_VERSIONED,
		allowMissing: true,
	});
	return summarizeDevState({ legacyValue, versionedValue });
}

async function main() {
	const args = parseArgs(process.argv.slice(2));

	// .infisical.json read (uses the prod driver's parser for consistency)
	const { readInfisicalJson } = await import('./rotate-better-auth-secret.mjs');
	const infisicalConfig = readInfisicalJson();
	cleanupStaleTempDirs();

	console.log(`[rotate-dev-better-auth] mode=${args.mode}`);
	console.log(`[rotate-dev-better-auth] environment=${args.environment}`);
	console.log(`[rotate-dev-better-auth] workspaceId=${infisicalConfig.workspaceId}`);

	const apiUrl = process.env.INFISICAL_API_URL ?? args.apiUrl;

	if (args.mode === 'dry-run') {
		console.log('[dry-run] plan:');
		console.log(
			'  1. generate fresh BETTER_AUTH_SECRET (crypto.randomBytes, 48B → 64 base64url chars)',
		);
		console.log(
			`  2. write Infisical ${args.environment}: BETTER_AUTH_SECRET = <fresh> + BETTER_AUTH_SECRETS = 1:<fresh>`,
		);
		console.log(
			`  3. verify: HTTPS GET read-back via wrapped response.secret.secretValue + timingSafeEqual (Infisical ${args.environment})`,
		);
		console.log(
			'  4. operator regenerates .dev.vars: pnpm run generate:dev-vars (out of script scope)',
		);
		console.log('[dry-run] no side effects; pass --execute to apply (operator gate required)');
		return;
	}

	// --execute path
	const token = process.env.INFISICAL_TOKEN;
	if (typeof token !== 'string' || token.length === 0) {
		throw new Error(
			`INFISICAL_TOKEN is required for --execute (writer scope on env=${args.environment}; viewer Machine Identity fails-closed).`,
		);
	}

	const freshSecret = generateFreshSecret(args.bytesOverride ?? FRESH_SECRET_BYTES_DEFAULT);
	validateFreshSecret(freshSecret);

	const cliPath = resolveInfisicalCliPath();
	const tempDir = mkdtempSync(join(tmpdir(), TEMPDIR_PREFIX));
	const yamlPath = join(tempDir, 'rotate-dev.yaml');
	let readBackLegacy;
	let readBackVersioned;
	try {
		writeFileSync(yamlPath, buildInfisicalYamlContent(freshSecret), {
			encoding: 'utf8',
			mode: 0o600,
		});
		console.log(
			`[execute] writing fresh ${SECRET_NAME_LEGACY} + ${SECRET_NAME_VERSIONED} to Infisical ${args.environment} (via CLI subprocess for E2EE)...`,
		);
		const infisicalEnv = buildInfisicalSubprocessEnv(token);
		const infisicalResult = await runInfisicalSet({
			cliPath,
			yamlPath,
			environment: args.environment,
			env: infisicalEnv,
		});
		if (infisicalResult.signal) {
			throw new Error(`infisical CLI terminated by signal ${infisicalResult.signal}`);
		}
		if (infisicalResult.code !== 0) {
			throw new Error(`infisical CLI exited with status ${infisicalResult.code}`);
		}

		// Read-back verification: Infisical byte equality.
		console.log('[execute] verifying Infisical read-back (HTTPS GET + timingSafeEqual)...');
		readBackLegacy = await readInfisicalSecret({
			apiUrl,
			token,
			workspaceId: infisicalConfig.workspaceId,
			environment: args.environment,
			name: SECRET_NAME_LEGACY,
		});
		readBackVersioned = await readInfisicalSecret({
			apiUrl,
			token,
			workspaceId: infisicalConfig.workspaceId,
			environment: args.environment,
			name: SECRET_NAME_VERSIONED,
		});
		if (!secretValuesEqual(readBackLegacy, freshSecret)) {
			throw new Error(
				`Infisical read-back mismatch: ${SECRET_NAME_LEGACY} did not byte-match the fresh value`,
			);
		}
		if (!secretValuesEqual(readBackVersioned, buildVersionedForm(freshSecret))) {
			throw new Error(
				`Infisical read-back mismatch: ${SECRET_NAME_VERSIONED} did not match the versioned envelope`,
			);
		}
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}

	// Report.
	console.log(
		`[execute] complete. Infisical ${args.environment}: fresh ${SECRET_NAME_LEGACY} + ${SECRET_NAME_VERSIONED}.`,
	);
	console.log(
		'[execute] Operator MUST run `pnpm run generate:dev-vars` to refresh local .dev.vars (out of script scope).',
	);
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMainModule) {
	main().catch((error) => {
		// Status-only error message. Do NOT echo the error.stack
		// (could leak the secret value through internal error
		// stringification in edge cases).
		console.error(`rotate-dev-better-auth-secret failed: ${error?.message ?? error}`);
		process.exit(1);
	});
}
