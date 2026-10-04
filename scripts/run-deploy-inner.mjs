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
 * (no --config: the Build Output itself is the production gate — Issue #247)
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
import {
	assertDeployableBuildOutput,
	assertDeployCredentialAvailable,
	assertNoAuditOnlySecrets,
	buildDeployArgv,
	BUILD_OUTPUT_DIR,
} from './_cf-build-output.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/**
 * Phase-specific 2-name contract (ADR-0015 §9). The deploy script's
 * required secrets list MUST match `wrangler.production.jsonc#secrets.required`
 * for the current phase. `check-infisical-coverage.mjs` enforces the
 * agreement.
 *
 * Phase 3+ (Initial migration 完了後 — Issue #89): versioned 2-name with
 * audit-only legacy separator.
 *   - `REQUIRED_RUNTIME_SECRETS` are uploaded to the Worker
 *     (`BETTER_AUTH_SECRETS`, `MY_WEB_2026_CONSUMER_API_KEY`).
 *   - `AUDIT_ONLY_SECRETS` are sanitization-only; they MUST NOT reach
 *     the Worker. If `infisical run` injects them into `process.env`
 *     (e.g. the legacy value living in Infisical prod as an audit
 *     trail), the deploy script removes them from the sanitized env
 *     AND MUST NOT include them in `secrets.json` — preventing the
 *     "legacy binding resurrects on next deploy" failure mode. The
 *     audit-trail value remains sourceable from Infisical for recovery
 *     purposes. Phase 5 (#71) is the eventual cleanup window.
 *
 * Issue #187 — `GOOGLE_ANALYTICS_MEASUREMENT_ID` joined the required
 * set when the var was migrated from `wrangler.jsonc#vars` to
 * `secrets.required` (operator flow documented in `docs/runbook/analytics.md`).
 * The value is a public identifier (the `G-XXXXXXX` string), but the
 * operator wants to set / inspect it from the Infisical dashboard,
 * which is only possible for runtime secrets. The placeholder
 * `G-PLACEHOLDER000` is seeded by `scripts/infisical-seed.mjs` at
 * merge time and the operator replaces it with the real value BEFORE
 * cutting traffic to production.
 */
const REQUIRED_RUNTIME_SECRETS = [
	'BETTER_AUTH_SECRETS',
	'MY_WEB_2026_CONSUMER_API_KEY',
	'GOOGLE_ANALYTICS_MEASUREMENT_ID',
];
const AUDIT_ONLY_SECRETS = ['BETTER_AUTH_SECRET'];
const SENSITIVE_KEYS = new Set([
	...REQUIRED_RUNTIME_SECRETS,
	...AUDIT_ONLY_SECRETS,
	'INFISICAL_TOKEN',
]);

function parseArgs(argv) {
	const args = { execute: false };
	for (const arg of argv) {
		if (arg.startsWith('--config=')) {
			// Accepted and ignored. Production authorization now comes
			// from the Build Output, not from a config path (Issue #247).
			arg.slice('--config='.length);
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
	return args;
}

/**
 * Validate that an --execute invocation targets the canonical
 * production config. Side effects (`db:migrate:production` + `wrangler
 * deploy`) are gated on the requested `--config` resolving to the
 * absolute path of the canonical `wrangler.production.jsonc` next to
 * this script. A basename-only check is insufficient because a
 * same-named config in another directory would otherwise bypass the
 * lockdown and run a production D1 migration under a non-canonical
 * config. Dev / preview configs (e.g. `wrangler.jsonc`) may only be
 * used in dry-run mode. ADR-0015 §4.
 */

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
	// AUDIT_ONLY_SECRETS are NEVER written to secrets.json by contract
	// (ADR-0015 §9 audit-only semantics, Phase 3+). They are removed from
	// the sanitized env passed to child processes (SENSITIVE_KEYS covers
	// them), but the contract says they must NOT reach the Worker even
	// if `infisical run` injects them into process.env. This prevents
	// the legacy binding from resurrecting on the next deploy after
	// Phase B deletes the Worker binding. The audit-trail value remains
	// sourceable from Infisical for recovery.
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
// Issue #247: the production gate is the Build Output that is about to
// be shipped, not `--config=wrangler.production.jsonc`. Permission used
// to come from a path convention; it now comes from the artifact
// actually being deployed. This runs BEFORE collectSecrets and before
// any D1 migration or Cloudflare call, so a bad artifact can never
// half-deploy.
let buildOutput = null;
if (args.execute) {
	buildOutput = assertDeployableBuildOutput();
	console.log(
		`[run-deploy-inner] Build Output verified: mode=${buildOutput.mode} ` +
			`worker=${buildOutput.workerName} secrets=${buildOutput.secretBindings.length}`,
	);
}

// The deploy-time Cloudflare credential is required only for a real
// execute. A dry-run must not demand it: it makes no API request.
if (args.execute) {
	assertDeployCredentialAvailable();
}

const secrets = collectSecrets();
// Never re-introduce the audit-only legacy binding (#243).
assertNoAuditOnlySecrets(secrets);
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
		console.log(
			`[dry-run] would run: ${buildDeployArgv({ secretsFile: '<temp-secrets-file>' }).join(' ')}`,
		);
		console.log(`[dry-run] Build Output: ${BUILD_OUTPUT_DIR}`);
		console.log(`[dry-run] sanitized env excludes: ${[...SENSITIVE_KEYS].join(', ')}`);
	} else {
		console.log('Deploying to production (cf prebuilt).');
		console.log('Applying pending production D1 migrations (db:migrate:production)...');
		execFileSync('pnpm', ['run', 'db:migrate:production'], { env: sanitizedEnv, stdio: 'inherit' });
		console.log('Deploying via cf deploy --prebuilt (--secrets-file)...');
		execFileSync('pnpm', ['exec', ...buildDeployArgv({ secretsFile })], {
			env: sanitizedEnv,
			stdio: 'inherit',
		});
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
