#!/usr/bin/env node
/**
 * Issue #139 — Fresh production rotation of `BETTER_AUTH_SECRET` signing
 * material (canonical-incident containment).
 *
 * ## Security context
 *
 * During the 2026-09-28 read-only Infisical preflight for Issue #122,
 * an `infisical secrets --env=dev --path=/` invocation leaked four
 * plaintext secret values into agent output. One of them — the Infisical
 * `dev` `BETTER_AUTH_SECRET` — is the value currently bound to the
 * production Cloudflare Worker, because Incident #99 recovery restored
 * Worker signing material from that exact dev value (per Issue #99
 * documentation; production-side provenance has not changed since).
 *
 * The exposed `dev` `BETTER_AUTH_SECRET` must therefore be treated as
 * **production-compromised**. The existing Issue #122 reconciliation
 * premise ("copy the exposed dev value into Infisical prod") is
 * discarded: a `MATCH` between dev and prod proves only that the
 * exposed value is still in use, not that the system is safe.
 *
 * ## What this script does
 *
 * Implements code-side containment WITHOUT performing production
 * mutation in this turn. The operator gates `--execute` in a separate
 * session with explicit authorization (per `release-merge-human-gate`).
 *
 * 1. Generate a fresh, cryptographically secure `BETTER_AUTH_SECRET`
 *    value IN-PROCESS via `crypto.randomBytes(48)` → 384 bits of
 *    entropy, base64url-encoded (64 chars).
 * 2. Write the fresh value to **Infisical `prod`** under BOTH:
 *      - `BETTER_AUTH_SECRET`     = `<fresh>`
 *      - `BETTER_AUTH_SECRETS`    = `1:<fresh>`     (ready for #89 Phase B flip)
 *    via `infisical secrets set --file <yaml>` (CLI subprocess; native
 *    binary; `--file` consumes YAML without shell interpretation).
 * 3. Write the fresh value to the **Worker** under:
 *      - `BETTER_AUTH_SECRET`     = `<fresh>`
 *    via `wrangler secret bulk -c wrangler.production.jsonc` with
 *    stdin JSON (single subprocess pattern; no interactive prompts).
 *    `BETTER_AUTH_SECRETS` is NOT bound to the Worker in this rotation
 *    (the Phase 3+ flip is a separate ticket — Issue #89).
 * 4. Verify each write with a status-only signal:
 *      - **Infisical**: HTTPS GET read-back, `timingSafeEqual` against
 *        the in-process fresh value (byte-equality, no value printed).
 *      - **Worker**: `wrangler secret list --format json` — name-only
 *        (Cloudflare does NOT expose secret values for read-back; name
 *        presence is the strongest verification available).
 *
 * ## Safety invariants (FAIL-CLOSED on any violation)
 *
 *  - Default mode is `--dry-run`. No network access, no mutation.
 *  - `--execute` requires an operator-supplied `INFISICAL_TOKEN`
 *    (writer-scoped per operator trust; viewer Machine Identity
 *    fails-closed). UA fallback is NOT used for write.
 *  - Fresh secret is NEVER persisted to a file outside the
 *    0600-permission YAML temp file consumed by the Infisical CLI
 *    subprocess. The temp file lives under `os.tmpdir()` and is
 *    `rmSync`'d in `finally` after the subprocess exits.
 *  - Fresh secret is NEVER passed via argv, `process.env`, log line,
 *    error message, GitHub comment, chat output, or temp filename.
 *  - All subprocess spawns use `shell: false` and explicit JSON argv
 *    arrays. No `sh -c`, no `bash -c`, no command substitution.
 *  - All wrangler mutations use `wrangler secret bulk` with stdin
 *    JSON. `wrangler secret put` / `wrangler secret delete` are NOT
 *    used (interactive `confirm()` would block).
 *  - **Subprocess env isolation** (PR #140 re-review, 2026-09-28):
 *    two distinct subprocess env contracts:
 *      - `buildInfisicalEnv(baseEnv, token)` keeps the writer
 *        `INFISICAL_TOKEN` and strips the other Infisical credentials
 *        (CLIENT_ID / CLIENT_SECRET / PROJECT_ID / SITE_URL /
 *        API_URL). Used for the Infisical CLI subprocess ONLY.
 *      - `buildCfEnv(baseEnv)` strips the FULL 6-key Infisical
 *        credential set (including INFISICAL_TOKEN). Used for every
 *        Wrangler / D1 subprocess (secret bulk, secret list, d1
 *        execute). Wrangler/D1 MUST NEVER receive the writer-scoped
 *        Infisical token.
 *
 * ## Failure semantics
 *
 *  - If Infisical `prod` fresh write succeeds but Worker fresh write
 *    fails, the script MUST NOT roll Infisical back to the exposed
 *    old value. The fresh value is preserved in Infisical; the
 *    operator uses `--worker-recovery` to retry the Worker side.
 *  - "Infisical byte equality" and "Worker secret-name existence" are
 *    SEPARATE verification signals and MUST NOT be conflated. The
 *    former proves the value is correct; the latter only proves the
 *    binding is present (Cloudflare has no read-back for secret
 *    values).
 *  - On `--worker-recovery`: the script reads the current
 *    `BETTER_AUTH_SECRET` from Infisical `prod` and writes it to the
 *    Worker. No new value is generated. This is the safe recovery
 *    path after a partial-failure `--execute`.
 *
 * ## Operation modes (mutually exclusive)
 *
 *  - `--dry-run`         default; describe plan, no side effects, no network.
 *  - `--execute`         full cycle: generate + Infisical + Worker.
 *  - `--verify-only`     read-only status report (Infisical + Worker
 *                        binding names). Useful as a smoke before or
 *                        after a real rotation.
 *  - `--worker-recovery` recovery path: read fresh from Infisical
 *                        `prod`, write to Worker only. Used after a
 *                        partial failure during `--execute`.
 *
 * Defaults: `--dry-run` + target=`prod` (the script is
 * production-only).
 *
 * ## Out of scope
 *
 *  - Issue #89 Phase B flip (`BETTER_AUTH_SECRETS` Worker binding).
 *    That is a separate ticket; this script deliberately does NOT
 *    mix containment with the Phase B transition.
 *  - Dev environment rotation. The exposed dev value is no longer
 *    a production source after this rotation succeeds; it is
 *    handled in a separate issue (track via follow-up Issue).
 *  - `MY_WEB_2026_CONSUMER_API_KEY` rotation. Handled by #74.
 *
 * ## Exit codes
 *
 *  - 0  success
 *  - 1  argument / preflight / env validation failure
 *  - 2  Infisical or Worker subprocess failure
 *  - 3  partial-failure recovery state (Infisical fresh succeeded,
 *       Worker fresh failed). Operator must run `--worker-recovery`.
 */
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	AUTH_MODE,
	buildCfEnv as buildCfEnvShared,
	buildInfisicalEnv as buildInfisicalEnvShared,
	compareSecretViaAuth,
	materialiseSecret,
	resolveInfisicalAuth,
	summarizeSecretPairViaAuth,
} from './_infisical-auth.mjs';
import { bulkUpdateWorkerSecrets, listWorkerSecretNameList } from './_worker-secrets.mjs';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const INFISICAL_JSON_PATH = join(REPO_ROOT, '.infisical.json');

