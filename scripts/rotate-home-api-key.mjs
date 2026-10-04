#!/usr/bin/env node
/**
 * Issue #74 — Safe rotation of `MY_WEB_2026_CONSUMER_API_KEY`.
 *
 * ## Security context (Issue #139 canonical incident, 2026-09-28)
 *
 * During a read-only Infisical preflight for Issue #122, a real-value
 * `infisical secrets` invocation leaked four plaintext secret values
 * into agent output. One of them — `MY_WEB_2026_CONSUMER_API_KEY` —
 * was exposed. The original Issue #74 spec proposed a "plaintext は
 * 1 回のみ出力" design that surfaced the new value to the operator
 * once and required the operator to register it manually. **That
 * design is rejected** for this implementation: the 2026-09-28
 * incident demonstrated that agent- or operator-visible plaintext is
 * a credential disclosure surface, regardless of "only once" framing.
 *
 * This script completes **generation → propagation → verification**
 * entirely IN-PROCESS, so the new plaintext is never displayed,
 * logged, passed via argv, written to a chat transcript, or
 * otherwise surfaced. The only persistent artefacts are:
 *   - the SHA-256 hash in the D1 `apikey.key` column (the plaintext
 *     is NOT stored in D1 by Better Auth's contract);
 *   - the new value inside Infisical `prod` and the Cloudflare Worker
 *     binding, written via the dedicated secure channels below.
 *
 * ## Architectural correction (PR #141 review, 2026-09-28)
 *
 * The initial draft framed old-D1-row disable as **audit-trail
 * cleanup** — a separate gate after smoke confirmation. That framing
 * was wrong: external `/api/v1/*` requests authenticate against the
 * Better Auth `auth.api.verifyApiKey(...)` middleware, which verifies
 * the request plaintext against the D1 `apikey.key` hash directly
 * (`src/http/api-keys/middleware.ts:17`). The Worker
 * `MY_WEB_2026_CONSUMER_API_KEY` binding is the **internal
 * self-consumption key** (the loaders in `src/home/{access,reactions}/load.ts`
 * pass it as their own authorization header when the home surfaces
 * call `/api/v1/*`). It is NOT the external-auth source-of-truth.
 *
 * Consequence: a leaked plaintext that hashes to an **enabled** D1
 * row is still accepted by external API endpoints, regardless of the
 * Worker binding value. Disabling the old D1 row is therefore
 * **containment**, not audit hygiene. It MUST happen before the
 * rotation is declared complete; the Worker binding change is
 * internal self-consumption visibility, not a security boundary.
 *
 * ## Surfaces mutated by `--execute`
 *
 *  1. **D1 `apikey`** — two-phase D1 mutation with a documented
 *     short dual-valid window between insert-new and disable-old:
 *     - **Phase 1 (insert + verify).** INSERT a new enabled row
 *       under `home-self-consumption-rotated-<YYYYMMDDHHMMSS>-<8hex>`
 *       with a fresh SHA-256 hash. Idempotent on hash
 *       (`ON CONFLICT(\`key\`) DO NOTHING`). Post-insert SELECT
 *       verifies the row is enabled.
 *     - **In-process smoke** confirms the fresh plaintext actually
 *       authenticates against the new row (must succeed before
 *       disable-old; otherwise the smoke URL is broken).
 *     - **Phase 2 (disable-old + verify).** UPDATE the existing
 *       `home-self-consumption` row to `enabled=0` (containment —
 *       leaked plaintext no longer authenticates against
 *       `auth.api.verifyApiKey`). Post-disable SELECT verifies the
 *       old row is gone.
 *     The dual-valid window between Phase 1 and Phase 2 is bounded
 *     by the time taken for the in-process smoke (~1s). Old row
 *     disable is the SECOND step, not the first, so a fresh-row
 *     INSERT failure cannot produce a zero-valid-key state.
 *  2. **In-process smoke** — `fetch` against the canonical
 *     `/api/v1/access/count/home-page` (a `requireApiKey`-gated,
 *     read-only surface the home consumer key can reach) with
 *     `Authorization: Bearer <fresh>`, expecting 2xx. The plaintext
 *     NEVER leaves the process. There is no `--smoke-url` flag —
 *     sending `Authorization: Bearer <fresh>` to an arbitrary URL
 *     would exfiltrate the new credential (PR #141 re-review,
 *     2026-09-28).
 *  3. **Infisical `prod` `MY_WEB_2026_CONSUMER_API_KEY`** — persisted and verified BEFORE old-row disable so the fresh plaintext has a recoverable SoT. — written
 *     via `infisical secrets set --file <yaml>` (CLI subprocess;
 *     native binary; YAML quoted scalar; mode 0600; rmSync'd in
 *     `finally`). Read-back verified by HTTPS GET + `timingSafeEqual`.
 *     Placed BEFORE the Worker write so `--worker-recovery` can read
 *     the fresh value from Infisical on a Worker-write failure.
 *  4. **Cloudflare Worker `MY_WEB_2026_CONSUMER_API_KEY`** — written
 *     via `wrangler secret bulk -c wrangler.production.jsonc` with
 *     stdin JSON. Verified by `wrangler secret list --format json`
 *     (name-only; Cloudflare does not expose secret values).
 *
 * ## Subprocess env isolation
 *
 * Two distinct env builders; mixing them was the PR #141 re-review
 * blocker (2026-09-28):
 *
 *  - `buildInfisicalEnv(baseEnv, token)` — for the Infisical CLI
 *    subprocess. Keeps the writer-scoped `INFISICAL_TOKEN`
 *    (the producer of the value), strips machine-identity /
 *    project / site / api-url credentials.
 *  - `buildWranglerEnv(baseEnv)` — for Wrangler (`secret bulk`,
 *    `secret list`) and D1 (`wrangler d1 execute`) subprocesses.
 *    Strips the full Infisical credential set (token +
 *    machine identity + project/site/api). Wrangler/D1 MUST NOT
 *    receive the writer-scoped Infisical token.
 *
 * ## What this script does NOT do (deliberate)
 *
 *  - **Does NOT print the new plaintext** at any point. Not in
 *    stdout, stderr, argv, log, error message, GitHub, chat, temp
 *    filename, or operator-visible output. Smoke is in-process.
 *  - **Does NOT pass `INFISICAL_TOKEN` (or other Infisical
 *    credentials) to Wrangler/D1 subprocesses.** All non-Infisical
 *    children receive `buildWranglerEnv(process.env)` so the
 *    writer-scoped token does not leak into Cloudflare / D1
 *    subprocess environments (PR #141 re-review fix, 2026-09-28).
 *  - **Does NOT allow an arbitrary `--smoke-url`.** The smoke
 *    endpoint is fixed at the canonical protected surface; an
 *    operator-supplied URL would be a credential-exfiltration
 *    surface.
 *  - **Does NOT start a new rotation if an enabled rotated row
 *    already exists.** Operator must run `--worker-recovery=<id>`
 *    to complete a partial rotation, or `--disable-row=<id>` to
 *    clean up before re-running. This keeps `--execute` strictly
 *    idempotent.
 *  - **Does NOT mix with `BETTER_AUTH_SECRET` rotation** — that is
 *    Issue #139, a separate script.
 *
 * ## Operation modes (mutually exclusive)
 *
 *  - `--dry-run`                    default; describe plan, no side effects
 *  - `--execute`                    full cycle: D1 insert-new+verify
 *                                   → in-process smoke → D1 disable-old
 *                                   +verify → Infisical → Worker →
 *                                   binding-name verify. Refuses if a
 *                                   rotated row already exists (use
 *                                   --worker-recovery or --disable-row
 *                                   first).
 *  - `--verify-only`                read-only status report (D1 +
 *                                   Infisical + Worker binding names)
 *  - `--disable-row=<id>`           operator-confirmed disable of a
 *                                   single D1 row by id. Used to
 *                                   discard a half-completed rotation.
 *                                   Idempotent (`WHERE enabled = 1`
 *                                   guard).
 *  - `--worker-recovery=<rowId>`    partial-failure recovery for the
 *                                   Worker write stage. Reads the fresh
 *                                   plaintext from Infisical prod,
 *                                   writes it to the Worker via
 *                                   `wrangler secret bulk`, verifies
 *                                   binding name. NO new plaintext
 *                                   generated; no D1 mutation. Valid
 *                                   only AFTER the Infisical write has
 *                                   succeeded (otherwise there is no
 *                                   fresh value to recover from).
 *
 * Defaults: `--dry-run` + target=`remote` + environment=`prod`.
 *
 * ## Failure / rollback matrix
 *
 *  - **D1 insert-new fails** (e.g. admin lookup returns empty):
 *    old row stays enabled, new row never written. No rotation
 *    state. Operator fixes the precondition and re-runs `--execute`.
 *  - **D1 insert-new + verify succeed, smoke fails**: the fresh row
 *    is enabled but the smoke URL did not authenticate the fresh
 *    plaintext. The script aborts BEFORE disable-old (so the old
 *    row remains valid) and BEFORE Infisical/Worker writes (so no
 *    propagation). Operator MUST run `--disable-row=<rowId>` to
 *    discard the fresh row before re-running `--execute`.
 *  - **D1 insert+verify+smoke succeed, disable-old fails**: a
 *    brief dual-valid window (both old and new rows enabled). The
 *    script aborts and the operator MUST investigate the disable
 *    failure. `--disable-row=<oldRowId>` is the recovery path.
 *  - **D1 phases complete, Infisical write fails**: containment is
 *    in place (old row disabled, new row enabled). Operator MUST
 *    run `--worker-recovery=<rowId>` (which reads the fresh value
 *    from Infisical — but this fails if Infisical write itself
 *    failed; in that case the recovery path is `--disable-row=<rowId>`
 *    + re-run `--execute`).
 *  - **D1 + smoke + disable-old + Infisical succeed, Worker write
 *    fails**: exit 3 with the recovery instruction. Operator runs
 *    `--worker-recovery=<rowId>` (this is the explicit recovery mode).
 *  - **`--execute` re-run after a partial rotation**: refused.
 *    Operator MUST resolve the partial state via `--worker-recovery`
 *    or `--disable-row`. This is structural: re-running with a fresh
 *    plaintext would generate a new D1 row and overwrite Infisical,
 *    which is the partial-failure bug the PR #141 review fixed.
 *
 * ## Exit codes
 *
 *  - 0  success
 *  - 1  argument / preflight / env validation failure
 *  - 2  subprocess failure (D1 / Infisical / Worker / smoke)
 *  - 3  partial-failure recovery state (D1 + smoke + Infisical
 *       succeeded but Worker failed). Operator MUST run
 *       `--worker-recovery=<rowId>` to complete.
 */
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { queryRows } from './_d1.mjs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
import {
	AUTH_MODE,
	buildInfisicalEnv as buildInfisicalEnvShared,
	buildWranglerEnv as buildWranglerEnvShared,
	compareSecretViaAuth,
	materialiseSecret,
	resolveInfisicalAuth,
	secretPresenceViaAuth,
} from './_infisical-auth.mjs';

