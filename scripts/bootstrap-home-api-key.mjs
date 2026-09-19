#!/usr/bin/env node
/**
 * Bootstrap the home self-consumption API key.
 *
 * Creates a Better Auth api-key row that the home can use to call
 * `/api/v1/reactions` (and `/api/v1/access` after Ticket F lands)
 * from the SSR server functions. The script does NOT write the key
 * into any binding — the operator pastes the printed value into
 * `.dev.vars` for local development or runs
 * `wrangler secret put MY_WEB_2026_CONSUMER_API_KEY` for production.
 *
 * Why a one-shot script (Ticket E / ADR-0011):
 *   - The Better Auth api-key plugin stores a SHA-256+base64url
 *     hash of the key in the `apikey.key` column; only the
 *     plaintext printed here will ever be visible.
 *   - The bootstrap is a deliberate operator step, not a runtime
 *     dependency — automating it would risk leaking the key into
 *     deployment artefacts.
 *
 * Usage:
 *   1. Start wrangler dev (or apply migrations on remote).
 *   2. `pnpm run bootstrap:home-api-key`
 *   3. Copy the printed key into `.dev.vars` (or wrangler secret).
 *
 * Required env:
 *   - BETTER_AUTH_SECRET  — Better Auth session signing key.
 *     The api-key plugin uses BETTER_AUTH_SECRET for hashing via
 *     its `customAPIKeyGetter`/`customKeyGenerator` hooks only when
 *     configured; in our config hashing is the SHA-256 + base64url
 *     default, so the secret is not actually required for hashing.
 *     We surface the check anyway because a missing value usually
 *     means the local D1 driver cannot resolve the auth schema.
 *   - The D1 binding `DB` reachable via wrangler's local driver
 *     (the script uses `wrangler d1 execute` so it does NOT need
 *     a Node fetch to the worker runtime).
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const KEY_NAME = 'home-self-consumption';
const KEY_PREFIX = 'mk_home_';
const START_LEN = 6;
/** Mirrors the plugin default `defaultKeyLength: 32` character alphabet. */
const KEY_BODY_LEN = 32;
const REQUIRED_SCOPES = {
	reactions: ['read', 'write'],
	access_counter: ['read', 'write'],
};

function loadDotEnv(path) {
	if (!existsSync(path)) return {};
	const out = {};
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq < 0) continue;
		let value = trimmed.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		out[trimmed.slice(0, eq).trim()] = value;
	}
	return out;
}

function resolveAdminUserId() {
	// Better Auth stores admin users in the `user` table with
	// `role = 'admin'`. The referenceId for the api-key must point
	// at the admin who "owns" the key. We pick the first admin by
	// alphabetical id (deterministic) — the project has exactly one
	// admin in 0.3.0.
	const result = execFileSync(
		'wrangler',
		[
			'd1',
			'execute',
			'DB',
			'--local',
			'--command',
			"SELECT id FROM user WHERE role = 'admin' ORDER BY id ASC LIMIT 1",
			'--json',
		],
		{ encoding: 'utf8' },
	);
	const parsed = JSON.parse(result);
	const row = parsed?.[0]?.results?.[0];
	if (!row?.id) {
		throw new Error(
			'No admin user found in the local D1 binding. Run `pnpm run dev` once and create an admin via the invitation flow first.',
		);
	}
	return row.id;
}

/**
 * The Better Auth api-key plugin generates a key from the alphabet
 * `[a-zA-Z]` (see `defaultKeyGenerator` in
 * `node_modules/@better-auth/api-key/dist/.../api-key.js`), prepends
 * the prefix, and stores `SHA-256(key)` base64url-encoded in the
 * `apikey.key` column. We mirror that shape so the validation path
 * can verify the plaintext we print here.
 */
function generatePlaintext() {
	const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
	const bytes = randomBytes(KEY_BODY_LEN);
	let body = '';
	for (let i = 0; i < KEY_BODY_LEN; i++) {
		body += alphabet[bytes[i] % alphabet.length];
	}
	return `${KEY_PREFIX}${body}`;
}

function base64UrlNoPad(bytes) {
	const b64 = Buffer.from(bytes).toString('base64');
	return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function defaultKeyHash(plaintext) {
	return base64UrlNoPad(createHash('sha256').update(plaintext).digest());
}

function insertKey({ userId, plaintext }) {
	const id = crypto.randomUUID();
	const now = Date.now();
	const hash = defaultKeyHash(plaintext);
	const start = plaintext.slice(0, START_LEN);
	const permissionsJson = JSON.stringify(REQUIRED_SCOPES);
	const sql = `INSERT INTO apikey (
		id, configId, name, start, referenceId, prefix, \`key\`,
		enabled, rateLimitEnabled, rateLimitTimeWindow, rateLimitMax,
		requestCount, remaining, lastRequest, expiresAt,
		lastRefillAt, refillInterval, refillAmount, metadata,
		createdAt, updatedAt, permissions
	) VALUES (
		'${id}', 'default', '${KEY_NAME}', '${start}', '${userId}', '${KEY_PREFIX}', '${hash}',
		1, 0, 60000, 60, 0, NULL, NULL, NULL,
		NULL, NULL, NULL, NULL,
		${now}, ${now}, '${permissionsJson.replace(/'/g, "''")}'
	)`;
	execFileSync('wrangler', ['d1', 'execute', 'DB', '--local', '--command', sql], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
	});
	return id;
}

function main() {
	const dotEnv = loadDotEnv('.dev.vars');
	const secret = dotEnv.BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET;
	if (!secret) {
		throw new Error(
			'BETTER_AUTH_SECRET is not set in .dev.vars or process.env. The api-key row references the auth secret via Better Auth plugin config; this script does not need it for hashing but a missing value usually means the local D1 driver cannot resolve the auth schema.',
		);
	}
	const userId = resolveAdminUserId();
	const plaintext = generatePlaintext();
	insertKey({ userId, plaintext });

	console.log('# Home self-consumption API key created.');
	console.log('# Store the value below as a Wrangler secret in your target environment.');
	console.log('#   local dev →  .dev.vars  : MY_WEB_2026_CONSUMER_API_KEY="…"');
	console.log('#   remote    →  wrangler secret put MY_WEB_2026_CONSUMER_API_KEY');
	console.log('');
	console.log(plaintext);
}

main();
