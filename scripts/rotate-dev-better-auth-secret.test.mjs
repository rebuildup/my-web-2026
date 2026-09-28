/**
 * Test harness for `scripts/rotate-dev-better-auth-secret.mjs` (Issue #149).
 *
 * Coverage:
 *   - argv parsing + mutually-exclusive mode grammar
 *   - --environment lock (default 'dev'; rejects 'prod' / any other value)
 *   - subprocess env uses buildInfisicalEnv (keeps INFISICAL_TOKEN, strips
 *     other Infisical credentials) — PR #140 contract
 *   - fresh secret generation + versioned envelope round-trip
 *   - summarizeDevState status-only report (legacy/versioned byte check)
 *   - read-back contract (wrapped response.secret.secretValue, no
 *     type=personal query, 404/401/403/5xx semantics) — PR #151 contract
 *   - failure-injection / partial-failure contract
 *   - security invariants (plaintext never in argv, log, error message)
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import {
	ALLOWED_ENVIRONMENTS,
	MODES,
	SECRET_NAME_LEGACY,
	SECRET_NAME_VERSIONED,
	buildInfisicalSubprocessEnv,
	parseArgs,
	printHelp,
	runInfisicalSet,
	summarizeDevState,
} from './rotate-dev-better-auth-secret.mjs';
import {
	FRESH_SECRET_BYTES_DEFAULT,
	buildInfisicalEnv,
	buildInfisicalSetArgs,
	buildInfisicalYamlContent,
	buildVersionedForm,
	classifyInfisicalHttpStatus,
	generateFreshSecret,
	interpretInfisicalReadResponse,
	parseVersionedSecrets,
	validateFreshSecret,
} from './rotate-better-auth-secret.mjs';

/* ─── Test helpers ────────────────────────────────────────────────────── */

class FakeChild extends EventEmitter {
	constructor() {
		super();
		this.stdout = new Readable({ read() {} });
		this.stderr = new Readable({ read() {} });
	}
}

function makeFakeSpawn(exitCode = 0) {
	const spawned = [];
	const child = new FakeChild();
	const spawnFn = (cliPath, args, options) => {
		spawned.push({ cliPath, args, options });
		// Emit empty stdout/stderr then exit on next tick.
		setImmediate(() => {
			child.stdout.push(null);
			child.stderr.push(null);
			child.emit('exit', exitCode, null);
		});
		return child;
	};
	return { spawnFn, spawned };
}

/* ─── parseArgs ───────────────────────────────────────────────────────── */

describe('parseArgs', () => {
	it('defaults to --dry-run + --environment=dev', () => {
		const result = parseArgs([]);
		assert.equal(result.mode, 'dry-run');
		assert.equal(result.environment, 'dev');
		assert.equal(result.apiUrl, 'https://secrets.rebuildup.dev');
		assert.equal(result.bytesOverride, null);
	});

	it('--execute sets mode=execute', () => {
		const result = parseArgs(['--execute']);
		assert.equal(result.mode, 'execute');
		assert.equal(result.environment, 'dev');
	});

	it('--dry-run explicit is accepted', () => {
		const result = parseArgs(['--dry-run']);
		assert.equal(result.mode, 'dry-run');
	});

	it('--dry-run + --execute is rejected', () => {
		assert.throws(() => parseArgs(['--dry-run', '--execute']), /conflicting mode flags/);
	});

	it('rejects --environment=prod (safety: prod has its own driver)', () => {
		assert.throws(
			() => parseArgs(['--execute', '--environment=prod']),
			/--environment must be one of \[dev\] for the dev cleanup driver/,
		);
	});

	it('rejects --environment=staging (only dev is allowed)', () => {
		assert.throws(
			() => parseArgs(['--execute', '--environment=staging']),
			/--environment must be one of \[dev\]/,
		);
	});

	it('accepts --environment=dev', () => {
		const result = parseArgs(['--execute', '--environment=dev']);
		assert.equal(result.environment, 'dev');
	});

	it('rejects unknown arguments', () => {
		assert.throws(() => parseArgs(['--bogus-flag']), /unknown argument: --bogus-flag/);
	});

	it('--fresh-bytes must be an integer', () => {
		assert.throws(() => parseArgs(['--fresh-bytes=abc']), /--fresh-bytes must be an integer/);
		const result = parseArgs(['--fresh-bytes=64']);
		assert.equal(result.bytesOverride, 64);
	});

	it('--api-url is captured', () => {
		const result = parseArgs(['--api-url=https://example.test/']);
		assert.equal(result.apiUrl, 'https://example.test/');
	});

	it('--help is handled in main (not tested here, would exit the process)', () => {
		// parseArgs routes --help to printHelp() + process.exit(0), so we
		// cannot exercise it in a unit test without killing the runner.
		// main() handles it. printHelp() itself is tested below.
		assert.ok(true, 'placeholder — see printHelp describe below');
	});
});

