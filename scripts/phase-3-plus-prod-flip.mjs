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
import { ACCOUNT_ID, WORKER_NAME } from './_cloudflare-identity.mjs';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
import {
	AUTH_MODE,
	buildCfEnv as buildCfEnvShared,
	buildInfisicalEnv as buildInfisicalEnvShared,
	materialiseSecret,
	resolveInfisicalAuth,
} from './_infisical-auth.mjs';

const REPO_ROOT = resolve(HERE, '..');
const INFISICAL_JSON_PATH = join(REPO_ROOT, '.infisical.json');
const TEMPDIR_PREFIX = 'my-web-2026-flip-';
const STALE_TEMPDIR_AGE_MS = 24 * 60 * 60 * 1000;

const INFISICAL_API_URL_DEFAULT = 'https://secrets.rebuildup.dev';
const HTTPS_TIMEOUT_MS = 10_000;
const HTTPS_MAX_RESPONSE_BYTES = 64 * 1024;

const ALLOWED_INFISICAL_JSON_KEYS = new Set(['workspaceId', 'defaultEnvironment']);
const REQUIRED_INFISICAL_JSON_KEYS = ['workspaceId'];

const OPERATIONS = ['flip', 'delete-legacy-only', 'restore-legacy-only', 'rollback-versioned-only'];

/**
 * Per-operation auth strategy (Issue #99 — operator-authorization model).
 *
 * The viewer Machine Identity `my-web-2026-cf-worker` (role=`viewer`,
 * pinned by Issue #67 bootstrap) is read-only and CANNOT mutate prod
 * secrets via the v3 write endpoints or the CLI subprocess. The Phase B
 * `flip` operation must therefore use an operator-supplied writer
 * `INFISICAL_TOKEN`; the viewer identity is never elevated. The
 * Cloudflare-Worker-only operations (delete/restore/rollback-versioned)
 * do not need an Infisical token at all — they route through `wrangler
 * secret bulk`.
 *
 *   flip                  → operator INFISICAL_TOKEN required (writer); no UA fallback
 *   restore-legacy-only   → operator token preferred; UA fallback acceptable (read-only)
 *   delete-legacy-only    → no Infisical interaction (wrangler bulk only)
 *   rollback-versioned-only → no Infisical interaction (wrangler bulk only)
 *
 * Returns an immutable plan object. Pure function — no env / process / IO.
 */
function planOperationAuth({ operation }) {
	switch (operation) {
		case 'flip':
			return {
				needsInfisicalWrite: true,
				needsInfisicalRead: true,
				// Issue #223: an interactively-authenticated Infisical CLI
				// session is an operator write identity, so it is accepted
				// alongside an explicit token. Both are preflighted for
				// READ before the first mutation; write scope is trusted by
				// operator authorization, not probed (see the
				// `verifyTokenWriteScope` note below).
				requiresOperatorToken: true,
				allowsUaFallback: false,
				allowsCliSession: true,
			};
		case 'restore-legacy-only':
			return {
				needsInfisicalWrite: false,
				needsInfisicalRead: true,
				requiresOperatorToken: false,
				allowsUaFallback: true,
			};
		case 'delete-legacy-only':
		case 'rollback-versioned-only':
			return {
				needsInfisicalWrite: false,
				needsInfisicalRead: false,
				requiresOperatorToken: false,
				allowsUaFallback: false,
			};
		default:
			throw new Error(`Unknown operation: ${operation}`);
	}
}

/**
 * Resolve the @infisical/cli native binary path via Node module
 * resolution (mirrors `scripts/infisical-seed.mjs:374-386` and
 * `scripts/infisical-verify.mjs`). The CLI is a NATIVE EXECUTABLE
 * (~153 MB ELF), NOT a JS shim; it must be spawned directly, never
 * via `process.execPath`. Issue #99 Blocker 1.
 *
 * All file-system / Node-API side effects go through injected deps so
 * the function is unit-testable without touching the real install.
 * Default impls use `import.meta.url` + Node's built-ins.
 */
