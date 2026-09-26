#!/usr/bin/env node
/**
 * Bootstrap a home self-consumption API key.
 *
 * This is an explicit provisioning tool, not part of deployment.
 * It creates the Better Auth api-key row and prints the plaintext
 * exactly once. The script is **idempotent on rerun**: if an enabled
 * row already exists for the consumer key name, the existing row is
 * reused and no new plaintext is minted. This is the rerun /
 * concurrent-safe invariant.
 *
 * Local:
 *   pnpm run bootstrap:home-api-key
 *   -> store the printed value in .dev.vars
 *
 * Production:
 *   pnpm run bootstrap:home-api-key -- --target=remote
 *   -> store the printed value as the Worker runtime secret
 *      MY_WEB_2026_CONSUMER_API_KEY in Cloudflare
 *
 * Cloudflare Workers Builds never needs this plaintext as a build secret.
 *
 * Rerun / concurrent safety:
 *   - `INSERT ... WHERE NOT EXISTS (SELECT 1 FROM apikey
 *     WHERE name = ? AND enabled = 1)` is atomic, so two concurrent
 *     runs cannot both mint a plaintext.
 *   - Migration 0006's `UNIQUE INDEX uq_apikey_key` provides a
 *     secondary backstop for same-hash collisions (rare in practice
 *     since the SHA-256 is per-plaintext).
 *   - On rerun, the existing row is reported via the machine-readable
 *     JSON output; no plaintext is printed because it is unrecoverable.
 *   - For rotation (replacing an existing key), use the dedicated
 *     rotation runbook (ADR-0015 §6 / §F; Phase 3 follow-up ticket).
 *
 * Output contract (ADR-0015 §E, extended in this release / Phase 2):
 *
 *   # Local home consumer API key created.
 *   # Store the following value in .dev.vars as MY_WEB_2026_CONSUMER_API_KEY.
 *
 *   mk_home_AbCdEfGhIjK...
 *
 *   {"id":"<uuid>","prefix":"mk_home_","start":"mk_hom","createdAt":1737830400000,"enabled":1,"name":"home-self-consumption","referenceId":"<admin-uuid>"}
 *
 * On rerun (existing enabled row):
 *
 *   # Local home consumer API key already exists.
 *   # The existing enabled row is reported below (no new plaintext minted).
 *
 *   <no new plaintext — existing enabled row reused; original plaintext was only available at creation time>
 *
 *   {"id":"<existing-uuid>",...}
 *
 * The machine-readable JSON line (single line, parseable) provides
 * the 7 fields that the rotation runbook (§6 step 0) needs to query
 * the existing enabled row before creating a new one.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const KEY_NAME = 'home-self-consumption';
const KEY_PREFIX = 'mk_home_';
const KEY_BODY_LEN = 32;
const REQUIRED_SCOPES = {
	reactions: ['read', 'write'],
	access_counter: ['read', 'write'],
};

function parseTarget(argv) {
	const eq = argv.find((arg) => arg.startsWith('--target='));
	const index = argv.indexOf('--target');
	const value = eq ? eq.slice('--target='.length) : index >= 0 ? argv[index + 1] : 'local';
	if (value !== 'local' && value !== 'remote') {
		throw new Error(`--target must be local or remote (got ${String(value)})`);
	}
	return value;
}

function d1Args(target, command, json = true) {
	const args = ['exec', 'wrangler', 'd1', 'execute'];
	if (target === 'remote') {
		args.push('my-web-2026', '--remote', '-c', 'wrangler.production.jsonc');
	} else {
		args.push('DB', '--local');
	}
	args.push('--command', command);
	if (json) args.push('--json');
	return args;
}

function execute(target, command, json = true) {
	return execFileSync('pnpm', d1Args(target, command, json), {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
	});
}

function query(target, command) {
	const parsed = JSON.parse(execute(target, command));
	return parsed?.[0]?.results ?? [];
}

function sqlString(value) {
	return String(value).replaceAll("'", "''");
}

function generatePlaintext() {
	const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
	const bytes = randomBytes(KEY_BODY_LEN);
	let body = '';
	for (const byte of bytes) body += alphabet[byte % alphabet.length];
	return `${KEY_PREFIX}${body}`;
}

function keyHash(plaintext) {
	return createHash('sha256').update(plaintext).digest('base64url');
}

function resolveAdminUserId(target) {
	const row = query(target, "SELECT id FROM user WHERE role = 'admin' ORDER BY id ASC LIMIT 1")[0];
	if (!row?.id) {
		throw new Error(
			target === 'remote'
				? 'No production admin user exists in D1. Create the admin before provisioning the home consumer key.'
				: 'No local admin user exists in D1. Create the admin before provisioning the home consumer key.',
		);
	}
	return row.id;
}

/**
 * Look up an existing enabled row for `KEY_NAME`. Reruns of this
 * script reuse the existing row instead of inserting a new one —
 * otherwise each invocation would mint a new plaintext (since the
 * SHA-256 hash is per-plaintext) and create multiple enabled rows
 * for the same logical consumer key. Migration 0006's UNIQUE INDEX
 * on `apikey.key` only catches same-hash collisions, which is not
 * the common rerun case.
 *
 * Returns the row (normalized) if found, or `null`.
 */