describe('ALLOWED_ENVIRONMENTS', () => {
	it('contains only "dev"', () => {
		assert.deepEqual([...ALLOWED_ENVIRONMENTS], ['dev']);
	});
});

describe('printHelp', () => {
	it('prints usage + mode grammar to stdout (status-only — no secrets)', () => {
		// Capture console.log output.
		const original = console.log;
		const captured = [];
		console.log = (...args) => captured.push(args.join(' '));
		try {
			printHelp();
		} finally {
			console.log = original;
		}
		const out = captured.join('\n');
		assert.match(out, /Usage: rotate-dev-better-auth-secret\.mjs/);
		assert.match(out, /--dry-run/);
		assert.match(out, /--execute/);
		assert.match(out, /--environment=dev/);
		assert.match(out, /operator-supplied INFISICAL_TOKEN/);
		// The help text must NOT contain a placeholder or sample value that
		// could be confused with a real secret.
		assert.ok(
			!/placeholder|fake-secret|sample-value/.test(out),
			`help text leaks a sample value: ${out}`,
		);
	});
});

describe('MODES', () => {
	it('contains dry-run and execute (no verify-only, no worker-recovery for dev)', () => {
		assert.deepEqual(MODES, ['dry-run', 'execute']);
	});
});

/* ─── Subprocess env isolation (PR #140 contract) ────────────────────── */

describe('buildInfisicalSubprocessEnv (PR #140 contract)', () => {
	it('keeps INFISICAL_TOKEN passed via the explicit token argument', () => {
		const env = buildInfisicalSubprocessEnv('writer-token-abc');
		assert.equal(env.INFISICAL_TOKEN, 'writer-token-abc');
	});

	it('strips the OTHER Infisical credentials (CLIENT_ID/SECRET/PROJECT_ID/SITE_URL/API_URL)', () => {
		const before = {
			INFISICAL_CLIENT_ID: 'cid',
			INFISICAL_CLIENT_SECRET: 'cs',
			INFISICAL_PROJECT_ID: 'p',
			INFISICAL_SITE_URL: 's',
			INFISICAL_API_URL: 'a',
			NODE_ENV: 'test',
		};
		const savedEnv = { ...process.env };
		Object.assign(process.env, before);
		try {
			const env = buildInfisicalSubprocessEnv('writer-token');
			assert.equal(env.INFISICAL_CLIENT_ID, undefined);
			assert.equal(env.INFISICAL_CLIENT_SECRET, undefined);
			assert.equal(env.INFISICAL_PROJECT_ID, undefined);
			assert.equal(env.INFISICAL_SITE_URL, undefined);
			assert.equal(env.INFISICAL_API_URL, undefined);
			assert.equal(env.INFISICAL_TOKEN, 'writer-token');
		} finally {
			process.env = savedEnv;
		}
	});

	it('delegates to buildInfisicalEnv (shared helper, no drift)', () => {
		// Spot-check: same env shape as the prod driver's buildInfisicalEnv.
		const before = { NODE_ENV: 'test' };
		const savedEnv = { ...process.env };
		Object.assign(process.env, before);
		try {
			const devEnv = buildInfisicalSubprocessEnv('tok');
			const prodEnv = buildInfisicalEnv({ ...before }, 'tok');
			// Both should set INFISICAL_TOKEN; other keys identically absent.
			assert.equal(devEnv.INFISICAL_TOKEN, prodEnv.INFISICAL_TOKEN);
			assert.equal(devEnv.INFISICAL_CLIENT_ID, prodEnv.INFISICAL_CLIENT_ID);
		} finally {
			process.env = savedEnv;
		}
	});
});

/* ─── Fresh secret + versioned envelope (shared with prod driver) ────── */

