import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	AUTH_MODE,
	buildInfisicalEnv,
	buildWranglerEnv,
	compareSecretViaAuth,
	hmacDigest,
	materialiseSecret,
	preflightCliSession,
	readExplicitToken,
	resolveInfisicalAuth,
} from './_infisical-auth.mjs';

/**
 * `_infisical-auth.mjs` unit tests (Issue #223).
 *
 * Contract under test:
 *   1. `INFISICAL_TOKEN` present  -> TOKEN mode, token handed to the CLI
 *   2. absent + session reads     -> CLI mode, driver holds no token
 *   3. neither                    -> fail closed before any mutation
 *   4. no secret value is ever returned, logged, or put into argv
 *
 * The `spawn` seam is injected so the tests can assert the exact
 * argv/env handed to the CLI without executing the real binary. The
 * CLI child is expected to write an HMAC digest to the temp path
 * embedded in its script; the stub recovers that path and salt so it
 * can emulate a matching, mismatching, or missing secret.
 */

const SECRET = 'super-secret-value-not-for-transcript';
const PROJECT = '89cda9cb-31ab-4ace-afe9-f155024850d1';

function okSpawn() {
	return { status: 0, stdout: '', stderr: '' };
}

/**
 * Emulate the CLI child: recover the digest output path and the
 * one-shot salt from the `-e` script, then write the digest of
 * `observed` (or the literal MISSING marker).
 */
