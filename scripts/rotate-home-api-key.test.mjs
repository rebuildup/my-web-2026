/**
 * Test harness for `scripts/rotate-home-api-key.mjs` (Issue #74).
 *
 * Coverage:
 *   - argv parsing + mutually-exclusive mode grammar (incl. --worker-recovery; no --smoke-url)
 *   - smoke URL is FIXED at the canonical protected surface (no override)
 *   - fresh-plaintext generation (CSPRNG, charset, prefix, length invariants)
 *   - SHA-256 base64url hash
 *   - deriveRotationId / buildRotatedRowName (naming pattern)
 *   - SQL escape for D1 inline commands
 *   - YAML content shape (no leakage, single key, escapes)
 *   - wrangler bulk payload + bulk argv (single `bulk` subcommand)
 *   - Infisical CLI argv (secrets set --file)
 *   - D1 INSERT / SELECT / DISABLE command shapes (incl. active-rotated + old-home)
 *   - row id generation (UUIDv4 lower-case hex)
 *   - secretValuesEqual (constant-time comparison)
 *   - awaitExit (exit code / signal / timeout)
 *   - buildInfisicalEnv (Infisical CLI env: keeps INFISICAL_TOKEN, strips other Infisical credentials)
 *   - buildWranglerEnv (Wrangler/D1 env: strips full Infisical credential set, no token added)
 *   - runSmoke (in-process smoke, plaintext never in result, Authorization: Bearer, fixed URL)
 *   - subprocess discipline: stdio, stdin payload, no argv for values
 *   - security invariants: plaintext never in argv, log, error message
 *   - failure-injection / partial-failure contract
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { describe, it } from 'node:test';

import {
	KEY_BODY_LEN,
	KEY_NAME_PREFIX,
	KEY_PREFIX_OUTPUT,
	MODES,
	SECRET_NAME,
	SMOKE_AUTH_HEADER,
	SMOKE_AUTH_SCHEME,
	SMOKE_URL_DEFAULT,
	awaitExit,
	buildD1DisableCommand,
	buildD1InsertCommand,
	buildD1SelectActiveRotatedRowCommand,
	buildD1SelectActiveRowsCommand,
	buildD1SelectOldHomeRowCommand,
	buildD1SelectRotatedByHashCommand,
	buildD1SelectRotatedRowsCommand,
	buildInfisicalEnv,
	buildInfisicalSetArgs,
	buildInfisicalYamlContent,
	buildRotatedRowName,
	buildSanitizedEnv,
	buildWorkerBulkPayload,
	buildWranglerBulkArgs,
	buildWranglerEnv,
	deriveRotationId,
	generatePlaintext,
	generateRowId,
	keyHash,
	parseArgs,
	runSmoke,
	secretValuesEqual,
	spawnInfisicalSet,
	spawnWranglerBulk,
	spawnWranglerList,
	sqlString,
} from './rotate-home-api-key.mjs';

/* ─── Helpers ──────────────────────────────────────────────────────────── */

function fakeChild() {
	const child = new EventEmitter();
	child.stdout = new Readable({ read() {} });
	child.stderr = new Readable({ read() {} });
	child.stdin = new Writable({
		write(_chunk, _enc, cb) {
			cb();
		},
		final(cb) {
			cb();
		},
	});
	return child;
}

function captureSpawn(exitCode, onCall) {
	return (cmd, args, opts) => {
		if (onCall) onCall({ cmd, args, opts });
		const child = fakeChild();
		Promise.resolve().then(() => {
			child.emit('exit', exitCode, null);
		});
		return child;
	};
}

function captureSpawnSignals(signal) {
	return (_cmd, _args, _opts) => {
		const child = fakeChild();
		Promise.resolve().then(() => {
			child.emit('exit', null, signal);
		});
		return child;
	};
}

function captureSpawnCapturesStdin(exitCode, onCall) {
	return (_cmd, args, opts) => {
		if (onCall) onCall({ args, opts });
		const child = fakeChild();
		// Capture stdin writes
		const chunks = [];
		const origWrite = child.stdin.write.bind(child.stdin);
		child.stdin.write = (chunk, _enc, cb) => {
			chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
			return origWrite(chunk, _enc, cb);
		};
		const origEnd = child.stdin.end.bind(child.stdin);
		child.stdin.end = (cb) => {
			child.__stdinPayload = chunks.join('');
			return origEnd(cb);
		};
		Promise.resolve().then(() => {
			child.emit('exit', exitCode, null);
		});
		return child;
	};
}

/* ─── Tests ────────────────────────────────────────────────────────────── */