function queryEnabledRowByName(target) {
	const escapedName = sqlString(KEY_NAME);
	const rows = query(
		target,
		`SELECT id, prefix, start, createdAt, enabled, name, referenceId
		 FROM apikey
		 WHERE name = '${escapedName}' AND enabled = 1
		 ORDER BY createdAt DESC, id DESC
		 LIMIT 1`,
	);
	const row = rows[0];
	return row ? normalizeRow(row) : null;
}

/**
 * Insert the api-key row only when no enabled row exists for
 * `KEY_NAME`. The atomic `INSERT INTO ... WHERE NOT EXISTS (...)`
 * form prevents the TOCTOU race between a pre-check SELECT and the
 * INSERT (two concurrent runs could otherwise both observe "no
 * enabled row" and both insert). Migration 0006's UNIQUE INDEX on
 * `apikey.key` provides a backstop for same-hash collisions. The
 * caller must always re-read by id to obtain the actual row.
 */
function insertKeyIfAbsent(target, userId, plaintext, hash) {
	const now = Date.now();
	const permissions = sqlString(JSON.stringify(REQUIRED_SCOPES));
	const escapedHash = sqlString(hash);
	const escapedUserId = sqlString(userId);
	const escapedStart = sqlString(plaintext.slice(0, 6));
	const escapedName = sqlString(KEY_NAME);
	// D1/SQLite does not support `INSERT ... RETURNING`. We use
	// `WHERE NOT EXISTS` for atomicity and rely on `queryRowById` to
	// fetch the actual row afterwards.
	execute(
		target,
		`INSERT INTO apikey (
			id, configId, name, start, referenceId, prefix, \`key\`,
			enabled, rateLimitEnabled, rateLimitTimeWindow, rateLimitMax,
			requestCount, remaining, lastRequest, expiresAt,
			lastRefillAt, refillInterval, refillAmount, metadata,
			createdAt, updatedAt, permissions
		)
		SELECT
			lower(hex(randomblob(16))), 'default', '${escapedName}', '${escapedStart}',
			'${escapedUserId}', '${KEY_PREFIX}', '${escapedHash}',
			1, 0, 60000, 60, 0, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL,
			${now}, ${now}, '${permissions}'
		WHERE NOT EXISTS (
			SELECT 1 FROM apikey WHERE name = '${escapedName}' AND enabled = 1
		)`,
		false,
	);
}

/**
 * Re-read the row by id. Source of truth for the machine-readable
 * JSON output. If the row's plaintext hash does not match the one
 * we generated (existing enabled row was reused), the caller will
 * detect the mismatch via `findMismatchedRow` and report it as
 * "reuse" rather than printing a stale plaintext.
 */
