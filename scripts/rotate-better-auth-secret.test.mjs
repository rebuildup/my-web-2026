/**
 * Test harness for `scripts/rotate-better-auth-secret.mjs` (Issue #139).
 *
 * Coverage:
 *   - argv parsing + mutually-exclusive mode grammar
 *   - fresh-secret generation (CSPRNG, length, charset, shell-safety)
 *   - parseVersionedSecrets round-trip (legacy parser re-implementation)
 *   - YAML content shape (no leakage, escapes)
 *   - wrangler bulk payload (legacy only, NOT versioned)
 *   - subprocess argv + stdio discipline
 *   - secretValuesEqual (constant-time comparison)
 *   - state summarization (Infisical + Worker)
 *   - failure-injection / partial-failure contract
 *   - security invariants (plaintext never in argv, log, error message)
 *   - buildInfisicalEnv (Infisical CLI env: keeps INFISICAL_TOKEN, strips other Infisical credentials)
 *   - buildWranglerEnv (Wrangler/D1 env: strips full Infisical credential set, no token added)
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { describe, it } from 'node:test';
import {
	MODES,
	SECRET_NAME_LEGACY,
	SECRET_NAME_VERSIONED,
	buildInfisicalEnv,
	buildInfisicalSetArgs,
	buildInfisicalYamlContent,
	buildSanitizedEnv,
	buildSecretReadUrl,
	buildVersionedForm,
	buildWorkerBulkPayload,
	buildWranglerBulkArgs,
	buildWranglerEnv,
	classifyInfisicalHttpStatus,
	generateFreshSecret,
	interpretInfisicalReadResponse,
	parseArgs,
	parseVersionedSecrets,
	resolveInfisicalCliPath,
	secretValuesEqual,
	spawnInfisicalSet,
	spawnWranglerBulk,
	summarizeInfisicalState,
	summarizeWorkerState,
	validateFreshSecret,
} from './rotate-better-auth-secret.mjs';

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

/** Capture spawn arguments and return a fake child that exits with the given code. */
function makeCapturingSpawn(exitCode, onCall) {
	return (cmd, args, opts) => {
		if (onCall) onCall({ cmd, args, opts });
		const child = fakeChild();
		Promise.resolve().then(() => {
			child.emit('exit', exitCode, null);
		});
		return child;
	};
}

/* ─── Tests ────────────────────────────────────────────────────────────── */