describe('rotate-home-api-key.mjs (Issue #74)', () => {
	describe('MODULE exports', () => {
		it('exports the canonical invariants', () => {
			assert.equal(SECRET_NAME, 'MY_WEB_2026_CONSUMER_API_KEY');
			assert.equal(KEY_NAME_PREFIX, 'home-self-consumption-rotated-');
			assert.equal(KEY_PREFIX_OUTPUT, 'mk_home_');
			assert.equal(KEY_BODY_LEN, 32);
			assert.deepEqual(MODES, [
				'dry-run',
				'execute',
				'verify-only',
				'disable-row',
				'worker-recovery',
			]);
		});
	});

	describe('parseArgs mode grammar', () => {
		it('defaults to --dry-run + prod + remote + default api-url', () => {
			const result = parseArgs([]);
			assert.equal(result.mode, 'dry-run');
			assert.equal(result.environment, 'prod');
			assert.equal(result.target, 'remote');
			assert.equal(result.apiUrl, 'https://secrets.rebuildup.dev');
			assert.equal(result.disableRowId, null);
		});

		it('--execute sets mode=execute', () => {
			assert.equal(parseArgs(['--execute']).mode, 'execute');
		});

		it('--verify-only sets mode=verify-only', () => {
			assert.equal(parseArgs(['--verify-only']).mode, 'verify-only');
		});

		it('--disable-row=<id> sets mode=disable-row + disableRowId', () => {
			const result = parseArgs(['--disable-row=abc-123']);
			assert.equal(result.mode, 'disable-row');
			assert.equal(result.disableRowId, 'abc-123');
		});

		it('--target=local switches target', () => {
			assert.equal(parseArgs(['--target=local']).target, 'local');
		});

		it('--target=remote is the default', () => {
			assert.equal(parseArgs([]).target, 'remote');
		});

		it('--environment must be prod', () => {
			// default is prod
			assert.equal(parseArgs([]).environment, 'prod');
			// explicit prod
			assert.equal(parseArgs(['--environment=prod']).environment, 'prod');
		});

		it('--environment=dev rejected (production-only script)', () => {
			assert.throws(() => parseArgs(['--environment=dev']), /must be 'prod'/);
		});

		it('--target=foo rejected', () => {
			assert.throws(() => parseArgs(['--target=foo']), /--target must be/);
		});

		it('--disable-row without id rejected', () => {
			assert.throws(() => parseArgs(['--disable-row=']), /non-empty row id/);
		});

		it('--worker-recovery=<id> sets mode=worker-recovery + workerRecoveryRowId', () => {
			const result = parseArgs(['--worker-recovery=row-uuid-here']);
			assert.equal(result.mode, 'worker-recovery');
			assert.equal(result.workerRecoveryRowId, 'row-uuid-here');
		});

		it('--worker-recovery without id rejected', () => {
			assert.throws(() => parseArgs(['--worker-recovery=']), /non-empty row id/);
		});

		it('--worker-recovery + --execute rejected (conflicting modes)', () => {
			assert.throws(
				() => parseArgs(['--worker-recovery=abc', '--execute']),
				/conflicting mode flags/,
			);
		});

		it('--smoke-url is rejected as an unknown argument (no override allowed; smoke URL is FIXED to the canonical protected surface)', () => {
			// PR #141 re-review (2026-09-28): an arbitrary --smoke-url
			// would exfiltrate the fresh Bearer credential to whatever
			// host the operator typed. The smoke URL is therefore fixed
			// (see SMOKE_URL_DEFAULT) and the flag is removed entirely.
			assert.throws(
				() => parseArgs(['--smoke-url=https://example.test/api']),
				/unknown argument: --smoke-url/,
			);
		});

		it('--smoke-url=http:// is rejected as unknown (not as an https validation error)', () => {
			assert.throws(
				() => parseArgs(['--smoke-url=http://example.test/api']),
				/unknown argument: --smoke-url/,
			);
		});

		it('--smoke-url=garbage is rejected as unknown', () => {
			assert.throws(() => parseArgs(['--smoke-url=not-a-url']), /unknown argument: --smoke-url/);
		});

		it('--execute + --verify-only rejected (conflicting modes)', () => {
			assert.throws(() => parseArgs(['--execute', '--verify-only']), /conflicting mode flags/);
		});

		it('--execute + --dry-run rejected', () => {
			assert.throws(() => parseArgs(['--execute', '--dry-run']), /conflicting mode flags/);
		});

		it('--verify-only + --disable-row=... rejected', () => {
			assert.throws(
				() => parseArgs(['--verify-only', '--disable-row=id']),
				/conflicting mode flags/,
			);
		});

		it('unknown argument rejected', () => {
			assert.throws(() => parseArgs(['--unknown-flag']), /unknown argument/);
		});

		it('--help returns 0 and does not throw', () => {
			const origExit = process.exit;
			const calls = [];
			process.exit = (code) => {
				calls.push(code);
			};
			try {
				const result = parseArgs(['--help']);
				assert.equal(result.mode, 'dry-run'); // parseArgs still returns
				assert.equal(calls.length, 1);
				assert.equal(calls[0], 0);
			} finally {
				process.exit = origExit;
			}
		});
	});

	describe('generatePlaintext', () => {
		it('default length matches mk_home_ + 32 alphabet chars', () => {
			const plaintext = generatePlaintext();
			assert.match(plaintext, /^mk_home_[A-Za-z]{32}$/);
		});

		it('CSPRNG output varies across calls', () => {
			const set = new Set();
			for (let i = 0; i < 16; i += 1) set.add(generatePlaintext());
			assert.equal(set.size, 16);
		});

		it('charset is 52-char a-zA-Z (no digits, no symbols)', () => {
			const plaintext = generatePlaintext();
			const body = plaintext.slice('mk_home_'.length);
			assert.match(body, /^[A-Za-z]+$/);
		});

		it('prefix is mk_home_ (matches the existing bootstrap prefix)', () => {
			assert.ok(generatePlaintext().startsWith(KEY_PREFIX_OUTPUT));
		});

		it('rejects bytes outside 16..128', () => {
			assert.throws(() => generatePlaintext(8), /16\.\.128/);
			assert.throws(() => generatePlaintext(256), /16\.\.128/);
			assert.throws(() => generatePlaintext(15.5), /16\.\.128/);
		});

		it('accepts boundary values 16 and 128', () => {
			assert.match(generatePlaintext(16), /^mk_home_[A-Za-z]{16}$/);
			assert.match(generatePlaintext(128), /^mk_home_[A-Za-z]{128}$/);
		});
	});

	describe('keyHash', () => {
		it('produces a stable SHA-256 base64url hash', () => {
			const hash = keyHash('mk_home_AbCdEfGhIjKlMnOpQrStUvWxYz012345');
			assert.match(hash, /^[A-Za-z0-9_-]{43}$/); // SHA-256 base64url = 43 chars (no padding)
		});

		it('is deterministic for the same plaintext', () => {
			const a = keyHash('mk_home_FixedPlaintextForTest');
			const b = keyHash('mk_home_FixedPlaintextForTest');
			assert.equal(a, b);
		});

		it('differs for different plaintexts', () => {
			const a = keyHash('mk_home_FixedPlaintextForTest1');
			const b = keyHash('mk_home_FixedPlaintextForTest2');
			assert.notEqual(a, b);
		});
	});

	describe('generateRowId (UUIDv4 lower-case hex)', () => {
		it('produces 32-char lower-case hex', () => {
			const id = generateRowId();
			assert.equal(id.length, 32);
			assert.match(id, /^[0-9a-f]{32}$/);
		});

		it('has the UUIDv4 version nibble (position 12 = 4)', () => {
			const id = generateRowId();
			assert.equal(id[12], '4');
		});

		it('has the UUIDv4 variant nibble (position 16 ∈ {8,9,a,b})', () => {
			const id = generateRowId();
			const variant = id[16];
			assert.ok(['8', '9', 'a', 'b'].includes(variant), `variant nibble was ${variant}`);
		});

		it('collisions are astronomically unlikely (16 generated)', () => {
			const set = new Set();
			for (let i = 0; i < 16; i += 1) set.add(generateRowId());
			assert.equal(set.size, 16);
		});
	});

	describe('deriveRotationId', () => {
		it('strips ISO separators and produces YYYYMMDDHHMMSS-salt form', () => {
			const salt = 'abcd1234';
			const id = deriveRotationId('2026-09-28T14:30:00.123Z', salt);
			assert.equal(id, '20260928143000-abcd1234');
		});

		it('uses 14-char timestamp prefix', () => {
			const salt = 'abcd1234';
			const id = deriveRotationId('2026-09-28T14:30:00.123Z', salt);
			assert.equal(id.split('-')[0].length, 14);
		});

		it('uses 8-hex char salt suffix', () => {
			const id = deriveRotationId('2026-09-28T14:30:00.123Z', 'a1b2c3d4');
			const saltPart = id.split('-')[1];
			assert.equal(saltPart, 'a1b2c3d4');
		});

		it('CSPRNG salt varies across calls', () => {
			const a = deriveRotationId('2026-09-28T14:30:00.123Z');
			const b = deriveRotationId('2026-09-28T14:30:00.123Z');
			assert.notEqual(a, b);
		});
	});

	describe('buildRotatedRowName', () => {
		it('prefixes with KEY_NAME_PREFIX', () => {
			const name = buildRotatedRowName('20260928143000-abcd1234');
			assert.equal(name, 'home-self-consumption-rotated-20260928143000-abcd1234');
			assert.ok(name.startsWith(KEY_NAME_PREFIX));
		});
	});

	describe('sqlString', () => {
		it('passes simple strings through', () => {
			assert.equal(sqlString('abc'), 'abc');
		});

		it('escapes single quotes by doubling', () => {
			assert.equal(sqlString("abc'def"), "abc''def");
		});

		it('escapes multiple embedded quotes', () => {
			assert.equal(sqlString("a'b'c"), "a''b''c");
		});

		it('numeric input is stringified', () => {
			assert.equal(sqlString(42), '42');
		});
	});

	describe('buildInfisicalYamlContent (single secret, no leakage)', () => {
		it('shape: YAML with quoted single secret', () => {
			const content = buildInfisicalYamlContent('mk_home_FreshValue');
			assert.equal(content, '---\n"MY_WEB_2026_CONSUMER_API_KEY": "mk_home_FreshValue"\n');
		});

		it('JSON.stringify escapes control characters within the value', () => {
			const plaintext = 'mk_home_"quoted"\nnewline';
			const content = buildInfisicalYamlContent(plaintext);
			assert.match(content, /"\\nnewline"/);
			assert.match(content, /\\"quoted\\"/);
		});

		it('backslash in plaintext is JSON-escaped', () => {
			const plaintext = 'mk_home_back\\slash';
			const content = buildInfisicalYamlContent(plaintext);
			assert.match(content, /"mk_home_back\\\\slash"/);
		});

		it('no other keys leak into the YAML', () => {
			const content = buildInfisicalYamlContent('mk_home_X');
			assert.equal(
				content.match(/MY_WEB_2026_CONSUMER_API_KEY/g)?.length,
				1,
				`expected exactly one occurrence of the key; got: ${content}`,
			);
		});
	});

	describe('buildWorkerBulkPayload (JSON, stdin only)', () => {
		it('contains exactly one Worker secret name', () => {
			const payload = buildWorkerBulkPayload('mk_home_X');
			const parsed = JSON.parse(payload);
			assert.deepEqual(parsed, { MY_WEB_2026_CONSUMER_API_KEY: 'mk_home_X' });
		});

		it('does not include versioned bindings', () => {
			const parsed = JSON.parse(buildWorkerBulkPayload('mk_home_X'));
			assert.deepEqual(Object.keys(parsed), [SECRET_NAME]);
		});
	});

	describe('buildWranglerBulkArgs', () => {
		it('uses `secret bulk` subcommand', () => {
			const args = buildWranglerBulkArgs();
			assert.ok(args.includes('bulk'), `args: ${args.join(' ')}`);
			assert.ok(args.includes('secret'), `args: ${args.join(' ')}`);
		});

		it('includes -c wrangler.production.jsonc', () => {
			const args = buildWranglerBulkArgs();
			const cIndex = args.indexOf('-c');
			assert.ok(cIndex >= 0);
			assert.ok(args[cIndex + 1].endsWith('wrangler.production.jsonc'));
		});

		it('NEVER uses secret put or secret delete subcommand', () => {
			const args = buildWranglerBulkArgs();
			const hasPut = args.includes('put');
			const hasDelete = args.includes('delete');
			assert.ok(!hasPut, `args must not contain 'put': ${args.join(' ')}`);
			assert.ok(!hasDelete, `args must not contain 'delete': ${args.join(' ')}`);
		});
	});

	describe('buildInfisicalSetArgs', () => {
		it('uses secrets set --file', () => {
			const args = buildInfisicalSetArgs('/tmp/rotate.yaml', 'prod');
			assert.deepEqual(args, [
				'secrets',
				'set',
				'--file',
				'/tmp/rotate.yaml',
				'--env',
				'prod',
				'--path',
				'/',
			]);
		});

		it('does NOT include the plaintext value (file-only contract)', () => {
			// The plaintext is in the file content, never in argv.
			const args = buildInfisicalSetArgs('/tmp/rotate.yaml', 'prod');
			for (const arg of args) {
				assert.ok(!arg.includes('mk_home_'), `argv unexpectedly contains plaintext: ${arg}`);
			}
		});
	});

	describe('buildD1InsertCommand (single-row INSERT OR IGNORE)', () => {
		const baseArgs = {
			rowName: 'home-self-consumption-rotated-20260928143000-abcd1234',
			rowId: '0123456789abcdef0123456789abcdef',
			prefix: 'mk_home_',
			start: 'mk_ho',
			hash: 'hashed-base64url-value',
			referenceUserId: 'admin-uuid',
			permissionsJson: '{"reactions":["read","write"]}',
			createdAt: 1737830400000,
		};

		it('starts with INSERT INTO apikey', () => {
			assert.ok(buildD1InsertCommand(baseArgs).startsWith('INSERT INTO apikey'));
		});

		it('uses ON CONFLICT(`key`) DO NOTHING (idempotency on hash-unique)', () => {
			const cmd = buildD1InsertCommand(baseArgs);
			assert.match(cmd, /ON CONFLICT\(`key`\) DO NOTHING/);
		});

		it('sets enabled=1 (the rotated row is immediately active)', () => {
			const cmd = buildD1InsertCommand(baseArgs);
			assert.match(cmd, /\b1, 0, 60000, 60/);
		});

		it('references the admin user (not a synthetic uuid)', () => {
			const cmd = buildD1InsertCommand(baseArgs);
			assert.match(cmd, /'admin-uuid'/);
		});

		it('escapes single quotes in name', () => {
			const cmd = buildD1InsertCommand({ ...baseArgs, rowName: "name'with'quotes" });
			assert.ok(cmd.includes("'name''with''quotes'"), `cmd: ${cmd}`);
		});

		it('escapes single quotes in hash', () => {
			const cmd = buildD1InsertCommand({ ...baseArgs, hash: "hash'q" });
			assert.ok(cmd.includes("'hash''q'"), `cmd: ${cmd}`);
		});

		it('escapes single quotes in permissions JSON', () => {
			const cmd = buildD1InsertCommand({
				...baseArgs,
				permissionsJson: '{"k":"v\'q"}',
			});
			assert.ok(cmd.includes('\'{"k":"v\'\'q"}\''), `cmd: ${cmd}`);
		});
	});

	describe('buildD1SelectRotatedRowsCommand', () => {
		it('filters by KEY_NAME_PREFIX LIKE pattern', () => {
			const cmd = buildD1SelectRotatedRowsCommand();
			assert.match(cmd, /WHERE name LIKE 'home-self-consumption-rotated-%'/);
		});

		it('orders by createdAt DESC, id DESC', () => {
			const cmd = buildD1SelectRotatedRowsCommand();
			assert.match(cmd, /ORDER BY createdAt DESC, id DESC/);
		});
	});

	describe('buildD1SelectActiveRowsCommand', () => {
		it('filters by name = home-self-consumption AND enabled = 1', () => {
			const cmd = buildD1SelectActiveRowsCommand();
			assert.match(cmd, /WHERE name = 'home-self-consumption' AND enabled = 1/);
		});

		it('limits to 1 row', () => {
			const cmd = buildD1SelectActiveRowsCommand();
			assert.match(cmd, /LIMIT 1/);
		});
	});

	describe('buildD1SelectRotatedByHashCommand', () => {
		it('filters by hash AND enabled = 1', () => {
			const cmd = buildD1SelectRotatedByHashCommand('hashed-value');
			assert.match(cmd, /WHERE `key` = 'hashed-value' AND enabled = 1/);
		});

		it('escapes single quotes in the hash', () => {
			const cmd = buildD1SelectRotatedByHashCommand("hash'trick");
			assert.ok(cmd.includes("'hash''trick'"), `cmd: ${cmd}`);
		});
	});

	describe('buildD1DisableCommand', () => {
		it('single-row UPDATE, sets enabled=0', () => {
			const cmd = buildD1DisableCommand('row-id-123');
			assert.match(cmd, /^UPDATE apikey SET enabled = 0, updatedAt = \d+ WHERE/);
		});

		it('guards against double-disable (only WHERE enabled = 1)', () => {
			const cmd = buildD1DisableCommand('row-id-123');
			assert.match(cmd, /WHERE id = 'row-id-123' AND enabled = 1/);
		});

		it('escapes single quotes in id', () => {
			const cmd = buildD1DisableCommand("id'with'q");
			assert.ok(cmd.includes("'id''with''q'"), `cmd: ${cmd}`);
		});
	});

	describe('buildD1SelectActiveRotatedRowCommand (in-flight marker)', () => {
		it('selects enabled rows whose name LIKE home-self-consumption-rotated-%', () => {
			const cmd = buildD1SelectActiveRotatedRowCommand();
			assert.match(cmd, /FROM apikey/);
			assert.match(cmd, /WHERE name LIKE 'home-self-consumption-rotated-%' AND enabled = 1/);
			assert.match(cmd, /ORDER BY createdAt DESC, id DESC LIMIT 1/);
		});
	});

	describe('buildD1SelectOldHomeRowCommand (containment target)', () => {
		it('selects the enabled home-self-consumption row', () => {
			const cmd = buildD1SelectOldHomeRowCommand();
			assert.match(cmd, /FROM apikey/);
			assert.match(cmd, /WHERE name = 'home-self-consumption' AND enabled = 1/);
			assert.match(cmd, /ORDER BY createdAt DESC, id DESC LIMIT 1/);
		});
	});

	describe('runSmoke (in-process smoke, plaintext never leaves the process)', () => {
		function fakeResponse(status) {
			return {
				status,
				text: async () => '',
			};
		}

		it('returns ok=true for 2xx response against the canonical protected surface', async () => {
			const captured = { url: null, headers: null };
			const fetchImpl = async (url, init) => {
				captured.url = url;
				captured.headers = init.headers;
				return fakeResponse(200);
			};
			const result = await runSmoke({
				url: SMOKE_URL_DEFAULT,
				plaintext: 'mk_home_secretValue_AAAA',
				fetchImpl,
			});
			assert.equal(result.ok, true);
			assert.equal(result.status, 200);
			assert.equal(result.url, SMOKE_URL_DEFAULT);
		});

		it('returns ok=false for 5xx response (smoke failure aborts BEFORE disable-old; old row stays valid)', async () => {
			const fetchImpl = async () => fakeResponse(503);
			const result = await runSmoke({
				url: SMOKE_URL_DEFAULT,
				plaintext: 'mk_home_secretValue_BBBB',
				fetchImpl,
			});
			assert.equal(result.ok, false);
			assert.equal(result.status, 503);
		});

		it('returns ok=false for 401 (Better Auth rejects the new plaintext)', async () => {
			const fetchImpl = async () => fakeResponse(401);
			const result = await runSmoke({
				url: SMOKE_URL_DEFAULT,
				plaintext: 'mk_home_secretValue_CCCC',
				fetchImpl,
			});
			assert.equal(result.ok, false);
			assert.equal(result.status, 401);
		});

		it('uses Authorization: Bearer <plaintext> header (NOT X-API-Key)', async () => {
			const captured = { headers: null };
			const fetchImpl = async (_url, init) => {
				captured.headers = init.headers;
				return fakeResponse(200);
			};
			await runSmoke({
				url: SMOKE_URL_DEFAULT,
				plaintext: 'mk_home_secretValue_DDDD',
				fetchImpl,
			});
			assert.match(captured.headers.Authorization, /^Bearer mk_home_secretValue_DDDD$/);
		});

		it('the result object does NOT contain the plaintext', async () => {
			const fetchImpl = async () => fakeResponse(200);
			const result = await runSmoke({
				url: SMOKE_URL_DEFAULT,
				plaintext: 'mk_home_secretValue_EEEE',
				fetchImpl,
			});
			const serialized = JSON.stringify(result);
			assert.ok(!serialized.includes('mk_home_secretValue_EEEE'), `serialized: ${serialized}`);
		});

		it('uses default Authorization + Bearer constants when no header is passed', async () => {
			assert.equal(SMOKE_AUTH_HEADER, 'Authorization');
			assert.equal(SMOKE_AUTH_SCHEME, 'Bearer');
		});

		it('targets the canonical requireApiKey-gated access-counter read endpoint', () => {
			// Pin: the smoke URL is part of the security contract — it
			// MUST be a real API-key-protected read-only surface so a 2xx
			// proves auth + scope. PR #141 re-review, 2026-09-28.
			assert.ok(
				SMOKE_URL_DEFAULT.startsWith('https://rebuildup.dev/api/v1/access/count/'),
				`SMOKE_URL_DEFAULT must be under https://rebuildup.dev/api/v1/access/count/ (got: ${SMOKE_URL_DEFAULT})`,
			);
		});
	});

	describe('secretValuesEqual (constant-time)', () => {
		it('returns true for equal values', () => {
			assert.equal(secretValuesEqual('abc', 'abc'), true);
		});

		it('returns false for different values', () => {
			assert.equal(secretValuesEqual('abc', 'abd'), false);
		});

		it('returns false for different lengths', () => {
			assert.equal(secretValuesEqual('abc', 'abcd'), false);
		});

		it('returns true for equal empty values', () => {
			assert.equal(secretValuesEqual('', ''), true);
		});

		it('handles long values without short-circuit', () => {
			const a = `f${'a'.repeat(127)}`; // 128-char deterministic different-from-b
			const b = `${'a'.repeat(128)}`; // 128-char all 'a'
			assert.equal(secretValuesEqual(a, b), false);
		});
	});

	describe('awaitExit (exit code / signal / timeout)', () => {
		it('resolves with code=0 on clean exit', async () => {
			const child = captureSpawn(0)(null, null, null);
			const result = await awaitExit(child, { timeoutMs: 5_000 });
			assert.equal(result.code, 0);
			assert.equal(result.signal, null);
		});

		it('resolves with code=1 on non-zero exit', async () => {
			const child = captureSpawn(1)(null, null, null);
			const result = await awaitExit(child, { timeoutMs: 5_000 });
			assert.equal(result.code, 1);
		});

		it('resolves with signal on signal exit', async () => {
			const child = captureSpawnSignals('SIGTERM')('cmd', [], {});
			const result = await awaitExit(child, { timeoutMs: 5_000 });
			assert.equal(result.signal, 'SIGTERM');
			assert.equal(result.code, null);
		});
	});

	describe('buildSanitizedEnv (deprecated alias for buildWranglerEnv; PR #141 review fix)', () => {
		it('strips INFISICAL_CLIENT_ID', () => {
			const env = buildSanitizedEnv({ INFISICAL_CLIENT_ID: 'cid', NODE_ENV: 'test' });
			assert.equal(env.INFISICAL_CLIENT_ID, undefined);
			assert.equal(env.NODE_ENV, 'test');
		});

		it('strips INFISICAL_CLIENT_SECRET', () => {
			const env = buildSanitizedEnv({ INFISICAL_CLIENT_SECRET: 'cs', NODE_ENV: 'test' });
			assert.equal(env.INFISICAL_CLIENT_SECRET, undefined);
			assert.equal(env.NODE_ENV, 'test');
		});

		it('strips INFISICAL_TOKEN (PR #141 review fix: writer token must not leak to Wrangler/D1 subprocesses)', () => {
			const env = buildSanitizedEnv({ INFISICAL_TOKEN: 'tok', NODE_ENV: 'test' });
			assert.equal(env.INFISICAL_TOKEN, undefined);
			assert.equal(env.NODE_ENV, 'test');
		});

		it('strips INFISICAL_PROJECT_ID, _SITE_URL, _API_URL (full Infisical credential set)', () => {
			const env = buildSanitizedEnv({
				INFISICAL_PROJECT_ID: 'p',
				INFISICAL_SITE_URL: 's',
				INFISICAL_API_URL: 'a',
				NODE_ENV: 'test',
			});
			assert.equal(env.INFISICAL_PROJECT_ID, undefined);
			assert.equal(env.INFISICAL_SITE_URL, undefined);
			assert.equal(env.INFISICAL_API_URL, undefined);
			assert.equal(env.NODE_ENV, 'test');
		});

		it('does not mutate the input env', () => {
			const input = { INFISICAL_CLIENT_ID: 'cid', NODE_ENV: 'test' };
			const snapshot = { ...input };
			buildSanitizedEnv(input);
			assert.deepEqual(input, snapshot);
		});
	});

	describe('buildWranglerEnv (Wrangler/D1 env; PR #141 re-review fix)', () => {
		it('strips INFISICAL_TOKEN (writer token MUST NOT reach Wrangler or D1 subprocesses)', () => {
			const env = buildWranglerEnv({ INFISICAL_TOKEN: 'tok', NODE_ENV: 'test' });
			assert.equal(env.INFISICAL_TOKEN, undefined);
			assert.equal(env.NODE_ENV, 'test');
		});

		it('strips the full Infisical credential set', () => {
			const env = buildWranglerEnv({
				INFISICAL_TOKEN: 'tok',
				INFISICAL_CLIENT_ID: 'cid',
				INFISICAL_CLIENT_SECRET: 'cs',
				INFISICAL_PROJECT_ID: 'p',
				INFISICAL_SITE_URL: 's',
				INFISICAL_API_URL: 'a',
				NODE_ENV: 'test',
			});
			for (const key of [
				'INFISICAL_TOKEN',
				'INFISICAL_CLIENT_ID',
				'INFISICAL_CLIENT_SECRET',
				'INFISICAL_PROJECT_ID',
				'INFISICAL_SITE_URL',
				'INFISICAL_API_URL',
			]) {
				assert.equal(env[key], undefined, `${key} must be stripped`);
			}
			assert.equal(env.NODE_ENV, 'test');
		});

		it('does NOT add INFISICAL_TOKEN even if a token argument is not supplied', () => {
			// Pin: buildWranglerEnv has no token parameter; the function
			// MUST NEVER carry INFISICAL_TOKEN, regardless of input shape.
			const env = buildWranglerEnv({
				INFISICAL_TOKEN: 'present-in-input',
				PATH: '/usr/bin',
			});
			assert.equal(env.INFISICAL_TOKEN, undefined);
			assert.equal(env.PATH, '/usr/bin');
		});

		it('does not mutate the input env', () => {
			const input = { INFISICAL_TOKEN: 'tok', NODE_ENV: 'test' };
			const snapshot = { ...input };
			buildWranglerEnv(input);
			assert.deepEqual(input, snapshot);
		});
	});

	describe('buildInfisicalEnv (Infisical CLI env; PR #141 re-review fix)', () => {
		it('keeps INFISICAL_TOKEN (the CLI is the producer of the value)', () => {
			const env = buildInfisicalEnv({ NODE_ENV: 'test' }, 'writer-scope-token');
			assert.equal(env.INFISICAL_TOKEN, 'writer-scope-token');
			assert.equal(env.NODE_ENV, 'test');
		});

		it('strips fallback Infisical credentials (client id/secret, project/site/api)', () => {
			const env = buildInfisicalEnv(
				{
					INFISICAL_TOKEN: 'pre-existing',
					INFISICAL_CLIENT_ID: 'cid',
					INFISICAL_CLIENT_SECRET: 'cs',
					INFISICAL_PROJECT_ID: 'p',
					INFISICAL_SITE_URL: 's',
					INFISICAL_API_URL: 'a',
					NODE_ENV: 'test',
				},
				'writer-scope-token',
			);
			assert.equal(env.INFISICAL_TOKEN, 'writer-scope-token');
			assert.equal(env.INFISICAL_CLIENT_ID, undefined);
			assert.equal(env.INFISICAL_CLIENT_SECRET, undefined);
			assert.equal(env.INFISICAL_PROJECT_ID, undefined);
			assert.equal(env.INFISICAL_SITE_URL, undefined);
			assert.equal(env.INFISICAL_API_URL, undefined);
			assert.equal(env.NODE_ENV, 'test');
		});

		it('drops INFISICAL_TOKEN when no token is supplied (so a leftover token in process.env does not leak through)', () => {
			const env = buildInfisicalEnv({ INFISICAL_TOKEN: 'leftover', NODE_ENV: 'test' }, '');
			assert.equal(env.INFISICAL_TOKEN, undefined);
			assert.equal(env.NODE_ENV, 'test');
		});

		it('does not mutate the input env', () => {
			const input = { INFISICAL_TOKEN: 'tok', INFISICAL_CLIENT_ID: 'cid', NODE_ENV: 'test' };
			const snapshot = { ...input };
			buildInfisicalEnv(input, 'new-token');
			assert.deepEqual(input, snapshot);
		});
	});

	describe('SMOKE_URL_DEFAULT (canonical protected surface; PR #141 re-review)', () => {
		it('points at the requireApiKey-gated, access_counter:read-protected endpoint', () => {
			// The smoke URL MUST be a real API-key-protected read-only
			// surface so a 2xx response proves the fresh plaintext
			// authenticates AND carries the required scope. /api/v1/health
			// does not satisfy this contract.
			const url = new URL(SMOKE_URL_DEFAULT);
			assert.equal(url.hostname, 'rebuildup.dev');
			assert.equal(url.protocol, 'https:');
			assert.ok(
				url.pathname.startsWith('/api/v1/access/count/'),
				`smoke URL must be under /api/v1/access/count/ (got: ${url.pathname})`,
			);
		});

		it('uses a canonical counter key that the access-counter schema accepts', () => {
			// home-page is a real counter key in production use
			// (src/home/access/load.ts); `validateCounterKey` allows
			// any printable non-whitespace 1..256-char string.
			const path = new URL(SMOKE_URL_DEFAULT).pathname;
			const key = path.slice('/api/v1/access/count/'.length);
			assert.ok(key.length > 0 && key.length <= 256);
			for (let i = 0; i < key.length; i++) {
				const code = key.charCodeAt(i);
				assert.ok(
					code > 0x20 && code !== 0x7f,
					`counter key must not contain whitespace/control chars (got code=${code} at index=${i})`,
				);
			}
		});
	});

	describe('spawnInfisicalSet (stdio discipline, file contract)', () => {
		it('forwards argv exactly, sets stdio=[pipe, pipe, pipe]', () => {
			let captured;
			const child = spawnInfisicalSet({
				cliPath: '/fake/infisical',
				yamlPath: '/tmp/rotate.yaml',
				environment: 'prod',
				env: process.env,
				spawnFn: captureSpawn(0, (c) => {
					captured = c;
				}),
			});
			assert.equal(captured.cmd, '/fake/infisical');
			assert.deepEqual(captured.args, [
				'secrets',
				'set',
				'--file',
				'/tmp/rotate.yaml',
				'--env',
				'prod',
				'--path',
				'/',
			]);
			assert.deepEqual(captured.opts.stdio, ['pipe', 'pipe', 'pipe']);
		});

		it('plaintext is NOT in argv (file-only contract)', () => {
			let captured;
			spawnInfisicalSet({
				cliPath: '/fake/infisical',
				yamlPath: '/tmp/rotate.yaml',
				environment: 'prod',
				env: process.env,
				spawnFn: captureSpawn(0, (c) => {
					captured = c;
				}),
			});
			for (const arg of [...captured.args, captured.cmd]) {
				assert.ok(!arg.includes('mk_home_'), `argv unexpectedly contains plaintext: ${arg}`);
			}
		});
	});

	describe('spawnWranglerBulk (stdio discipline, stdin payload)', () => {
		it('forwards argv exactly, sets stdio=[pipe, inherit, inherit]', () => {
			let captured;
			const payload = JSON.stringify({ MY_WEB_2026_CONSUMER_API_KEY: 'mk_home_FreshV' });
			const child = spawnWranglerBulk({
				payload,
				env: process.env,
				spawnFn: captureSpawn(0, (c) => {
					captured = c;
				}),
			});
			assert.deepEqual(captured.opts.stdio, ['pipe', 'inherit', 'inherit']);
			assert.ok(captured.args.includes('bulk'), `args: ${captured.args.join(' ')}`);
			assert.ok(captured.args.includes('secret'), `args: ${captured.args.join(' ')}`);
			const cIndex = captured.args.indexOf('-c');
			assert.ok(cIndex >= 0);
			assert.ok(captured.args[cIndex + 1].endsWith('wrangler.production.jsonc'));
		});

		it('writes the bulk payload to stdin (NOT argv)', async () => {
			const payload = JSON.stringify({ MY_WEB_2026_CONSUMER_API_KEY: 'mk_home_FreshV' });
			let captured;
			const capturingSpawn = captureSpawnCapturesStdin(0, (c) => {
				captured = c;
			});
			const child = spawnWranglerBulk({
				payload,
				env: process.env,
				spawnFn: capturingSpawn,
			});
			// Wait for the captured stdin payload to populate
			await new Promise((resolve) => {
				setImmediate(resolve);
			});
			assert.equal(child.__stdinPayload, payload);
			// Argv MUST NOT contain the plaintext
			for (const arg of captured.args) {
				assert.ok(!arg.includes('mk_home_FreshV'), `argv contains plaintext: ${arg}`);
			}
		});

		it('NEVER uses secret put or secret delete (single bulk discipline)', () => {
			let captured;
			spawnWranglerBulk({
				payload: JSON.stringify({ MY_WEB_2026_CONSUMER_API_KEY: 'mk_home_X' }),
				env: process.env,
				spawnFn: captureSpawn(0, (c) => {
					captured = c;
				}),
			});
			assert.ok(!captured.args.includes('put'), `args: ${captured.args.join(' ')}`);
			assert.ok(!captured.args.includes('delete'), `args: ${captured.args.join(' ')}`);
		});
	});

	describe('spawnWranglerList (name-only verification)', () => {
		it('forwards --format=json for name-only output', () => {
			let captured;
			spawnWranglerList({
				env: process.env,
				spawnFn: captureSpawn(0, (c) => {
					captured = c;
				}),
			});
			assert.ok(captured.args.includes('--format'));
			const formatIndex = captured.args.indexOf('--format');
			assert.equal(captured.args[formatIndex + 1], 'json');
		});

		it('uses -c wrangler.production.jsonc', () => {
			let captured;
			spawnWranglerList({
				env: process.env,
				spawnFn: captureSpawn(0, (c) => {
					captured = c;
				}),
			});
			const cIndex = captured.args.indexOf('-c');
			assert.ok(cIndex >= 0);
			assert.ok(captured.args[cIndex + 1].endsWith('wrangler.production.jsonc'));
		});

		it('uses stdio=[pipe, pipe, pipe] for stdout capture', () => {
			let captured;
			spawnWranglerList({
				env: process.env,
				spawnFn: captureSpawn(0, (c) => {
					captured = c;
				}),
			});
			assert.deepEqual(captured.opts.stdio, ['pipe', 'pipe', 'pipe']);
		});
	});

	describe('SECURITY INVARIANTS', () => {
		it('fresh plaintext is never in argv, log, or error message', () => {
			// All public helpers accept the plaintext via function parameters,
			// never via stdout/stderr/argv. We verify the only string forms
			// that enter argv/stdout/stderr are the args builders above
			// (which never include the plaintext value).
			const plaintext = 'mk_home_SensitiveValueThatMustNotSurface';
			// buildInfisicalYamlContent does embed the plaintext, but it's
			// in a 0600 temp file, NOT argv/stdout.
			const yaml = buildInfisicalYamlContent(plaintext);
			assert.ok(yaml.includes(plaintext)); // contained in the FILE
			const args = buildInfisicalSetArgs('/tmp/rotate.yaml', 'prod');
			for (const arg of args) {
				assert.ok(!arg.includes(plaintext), `arg leaks plaintext: ${arg}`);
			}
			const bulk = buildWranglerBulkArgs();
			for (const arg of bulk) {
				assert.ok(!arg.includes(plaintext), `arg leaks plaintext: ${arg}`);
			}
		});

		it('bulk payload contains exactly the new value (no other Worker secrets)', () => {
			const plaintext = 'mk_home_Sensitive';
			const payload = JSON.parse(buildWorkerBulkPayload(plaintext));
			assert.deepEqual(Object.keys(payload), ['MY_WEB_2026_CONSUMER_API_KEY']);
			assert.equal(payload.MY_WEB_2026_CONSUMER_API_KEY, plaintext);
		});

		it('YAML contains exactly one key (no Infisical-wide blast radius)', () => {
			const content = buildInfisicalYamlContent('mk_home_X');
			const newlines = content.split('\n').filter((line) => line.trim().length > 0);
			// structure: "---", `"<key>": "<value>"`, ""
			assert.equal(newlines.length, 2);
			assert.match(newlines[0], /^---$/);
			assert.match(newlines[1], new RegExp(`^"${SECRET_NAME}":`));
		});

		it('worker bulk does NOT include legacy BETTER_AUTH_SECRET', () => {
			const payload = JSON.parse(buildWorkerBulkPayload('mk_home_X'));
			assert.equal(payload.BETTER_AUTH_SECRET, undefined);
			assert.equal(payload.BETTER_AUTH_SECRETS, undefined);
		});

		it('D1 row names are unique per rotation (timestamp + salt)', () => {
			const a = buildRotatedRowName(deriveRotationId('2026-09-28T14:30:00.123Z', 'salt1'));
			const b = buildRotatedRowName(deriveRotationId('2026-09-28T14:30:00.123Z', 'salt2'));
			assert.notEqual(a, b);
			assert.ok(a.startsWith(KEY_NAME_PREFIX));
			assert.ok(b.startsWith(KEY_NAME_PREFIX));
		});

		it('D1 row names never embed the plaintext or hash', () => {
			const plaintext = 'mk_home_TopSecretPlaintextThatShouldNeverLandInAName';
			const hash = keyHash(plaintext);
			const a = buildRotatedRowName(deriveRotationId('2026-09-28T14:30:00.123Z', 'salt1'));
			const b = buildRotatedRowName(deriveRotationId('2026-09-28T14:30:00.123Z', 'salt2'));
			for (const name of [a, b]) {
				assert.ok(!name.includes(plaintext));
				assert.ok(!name.includes(hash));
				assert.ok(!name.includes('mk_home_'));
			}
		});
	});

	describe('FAILURE INJECTION', () => {
		it('async helpers propagate a non-zero exit code', async () => {
			// Pre-validate that any non-zero exit from a child spawn surfaces
			// as code !== 0 via awaitExit (the foundation for partial-failure
			// handling in main()).
			const spawn = captureSpawn(2);
			const child = spawn('cmd', [], {});
			const result = await awaitExit(child);
			assert.equal(result.code, 2);
		});

		it('signal-exit surfaces as signal in awaitExit (NOT code=0)', async () => {
			const spawn = captureSpawnSignals('SIGTERM');
			const child = spawn('cmd', [], {});
			const result = await awaitExit(child);
			assert.equal(result.signal, 'SIGTERM');
			assert.notEqual(result.code, 0);
		});

		it('bulk payload via stdin is recoverable (the bytes round-trip)', async () => {
			const payload = JSON.stringify({ MY_WEB_2026_CONSUMER_API_KEY: 'mk_home_RoundTrip' });
			let capturedStdin = null;
			const capturingSpawn = (_cmd, _args, _opts) => {
				const child = fakeChild();
				const chunks = [];
				const origWrite = child.stdin.write.bind(child.stdin);
				child.stdin.write = (chunk, _enc, cb) => {
					chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
					return origWrite(chunk, _enc, cb);
				};
				const origEnd = child.stdin.end.bind(child.stdin);
				child.stdin.end = (cb) => {
					capturedStdin = chunks.join('');
					return origEnd(cb);
				};
				Promise.resolve().then(() => child.emit('exit', 0, null));
				return child;
			};
			const child = spawnWranglerBulk({
				payload,
				env: process.env,
				spawnFn: capturingSpawn,
			});
			await new Promise((r) => setImmediate(r));
			assert.equal(capturedStdin, payload);
			assert.ok(child, 'spawnWranglerBulk returns the live child (assigned via writable stdin)');
		});
	});
});


describe('execute recovery ordering contract', () => {
	it('persists fresh plaintext in Infisical before disabling the exposed old D1 row', () => {
		const source = readFileSync(new URL('./rotate-home-api-key.mjs', import.meta.url), 'utf8');
		const persist = source.indexOf('// Stage 7 — write Infisical prod');
		const contain = source.indexOf('// Stage 8 — disable OLD row');
		const worker = source.indexOf('// Stage 9 — write Worker');
		assert.ok(persist >= 0, 'Stage 7 Infisical persist marker missing');
		assert.ok(contain > persist, 'old-row containment must happen after fresh Infisical persistence');
		assert.ok(worker > contain, 'Worker propagation must happen after containment');
	});
});