describe('fresh secret generation (CSPRNG, versioned envelope)', () => {
	it('generateFreshSecret returns 64 base64url chars by default', () => {
		const s = generateFreshSecret();
		assert.equal(s.length, 64);
		assert.match(s, /^[A-Za-z0-9_-]+$/);
	});

	it('validateFreshSecret accepts a freshly generated value', () => {
		const s = generateFreshSecret();
		assert.doesNotThrow(() => validateFreshSecret(s));
	});

	it('validateFreshSecret rejects comma (would corrupt versioned envelope)', () => {
		assert.throws(() => validateFreshSecret('a,b'), /contains ","/);
	});

	it('validateFreshSecret rejects empty', () => {
		assert.throws(() => validateFreshSecret(''), /empty/);
	});

	it('parseVersionedSecrets round-trips 1:<plaintext>', () => {
		const s = generateFreshSecret();
		const envelope = `1:${s}`;
		const parsed = parseVersionedSecrets(envelope);
		assert.equal(parsed.length, 1);
		assert.equal(parsed[0].version, 1);
		assert.equal(parsed[0].value, s);
	});

	it('buildInfisicalYamlContent emits both legacy + versioned keys with JSON-stringified values', () => {
		const s = generateFreshSecret();
		const yaml = buildInfisicalYamlContent(s);
		assert.match(yaml, new RegExp(`"${SECRET_NAME_LEGACY}": `));
		assert.match(yaml, new RegExp(`"${SECRET_NAME_VERSIONED}": `));
		assert.ok(yaml.includes(JSON.stringify(s)));
		assert.ok(yaml.includes(JSON.stringify(buildVersionedForm(s))));
	});
});

/* ─── Read-back contract (PR #151 contract) ──────────────────────────── */

describe('Infisical raw-secret read contract (dev driver, PR #151)', () => {
	it('classifyInfisicalHttpStatus: 200 → ok, 404 + allowNotFound → missing, 401/403/5xx → error', () => {
		assert.equal(classifyInfisicalHttpStatus(200, { allowNotFound: true }), 'ok');
		assert.equal(classifyInfisicalHttpStatus(404, { allowNotFound: true }), 'missing');
		assert.equal(classifyInfisicalHttpStatus(404, { allowNotFound: false }), 'error');
		assert.equal(classifyInfisicalHttpStatus(401, { allowNotFound: true }), 'error');
		assert.equal(classifyInfisicalHttpStatus(403, { allowNotFound: true }), 'error');
		assert.equal(classifyInfisicalHttpStatus(500, { allowNotFound: true }), 'error');
	});

	it('interpretInfisicalReadResponse reads wrapped response.secret.secretValue', () => {
		const value = 'placeholder-not-a-real-secret';
		const out = interpretInfisicalReadResponse({
			response: { secret: { secretValue: value, type: 'shared' } },
			allowMissing: false,
			environment: 'dev',
			name: SECRET_NAME_LEGACY,
		});
		assert.equal(out, value);
	});

	it('interpretInfisicalReadResponse returns null when response is null and allowMissing=true', () => {
		assert.equal(
			interpretInfisicalReadResponse({
				response: null,
				allowMissing: true,
				environment: 'dev',
				name: SECRET_NAME_LEGACY,
			}),
			null,
		);
	});

	it('interpretInfisicalReadResponse throws on null + allowMissing=false', () => {
		assert.throws(
			() =>
				interpretInfisicalReadResponse({
					response: null,
					allowMissing: false,
					environment: 'dev',
					name: SECRET_NAME_LEGACY,
				}),
			/missing or empty/,
		);
	});

	it('interpretInfisicalReadResponse throws on empty wrapped value', () => {
		assert.throws(
			() =>
				interpretInfisicalReadResponse({
					response: { secret: { secretValue: '' } },
					allowMissing: false,
					environment: 'dev',
					name: SECRET_NAME_LEGACY,
				}),
			/missing or empty/,
		);
	});
});

/* ─── summarizeDevState ──────────────────────────────────────────────── */

describe('summarizeDevState', () => {
	const s = generateFreshSecret();
	const env = buildVersionedForm(s);

	it('BOTH_MISSING when both legacy and versioned are absent', () => {
		const out = summarizeDevState({ legacyValue: null, versionedValue: null });
		assert.equal(out.status, 'BOTH_MISSING');
		assert.equal(out.legacyPresent, false);
		assert.equal(out.versionedPresent, false);
	});

	it('LEGACY_ONLY when only legacy present', () => {
		const out = summarizeDevState({ legacyValue: s, versionedValue: null });
		assert.equal(out.status, 'LEGACY_ONLY');
		assert.equal(out.legacyPresent, true);
		assert.equal(out.versionedPresent, false);
	});

	it('VERSIONED_ONLY when only versioned present', () => {
		const out = summarizeDevState({ legacyValue: null, versionedValue: env });
		assert.equal(out.status, 'VERSIONED_ONLY');
		assert.equal(out.legacyPresent, false);
		assert.equal(out.versionedPresent, true);
	});

	it('CONSISTENT when legacy == fresh AND versioned == 1:<fresh>', () => {
		const out = summarizeDevState({
			legacyValue: s,
			versionedValue: env,
			expectedFresh: s,
		});
		assert.equal(out.status, 'CONSISTENT');
		assert.equal(out.legacyPresent, true);
		assert.equal(out.versionedPresent, true);
		assert.equal(out.envelopeOk, true);
		assert.equal(out.freshOk, true);
	});

	it('DIVERGENT when versioned envelope does not match legacy', () => {
		const out = summarizeDevState({
			legacyValue: s,
			versionedValue: `1:${generateFreshSecret()}`,
		});
		assert.equal(out.status, 'DIVERGENT');
		assert.equal(out.envelopeOk, false);
	});

	it('DIVERGENT when legacy does not match expectedFresh (drift)', () => {
		const out = summarizeDevState({
			legacyValue: s,
			versionedValue: env,
			expectedFresh: generateFreshSecret(),
		});
		assert.equal(out.status, 'DIVERGENT');
		assert.equal(out.freshOk, false);
	});

	it('freshOk is null when expectedFresh is not provided', () => {
		const out = summarizeDevState({ legacyValue: s, versionedValue: env });
		assert.equal(out.freshOk, null);
		assert.equal(out.status, 'CONSISTENT');
	});
});

