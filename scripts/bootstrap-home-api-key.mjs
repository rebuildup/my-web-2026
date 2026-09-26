#!/usr/bin/env node
/**
 * Bootstrap a home self-consumption API key.
 *
 * This is an explicit provisioning / rotation tool, not part of deployment.
 * It creates the Better Auth api-key row and prints the plaintext exactly once.
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
 * Output contract (ADR-0015 §E, extended in this release / Phase 2):
 *
 *   # Local home consumer API key created.
 *   # Store the following value in .dev.vars as MY_WEB_2026_CONSUMER_API_KEY.
 *
 *   mk_home_AbCdEfGhIjK...
 *
 *   {"id":"<uuid>","prefix":"mk_home_","start":"mk_hom","createdAt":1737830400000,"enabled":1,"name":"home-self-consumption","referenceId":"<admin-uuid>"}
 *
 * The machine-readable JSON line (single line, parseable) provides
 * the 7 fields that the rotation runbook (§6 step 0) needs to query
 * the existing enabled row before creating a new one. The `id` is
 * the row that was actually inserted (or the pre-existing row in
 * case of an `INSERT OR IGNORE` collision — see migration 0006).
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
 * Insert the api-key row. Migration 0006 added a UNIQUE INDEX on
 * `apikey.key` (the SHA-256 hash), so concurrent deploys / re-runs
 * converge deterministically via `INSERT OR IGNORE`. The caller must
 * re-read by hash to obtain the actual row (in case of conflict, the
 * existing row's id wins — see `queryRowByHash`).
 */
function insertKey(target, userId, plaintext, hash) {
	const now = Date.now();
	const permissions = sqlString(JSON.stringify(REQUIRED_SCOPES));
	const escapedHash = sqlString(hash);
	const escapedUserId = sqlString(userId);
	const escapedStart = sqlString(plaintext.slice(0, 6));
	execute(
		target,
		`INSERT OR IGNORE INTO apikey (
			id, configId, name, start, referenceId, prefix, \`key\`,
			enabled, rateLimitEnabled, rateLimitTimeWindow, rateLimitMax,
			requestCount, remaining, lastRequest, expiresAt,
			lastRefillAt, refillInterval, refillAmount, metadata,
			createdAt, updatedAt, permissions
		) VALUES (
			lower(hex(randomblob(16))), 'default', '${KEY_NAME}', '${escapedStart}',
			'${escapedUserId}', '${KEY_PREFIX}', '${escapedHash}',
			1, 0, 60000, 60, 0, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL,
			${now}, ${now}, '${permissions}'
		)`,
		false,
	);
}

/**
 * Re-read the row by hash. This is the source of truth for the
 * machine-readable JSON output: if a concurrent / re-run already
 * inserted the same hash, `INSERT OR IGNORE` silently skipped, and
 * the existing row's id / createdAt is what we report.
 */
function queryRowByHash(target, hash) {
	const escapedHash = sqlString(hash);
	const rows = query(
		target,
		`SELECT id, prefix, start, createdAt, enabled, name, referenceId
		 FROM apikey
		 WHERE \`key\` = '${escapedHash}'
		 ORDER BY enabled DESC, updatedAt DESC, id DESC
		 LIMIT 1`,
	);
	const row = rows[0];
	if (!row) {
		throw new Error('apikey row disappeared after INSERT OR IGNORE');
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
const plaintext = generatePlaintext();
const hash = keyHash(plaintext);

insertKey(target, userId, plaintext, hash);
const row = queryRowByHash(target, hash);

if (target === 'remote') {
	console.log('# Production home consumer API key created.');
	console.log('# Store the following value as the Cloudflare Worker runtime secret');
	console.log('# MY_WEB_2026_CONSUMER_API_KEY. Do not add it as a Workers Builds secret.');
} else {
	console.log('# Local home consumer API key created.');
	console.log('# Store the following value in .dev.vars as MY_WEB_2026_CONSUMER_API_KEY.');
}
console.log('');
console.log(plaintext);
console.log('');
console.log(formatKeyRowJson(row));
