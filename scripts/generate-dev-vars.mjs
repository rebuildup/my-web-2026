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

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REQUIRED_RUNTIME_SECRETS } from './_cloudflare-contract.mjs';

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

/**
 * Atomically write `content` to `targetPath` (a `.dev.vars` file) via a
 * sibling temp file + rename.
 *
 * Operator-mandated invariants (Phase 3 review — CodeRabbit run
 * `dd52defe-bbaf-4be6-9455-ca29c99eccb7`, reviews 3 + 4):
 *
 *   1. **Exclusive create (`flag: 'wx'`)**. The temp file is created
 *      with `O_EXCL`. A pre-existing `.dev.vars.tmp` (left behind by
 *      a previous run, or pre-placed by another process) makes the
 *      write fail with EEXIST — the script does NOT truncate or
 *      follow a symlink at that path. The pre-existing file is left
 *      untouched.
 *   2. **Mode `0o600`** on the temp file. Operator-visible secret
 *      values never land on disk with world/group-readable mode.
 *   3. **Ownership-flagged cleanup**. The cleanup branch unlinks the
 *      temp file only when **this process** successfully created it
 *      (`tmpCreated === true`). On EEXIST the temp path belongs to
 *      another process — we MUST NOT race-delete it. On rename
 *      failure AFTER successful exclusive create, we clean up only
 *      our own temp file.
 *   4. **Best-effort cleanup preserves the original failure**. If
 *      `unlinkSync` itself throws (e.g., the temp path was already
 *      removed by some other actor), we swallow that error and
 *      re-throw the original `cause`. The caller sees the real
 *      failure, not a cleanup-induced one.
 *
 * Pure: takes `writeFile`, `rename`, `unlink` as injected parameters
 * so the function is unit-testable in isolation. Exported for the
 * security-invariant test suite.
 *
 * Rethrows the original `cause` (not a wrapped Error) so callers
 * can `err.code === 'EEXIST'` etc.
 */
export function writeDevVarsAtomic({
	targetPath,
	content,
	writeFile = writeFileSync,
	rename = renameSync,
	unlink = unlinkSync,
}) {
	const tmpPath = `${targetPath}${DEV_VARS_TMP_SUFFIX}`;
	let tmpCreated = false;
	try {
		writeFile(tmpPath, content, { flag: 'wx', mode: 0o600 });
		tmpCreated = true;
		rename(tmpPath, targetPath);
	} catch (cause) {
		if (tmpCreated) {
			try {
				unlink(tmpPath);
			} catch {
				// best-effort cleanup; preserve original failure
			}
		}
		throw cause;
	}
}

