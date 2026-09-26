#!/usr/bin/env node
/**
 * `check-cf-secrets.mjs` — operator diagnostic for Infisical ↔ Cloudflare
 * Worker secret name parity (ADR-0015 §7).
 *
 * Tier 1 (runtime contract) check:
 *   - Infisical `prod` env contains all 3 runtime secrets:
 *     `BETTER_AUTH_SECRETS`, `BETTER_AUTH_SECRET` (legacy),
 *     `MY_WEB_2026_CONSUMER_API_KEY`
 *
 * Tier 2 (deploy-time contract) check (static, no Cloudflare API):
 *   - `wrangler.production.jsonc#secrets.required` matches the
 *     phase-specific 2-name contract. Drift is reported but
 *     treated as advisory (operator decision).
 *
 * Values are NEVER read — Cloudflare Wrangler / Dashboard cannot
 * read them back anyway, and Infisical values would be exposed to
 * `ps` / logs if accidentally surfaced.
 *
 * Usage:
 *   pnpm run infisical:check:cf                              # dry-run
 *   pnpm run infisical:check:cf -- --execute                 # actually call Infisical API
 *   pnpm run infisical:check:cf -- --execute --environment=dev
 *
 * Invariants:
 *   - argv / log / error message NEVER carries a secret value
 *   - default mode is dry-run (no Infisical API call)
 *   - Cloudflare drift check is STATIC against wrangler config (no API call)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const INFISICAL_API_URL_DEFAULT = 'https://secrets.rebuildup.dev';
const HTTPS_TIMEOUT_MS = 10_000;
const HTTPS_MAX_RESPONSE_BYTES = 256 * 1024;

const RUNTIME_REQUIRED_SECRETS = [
	'BETTER_AUTH_SECRETS',
	'BETTER_AUTH_SECRET',
	'MY_WEB_2026_CONSUMER_API_KEY',
];
const RUNTIME_REQUIRED_SET = new Set(RUNTIME_REQUIRED_SECRETS);

const PHASE_1_2_REQUIRED = ['BETTER_AUTH_SECRET', 'MY_WEB_2026_CONSUMER_API_KEY'];
const PHASE_3_REQUIRED = ['BETTER_AUTH_SECRETS', 'MY_WEB_2026_CONSUMER_API_KEY'];

function printHelp() {
	console.log(`Usage: check-cf-secrets.mjs [--execute] [--dry-run] [--environment=<prod|dev>] [--config=<path>]

Verify the Infisical / Cloudflare secret name contract (ADR-0015 §7).

Default mode is --dry-run (no Infisical API call).

Options:
  --execute                 actually call the Infisical API
                            (operator gate required)
  --dry-run                 parse args + show expected check only (default)
  --environment=<name>      Infisical environment (default: 'prod')
  --config=<path>           wrangler config path (default: wrangler.production.jsonc)
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
	if (args.environment !== 'prod' && args.environment !== 'dev') {
		throw new Error(
			`--environment must be 'prod' or 'dev' (got: ${JSON.stringify(args.environment)})`,
		);
	}
	return args;
}

function readWranglerRequiredSecrets(configPath) {
	const fullPath = resolve(REPO_ROOT, configPath);
	if (!existsSync(fullPath)) {
		throw new Error(`Wrangler config not found: ${fullPath}`);
	}
	const raw = readFileSync(fullPath, 'utf8');
	// Strip // and /* */ comments, then parse as JSON.
	const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
	const parsed = JSON.parse(stripped);
	const required = parsed?.secrets?.required;
	if (!Array.isArray(required)) {
		return [];
	}
	return required.map((name) => {
		if (typeof name !== 'string' || name.length === 0) {
			throw new Error(`Invalid secrets.required entry: ${JSON.stringify(name)}`);
		}
		return name;
	});
}

function determinePhase(wranglerRequired) {
	const has = new Set(wranglerRequired);
	if (has.has('BETTER_AUTH_SECRETS')) return 'phase-3+';
	if (has.has('BETTER_AUTH_SECRET')) return 'phase-1-2';
	return 'unknown';
}

function expectedPhaseRequired(phase) {
	if (phase === 'phase-3+') return PHASE_3_REQUIRED;
	if (phase === 'phase-1-2') return PHASE_1_2_REQUIRED;
	return null;
}

function httpsJson({ method, hostname, port, path, headers, body }) {
	return new Promise((resolvePromise, rejectPromise) => {
		const bodyStr = body ? JSON.stringify(body) : null;
		const headers2 = {
			Accept: 'application/json',
			...headers,
		};
		if (bodyStr) {
			headers2['Content-Type'] = 'application/json';
			headers2['Content-Length'] = Buffer.byteLength(bodyStr);
		}
		const req = httpsRequest(
			{
				method,
				hostname,
				port: port || 443,
				path,
				headers: headers2,
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
						rejectPromise(new Error(`Response exceeded ${HTTPS_MAX_RESPONSE_BYTES} bytes`));
						return;
					}
					chunks.push(chunk);
				});
				res.on('end', () => {
					const text = chunks.join('');
					if (res.statusCode !== 200 && res.statusCode !== 201) {
						rejectPromise(new Error(`HTTP ${res.statusCode} ${method} ${path}`));
						return;
					}
					try {
						resolvePromise(JSON.parse(text));
					} catch (cause) {
						rejectPromise(new Error(`Response not valid JSON: ${cause.message}`));
					}
				});
			},
		);
		req.on('timeout', () => {
			req.destroy(new Error(`HTTP request timed out after ${HTTPS_TIMEOUT_MS}ms`));
		});
		req.on('error', rejectPromise);
		if (bodyStr) req.end(bodyStr);
		else req.end();
	});
}