const REPO_ROOT = resolve(HERE, '..');
const WRANGLER_BIN = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
const WRANGLER_PRODUCTION_CONFIG = join(REPO_ROOT, 'wrangler.production.jsonc');
const D1_DATABASE_NAME = 'my-web-2026';
const KEY_NAME_PREFIX = 'home-self-consumption-rotated-';
const KEY_NAME_LEGACY = 'home-self-consumption';
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

// Defaults for the in-process smoke. The smoke endpoint MUST be a
// real API-key-protected, read-only surface so a 2xx response proves
// the fresh plaintext authenticates AND carries the required scope.
// `GET /api/v1/access/count/:key` is gated by `requireApiKey` +
// `requireResourceAction(c, 'access_counter', 'read')` and the home
// consumer key carries that scope (per
// `src/http/api-keys/middleware.test.ts`). The `home-page` counter
// key is one of the canonical surfaces (see
// `src/home/access/load.ts`). The URL is FIXED — there is no
// `--smoke-url` override, because supplying `Authorization: Bearer
// <fresh>` to an arbitrary host would exfiltrate the new credential
// (PR #141 re-review, 2026-09-28).
const SMOKE_URL_DEFAULT = 'https://rebuildup.dev/api/v1/access/count/home-page';
const SMOKE_AUTH_HEADER = 'Authorization';
const SMOKE_AUTH_SCHEME = 'Bearer';
const SMOKE_MIN_STATUS = 200;
const SMOKE_MAX_STATUS = 299;

