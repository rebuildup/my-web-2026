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
 * Targets:
 *   --target=local   (default) writes to the local wrangler D1
 *                    driver. Reads BETTER_AUTH_SECRET from
 *                    .dev.vars (which `pnpm run dev` populates).
 *   --target=remote  writes to the remote D1 bound by wrangler to
 *                    the production project. Requires
 *                    BETTER_AUTH_SECRET in process.env — the script
 *                    intentionally refuses .dev.vars here because
 *                    the local dev secret may not match the
 *                    production one.
 *
 * Production runbook:
 *   1. pnpm run db:migrate:remote    # apply migrations incl. 0005
 *   2. export BETTER_AUTH_SECRET=…   # the production secret
 *   3. node scripts/bootstrap-home-api-key.mjs --target=remote
 *   4. wrangler secret put MY_WEB_2026_CONSUMER_API_KEY
 *      < paste the printed value
 *   5. wrangler deploy
 *
 * Usage:
 *   node scripts/bootstrap-home-api-key.mjs [--target=local|remote]
 *   pnpm run bootstrap:home-api-key                 # defaults to local
 *   pnpm run bootstrap:home-api-key -- --target=remote
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

function parseTarget(argv) {
	// Accept both `--target remote` (two tokens) and `--target=remote`
	// (one token) for shell-style ergonomics.
	let v;
	const eq = argv.find((a) => a.startsWith('--target='));
	if (eq) {
		v = eq.slice('--target='.length);
	} else {
		const i = argv.indexOf('--target');
		if (i < 0) return 'local';
		v = argv[i + 1];
	}
	if (v !== 'local' && v !== 'remote') {
		throw new Error(
			`--target must be 'local' or 'remote' (got '${v}'). Usage: node scripts/bootstrap-home-api-key.mjs [--target=local|remote]`,
		);
	}
	return v;
}

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

/**
 * Pick the wrangler flag for the chosen target. The SQL payload is
 * identical between local and remote; only the binding transport
 * changes.
 */
function wranglerD1Args(target, command) {
	return ['d1', 'execute', 'DB', `--${target}`, '--command', command, '--json'];
}

function resolveAdminUserId(target) {
	// Better Auth stores admin users in the `user` table with
	// `role = 'admin'`. The referenceId for the api-key must point
	// at the admin who "owns" the key. We pick the first admin by
	// alphabetical id (deterministic) — the project has exactly one
	// admin in 0.3.0.
	const result = execFileSync(
		'wrangler',
		wranglerD1Args(target, "SELECT id FROM user WHERE role = 'admin' ORDER BY id ASC LIMIT 1"),
		{ encoding: 'utf8' },
	);
	const parsed = JSON.parse(result);
	const row = parsed?.[0]?.results?.[0];
	if (!row?.id) {
		const where =
			target === 'remote'
				? 'the remote D1 binding (production)'
				: 'the local D1 binding. Run `pnpm run dev` once and create an admin via the invitation flow first.';
		throw new Error(`No admin user found in ${where}`);
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

function insertKey({ target, userId, plaintext }) {
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
	execFileSync('wrangler', [...wranglerD1Args(target, sql).slice(0, -1)], {
		// Last entry was --json; strip it for the INSERT (no JSON
		// output expected) so wrangler uses its default table
		// formatting which surfaces row changes.
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
	});
	return id;
}

function main() {
	const target = parseTarget(process.argv.slice(2));
	let secret;
	if (target === 'remote') {
		// Refuse .dev.vars on the remote path — the local dev secret
		// may not match the production one, and silently using it
		// would create a key against a binding the worker never
		// reads from. Operator must export it in the shell.
		secret = process.env.BETTER_AUTH_SECRET;
		if (!secret) {
			throw new Error(
				'BETTER_AUTH_SECRET is not set in process.env. The remote path requires the production secret — export it before running:\n  export BETTER_AUTH_SECRET=…\n  node scripts/bootstrap-home-api-key.mjs --target=remote',
			);
		}
	} else {
		const dotEnv = loadDotEnv('.dev.vars');
		secret = dotEnv.BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET;
		if (!secret) {
			throw new Error(
				'BETTER_AUTH_SECRET is not set in .dev.vars or process.env. The api-key row references the auth secret via Better Auth plugin config; this script does not need it for hashing but a missing value usually means the local D1 driver cannot resolve the auth schema.',
			);
		}
	}
	const userId = resolveAdminUserId(target);
	const plaintext = generatePlaintext();
	insertKey({ target, userId, plaintext });

	console.log(`# Home self-consumption API key created (target=${target}).`);
	if (target === 'remote') {
		console.log('# Production runbook — finish in this order:');
		console.log('#   1. wrangler secret put MY_WEB_2026_CONSUMER_API_KEY');
		console.log('#        (paste the value below when prompted)');
		console.log('#   2. wrangler deploy');
		console.log('#   3. Verify with: curl -H "authorization: Bearer <key>" \\');
		console.log('#        https://rebuildup.dev/api/v1/reactions?target=home-page');
	} else {
		console.log('# Store the value below in your local secrets:');
		console.log('#   .dev.vars  : MY_WEB_2026_CONSUMER_API_KEY="…"');
	}
	console.log('');
	console.log(plaintext);
}

main();
