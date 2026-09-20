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
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

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

function insertKey(target, userId, plaintext) {
	const id = randomUUID();
	const now = Date.now();
	const hash = keyHash(plaintext);
	const permissions = sqlString(JSON.stringify(REQUIRED_SCOPES));
	execute(
		target,
		`INSERT INTO apikey (
			id, configId, name, start, referenceId, prefix, \`key\`,
			enabled, rateLimitEnabled, rateLimitTimeWindow, rateLimitMax,
			requestCount, remaining, lastRequest, expiresAt,
			lastRefillAt, refillInterval, refillAmount, metadata,
			createdAt, updatedAt, permissions
		) VALUES (
			'${id}', 'default', '${KEY_NAME}', '${sqlString(plaintext.slice(0, 6))}',
			'${sqlString(userId)}', '${KEY_PREFIX}', '${sqlString(hash)}',
			1, 0, 60000, 60, 0, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL,
			${now}, ${now}, '${permissions}'
		)`,
		false,
	);
}

const target = parseTarget(process.argv.slice(2));
const userId = resolveAdminUserId(target);
const plaintext = generatePlaintext();
insertKey(target, userId, plaintext);

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