const ALLOWED_INFISICAL_JSON_KEYS = new Set(['workspaceId', 'defaultEnvironment']);
const REQUIRED_INFISICAL_JSON_KEYS = ['workspaceId'];
const MODES = ['dry-run', 'execute', 'verify-only', 'disable-row', 'worker-recovery'];

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
 * Build the d1 execute command for SELECTing any *enabled* rotated
 * row (the in-flight marker). Used by --execute to refuse starting a
 * new rotation while one is in flight, and by --worker-recovery to
 * identify the recovery target.
 */
function buildD1SelectActiveRotatedRowCommand() {
	return `SELECT id, name, start, prefix, enabled, createdAt FROM apikey WHERE name LIKE '${sqlString(`${KEY_NAME_PREFIX}%`)}' AND enabled = 1 ORDER BY createdAt DESC, id DESC LIMIT 1;`;
}

/**
 * Build the d1 execute command for SELECTing the old home row by its
 * legacy name. Used by --execute to locate the row to disable as
 * containment before inserting the new rotated row.
 */
function buildD1SelectOldHomeRowCommand() {
	return (
		'SELECT id, name, prefix, start, enabled, createdAt ' +
		'FROM apikey ' +
		`WHERE name = 'home-self-consumption' AND enabled = 1 ` +
		'ORDER BY createdAt DESC, id DESC LIMIT 1;'
	);
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
	let workerRecoveryRowId = null;

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
		} else if (arg.startsWith('--worker-recovery=')) {
			if (explicitMode !== null) {
				throw new Error(`conflicting mode flags (${explicitMode} + ${arg})`);
			}
			mode = 'worker-recovery';
			workerRecoveryRowId = arg.slice('--worker-recovery='.length);
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
	if (
		mode === 'worker-recovery' &&
		(workerRecoveryRowId === null || workerRecoveryRowId.length === 0)
	) {
		throw new Error('--worker-recovery requires a non-empty row id');
	}
	if (target !== 'remote' && target !== 'local') {
		throw new Error(`--target must be 'remote' or 'local' (got: ${target})`);
	}
	return {
		mode,
		environment,
		apiUrl,
		target,
		disableRowId,
		workerRecoveryRowId,
	};
}