function readInfisicalWorkspaceId(repoRoot = REPO_ROOT) {
	const path = resolve(repoRoot, '.infisical.json');
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
	const out = { env: null, dryRun: false, help: false };
	for (const arg of argv) {
		if (arg === '--help' || arg === '-h') {
			out.help = true;
		} else if (arg === '--dry-run') {
			out.dryRun = true;
		} else if (arg.startsWith('--env=')) {
			out.env = arg.slice('--env='.length);
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	return out;
}

function printHelp() {
	console.log(`Usage: generate-dev-vars.mjs [--env=<dev|prod>] [--dry-run] [--help]

Options:
  --env=<name>      Infisical environment to read from. Default: .infisical.json#defaultEnvironment
  --dry-run         Print plan without writing .dev.vars
  --help, -h        Show this help

The script reads .infisical.json#workspaceId (committed SoT) and the
shared runtime contract (scripts/_cloudflare-contract.mjs), fetches the
matching secret values from Infisical dev env via V3 /api/v3/secrets/raw,
and writes them to .dev.vars.

Required env: INFISICAL_TOKEN (operator-supplied).
`);
}

/**
 * `runMain` — the operational entry point. Extracted from `main()`
 * so the prod-reject path can be unit-tested in isolation without
 * spawning a subprocess or touching the real repo `.infisical.json`
 * / `.dev.vars`.
 *
 * Parameters are injected so the test suite can run the prod-reject
 * regression against a scratch `repoRoot` (via `mkdtemp`):
 *
 *   - `repoRoot`: replaces `REPO_ROOT` for `.infisical.json`
 *     resolution, `wrangler.jsonc` resolution, and `.dev.vars`
 *     write. The natural entry point still uses the real
 *     `REPO_ROOT`.
 *   - `argv`: replaces `process.argv.slice(2)`. Tests pass
 *     `['--env=prod', '--dry-run']` directly without going
 *     through `process.argv`.
 *   - `env`: replaces `process.env` for the Infisical token
 *     + API URL lookup. Defaults to `process.env` for the
 *     natural entry point.
 *
 * Exported for the test factory closure.
 */
export async function runMain({
	repoRoot = REPO_ROOT,
	argv = process.argv.slice(2),
	env = process.env,
} = {}) {
	const args = parseArgs(argv);
	if (args.help) {
		printHelp();
		return;
	}

	const apiUrl = env.INFISICAL_API_URL || INFISICAL_API_URL_DEFAULT;
	const accessToken = env.INFISICAL_TOKEN;
	if (typeof accessToken !== 'string' || accessToken.length === 0) {
		throw new Error('INFISICAL_TOKEN env var is required');
	}

	const workspaceId = readInfisicalWorkspaceId(repoRoot);
	// Issue #247: the required-secret set is the shared contract, not a
	// scrape of whichever config file was named. `--config` authorised
	// nothing and named a file this migration deletes.
	const required = [...REQUIRED_RUNTIME_SECRETS];
	if (required.length === 0) {
		throw new Error('the shared runtime contract is empty; nothing to fetch');
	}

	let resolvedEnv = args.env;
	if (resolvedEnv === null) {
		const cfgPath = resolve(repoRoot, '.infisical.json');
		const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
		resolvedEnv = cfg?.defaultEnvironment ?? 'dev';
	}

	// Operator-mandated prod hard-reject. ANY value the operator might
	// pass meaning "prod" short-circuits before any HTTP request or
	// file write. Production secret management is owned by the
	// Cloudflare Workers Builds deploy path (Phase 4 #70) and
	// `wrangler secret put`, never by this script.
	if (isProdEnvironment(resolvedEnv)) {
		throw new Error(
			`generate-dev-vars refuses environment=${JSON.stringify(resolvedEnv)}: prod secrets are never written to a local .dev.vars file. Use "pnpm run infisical:deploy" (Phase 4 #70) for production; production Worker secrets are written by the Infisical-backed deploy path, never into a local .dev.vars.`,
		);
	}

	console.log(`Infisical project:  ${workspaceId}`);
	console.log(`Wrangler config:    ${args.config}`);
	console.log(`Environment:        ${resolvedEnv}`);
	console.log(`Required secrets:   ${JSON.stringify(required)}`);
	console.log(`Output file:        ${DEV_VARS_FILENAME}`);
	console.log(`Mode:               ${args.dryRun ? 'dry-run' : 'write'}`);

	if (args.dryRun) return;

	const response = await listInfisicalSecrets({
		apiUrl,
		accessToken,
		workspaceId,
		environment: resolvedEnv,
	});
	const all = parseSecretsResponse(JSON.stringify(response));
	const requiredSet = new Set(required);
	const filtered = all.filter((s) => requiredSet.has(s.secretKey));

	const missing = required.filter((k) => !filtered.some((s) => s.secretKey === k));
	if (missing.length > 0) {
		throw new Error(
			`Infisical env=${resolvedEnv} is missing required keys: ${JSON.stringify(missing)}. ` +
				`Run \`pnpm run infisical:seed -- --env=${resolvedEnv}\` first or fix the config drift.`,
		);
	}

	const map = Object.fromEntries(filtered.map((s) => [s.secretKey, s.secretValue]));
	const content = formatDevVarsContent(map);

	const targetPath = resolve(repoRoot, DEV_VARS_FILENAME);
	// Atomic write (exclusive create + ownership-flagged cleanup).
	// `writeDevVarsAtomic` rethrows the original fs error on failure;
	// we wrap it here so the operator-facing message identifies which
	// file failed. The helper itself enforces all the security
	// invariants (no truncate, no symlink follow, ownership-flagged
	// cleanup, original-error preservation).
	try {
		writeDevVarsAtomic({ targetPath, content });
	} catch (cause) {
		throw new Error(`Failed to write ${DEV_VARS_FILENAME}: ${cause.message}`);
	}

	// Counts only — never echo values
	console.log(`Wrote ${filtered.length} secrets to ${DEV_VARS_FILENAME}`);
}

function main() {
	return runMain();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(`generate-dev-vars failed: ${err.message}`);
		process.exit(1);
	});
}