function resolveInfisicalCliPath({
	require_resolve = null,
	readFileSync = null,
	dirname: dirnameFn = null,
	resolve: resolveFn = null,
	moduleUrl = null,
} = {}) {
	const req = require('node:module').createRequire(moduleUrl ?? import.meta.url);
	const resolveImpl = require_resolve ?? req.resolve.bind(req);
	const pkgPath = resolveImpl('@infisical/cli/package.json');
	const dirImpl = dirnameFn ?? require('node:path').dirname;
	const resImpl = resolveFn ?? require('node:path').resolve;
	const readImpl = readFileSync ?? require('node:fs').readFileSync;
	const pkgDir = dirImpl(pkgPath);
	let binField;
	try {
		binField = JSON.parse(readImpl(pkgPath, 'utf8')).bin;
	} catch (cause) {
		throw new Error(`@infisical/cli/package.json is not valid JSON: ${cause.message}`);
	}
	let binRel;
	if (typeof binField === 'string') {
		binRel = binField;
	} else if (binField && typeof binField.infisical === 'string') {
		binRel = binField.infisical;
	} else {
		throw new Error(
			'@infisical/cli/package.json#bin must declare an `infisical` entry (string or { infisical: string })',
		);
	}
	const cliPath = resImpl(pkgDir, binRel);
	if (cliPath.endsWith('.js')) {
		throw new Error(
			`@infisical/cli binary path ends in .js (${cliPath}); the CLI must be a native executable.`,
		);
	}
	return cliPath;
}

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
/**
 * Issue #247: the Worker-side change set for each operation.
 *
 * Returned as a changes object, not a pre-serialised string, so the
 * shared adapter owns the Merge Patch wire shape. The existing
 * single-key semantics carry over exactly: a deletion is one `null`,
 * never a re-send of the current secret set — that is what keeps
 * `delete-legacy-only` from touching any other binding (#243).
 */
function buildWorkerSecretChanges({ operation, versionedForm, legacyPlaintext }) {
	switch (operation) {
		case 'flip':
			return { BETTER_AUTH_SECRETS: versionedForm };
		case 'delete-legacy-only':
			return { BETTER_AUTH_SECRET: null };
		case 'restore-legacy-only':
			return { BETTER_AUTH_SECRET: legacyPlaintext };
		case 'rollback-versioned-only':
			return { BETTER_AUTH_SECRETS: null };
		default:
			throw new Error(`Unknown operation: ${operation}`);
	}
}

/**
 * Build the argv for `infisical secrets set`. Operates on YAML file
 * format (Infisical CLI accepts `.env` and YAML via `--file`).
 */
