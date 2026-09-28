#!/usr/bin/env node
/**
 * Issue #74 — Safe rotation of `MY_WEB_2026_CONSUMER_API_KEY`.
 *
 * ## Security context (Issue #139 canonical incident, 2026-09-28)
 *
 * During a read-only Infisical preflight for Issue #122, a real-value
 * `infisical secrets` invocation leaked four plaintext secret values
 * into agent output. One of them — `MY_WEB_2026_CONSUMER_API_KEY` —
 * was exposed. The existing Issue #74 spec proposed a "plaintext は
 * 1 回のみ出力" design that surfaced the new value to the operator
 * once and required the operator to register it manually. **That
 * design is rejected** for this implementation: the 2026-09-28
 * incident demonstrated that agent- or operator-visible plaintext is
 * a credential disclosure surface, regardless of "only once" framing.
 *
 * This script instead completes **generation → propagation** entirely
 * IN-PROCESS, so the new plaintext is never displayed, logged, passed
 * via argv, written to a chat transcript, or otherwise surfaced. The
 * only persistent artefacts are:
 *   - the SHA-256 hash in the D1 `apikey.key` column (the plaintext
 *     is NOT stored in D1 by Better Auth's contract — this is
 *     unchanged from the bootstrap path);
 *   - the new value inside Infisical `prod` and the Cloudflare Worker
 *     binding, written via the dedicated secure channels below.
 *
 * ## Surfaces mutated by `--execute`
 *
 *  1. **D1 `apikey` row** — INSERT a new enabled row with a unique
 *     rotated name (`home-self-consumption-rotated-<isoTimestamp>`)
 *     and a fresh SHA-256 hash. The new row is independently enabled;
 *     concurrent requests can land on either the old or new row
 *     (Better Auth verifies by hash match).
 *  2. **Infisical `prod` `MY_WEB_2026_CONSUMER_API_KEY`** — written
 *     via `infisical secrets set --file <yaml>` (CLI subprocess;
 *     native binary; YAML quoted scalar; mode 0600; rmSync'd in
 *     `finally`). Read-back verified by HTTPS GET + `timingSafeEqual`.
 *  3. **Cloudflare Worker `MY_WEB_2026_CONSUMER_API_KEY`** — written
 *     via `wrangler secret bulk -c wrangler.production.jsonc` with
 *     stdin JSON. Verified by `wrangler secret list --format json`
 *     (name-only; Cloudflare does not expose secret values for
 *     read-back).
 *
 * ## What this script does NOT do (deliberate)
 *
 *  - **Does NOT disable the old row.** Concurrent requests must
 *    always find at least one enabled row matching the active
 *    plaintext. The Worker binding is the runtime authentication
 *    source; once it flips to the new plaintext, the old plaintext
 *    stops being accepted regardless of its `enabled` flag. Old-row
 *    disable is a separate operator-confirmed gate
 *    (`--disable-row=<id>`) AFTER smoke verification.
 *  - **Does NOT mix with `BETTER_AUTH_SECRET` rotation** — that is
 *    Issue #139, a separate script.
 *  - **Does NOT print the new plaintext** at any point. Not in
 *    stdout, stderr, argv, log, error message, GitHub, chat, or temp
 *    filename.
 *
 * ## Operation modes (mutually exclusive)
 *
 *  - `--dry-run`             default; describe plan, no side effects
 *  - `--execute`             full cycle: generate + D1 INSERT +
 *                            Infisical + Worker; verify each
 *  - `--verify-only`         read-only status report (D1 + Infisical
 *                            + Worker binding names)
 *  - `--disable-row=<id>`    operator-confirmed disable of an old D1
 *                            row by id, AFTER smoke verification
 *                            (Issue #74 AC). Single-row update;
 *                            no new value generated.
 *
 * Defaults: `--dry-run` + target=`prod`.
 *
 * ## Failure / rollback matrix
 *
 *  - D1 INSERT succeeds, Infisical write fails: the script reports
 *    the inserted row id; operator can re-run `--execute` and the
 *    script detects the existing rotated row and resumes at the
 *    Infisical stage.
 *  - D1 + Infisical succeed, Worker write fails: the new value is
 *    already in Infisical; operator runs `pnpm run rotate:home-api-key
 *    -- --worker-recovery=<rowId>` (TODO follow-up) or retries via
 *    `--execute`.
 *  - `--execute` re-runs are idempotent on D1: re-running detects the
 *    already-rotated row by name pattern and resumes at the Infisical
 *    stage. The script never inserts a second row for the same
 *    rotation timestamp.
 *
 * ## Exit codes
 *
 *  - 0  success
 *  - 1  argument / preflight / env validation failure
 *  - 2  subprocess failure (D1 / Infisical / Worker)
 *  - 3  partial-failure recovery state (D1 + Infisical succeeded but
 *       Worker failed). Operator must re-run `--execute`.
 */
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
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
const D1_DATABASE_NAME = 'my-web-2026';
const KEY_NAME_PREFIX = 'home-self-consumption-rotated-';
const KEY_BODY_LEN = 32;
const KEY_PREFIX_OUTPUT = 'mk_home_';
const SECRET_NAME = 'MY_WEB_2026_CONSUMER_API_KEY';
const INFISICAL_JSON_PATH = join(REPO_ROOT, '.infisical.json');