function printHelp() {
	console.log(`Usage: rotate-home-api-key.mjs
  [--execute | --dry-run | --verify-only | --disable-row=<id> | --worker-recovery=<id>]
  [--environment=prod]
  [--target=remote|local]
  [--api-url=<url>]

Issue #74 — Safe rotation of MY_WEB_2026_CONSUMER_API_KEY.

Operation modes (mutually exclusive):
  --dry-run                 default; describe plan, no side effects
  --execute                 full cycle: D1 insert-new+verify + in-process
                            smoke + Infisical persist + disable-old + Worker. Refuses if a
                            rotated row already exists.
  --verify-only             read-only status (D1 + Infisical + Worker)
  --disable-row=<id>        operator-confirmed disable of a D1 row by id.
                            Idempotent (WHERE enabled = 1 guard).
  --worker-recovery=<id>    partial-failure recovery for the Worker write
                            stage. Reads the fresh plaintext from Infisical
                            prod, writes it to the Worker, verifies
                            binding name. NO new plaintext generated; no
                            D1 mutation.

Fresh-key invariants:
  - generated IN-PROCESS via crypto.randomBytes
  - never persisted except to a 0600 YAML temp file consumed by the
    Infisical CLI subprocess (rmSync'd in finally)
  - never in argv, stdout, stderr, log, error message, GitHub, chat,
    temp filename, or operator-visible output. Smoke is in-process.

Failure / rollback:
  - --execute refuses to start a new rotation while one is in flight
    (use --worker-recovery or --disable-row to resolve)
  - Worker-write failure after Infisical succeeded -> exit 3 with
    explicit recovery command

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

function spawnInfisicalSet({ cliPath, yamlPath, environment, workspaceId, env, spawnFn = spawn }) {
	return spawnFn(cliPath, buildInfisicalSetArgs(yamlPath, environment, workspaceId), {
		stdio: ['pipe', 'pipe', 'pipe'],
		env,
	});
}

function spawnWranglerBulk({ payload, env, spawnFn = spawn }) {
	const child = spawnFn(process.execPath, [WRANGLER_BIN, ...buildWranglerBulkArgs()], {
		// Issue #225: `runWranglerWrite` captures stdout/stderr, which
		// Node sets to null for an inherited stream. Piping all three
		// makes the capture actually work; previously `--execute` threw
		// AFTER a successful write, masking the driver's own
		// partial-failure + recovery-rowId guidance.
		stdio: ['pipe', 'pipe', 'pipe'],
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
 *
 * The `env` parameter MUST be a sanitized env (see `buildSanitizedEnv`)
 * so that `INFISICAL_TOKEN` and other Infisical credentials do not
 * leak into the D1 subprocess environment (PR #141 review fix,
 * Issue #139 canonical incident follow-up).
 */
/**
 * Issue #247: the D1 side of this driver is cf-native.
 *
 * This file is in a deliberate, temporary mixed state. Three
 * credential boundaries, kept explicit and never collapsed:
 *
 *   1. Infisical child    — the writer token for Infisical itself
 *   2. Cloudflare D1 child — `CLOUDFLARE_D1_API_TOKEN` only, scoped to
 *                            D1; NOT the Worker deploy token
 *   3. Worker-secret child — still Wrangler, replaced in the next
 *                            secrets slice
 *
 * The D1 child gets the D1-scoped credential, so Infisical material
 * and the Worker deploy token stay out of it.
 */
function execD1Sql({ target, command, json = true, env }) {
	// The caller-facing vocabulary is preserved; only this adapter maps
	// it onto the driver's local/production enum.
	const cfTarget = target === 'remote' ? 'production' : 'local';
	// Reads do not need the write gate; a statement here is a SELECT.
	return queryRows(command, { target: cfTarget, env: env ?? process.env });
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

/**
 * Strip ALL Infisical credential keys from a process.env-like object.
 *
 * This is the env for Wrangler and D1 subprocesses (`wrangler secret
 * bulk`, `wrangler d1 execute`, `wrangler secret list`). The
 * writer-scoped `INFISICAL_TOKEN` and Universal-Auth
 * `INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` MUST NOT reach
 * these subprocesses: the writer token is scoped to write Infisical,
 * not Cloudflare or D1 (PR #141 re-review, 2026-09-28).
 *
 * Kept name `buildSanitizedEnv` for backwards compatibility with the
 * earlier PR #141 review fix; new call sites should use
 * `buildWranglerEnv` for explicit intent.
 */
function buildSanitizedEnv(baseEnv) {
	return buildWranglerEnv(baseEnv);
}

/**
 * Env for the **Infisical CLI** subprocess. Keeps the writer-scoped
 * `INFISICAL_TOKEN` (the producer of the value) while stripping
 * fallback / unrelated Infisical credentials (machine-identity
 * client id / secret / site / project / api-url). These are not
 * needed by the CLI when authenticating via `INFISICAL_TOKEN` and
 * removing them prevents accidental inheritance into the CLI.
 *
 * Pair with `buildWranglerEnv` for non-Infisical subprocesses.
 */
function buildInfisicalEnv(baseEnv, auth) {
	// Issue #223: token mode injects the token; CLI mode strips the
	// whole credential set so the CLI uses its own stored session.
	return buildInfisicalEnvShared(baseEnv, auth);
}

/**
 * Env for **Wrangler / D1 / any non-Infisical** subprocess. Strips
 * the full Infisical credential set (token, machine identity,
 * project/site/api). The writer-scoped Infisical token MUST NOT
 * reach Cloudflare or D1 subprocess environments.
 */
function buildWranglerEnv(baseEnv) {
	// Issue #223: single shared least-privilege strip so the four
	// drivers cannot drift apart.
	return buildWranglerEnvShared(baseEnv);
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

async function runInfisicalWrite({ cliPath, yamlPath, environment, workspaceId, env }) {
	const child = spawnInfisicalSet({ cliPath, yamlPath, environment, workspaceId, env });
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

/**
 * In-process smoke: issue a single GET against the production health
 * surface with the fresh plaintext as `Authorization: Bearer ...`.
 * Validate 2xx response. The plaintext is constructed locally,
 * placed into the request header, and released on function return;
 * it is never logged, never returned, never returned via the result
 * object. The Promise resolves to status-only metadata.
 *
 * The `fetchImpl` parameter is a DI seam for tests; in production
 * it is `globalThis.fetch`.
 */
async function runSmoke({
	url,
	plaintext,
	authHeader = SMOKE_AUTH_HEADER,
	authScheme = SMOKE_AUTH_SCHEME,
	fetchImpl = globalThis.fetch,
}) {
	if (typeof fetchImpl !== 'function') {
		throw new Error('globalThis.fetch is unavailable; Node 20+ is required for in-process smoke');
	}
	const headers = { [authHeader]: `${authScheme} ${plaintext}` };
	const response = await fetchImpl(url, { method: 'GET', headers });
	const status = response.status;
	const ok = typeof status === 'number' && status >= SMOKE_MIN_STATUS && status <= SMOKE_MAX_STATUS;
	// Drain the body so the connection can be released, but DO NOT
	// capture it (no plaintext leakage via response body).
	await response.text().catch(() => undefined);
	return {
		status,
		ok,
		url,
		headerUsed: authHeader,
		schemeUsed: authScheme,
	};
}

/* ─── Public exports (DI seams for tests) ──────────────────────────────── */

export {
	KEY_NAME_PREFIX,
	KEY_NAME_LEGACY,
	KEY_BODY_LEN,
	KEY_PREFIX_OUTPUT,
	SECRET_NAME,
	SMOKE_URL_DEFAULT,
	SMOKE_AUTH_HEADER,
	SMOKE_AUTH_SCHEME,
	SMOKE_MIN_STATUS,
	SMOKE_MAX_STATUS,
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
	buildD1SelectActiveRotatedRowCommand,
	buildD1SelectOldHomeRowCommand,
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
	classifyInfisicalHttpStatus,
	buildSecretReadUrl,
	interpretInfisicalReadResponse,
	httpsGetJson,
	readInfisicalSecret,
	runSmoke,
	awaitExit,
	buildSanitizedEnv,
	buildInfisicalEnv,
	buildWranglerEnv,
	execD1Sql,
};

/* ─── CLI entrypoint ───────────────────────────────────────────────────── */

/**
 * Issue #223 — presence/absence of a single secret, without pulling
 * the value into this process when running on the CLI session.
 */
async function isInfisicalSecretPresent({ auth, apiUrl, cliPath, workspaceId, environment, name }) {
	const present = await secretPresenceViaAuth({
		auth,
		apiUrl,
		cliPath,
		environment,
		projectId: workspaceId,
		name,
		token: auth.token,
		readViaToken: async ({ apiUrl: u, token: t, environment: e, name: n }) =>
			readInfisicalSecret({ apiUrl: u, token: t, workspaceId, environment: e, name: n }),
	});
	return present;
}

/**
 * Issue #223 — materialise the stored value into a 0600 temp file so
 * `--worker-recovery` can replay it to the Worker in either auth mode.
 */
async function materialiseSecretValue({ auth, apiUrl, cliPath, workspaceId, environment, name }) {
	const handle = await materialiseSecret({
		auth,
		apiUrl,
		cliPath,
		environment,
		projectId: workspaceId,
		name,
		token: auth.token,
		readViaToken: async ({ apiUrl: u, token: t, environment: e, name: n }) =>
			readInfisicalSecret({ apiUrl: u, token: t, workspaceId, environment: e, name: n }),
	});
	try {
		return readFileSync(handle.path, 'utf8');
	} finally {
		handle.cleanup();
	}
}

async function runVerify({ apiUrl, auth, cliPath, workspaceId, environment, target }) {
	const wranglerEnv = buildWranglerEnv(process.env);

	// D1 state — list enabled rows (old + rotated). Used to surface the
	// containment state of the old row (leaked plaintext rejected? yes if
	// `oldHomeRowEnabled=false`) and any in-flight rotation.
	const activeRotatedResult = execD1Sql({
		target,
		command: buildD1SelectActiveRotatedRowCommand(),
		json: true,
		env: wranglerEnv,
	});
	const activeRotatedRows = activeRotatedResult?.[0]?.results ?? [];

	const oldHomeResult = execD1Sql({
		target,
		command: buildD1SelectOldHomeRowCommand(),
		json: true,
		env: wranglerEnv,
	});
	const oldHomeRows = oldHomeResult?.[0]?.results ?? [];

	// Infisical prod state. Issue #223: token mode keeps the HTTPS
	// read; CLI mode resolves presence through a CLI-auth child so the
	// driver never holds a bearer token.
	const infisicalPresent = await isInfisicalSecretPresent({
		auth,
		apiUrl,
		cliPath,
		workspaceId,
		environment,
		name: SECRET_NAME,
	});

	// Worker binding name (must use Wrangler env, no Infisical creds)
	const bindings = await readWranglerBindingNames(wranglerEnv);
	const hasBinding = bindings.includes(SECRET_NAME);

	return {
		d1: {
			rotatedRowCount: activeRotatedRows.length,
			oldHomeRowEnabled: oldHomeRows.length > 0,
		},
		infisical: {
			present: infisicalPresent,
		},
		worker: {
			hasBinding,
			bindingsCount: bindings.length,
		},
	};
}

async function runWorkerRecovery({
	rowId,
	apiUrl,
	auth,
	cliPath,
	workspaceId,
	environment,
	target,
}) {
	console.log(`[worker-recovery] rowId=${rowId} target=${target}`);

	const wranglerEnv = buildWranglerEnv(process.env);

	const infisicalValue = await materialiseSecretValue({
		auth,
		apiUrl,
		cliPath,
		workspaceId,
		environment,
		name: SECRET_NAME,
	});
	if (typeof infisicalValue !== 'string' || infisicalValue.length === 0) {
		throw new Error(
			`Worker recovery requires Infisical ${environment} to already hold the fresh ${SECRET_NAME} value. Re-run --execute OR --worker-recovery only after the Infisical stage has completed.`,
		);
	}

	console.log(
		`[worker-recovery] writing ${SECRET_NAME} to Worker via wrangler secret bulk (stdin JSON)...`,
	);
	const payload = buildWorkerBulkPayload(infisicalValue);
	const wranglerResult = await runWranglerWrite({ payload, env: wranglerEnv });
	if (wranglerResult.signal) {
		throw new Error(`wrangler terminated by signal ${wranglerResult.signal}`);
	}
	if (wranglerResult.code !== 0) {
		throw new Error(`wrangler secret bulk exited with status ${wranglerResult.code}`);
	}

	console.log('[worker-recovery] verifying Worker binding names (no value read-back)...');
	const bindings = await readWranglerBindingNames(wranglerEnv);
	if (!bindings.includes(SECRET_NAME)) {
		throw new Error(
			`Worker binding-name verification failed: ${SECRET_NAME} not present in wrangler secret list (got: [${bindings.join(', ')}])`,
		);
	}

	console.log('[worker-recovery] complete.');
	console.log(`  rotated D1 row: id=${rowId}`);
	console.log(`  Infisical ${environment}: ${SECRET_NAME} = <fresh>`);
	console.log(`  Worker: ${SECRET_NAME} = <fresh>`);
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
		console.log('  1. read current D1 state (old home-self-consumption row + rotated rows)');
		console.log(
			'  2. refuse if a rotated row already exists (must run --worker-recovery or --disable-row first)',
		);
		console.log(
			'  3. generate fresh plaintext (crypto.randomBytes, mk_home_ alphabet) + SHA-256 hash',
		);
		console.log('  4. resolve admin user reference id');
		console.log(
			'  5. INSERT new D1 row (apikey.name=home-self-consumption-rotated-<id>, enabled=1)',
		);
		console.log('     -> SELECT verifies the row is enabled');
		console.log(
			`  6. IN-PROCESS smoke: GET ${SMOKE_URL_DEFAULT} with new plaintext (operator never types the value)`,
		);
		console.log(
			`  7. write Infisical ${args.environment}: ${SECRET_NAME} = <fresh> + constant-time read-back verify`,
		);
		console.log(
			'  8. disable OLD home-self-consumption row (containment — only after fresh plaintext has a recoverable SoT)',
		);
		console.log('     -> SELECT verifies the old row is gone');
		console.log(`  9. write Worker ${SECRET_NAME} = <fresh> via wrangler secret bulk (stdin JSON)`);
		console.log(
			'  10. verify: HTTPS GET read-back + timingSafeEqual (Infisical) + wrangler secret list (Worker names)',
		);
		console.log('[dry-run] no side effects; pass --execute to apply (operator gate required).');
		return;
	}

	// Issue #223: resolve auth once, before any side effect. An
	// explicit INFISICAL_TOKEN keeps the pre-#223 path; otherwise the
	// logged-in Infisical CLI session is preflighted. Failure here
	// happens before the first mutation.
	const cliPath = resolveInfisicalCliPath();
	const auth = await resolveInfisicalAuth({
		env: process.env,
		cliPath,
		environment: args.environment,
		projectId: infisicalConfig.workspaceId,
	});
	console.log(`[rotate-home-api-key] auth mode=${auth.mode}`);

	if (args.mode === 'verify-only') {
		const result = await runVerify({
			apiUrl,
			auth,
			cliPath,
			workspaceId: infisicalConfig.workspaceId,
			environment: args.environment,
			target: args.target,
		});
		console.log(
			`[verify-only] D1 rotated rows enabled: ${result.d1.rotatedRowCount} (in-flight = 0 is the steady state)`,
		);
		console.log(
			`[verify-only] D1 old home row enabled: ${result.d1.oldHomeRowEnabled} (false = contained)`,
		);
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
		const wranglerEnv = buildWranglerEnv(process.env);
		execD1Sql({ target: args.target, command: cmd, json: false, env: wranglerEnv });
		console.log(`[disable-row] row id=${args.disableRowId} disabled (if it was enabled)`);
		return;
	}

	if (args.mode === 'worker-recovery') {
		await runWorkerRecovery({
			rowId: args.workerRecoveryRowId,
			apiUrl,
			auth,
			cliPath,
			workspaceId: infisicalConfig.workspaceId,
			environment: args.environment,
			target: args.target,
		});
		return;
	}

	// --execute path. `auth` was resolved above and failed closed there.

	const wranglerEnv = buildWranglerEnv(process.env);

	// Stage 1 — refuse if a rotated row is already enabled. Rotation is
	// atomic from the operator's perspective; partial state must be
	// resolved via --worker-recovery or --disable-row before starting a
	// new one. This is structural: re-running with a fresh plaintext
	// would generate a new D1 row and overwrite Infisical, which is the
	// partial-failure bug the PR #141 review fixed.
	console.log('[execute] checking for in-flight rotation in D1...');
	const inflightResult = execD1Sql({
		target: args.target,
		command: buildD1SelectActiveRotatedRowCommand(),
		json: true,
		env: wranglerEnv,
	});
	const inflightRows = inflightResult?.[0]?.results ?? [];
	if (inflightRows.length > 0) {
		throw new Error(
			`An enabled rotated row already exists (id=${inflightRows[0].id}, name=${inflightRows[0].name}). --execute refuses to start a new rotation while one is in flight. Resolve the partial state via --worker-recovery=<rowId> (if Infisical+Worker pending) or --disable-row=<rowId> (to discard a half-completed rotation).`,
		);
	}

	// Stage 2 — locate the OLD home-self-consumption row. The disable-old
	// step is CONTAINMENT (Better Auth verifyApiKey validates against D1
	// directly; the Worker binding is internal self-consumption only).
	// Located here so we can fail fast if the row is missing, but the
	// disable itself happens AFTER Stage 7 persists + verifies the fresh value in Infisical (Stage 8)
	// so the old row stays valid until the new row is proven usable.
	console.log('[execute] locating old home-self-consumption row...');
	const oldRowResult = execD1Sql({
		target: args.target,
		command: buildD1SelectOldHomeRowCommand(),
		json: true,
		env: wranglerEnv,
	});
	const oldRows = oldRowResult?.[0]?.results ?? [];
	if (oldRows.length === 0) {
		throw new Error(
			'No enabled home-self-consumption row found. Cannot rotate — bootstrap one via ' +
				'bootstrap-home-api-key.mjs first, or investigate why the old row is missing.',
		);
	}
	const oldRowId = oldRows[0].id;

	// Stage 3 — generate fresh plaintext + hash IN-PROCESS (never displayed).
	const plaintext = generatePlaintext();
	const hash = keyHash(plaintext);
	const rotationId = deriveRotationId(new Date().toISOString());
	const rowName = buildRotatedRowName(rotationId);
	const rowId = generateRowId();
	const now = Date.now();

	// Stage 4 — resolve admin user reference id (existing rows point at
	// the admin user; mirror the existing bootstrap pattern).
	const adminRow = execD1Sql({
		target: args.target,
		command: "SELECT id FROM user WHERE role = 'admin' ORDER BY id ASC LIMIT 1",
		json: true,
		env: wranglerEnv,
	});
	const adminId = adminRow?.[0]?.results?.[0]?.id;
	if (typeof adminId !== 'string' || adminId.length === 0) {
		throw new Error(
			'No admin user found in D1. Create the admin before rotating the home consumer key.',
		);
	}

	// Stage 5 — INSERT new row + verify. The old row remains enabled at
	// this point (Phase 1 of the D1 mutation). A short dual-valid window
	// exists from here until Stage 8 completes (the protected smoke + Infisical persistence are
	// bounded; typically < 1s). Both rows enabled during the window is
	// intentional: if the smoke or Infisical persistence fails we abort BEFORE disable-old and
	// discard via --disable-row, so we never reach a zero-valid-key state.
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
	console.log(`[execute] INSERT new D1 row name=${rowName} (Phase 1 of D1 mutation)...`);
	execD1Sql({ target: args.target, command: insertCmd, json: false, env: wranglerEnv });
	const verifyRow = execD1Sql({
		target: args.target,
		command: buildD1SelectRotatedByHashCommand(hash),
		json: true,
		env: wranglerEnv,
	});
	const insertedRows = verifyRow?.[0]?.results ?? [];
	if (insertedRows.length === 0) {
		throw new Error(
			'D1 INSERT verification failed: no row found for the new hash. The fresh row may or may not have been written; run --verify-only to inspect.',
		);
	}
	const rotatedRowId = insertedRows[0].id;
	console.log(
		`[execute] D1 row verified: id=${rotatedRowId} enabled=${insertedRows[0].enabled} (both old + new rows enabled during smoke window)`,
	);

	// Stage 6 — IN-PROCESS smoke against the canonical protected surface.
	// The plaintext goes into the request header inside `runSmoke` and
	// is released on function return; the smoke result exposes only
	// status metadata. The URL is FIXED (see SMOKE_URL_DEFAULT) — there
	// is no `--smoke-url` override, because supplying `Authorization:
	// Bearer <fresh>` to an arbitrary host would exfiltrate the new
	// credential (PR #141 re-review, 2026-09-28).
	console.log(
		`[execute] in-process smoke: GET ${SMOKE_URL_DEFAULT} with the fresh plaintext (operator never types the value)...`,
	);
	const smokeResult = await runSmoke({
		url: SMOKE_URL_DEFAULT,
		plaintext,
	});
	console.log(
		`[execute] smoke: ${smokeResult.ok ? 'OK' : 'FAIL'} status=${smokeResult.status} url=${smokeResult.url} header=${smokeResult.headerUsed}`,
	);
	if (!smokeResult.ok) {
		// The fresh row is enabled; the old row is still enabled (we have
		// NOT disabled it). Abort BEFORE disable-old so we don't reach a
		// zero-valid-key state. Operator investigates the smoke surface,
		// then runs --disable-row=<rotatedRowId> to discard the fresh row
		// before re-running --execute.
		throw new Error(
			`In-process smoke failed (status=${smokeResult.status}); aborting BEFORE disable-old so the old row stays valid. Old + new both enabled (dual-valid window). Run --disable-row=${rotatedRowId} to discard the fresh row, then fix the smoke surface and re-run --execute.`,
		);
	}

	// Stage 7 — write Infisical prod (recoverable SoT BEFORE containment) (BEFORE Worker so --worker-recovery
	// can read the fresh value from Infisical on any post-containment Worker-write failure).
	// The old D1 row is intentionally still enabled here: if this write fails,
	// the leaked credential remains available for service continuity while the
	// unpersisted fresh row can be explicitly discarded.
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
		// The Infisical subprocess DOES need the writer-scoped token
		// (it is the producer of the value). Wrangler/D1 subprocesses
		// NEVER receive it (buildWranglerEnv). PR #141 re-review, 2026-09-28.
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

		// Read-back verify (constant-time). Issue #223: compare without
		// pulling the value back into the driver on the CLI session.
		console.log(`[execute] verifying Infisical read-back (auth=${auth.mode}, timingSafeEqual)...`);
		const readBack = await compareSecretViaAuth({
			auth,
			apiUrl,
			cliPath,
			environment: args.environment,
			projectId: infisicalConfig.workspaceId,
			name: SECRET_NAME,
			expected: plaintext,
			token: auth.token,
			readViaToken: async ({ apiUrl: u, token: t, environment: e, name: n }) =>
				readInfisicalSecret({
					apiUrl: u,
					token: t,
					workspaceId: infisicalConfig.workspaceId,
					environment: e,
					name: n,
				}),
		});
		if (readBack.status !== 'match') {
			throw new Error(
				`Infisical read-back mismatch: ${SECRET_NAME} did not byte-match the new plaintext`,
			);
		}
		infisicalSucceeded = true;
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}

	// Stage 8 — disable OLD row (Phase 2 of D1 mutation = containment).
	// Idempotent via the `WHERE enabled = 1` guard. Now that the smoke
	// has proven the fresh plaintext authenticates AND Stage 7 has persisted
	// it in Infisical as the recoverable SoT, we can safely
	// disable the old row — the leaked plaintext is no longer the only
	// valid key, and the fresh row is the only enabled consumer key.
	console.log(
		`[execute] disabling OLD row id=${oldRowId} (Phase 2 of D1 mutation, containment)...`,
	);
	execD1Sql({
		target: args.target,
		command: buildD1DisableCommand(oldRowId),
		json: false,
		env: wranglerEnv,
	});
	const oldDisabledResult = execD1Sql({
		target: args.target,
		command: buildD1SelectOldHomeRowCommand(),
		json: true,
		env: wranglerEnv,
	});
	if ((oldDisabledResult?.[0]?.results ?? []).length > 0) {
		throw new Error(
			`Disabling OLD row id=${oldRowId} did not take effect (still enabled). The fresh row IS enabled (id=${rotatedRowId}), so external auth still accepts the fresh plaintext — but the LEAKED old plaintext is also still accepted. Operator MUST investigate the disable failure and run --disable-row=${oldRowId} to restore containment.`,
		);
	}
	console.log(
		'[execute] OLD row disabled; leaked plaintext now rejected by external auth middleware',
	);

	// Stage 9 — write Worker via bulk (env without INFISICAL_TOKEN).
	console.log(
		`[execute] writing ${SECRET_NAME} to Worker via wrangler secret bulk (stdin JSON)...`,
	);
	const payload = buildWorkerBulkPayload(plaintext);
	const wranglerResult = await runWranglerWrite({ payload, env: wranglerEnv });
	if (wranglerResult.signal) {
		console.error(
			`[execute] PARTIAL FAILURE: Infisical ${args.environment} holds the new ${SECRET_NAME}, but Worker write was terminated by signal ${wranglerResult.signal}.`,
		);
		console.error(
			`[execute] D1: new row id=${rotatedRowId} enabled; old row id=${oldRowId} disabled (containment)`,
		);
		console.error(
			`[execute] Recovery: re-run \`pnpm run rotate:home-api-key -- --worker-recovery=${rotatedRowId}\``,
		);
		process.exit(3);
	}
	if (wranglerResult.code !== 0) {
		console.error(
			`[execute] PARTIAL FAILURE: Infisical ${args.environment} holds the new ${SECRET_NAME}, but Worker write failed with exit=${wranglerResult.code}.`,
		);
		console.error(
			`[execute] D1: new row id=${rotatedRowId} enabled; old row id=${oldRowId} disabled (containment)`,
		);
		console.error(
			`[execute] Recovery: re-run \`pnpm run rotate:home-api-key -- --worker-recovery=${rotatedRowId}\``,
		);
		process.exit(3);
	}

	// Stage 10 — Worker binding-name verification (env without Infisical creds).
	console.log('[execute] verifying Worker binding names (no value read-back)...');
	const bindings = await readWranglerBindingNames(wranglerEnv);
	if (!bindings.includes(SECRET_NAME)) {
		throw new Error(
			`Worker binding-name verification failed: ${SECRET_NAME} not present in wrangler secret list (got: [${bindings.join(', ')}])`,
		);
	}

	console.log('[execute] complete.');
	console.log(`  D1 new row: id=${rotatedRowId} name=${rowName} enabled=1`);
	console.log(`  D1 old row: id=${oldRowId} disabled (containment)`);
	console.log(`  Infisical ${args.environment}: ${SECRET_NAME} = <fresh>`);
	console.log(`  Worker: ${SECRET_NAME} = <fresh>`);
	console.log(`  In-process smoke: status=${smokeResult.status} url=${smokeResult.url}`);
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMainModule) {
	main().catch((error) => {
		console.error(`rotate-home-api-key failed: ${error?.message ?? error}`);
		process.exit(1);
	});
}
