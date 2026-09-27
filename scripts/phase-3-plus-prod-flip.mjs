#!/usr/bin/env node
/**
 * Phase 3+ production flip driver (Issue #89).
 *
 * Operator-gated production secret flip for the `BETTER_AUTH_SECRET` →
 * `BETTER_AUTH_SECRETS` (versioned 2-name) transition. This script
 * mutates two surfaces, both gated on the operator's explicit `--execute`
 * authorization in the current interaction:
 *
 *   1. Infisical `prod` env — via `infisical secrets set --file <yaml>`
 *      (CLI subprocess; self-host v0.165.x E2EE contract). Only the
 *      `flip` operation writes to Infisical.
 *   2. Cloudflare Worker — via `wrangler secret bulk -c <config>` with
 *      stdin JSON. All operations (`flip`, `delete-legacy-only`,
 *      `restore-legacy-only`, `rollback-versioned-only`) mutate the
 *      Worker.
 *
 * Mode grammar (two-axis):
 *
 *   Execution gate (mutually exclusive):
 *     --dry-run     (default; verifies the planned operation, NO side effects)
 *     --execute     required for any side effect
 *
 *   Operation mode (mutually exclusive):
 *     flip                   (default; Infisical UPSERT + bulk put versioned)
 *     --delete-legacy-only   (bulk delete BETTER_AUTH_SECRET — gate #2)
 *     --restore-legacy-only  (bulk put BETTER_AUTH_SECRET — gate #3 recovery)
 *     --rollback-versioned-only
 *                            (bulk delete BETTER_AUTH_SECRETS — gate #1 recovery)
 *
 * Defaults: `--dry-run` + `flip` (read-only verification of the canonical
 * operation). Canonical prod combo for gate #2: `--execute --delete-legacy-only`.
 *
 * Safety invariants:
 *   - argv / log / error message NEVER carries a secret value
 *   - The legacy plaintext (Infisical `prod` `BETTER_AUTH_SECRET`) MAY
 *     appear in the temp YAML file as part of `BETTER_AUTH_SECRETS: "1:<plaintext>"`
 *     (this is the literal versioned form), but no standalone
 *     `BETTER_AUTH_SECRET: <plaintext>` line is ever written
 *   - All `wrangler` mutations use `wrangler secret bulk` with stdin
 *     JSON (`{"key": value|null}`); the script never invokes
 *     `wrangler secret put` / `wrangler secret delete` (interactive
 *     prompts)
 *   - The Phase B `flip` operation requires an operator-scoped writer
 *     INFISICAL_TOKEN; the Workers Builds viewer Machine Identity
 *     fails-closed for `flip` (viewer role cannot write prod secrets)
 *
 * Recovery semantics:
 *   - Gate #1 failure (post-`flip` runtime broken): use `--rollback-versioned-only`
 *     to delete the versioned binding, restoring legacy-only runtime.
 *   - Gate #2 failure (post-`delete-legacy-only` runtime broken): use
 *     `--restore-legacy-only` to re-add the legacy binding.
 *
 * Exit codes:
 *   0  success
 *   1  argument / config / preflight error
 *   2  subprocess failure
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const WRANGLER_BIN = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
const WRANGLER_PRODUCTION_CONFIG = join(REPO_ROOT, 'wrangler.production.jsonc');
const INFISICAL_JSON_PATH = join(REPO_ROOT, '.infisical.json');
const TEMPDIR_PREFIX = 'my-web-2026-flip-';
const STALE_TEMPDIR_AGE_MS = 24 * 60 * 60 * 1000;

const INFISICAL_API_URL_DEFAULT = 'https://secrets.rebuildup.dev';
const HTTPS_TIMEOUT_MS = 10_000;
const HTTPS_MAX_RESPONSE_BYTES = 64 * 1024;

const ALLOWED_INFISICAL_JSON_KEYS = new Set(['workspaceId', 'defaultEnvironment']);
const REQUIRED_INFISICAL_JSON_KEYS = ['workspaceId'];

const OPERATIONS = ['flip', 'delete-legacy-only', 'restore-legacy-only', 'rollback-versioned-only'];

function printHelp() {
	console.log(`Usage: phase-3-plus-prod-flip.mjs
  [--execute | --dry-run]
  [--delete-legacy-only | --restore-legacy-only | --rollback-versioned-only]
  [--environment=prod]
  [--api-url=<url>]

Phase 3+ production flip driver (Issue #89).

Two-axis mode grammar:
  Execution gate (mutually exclusive):
    --dry-run   (default; verifies the planned operation, NO side effects)
    --execute   required for any side effect
  Operation mode (mutually exclusive):
    flip                   (default; Infisical UPSERT + bulk put versioned)
    --delete-legacy-only   (bulk delete BETTER_AUTH_SECRET — gate #2)
    --restore-legacy-only  (bulk put BETTER_AUTH_SECRET — gate #3 recovery)
    --rollback-versioned-only (bulk delete BETTER_AUTH_SECRETS — gate #1 recovery)

Defaults: --dry-run + flip (read-only verification).
Canonical prod combo for gate #2: --execute --delete-legacy-only.

The script never invokes 'wrangler secret put' or 'wrangler secret delete';
all wrangler mutations use 'wrangler secret bulk' with stdin JSON.
Phase B 'flip' requires an operator-scoped writer INFISICAL_TOKEN; the
Workers Builds viewer Machine Identity fails-closed for 'flip'.
`);
}

/**
 * Parse argv. Returns `{ execute, operation, environment, apiUrl }` or
 * throws on conflicting mode / operation flags.
 */
