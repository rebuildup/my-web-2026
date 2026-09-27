#!/usr/bin/env node
/**
 * `generate-dev-vars.mjs` — Issue #69 Phase 3 fallback for fileless dev.
 *
 * Primary path: `pnpm dev` (`scripts/_run-dev.mjs`) — Windows-safe wrapper
 * that spawns `infisical run --env=dev -- pnpm exec vite dev` with the
 * canonical `.infisical.json#workspaceId` resolution. Reads secrets at
 * process start; no `.dev.vars` file is written.
 *
 * Fallback path: `pnpm run generate:dev-vars` (this script) — fetches the
 * dev env secrets from Infisical and writes `.dev.vars` for offline /
 * token-expired / no-infisical-CLI scenarios. The CLI binary is required
 * because `wrangler dev` reads `.dev.vars` natively; this script only
 * bridges the Infisical → `.dev.vars` step.
 *
 * Usage:
 *   pnpm run generate:dev-vars             # default env (.infisical.json#defaultEnvironment)
 *   pnpm run generate:dev-vars -- --env=dev
 *   pnpm run generate:dev-vars -- --dry-run    # print plan without writing
 *   pnpm run generate:dev-vars -- --help
 *
 * Invariants (operator-mandated):
 *   - argv / log / error message NEVER carries a secret value.
 *   - On any failure, the partial `.dev.vars` file is removed before exit
 *     (atomic write: write to a temp file then rename).
 *   - The prod environment is UNCONDITIONALLY REJECTED. `--env=prod`,
 *     `--env=production`, `--env=PROD` (case-insensitive), or any value
 *     matching `isProdEnvironment` exits with code 1 before any HTTP
 *     request or file write. Prod secrets never land in a local
 *     `.dev.vars`; production secret management is owned by the
 *     Cloudflare Workers Builds deploy path (Phase 4 #70) and
 *     `wrangler secret put`, never by this script.
 *   - Only the `secrets.required` set from the chosen Wrangler config is
 *     fetched; anything else in Infisical is ignored.
 *
 * Required env:
 *   INFISICAL_TOKEN — operator-supplied short-lived access token
 *                     (`pnpm exec infisical user get token` or `infisical login`).
 * Optional env:
 *   INFISICAL_API_URL — defaults to `https://secrets.rebuildup.dev`.
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const INFISICAL_API_URL_DEFAULT = 'https://secrets.rebuildup.dev';
export const HTTPS_TIMEOUT_MS = 15_000;
export const HTTPS_MAX_RESPONSE_BYTES = 256 * 1024;
const DEV_VARS_TMP_SUFFIX = '.tmp';
const DEV_VARS_FILENAME = '.dev.vars';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');

/**
 * Strip // line-comments and /* ... *​/ block-comments from JSONC source,
 * then parse as JSON. Mirrors the pattern in `scripts/check-cf-secrets.mjs`.
 */
export function parseJsonc(source) {
	const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
	return JSON.parse(stripped);
}

/**
 * Parse `secrets.required` from a Wrangler JSONC config.
 *
 * Returns `[]` if the config does not declare `secrets.required`. Throws
 * if `secrets.required` exists but is malformed.
 */
export function parseSecretsRequired(wranglerJsoncSource) {
	const parsed = parseJsonc(wranglerJsoncSource);
	const required = parsed?.secrets?.required;
	if (required === undefined) return [];
	if (!Array.isArray(required)) {
		throw new Error('wrangler config: secrets.required must be an array');
	}
	for (const entry of required) {
		if (typeof entry !== 'string' || entry.length === 0) {
			throw new Error(`wrangler config: invalid secrets.required entry: ${JSON.stringify(entry)}`);
		}
	}
	return required.slice();
}

/**
 * Parse the V3 deprecated secrets list response
 * (`GET /api/v3/secrets/raw?viewSecretValue=true`).
 *
 * Returns `[{ secretKey, secretValue }]`. Items without a usable
 * `secretKey` or `secretValue` are filtered out (the V3 list endpoint
 * may return placeholder rows with `secretValue: null` for hidden
 * values; those are not writeable to `.dev.vars`).
 */