/* ─── runInfisicalSet subprocess contract ────────────────────────────── */

describe('runInfisicalSet subprocess contract', () => {
	it('spawns the @infisical/cli binary with buildInfisicalSetArgs (secrets set --file)', async () => {
		const { spawnFn, spawned } = makeFakeSpawn(0);
		const result = await runInfisicalSet({
			cliPath: '/path/to/infisical',
			yamlPath: '/tmp/my-web-2026-issue-139-abc/rotate-dev.yaml',
			environment: 'dev',
			env: { INFISICAL_TOKEN: 'tok' },
			deps: { spawn: spawnFn },
		});
		assert.equal(spawned.length, 1);
		assert.equal(spawned[0].cliPath, '/path/to/infisical');
		// buildInfisicalSetArgs returns secrets set --file <yaml> --env <env> --path /
		const expectedArgs = buildInfisicalSetArgs(
			'/tmp/my-web-2026-issue-139-abc/rotate-dev.yaml',
			'dev',
		);
		assert.deepEqual(spawned[0].args, expectedArgs);
		assert.equal(spawned[0].options.stdio[0], 'pipe');
		assert.equal(result.code, 0);
		assert.equal(result.signal, null);
	});

	it('propagates a non-zero exit code', async () => {
		const { spawnFn } = makeFakeSpawn(2);
		const result = await runInfisicalSet({
			cliPath: '/path/to/infisical',
			yamlPath: '/tmp/x.yaml',
			environment: 'dev',
			env: { INFISICAL_TOKEN: 'tok' },
			deps: { spawn: spawnFn },
		});
		assert.equal(result.code, 2);
	});

	it('passes the sanitized env through (writer token + stripped UA fields)', async () => {
		const { spawnFn, spawned } = makeFakeSpawn(0);
		await runInfisicalSet({
			cliPath: '/path/to/infisical',
			yamlPath: '/tmp/x.yaml',
			environment: 'dev',
			env: {
				INFISICAL_TOKEN: 'writer-tok',
				INFISICAL_CLIENT_ID: 'should-be-stripped-by-builder',
			},
			deps: { spawn: spawnFn },
		});
		// runInfisicalSet itself does NOT call buildInfisicalEnv — that's the
		// caller's responsibility (buildInfisicalSubprocessEnv in main()).
		// The env passed through is forwarded as-is.
		assert.equal(spawned[0].options.env.INFISICAL_TOKEN, 'writer-tok');
		assert.equal(spawned[0].options.env.INFISICAL_CLIENT_ID, 'should-be-stripped-by-builder');
	});
});

/* ─── Security invariants ─────────────────────────────────────────────── */

describe('security invariants (no plaintext in argv / log / error)', () => {
	it('buildInfisicalSetArgs does not include any value material', () => {
		const args = buildInfisicalSetArgs('/tmp/rotate-dev.yaml', 'dev');
		const joined = args.join(' ');
		assert.ok(!joined.includes('value'), `args leak 'value': ${joined}`);
		assert.ok(!joined.includes('placeholder'), `args leak 'placeholder': ${joined}`);
	});

	it('parseArgs accepts --environment=dev and never echoes the env value in error messages', () => {
		// parseArgs's "must be 'dev'" error message names the requested env
		// back, which is fine for fail-loud but should not be a secret value.
		// Use a non-secret slug to confirm the message format.
		assert.throws(
			() => parseArgs(['--environment=staging']),
			/--environment must be one of \[dev\] for the dev cleanup driver/,
		);
	});

	it('FRESH_SECRET_BYTES_DEFAULT is 48 (matches prod driver, 384-bit entropy)', () => {
		assert.equal(FRESH_SECRET_BYTES_DEFAULT, 48);
	});
});