async function loginUniversalAuth(apiUrl, clientId, clientSecret) {
	const url = new URL(apiUrl);
	const response = await httpsJson({
		method: 'POST',
		hostname: url.hostname,
		port: url.port,
		path: '/api/v1/auth/universal-auth/login',
		body: { clientId, clientSecret },
	});
	const token = response?.accessToken;
	if (typeof token !== 'string' || token.length === 0) {
		throw new Error('Universal Auth response missing accessToken');
	}
	return token;
}

async function listInfisicalSecrets(apiUrl, accessToken, workspaceId, environment) {
	const url = new URL(apiUrl);
	const params = new URLSearchParams({
		workspaceId,
		environment,
		viewSecretValue: 'false',
	});
	const response = await httpsJson({
		method: 'GET',
		hostname: url.hostname,
		port: url.port,
		path: `/api/v3/secrets?${params.toString()}`,
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	const secrets = response?.secrets;
	if (!Array.isArray(secrets)) {
		throw new Error('Infisical response did not contain a secrets array');
	}
	return secrets.map((s) => s?.secretKey).filter((k) => typeof k === 'string');
}

function compareNameLists(actual, expected, label) {
	const actualSet = new Set(actual);
	const expectedSet = new Set(expected);
	const missing = [...expectedSet].filter((n) => !actualSet.has(n));
	const extra = [...actualSet].filter((n) => !expectedSet.has(n));
	return { label, missing, extra, actual: [...actualSet].sort(), expected };
}

function printCheckResult(result, ok) {
	console.log(`[${ok ? 'OK' : 'FAIL'}] ${result.label}`);
	if (result.missing.length > 0) {
		console.log(`  missing: ${result.missing.join(', ')}`);
	}
	if (result.extra.length > 0) {
		console.log(`  extra:   ${result.extra.join(', ')}`);
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const wranglerRequired = readWranglerRequiredSecrets(args.config);
	const phase = determinePhase(wranglerRequired);
	const expectedPhaseList = expectedPhaseRequired(phase);

	console.log(`[check-cf-secrets] environment=${args.environment}`);
	console.log(`[check-cf-secrets] config=${args.config}`);
	console.log(`[check-cf-secrets] detected phase=${phase}`);
	console.log(`[check-cf-secrets] wrangler secrets.required=${JSON.stringify(wranglerRequired)}`);
	console.log(`[check-cf-secrets] mode=${args.execute ? 'execute' : 'dry-run'}`);

	if (args.dryRun) {
		console.log(
			`[dry-run] would verify: Infisical ${args.environment} contains ` +
				`runtime 3-name contract (${RUNTIME_REQUIRED_SECRETS.join(', ')})`,
		);
		if (expectedPhaseList) {
			console.log(
				`[dry-run] would verify: wrangler secrets.required matches phase-specific 2-name (${expectedPhaseList.join(', ')})`,
			);
		} else {
			console.log(
				'[dry-run] could not determine phase from wrangler config (expected: ' +
					'BETTER_AUTH_SECRET or BETTER_AUTH_SECRETS in secrets.required)',
			);
		}
		console.log('[dry-run] OK (no Infisical API call made)');
		return;
	}

	const apiUrl = process.env.INFISICAL_API_URL ?? INFISICAL_API_URL_DEFAULT;
	const clientId = process.env.INFISICAL_CLIENT_ID;
	const clientSecret = process.env.INFISICAL_CLIENT_SECRET;
	if (typeof clientId !== 'string' || clientId.length === 0) {
		throw new Error('INFISICAL_CLIENT_ID env var is required for --execute');
	}
	if (typeof clientSecret !== 'string' || clientSecret.length === 0) {
		throw new Error('INFISICAL_CLIENT_SECRET env var is required for --execute');
	}

	const workspaceIdRaw = process.env.INFISICAL_WORKSPACE_ID;
	if (typeof workspaceIdRaw !== 'string' || workspaceIdRaw.length === 0) {
		throw new Error(
			'INFISICAL_WORKSPACE_ID env var is required for --execute ' +
				'(or set .infisical.json#workspaceId and read it via deploy-with-secrets.mjs)',
		);
	}

	console.log('[execute] Universal Auth login...');
	const accessToken = await loginUniversalAuth(apiUrl, clientId, clientSecret);
	process.env.INFISICAL_TOKEN = accessToken;
	process.env.INFISICAL_CLIENT_ID = undefined;
	process.env.INFISICAL_CLIENT_SECRET = undefined;

	let exitCode = 0;
	try {
		console.log(`[execute] Listing Infisical ${args.environment} secrets...`);
		const infisicalNames = await listInfisicalSecrets(
			apiUrl,
			accessToken,
			workspaceIdRaw,
			args.environment,
		);
		const runtimeCheck = compareNameLists(
			infisicalNames,
			RUNTIME_REQUIRED_SECRETS,
			'Infisical runtime contract (3-name)',
		);
		printCheckResult(runtimeCheck, runtimeCheck.missing.length === 0);
		if (runtimeCheck.missing.length > 0) exitCode = 1;

		const phaseCheck = compareNameLists(
			wranglerRequired,
			expectedPhaseList ?? [],
			`wrangler secrets.required (${phase})`,
		);
		printCheckResult(phaseCheck, phaseCheck.missing.length === 0);
		if (phaseCheck.missing.length > 0) exitCode = 1;
	} finally {
		process.env.INFISICAL_TOKEN = '';
		process.env.INFISICAL_TOKEN = undefined;
	}

	if (exitCode !== 0) {
		console.error(`[execute] FAIL (exit=${exitCode})`);
		process.exit(exitCode);
	}
	console.log('[execute] all checks OK');
}

main().catch((error) => {
	console.error(`check-cf-secrets failed: ${error?.message ?? error}`);
	process.exit(1);
});