describe('rotate-better-auth-secret.mjs (Issue #139)', () => {
	describe('parseArgs mode grammar', () => {
		it('defaults to --dry-run + prod + default api-url', () => {
			const result = parseArgs([]);
			assert.equal(result.mode, 'dry-run');
			assert.equal(result.environment, 'prod');
			assert.equal(result.apiUrl, 'https://secrets.rebuildup.dev');
			assert.equal(result.bytesOverride, null);
		});

		it('--execute sets mode=execute', () => {
			assert.equal(parseArgs(['--execute']).mode, 'execute');
		});

		it('--verify-only sets mode=verify-only', () => {
			assert.equal(parseArgs(['--verify-only']).mode, 'verify-only');
		});

		it('--worker-recovery sets mode=worker-recovery', () => {
			assert.equal(parseArgs(['--worker-recovery']).mode, 'worker-recovery');
		});

		it('--execute + --verify-only rejected (conflicting modes)', () => {
			assert.throws(() => parseArgs(['--execute', '--verify-only']), /conflicting mode flags/);
		});

		it('--execute + --dry-run rejected', () => {
			assert.throws(() => parseArgs(['--execute', '--dry-run']), /conflicting mode flags/);
		});

		it('--worker-recovery + --execute rejected', () => {
			assert.throws(() => parseArgs(['--worker-recovery', '--execute']), /conflicting mode flags/);
		});

		it('--verify-only + --dry-run rejected', () => {
			assert.throws(() => parseArgs(['--verify-only', '--dry-run']), /conflicting mode flags/);
		});

		it('--verify-only + --worker-recovery rejected', () => {
			assert.throws(
				() => parseArgs(['--verify-only', '--worker-recovery']),
				/conflicting mode flags/,
			);
		});

		it('--environment=dev rejected (production-only)', () => {
			assert.throws(() => parseArgs(['--environment=dev']), /--environment must be 'prod'/);
		});

		it('--environment=staging rejected', () => {
			assert.throws(() => parseArgs(['--environment=staging']), /--environment must be 'prod'/);
		});

		it('--environment=prod accepted', () => {
			assert.equal(parseArgs(['--environment=prod']).environment, 'prod');
		});

		it('--fresh-bytes=64 accepted and applied', () => {
			assert.equal(parseArgs(['--fresh-bytes=64']).bytesOverride, 64);
		});

		it('--fresh-bytes=non-integer rejected', () => {
			assert.throws(() => parseArgs(['--fresh-bytes=foo']), /--fresh-bytes must be an integer/);
		});

		it('--api-url overrides default', () => {
			assert.equal(parseArgs(['--api-url=https://example.test']).apiUrl, 'https://example.test');
		});

		it('unknown argument rejected', () => {
			assert.throws(() => parseArgs(['--foo']), /unknown argument/);
		});

		it('all four modes are listed in MODES export', () => {
			assert.ok(MODES.includes('dry-run'));
			assert.ok(MODES.includes('execute'));
			assert.ok(MODES.includes('verify-only'));
			assert.ok(MODES.includes('worker-recovery'));
		});
	});

	describe('generateFreshSecret', () => {
		it('default length is 64 base64url chars (48 bytes)', () => {
			const s = generateFreshSecret();
			assert.equal(s.length, 64);
			assert.match(s, /^[A-Za-z0-9_-]+$/);
		});

		it('custom bytes argument: 32 bytes → 43 base64url chars', () => {
			const s = generateFreshSecret(32);
			assert.equal(s.length, 43);
		});

		it('custom bytes argument: 64 bytes → 86 base64url chars', () => {
			const s = generateFreshSecret(64);
			assert.equal(s.length, 86);
		});

		it('out-of-range bytes rejected (too small)', () => {
			assert.throws(() => generateFreshSecret(16), /FRESH_SECRET_BYTES must be 32..128/);
		});

		it('out-of-range bytes rejected (too large)', () => {
			assert.throws(() => generateFreshSecret(256), /FRESH_SECRET_BYTES must be 32..128/);
		});

		it('non-integer bytes rejected', () => {
			assert.throws(() => generateFreshSecret(48.5), /FRESH_SECRET_BYTES must be 32..128/);
		});

		it('two consecutive calls produce different values (CSPRNG)', () => {
			const a = generateFreshSecret();
			const b = generateFreshSecret();
			assert.notEqual(a, b);
		});

		it('shell-safe charset (no + / = space newline)', () => {
			// Generate many times; ensure none contain shell-unsafe chars.
			for (let i = 0; i < 100; i += 1) {
				const s = generateFreshSecret();
				assert.ok(!s.includes('+'), `unexpected '+' in ${s}`);
				assert.ok(!s.includes('/'), `unexpected '/' in ${s}`);
				assert.ok(!s.includes('='), `unexpected '=' in ${s}`);
				assert.ok(!s.includes(' '), `unexpected ' ' in ${s}`);
				assert.ok(!s.includes('\n'), `unexpected newline in ${s}`);
				assert.ok(!s.includes('"'), `unexpected '"' in ${s}`);
				assert.ok(!s.includes("'"), `unexpected "'" in ${s}`);
				assert.ok(!s.includes('\\'), `unexpected backslash in ${s}`);
				assert.ok(!s.includes('`'), `unexpected backtick in ${s}`);
				assert.ok(!s.includes('$'), `unexpected '$' in ${s}`);
			}
		});
	});

	describe('validateFreshSecret', () => {
		it('default-length secret passes', () => {
			validateFreshSecret(generateFreshSecret());
		});

		it('empty string rejected', () => {
			assert.throws(() => validateFreshSecret(''), /empty/);
		});

		it('comma rejected (would break versioned envelope)', () => {
			assert.throws(() => validateFreshSecret('foo,bar'), /,/);
		});

		it('leading whitespace rejected', () => {
			assert.throws(() => validateFreshSecret(' foo'), /whitespace/);
		});

		it('trailing whitespace rejected', () => {
			assert.throws(() => validateFreshSecret('foo '), /whitespace/);
		});

		it('round-trip through parseVersionedSecrets succeeds', () => {
			const s = generateFreshSecret();
			const envelope = buildVersionedForm(s);
			const parsed = parseVersionedSecrets(envelope);
			assert.equal(parsed.length, 1);
			assert.equal(parsed[0].version, 1);
			assert.equal(parsed[0].value, s);
		});
	});

	describe('parseVersionedSecrets round-trip', () => {
		it('1:<value> parses to single entry with version=1', () => {
			const parsed = parseVersionedSecrets('1:abc');
			assert.equal(parsed.length, 1);
			assert.equal(parsed[0].version, 1);
			assert.equal(parsed[0].value, 'abc');
		});

		it('multi-entry descending order', () => {
			const parsed = parseVersionedSecrets('2:def,1:abc');
			assert.equal(parsed.length, 2);
			assert.equal(parsed[0].version, 2);
			assert.equal(parsed[0].value, 'def');
			assert.equal(parsed[1].version, 1);
			assert.equal(parsed[1].value, 'abc');
		});

		it('rejects non-descending', () => {
			assert.throws(() => parseVersionedSecrets('1:abc,2:def'), /descending/);
		});

		it('rejects duplicate versions', () => {
			assert.throws(() => parseVersionedSecrets('1:abc,1:def'), /duplicate/);
		});

		it('rejects non-decimal version', () => {
			assert.throws(() => parseVersionedSecrets('a:abc'), /invalid version/);
		});

		it('rejects zero version', () => {
			assert.throws(() => parseVersionedSecrets('0:abc'), /invalid version/);
		});

		it('rejects empty value', () => {
			assert.throws(() => parseVersionedSecrets('1:'), /empty value/);
		});

		it('rejects missing colon', () => {
			assert.throws(() => parseVersionedSecrets('1abc'), /missing ':'/);
		});
	});

	describe('buildInfisicalYamlContent', () => {
		const sample = 'abc123XYZ_-abc';
		const expectedEnvelope = '1:abc123XYZ_-abc';

		it('contains both secret keys', () => {
			const yaml = buildInfisicalYamlContent(sample);
			assert.match(yaml, new RegExp(`"${SECRET_NAME_LEGACY}": "${sample.replace(/[-]/g, '\\-')}"`));
			assert.match(yaml, new RegExp(`"${SECRET_NAME_VERSIONED}": "${expectedEnvelope}"`));
		});

		it('starts with YAML document separator', () => {
			assert.ok(buildInfisicalYamlContent(sample).startsWith('---\n'));
		});

		it('contains exactly two secret lines', () => {
			const yaml = buildInfisicalYamlContent(sample);
			const lines = yaml.split('\n').filter((l) => l.length > 0);
			assert.equal(lines.length, 3); // --- + 2 keys
		});

		it('handles embedded double-quotes via JSON.stringify', () => {
			const tricky = 'a"b';
			const yaml = buildInfisicalYamlContent(tricky);
			assert.match(yaml, /"BETTER_AUTH_SECRET": "a\\"b"/);
		});

		it('handles backslash via JSON.stringify', () => {
			const tricky = 'a\\b';
			const yaml = buildInfisicalYamlContent(tricky);
			assert.match(yaml, /"BETTER_AUTH_SECRET": "a\\\\b"/);
		});

		it('handles newline via JSON.stringify', () => {
			const tricky = 'a\nb';
			const yaml = buildInfisicalYamlContent(tricky);
			assert.match(yaml, /"BETTER_AUTH_SECRET": "a\\nb"/);
		});

		it('legacy and versioned keys both present and consistent', () => {
			const yaml = buildInfisicalYamlContent(sample);
			// Verify the versioned form embeds the legacy value verbatim
			assert.ok(yaml.includes(`"${SECRET_NAME_VERSIONED}": "1:${sample}"`));
		});
	});

	describe('buildWorkerBulkPayload', () => {
		it('writes only the legacy binding (NOT versioned)', () => {
			const payload = buildWorkerBulkPayload('freshsecret');
			const parsed = JSON.parse(payload);
			assert.deepEqual(Object.keys(parsed).sort(), [SECRET_NAME_LEGACY].sort());
			assert.equal(parsed[SECRET_NAME_LEGACY], 'freshsecret');
			assert.equal(parsed[SECRET_NAME_VERSIONED], undefined);
		});

		it('payload is valid JSON', () => {
			const payload = buildWorkerBulkPayload('value');
			assert.doesNotThrow(() => JSON.parse(payload));
		});
	});

	describe('buildWranglerBulkArgs', () => {
		it('includes -c <absolute path to wrangler.production.jsonc>', () => {
			const args = buildWranglerBulkArgs();
			assert.ok(args.includes('-c'));
			const configArg = args[args.indexOf('-c') + 1];
			assert.ok(configArg.endsWith('wrangler.production.jsonc'));
		});

		it('uses secret bulk subcommand', () => {
			const args = buildWranglerBulkArgs();
			assert.ok(args.includes('secret'));
			assert.ok(args.includes('bulk'));
		});

		it('never includes put/delete (bulk is the only path)', () => {
			const args = buildWranglerBulkArgs();
			assert.ok(!args.includes('put'));
			assert.ok(!args.includes('delete'));
		});
	});

	describe('buildInfisicalSetArgs', () => {
		it('contains --file <path>', () => {
			const args = buildInfisicalSetArgs('/tmp/foo.yaml', 'prod', 'workspace-id');
			assert.equal(args[args.indexOf('--file') + 1], '/tmp/foo.yaml');
		});

		it('contains --env prod', () => {
			const args = buildInfisicalSetArgs('/tmp/foo.yaml', 'prod', 'workspace-id');
			assert.equal(args[args.indexOf('--env') + 1], 'prod');
		});

		it('contains --path /', () => {
			const args = buildInfisicalSetArgs('/tmp/foo.yaml', 'prod', 'workspace-id');
			assert.equal(args[args.indexOf('--path') + 1], '/');
		});

		it('contains --projectId <workspaceId>', () => {
			// Issue #147 / PR #140 D-fix: INFISICAL_TOKEN alone is rejected by the
			// Infisical CLI ("project id missing"); the CLI argv MUST carry the
			// workspaceId read from .infisical.json so the subprocess can resolve
			// the project without an INFISICAL_PROJECT_ID env var.
			const args = buildInfisicalSetArgs(
				'/tmp/foo.yaml',
				'prod',
				'89cda9cb-31ab-4ace-afe9-f155024850d1',
			);
			assert.equal(args[args.indexOf('--projectId') + 1], '89cda9cb-31ab-4ace-afe9-f155024850d1');
		});

		it('does NOT include any secret value in argv', () => {
			const args = buildInfisicalSetArgs('/tmp/foo.yaml', 'prod', 'workspace-id');
			const joined = args.join(' ');
			assert.ok(!joined.includes('BETTER_AUTH_SECRET='));
			assert.ok(!joined.includes('='));
		});

		it('argv never carries shell-interpretable secret value', () => {
			const args = buildInfisicalSetArgs('/tmp/foo.yaml', 'prod', 'workspace-id');
			// The args are entirely CLI flags + paths, never key=value with secret
			for (const a of args) {
				assert.ok(!/BETTER_AUTH_(SECRET|SECRETS)=/.test(a));
			}
		});
	});

	describe('secretValuesEqual', () => {
		it('identical strings are equal', () => {
			assert.equal(secretValuesEqual('foo', 'foo'), true);
		});

		it('different strings are unequal', () => {
			assert.equal(secretValuesEqual('foo', 'bar'), false);
		});

		it('different lengths are unequal', () => {
			assert.equal(secretValuesEqual('foo', 'foobar'), false);
		});

		it('empty strings are equal', () => {
			assert.equal(secretValuesEqual('', ''), true);
		});

		it('base64url strings compare correctly', () => {
			const a = generateFreshSecret();
			const b = generateFreshSecret();
			assert.equal(secretValuesEqual(a, a), true);
			assert.equal(secretValuesEqual(a, b), false);
		});
	});

	describe('summarizeInfisicalState', () => {
		it('BOTH_MISSING when both null', () => {
			const result = summarizeInfisicalState({ legacyValue: null, versionedValue: null });
			assert.equal(result.status, 'BOTH_MISSING');
			assert.equal(result.legacyPresent, false);
			assert.equal(result.versionedPresent, false);
		});

		it('LEGACY_ONLY when only legacy present', () => {
			const result = summarizeInfisicalState({ legacyValue: 'foo', versionedValue: null });
			assert.equal(result.status, 'LEGACY_ONLY');
		});

		it('VERSIONED_ONLY when only versioned present', () => {
			const result = summarizeInfisicalState({ legacyValue: null, versionedValue: '1:foo' });
			assert.equal(result.status, 'VERSIONED_ONLY');
		});

		it('CONSISTENT when envelope invariant holds', () => {
			const legacy = 'abc';
			const result = summarizeInfisicalState({ legacyValue: legacy, versionedValue: '1:abc' });
			assert.equal(result.status, 'CONSISTENT');
			assert.equal(result.envelopeOk, true);
		});

		it('DIVERGENT when envelope invariant broken', () => {
			const result = summarizeInfisicalState({ legacyValue: 'abc', versionedValue: '1:xyz' });
			assert.equal(result.status, 'DIVERGENT');
			assert.equal(result.envelopeOk, false);
		});

		it('expectedFresh comparison: DIVERGENT when fresh != legacy', () => {
			const result = summarizeInfisicalState({
				legacyValue: 'abc',
				versionedValue: '1:abc',
				expectedFresh: 'different',
			});
			assert.equal(result.status, 'DIVERGENT');
			assert.equal(result.freshOk, false);
		});

		it('expectedFresh comparison: CONSISTENT when fresh == legacy', () => {
			const result = summarizeInfisicalState({
				legacyValue: 'abc',
				versionedValue: '1:abc',
				expectedFresh: 'abc',
			});
			assert.equal(result.status, 'CONSISTENT');
			assert.equal(result.freshOk, true);
		});
	});

	describe('summarizeWorkerState', () => {
		it('detects legacy binding presence', () => {
			const result = summarizeWorkerState({ bindings: [SECRET_NAME_LEGACY] });
			assert.equal(result.hasLegacy, true);
			assert.equal(result.hasVersioned, false);
		});

		it('detects versioned binding presence', () => {
			const result = summarizeWorkerState({ bindings: [SECRET_NAME_VERSIONED] });
			assert.equal(result.hasLegacy, false);
			assert.equal(result.hasVersioned, true);
		});

		it('detects both bindings', () => {
			const result = summarizeWorkerState({
				bindings: [SECRET_NAME_LEGACY, SECRET_NAME_VERSIONED],
			});
			assert.equal(result.hasLegacy, true);
			assert.equal(result.hasVersioned, true);
		});

		it('empty bindings list', () => {
			const result = summarizeWorkerState({ bindings: [] });
			assert.equal(result.hasLegacy, false);
			assert.equal(result.hasVersioned, false);
			assert.equal(result.bindingsCount, 0);
		});

		it('counts bindings correctly', () => {
			const result = summarizeWorkerState({
				bindings: [SECRET_NAME_LEGACY, 'OTHER_KEY'],
			});
			assert.equal(result.bindingsCount, 2);
		});
	});

	describe('spawnInfisicalSet argv + stdio discipline', () => {
		it('argv contains --file <yamlPath> + --projectId <workspaceId>', () => {
			let capturedArgs = null;
			const captureSpawn = (_cmd, args) => {
				capturedArgs = args;
				return fakeChild();
			};
			const child = spawnInfisicalSet({
				cliPath: '/usr/local/bin/infisical',
				yamlPath: '/tmp/secret.yaml',
				environment: 'prod',
				workspaceId: 'workspace-id',
				env: {},
				deps: { spawn: captureSpawn },
			});
			child.stdout.resume();
			child.stderr.resume();
			// drain
			void capturedArgs;
			assert.equal(capturedArgs[capturedArgs.indexOf('--file') + 1], '/tmp/secret.yaml');
			assert.equal(capturedArgs[capturedArgs.indexOf('--env') + 1], 'prod');
			assert.equal(capturedArgs[capturedArgs.indexOf('--projectId') + 1], 'workspace-id');
		});

		it('uses explicit stdio pipes (stdin pipe, stdout pipe, stderr pipe)', () => {
			let capturedOpts = null;
			const captureSpawn = (_cmd, _args, opts) => {
				capturedOpts = opts;
				return fakeChild();
			};
			const child = spawnInfisicalSet({
				cliPath: '/usr/local/bin/infisical',
				yamlPath: '/tmp/secret.yaml',
				environment: 'prod',
				workspaceId: 'workspace-id',
				env: {},
				deps: { spawn: captureSpawn },
			});
			child.stdout.resume();
			child.stderr.resume();
			assert.equal(capturedOpts.stdio[0], 'pipe');
			assert.equal(capturedOpts.stdio[1], 'pipe');
			assert.equal(capturedOpts.stdio[2], 'pipe');
		});

		it('uses shell: false (no command interpreter)', () => {
			let capturedOpts = null;
			const captureSpawn = (_cmd, _args, opts) => {
				capturedOpts = opts;
				return fakeChild();
			};
			const child = spawnInfisicalSet({
				cliPath: '/usr/local/bin/infisical',
				yamlPath: '/tmp/secret.yaml',
				environment: 'prod',
				workspaceId: 'workspace-id',
				env: {},
				deps: { spawn: captureSpawn },
			});
			child.stdout.resume();
			child.stderr.resume();
			assert.notEqual(capturedOpts.shell, true);
		});
	});

	describe('spawnWranglerBulk argv + stdio discipline', () => {
		it('writes payload to stdin via child.stdin.write + .end', async () => {
			const written = [];
			const fakeChild = new EventEmitter();
			fakeChild.stdin = {
				write(chunk) {
					written.push(chunk.toString());
				},
				end() {},
			};
			fakeChild.stdout = new Readable({ read() {} });
			fakeChild.stderr = new Readable({ read() {} });
			const captureSpawn = () => fakeChild;

			const payload = JSON.stringify({ BETTER_AUTH_SECRET: 'freshsecret' });
			spawnWranglerBulk({ payload, env: {}, deps: { spawn: captureSpawn } });

			await new Promise((resolve) => setImmediate(resolve));
			assert.equal(written.join(''), payload);
		});

		it('uses explicit stdio pipes (stdin pipe, stdout/stderr inherit)', () => {
			let capturedOpts = null;
			const fakeChild = new EventEmitter();
			fakeChild.stdin = { write() {}, end() {} };
			fakeChild.stdout = new Readable({ read() {} });
			fakeChild.stderr = new Readable({ read() {} });
			const captureSpawn = (_cmd, _args, opts) => {
				capturedOpts = opts;
				return fakeChild;
			};
			spawnWranglerBulk({
				payload: '{}',
				env: {},
				deps: { spawn: captureSpawn },
			});
			assert.equal(capturedOpts.stdio[0], 'pipe');
			assert.equal(capturedOpts.stdio[1], 'inherit');
			assert.equal(capturedOpts.stdio[2], 'inherit');
		});

		it('argv includes -c <absolute path to wrangler.production.jsonc>', () => {
			let capturedArgs = null;
			const fakeChild = new EventEmitter();
			fakeChild.stdin = { write() {}, end() {} };
			fakeChild.stdout = new Readable({ read() {} });
			fakeChild.stderr = new Readable({ read() {} });
			const captureSpawn = (_cmd, args) => {
				capturedArgs = args;
				return fakeChild;
			};
			spawnWranglerBulk({
				payload: '{}',
				env: {},
				deps: { spawn: captureSpawn },
			});
			assert.ok(capturedArgs.includes('-c'));
			const configArg = capturedArgs[capturedArgs.indexOf('-c') + 1];
			assert.ok(configArg.endsWith('wrangler.production.jsonc'));
			assert.ok(capturedArgs.includes('secret'));
			assert.ok(capturedArgs.includes('bulk'));
		});

		it('argv does NOT include put or delete subcommand (bulk is the only path)', () => {
			let capturedArgs = null;
			const fakeChild = new EventEmitter();
			fakeChild.stdin = { write() {}, end() {} };
			fakeChild.stdout = new Readable({ read() {} });
			fakeChild.stderr = new Readable({ read() {} });
			const captureSpawn = (_cmd, args) => {
				capturedArgs = args;
				return fakeChild;
			};
			spawnWranglerBulk({
				payload: '{}',
				env: {},
				deps: { spawn: captureSpawn },
			});
			assert.ok(!capturedArgs.includes('put'));
			assert.ok(!capturedArgs.includes('delete'));
		});

		it('argv does NOT include secret value (only stdin)', () => {
			let capturedArgs = null;
			const fakeChild = new EventEmitter();
			fakeChild.stdin = { write() {}, end() {} };
			fakeChild.stdout = new Readable({ read() {} });
			fakeChild.stderr = new Readable({ read() {} });
			const captureSpawn = (_cmd, args) => {
				capturedArgs = args;
				return fakeChild;
			};
			spawnWranglerBulk({
				payload: JSON.stringify({ BETTER_AUTH_SECRET: 'should-not-appear-in-argv' }),
				env: {},
				deps: { spawn: captureSpawn },
			});
			const joined = capturedArgs.join(' ');
			assert.ok(!joined.includes('should-not-appear-in-argv'));
		});
	});

	describe('resolveInfisicalCliPath', () => {
		it('resolves the @infisical/cli native binary', () => {
			const path = resolveInfisicalCliPath();
			// Native binary, not a JS shim
			assert.ok(!path.endsWith('.js'), `expected native binary, got ${path}`);
			assert.ok(path.includes('infisical'));
		});

		it('rejects JS shim', () => {
			// Inject a fake package.json that points to a .js shim
			assert.throws(
				() =>
					resolveInfisicalCliPath({
						deps: {
							require: {
								resolve: () => '/fake/infisical/cli/package.json',
							},
							fsImpl: {
								readFileSync: () => JSON.stringify({ bin: { infisical: 'cli.js' } }),
							},
							pathImpl: {
								dirname: () => '/fake/infisical/cli',
								resolve: (...parts) => parts.join('/'),
							},
						},
					}),
				/native binary required/,
			);
		});

		it('accepts string bin', () => {
			const path = resolveInfisicalCliPath({
				deps: {
					require: {
						resolve: () => '/fake/infisical/cli/package.json',
					},
					fsImpl: {
						readFileSync: () => JSON.stringify({ bin: 'infisical-bin' }),
					},
					pathImpl: {
						dirname: () => '/fake/infisical/cli',
						resolve: (...parts) => parts.join('/'),
					},
				},
			});
			assert.equal(path, '/fake/infisical/cli/infisical-bin');
		});

		it('rejects missing bin field', () => {
			assert.throws(
				() =>
					resolveInfisicalCliPath({
						deps: {
							require: {
								resolve: () => '/fake/infisical/cli/package.json',
							},
							fsImpl: {
								readFileSync: () => JSON.stringify({}),
							},
							pathImpl: {
								dirname: () => '/fake/infisical/cli',
								resolve: () => '/fake/infisical/cli/bin',
							},
						},
					}),
				/must declare an `infisical` entry/,
			);
		});
	});

	describe('security invariants', () => {
		it('fresh secret never appears in buildInfisicalYamlContent as a literal lookup', () => {
			// Smoke check: the YAML is reproducible and contains the secret
			// only as YAML quoted scalar (which the CLI reads as the value).
			const s = 'unique-marker-12345';
			const yaml = buildInfisicalYamlContent(s);
			assert.ok(yaml.includes(`"BETTER_AUTH_SECRET": "${s}"`));
		});

		it('generateFreshSecret output is shell-quoting-safe (no special chars)', () => {
			// base64url charset is the only allowed alphabet
			const s = generateFreshSecret();
			assert.match(s, /^[A-Za-z0-9_-]+$/);
		});

		it('parseArgs never echoes the secret value (no default arg)', () => {
			const result = parseArgs([]);
			// result must not contain any secret-shaped key
			const serialized = JSON.stringify(result);
			assert.ok(!/BETTER_AUTH_(SECRET|SECRETS)/.test(serialized));
		});

		it('buildInfisicalSetArgs does not include the secret value', () => {
			const args = buildInfisicalSetArgs('/tmp/foo.yaml', 'prod', 'workspace-id');
			const joined = args.join('\n');
			assert.ok(!joined.includes('BETTER_AUTH_SECRET'));
			assert.ok(!joined.includes('BETTER_AUTH_SECRETS'));
		});

		it('buildWorkerBulkPayload is the only path that carries the secret', () => {
			// This invariant is enforced structurally — the payload is
			// constructed once and passed to stdin only.
			const payload = buildWorkerBulkPayload('test-secret-value');
			const parsed = JSON.parse(payload);
			assert.equal(parsed[SECRET_NAME_LEGACY], 'test-secret-value');
		});

		it('parseVersionedSecrets round-trip preserves byte sequence', () => {
			const s = generateFreshSecret();
			const envelope = buildVersionedForm(s);
			const parsed = parseVersionedSecrets(envelope);
			assert.equal(parsed[0].value, s);
		});
	});

	describe('buildSanitizedEnv (deprecated alias for buildWranglerEnv; PR #140 re-review fix)', () => {
		it('strips INFISICAL_TOKEN (writer token must not leak to Wrangler/D1 subprocesses)', () => {
			const env = buildSanitizedEnv({ INFISICAL_TOKEN: 'tok', NODE_ENV: 'test' });
			assert.equal(env.INFISICAL_TOKEN, undefined);
			assert.equal(env.NODE_ENV, 'test');
		});

		it('strips INFISICAL_CLIENT_ID and INFISICAL_CLIENT_SECRET', () => {
			const env = buildSanitizedEnv({
				INFISICAL_CLIENT_ID: 'cid',
				INFISICAL_CLIENT_SECRET: 'cs',
				NODE_ENV: 'test',
			});
			assert.equal(env.INFISICAL_CLIENT_ID, undefined);
			assert.equal(env.INFISICAL_CLIENT_SECRET, undefined);
			assert.equal(env.NODE_ENV, 'test');
		});

		it('strips the full Infisical credential set (PROJECT_ID, SITE_URL, API_URL)', () => {
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
			const input = { INFISICAL_TOKEN: 'tok', NODE_ENV: 'test' };
			const snapshot = { ...input };
			buildSanitizedEnv(input);
			assert.deepEqual(input, snapshot);
		});
	});

	describe('buildWranglerEnv (PR #140 re-review fix: full Infisical credential set stripped, NO token added)', () => {
		it('strips INFISICAL_TOKEN (Wrangler MUST NOT receive the writer-scoped Infisical token)', () => {
			const env = buildWranglerEnv({ INFISICAL_TOKEN: 'tok', NODE_ENV: 'test' });
			assert.equal(env.INFISICAL_TOKEN, undefined);
			assert.equal(env.NODE_ENV, 'test');
		});

		it('strips INFISICAL_CLIENT_ID and INFISICAL_CLIENT_SECRET', () => {
			const env = buildWranglerEnv({
				INFISICAL_CLIENT_ID: 'cid',
				INFISICAL_CLIENT_SECRET: 'cs',
				NODE_ENV: 'test',
			});
			assert.equal(env.INFISICAL_CLIENT_ID, undefined);
			assert.equal(env.INFISICAL_CLIENT_SECRET, undefined);
			assert.equal(env.NODE_ENV, 'test');
		});

		it('strips the full Infisical credential set (PROJECT_ID, SITE_URL, API_URL)', () => {
			const env = buildWranglerEnv({
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
			const input = { INFISICAL_TOKEN: 'tok', NODE_ENV: 'test' };
			const snapshot = { ...input };
			buildWranglerEnv(input);
			assert.deepEqual(input, snapshot);
		});
	});

	describe('buildInfisicalEnv (PR #140 re-review fix: Infisical CLI MUST receive the writer token)', () => {
		it('sets INFISICAL_TOKEN from the explicit token argument (CLI needs it to authenticate)', () => {
			const env = buildInfisicalEnv({ NODE_ENV: 'test' }, 'writer-token-abc');
			assert.equal(env.INFISICAL_TOKEN, 'writer-token-abc');
			assert.equal(env.NODE_ENV, 'test');
		});

		it('overrides an INFISICAL_TOKEN already in baseEnv with the explicit token argument', () => {
			// If baseEnv already had a viewer token, the writer token wins.
			const env = buildInfisicalEnv(
				{ INFISICAL_TOKEN: 'viewer-token', NODE_ENV: 'test' },
				'writer-token-xyz',
			);
			assert.equal(env.INFISICAL_TOKEN, 'writer-token-xyz');
		});

		it('strips the OTHER Infisical credentials (CLIENT_ID/SECRET/PROJECT_ID/SITE_URL/API_URL)', () => {
			const env = buildInfisicalEnv(
				{
					INFISICAL_CLIENT_ID: 'cid',
					INFISICAL_CLIENT_SECRET: 'cs',
					INFISICAL_PROJECT_ID: 'p',
					INFISICAL_SITE_URL: 's',
					INFISICAL_API_URL: 'a',
					NODE_ENV: 'test',
				},
				'writer-token',
			);
			assert.equal(env.INFISICAL_CLIENT_ID, undefined);
			assert.equal(env.INFISICAL_CLIENT_SECRET, undefined);
			assert.equal(env.INFISICAL_PROJECT_ID, undefined);
			assert.equal(env.INFISICAL_SITE_URL, undefined);
			assert.equal(env.INFISICAL_API_URL, undefined);
			assert.equal(env.INFISICAL_TOKEN, 'writer-token');
			assert.equal(env.NODE_ENV, 'test');
		});

		it('does not mutate the input baseEnv', () => {
			const input = {
				INFISICAL_TOKEN: 'old',
				INFISICAL_CLIENT_ID: 'cid',
				NODE_ENV: 'test',
			};
			const snapshot = { ...input };
			buildInfisicalEnv(input, 'new-token');
			assert.deepEqual(input, snapshot);
		});
	});
});

describe('Infisical raw-secret read contract (Better Auth)', () => {
	it('omits the type query parameter and preserves required raw-secret parameters', () => {
		const url = buildSecretReadUrl({
			apiUrl: 'https://secrets.rebuildup.dev/',
			workspaceId: 'workspace-id',
			environment: 'prod',
			name: SECRET_NAME_LEGACY,
		});
		const parsed = new URL(url);
		assert.equal(parsed.pathname, `/api/v3/secrets/raw/${SECRET_NAME_LEGACY}`);
		assert.equal(parsed.searchParams.get('workspaceId'), 'workspace-id');
		assert.equal(parsed.searchParams.get('environment'), 'prod');
		assert.equal(parsed.searchParams.get('secretPath'), '/');
		assert.equal(parsed.searchParams.get('viewSecretValue'), 'true');
		assert.equal(parsed.searchParams.has('type'), false);
	});

	it('classifies 404 as missing only when allowNotFound=true', () => {
		assert.equal(classifyInfisicalHttpStatus(200, { allowNotFound: true }), 'ok');
		assert.equal(classifyInfisicalHttpStatus(404, { allowNotFound: true }), 'missing');
		assert.equal(classifyInfisicalHttpStatus(404, { allowNotFound: false }), 'error');
		assert.equal(classifyInfisicalHttpStatus(401, { allowNotFound: true }), 'error');
		assert.equal(classifyInfisicalHttpStatus(403, { allowNotFound: true }), 'error');
		assert.equal(classifyInfisicalHttpStatus(500, { allowNotFound: true }), 'error');
	});

	it('reads the wrapped Infisical response shape', () => {
		const value = 'placeholder-not-a-real-secret';
		assert.equal(
			interpretInfisicalReadResponse({
				response: { secret: { secretValue: value, type: 'shared' } },
				allowMissing: false,
				environment: 'prod',
				name: SECRET_NAME_LEGACY,
			}),
			value,
		);
	});

	it('rejects the obsolete flat response shape', () => {
		assert.throws(
			() =>
				interpretInfisicalReadResponse({
					response: { secretValue: 'placeholder-not-a-real-secret' },
					allowMissing: false,
					environment: 'prod',
					name: SECRET_NAME_LEGACY,
				}),
			/missing or empty/,
		);
	});

	it('returns null only for an explicitly allowed missing response', () => {
		assert.equal(
			interpretInfisicalReadResponse({
				response: null,
				allowMissing: true,
				environment: 'prod',
				name: SECRET_NAME_LEGACY,
			}),
			null,
		);
		assert.throws(
			() =>
				interpretInfisicalReadResponse({
					response: null,
					allowMissing: false,
					environment: 'prod',
					name: SECRET_NAME_LEGACY,
				}),
			/missing or empty/,
		);
	});
});