export function parseSecretsResponse(jsonString) {
	let parsed;
	try {
		parsed = JSON.parse(jsonString);
	} catch (cause) {
		throw new Error(`V3 secrets response is not valid JSON: ${cause.message}`);
	}
	const items = Array.isArray(parsed?.secrets) ? parsed.secrets : [];
	const out = [];
	for (const item of items) {
		const key = item?.secretKey ?? item?.key;
		const value = item?.secretValue ?? item?.value;
		if (typeof key !== 'string' || key.length === 0) continue;
		if (typeof value !== 'string' || value.length === 0) continue;
		out.push({ secretKey: key, secretValue: value });
	}
	return out;
}

/**
 * Whether a given environment name refers to the prod environment.
 *
 * This is the canonical operator-mandated "prod hard-reject" gate.
 * Production secret management is owned by the Cloudflare Workers
 * Builds deploy path (Phase 4 #70) and `wrangler secret put` — never
 * by this script. Any value the operator might accidentally pass
 * meaning "prod" must short-circuit the script before any HTTP
 * request or `.dev.vars` write.
 *
 * Matches:
 *   - `prod` (Infisical native slug)
 *   - `production` (common typo / alternative name)
 *   - case-insensitive variants (`PROD`, `Production`, etc.)
 *   - whitespace-padded values
 *
 * Does NOT match:
 *   - `dev`, `development`, `staging`, etc.
 *   - empty string
 *   - non-string values
 *
 * Pure: deterministic, no I/O. Exported for unit-testing the gate.
 */
export function isProdEnvironment(env) {
	if (typeof env !== 'string') return false;
	const normalized = env.trim().toLowerCase();
	return normalized === 'prod' || normalized === 'production';
}

/**
 * Format a `{ secretKey -> secretValue }` map as a `.dev.vars`-shaped
 * string. Quote values with double quotes; escape any embedded `"` and
 * `\` to keep the file parseable by `dotenv` parsers.
 *
 * Lines are sorted alphabetically by key for stable diffs.
 */
export function formatDevVarsContent(secretMap) {
	const lines = [];
	const keys = Object.keys(secretMap).sort();
	for (const key of keys) {
		const escaped = String(secretMap[key]).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
		lines.push(`${key}="${escaped}"`);
	}
	return `${lines.join('\n')}\n`;
}

function readInfisicalWorkspaceId() {
	const path = resolve(REPO_ROOT, '.infisical.json');
	if (!existsSync(path)) {
		throw new Error(
			`.infisical.json not found at ${path}. Run \`pnpm run infisical:bootstrap\` first.`,
		);
	}
	const parsed = JSON.parse(readFileSync(path, 'utf8'));
	if (typeof parsed?.workspaceId !== 'string' || parsed.workspaceId.length === 0) {
		throw new Error('.infisical.json#workspaceId must be a non-empty string');
	}
	return parsed.workspaceId;
}

function readWranglerSecretsRequired(configPath) {
	const fullPath = resolve(REPO_ROOT, configPath);
	if (!existsSync(fullPath)) {
		throw new Error(`Wrangler config not found: ${fullPath}`);
	}
	return parseSecretsRequired(readFileSync(fullPath, 'utf8'));
}