function fakeCliChild(observed) {
	return (bin, args, opts) => {
		const script = args[args.length - 1];
		const outPath = JSON.parse(/writeFileSync\(("[^"]+")/.exec(script)[1]);
		const salt = JSON.parse(/'sha256',\s*("[^"]+")/.exec(script)[1]);
		const body = observed === null ? 'MISSING' : hmacDigest(salt, observed);
		writeFileSync(outPath, body, { mode: 0o600 });
		fakeCliChild.last = { bin, args, opts };
		return okSpawn();
	};
}

test('readExplicitToken returns null for unset or empty token', () => {
	assert.equal(readExplicitToken({}), null);
	assert.equal(readExplicitToken({ INFISICAL_TOKEN: '' }), null);
	assert.equal(readExplicitToken({ INFISICAL_TOKEN: 'abc' }), 'abc');
});

test('resolveInfisicalAuth prefers an explicit token and never touches the CLI', async () => {
	let spawned = false;
	const auth = await resolveInfisicalAuth({
		env: { INFISICAL_TOKEN: 'explicit-token' },
		cliPath: '/bin/false',
		environment: 'prod',
		projectId: PROJECT,
		spawn: () => {
			spawned = true;
			return okSpawn();
		},
	});
	assert.equal(auth.mode, AUTH_MODE.TOKEN);
	assert.equal(auth.token, 'explicit-token');
	assert.equal(spawned, false, 'token mode must not probe the CLI session');
});

test('resolveInfisicalAuth falls back to the CLI session when no token is set', async () => {
	const auth = await resolveInfisicalAuth({
		env: {},
		cliPath: '/bin/true',
		environment: 'prod',
		projectId: PROJECT,
		spawn: okSpawn,
	});
	assert.equal(auth.mode, AUTH_MODE.CLI);
	assert.equal(auth.token, null);
});

test('resolveInfisicalAuth fails closed when the session cannot read the environment', async () => {
	await assert.rejects(
		() =>
			resolveInfisicalAuth({
				env: {},
				cliPath: '/bin/false',
				environment: 'prod',
				projectId: PROJECT,
				spawn: () => ({ status: 1, stdout: '', stderr: '' }),
			}),
		/cannot read environment=prod/,
	);
});

test('preflight surfaces a spawn error distinctly from a non-zero exit', async () => {
	await assert.rejects(
		() =>
			preflightCliSession({
				cliPath: '/bin/false',
				environment: 'prod',
				projectId: PROJECT,
				env: {},
				spawn: () => ({ status: 0, error: new Error('ENOENT') }),
			}),
		/preflight failed to run/,
	);
});

test('buildInfisicalEnv injects the token in token mode and strips UA fields', () => {
	const env = buildInfisicalEnv(
		{ PATH: '/bin', INFISICAL_CLIENT_ID: 'ua' },
		{ mode: AUTH_MODE.TOKEN, token: 'tok' },
	);
	assert.equal(env.INFISICAL_TOKEN, 'tok');
	assert.equal(env.PATH, '/bin');
	assert.equal(env.INFISICAL_CLIENT_ID, undefined);
});

test('buildInfisicalEnv strips every credential in CLI mode', () => {
	// An ambient token in the parent env must NOT reach the CLI in CLI
	// mode: the driver did not validate it, and the CLI should use its
	// own stored session.
	const env = buildInfisicalEnv(
		{ PATH: '/bin', INFISICAL_TOKEN: 'ambient', INFISICAL_CLIENT_ID: 'x' },
		{ mode: AUTH_MODE.CLI },
	);
	assert.equal(env.INFISICAL_TOKEN, undefined);
	assert.equal(env.INFISICAL_CLIENT_ID, undefined);
	assert.equal(env.PATH, '/bin');
});

test('buildWranglerEnv strips the full credential set', () => {
	const env = buildWranglerEnv({ PATH: '/bin', INFISICAL_TOKEN: 't' });
	assert.equal(env.INFISICAL_TOKEN, undefined);
	assert.equal(env.PATH, '/bin');
});

test('hmacDigest is stable under one salt, differs across salts, hides the value', () => {
	const a = hmacDigest('salt-a', SECRET);
	assert.equal(a, hmacDigest('salt-a', SECRET));
	assert.notEqual(a, hmacDigest('salt-b', SECRET));
	assert.ok(!a.includes(SECRET));
});

test('compareSecretViaAuth token mode: match, mismatch, missing', async () => {
	const base = {
		auth: { mode: AUTH_MODE.TOKEN },
		apiUrl: 'https://example.invalid',
		environment: 'prod',
		name: 'BETTER_AUTH_SECRET',
		expected: SECRET,
		token: 'tok',
	};
	let seenToken = null;
	const match = await compareSecretViaAuth({
		...base,
		readViaToken: async ({ token }) => {
			seenToken = token;
			return SECRET;
		},
	});
	assert.equal(match.status, 'match');
	assert.equal(seenToken, 'tok');
	assert.ok(!JSON.stringify(match).includes(SECRET));

	assert.equal(
		(await compareSecretViaAuth({ ...base, readViaToken: async () => 'other' })).status,
		'mismatch',
	);
	assert.equal(
		(await compareSecretViaAuth({ ...base, readViaToken: async () => null })).status,
		'missing',
	);
});

test('compareSecretViaAuth CLI mode never puts the expected value in argv', async () => {
	const spawn = fakeCliChild(SECRET);
	const result = await compareSecretViaAuth({
		auth: { mode: AUTH_MODE.CLI },
		cliPath: '/bin/true',
		environment: 'prod',
		projectId: PROJECT,
		name: 'BETTER_AUTH_SECRET',
		expected: SECRET,
		env: { PATH: '/bin' },
		spawn,
	});
	assert.equal(result.status, 'match');
	const { args, opts } = fakeCliChild.last;
	assert.ok(!JSON.stringify(args).includes(SECRET), 'expected value must not reach argv');
	assert.equal(opts.env.INFISICAL_TOKEN, undefined, 'CLI mode must not hand over a token');
	// The secret NAME is not sensitive and is embedded in the child
	// script so the child knows which env var to digest.
	assert.ok(
		args[args.length - 1].includes('BETTER_AUTH_SECRET'),
		'the child script must name the secret it digests',
	);
});

test('compareSecretViaAuth CLI mode: mismatch and missing', async () => {
	const common = {
		auth: { mode: AUTH_MODE.CLI },
		cliPath: '/bin/true',
		environment: 'prod',
		projectId: PROJECT,
		name: 'BETTER_AUTH_SECRET',
		expected: SECRET,
		env: {},
	};
	assert.equal(
		(await compareSecretViaAuth({ ...common, spawn: fakeCliChild('different') })).status,
		'mismatch',
	);
	assert.equal(
		(await compareSecretViaAuth({ ...common, spawn: fakeCliChild(null) })).status,
		'missing',
	);
});

test('compareSecretViaAuth CLI mode surfaces a child failure', async () => {
	await assert.rejects(
		() =>
			compareSecretViaAuth({
				auth: { mode: AUTH_MODE.CLI },
				cliPath: '/bin/false',
				environment: 'prod',
				projectId: PROJECT,
				name: 'BETTER_AUTH_SECRET',
				expected: SECRET,
				env: {},
				spawn: () => ({ status: 1, stdout: '', stderr: '' }),
			}),
		/digest read failed \(exit 1\)/,
	);
});

test('materialiseSecret token mode writes 0600 and cleans up on request', async () => {
	const handle = await materialiseSecret({
		auth: { mode: AUTH_MODE.TOKEN },
		apiUrl: 'https://example.invalid',
		environment: 'prod',
		name: 'BETTER_AUTH_SECRET',
		token: 'tok',
		readViaToken: async () => SECRET,
	});
	assert.equal(readFileSync(handle.path, 'utf8'), SECRET);
	const dir = handle.path.slice(0, handle.path.lastIndexOf('/'));
	assert.ok(existsSync(dir));
	handle.cleanup();
	assert.equal(existsSync(dir), false);
});

test('materialiseSecret CLI mode leaves no temp dir when the child fails', async () => {
	const before = new Set(readdirSync(tmpdir()));
	await assert.rejects(
		() =>
			materialiseSecret({
				auth: { mode: AUTH_MODE.CLI },
				cliPath: '/bin/false',
				environment: 'prod',
				projectId: PROJECT,
				name: 'BETTER_AUTH_SECRET',
				env: {},
				spawn: () => ({ status: 3, stdout: '', stderr: '' }),
			}),
		/is missing in environment=prod/,
	);
	const leaked = readdirSync(tmpdir()).filter(
		(n) => n.startsWith('my-web-2026-recovery-') && !before.has(n),
	);
	assert.deepEqual(leaked, [], 'a failed materialise must not leak a temp dir');
});

test('module code contains no value-listing or value-logging construct', () => {
	const source = readFileSync(new URL('./_infisical-auth.mjs', import.meta.url), 'utf8');
	// Strip comments first: the module's prose legitimately *names*
	// `secretValuesEqual` and `viewSecretValue` when explaining what it
	// must NOT do. The contract under test is about executable code.
	const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
	assert.ok(!/viewSecretValue/.test(code), 'module must not build a viewSecretValue URL');
	assert.ok(!/\bconsole\.(log|error)\([^)]*\bvalue\b/i.test(code), 'module must not log values');
});

test('temp prefixes are namespaced so cleanup sweeps can target them', () => {
	const source = readFileSync(new URL('./_infisical-auth.mjs', import.meta.url), 'utf8');
	assert.ok(source.includes('my-web-2026-authcheck-'));
	assert.ok(source.includes('my-web-2026-recovery-'));
	assert.ok(!join('/tmp', 'x').includes('undefined'));
});