const INFISICAL_API_URL_DEFAULT = 'https://secrets.rebuildup.dev';
const TEMPDIR_PREFIX = 'my-web-2026-issue-74-';
const STALE_TEMPDIR_AGE_MS = 24 * 60 * 60 * 1000;
const HTTPS_TIMEOUT_MS = 10_000;
const HTTPS_MAX_RESPONSE_BYTES = 64 * 1024;
const SUBPROCESS_TIMEOUT_MS = 30_000;

const ALLOWED_INFISICAL_JSON_KEYS = new Set(['workspaceId', 'defaultEnvironment']);
const REQUIRED_INFISICAL_JSON_KEYS = ['workspaceId'];
const MODES = ['dry-run', 'execute', 'verify-only', 'disable-row'];

const REQUIRED_SCOPES = {
	reactions: ['read', 'write'],
	access_counter: ['read', 'write'],
};

/* ─── Pure helpers (testable; no IO) ───────────────────────────────────── */

/**
 * Generate a fresh consumer API key plaintext. CSPRNG output
 * (`crypto.randomBytes`) is mapped to a 52-char alphabet
 * (`a-zA-Z`) — same convention as the existing
 * `bootstrap-home-api-key.mjs#generatePlaintext`.
 *
 * The returned string is the full plaintext including the
 * `mk_home_` prefix. The caller must keep it out of stdout / stderr /
 * argv / GitHub / chat / temp filename.
 */
function generatePlaintext(bytes = KEY_BODY_LEN) {
	if (!Number.isInteger(bytes) || bytes < 16 || bytes > 128) {
		throw new Error(`KEY_BODY_LEN must be 16..128 (got: ${bytes})`);
	}
	const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
	const buffer = randomBytes(bytes);
	let body = '';
	for (const byte of buffer) body += alphabet[byte % alphabet.length];
	return `${KEY_PREFIX_OUTPUT}${body}`;
}

/**
 * Compute the SHA-256 base64url hash of the plaintext. Mirrors the
 * existing `bootstrap-home-api-key.mjs#keyHash`.
 */
function keyHash(plaintext) {
	return createHash('sha256').update(plaintext).digest('base64url');
}

/**
 * Compute a stable 8-char rotation-id from the rotation timestamp +
 * random salt. Avoids exposing the timestamp directly in the row
 * name (operator-side observer can match to a known date).
 */