const INFISICAL_API_URL_DEFAULT = 'https://secrets.rebuildup.dev';
const TEMPDIR_PREFIX = 'my-web-2026-issue-139-';
const STALE_TEMPDIR_AGE_MS = 24 * 60 * 60 * 1000;

const SECRET_NAME_LEGACY = 'BETTER_AUTH_SECRET';
const SECRET_NAME_VERSIONED = 'BETTER_AUTH_SECRETS';
const FRESH_SECRET_BYTES_DEFAULT = 48;
const HTTPS_TIMEOUT_MS = 10_000;
const HTTPS_MAX_RESPONSE_BYTES = 64 * 1024;
const SUBPROCESS_TIMEOUT_MS = 30_000;

const ALLOWED_INFISICAL_JSON_KEYS = new Set(['workspaceId', 'defaultEnvironment']);
const REQUIRED_INFISICAL_JSON_KEYS = ['workspaceId'];

const MODES = ['dry-run', 'execute', 'verify-only', 'worker-recovery'];

/* ─── Pure helpers (testable; no IO) ───────────────────────────────────── */

/**
 * Generate a fresh signing secret. `crypto.randomBytes` is the Node
 * canonical CSPRNG; output is base64url to avoid shell-unsafe
 * characters (`+`, `/`, `=`).
 *
 * Defaults: 48 bytes → 64 base64url chars → 384 bits of entropy.
 * Validation: byte count must be 32..128 (matches Better Auth secret
 * convention; below 32 is cryptographically weak, above 128 is
 * unwieldy).
 */
function generateFreshSecret(bytes = FRESH_SECRET_BYTES_DEFAULT) {
	if (!Number.isInteger(bytes) || bytes < 32 || bytes > 128) {
		throw new Error(`FRESH_SECRET_BYTES must be 32..128 (got: ${bytes})`);
	}
	return randomBytes(bytes).toString('base64url');
}

/**
 * Validate the legacy/fresh plaintext against `parseVersionedSecrets`
 * invariants (mirrors `src/cloudflare/auth/better-auth.ts`). The
 * plaintext MUST round-trip losslessly through `1:<plaintext>` →
 * parser → first entry's `value` segment.
 */