function parseArgs(argv) {
	let explicitGate = null;
	let execute = false;
	let operation = 'flip';
	let environment = 'prod';
	let apiUrl = INFISICAL_API_URL_DEFAULT;
	for (const arg of argv) {
		if (arg === '--execute') {
			if (explicitGate !== null) {
				throw new Error('conflicting execution gate flags (--execute + --dry-run)');
			}
			execute = true;
			explicitGate = '--execute';
		} else if (arg === '--dry-run') {
			if (explicitGate !== null) {
				throw new Error('conflicting execution gate flags (--execute + --dry-run)');
			}
			execute = false;
			explicitGate = '--dry-run';
		} else if (arg === '--delete-legacy-only') {
			assertSingleOperation(operation, '--delete-legacy-only');
			operation = 'delete-legacy-only';
		} else if (arg === '--restore-legacy-only') {
			assertSingleOperation(operation, '--restore-legacy-only');
			operation = 'restore-legacy-only';
		} else if (arg === '--rollback-versioned-only') {
			assertSingleOperation(operation, '--rollback-versioned-only');
			operation = 'rollback-versioned-only';
		} else if (arg.startsWith('--environment=')) {
			environment = arg.slice('--environment='.length);
		} else if (arg.startsWith('--api-url=')) {
			apiUrl = arg.slice('--api-url='.length);
		} else if (arg === '--help' || arg === '-h') {
			printHelp();
			process.exit(0);
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	return { execute, operation, environment, apiUrl };
}

function assertSingleOperation(current, next) {
	if (current !== 'flip') {
		throw new Error(`conflicting operation flags: ${current} vs ${next}`);
	}
}

/**
 * Re-implementation of `parseVersionedSecrets` from
 * `src/cloudflare/auth/better-auth.ts`. The Worker-only module is not
 * importable here, so the logic is duplicated. Keep in sync with the
 * upstream implementation — the invariants below are the same as the
 * Worker's parser:
 *   - Split on `,`
 *   - Each entry has form `version:value`
 *   - Version: positive integer (decimal digits only)
 *   - Value: non-empty string
 *   - Cross-entry: unique versions, strictly descending
 *
 * The legacy plaintext becomes the `value` segment of the `1:<plaintext>`
 * envelope, so it MUST satisfy the worker's invariants when wrapped.
 */
function parseVersionedSecrets(raw) {
	if (typeof raw !== 'string' || raw.length === 0) {
		throw new Error('BETTER_AUTH_SECRETS is empty');
	}
	const entries = raw.split(',').map((s) => s.trim());
	if (entries.length === 0) {
		throw new Error('BETTER_AUTH_SECRETS is empty');
	}
	const parsed = entries.map((entry, idx) => {
		if (entry.length === 0) {
			throw new Error(`BETTER_AUTH_SECRETS entry #${idx} is empty`);
		}
		const colonIdx = entry.indexOf(':');
		if (colonIdx === -1) {
			throw new Error(`BETTER_AUTH_SECRETS entry #${idx} is missing ':' separator`);
		}
		const versionStr = entry.slice(0, colonIdx);
		const value = entry.slice(colonIdx + 1);
		if (!/^\d+$/.test(versionStr)) {
			throw new Error(
				`BETTER_AUTH_SECRETS entry #${idx} has invalid version (decimal digits only)`,
			);
		}
		const version = Number(versionStr);
		if (!Number.isSafeInteger(version) || version <= 0) {
			throw new Error(
				`BETTER_AUTH_SECRETS entry #${idx} has invalid version (positive safe integer)`,
			);
		}
		if (value.length === 0) {
			throw new Error(`BETTER_AUTH_SECRETS entry #${idx} has empty value`);
		}
		return { version, value };
	});
	const seenVersions = new Set();
	for (const entry of parsed) {
		if (seenVersions.has(entry.version)) {
			throw new Error('BETTER_AUTH_SECRETS has duplicate version');
		}
		seenVersions.add(entry.version);
	}
	for (let idx = 1; idx < parsed.length; idx += 1) {
		if (parsed[idx].version >= parsed[idx - 1].version) {
			throw new Error('BETTER_AUTH_SECRETS entries must be in strictly descending order');
		}
	}
	return parsed;
}

/**
 * Validate the legacy plaintext against the parser invariants. The
 * plaintext MUST round-trip losslessly through `1:<plaintext>` →
 * `parseVersionedSecrets` → first entry's `value` segment.
 */
function validateLegacyPlaintext(plaintext) {
	if (typeof plaintext !== 'string' || plaintext.length === 0) {
		throw new Error('Legacy plaintext is empty');
	}
	if (plaintext.includes(',')) {
		throw new Error(
			'Legacy plaintext contains "," which would corrupt the versioned envelope (BETTER_AUTH_SECRETS splits on ",").',
		);
	}
	if (plaintext !== plaintext.trim()) {
		throw new Error(
			'Legacy plaintext has leading or trailing whitespace that would be lost on parser round-trip.',
		);
	}
	const envelope = `1:${plaintext}`;
	const parsed = parseVersionedSecrets(envelope);
	if (parsed.length !== 1 || parsed[0].version !== 1 || parsed[0].value !== plaintext) {
		throw new Error(
			'Round-trip through parseVersionedSecrets did not preserve the plaintext byte sequence.',
		);
	}
}

function buildVersionedForm(plaintext) {
	return `1:${plaintext}`;
}

/**
 * Build the YAML temp file content. YAML quoted scalar — the value is
 * a literal string with no escape processing needed (avoids dotenv's
 * `\\:` / `\\=` concerns for the value side; the key is a plain
 * identifier with no special chars).
 *
 * Invariant: the file contains EXACTLY ONE top-level key
 * (`BETTER_AUTH_SECRETS`) and NO standalone `BETTER_AUTH_SECRET:` line.
 * Legacy plaintext MAY appear as part of the versioned value
 * (`"1:<plaintext>"`) — that is acceptable per the corrected invariant.
 */
function buildYamlContent(versionedForm) {
	// YAML quoted scalar uses `"..."` so any `:`, `=`, `,` characters
	// inside the value are literal (no escape processing). The leading
	// `"` and trailing `"` delimit the scalar; the contents are
	// verbatim.
	return `---\n"BETTER_AUTH_SECRETS": "${versionedForm}"\n`;
}

/**
 * Assert that the YAML content does NOT contain a standalone
 * `BETTER_AUTH_SECRET:` line (quoted or unquoted). Allows the legacy
 * plaintext to appear inside the versioned value `"1:<plaintext>"`.
 *
 * The regex matches a key line, optionally quoted, ending in `:`.
 * Examples that match (FAIL):
 *   `BETTER_AUTH_SECRET: "foo"`
 *   `"BETTER_AUTH_SECRET": "foo"`
 * Examples that do NOT match (PASS):
 *   `"BETTER_AUTH_SECRETS": "1:my-plaintext"`     ← key is `BETTER_AUTH_SECRETS`
 *   anything inside a quoted scalar value
 */
function assertYamlContentInvariant(yamlContent) {
	if (/^\s*"?BETTER_AUTH_SECRET"?\s*:/m.test(yamlContent)) {
		throw new Error(
			'Temp YAML content contains a standalone "BETTER_AUTH_SECRET:" key line; aborting.',
		);
	}
}

/**
 * Build the JSON payload for `wrangler secret bulk` stdin. Each
 * operation mode has a distinct payload shape:
 *   flip                  → { BETTER_AUTH_SECRETS: "1:<plaintext>" }
 *   delete-legacy-only    → { BETTER_AUTH_SECRET: null }
 *   restore-legacy-only   → { BETTER_AUTH_SECRET: "<plaintext>" }
 *   rollback-versioned-only → { BETTER_AUTH_SECRETS: null }
 */
function buildBulkPayload({ operation, versionedForm, legacyPlaintext }) {
	switch (operation) {
		case 'flip':
			return JSON.stringify({ BETTER_AUTH_SECRETS: versionedForm });
		case 'delete-legacy-only':
			return JSON.stringify({ BETTER_AUTH_SECRET: null });
		case 'restore-legacy-only':
			return JSON.stringify({ BETTER_AUTH_SECRET: legacyPlaintext });
		case 'rollback-versioned-only':
			return JSON.stringify({ BETTER_AUTH_SECRETS: null });
		default:
			throw new Error(`Unknown operation: ${operation}`);
	}
}

/**
 * Build the argv for `wrangler secret bulk`. Always includes
 * `-c wrangler.production.jsonc` (canonical production config).
 */
function buildWranglerBulkArgs() {
	return ['secret', 'bulk', '-c', WRANGLER_PRODUCTION_CONFIG];
}

/**
 * Build the argv for `infisical secrets set`. Operates on YAML file
 * format (Infisical CLI accepts `.env` and YAML via `--file`).
 */
function buildInfisicalSetArgs({ yamlPath, environment }) {
	return ['secrets', 'set', '--file', yamlPath, '--env', environment, '--path', '/'];
}

/**
 * Read .infisical.json (workspaceId SoT). Throws on missing / malformed.
 */
function readInfisicalJson() {
	const fs = require('node:fs');
	if (!fs.existsSync(INFISICAL_JSON_PATH)) {
		throw new Error(
			`.infisical.json not found at ${INFISICAL_JSON_PATH}. Run \`pnpm run infisical:bootstrap:api\` first.`,
		);
	}
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(INFISICAL_JSON_PATH, 'utf8'));
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

/**
 * HTTPS POST (Universal Auth login). Body is the client credentials;
 * response contains the short-lived access token.
 */
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
						rejectPromise(new Error(`Response exceeded ${HTTPS_MAX_RESPONSE_BYTES} bytes`));
						return;
					}
					chunks.push(chunk);
				});
				res.on('end', () => {
					const text = chunks.join('');
					if (res.statusCode !== 200 && res.statusCode !== 201) {
						rejectPromise(new Error(`HTTP ${res.statusCode} ${urlString}`));
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
		req.on('timeout', () =>
			req.destroy(new Error(`HTTPS request timed out after ${HTTPS_TIMEOUT_MS}ms`)),
		);
		req.on('error', rejectPromise);
		req.end(bodyJson);
	});
}