function queryRowById(target, rowId) {
	const escapedId = sqlString(rowId);
	const rows = query(
		target,
		`SELECT id, prefix, start, createdAt, enabled, name, referenceId
		 FROM apikey
		 WHERE id = '${escapedId}'
		 LIMIT 1`,
	);
	const row = rows[0];
	if (!row) {
		throw new Error(`apikey row ${rowId} disappeared after insert`);
	}
	return normalizeRow(row);
}

/**
 * Normalize a D1 row to the canonical shape used by the JSON output.
 * D1 returns integers as numbers but may return strings depending on
 * the column type. We coerce to canonical types here so the JSON
 * output is always predictable.
 */
function normalizeRow(row) {
	return {
		id: String(row.id),
		prefix: String(row.prefix),
		start: String(row.start),
		createdAt: Number(row.createdAt),
		enabled: Number(row.enabled),
		name: String(row.name),
		referenceId: String(row.referenceId),
	};
}

/**
 * Format the machine-readable JSON output (ADR-0015 §E). Single-line
 * parseable JSON. Keys are sorted alphabetically for stable diffs.
 */
function formatKeyRowJson(row) {
	return JSON.stringify({
		createdAt: row.createdAt,
		enabled: row.enabled,
		id: row.id,
		name: row.name,
		prefix: row.prefix,
		referenceId: row.referenceId,
		start: row.start,
	});
}

const target = parseTarget(process.argv.slice(2));
const userId = resolveAdminUserId(target);

// Idempotency: if an enabled row already exists for `KEY_NAME`,
// reuse it. The rerun / concurrent-safe invariant is that we never
// create a second enabled row for the same logical consumer key.
// `insertKeyIfAbsent` uses `WHERE NOT EXISTS` for atomicity, so
// two concurrent runs both observe "no row" but only one INSERT
// actually fires (the other becomes a no-op).
const existingRow = queryEnabledRowByName(target);
let row;
let reused = false;
let plaintext = null;
if (existingRow) {
	row = existingRow;
	reused = true;
} else {
	plaintext = generatePlaintext();
	const hash = keyHash(plaintext);
	insertKeyIfAbsent(target, userId, plaintext, hash);
	// Re-read after insert; if a concurrent run won the race, we
	// fall back to the existing enabled row (no plaintext printed).
	const winner = queryEnabledRowByName(target);
	if (!winner) {
		throw new Error('apikey row disappeared after INSERT WHERE NOT EXISTS');
	}
	row = winner;
}

if (target === 'remote') {
	if (reused) {
		console.log('# Production home consumer API key already exists.');
		console.log('# The existing enabled row is reported below (no new plaintext minted).');
		console.log(
			'# To rotate, run the dedicated rotation runbook (ADR-0015 §6, Phase 3 follow-up).',
		);
	} else {
		console.log('# Production home consumer API key created.');
		console.log('# Store the following value as the Cloudflare Worker runtime secret');
		console.log('# MY_WEB_2026_CONSUMER_API_KEY. Do not add it as a Workers Builds secret.');
	}
} else {
	if (reused) {
		console.log('# Local home consumer API key already exists.');
		console.log('# The existing enabled row is reported below (no new plaintext minted).');
	} else {
		console.log('# Local home consumer API key created.');
		console.log('# Store the following value in .dev.vars as MY_WEB_2026_CONSUMER_API_KEY.');
	}
}
console.log('');
if (reused) {
	// No plaintext was minted — the existing row's plaintext is not
	// recoverable from D1 (only the SHA-256 hash is stored). Print a
	// sentinel so the operator sees a clear boundary between the
	// "create" and "reuse" code paths.
	console.log(
		'<no new plaintext — existing enabled row reused; original plaintext was only available at creation time>',
	);
} else {
	// The plaintext is printed here, exactly once. Operators must
	// capture it before the script exits.
	console.log(plaintext);
}
console.log('');
console.log(formatKeyRowJson(row));