function validateFreshSecret(plaintext) {
	if (typeof plaintext !== 'string' || plaintext.length === 0) {
		throw new Error('Fresh secret is empty');
	}
	if (plaintext.includes(',')) {
		throw new Error(
			'Fresh secret contains "," which would corrupt the versioned envelope (BETTER_AUTH_SECRETS splits on ",").',
		);
	}
	if (plaintext !== plaintext.trim()) {
		throw new Error(
			'Fresh secret has leading or trailing whitespace that would be lost on parser round-trip.',
		);
	}
	const envelope = `1:${plaintext}`;
	const parsed = parseVersionedSecrets(envelope);
	if (parsed.length !== 1 || parsed[0].version !== 1 || parsed[0].value !== plaintext) {
		throw new Error('Round-trip through parseVersionedSecrets did not preserve the secret.');
	}
}

/**
 * Re-implementation of `parseVersionedSecrets` from
 * `src/cloudflare/auth/better-auth.ts` (Worker-only module — not
 * importable here). Keep in sync with the upstream parser.
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
			throw new Error(`BETTER_AUTH_SECRETS entry #${idx} has invalid version`);
		}
		const version = Number(versionStr);
		if (!Number.isSafeInteger(version) || version <= 0) {
			throw new Error(`BETTER_AUTH_SECRETS entry #${idx} has invalid version`);
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

function buildVersionedForm(freshSecret) {
	return `1:${freshSecret}`;
}

/**
 * Build the YAML temp file content for `infisical secrets set --file`.
 * Contains TWO keys, both rooted at the same fresh value:
 *   - BETTER_AUTH_SECRET: <fresh>            (legacy audit-copy in Infisical prod)
 *   - BETTER_AUTH_SECRETS: "1:<fresh>"        (ready for #89 Phase B flip)
 *
 * YAML quoted scalars — JSON.stringify handles all escape edge cases
 * (control chars, embedded `"`, backslash, etc.).
 *
 * Invariant: the file MUST contain only these two keys. No other
 * lines, no commented-out references, no trailing whitespace.
 */
function buildInfisicalYamlContent(freshSecret) {
	const envelope = buildVersionedForm(freshSecret);
	return `---\n"${SECRET_NAME_LEGACY}": ${JSON.stringify(freshSecret)}\n"${SECRET_NAME_VERSIONED}": ${JSON.stringify(envelope)}\n`;
}

/**
 * Build the JSON payload for `wrangler secret bulk` stdin. Only the
 * legacy binding is updated — `BETTER_AUTH_SECRETS` is NOT bound to
 * the Worker in this rotation (the Phase 3+ flip is a separate
 * ticket — Issue #89).
 */
function buildWorkerBulkPayload(freshSecret) {
	return JSON.stringify({ [SECRET_NAME_LEGACY]: freshSecret });
}

function buildInfisicalSetArgs(yamlPath, environment, workspaceId) {
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
		workspaceId,
	];
}

/**
 * Parse argv. Mutually-exclusive mode flags. `--execute` requires
 * operator-supplied INFISICAL_TOKEN (verified in main(), not here).
 */