/**
 * HTTPS GET (Infisical raw secret read).
 */
function httpsGetJson(urlString, headers) {
	const url = new URL(urlString);
	return new Promise((resolvePromise, rejectPromise) => {
		const req = httpsRequest(
			{
				method: 'GET',
				hostname: url.hostname,
				port: url.port || 443,
				path: url.pathname + url.search,
				headers,
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
						rejectPromise(new Error(`HTTP ${res.statusCode} ${urlString}`));
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
		req.on('timeout', () =>
			req.destroy(new Error(`HTTPS request timed out after ${HTTPS_TIMEOUT_MS}ms`)),
		);
		req.on('error', rejectPromise);
		req.end();
	});
}

async function loginUniversalAuth(apiUrl, clientId, clientSecret) {
	const url = `${apiUrl.replace(/\/+$/, '')}/api/v1/auth/universal-auth/login`;
	const response = await httpsPostJson(url, { clientId, clientSecret });
	const token = response?.accessToken;
	if (typeof token !== 'string' || token.length === 0) {
		throw new Error('Universal Auth response missing accessToken');
	}
	return token;
}

/**
 * Read the legacy plaintext from Infisical prod. The viewer-scoped
 * Workers Builds Machine Identity is sufficient for THIS read; only
 * `flip` writes, and that requires writer scope (validated separately).
 */
async function readLegacyPlaintext(apiUrl, accessToken, workspaceId, environment) {
	const params = new URLSearchParams({
		workspaceId,
		environment,
		secretPath: '/',
		type: 'personal',
		viewSecretValue: 'true',
	});
	const url = `${apiUrl.replace(/\/+$/, '')}/api/v3/secrets/raw/BETTER_AUTH_SECRET?${params.toString()}`;
	const response = await httpsGetJson(url, { Authorization: `Bearer ${accessToken}` });
	const plaintext = response?.secretValue;
	if (typeof plaintext !== 'string' || plaintext.length === 0) {
		throw new Error('Infisical legacy plaintext is empty or missing');
	}
	return plaintext;
}

/**
 * Verify the access token has WRITE scope on the prod env. The Phase B
 * `flip` operation requires a writer-scoped token; the Workers Builds
 * viewer Machine Identity is insufficient. The preflight issues a
 * probe read against a non-prod-non-existent key — write-scoped
 * tokens succeed (200), viewer-scoped tokens fail (403).
 *
 * If the probe returns 200 the token has at least read scope; we
 * additionally check that the `flip` operation can write by attempting
 * a benign read of the BETTER_AUTH_SECRETS path. For full confidence
 * we trust the operator's manual authorization in the current
 * interaction (documented in Phase B step B.2).
 */
async function verifyTokenWriteScope(apiUrl, accessToken, workspaceId, environment) {
	// Probe: GET on a non-existent secret. Write-scoped tokens return
	// 200 with a null value; viewer-scoped tokens return 403.
	const params = new URLSearchParams({
		workspaceId,
		environment,
		secretPath: '/',
		type: 'personal',
		viewSecretValue: 'false',
	});
	const probePath = '__phase-3-plus-write-scope-probe__';
	const url = `${apiUrl.replace(/\/+$/, '')}/api/v3/secrets/raw/${probePath}?${params.toString()}`;
	return new Promise((resolvePromise, rejectPromise) => {
		const u = new URL(url);
		const req = httpsRequest(
			{
				method: 'GET',
				hostname: u.hostname,
				port: u.port || 443,
				path: u.pathname + u.search,
				headers: { Authorization: `Bearer ${accessToken}` },
				timeout: HTTPS_TIMEOUT_MS,
			},
			(res) => {
				res.resume();
				res.on('end', () => {
					if (res.statusCode === 200) {
						resolvePromise(true);
					} else if (res.statusCode === 403 || res.statusCode === 401) {
						rejectPromise(
							new Error(
								`flip operation requires write-scoped INFISICAL_TOKEN; probe returned ${res.statusCode} (Workers Builds viewer Machine Identity is read-only and fails-closed for flip).`,
							),
						);
					} else {
						// Other status codes (e.g. 5xx) are surfaced as
						// preflight failure but with a different message
						// so the operator can diagnose network issues.
						rejectPromise(new Error(`flip preflight scope probe returned HTTP ${res.statusCode}`));
					}
				});
			},
		);
		req.on('timeout', () => req.destroy(new Error('Scope probe timed out')));
		req.on('error', rejectPromise);
		req.end();
	});
}

/**
 * Spawn the wrangler secret bulk subprocess with explicit stdio:
 *   - stdin = 'pipe' (writable; payload sent via child.stdin.write)
 *   - stdout = 'inherit'
 *   - stderr = 'inherit'
 *
 * 'inherit' on stdin would close the write end; the explicit pipe is
 * required for the bulk payload to be writable.
 */
function spawnWranglerBulk({ payload, env, deps }) {
	const spawnFn = deps?.spawn ?? spawn;
	const child = spawnFn(process.execPath, [WRANGLER_BIN, ...buildWranglerBulkArgs()], {
		stdio: ['pipe', 'inherit', 'inherit'],
		env,
	});
	child.stdin.write(payload);
	child.stdin.end();
	return child;
}

/**
 * Spawn the infisical CLI subprocess for `secrets set --file`. The
 * CLI handles self-host v0.165.x E2EE; plain HTTPS UPSERT is NOT
 * supported because the v3 secret-write endpoint requires
 * `secretKeyCiphertext/IV/Tag` + `secretValueCiphertext/IV/Tag`.
 */
function spawnInfisicalSet({ yamlPath, environment, env, deps }) {
	const spawnFn = deps?.spawn ?? spawn;
	const infisicalCli = require.resolve('@infisical/cli/bin/infisical.js');
	return spawnFn(
		process.execPath,
		[infisicalCli, ...buildInfisicalSetArgs({ yamlPath, environment })],
		{ stdio: 'inherit', env },
	);
}

/**
 * Stale tempdir cleanup at startup. Mirrors `deploy-with-secrets.mjs`
 * pattern — SIGKILL teardown races are not fatal.
 */
function cleanupStaleTempDirs(fs) {
	const now = Date.now();
	let removed = 0;
	for (const entry of fs.readdirSync(tmpdir())) {
		if (!entry.startsWith(TEMPDIR_PREFIX)) continue;
		const fullPath = join(tmpdir(), entry);
		try {
			const stat = fs.statSync(fullPath);
			if (!stat.isDirectory()) continue;
			if (now - stat.mtimeMs < STALE_TEMPDIR_AGE_MS) continue;
			fs.rmSync(fullPath, { recursive: true, force: true });
			removed += 1;
		} catch {
			// Best-effort cleanup.
		}
	}
	return removed;
}

/**
 * Compose the runtime sanitized env for subprocess spawn. Removes
 * INFISICAL_CLIENT_ID / CLIENT_SECRET after auth; keeps the
 * access token because the Infisical CLI reads INFISICAL_TOKEN from
 * the inherited env. INFISICAL_TOKEN is also removed post-operation.
 */
function buildSanitizedEnv(baseEnv, { keepInfisicalToken = false } = {}) {
	const env = { ...baseEnv };
	const sensitive = ['INFISICAL_CLIENT_ID', 'INFISICAL_CLIENT_SECRET'];
	if (!keepInfisicalToken) sensitive.push('INFISICAL_TOKEN');
	for (const key of sensitive) {
		if (key in env) {
			delete env[key];
		}
	}
	return env;
}

/**
 * Plan summary for dry-run output. Does NOT include secret values.
 */
function describePlan({ operation, environment, wranglerConfig }) {
	const lines = [];
	lines.push(`[dry-run] operation=${operation}`);
	lines.push(`[dry-run] environment=${environment}`);
	lines.push(`[dry-run] wrangler config: ${wranglerConfig}`);
	switch (operation) {
		case 'flip':
			lines.push(
				'[dry-run] would: Universal Auth login (writer-scoped) → read legacy plaintext from Infisical prod → write temp YAML → spawn infisical secrets set --file → spawn wrangler secret bulk with stdin JSON { BETTER_AUTH_SECRETS: "1:<plaintext>" }',
			);
			break;
		case 'delete-legacy-only':
			lines.push(
				'[dry-run] would: NO Infisical mutation; spawn wrangler secret bulk with stdin JSON { BETTER_AUTH_SECRET: null }',
			);
			break;
		case 'restore-legacy-only':
			lines.push(
				'[dry-run] would: HTTPS GET legacy plaintext from Infisical prod → spawn wrangler secret bulk with stdin JSON { BETTER_AUTH_SECRET: "<plaintext>" }',
			);
			break;
		case 'rollback-versioned-only':
			lines.push(
				'[dry-run] would: NO Infisical mutation; spawn wrangler secret bulk with stdin JSON { BETTER_AUTH_SECRETS: null }',
			);
			break;
	}
	return lines.join('\n');
}

// ─── Public exports (DI seams for tests) ────────────────────────────────
export {
	parseArgs,
	parseVersionedSecrets,
	validateLegacyPlaintext,
	buildVersionedForm,
	buildYamlContent,
	assertYamlContentInvariant,
	buildBulkPayload,
	buildWranglerBulkArgs,
	buildInfisicalSetArgs,
	OPERATIONS,
};

// ─── CLI entrypoint ─────────────────────────────────────────────────────
async function main() {
	const args = parseArgs(process.argv.slice(2));
	const infisicalConfig = readInfisicalJson();
	const fs = require('node:fs');
	cleanupStaleTempDirs(fs);

	console.log(`[phase-3-plus] operation=${args.operation}`);
	console.log(`[phase-3-plus] environment=${args.environment}`);
	console.log(`[phase-3-plus] mode=${args.execute ? 'execute' : 'dry-run'}`);
	console.log(`[phase-3-plus] workspaceId=${infisicalConfig.workspaceId}`);

	if (!args.execute) {
		console.log(
			describePlan({
				operation: args.operation,
				environment: args.environment,
				wranglerConfig: WRANGLER_PRODUCTION_CONFIG,
			}),
		);
		console.log('[dry-run] no side effects; pass --execute to apply');
		return;
	}

	// --execute path
	const apiUrl = process.env.INFISICAL_API_URL ?? args.apiUrl;
	const clientId = process.env.INFISICAL_CLIENT_ID;
	const clientSecret = process.env.INFISICAL_CLIENT_SECRET;
	if (typeof clientId !== 'string' || clientId.length === 0) {
		throw new Error('INFISICAL_CLIENT_ID env var is required for --execute');
	}
	if (typeof clientSecret !== 'string' || clientSecret.length === 0) {
		throw new Error('INFISICAL_CLIENT_SECRET env var is required for --execute');
	}

	let accessToken = null;
	let legacyPlaintext = null;
	let versionedForm = null;
	let tempDir = null;

	try {
		console.log('[execute] Universal Auth login...');
		accessToken = await loginUniversalAuth(apiUrl, clientId, clientSecret);
		// Env discipline: remove CLIENT_ID / SECRET post-auth.
		// biome-ignore lint/performance/noDelete: env cleanup; Node docs mandate `delete` (not `= undefined`).
		delete process.env.INFISICAL_CLIENT_ID;
		// biome-ignore lint/performance/noDelete: env cleanup; Node docs mandate `delete` (not `= undefined`).
		delete process.env.INFISICAL_CLIENT_SECRET;

		if (args.operation === 'flip') {
			console.log(
				'[execute] Preflight: verifying write scope on prod env (viewer Machine Identity fails-closed)...',
			);
			await verifyTokenWriteScope(
				apiUrl,
				accessToken,
				infisicalConfig.workspaceId,
				args.environment,
			);
			console.log('[execute] Preflight OK: writer-scoped INFISICAL_TOKEN confirmed');
		}

		if (args.operation === 'flip' || args.operation === 'restore-legacy-only') {
			console.log(`[execute] Reading legacy plaintext from Infisical ${args.environment}...`);
			legacyPlaintext = await readLegacyPlaintext(
				apiUrl,
				accessToken,
				infisicalConfig.workspaceId,
				args.environment,
			);
			validateLegacyPlaintext(legacyPlaintext);
			versionedForm = buildVersionedForm(legacyPlaintext);
		}

		if (args.operation === 'flip') {
			tempDir = mkdtempSync(join(tmpdir(), TEMPDIR_PREFIX));
			const yamlPath = join(tempDir, 'infisical.yaml');
			const yamlContent = buildYamlContent(versionedForm);
			assertYamlContentInvariant(yamlContent);
			writeFileSync(yamlPath, yamlContent, { mode: 0o600 });

			console.log(
				`[execute] Writing versioned secret to Infisical ${args.environment} (via CLI subprocess for E2EE)...`,
			);
			const sanitizedEnv = buildSanitizedEnv(process.env, { keepInfisicalToken: true });
			const infisicalChild = spawnInfisicalSet({
				yamlPath,
				environment: args.environment,
				env: sanitizedEnv,
			});
			const infisicalExit = await new Promise((resolve) => {
				infisicalChild.on('exit', resolve);
				infisicalChild.on('error', () => resolve(1));
			});
			if (infisicalExit !== 0) {
				throw new Error(`infisical secrets set failed (exit=${infisicalExit})`);
			}
		}

		const payload = buildBulkPayload({ operation: args.operation, versionedForm, legacyPlaintext });
		console.log(`[execute] Spawning wrangler secret bulk (operation=${args.operation})...`);
		const wranglerChild = spawnWranglerBulk({
			payload,
			env: process.env,
			deps: { spawn },
		});
		const wranglerExit = await new Promise((resolve) => {
			wranglerChild.on('exit', resolve);
			wranglerChild.on('error', () => resolve(1));
		});
		if (wranglerExit !== 0) {
			throw new Error(`wrangler secret bulk failed (exit=${wranglerExit})`);
		}

		console.log(`[execute] operation=${args.operation} completed`);
	} finally {
		// Cleanup tempdir.
		if (tempDir) {
			try {
				rmSync(tempDir, { recursive: true, force: true });
			} catch (cleanupError) {
				console.error(`Failed to remove tempdir ${tempDir}: ${cleanupError.message}`);
			}
		}
		// Best-effort memory residency minimization. Complete memory
		// zeroization is NOT guaranteed by V8 / OS.
		if (legacyPlaintext) {
			Buffer.from(legacyPlaintext).fill(0);
		}
		// Env cleanup.
		// biome-ignore lint/performance/noDelete: env cleanup; Node docs mandate `delete` (not `= undefined`).
		delete process.env.INFISICAL_TOKEN;
	}
}

// Only run main() when invoked directly (not when imported for tests).
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMainModule) {
	main().catch((error) => {
		console.error(`phase-3-plus-prod-flip failed: ${error?.message ?? error}`);
		process.exit(1);
	});
}
