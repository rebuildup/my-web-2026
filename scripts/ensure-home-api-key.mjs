#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

const KEY_NAME = 'home-self-consumption';
const KEY_PREFIX = 'mk_home_';
const REQUIRED_SCOPES = {
	reactions: ['read', 'write'],
	access_counter: ['read', 'write'],
};

function d1(command) {
	return execFileSync(
		'pnpm',
		[
			'exec',
			'wrangler',
			'd1',
			'execute',
			'DB',
			'--remote',
			'-c',
			'wrangler.production.jsonc',
			'--command',
			command,
			'--json',
		],
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
	);
}

function query(command) {
	const parsed = JSON.parse(d1(command));
	return parsed?.[0]?.results ?? [];
}

function sqlString(value) {
	return String(value).replaceAll("'", "''");
}

function keyHash(plaintext) {
	return createHash('sha256').update(plaintext).digest('base64url');
}

const plaintext = process.env.MY_WEB_2026_CONSUMER_API_KEY;
if (!plaintext) {
	throw new Error(
		'MY_WEB_2026_CONSUMER_API_KEY must be provided by the production Actions environment.',
	);
}
if (!/^mk_home_[A-Za-z]{32}$/.test(plaintext)) {
	throw new Error('MY_WEB_2026_CONSUMER_API_KEY must match mk_home_ + 32 ASCII letters.');
}

const admins = query("SELECT id FROM user WHERE role = 'admin' ORDER BY id ASC LIMIT 1");
const userId = admins[0]?.id;
if (!userId) {
	throw new Error(
		'No production admin user exists in D1; create the admin before deploying the home consumer.',
	);
}

const hash = keyHash(plaintext);
const existing = query(`SELECT id FROM apikey WHERE \`key\` = '${sqlString(hash)}' LIMIT 1`)[0];
if (!existing?.id) {
	const id = randomUUID();
	const now = Date.now();
	const permissions = sqlString(JSON.stringify(REQUIRED_SCOPES));
	d1(`INSERT INTO apikey (
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
	)`);
	console.log('home consumer API-key row created');
} else {
	console.log('home consumer API-key row already present');
}

if (process.argv.includes('--disable-stale')) {
	d1(`UPDATE apikey SET enabled = 0, updatedAt = ${Date.now()}
		WHERE name = '${KEY_NAME}' AND \`key\` <> '${sqlString(hash)}' AND enabled <> 0`);
	console.log('stale home consumer API-key rows disabled');
}