function parseArgs(argv) {
	let mode = 'dry-run';
	let explicitMode = null;
	let environment = 'prod';
	let apiUrl = INFISICAL_API_URL_DEFAULT;
	let bytesOverride = null;
	for (const arg of argv) {
		if (arg === '--execute' || arg === '--verify-only' || arg === '--worker-recovery') {
			if (explicitMode !== null) {
				throw new Error(`conflicting mode flags (${explicitMode} + ${arg})`);
			}
			mode = arg.slice(2);
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
	if (environment !== 'prod') {
		throw new Error(
			`--environment must be 'prod' (this script is production-only; got: ${JSON.stringify(environment)})`,
		);
	}
	return { mode, environment, apiUrl, bytesOverride };
}

function printHelp() {
	console.log(`Usage: rotate-better-auth-secret.mjs
  [--execute | --dry-run | --verify-only | --worker-recovery]
  [--environment=prod]
  [--api-url=<url>]
  [--fresh-bytes=<32..128>]

Issue #139 — Fresh production rotation of BETTER_AUTH_SECRET signing material.

Operation modes (mutually exclusive):
  --dry-run         default; describe plan, no side effects, no network
  --execute         full cycle: generate fresh + Infisical prod + Worker
                    (requires operator-supplied INFISICAL_TOKEN)
  --verify-only     read-only status: Infisical env + Worker binding names
  --worker-recovery partial-failure recovery: read fresh from Infisical prod,
                    write to Worker only (no new value generated)

Default: --dry-run. Production-only (--environment must be 'prod').

Fresh secret invariants:
  - 48 bytes → 64 base64url chars → 384 bits of entropy (default)
  - generated IN-PROCESS via crypto.randomBytes
  - never persisted except to a 0600 YAML temp file consumed by the
    Infisical CLI subprocess; rmSync'd in finally
  - never in argv, stdout, stderr, log, error message, GitHub, chat,
    or temp filename

Production desired state post-rotation:
  - Infisical prod BETTER_AUTH_SECRET  = <fresh>
  - Infisical prod BETTER_AUTH_SECRETS = 1:<fresh>  (ready for #89 flip)
  - Worker BETTER_AUTH_SECRET          = <fresh>
  - Worker BETTER_AUTH_SECRETS         NOT bound    (Phase 3+ #89 is separate)

Failure semantics:
  - Infisical fresh-write success + Worker fresh-write failure → exit 3,
    operator runs --worker-recovery. Infisical MUST NOT be rolled back
    to the exposed old value.
  - --worker-recovery is the only safe recovery path; never retry a
    full --execute (that would generate a NEW fresh value and overwrite
    the Infisical side again).

Exit codes: 0 success / 1 arg+preflight / 2 subprocess failure /
            3 partial-failure recovery state`);
}

/* ─── File IO / subprocess (testable via deps injection) ──────────────── */

function readInfisicalJson(fsImpl = { readFileSync, existsSync }) {
	if (!fsImpl.existsSync(INFISICAL_JSON_PATH)) {
		throw new Error(`.infisical.json not found at ${INFISICAL_JSON_PATH}`);
	}
	let parsed;
	try {
		parsed = JSON.parse(fsImpl.readFileSync(INFISICAL_JSON_PATH, 'utf8'));
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
 * Resolve the @infisical/cli native binary path. Mirrors the
 * pattern in `phase-3-plus-prod-flip.mjs#resolveInfisicalCliPath`
 * (Issue #99 driver remediation).
 */
function resolveInfisicalCliPath({ deps = {} } = {}) {
	const req = deps.require ?? require;
	const fsImpl = deps.fsImpl ?? { readFileSync };
	const pathImpl = deps.pathImpl ?? require('node:path');
	const pkgPath = req.resolve('@infisical/cli/package.json');
	const pkgDir = pathImpl.dirname(pkgPath);
	const binField = JSON.parse(fsImpl.readFileSync(pkgPath, 'utf8')).bin;
	const binRel =
		typeof binField === 'string'
			? binField
			: binField && typeof binField.infisical === 'string'
				? binField.infisical
				: null;
	if (binRel === null) {
		throw new Error('@infisical/cli/package.json#bin must declare an `infisical` entry');
	}
	const cliPath = pathImpl.resolve(pkgDir, binRel);
	if (cliPath.endsWith('.js')) {
		throw new Error(`@infisical/cli binary path ends in .js (${cliPath}); native binary required`);
	}
	return cliPath;
}

/**
 * Stale tempdir cleanup at startup (SIGKILL teardown races are not
 * fatal — best-effort).
 */
function cleanupStaleTempDirs(
	fsImpl = {
		readdirSync: require('node:fs').readdirSync,
		statSync: require('node:fs').statSync,
		rmSync,
	},
) {
	const now = Date.now();
	let removed = 0;
	for (const entry of fsImpl.readdirSync(tmpdir())) {
		if (!entry.startsWith(TEMPDIR_PREFIX)) continue;
		const fullPath = join(tmpdir(), entry);
		try {
			const stat = fsImpl.statSync(fullPath);
			if (!stat.isDirectory()) continue;
			if (now - stat.mtimeMs < STALE_TEMPDIR_AGE_MS) continue;
			fsImpl.rmSync(fullPath, { recursive: true, force: true });
			removed += 1;
		} catch {
			// Best-effort cleanup.
		}
	}
	return removed;
}

/**
 * Spawn `infisical secrets set --file <yaml>` with explicit stdio.
 * The CLI is a native executable (no Node wrapper); stdio pipes
 * prevent any interactive prompt from blocking.
 *
 * Spawn-based (NOT execFileSync) so we can read stdout/stderr and
 * capture failure status without leaking the YAML contents to
 * process.stdout.
 */
function spawnInfisicalSet({ cliPath, yamlPath, environment, workspaceId, env, deps = {} }) {
	const spawnFn = deps.spawn ?? spawn;
	const child = spawnFn(cliPath, buildInfisicalSetArgs(yamlPath, environment, workspaceId), {
		stdio: ['pipe', 'pipe', 'pipe'],
		env,
	});
	return child;
}

/* ─── HTTPS (Infisical read-back) ──────────────────────────────────────── */

function classifyInfisicalHttpStatus(statusCode, { allowNotFound = false } = {}) {
	if (statusCode === 200) return 'ok';
	if (statusCode === 404 && allowNotFound) return 'missing';
	return 'error';
}

function httpsGetJson(urlString, token, { allowNotFound = false } = {}) {
	const url = new URL(urlString);
	return new Promise((resolvePromise, rejectPromise) => {
		const req = httpsRequest(
			{
				method: 'GET',
				hostname: url.hostname,
				port: url.port || 443,
				path: url.pathname + url.search,
				headers: {
					Accept: 'application/json',
					Authorization: `Bearer ${token}`,
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
					const status = classifyInfisicalHttpStatus(res.statusCode, { allowNotFound });
					if (status === 'missing') {
						resolvePromise(null);
						return;
					}
					if (status === 'error') {
						rejectPromise(new Error(`Infisical read failed with HTTP ${res.statusCode}`));
						return;
					}
					try {
						resolvePromise(JSON.parse(chunks.join('')));
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

function buildSecretReadUrl({ apiUrl, workspaceId, environment, name }) {
	const params = new URLSearchParams({
		workspaceId,
		environment,
		secretPath: '/',
		viewSecretValue: 'true',
	});
	return `${apiUrl.replace(/\/+$/, '')}/api/v3/secrets/raw/${name}?${params.toString()}`;
}

function interpretInfisicalReadResponse({ response, allowMissing, environment, name }) {
	if (response === null && allowMissing) return null;
	const value = response?.secret?.secretValue;
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`${name} is missing or empty in environment=${environment}`);
	}
	return value;
}

async function readInfisicalSecret({
	apiUrl,
	token,
	workspaceId,
	environment,
	name,
	allowMissing = false,
}) {
	const url = buildSecretReadUrl({ apiUrl, workspaceId, environment, name });
	const response = await httpsGetJson(url, token, { allowNotFound: allowMissing });
	return interpretInfisicalReadResponse({ response, allowMissing, environment, name });
}

function secretValuesEqual(a, b) {
	const bufA = Buffer.from(a, 'utf8');
	const bufB = Buffer.from(b, 'utf8');
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

/**
 * Build the env for the **Infisical CLI** subprocess. The
 * operator-supplied INFISICAL_TOKEN is REQUIRED so the CLI can
 * authenticate; the other Infisical credentials are stripped because
 * the CLI uses the token, not UA. CLIENT_ID / CLIENT_SECRET are NOT
 * accepted by this script (operator-trust model for write paths).
 *
 * **PR #140 re-review fix (2026-09-28)**: the prior `buildSanitizedEnv`
 * stripped INFISICAL_TOKEN itself, so the Infisical CLI subprocess
 * was being launched with an empty auth header. Split the contract:
 * `buildInfisicalEnv` keeps the token (Infisical side); the Wrangler
 * side uses `buildCfEnv` which strips it. Mirrored from
 * `scripts/rotate-home-api-key.mjs#buildInfisicalEnv`.
 */
function buildInfisicalEnv(baseEnv, auth) {
	// Issue #223: token mode injects the token; CLI mode strips every
	// credential so the Infisical CLI uses its own stored session.
	const token = typeof auth === 'string' ? auth : auth?.token;
	const mode = typeof auth === 'string' ? AUTH_MODE.TOKEN : auth?.mode;
	const env = buildInfisicalEnvShared(baseEnv, { mode, token });
	return env;
}

/**
 * Build the env for **Wrangler / D1** subprocesses. Strips the FULL
 * 6-key Infisical credential set (including INFISICAL_TOKEN). The
 * writer-scoped Infisical token is scoped to write Infisical, not
 * Cloudflare or D1; leaking it to Wrangler violates least-privilege
 * and exposes the token to any subprocess Wrangler spawns.
 *
 * **PR #140 re-review fix (2026-09-28)**: the prior code passed
 * `process.env` straight to the Wrangler subprocess, so the writer
 * token was leaking via `env: process.env` in `writeWorkerSecretPatch` and
 * `listWorkerBindingNames`. Mirrored from
 * `scripts/rotate-home-api-key.mjs#buildCfEnv`.
 */
function buildCfEnv(baseEnv) {
	// Issue #223: single shared implementation of the least-privilege
	// strip, so the four drivers cannot drift apart.
	return buildCfEnvShared(baseEnv);
}

/**
 * Deprecated alias for `buildCfEnv`. Retained for back-compat
 * with prior commit SHAs / external callers; new code MUST use
 * `buildInfisicalEnv` (for the Infisical CLI) or `buildCfEnv`
 * (for Wrangler / D1) directly. PR #140 re-review, 2026-09-28.
 */
function buildSanitizedEnv(baseEnv) {
	return buildCfEnv(baseEnv);
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

/* ─── Status report helpers ────────────────────────────────────────────── */

/**
 * Status-only output for `--verify-only` and post-write reports.
 * Names + counts + boolean status only — never values, hashes, lengths.
 */
function summarizeInfisicalState({ legacyValue, versionedValue, expectedFresh }) {
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
	// Both present — check the envelope invariant:
	//   BETTER_AUTH_SECRETS == 1:<BETTER_AUTH_SECRET>
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

function summarizeWorkerState({ bindings }) {
	return {
		hasLegacy: bindings.includes(SECRET_NAME_LEGACY),
		hasVersioned: bindings.includes(SECRET_NAME_VERSIONED),
		bindingsCount: bindings.length,
	};
}

/* ─── Public exports (DI seams for tests) ──────────────────────────────── */

export {
	FRESH_SECRET_BYTES_DEFAULT,
	MODES,
	SECRET_NAME_LEGACY,
	SECRET_NAME_VERSIONED,
	TEMPDIR_PREFIX,
	generateFreshSecret,
	validateFreshSecret,
	parseVersionedSecrets,
	buildVersionedForm,
	buildInfisicalYamlContent,
	buildWorkerBulkPayload,
	buildInfisicalSetArgs,
	parseArgs,
	readInfisicalJson,
	resolveInfisicalCliPath,
	cleanupStaleTempDirs,
	spawnInfisicalSet,
	classifyInfisicalHttpStatus,
	buildSecretReadUrl,
	interpretInfisicalReadResponse,
	httpsGetJson,
	readInfisicalSecret,
	secretValuesEqual,
	buildInfisicalEnv,
	buildCfEnv,
	buildSanitizedEnv,
	awaitExit,
	summarizeInfisicalState,
	summarizeWorkerState,
};

/* ─── CLI entrypoint ───────────────────────────────────────────────────── */

/**
 * Issue #247: the live Worker binding listing is the single shared
 * API helper, so every driver reads secret NAMES the same way and
 * none of them spawn Wrangler to do it. Cloudflare exposes names and
 * types only; no value is requested or returned.
 */
async function listWorkerBindingNames(env) {
	return listWorkerSecretNameList({ env: env ?? process.env });
}

async function runInfisicalWrite({ cliPath, yamlPath, environment, workspaceId, env }) {
	const child = spawnInfisicalSet({ cliPath, yamlPath, environment, workspaceId, env });
	const stdoutChunks = [];
	const stderrChunks = [];
	child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
	child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
	const { code, signal } = await awaitExit(child);
	const stdout = Buffer.concat(stdoutChunks).toString('utf8');
	const stderr = Buffer.concat(stderrChunks).toString('utf8');
	return { code, signal, stdout, stderr };
}

/**
 * Issue #247: the Worker write goes through the shared API adapter.
 *
 * The Infisical side is unchanged. The value travels in an HTTPS
 * Merge Patch body, never argv, and the adapter enforces the
 * production gate. Partial-failure semantics are preserved by the
 * caller: an Infisical success with a Worker failure must still be
 * reported as a partial failure, never as success.
 */
async function runWorkerSecretWrite({ changes, env, execute }) {
	try {
		await bulkUpdateWorkerSecrets(changes, { execute, env });
		return { code: 0, signal: null, stderr: '' };
	} catch (error) {
		// `error.message` never contains a secret value: the adapter only
		// puts names, HTTP status and the API's own error text in it.
		return { code: 1, signal: null, stderr: String(error?.message ?? error) };
	}
}

async function runVerify({ apiUrl, auth, cliPath, workspaceId, environment }) {
	// Issue #223: the envelope invariant needs BOTH values, so in CLI
	// mode it is evaluated inside a CLI-auth child that already holds
	// them; the driver receives booleans only. Token mode keeps the
	// pre-#223 read-then-compare path.
	const infisical = await summarizeSecretPairViaAuth({
		auth,
		apiUrl,
		cliPath,
		environment,
		projectId: workspaceId,
		legacyName: SECRET_NAME_LEGACY,
		versionedName: SECRET_NAME_VERSIONED,
		versionPrefix: '1:',
		token: auth.token,
		readViaToken: async ({ apiUrl: u, token: t, environment: e, name }) =>
			readInfisicalSecret({
				apiUrl: u,
				token: t,
				workspaceId,
				environment: e,
				name,
				allowMissing: true,
			}),
	});
	const bindings = await listWorkerBindingNames(buildCfEnv(process.env));
	return {
		infisical,
		worker: summarizeWorkerState({ bindings }),
	};
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const infisicalConfig = readInfisicalJson();
	cleanupStaleTempDirs();

	console.log(`[rotate-better-auth] mode=${args.mode}`);
	console.log(`[rotate-better-auth] environment=${args.environment}`);
	console.log(`[rotate-better-auth] workspaceId=${infisicalConfig.workspaceId}`);

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
			`  3. write Worker ${SECRET_NAME_LEGACY} = <fresh> via wrangler secret bulk (stdin JSON)`,
		);
		console.log(
			'  4. verify: HTTPS GET read-back + timingSafeEqual (Infisical) + wrangler secret list (Worker names)',
		);
		console.log('[dry-run] no side effects; pass --execute to apply (operator gate required)');
		return;
	}

	// Issue #223: resolve auth once, before any side effect. An
	// explicit INFISICAL_TOKEN keeps the pre-#223 path; otherwise the
	// logged-in Infisical CLI session is preflighted. If neither is
	// usable this throws BEFORE the first mutation.
	const cliPath = resolveInfisicalCliPath();
	const auth = await resolveInfisicalAuth({
		env: process.env,
		cliPath,
		environment: args.environment,
		projectId: infisicalConfig.workspaceId,
	});
	console.log(`[rotate-better-auth] auth mode=${auth.mode}`);

	if (args.mode === 'verify-only') {
		const result = await runVerify({
			apiUrl,
			auth,
			cliPath,
			workspaceId: infisicalConfig.workspaceId,
			environment: args.environment,
		});
		console.log(
			`[verify-only] Infisical ${SECRET_NAME_LEGACY}: ${result.infisical.legacyPresent ? 'present' : 'missing'}`,
		);
		console.log(
			`[verify-only] Infisical ${SECRET_NAME_VERSIONED}: ${result.infisical.versionedPresent ? 'present' : 'missing'}`,
		);
		console.log(
			`[verify-only] Infisical envelope invariant: ${result.infisical.envelopeOk == null ? 'N/A' : result.infisical.envelopeOk ? 'OK' : 'BROKEN'}`,
		);
		console.log(
			`[verify-only] Worker bindings: ${result.worker.bindingsCount} (${result.worker.hasLegacy ? `${SECRET_NAME_LEGACY} ` : ''}${result.worker.hasVersioned ? SECRET_NAME_VERSIONED : ''})`,
		);
		console.log(`[verify-only] status=${result.infisical.status}`);
		return;
	}

	// --execute and --worker-recovery paths. `auth` was resolved above
	// (token, or preflighted CLI session) and failed closed there.

	let freshSecret;
	if (args.mode === 'execute') {
		freshSecret = generateFreshSecret(args.bytesOverride ?? FRESH_SECRET_BYTES_DEFAULT);
		validateFreshSecret(freshSecret);
	} else {
		// --worker-recovery: read the existing fresh value from Infisical prod.
		// Issue #223: in CLI mode the value is materialised by a CLI-auth
		// child into a 0600 temp file so the driver never holds a bearer
		// token; the file is removed immediately after reading.
		console.log(
			`[worker-recovery] reading current ${SECRET_NAME_LEGACY} from Infisical ${args.environment}...`,
		);
		const handle = await materialiseSecret({
			auth,
			apiUrl,
			cliPath,
			environment: args.environment,
			projectId: infisicalConfig.workspaceId,
			name: SECRET_NAME_LEGACY,
			token: auth.token,
			readViaToken: async ({ apiUrl: u, token: t, environment: e, name }) =>
				readInfisicalSecret({
					apiUrl: u,
					token: t,
					workspaceId: infisicalConfig.workspaceId,
					environment: e,
					name,
				}),
		});
		try {
			freshSecret = readFileSync(handle.path, 'utf8');
		} finally {
			handle.cleanup();
		}
		validateFreshSecret(freshSecret);
	}

	// Stage 1 — Infisical write (only on --execute; --worker-recovery skips)
	let infisicalWriteSucceeded = false;
	if (args.mode === 'execute') {
		const tempDir = mkdtempSync(join(tmpdir(), TEMPDIR_PREFIX));
		const yamlPath = join(tempDir, 'rotate.yaml');
		try {
			writeFileSync(yamlPath, buildInfisicalYamlContent(freshSecret), {
				encoding: 'utf8',
				mode: 0o600,
			});
			console.log(
				`[execute] writing fresh ${SECRET_NAME_LEGACY} + ${SECRET_NAME_VERSIONED} to Infisical ${args.environment} (via CLI subprocess for E2EE)...`,
			);
			const infisicalEnv = buildInfisicalEnv(process.env, auth);
			const infisicalResult = await runInfisicalWrite({
				cliPath,
				yamlPath,
				environment: args.environment,
				workspaceId: infisicalConfig.workspaceId,
				env: infisicalEnv,
			});
			if (infisicalResult.signal) {
				throw new Error(`infisical CLI terminated by signal ${infisicalResult.signal}`);
			}
			if (infisicalResult.code !== 0) {
				throw new Error(`infisical CLI exited with status ${infisicalResult.code}`);
			}

			// Read-back verification: Infisical byte equality.
			console.log(
				`[execute] verifying Infisical read-back (auth=${auth.mode}, timingSafeEqual)...`,
			);
			// Issue #223: compare without pulling the value back into the
			// driver when running on the CLI session.
			const readViaToken = async ({ apiUrl: u, token: t, environment: e, name }) =>
				readInfisicalSecret({
					apiUrl: u,
					token: t,
					workspaceId: infisicalConfig.workspaceId,
					environment: e,
					name,
				});
			const legacyCheck = await compareSecretViaAuth({
				auth,
				apiUrl,
				cliPath,
				environment: args.environment,
				projectId: infisicalConfig.workspaceId,
				name: SECRET_NAME_LEGACY,
				expected: freshSecret,
				token: auth.token,
				readViaToken,
			});
			if (legacyCheck.status !== 'match') {
				throw new Error(
					`Infisical read-back mismatch: ${SECRET_NAME_LEGACY} ${legacyCheck.status === 'missing' ? 'is missing' : 'did not byte-match the fresh value'}`,
				);
			}
			const versionedCheck = await compareSecretViaAuth({
				auth,
				apiUrl,
				cliPath,
				environment: args.environment,
				projectId: infisicalConfig.workspaceId,
				name: SECRET_NAME_VERSIONED,
				expected: buildVersionedForm(freshSecret),
				token: auth.token,
				readViaToken,
			});
			if (versionedCheck.status !== 'match') {
				throw new Error(
					`Infisical read-back mismatch: ${SECRET_NAME_VERSIONED} ${versionedCheck.status === 'missing' ? 'is missing' : 'did not match the versioned envelope'}`,
				);
			}
			infisicalWriteSucceeded = true;
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	} else {
		infisicalWriteSucceeded = true; // not needed for --worker-recovery
	}

	// Stage 2 — Worker write (BETTER_AUTH_SECRET only).
	console.log(
		`[${args.mode}] writing ${SECRET_NAME_LEGACY} to the Worker (Cloudflare Merge Patch)...`,
	);
	// Issue #247: a single-binding create/update. The versioned binding
	// is NOT re-sent, so the legacy-audit and versioned states stay
	// independent (#243).
	const wranglerResult = await runWorkerSecretWrite({
		changes: { [SECRET_NAME_LEGACY]: freshSecret },
		env: process.env,
		execute: args.mode === 'execute',
	});
	if (wranglerResult.signal) {
		// Partial failure — Infisical fresh succeeded but Worker fresh did not.
		if (infisicalWriteSucceeded && args.mode === 'execute') {
			console.error(
				`[execute] PARTIAL FAILURE: Infisical ${args.environment} holds the fresh value, but Worker ${SECRET_NAME_LEGACY} write was terminated by signal ${wranglerResult.signal}.`,
			);
			console.error(
				'[execute] DO NOT re-run --execute (that would generate a NEW fresh value and overwrite Infisical again).',
			);
			console.error(
				'[execute] Recovery: re-run `pnpm run rotate-better-auth-secret --worker-recovery` (reads the fresh value from Infisical and writes to Worker only).',
			);
			process.exit(3);
		}
		throw new Error(`wrangler terminated by signal ${wranglerResult.signal}`);
	}
	if (wranglerResult.code !== 0) {
		if (infisicalWriteSucceeded && args.mode === 'execute') {
			console.error(
				`[execute] PARTIAL FAILURE: Infisical ${args.environment} holds the fresh value, but Worker ${SECRET_NAME_LEGACY} write failed with exit=${wranglerResult.code}.`,
			);
			console.error(
				'[execute] DO NOT re-run --execute (that would generate a NEW fresh value and overwrite Infisical again).',
			);
			console.error(
				'[execute] Recovery: re-run `pnpm run rotate-better-auth-secret --worker-recovery` (reads the fresh value from Infisical and writes to Worker only).',
			);
			process.exit(3);
		}
		throw new Error(`wrangler secret bulk exited with status ${wranglerResult.code}`);
	}

	// Stage 3 — Worker binding-name verification (no value read-back).
	console.log(`[${args.mode}] verifying Worker binding names (no value read-back)...`);
	const bindings = await listWorkerBindingNames(buildCfEnv(process.env));
	const hasLegacy = bindings.includes(SECRET_NAME_LEGACY);
	if (!hasLegacy) {
		throw new Error(
			`Worker binding-name verification failed: ${SECRET_NAME_LEGACY} not present in wrangler secret list (got: [${bindings.join(', ')}])`,
		);
	}

	// Stage 4 — report.
	if (args.mode === 'execute') {
		console.log(
			`[execute] complete. Infisical ${args.environment}: fresh ${SECRET_NAME_LEGACY} + ${SECRET_NAME_VERSIONED}.`,
		);
	} else {
		console.log(
			`[worker-recovery] complete. Worker ${SECRET_NAME_LEGACY} now matches Infisical ${args.environment}.`,
		);
	}
	console.log(
		`[execute] Worker binding: ${SECRET_NAME_LEGACY}=present (${SECRET_NAME_VERSIONED} NOT bound; #89 Phase B is a separate ticket).`,
	);
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMainModule) {
	main().catch((error) => {
		// Status-only error message. Do NOT echo the error.stack
		// (could leak the secret value through internal error
		// stringification in edge cases).
		console.error(`rotate-better-auth-secret failed: ${error?.message ?? error}`);
		process.exit(1);
	});
}
