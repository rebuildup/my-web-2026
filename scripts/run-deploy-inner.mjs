#!/usr/bin/env node
/**
 * Inner deploy script. Invoked via `infisical run -- node scripts/run-deploy-inner.mjs`.
 *
 * ADR-0015 §4 invariant: this process reads `BETTER_AUTH_SECRETS` /
 * `BETTER_AUTH_SECRET` / `MY_WEB_2026_CONSUMER_API_KEY` from its own
 * `process.env` (Infisical injects them into the immediate child of
 * `infisical run`), writes them to a tempdir secrets.json, then
 * spawns Wrangler deploy with a sanitized env that does NOT carry
 * runtime secrets or `INFISICAL_TOKEN`.
 *
 * The reason for the wrapper:
 *   - Wrangler reads secrets from `--secrets-file`, not `process.env`.
 *   - We must not pass `INFISICAL_TOKEN` or any runtime secret to the
 *     db:migrate / wrangler child processes (process tree depth = 2).
 *
 * Args (forwarded by `deploy-with-secrets.mjs`):
 *   --config=<path>    wrangler config path (required)
 *   --execute          actually run db:migrate + wrangler deploy
 *                      (default: dry-run — write tempdir file then
 *                      rmSync it, no deploy side effect)
 *
 * Exit codes:
 *   0  success
 *   1  internal error (missing env, malformed args, etc.)
 *   2  tempdir / secrets.json write failure
 *   3  db:migrate failure
 *   4  wrangler deploy failure
 *   5  cleanup failure (the deploy itself succeeded; logged loudly)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Phase-specific 2-name contract (ADR-0015 §9). The deploy script's
 * required secrets list MUST match `wrangler.production.jsonc#secrets.required`
 * for the current phase. When the phase transitions (Phase 3+, ticket
 * #69), update this constant in lock-step with the wrangler config
 * update — `check-infisical-coverage.mjs` enforces the agreement.
 *
 * Phase 1-2 (Infisical seed 完了前): legacy 2-name.
 *   - `BETTER_AUTH_SECRET` is the active signing key (wrangler requires it)
 *   - `BETTER_AUTH_SECRETS` is optional (operator may have seeded it
 *     for forward compatibility; better-auth.ts prefers it when present)
 */
const REQUIRED_RUNTIME_SECRETS = ['BETTER_AUTH_SECRET', 'MY_WEB_2026_CONSUMER_API_KEY'];
const OPTIONAL_RUNTIME_SECRETS = ['BETTER_AUTH_SECRETS'];
const SENSITIVE_KEYS = new Set([
	...REQUIRED_RUNTIME_SECRETS,
	...OPTIONAL_RUNTIME_SECRETS,
	'INFISICAL_TOKEN',
]);

/**
 * Resolve the wrangler CLI lazily so that dry-run / arg-validation paths
 * don't require wrangler to be installed in the search path. Returns
 * the absolute path to `wrangler.js` inside the wrangler package.
 */
function resolveWranglerBin() {
	return join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
}

function parseArgs(argv) {
	const args = { config: null, execute: false };
	for (const arg of argv) {
		if (arg.startsWith('--config=')) {
			args.config = arg.slice('--config='.length);
		} else if (arg === '--execute') {
			args.execute = true;
		} else if (arg === '--help' || arg === '-h') {
			printHelp();
			process.exit(0);
		} else {
			console.error(`unknown argument: ${arg}`);
			process.exit(1);
		}
	}
	if (args.config === null) {
		console.error('--config=<path> is required');
		process.exit(1);
	}
	return args;
}

function printHelp() {
	console.log(`Usage: run-deploy-inner.mjs --config=<path> [--execute]

Inner deploy script. Reads runtime secrets from process.env
(Infisical injects them into the immediate child of 'infisical run'),
writes a tempdir secrets.json, then spawns Wrangler deploy with a
sanitized env (no runtime secrets, no INFISICAL_TOKEN).

This script is invoked by deploy-with-secrets.mjs, not by operators
directly. The 'infisical run' parent owns the env discipline.`);
}

function collectSecrets() {
	const secrets = {};
	const missing = [];
	for (const name of REQUIRED_RUNTIME_SECRETS) {
		const value = process.env[name];
		if (typeof value !== 'string' || value.length === 0) {
			missing.push(name);
			continue;
		}
		secrets[name] = value;
	}
	for (const name of OPTIONAL_RUNTIME_SECRETS) {
		const value = process.env[name];
		if (typeof value === 'string' && value.length > 0) {
			secrets[name] = value;
		}
	}
	if (missing.length > 0) {
		throw new Error(
			`Missing required runtime secrets in process.env: ${missing.join(', ')}. Infisical seed may be incomplete (ADR-0015 §11 Initial migration).`,
		);
	}
	return secrets;
}

function buildSanitizedEnv() {
	const env = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (SENSITIVE_KEYS.has(key)) continue;
		if (value === undefined) continue;
		env[key] = value;
	}
	return env;
}

const args = parseArgs(process.argv.slice(2));
const configPath = resolve(args.config);
const secrets = collectSecrets();
const sanitizedEnv = buildSanitizedEnv();
const tempDir = mkdtempSync(join(tmpdir(), 'my-web-2026-deploy-'));
const secretsFile = join(tempDir, 'secrets.json');

let exitCode = 0;
try {
	writeFileSync(secretsFile, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });

	if (!args.execute) {
		console.log(
			`[dry-run] secrets.json would have been written to ${secretsFile} ` +
				`(contains ${Object.keys(secrets).length} keys; argv / log: secret content NOT included)`,
		);
		console.log('[dry-run] would spawn: db:migrate:production + wrangler deploy --secrets-file');
		console.log(`[dry-run] config=${configPath}`);
		console.log(`[dry-run] sanitized env excludes: ${[...SENSITIVE_KEYS].join(', ')}`);
	} else {
		console.log(`Deploying to production (config=${configPath}).`);
		console.log('Applying pending production D1 migrations (db:migrate:production)...');
		execFileSync('pnpm', ['run', 'db:migrate:production'], { env: sanitizedEnv, stdio: 'inherit' });
		console.log(`Deploying Wrangler worker (--secrets-file=${secretsFile})...`);
		execFileSync(
			process.execPath,
			[resolveWranglerBin(), 'deploy', '-c', configPath, '--secrets-file', secretsFile],
			{ env: sanitizedEnv, stdio: 'inherit' },
		);
		console.log('Deploy succeeded.');
	}
} catch (error) {
	exitCode = error?.status ?? (args.execute ? 4 : 2);
	if (exitCode === 0) exitCode = 2;
	console.error(`run-deploy-inner failed (exit=${exitCode}): ${error?.message ?? error}`);
} finally {
	try {
		rmSync(tempDir, { recursive: true, force: true });
	} catch (cleanupError) {
		// Cleanup failure: log loudly. The deploy may have succeeded.
		console.error(
			`Failed to remove tempdir ${tempDir}: ${cleanupError.message}. Manual cleanup required.`,
		);
		if (exitCode === 0) exitCode = 5;
	}
}

process.exit(exitCode);