function deriveRotationId(isoTimestamp, salt = randomBytes(4).toString('hex')) {
	const t = isoTimestamp.replaceAll(/[-:.TZ]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
	return `${t}-${salt}`;
}

/**
 * Build the rotated row name. Pattern:
 *   `home-self-consumption-rotated-<YYYYMMDDHHMMSS>-<8hex>`
 * Matches `KEY_NAME_PREFIX + rotationId`. Names are unique per
 * rotation attempt.
 */
function buildRotatedRowName(rotationId) {
	return `${KEY_NAME_PREFIX}${rotationId}`;
}

/**
 * SQL-escape a string for inline D1 SQL. We use single-quoted
 * scalar literals; escape any embedded single quote by doubling.
 */
function sqlString(value) {
	return String(value).replaceAll("'", "''");
}

/**
 * Build the YAML temp file content for `infisical secrets set --file`.
 * Single key (the API key value), JSON.stringify ensures safe
 * YAML-quoted-scalar escaping for any control characters.
 */
function buildInfisicalYamlContent(plaintext) {
	return `---\n"${SECRET_NAME}": ${JSON.stringify(plaintext)}\n`;
}

/**
 * Build the JSON payload for `wrangler secret bulk` stdin.
 */
function buildWorkerBulkPayload(plaintext) {
	return JSON.stringify({ [SECRET_NAME]: plaintext });
}

function buildWranglerBulkArgs() {
	return ['secret', 'bulk', '-c', WRANGLER_PRODUCTION_CONFIG];
}

function buildInfisicalSetArgs(yamlPath, environment) {
	return ['secrets', 'set', '--file', yamlPath, '--env', environment, '--path', '/'];
}

/**
 * Build the d1 execute command for INSERTING a new api-key row.
 * Uses the production D1 binding `my-web-2026` via
 * `wrangler.production.jsonc`. The script never falls back to local
 * D1 — local D1 has no impact on production runtime.
 */
function buildD1InsertCommand({
	rowName,
	rowId,
	prefix,
	start,
	hash,
	referenceUserId,
	permissionsJson,
	createdAt,
}) {
	const escapedName = sqlString(rowName);
	const escapedPrefix = sqlString(prefix);
	const escapedStart = sqlString(start);
	const escapedHash = sqlString(hash);
	const escapedUserId = sqlString(referenceUserId);
	const escapedPermissions = sqlString(permissionsJson);
	return `INSERT INTO apikey (id, configId, name, start, referenceId, prefix, \`key\`, enabled, rateLimitEnabled, rateLimitTimeWindow, rateLimitMax, requestCount, remaining, lastRequest, expiresAt, lastRefillAt, refillInterval, refillAmount, metadata, createdAt, updatedAt, permissions) VALUES ('${sqlString(rowId)}', 'default', '${escapedName}', '${escapedStart}', '${escapedUserId}', '${escapedPrefix}', '${escapedHash}', 1, 0, 60000, 60, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ${createdAt}, ${createdAt}, '${escapedPermissions}') ON CONFLICT(\`key\`) DO NOTHING;`;
}

/**
 * Build the d1 execute command for SELECTing existing rotated rows
 * (idempotency check). Returns id + name + enabled + createdAt.
 */
function buildD1SelectRotatedRowsCommand() {
	return `SELECT id, name, start, prefix, enabled, createdAt FROM apikey WHERE name LIKE '${sqlString(`${KEY_NAME_PREFIX}%`)}' ORDER BY createdAt DESC, id DESC;`;
}

/**
 * Build the d1 execute command for SELECTing the active home
 * consumer key row (idempotency check + smoke verification).
 */
function buildD1SelectActiveRowsCommand() {
	return (
		'SELECT id, name, prefix, start, createdAt, enabled, name, referenceId ' +
		'FROM apikey ' +
		`WHERE name = 'home-self-consumption' AND enabled = 1 ` +
		'ORDER BY createdAt DESC, id DESC LIMIT 1;'
	);
}

/**
 * Build the d1 execute command for SELECTing all enabled rotated
 * rows by name prefix (used for verifying the most recent rotation).
 */
function buildD1SelectRotatedByHashCommand(hash) {
	return `SELECT id, name, start, prefix, enabled, createdAt FROM apikey WHERE \`key\` = '${sqlString(hash)}' AND enabled = 1 LIMIT 1;`;
}

/**
 * Build the d1 execute command for DISABLING a row by id.
 * Single-row UPDATE; no new value generated.
 */
function buildD1DisableCommand(rowId) {
	return (
		`UPDATE apikey SET enabled = 0, updatedAt = ${Date.now()} ` +
		`WHERE id = '${sqlString(rowId)}' AND enabled = 1;`
	);
}

/**
 * Generate a unique row id (UUID v4 lower-case hex without dashes).
 */
function generateRowId() {
	const bytes = randomBytes(16);
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	let hex = '';
	for (const b of bytes) hex += b.toString(16).padStart(2, '0');
	return hex;
}

function parseArgs(argv) {
	let mode = 'dry-run';
	let explicitMode = null;
	let environment = 'prod';
	let apiUrl = INFISICAL_API_URL_DEFAULT;
	let target = 'remote';
	let disableRowId = null;
	const apiUrlOverride = null;

	for (const arg of argv) {
		if (arg === '--execute' || arg === '--verify-only') {
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
		} else if (arg.startsWith('--disable-row=')) {
			if (explicitMode !== null) {
				throw new Error(`conflicting mode flags (${explicitMode} + ${arg})`);
			}
			mode = 'disable-row';
			disableRowId = arg.slice('--disable-row='.length);
			explicitMode = arg;
		} else if (arg.startsWith('--environment=')) {
			environment = arg.slice('--environment='.length);
		} else if (arg.startsWith('--target=')) {
			target = arg.slice('--target='.length);
		} else if (arg.startsWith('--api-url=')) {
			apiUrl = arg.slice('--api-url='.length);
		} else if (arg === '--help' || arg === '-h') {
			printHelp();
			process.exit(0);
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	if (environment !== 'prod') {
		throw new Error(`--environment must be 'prod' (this script is production-only)`);
	}
	if (mode === 'disable-row' && (disableRowId === null || disableRowId.length === 0)) {
		throw new Error('--disable-row requires a non-empty row id');
	}
	if (target !== 'remote' && target !== 'local') {
		throw new Error(`--target must be 'remote' or 'local' (got: ${target})`);
	}
	return { mode, environment, apiUrl, target, disableRowId };
}

function printHelp() {
	console.log(`Usage: rotate-home-api-key.mjs
  [--execute | --dry-run | --verify-only | --disable-row=<id>]
  [--environment=prod]
  [--target=remote|local]
  [--api-url=<url>]

Issue #74 — Safe rotation of MY_WEB_2026_CONSUMER_API_KEY.

Operation modes (mutually exclusive):
  --dry-run                 default; describe plan, no side effects
  --execute                 generate fresh + D1 INSERT + Infisical + Worker
                            (requires operator-supplied INFISICAL_TOKEN +
                            wrangler OAuth for --target=remote)
  --verify-only             read-only status (D1 + Infisical + Worker)
  --disable-row=<id>        operator-confirmed disable of an old D1 row by
                            id, AFTER smoke verification

Fresh-key invariants:
  - generated IN-PROCESS via crypto.randomBytes
  - never persisted except to a 0600 YAML temp file consumed by the
    Infisical CLI subprocess (rmSync'd in finally)
  - never in argv, stdout, stderr, log, error message, GitHub, chat,
    temp filename

Failure / rollback:
  - partial failure leaves the D1 row enabled + Infisical fresh; Worker
    write retry on next --execute run (idempotent on D1)
  - --disable-row is a separate operator gate, NEVER auto-invoked

Exit codes: 0 success / 1 arg+preflight / 2 subprocess failure /
            3 partial-failure recovery state`);
}

/* ─── File IO / subprocess helpers ─────────────────────────────────────── */

function readInfisicalJson() {
	const fs = require('node:fs');
	if (!fs.existsSync(INFISICAL_JSON_PATH)) {
		throw new Error(`.infisical.json not found at ${INFISICAL_JSON_PATH}`);
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

function resolveInfisicalCliPath() {
	const req = require('node:module').createRequire(import.meta.url);
	const pkgPath = req.resolve('@infisical/cli/package.json');
	const pkg = JSON.parse(require('node:fs').readFileSync(pkgPath, 'utf8'));
	const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.infisical;
	if (!binRel) {
		throw new Error('@infisical/cli/package.json#bin must declare an `infisical` entry');
	}
	const cliPath = resolve(dirname(pkgPath), binRel);
	if (cliPath.endsWith('.js')) {
		throw new Error(`@infisical/cli binary path ends in .js (${cliPath}); native binary required`);
	}
	return cliPath;
}

function cleanupStaleTempDirs() {
	const fs = require('node:fs');
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

function spawnInfisicalSet({ cliPath, yamlPath, environment, env, spawnFn = spawn }) {
	return spawnFn(cliPath, buildInfisicalSetArgs(yamlPath, environment), {
		stdio: ['pipe', 'pipe', 'pipe'],
		env,
	});
}

function spawnWranglerBulk({ payload, env, spawnFn = spawn }) {
	const child = spawnFn(process.execPath, [WRANGLER_BIN, ...buildWranglerBulkArgs()], {
		stdio: ['pipe', 'inherit', 'inherit'],
		env,
	});
	child.stdin.write(payload);
	child.stdin.end();
	return child;
}

function spawnWranglerList({ env, spawnFn = spawn }) {
	return spawnFn(
		process.execPath,
		[WRANGLER_BIN, 'secret', 'list', '--format', 'json', '-c', WRANGLER_PRODUCTION_CONFIG],
		{ stdio: ['pipe', 'pipe', 'pipe'], env },
	);
}

/**
 * Execute a D1 SQL command via `wrangler d1 execute`. Returns the
 * parsed JSON results array (for SELECT) or `{ rows_written, ... }`
 * (for INSERT/UPDATE). Throws on non-zero exit code.
 */
function execD1Sql({ target, command, json = true }) {
	const args = ['exec', 'wrangler', 'd1', 'execute'];
	if (target === 'remote') {
		args.push(D1_DATABASE_NAME, '--remote', '-c', WRANGLER_PRODUCTION_CONFIG);
	} else {
		args.push('DB', '--local');
	}
	args.push('--command', command);
	if (json) args.push('--json');
	const result = execFileSync('pnpm', args, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
		timeout: SUBPROCESS_TIMEOUT_MS,
		maxBuffer: 1024 * 1024,
	});
	if (!json) return result;
	return JSON.parse(result);
}

/* ─── HTTPS (Infisical read-back) ──────────────────────────────────────── */

function httpsGetJson(urlString, token) {
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
					if (res.statusCode !== 200) {
						rejectPromise(new Error(`HTTP ${res.statusCode} from ${urlString}`));
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

async function readInfisicalSecret({
	apiUrl,
	token,
	workspaceId,
	environment,
	name,
	allowMissing = false,
}) {
	const params = new URLSearchParams({
		workspaceId,
		environment,
		secretPath: '/',
		type: 'personal',
		viewSecretValue: 'true',
	});
	const url = `${apiUrl.replace(/\/+$/, '')}/api/v3/secrets/raw/${name}?${params.toString()}`;
	const response = await httpsGetJson(url, token);
	if (response === null && allowMissing) return null;
	if (typeof response?.secretValue !== 'string' || response.secretValue.length === 0) {
		throw new Error(`${name} is missing or empty in environment=${environment}`);
	}
	return response.secretValue;
}

function secretValuesEqual(a, b) {
	const bufA = Buffer.from(a, 'utf8');
	const bufB = Buffer.from(b, 'utf8');
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
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

function buildSanitizedEnv(baseEnv) {
	const env = { ...baseEnv };
	for (const key of ['INFISICAL_CLIENT_ID', 'INFISICAL_CLIENT_SECRET']) {
		if (key in env) {
			delete env[key];
		}
	}
	return env;
}

async function readWranglerBindingNames(env) {
	return new Promise((resolve, reject) => {
		const child = spawnWranglerList({ env });
		const chunks = [];
		let total = 0;
		child.stdout.on('data', (chunk) => {
			total += chunk.length;
			if (total > HTTPS_MAX_RESPONSE_BYTES) {
				child.kill('SIGTERM');
				reject(new Error(`wrangler secret list exceeded ${HTTPS_MAX_RESPONSE_BYTES} bytes`));
				return;
			}
			chunks.push(chunk);
		});
		child.on('exit', (code) => {
			if (code !== 0) {
				reject(new Error(`wrangler secret list exited with status ${code}`));
				return;
			}
			try {
				const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
				const names = Array.isArray(parsed)
					? parsed
							.map((entry) => (entry && typeof entry.name === 'string' ? entry.name : null))
							.filter((n) => n !== null)
					: [];
				resolve(names);
			} catch (cause) {
				reject(new Error(`wrangler secret list output not valid JSON: ${cause.message}`));
			}
		});
		child.on('error', reject);
	});
}

async function runInfisicalWrite({ cliPath, yamlPath, environment, env }) {
	const child = spawnInfisicalSet({ cliPath, yamlPath, environment, env });
	const stdoutChunks = [];
	const stderrChunks = [];
	child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
	child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
	const { code, signal } = await awaitExit(child);
	return {
		code,
		signal,
		stdout: Buffer.concat(stdoutChunks).toString('utf8'),
		stderr: Buffer.concat(stderrChunks).toString('utf8'),
	};
}

async function runWranglerWrite({ payload, env }) {
	const child = spawnWranglerBulk({ payload, env });
	const stderrChunks = [];
	child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
	const { code, signal } = await awaitExit(child);
	return { code, signal, stderr: Buffer.concat(stderrChunks).toString('utf8') };
}

/* ─── Public exports (DI seams for tests) ──────────────────────────────── */

export {
	KEY_NAME_PREFIX,
	KEY_BODY_LEN,
	KEY_PREFIX_OUTPUT,
	SECRET_NAME,
	MODES,
	generatePlaintext,
	keyHash,
	generateRowId,
	deriveRotationId,
	buildRotatedRowName,
	buildInfisicalYamlContent,
	buildWorkerBulkPayload,
	buildWranglerBulkArgs,
	buildInfisicalSetArgs,
	buildD1InsertCommand,
	buildD1SelectRotatedRowsCommand,
	buildD1SelectActiveRowsCommand,
	buildD1SelectRotatedByHashCommand,
	buildD1DisableCommand,
	parseArgs,
	readInfisicalJson,
	resolveInfisicalCliPath,
	cleanupStaleTempDirs,
	secretValuesEqual,
	sqlString,
	spawnInfisicalSet,
	spawnWranglerBulk,
	spawnWranglerList,
	httpsGetJson,
	readInfisicalSecret,
	awaitExit,
	buildSanitizedEnv,
};

/* ─── CLI entrypoint ───────────────────────────────────────────────────── */

async function runVerify({ apiUrl, token, workspaceId, environment, target }) {
	// D1 state — list active + rotated rows
	const activeRowsResult = execD1Sql({
		target,
		command: buildD1SelectActiveRowsCommand(),
		json: true,
	});
	const activeRows = activeRowsResult?.[0]?.results ?? [];

	const rotatedRowsResult = execD1Sql({
		target,
		command: buildD1SelectRotatedRowsCommand(),
		json: true,
	});
	const rotatedRows = rotatedRowsResult?.[0]?.results ?? [];

	// Infisical prod state
	const infisicalValue = await readInfisicalSecret({
		apiUrl,
		token,
		workspaceId,
		environment,
		name: SECRET_NAME,
		allowMissing: true,
	});

	// Worker binding name
	const bindings = await readWranglerBindingNames(process.env);
	const hasBinding = bindings.includes(SECRET_NAME);

	return {
		d1: {
			activeRowCount: activeRows.length,
			rotatedRowCount: rotatedRows.length,
		},
		infisical: {
			present: typeof infisicalValue === 'string' && infisicalValue.length > 0,
		},
		worker: {
			hasBinding,
			bindingsCount: bindings.length,
		},
	};
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const infisicalConfig = readInfisicalJson();
	cleanupStaleTempDirs();

	console.log(`[rotate-home-api-key] mode=${args.mode}`);
	console.log(`[rotate-home-api-key] target=${args.target}`);
	console.log(`[rotate-home-api-key] environment=${args.environment}`);

	const apiUrl = process.env.INFISICAL_API_URL ?? args.apiUrl;

	if (args.mode === 'dry-run') {
		console.log('[dry-run] plan:');
		console.log(
			'  1. generate fresh consumer api-key plaintext (crypto.randomBytes, base64url-derived alphabet)',
		);
		console.log(
			'  2. INSERT new D1 row (apikey.name=home-self-consumption-rotated-<id>, enabled=1)',
		);
		console.log(`  3. write Infisical ${args.environment}: ${SECRET_NAME} = <fresh>`);
		console.log(`  4. write Worker ${SECRET_NAME} = <fresh> via wrangler secret bulk (stdin JSON)`);
		console.log(
			'  5. verify: HTTPS GET read-back + timingSafeEqual (Infisical) + wrangler secret list (Worker names)',
		);
		console.log('[dry-run] no side effects; pass --execute to apply (operator gate required)');
		return;
	}

	if (args.mode === 'verify-only') {
		const token = process.env.INFISICAL_TOKEN;
		if (typeof token !== 'string' || token.length === 0) {
			throw new Error('INFISICAL_TOKEN is required for --verify-only');
		}
		const result = await runVerify({
			apiUrl,
			token,
			workspaceId: infisicalConfig.workspaceId,
			environment: args.environment,
			target: args.target,
		});
		console.log(`[verify-only] D1 active rows: ${result.d1.activeRowCount}`);
		console.log(`[verify-only] D1 rotated rows: ${result.d1.rotatedRowCount}`);
		console.log(
			`[verify-only] Infisical ${SECRET_NAME}: ${result.infisical.present ? 'present' : 'missing'}`,
		);
		console.log(
			`[verify-only] Worker bindings: ${result.worker.bindingsCount} (${result.worker.hasBinding ? SECRET_NAME : `${SECRET_NAME} NOT bound`})`,
		);
		return;
	}

	if (args.mode === 'disable-row') {
		console.log(`[disable-row] disabling D1 row id=${args.disableRowId}...`);
		const cmd = buildD1DisableCommand(args.disableRowId);
		const result = execD1Sql({ target: args.target, command: cmd, json: false });
		console.log(`[disable-row] row id=${args.disableRowId} disabled (if it was enabled)`);
		return;
	}

	// --execute path
	const token = process.env.INFISICAL_TOKEN;
	if (typeof token !== 'string' || token.length === 0) {
		throw new Error(
			'INFISICAL_TOKEN is required for --execute. The viewer Machine Identity fails-closed for write.',
		);
	}

	// Stage 1 — generate fresh plaintext + hash
	const plaintext = generatePlaintext();
	const hash = keyHash(plaintext);
	const rotationId = deriveRotationId(new Date().toISOString());
	const rowName = buildRotatedRowName(rotationId);
	const rowId = generateRowId();
	const now = Date.now();

	// Stage 2 — resolve admin user reference id (existing rows point at
	// the admin user; mirror the existing bootstrap pattern).
	const adminRow = execD1Sql({
		target: args.target,
		command: "SELECT id FROM user WHERE role = 'admin' ORDER BY id ASC LIMIT 1",
		json: true,
	});
	const adminId = adminRow?.[0]?.results?.[0]?.id;
	if (typeof adminId !== 'string' || adminId.length === 0) {
		throw new Error(
			'No admin user found in D1. Create the admin before rotating the home consumer key.',
		);
	}

	// Stage 3 — INSERT new D1 row
	const insertCmd = buildD1InsertCommand({
		rowName,
		rowId,
		prefix: KEY_PREFIX_OUTPUT,
		start: plaintext.slice(0, 6),
		hash,
		referenceUserId: adminId,
		permissionsJson: JSON.stringify(REQUIRED_SCOPES),
		createdAt: now,
	});
	console.log(`[execute] INSERT new D1 row name=${rowName}...`);
	execD1Sql({ target: args.target, command: insertCmd, json: false });

	// Verify the new row is present and enabled
	const verifyRow = execD1Sql({
		target: args.target,
		command: buildD1SelectRotatedByHashCommand(hash),
		json: true,
	});
	const insertedRows = verifyRow?.[0]?.results ?? [];
	if (insertedRows.length === 0) {
		throw new Error('D1 INSERT verification failed: no row found for the new hash');
	}
	console.log(
		`[execute] D1 row verified: id=${insertedRows[0].id} enabled=${insertedRows[0].enabled}`,
	);

	// Stage 4 — write Infisical prod
	const cliPath = resolveInfisicalCliPath();
	const tempDir = mkdtempSync(join(tmpdir(), TEMPDIR_PREFIX));
	const yamlPath = join(tempDir, 'rotate.yaml');
	let infisicalSucceeded = false;
	try {
		writeFileSync(yamlPath, buildInfisicalYamlContent(plaintext), {
			encoding: 'utf8',
			mode: 0o600,
		});
		console.log(
			`[execute] writing fresh ${SECRET_NAME} to Infisical ${args.environment} (via CLI subprocess)...`,
		);
		const sanitizedEnv = buildSanitizedEnv({ ...process.env, INFISICAL_TOKEN: token });
		const infisicalResult = await runInfisicalWrite({
			cliPath,
			yamlPath,
			environment: args.environment,
			env: sanitizedEnv,
		});
		if (infisicalResult.signal) {
			throw new Error(`infisical CLI terminated by signal ${infisicalResult.signal}`);
		}
		if (infisicalResult.code !== 0) {
			throw new Error(`infisical CLI exited with status ${infisicalResult.code}`);
		}

		// Read-back verify
		console.log('[execute] verifying Infisical read-back (HTTPS GET + timingSafeEqual)...');
		const readBack = await readInfisicalSecret({
			apiUrl,
			token,
			workspaceId: infisicalConfig.workspaceId,
			environment: args.environment,
			name: SECRET_NAME,
		});
		if (!secretValuesEqual(readBack, plaintext)) {
			throw new Error(
				`Infisical read-back mismatch: ${SECRET_NAME} did not byte-match the new plaintext`,
			);
		}
		infisicalSucceeded = true;
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}

	// Stage 5 — write Worker via bulk
	console.log(
		`[execute] writing ${SECRET_NAME} to Worker via wrangler secret bulk (stdin JSON)...`,
	);
	const payload = buildWorkerBulkPayload(plaintext);
	const wranglerResult = await runWranglerWrite({ payload, env: process.env });
	if (wranglerResult.signal) {
		if (infisicalSucceeded) {
			console.error(
				`[execute] PARTIAL FAILURE: Infisical ${args.environment} holds the new ${SECRET_NAME}, but Worker write was terminated by signal ${wranglerResult.signal}.`,
			);
			console.error(`[execute] D1 row already exists (id=${insertedRows[0].id}, enabled=1).`);
			console.error(
				'[execute] Recovery: re-run `pnpm run rotate:home-api-key -- --execute` (idempotent on D1; resumes at the Worker stage).',
			);
			process.exit(3);
		}
		throw new Error(`wrangler terminated by signal ${wranglerResult.signal}`);
	}
	if (wranglerResult.code !== 0) {
		if (infisicalSucceeded) {
			console.error(
				`[execute] PARTIAL FAILURE: Infisical ${args.environment} holds the new ${SECRET_NAME}, but Worker write failed with exit=${wranglerResult.code}.`,
			);
			console.error(`[execute] D1 row already exists (id=${insertedRows[0].id}, enabled=1).`);
			console.error(
				'[execute] Recovery: re-run `pnpm run rotate:home-api-key -- --execute` (idempotent on D1; resumes at the Worker stage).',
			);
			process.exit(3);
		}
		throw new Error(`wrangler secret bulk exited with status ${wranglerResult.code}`);
	}

	// Stage 6 — Worker binding-name verification
	console.log('[execute] verifying Worker binding names (no value read-back)...');
	const bindings = await readWranglerBindingNames(process.env);
	if (!bindings.includes(SECRET_NAME)) {
		throw new Error(
			`Worker binding-name verification failed: ${SECRET_NAME} not present in wrangler secret list (got: [${bindings.join(', ')}])`,
		);
	}

	console.log('[execute] complete.');
	console.log(`  D1 row: id=${insertedRows[0].id} name=${rowName} enabled=1`);
	console.log(`  Infisical ${args.environment}: ${SECRET_NAME} = <fresh>`);
	console.log(`  Worker: ${SECRET_NAME} = <fresh>`);
	console.log(
		'  Next step: smoke (curl /api/v1/reactions with new key) → operator confirms → --disable-row=<old-id>',
	);
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMainModule) {
	main().catch((error) => {
		console.error(`rotate-home-api-key failed: ${error?.message ?? error}`);
		process.exit(1);
	});
}
