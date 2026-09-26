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

const PHASE_1_2_REQUIRED = ['BETTER_AUTH_SECRET', 'MY_WEB_2026_CONSUMER_API_KEY'];
const PHASE_3_REQUIRED = ['BETTER_AUTH_SECRETS', 'MY_WEB_2026_CONSUMER_API_KEY'];

// `.infisical.json` schema (ADR-0015 §1 Decision). workspaceId is the
// canonical SoT — committed, no secrets, validated as UUID v4 by
// `scripts/infisical-bootstrap.mjs` on write.
const ALLOWED_INFISICAL_JSON_KEYS = new Set(['workspaceId', 'defaultEnvironment']);
const REQUIRED_INFISICAL_JSON_KEYS = ['workspaceId'];

function printHelp() {
	console.log(`Usage: check-cf-secrets.mjs [--execute] [--dry-run] [--environment=<prod|dev>] [--config=<path>]

Verify the Infisical / Cloudflare secret name contract (ADR-0015 §7).

Tier 1 (runtime) — Infisical API list of secret names.
Tier 2 (deploy-time) — wrangler config #secrets.required phase-specific 2-name.
Tier 3 (live worker) — \`wrangler secret list\` against the actual bound
                      Worker secrets (when CLOUDFLARE_API_TOKEN is set).
                      Drift between Tier 1 / Tier 3 = high severity.

Default mode is --dry-run (no Infisical API call, no Cloudflare API call).

Options:
  --execute                 actually call the Infisical API
                            (operator gate required; Tier 3 also runs when
                            CLOUDFLARE_API_TOKEN is set)
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

/**
 * Read `.infisical.json#workspaceId` (ADR-0015 §1 SoT). The file is
 * committed; no env-var override is supported to keep the SoT single-
 * source. `scripts/infisical-bootstrap.mjs` validates workspaceId as
 * UUID v4 on write, so a re-check here is defense-in-depth.
 */
function readInfisicalWorkspaceId() {
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
	return parsed.workspaceId;
}

/**
 * Tier 3: list the actual Cloudflare Worker secret names bound to the
 * production worker. Requires `wrangler secret list --format json
 * -c <config>`. The command reads `CLOUDFLARE_API_TOKEN` (or OAuth
 * profile) from the env, which the operator gates.
 *
 * Returns `null` when the CLI / credentials are not available so the
 * caller can degrade gracefully to a static-only check. Failure to
 * list is reported (not silently swallowed) because drift between
 * Infisical and the live Worker is a high-severity finding.
 */
function listCloudflareWorkerSecretNames(configPath) {
	if (
		typeof process.env.CLOUDFLARE_API_TOKEN !== 'string' ||
		process.env.CLOUDFLARE_API_TOKEN.length === 0
	) {
		return null;
	}
	let stdout;
	try {
		stdout = execFileSync(
			'pnpm',
			['exec', 'wrangler', 'secret', 'list', '--format', 'json', '-c', configPath],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
		);
	} catch (error) {
		throw new Error(
			`wrangler secret list failed (exit=${error?.status ?? '?'}): ${error?.message ?? error}`,
		);
	}
	let parsed;
	try {
		parsed = JSON.parse(stdout);
	} catch (cause) {
		throw new Error(`wrangler secret list returned non-JSON output: ${cause.message}`);
	}
	if (!Array.isArray(parsed)) {
		throw new Error('wrangler secret list output is not a JSON array');
	}
	return parsed
		.map((entry) => entry?.name)
		.filter((name) => typeof name === 'string' && name.length > 0);
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
	// V3 deprecated LIST endpoint is `GET /api/v3/secrets/raw` (NOT
	// `/api/v3/secrets`, which 404s). `viewSecretValue=false` is supported
	// on the V3 `/raw` endpoint — values are nulled in the response and
	// `secretValueHidden: true` is set per item. We only read `secretKey`
	// (the V3 deprecated field name), so the value-masking contract does
	// not affect our names-only drift check.
	// Sources:
	//   - Infisical `backend/src/server/routes/v3/deprecated-secret-router.ts`
	//     registers `GET /raw` for "List secrets" (~line 165).
	//   - OpenAPI `docs/api-reference/endpoints/deprecated/secrets/list.mdx`
	//     pins `openapi: "GET /api/v3/secrets/raw"`.
	// Switching to V4 (`/api/v4/secrets` with `projectId`) would also work
	// but expands scope; V3 keeps the existing `.infisical.json#workspaceId`
	// SoT contract.
	const response = await httpsJson({
		method: 'GET',
		hostname: url.hostname,
		port: url.port,
		path: `/api/v3/secrets/raw?${params.toString()}`,
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
				`[dry-run] would verify: wrangler secrets.required matches phase-specific 2-name exactly (${expectedPhaseList.join(', ')})`,
			);
		} else {
			console.log(
				'[dry-run] [FAIL] cannot determine phase from wrangler config: ' +
					'neither BETTER_AUTH_SECRET nor BETTER_AUTH_SECRETS found in secrets.required. ' +
					'A recognized phase + exact 2-name match is required (ADR-0015 §9).',
			);
			console.log('[dry-run] FAIL (dry-run pre-flight, no API call made)');
			process.exit(1);
		}
		const tier3Eligible =
			typeof process.env.CLOUDFLARE_API_TOKEN === 'string' &&
			process.env.CLOUDFLARE_API_TOKEN.length > 0;
		if (tier3Eligible) {
			console.log(
				'[dry-run] would verify: actual Cloudflare Worker secret names via `wrangler secret list` (CLOUDFLARE_API_TOKEN is set)',
			);
		} else {
			console.log(
				'[dry-run] would skip Tier 3 (live worker): CLOUDFLARE_API_TOKEN not set. ' +
					'Set it to enable Tier 3 drift detection against the actual bound Worker secrets.',
			);
		}
		console.log('[dry-run] OK (no Infisical / Cloudflare API call made)');
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

	// workspaceId SoT: read from `.infisical.json` (ADR-0015 §1
	// Decision). No `INFISICAL_WORKSPACE_ID` env override is
	// supported — the committed file is the single source of truth.
	const workspaceId = readInfisicalWorkspaceId();

	console.log('[execute] Universal Auth login...');
	const accessToken = await loginUniversalAuth(apiUrl, clientId, clientSecret);
	process.env.INFISICAL_TOKEN = accessToken;
	// `delete` (not `= undefined`) is the canonical Node API for
	// removing env entries — assignment to `undefined` coerces to the
	// string `"undefined"`.
	// biome-ignore lint/performance/noDelete: env cleanup; Node docs mandate `delete` (not `= undefined`).
	delete process.env.INFISICAL_CLIENT_ID;
	// biome-ignore lint/performance/noDelete: env cleanup; Node docs mandate `delete` (not `= undefined`).
	delete process.env.INFISICAL_CLIENT_SECRET;

	let exitCode = 0;
	try {
		console.log(`[execute] Listing Infisical ${args.environment} secrets...`);
		const infisicalNames = await listInfisicalSecrets(
			apiUrl,
			accessToken,
			workspaceId,
			args.environment,
		);
		const runtimeCheck = compareNameLists(
			infisicalNames,
			RUNTIME_REQUIRED_SECRETS,
			'Infisical runtime contract (3-name)',
		);
		const runtimeOk = runtimeCheck.missing.length === 0;
		printCheckResult(runtimeCheck, runtimeOk);
		if (!runtimeOk) exitCode = 1;

		// Tier 2 (deploy-time) check: wrangler `secrets.required` must
		// EXACTLY match the recognized phase's 2-name contract — both
		// missing AND extra entries are FAIL conditions. An unknown
		// phase (no recognized pattern) is also a hard FAIL; partial
		// / unknown phase values cannot silently pass.
		if (expectedPhaseList === null) {
			console.error(
				`[execute] [FAIL] cannot determine phase from wrangler config: secrets.required=${JSON.stringify(wranglerRequired)} does not contain a recognized pattern (BETTER_AUTH_SECRET or BETTER_AUTH_SECRETS). Recognized phase + exact 2-name match is required (ADR-0015 §9).`,
			);
			exitCode = 1;
		} else {
			const phaseCheck = compareNameLists(
				wranglerRequired,
				expectedPhaseList,
				`wrangler secrets.required (${phase}, exact 2-name)`,
			);
			const phaseOk = phaseCheck.missing.length === 0 && phaseCheck.extra.length === 0;
			printCheckResult(phaseCheck, phaseOk);
			if (!phaseOk) exitCode = 1;
		}

		// Tier 3: real Cloudflare Worker secret names. Requires
		// CLOUDFLARE_API_TOKEN (operator gate). Drift between Infisical
		// (Tier 1) and the live Worker (Tier 3) is a high-severity
		// finding — a deploy-time secret may exist in Infisical but
		// not be bound on the Worker (or vice versa), and the worker
		// would either fail to start or silently omit the secret.
		const workerNames = listCloudflareWorkerSecretNames(args.config);
		if (workerNames !== null) {
			const workerCheck = compareNameLists(
				workerNames,
				RUNTIME_REQUIRED_SECRETS,
				'Cloudflare Worker (live) runtime contract (3-name)',
			);
			const workerOk = workerCheck.missing.length === 0;
			printCheckResult(workerCheck, workerOk);
			if (!workerOk) exitCode = 1;
		} else {
			console.log(
				'[execute] [NOTE] Tier 3 (live Worker) skipped: CLOUDFLARE_API_TOKEN not set. ' +
					'Set it to enable drift detection against actual bound Worker secrets.',
			);
		}
	} finally {
		// `delete` (not `= undefined`) is the canonical Node API for
		// removing env entries — assignment to `undefined` would coerce
		// to the string `"undefined"`.
		// biome-ignore lint/performance/noDelete: env cleanup; Node docs mandate `delete` (not `= undefined`).
		delete process.env.INFISICAL_TOKEN;
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
