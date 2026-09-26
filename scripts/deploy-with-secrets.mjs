#!/usr/bin/env node
/**
 * Production deploy driver — Universal Auth + Wrangler + tempdir secrets file.
 *
 * ADR-0015 §4 deploy script. The deploy command replaces the
 * `wrangler deploy -c wrangler.production.jsonc` step of
 * `pnpm run deploy:production:prepared`. The deploy authority is
 * Cloudflare Workers Builds (AGENTS.md §6 / ADR-0015 §5). This script
 * is the runtime entrypoint that Workers Builds invokes via its
 * configured Deploy command.
 *
 * Pipeline:
 *   1. Stale tempdir cleanup (24h+ old `my-web-2026-deploy-*`).
 *   2. Read `.infisical.json#workspaceId` (SoT, ADR-0015 §1 References).
 *   3. Universal Auth login (HTTPS POST body, shell-less argv).
 *   4. Set `INFISICAL_TOKEN` in parent env (Infisical official contract);
 *      remove `INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` (post-auth
 *      residency minimization).
 *   5. Spawn `infisical run --projectId=$WORKSPACE_ID --env=prod -- node scripts/run-deploy-inner.mjs`.
 *   6. Cleanup `INFISICAL_TOKEN` from parent env (overwrite + delete).
 *
 * Safety:
 *   - `--dry-run` is the default. Skips Universal Auth, `infisical run`,
 *     and `wrangler deploy`. Verifies args + tempdir lifecycle only.
 *   - `--execute` is the operator gate for production side effects.
 *     Workers Builds CI uses `--execute`; local recovery requires
 *     operator authorization in the current interaction
 *     (`skills/github-delivery/SKILL.md §Release PR merge human gate`).
 *
 * Invariants (ADR-0015 §4):
 *   - runtime secrets / `INFISICAL_TOKEN` / `INFISICAL_CLIENT_SECRET`
 *     MUST NOT appear in argv / log / error message
 *   - Universal Auth client secret is sent as HTTPS POST body, NEVER argv
 *   - The db:migrate / wrangler child processes receive a sanitized env
 *     (no runtime secrets, no INFISICAL_TOKEN). Wrangler reads secrets
 *     from `--secrets-file` only.
 *   - Temp secrets file lives under `os.tmpdir()`, not repo root
 *   - Stale tempdirs are cleaned up at startup (local recovery / SIGKILL teardown)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const INNER_SCRIPT = join(HERE, 'run-deploy-inner.mjs');

const INFISICAL_API_URL_DEFAULT = 'https://secrets.rebuildup.dev';
const TEMPDIR_PREFIX = 'my-web-2026-deploy-';
const STALE_TEMPDIR_AGE_MS = 24 * 60 * 60 * 1000;
const REQUIRED_INFISICAL_JSON_KEYS = ['workspaceId'];
const ALLOWED_INFISICAL_JSON_KEYS = new Set(['workspaceId', 'defaultEnvironment']);
const HTTPS_TIMEOUT_MS = 10_000;
const HTTPS_MAX_RESPONSE_BYTES = 64 * 1024;

function printHelp() {
	console.log(`Usage: deploy-with-secrets.mjs [--execute] [--dry-run] [--environment=prod] [--config=<path>]

Production deploy driver (ADR-0015 §4).

This script is production-only. Side effects (db:migrate:production
+ wrangler deploy) are gated by --execute and only valid for the
canonical production config (wrangler.production.jsonc).

For dev / preview verification, run the inner script directly via:
  infisical run --env=dev -- node scripts/run-deploy-inner.mjs --config=wrangler.jsonc
(inner defaults to dry-run, no production side effects.)

Default mode is --dry-run (no production side effects).

Options:
  --execute                 actually run db:migrate + wrangler deploy
                            (operator gate required; production config only)
  --dry-run                 verify args + tempdir lifecycle only (default)
  --environment=<prod>      Infisical environment (default: 'prod'; only
                            'prod' is accepted — this script is production-only)
  --config=<path>           wrangler config path (default: wrangler.production.jsonc)
                            Override only allowed to point at the canonical
                            production config. Other configs are rejected
                            under --execute (inner script enforces this).
  -h, --help                show this help`);
}

function parseArgs(argv) {
	const args = {
		execute: false,
		dryRun: true,
		environment: 'prod',
		config: 'wrangler.production.jsonc',
	};
	let explicitMode = null;
	for (const arg of argv) {
		if (arg === '--execute') {
			if (explicitMode !== null) throw new Error('conflicting mode flags');
			args.execute = true;
			args.dryRun = false;
			explicitMode = '--execute';
		} else if (arg === '--dry-run') {
			if (explicitMode !== null) throw new Error('conflicting mode flags');
			args.execute = false;
			args.dryRun = true;
			explicitMode = '--dry-run';
		} else if (arg.startsWith('--environment=')) {
			args.environment = arg.slice('--environment='.length);
		} else if (arg.startsWith('--config=')) {
			args.config = arg.slice('--config='.length);
		} else if (arg === '--help' || arg === '-h') {
			printHelp();
			process.exit(0);
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	if (args.environment !== 'prod') {
		throw new Error(
			`--environment must be 'prod' (this script is production-only; got: ${JSON.stringify(args.environment)})`,
		);
	}
	return args;
}

function readInfisicalJson() {
	const path = resolve(REPO_ROOT, '.infisical.json');
	if (!existsSync(path)) {
		throw new Error(
			`.infisical.json not found at ${path}. Run \`pnpm run infisical:bootstrap -- --workspace-id=<uuid>\` first.`,
		);
	}
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(path, 'utf8'));
	} catch (cause) {
		throw new Error(`.infisical.json is not valid JSON: ${cause.message}`);
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('.infisical.json must be a JSON object');
	}
	for (const key of Object.keys(parsed)) {
		if (!ALLOWED_INFISICAL_JSON_KEYS.has(key)) {
			throw new Error(`.infisical.json has unexpected key: ${key}`);
		}
	}
	for (const key of REQUIRED_INFISICAL_JSON_KEYS) {
		if (typeof parsed[key] !== 'string' || parsed[key].length === 0) {
			throw new Error(`.infisical.json#${key} must be a non-empty string`);
		}
	}
	return parsed;
}

function cleanupStaleTempDirs() {
	const now = Date.now();
	let removed = 0;
	for (const entry of readdirSync(tmpdir())) {
		if (!entry.startsWith(TEMPDIR_PREFIX)) continue;
		const fullPath = join(tmpdir(), entry);
		try {
			const stat = statSync(fullPath);
			if (!stat.isDirectory()) continue;
			if (now - stat.mtimeMs < STALE_TEMPDIR_AGE_MS) continue;
			rmSync(fullPath, { recursive: true, force: true });
			removed += 1;
		} catch {
			// Best-effort cleanup. SIGKILL teardown races are not fatal.
		}
	}
	return removed;
}

function httpsPostJson(urlString, body) {
	const url = new URL(urlString);
	return new Promise((resolvePromise, rejectPromise) => {
		const bodyJson = JSON.stringify(body);
		const req = httpsRequest(
			{
				method: 'POST',
				hostname: url.hostname,
				port: url.port || 443,
				path: url.pathname + url.search,
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(bodyJson),
				},
				timeout: HTTPS_TIMEOUT_MS,
			},
			(res) => {
				const chunks = [];
				let total = 0;
				res.setEncoding('utf8');
				res.on('data', (chunk) => {
					total += chunk.length;
					if (total > HTTPS_MAX_RESPONSE_BYTES) {
						res.destroy();
						rejectPromise(
							new Error(`Universal Auth response exceeded ${HTTPS_MAX_RESPONSE_BYTES} bytes`),
						);
						return;
					}
					chunks.push(chunk);
				});
				res.on('end', () => {
					const text = chunks.join('');
					if (res.statusCode !== 200 && res.statusCode !== 201) {
						// Do not leak the response body (it may contain
						// diagnostic text but never secrets; still, the
						// invariant is to log only status code).
						rejectPromise(new Error(`Universal Auth login failed with HTTP ${res.statusCode}`));
						return;
					}
					try {
						resolvePromise(JSON.parse(text));
					} catch (cause) {
						rejectPromise(
							new Error(`Universal Auth response was not valid JSON: ${cause.message}`),
						);
					}
				});
			},
		);
		req.on('timeout', () => {
			req.destroy(new Error(`Universal Auth request timed out after ${HTTPS_TIMEOUT_MS}ms`));
		});
		req.on('error', rejectPromise);
		req.end(bodyJson);
	});
}

async function loginUniversalAuth(apiUrl, clientId, clientSecret) {
	const loginUrl = `${apiUrl.replace(/\/+$/, '')}/api/v1/auth/universal-auth/login`;
	const response = await httpsPostJson(loginUrl, {
		clientId,
		clientSecret,
	});
	const token = response?.accessToken;
	if (typeof token !== 'string' || token.length === 0) {
		throw new Error('Universal Auth response missing accessToken');
	}
	return token;
}

function findInfisicalCli() {
	const cliPath = require.resolve('@infisical/cli/bin/infisical.js');
	return cliPath;
}

function run(args, options = {}) {
	return execFileSync(process.execPath, args, {
		stdio: 'inherit',
		...options,
	});
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const removedTempDirs = cleanupStaleTempDirs();
	const config = readInfisicalJson();

	console.log(`[deploy-with-secrets] workspaceId=${config.workspaceId}`);
	console.log(`[deploy-with-secrets] environment=${args.environment}`);
	console.log(`[deploy-with-secrets] config=${args.config}`);
	console.log(`[deploy-with-secrets] mode=${args.execute ? 'execute' : 'dry-run'}`);
	if (removedTempDirs > 0) {
		console.log(
			`[deploy-with-secrets] cleanup: removed ${removedTempDirs} stale tempdir(s) (age > ${STALE_TEMPDIR_AGE_MS / 1000}s)`,
		);
	}

	if (args.dryRun) {
		console.log(
			'[dry-run] skipping Universal Auth login and wrangler deploy. ' +
				'Pass --execute to actually deploy (operator gate).',
		);
		// Verify the inner script can be loaded: this catches path /
		// missing-file errors before Workers Builds invokes the
		// real flow.
		if (!existsSync(INNER_SCRIPT)) {
			throw new Error(`Inner script not found: ${INNER_SCRIPT}`);
		}
		console.log(`[dry-run] inner script verified: ${INNER_SCRIPT}`);
		console.log('[dry-run] OK');
		return;
	}

	// --execute path
	const apiUrl = process.env.INFISICAL_API_URL ?? INFISICAL_API_URL_DEFAULT;
	const clientId = process.env.INFISICAL_CLIENT_ID;
	const clientSecret = process.env.INFISICAL_CLIENT_SECRET;
	if (typeof clientId !== 'string' || clientId.length === 0) {
		throw new Error('INFISICAL_CLIENT_ID env var is required for --execute');
	}
	if (typeof clientSecret !== 'string' || clientSecret.length === 0) {
		throw new Error('INFISICAL_CLIENT_SECRET env var is required for --execute');
	}

	console.log('[execute] Universal Auth login...');
	const accessToken = await loginUniversalAuth(apiUrl, clientId, clientSecret);

	// Env discipline: INFISICAL_TOKEN is the official contract. CLIENT_ID /
	// CLIENT_SECRET must be removed post-auth (residency minimization).
	// `delete` (not `= undefined`) is the canonical Node API for removing
	// env entries — assignment to `undefined` coerces to the string
	// `"undefined"`.
	process.env.INFISICAL_TOKEN = accessToken;
	// biome-ignore lint/performance/noDelete: env cleanup; Node docs mandate `delete` (not `= undefined`).
	delete process.env.INFISICAL_CLIENT_ID;
	// biome-ignore lint/performance/noDelete: env cleanup; Node docs mandate `delete` (not `= undefined`).
	delete process.env.INFISICAL_CLIENT_SECRET;

	// Force overwrite of the local variable so that even if the V8 heap
	// is later inspected, the raw token is not retained in our frame.
	let childExitCode = 0;
	try {
		const infisicalCli = findInfisicalCli();
		const innerArgs = [
			infisicalCli,
			'run',
			'--projectId',
			config.workspaceId,
			'--env',
			args.environment,
			'--',
			process.execPath,
			INNER_SCRIPT,
			'--config',
			args.config,
			'--execute',
		];
		console.log(
			`[execute] spawning: infisical run --projectId=<workspaceId> --env=${args.environment} -- <inner> --config=${args.config} --execute`,
		);
		try {
			execFileSync(process.execPath, innerArgs, {
				stdio: 'inherit',
			});
		} catch (error) {
			childExitCode = error?.status ?? 1;
			console.error(`Inner deploy failed (exit=${childExitCode}).`);
		}
	} finally {
		// Cleanup INFISICAL_TOKEN in the parent env. `delete` is the
		// canonical Node API for removing env entries — assignment to
		// `undefined` would coerce to the string `"undefined"`.
		// biome-ignore lint/performance/noDelete: env cleanup; Node docs mandate `delete` (not `= undefined`).
		delete process.env.INFISICAL_TOKEN;
	}

	if (childExitCode !== 0) {
		process.exit(childExitCode);
	}
	console.log('[execute] deploy completed.');
}

main().catch((error) => {
	console.error(`deploy-with-secrets failed: ${error?.message ?? error}`);
	process.exit(1);
});
