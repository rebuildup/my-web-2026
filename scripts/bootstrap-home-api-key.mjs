#!/usr/bin/env node
/**
 * Bootstrap a home self-consumption API key.
 *
 * This is an explicit provisioning tool, not part of deployment.
 * It creates the Better Auth api-key row and prints the plaintext
 * exactly once. The script is **idempotent on rerun** AND
 * **concurrent-safe**: if an enabled row already exists for the
 * consumer key name when this process runs alone, it reuses the row;
 * if two concurrent processes race and one wins the INSERT, the
 * losing process detects this via a hash re-read and prints no
 * plaintext (its locally-generated plaintext has no D1 row).
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
 * Rerun / concurrent safety (Phase 2 review correction):
 *   - `INSERT ... WHERE NOT EXISTS (SELECT 1 FROM apikey
 *     WHERE name = ? AND enabled = 1)` is atomic, so two concurrent
 *     runs cannot BOTH physically insert a row.
 *   - HOWEVER, atomicity alone is not enough: a losing process still
 *     has a locally-generated plaintext in scope. The fix is the
 *     **hash re-read** (`queryEnabledRowByHash`): the winning process
 *     re-reads by its own hash and finds a row (it inserts its own
 *     hash); the LOSING process re-reads by its own hash and finds
 *     nothing (the winner's hash differs), then falls back to the
 *     name-based reuse path, **never printing its own plaintext**.
 *   - Migration 0006's `UNIQUE INDEX uq_apikey_key` (hash-unique) is
 *     what makes the hash re-read unambiguous: two distinct plaintexts
 *     produce two distinct hashes, so a row re-found by hash can only
 *     be the row this process itself inserted.
 *   - On rerun (no race), the existing row is reported via the
 *     machine-readable JSON output; no plaintext is printed because
 *     it is unrecoverable from D1.
 *   - For rotation (replacing an existing key), use the dedicated
 *     rotation runbook (ADR-0015 §6 / §F; Phase 3+ follow-up
 *     `scripts/rotate-home-api-key.mjs` per Issue #74).
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
 * On rerun OR concurrent loss (existing enabled row, no plaintext minted):
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
 * Look up an enabled row whose `apikey.key` (SHA-256 base64url hash of
 * the plaintext) matches `hash`. Used as the LOSER-vs-WINNER check
 * after `insertKeyIfAbsent` — a process whose locally-generated
 * plaintext won the INSERT will re-find its own row here; a process
 * that lost a race against another concurrent run will find nothing
 * (the other run's hash differs), and must fall back to the name-based
 * reuse path (no plaintext printed).
 *
 * Migration 0006's UNIQUE INDEX on `apikey.key` is hash-unique, so two
 * different plaintexts produce two different hashes that never collide
 * — only the WINNING process will ever find its own row here.
 *
 * Returns the row (normalized) if found, or `null`.
 */
function queryEnabledRowByHash(target, hash) {
	const escapedHash = sqlString(hash);
	const rows = query(
		target,
		`SELECT id, prefix, start, createdAt, enabled, name, referenceId
		 FROM apikey
		 WHERE \`key\` = '${escapedHash}' AND enabled = 1
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

// Idempotency + concurrent-loser safety.
//
// Two facts about how this script handles state:
//
//   1. Rerun (no race): if an enabled row already exists for
//      `KEY_NAME`, the script REUSES the row. No plaintext is minted,
//      because the existing row's plaintext is unrecoverable from D1
//      (only the SHA-256 hash is stored).
//
//   2. Concurrent race: two processes both observe "no existing row"
//      and both call `insertKeyIfAbsent`. Each `INSERT ... WHERE
//      NOT EXISTS` is atomic, so only ONE process actually inserts;
//      the other's INSERT becomes a no-op. The previous version of
//      this script decided `reused` BEFORE the INSERT, so the LOSING
//      process would still print its own locally-generated plaintext
//      (which has no D1 row) — that plaintext, if registered to
//      Infisical, would not authenticate against any deployed row.
//
//      The fix: AFTER `insertKeyIfAbsent`, re-read by hash. The
//      WINNING process finds its own row (its hash matches) and prints
//      its plaintext; the LOSING process finds nothing (the winner's
//      hash differs), falls back to the name-based reuse path, and
//      prints the `<no new plaintext — ...>` sentinel instead of its
//      own unreachable plaintext.
//
//      Migration 0006's UNIQUE INDEX on `apikey.key` (hash-unique) is
//      what guarantees hash-based re-read is unambiguous: two distinct
//      plaintexts produce two distinct hashes, so a row re-found by
//      hash can only be the row this process itself inserted (or a
//      same-plaintext collision, which the UNIQUE INDEX rejects).
const existingRow = queryEnabledRowByName(target);
let row = existingRow ?? null;
let plaintext = null;
if (row === null) {
	plaintext = generatePlaintext();
	const hash = keyHash(plaintext);
	insertKeyIfAbsent(target, userId, plaintext, hash);
	// Atomic re-read by hash: did OUR insert win?
	const winnerByHash = queryEnabledRowByHash(target, hash);
	if (winnerByHash) {
		row = winnerByHash;
	} else {
		// We lost the race OR no row inserted somehow — fall back to
		// the name-based read to either reuse a concurrent process's
		// row, or surface the inconsistency as a thrown error.
		const existingAfterInsert = queryEnabledRowByName(target);
		if (!existingAfterInsert) {
			throw new Error('apikey row disappeared after INSERT WHERE NOT EXISTS');
		}
		row = existingAfterInsert;
		plaintext = null; // ← LOSER fix: discard the unreachable plaintext
	}
}
// `reused` is now derived from "do we have a plaintext of our own?".
const reused = plaintext === null;

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