function httpsJson({ method, url, headers, body }) {
	return new Promise((resolvePromise, rejectPromise) => {
		const bodyStr = body ? JSON.stringify(body) : null;
		const finalHeaders = {
			Accept: 'application/json',
			...headers,
		};
		if (bodyStr) {
			finalHeaders['Content-Type'] = 'application/json';
			finalHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
		}
		const req = httpsRequest(
			{
				method,
				hostname: url.hostname,
				port: url.port || 443,
				path: `${url.pathname}${url.search}`,
				headers: finalHeaders,
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
						const trimmed = text.length > 200 ? `${text.slice(0, 200)}…` : text;
						rejectPromise(
							new Error(
								`HTTP ${res.statusCode} ${method} ${url.pathname}${url.search}: ${trimmed}`,
							),
						);
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
		if (bodyStr) req.write(bodyStr);
		req.end();
	});
}

async function listInfisicalSecrets({ apiUrl, accessToken, workspaceId, environment }) {
	const url = new URL(apiUrl);
	const params = new URLSearchParams({
		workspaceId,
		environment,
		viewSecretValue: 'true',
	});
	return httpsJson({
		method: 'GET',
		url: new URL(`${url.pathname}/api/v3/secrets/raw?${params.toString()}`, url),
		headers: { Authorization: `Bearer ${accessToken}` },
	});
}

function parseArgs(argv) {
	const out = { env: null, config: 'wrangler.jsonc', dryRun: false, help: false };
	for (const arg of argv) {
		if (arg === '--help' || arg === '-h') {
			out.help = true;
		} else if (arg === '--dry-run') {
			out.dryRun = true;
		} else if (arg.startsWith('--env=')) {
			out.env = arg.slice('--env='.length);
		} else if (arg.startsWith('--config=')) {
			out.config = arg.slice('--config='.length);
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	return out;
}

function printHelp() {
	console.log(`Usage: generate-dev-vars.mjs [--env=<dev|prod>] [--config=<path>] [--dry-run] [--help]

Options:
  --env=<name>      Infisical environment to read from. Default: .infisical.json#defaultEnvironment
  --config=<path>   Wrangler config to read secrets.required from. Default: wrangler.jsonc
  --dry-run         Print plan without writing .dev.vars
  --help, -h        Show this help

The script reads .infisical.json#workspaceId (committed SoT) and the
secrets.required array from the chosen Wrangler config, fetches the
matching secret values from Infisical dev env via V3 /api/v3/secrets/raw,
and writes them to .dev.vars.

Required env: INFISICAL_TOKEN (operator-supplied).
`);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	const apiUrl = process.env.INFISICAL_API_URL || INFISICAL_API_URL_DEFAULT;
	const accessToken = process.env.INFISICAL_TOKEN;
	if (typeof accessToken !== 'string' || accessToken.length === 0) {
		throw new Error('INFISICAL_TOKEN env var is required');
	}

	const workspaceId = readInfisicalWorkspaceId();
	const required = readWranglerSecretsRequired(args.config);
	if (required.length === 0) {
		throw new Error(`${args.config}: secrets.required is empty; nothing to fetch`);
	}

	let env = args.env;
	if (env === null) {
		const cfgPath = resolve(REPO_ROOT, '.infisical.json');
		const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
		env = cfg?.defaultEnvironment ?? 'dev';
	}

	// Operator-mandated prod hard-reject. ANY value the operator might
	// pass meaning "prod" short-circuits before any HTTP request or
	// file write. Production secret management is owned by the
	// Cloudflare Workers Builds deploy path (Phase 4 #70) and
	// `wrangler secret put`, never by this script.
	if (isProdEnvironment(env)) {
		throw new Error(
			`generate-dev-vars refuses environment=${JSON.stringify(env)}: prod secrets are never written to a local .dev.vars file. Use "pnpm run infisical:deploy" (Phase 4 #70) or "wrangler secret put" for production.`,
		);
	}

	console.log(`Infisical project:  ${workspaceId}`);
	console.log(`Wrangler config:    ${args.config}`);
	console.log(`Environment:        ${env}`);
	console.log(`Required secrets:   ${JSON.stringify(required)}`);
	console.log(`Output file:        ${DEV_VARS_FILENAME}`);
	console.log(`Mode:               ${args.dryRun ? 'dry-run' : 'write'}`);

	if (args.dryRun) return;

	const response = await listInfisicalSecrets({
		apiUrl,
		accessToken,
		workspaceId,
		environment: env,
	});
	const all = parseSecretsResponse(JSON.stringify(response));
	const requiredSet = new Set(required);
	const filtered = all.filter((s) => requiredSet.has(s.secretKey));

	const missing = required.filter((k) => !filtered.some((s) => s.secretKey === k));
	if (missing.length > 0) {
		throw new Error(
			`Infisical env=${env} is missing required keys: ${JSON.stringify(missing)}. ` +
				`Run \`pnpm run infisical:seed -- --env=${env}\` first or fix the config drift.`,
		);
	}

	const map = Object.fromEntries(filtered.map((s) => [s.secretKey, s.secretValue]));
	const content = formatDevVarsContent(map);

	const targetPath = resolve(REPO_ROOT, DEV_VARS_FILENAME);
	const tmpPath = `${targetPath}${DEV_VARS_TMP_SUFFIX}`;
	try {
		writeFileSync(tmpPath, content, { mode: 0o600 });
		renameSync(tmpPath, targetPath);
	} catch (cause) {
		try {
			if (existsSync(tmpPath)) writeFileSync(tmpPath, '');
		} catch {
			// best-effort cleanup; ignore
		}
		throw new Error(`Failed to write ${DEV_VARS_FILENAME}: ${cause.message}`);
	}

	// Counts only — never echo values
	console.log(`Wrote ${filtered.length} secrets to ${DEV_VARS_FILENAME}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(`generate-dev-vars failed: ${err.message}`);
		process.exit(1);
	});
}