function buildInfisicalSetArgs({ yamlPath, environment, projectId }) {
	return [
		'secrets',
		'set',
		'--file',
		yamlPath,
		'--env',
		environment,
		'--path',
		'/',
		'--projectId',
		projectId,
	];
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
 * Issue #223 — read the legacy Better Auth plaintext in whichever auth
 * mode was resolved. Token mode keeps the direct HTTPS read; CLI mode
 * materialises the value into a 0600 temp file via a CLI-auth child so
 * the driver never holds a bearer token. The file is always removed.
 */
async function readLegacyPlaintextViaAuth({ auth, apiUrl, cliPath, workspaceId, environment }) {
	if (auth.mode === AUTH_MODE.TOKEN) {
		return readLegacyPlaintext(apiUrl, auth.token, workspaceId, environment);
	}
	const { readFileSync } = await import('node:fs');
	const handle = await materialiseSecret({
		auth,
		apiUrl,
		cliPath,
		environment,
		projectId: workspaceId,
		name: 'BETTER_AUTH_SECRET',
		readViaToken: async () => {
			throw new Error('unreachable: CLI mode never calls readViaToken');
		},
	});
	try {
		return readFileSync(handle.path, 'utf8');
	} finally {
		handle.cleanup();
	}
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
	// Issue #99 Blocker 2 — REMOVED in driver remediation. The previous
	// GET-probe preflight was logically invalid: viewer-scoped tokens
	// can read individual secrets (200 on `/api/v3/secrets/raw/<key>`),
	// so the probe passed for the wrong reason. Writer scope cannot be
	// inferred from a read-only endpoint.
	//
	// The new operator-authorization model is enforced in `main()`:
	//   1. `flip` hard-requires an operator-supplied `INFISICAL_TOKEN`
	//      in the env (writer-scoped by operator trust, not probed).
	//   2. UA-from-`INFISICAL_CLIENT_ID`/`SECRET` is NOT used for `flip`
	//      (the viewer Machine Identity cannot write prod secrets).
	//   3. `restore-legacy-only` may use UA as a read-only fallback.
	//   4. `delete-legacy-only` / `rollback-versioned-only` skip
	//      Infisical entirely (wrangler bulk only).
	//
	// The function is retained as a no-op stub so historical callers
	// (if any external one ever exists) get a clear "removed" error
	// rather than a confusing undefined-reference.
	throw new Error(
		'verifyTokenWriteScope was removed in Issue #99 driver remediation. The operator-authorization model now requires an operator-supplied INFISICAL_TOKEN for the flip operation (UA preflight cannot prove write scope). See planOperationAuth() in scripts/phase-3-plus-prod-flip.mjs.',
	);
}

/**
 * Spawn the infisical CLI subprocess for `secrets set --file`. The
 * CLI handles self-host v0.165.x E2EE; plain HTTPS UPSERT is NOT
 * supported because the v3 secret-write endpoint requires
 * `secretKeyCiphertext/IV/Tag` + `secretValueCiphertext/IV/Tag`.
 *
 * Issue #99 Blocker 1: the CLI is a NATIVE EXECUTABLE (ELF 64-bit,
 * ~153 MB), NOT a JS shim. We spawn it directly via the path
 * resolved by `resolveInfisicalCliPath()`; never wrap in
 * `process.execPath` (Node cannot execute a native binary blob).
 *
 * Stdio is `['pipe', 'inherit', 'inherit']` for parity with
 * `spawnWranglerBulk()` — even though the CLI itself does not read
 * stdin for `secrets set --file`, the explicit pipe prevents
 * interactive prompts from blocking and matches the canonical
 * wrangler bulk discipline.
 */
function spawnInfisicalSet({ yamlPath, environment, projectId, env, deps }) {
	const spawnFn = deps?.spawn ?? spawn;
	const cliPath = deps?.cliPath ?? resolveInfisicalCliPath();
	return spawnFn(cliPath, buildInfisicalSetArgs({ yamlPath, environment, projectId }), {
		stdio: ['pipe', 'inherit', 'inherit'],
		env,
	});
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
function describePlan({ operation, environment, accountId, workerName }) {
	const lines = [];
	lines.push(`[dry-run] operation=${operation}`);
	lines.push(`[dry-run] environment=${environment}`);
	// Issue #247: name the canonical Worker and the API operation, not a
	// config file path. A path said which file to read; it did not say
	// which Worker would be mutated, and the file is deleted.
	lines.push(`[dry-run] target: Worker ${workerName} on account ${accountId}`);
	lines.push(
		'[dry-run] mutation: Cloudflare Workers API (JSON Merge Patch, one binding per operation)',
	);
	switch (operation) {
		case 'flip':
			lines.push(
				'[dry-run] would: resolve auth (operator-supplied INFISICAL_TOKEN, else the operator\'s logged-in Infisical CLI session) → read legacy plaintext from Infisical prod → write temp YAML → spawn infisical secrets set --file → PATCH the Worker secret Merge Patch with { BETTER_AUTH_SECRETS: "1:<plaintext>" }',
			);
			break;
		case 'delete-legacy-only':
			lines.push(
				'[dry-run] would: NO Infisical mutation; PATCH the Worker secret Merge Patch with { BETTER_AUTH_SECRET: null } (a one-key delete)',
			);
			break;
		case 'restore-legacy-only':
			lines.push(
				'[dry-run] would: HTTPS GET legacy plaintext from Infisical prod → PATCH the Worker secret Merge Patch with { BETTER_AUTH_SECRET: "<plaintext>" }',
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
	buildWorkerSecretChanges,
	buildInfisicalSetArgs,
	planOperationAuth,
	resolveInfisicalCliPath,
	spawnInfisicalSet,
	OPERATIONS,
};

// ─── CLI entrypoint ─────────────────────────────────────────────────────
async function main() {
	const args = parseArgs(process.argv.slice(2));
	const infisicalConfig = readInfisicalJson();
	const cliPath = resolveInfisicalCliPath();
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
				accountId: ACCOUNT_ID,
				workerName: WORKER_NAME,
			}),
		);
		console.log('[dry-run] no side effects; pass --execute to apply');
		return;
	}

	// --execute path — per-operation auth strategy (Issue #99)
	const apiUrl = process.env.INFISICAL_API_URL ?? args.apiUrl;
	const plan = planOperationAuth({ operation: args.operation });

	let accessToken = null;
	let auth = null;
	let legacyPlaintext = null;
	let versionedForm = null;
	let tempDir = null;

	try {
		// Per-operation auth acquisition:
		//   flip                  → operator INFISICAL_TOKEN required (writer). UA-from-MA not acceptable.
		//   restore-legacy-only   → operator token preferred; UA fallback acceptable (read-only).
		//   delete-legacy-only    → no Infisical auth needed (wrangler bulk only).
		//   rollback-versioned-only → no Infisical auth needed (wrangler bulk only).
		const operatorToken = process.env.INFISICAL_TOKEN;
		const hasOperatorToken = typeof operatorToken === 'string' && operatorToken.length > 0;

		if (plan.needsInfisicalWrite || plan.needsInfisicalRead) {
			if (hasOperatorToken) {
				accessToken = operatorToken;
				auth = { mode: AUTH_MODE.TOKEN, token: operatorToken };
				console.log(
					`[execute] Using operator-supplied INFISICAL_TOKEN for operation=${args.operation}`,
				);
			} else if (plan.allowsCliSession) {
				// Issue #223: no token, but the operator is logged into the
				// Infisical CLI. `resolveInfisicalAuth` preflights that
				// session for READ against this project + environment and
				// throws here — before any mutation — if it cannot.
				auth = await resolveInfisicalAuth({
					env: process.env,
					cliPath,
					environment: args.environment,
					projectId: infisicalConfig.workspaceId,
				});
				accessToken = auth.token;
				console.log(
					`[execute] Using operator's logged-in Infisical CLI session for operation=${args.operation} (read preflight passed)`,
				);
			} else if (plan.allowsUaFallback) {
				// restore-legacy-only path — UA fallback allowed (read-only).
				const clientId = process.env.INFISICAL_CLIENT_ID;
				const clientSecret = process.env.INFISICAL_CLIENT_SECRET;
				if (typeof clientId !== 'string' || clientId.length === 0) {
					throw new Error(
						'INFISICAL_TOKEN or INFISICAL_CLIENT_ID env var is required for restore-legacy-only (UA fallback)',
					);
				}
				if (typeof clientSecret !== 'string' || clientSecret.length === 0) {
					throw new Error(
						'INFISICAL_CLIENT_SECRET env var is required when no operator-supplied INFISICAL_TOKEN is present (UA fallback)',
					);
				}
				console.log('[execute] No operator INFISICAL_TOKEN; falling back to Universal Auth login');
				accessToken = await loginUniversalAuth(apiUrl, clientId, clientSecret);
				// Env discipline: remove CLIENT_ID / SECRET post-auth.
				// biome-ignore lint/performance/noDelete: env cleanup; Node docs mandate `delete` (not `= undefined`).
				delete process.env.INFISICAL_CLIENT_ID;
				// biome-ignore lint/performance/noDelete: env cleanup; Node docs mandate `delete` (not `= undefined`).
				delete process.env.INFISICAL_CLIENT_SECRET;
			} else if (plan.requiresOperatorToken) {
				throw new Error(
					`--execute --operation=${args.operation} requires an operator-supplied INFISICAL_TOKEN with write permission on ${args.environment}. The viewer Machine Identity (my-web-2026-cf-worker, role=viewer) is read-only and fails-closed for ${args.operation}.`,
				);
			} else {
				throw new Error(
					`--execute --operation=${args.operation} requires either INFISICAL_TOKEN or UA credentials (INFISICAL_CLIENT_ID / INFISICAL_CLIENT_SECRET) for the Infisical read.`,
				);
			}

			// Token propagation: assign the resolved token to process.env
			// BEFORE building the sanitized env for any subsequent
			// subprocess (the Infisical CLI for `flip` reads
			// INFISICAL_TOKEN from the inherited env). NEVER appears in
			// argv.
			process.env.INFISICAL_TOKEN = accessToken;
		}

		if (args.operation === 'flip' || args.operation === 'restore-legacy-only') {
			console.log(`[execute] Reading legacy plaintext from Infisical ${args.environment}...`);
			// Issue #223: with the CLI session there is no bearer token, so
			// a CLI-auth child materialises the value into a 0600 temp file
			// that is removed immediately after reading.
			legacyPlaintext = await readLegacyPlaintextViaAuth({
				auth,
				apiUrl,
				cliPath,
				workspaceId: infisicalConfig.workspaceId,
				environment: args.environment,
			});
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
			const sanitizedEnv = buildInfisicalEnvShared(process.env, auth);
			const infisicalChild = spawnInfisicalSet({
				yamlPath,
				environment: args.environment,
				projectId: infisicalConfig.workspaceId,
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

		// Issue #247: Worker secret mutation via the shared API adapter
		// (Cloudflare Merge Patch). The value travels in an HTTPS body,
		// never argv, and the adapter enforces the production gate.
		const changes = buildWorkerSecretChanges({
			operation: args.operation,
			versionedForm,
			legacyPlaintext,
		});
		console.log(`[execute] Applying Worker secret change (operation=${args.operation})...`);
		await bulkUpdateWorkerSecrets(changes, { execute: true, env: process.env });

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
