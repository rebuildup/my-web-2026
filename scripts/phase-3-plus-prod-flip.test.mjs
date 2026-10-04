import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
	parseArgs,
	parseVersionedSecrets,
	validateLegacyPlaintext,
	buildVersionedForm,
	buildYamlContent,
	assertYamlContentInvariant,
	buildWorkerSecretChanges,
	buildInfisicalSetArgs,
	planOperationAuth,
	resolveInfisicalCliPath,
	spawnInfisicalSet,
	OPERATIONS,
} from './phase-3-plus-prod-flip.mjs';
import { describe, it } from 'node:test';

describe('phase-3-plus-prod-flip.mjs', () => {
	describe('parseArgs mode grammar (v4)', () => {
		it('defaults to --dry-run + flip', () => {
			const result = parseArgs([]);
			assert.equal(result.execute, false);
			assert.equal(result.operation, 'flip');
			assert.equal(result.environment, 'prod');
		});

		it('--execute alone is the canonical flip combo (flip is the default operation)', () => {
			const result = parseArgs(['--execute']);
			assert.equal(result.execute, true);
			assert.equal(result.operation, 'flip');
		});

		it('--execute --delete-legacy-only is gate #2 canonical', () => {
			const result = parseArgs(['--execute', '--delete-legacy-only']);
			assert.equal(result.execute, true);
			assert.equal(result.operation, 'delete-legacy-only');
		});

		it('--execute --restore-legacy-only is gate #3 recovery', () => {
			const result = parseArgs(['--execute', '--restore-legacy-only']);
			assert.equal(result.execute, true);
			assert.equal(result.operation, 'restore-legacy-only');
		});

		it('--execute --rollback-versioned-only is smoke #1 rollback', () => {
			const result = parseArgs(['--execute', '--rollback-versioned-only']);
			assert.equal(result.execute, true);
			assert.equal(result.operation, 'rollback-versioned-only');
		});

		it('--dry-run + operation works (read-only verification)', () => {
			const result = parseArgs(['--dry-run', '--delete-legacy-only']);
			assert.equal(result.execute, false);
			assert.equal(result.operation, 'delete-legacy-only');
		});

		it('rejects --execute + --dry-run conflict', () => {
			assert.throws(() => parseArgs(['--execute', '--dry-run']), /conflicting execution gate/);
		});

		it('rejects two operations specified', () => {
			assert.throws(
				() => parseArgs(['--execute', '--delete-legacy-only', '--restore-legacy-only']),
				/conflicting operation flags/,
			);
		});

		it('rejects unknown argument', () => {
			assert.throws(() => parseArgs(['--bogus']), /unknown argument/);
		});

		it('OPERATIONS list contains exactly the four operation modes', () => {
			assert.deepEqual(OPERATIONS, [
				'flip',
				'delete-legacy-only',
				'restore-legacy-only',
				'rollback-versioned-only',
			]);
		});
	});

	describe('legacy plaintext validation (parseVersionedSecrets round-trip)', () => {
		it('accepts a typical legacy plaintext (no commas, no whitespace, no colons)', () => {
			const plaintext = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
			assert.doesNotThrow(() => validateLegacyPlaintext(plaintext));
		});

		it('accepts a plaintext with colons (parser splits on first colon only)', () => {
			const plaintext = 'key-with:colons-and-more';
			assert.doesNotThrow(() => validateLegacyPlaintext(plaintext));
		});

		it('rejects legacy plaintext containing a comma (would corrupt the envelope)', () => {
			assert.throws(() => validateLegacyPlaintext('hello,world'), /legacy plaintext contains ","/i);
		});

		it('rejects legacy plaintext with leading whitespace (outer-trim loss)', () => {
			assert.throws(
				() => validateLegacyPlaintext(' leading-space'),
				/leading or trailing whitespace/,
			);
		});

		it('rejects legacy plaintext with trailing whitespace (outer-trim loss)', () => {
			assert.throws(
				() => validateLegacyPlaintext('trailing-space '),
				/leading or trailing whitespace/,
			);
		});

		it('rejects empty plaintext', () => {
			assert.throws(() => validateLegacyPlaintext(''), /empty/);
		});

		it('rejects non-string plaintext', () => {
			assert.throws(() => validateLegacyPlaintext(null), /empty/);
			assert.throws(() => validateLegacyPlaintext(undefined), /empty/);
			assert.throws(() => validateLegacyPlaintext(123), /empty/);
		});

		it('buildVersionedForm produces "1:<plaintext>"', () => {
			assert.equal(buildVersionedForm('my-plaintext'), '1:my-plaintext');
		});

		it('parseVersionedSecrets round-trip: 1:<plaintext> → [{version:1, value:plaintext}]', () => {
			const plaintext = 'my-secret-value';
			const parsed = parseVersionedSecrets(buildVersionedForm(plaintext));
			assert.deepEqual(parsed, [{ version: 1, value: plaintext }]);
		});

		it('parseVersionedSecrets rejects empty input', () => {
			assert.throws(() => parseVersionedSecrets(''), /empty/);
		});

		it('parseVersionedSecrets rejects entries without colon', () => {
			assert.throws(() => parseVersionedSecrets('1'), /missing ':' separator/);
		});

		it('parseVersionedSecrets rejects non-digit versions', () => {
			assert.throws(() => parseVersionedSecrets('a:hello'), /invalid version/);
		});

		it('parseVersionedSecrets rejects zero / negative versions', () => {
			assert.throws(() => parseVersionedSecrets('0:hello'), /positive safe integer/);
			assert.throws(() => parseVersionedSecrets('-1:hello'), /invalid version/);
		});

		it('parseVersionedSecrets rejects empty values', () => {
			assert.throws(() => parseVersionedSecrets('1:'), /empty value/);
		});

		it('parseVersionedSecrets rejects duplicate versions', () => {
			assert.throws(() => parseVersionedSecrets('2:foo,2:bar'), /duplicate version/);
		});

		it('parseVersionedSecrets rejects non-descending order', () => {
			assert.throws(() => parseVersionedSecrets('1:foo,2:bar'), /strictly descending/);
		});

		it('parseVersionedSecrets accepts multi-entry descending forms', () => {
			const parsed = parseVersionedSecrets('2:new,1:old');
			assert.deepEqual(parsed, [
				{ version: 2, value: 'new' },
				{ version: 1, value: 'old' },
			]);
		});
	});

	describe('YAML content invariant (no standalone BETTER_AUTH_SECRET line)', () => {
		it('buildYamlContent produces a single-key YAML with quoted scalar', () => {
			const content = buildYamlContent('1:my-plaintext');
			assert.match(content, /^---\n/);
			assert.match(content, /"BETTER_AUTH_SECRETS": "1:my-plaintext"\n$/);
		});

		it('buildYamlContent does NOT contain a standalone BETTER_AUTH_SECRET: line', () => {
			const content = buildYamlContent('1:my-plaintext');
			assert.doesNotMatch(content, /^\s*BETTER_AUTH_SECRET\s*:/m);
		});

		it('assertYamlContentInvariant passes for the canonical YAML content', () => {
			const content = buildYamlContent('1:my-plaintext');
			assert.doesNotThrow(() => assertYamlContentInvariant(content));
		});

		it('assertYamlContentInvariant rejects a standalone BETTER_AUTH_SECRET: line', () => {
			const content = `---
"BETTER_AUTH_SECRETS": "1:foo"
"BETTER_AUTH_SECRET": "foo"
`;
			assert.throws(() => assertYamlContentInvariant(content), /standalone/);
		});

		it('buildYamlContent legacy plaintext may appear as part of the versioned value', () => {
			// This is the corrected invariant: plaintext appears as part of
			// `1:<plaintext>`, which is acceptable. The "no standalone
			// BETTER_AUTH_SECRET:" check correctly accepts this.
			const plaintext = 'super-secret-with-special-chars';
			const content = buildYamlContent(`1:${plaintext}`);
			assert.doesNotThrow(() => assertYamlContentInvariant(content));
			assert.ok(content.includes(plaintext));
		});
	});

	describe('buildWorkerSecretChanges (Merge Patch semantics)', () => {
		it('flip creates or updates only the versioned binding', () => {
			assert.deepEqual(
				buildWorkerSecretChanges({ operation: 'flip', versionedForm: '1:x', legacyPlaintext: 'y' }),
				{ BETTER_AUTH_SECRETS: '1:x' },
			);
		});

		it('delete-legacy-only patches ONLY the legacy binding to null', () => {
			const changes = buildWorkerSecretChanges({
				operation: 'delete-legacy-only',
				versionedForm: '1:x',
				legacyPlaintext: 'y',
			});
			assert.deepEqual(changes, { BETTER_AUTH_SECRET: null });
			// #243: a deletion must not re-send the current secret set.
			assert.deepEqual(Object.keys(changes), ['BETTER_AUTH_SECRET']);
		});

		it('restore-legacy-only re-creates the legacy binding', () => {
			assert.deepEqual(
				buildWorkerSecretChanges({
					operation: 'restore-legacy-only',
					versionedForm: '1:x',
					legacyPlaintext: 'y',
				}),
				{ BETTER_AUTH_SECRET: 'y' },
			);
		});

		it('rollback-versioned-only patches ONLY the versioned binding to null', () => {
			const changes = buildWorkerSecretChanges({
				operation: 'rollback-versioned-only',
				versionedForm: '1:x',
				legacyPlaintext: 'y',
			});
			assert.deepEqual(changes, { BETTER_AUTH_SECRETS: null });
			assert.deepEqual(Object.keys(changes), ['BETTER_AUTH_SECRETS']);
		});

		it('rejects an unknown operation', () => {
			assert.throws(
				() =>
					buildWorkerSecretChanges({
						operation: 'nope',
						versionedForm: '1:x',
						legacyPlaintext: 'y',
					}),
				/Unknown operation/,
			);
		});
	});

	describe('buildInfisicalSetArgs (argv discipline)', () => {
		it('pins secrets set to the preflighted project id', () => {
			const argv = buildInfisicalSetArgs({
				yamlPath: '/tmp/foo.yaml',
				environment: 'prod',
				projectId: 'project-123',
			});
			assert.deepEqual(argv, [
				'secrets',
				'set',
				'--file',
				'/tmp/foo.yaml',
				'--env',
				'prod',
				'--path',
				'/',
				'--projectId',
				'project-123',
			]);
		});
	});

	describe('planOperationAuth (Issue #99 — per-operation auth strategy)', () => {
		it('flip requires an operator identity, no UA fallback, needs both write and read', () => {
			const plan = planOperationAuth({ operation: 'flip' });
			assert.equal(plan.needsInfisicalWrite, true);
			assert.equal(plan.needsInfisicalRead, true);
			assert.equal(plan.requiresOperatorToken, true);
			assert.equal(plan.allowsUaFallback, false);
		});

		it('flip accepts a logged-in CLI session as an operator identity (Issue #223)', () => {
			// The session is read-preflighted before any mutation; write
			// scope stays operator-authorized rather than probed, which is
			// the same position #99 took for tokens.
			const plan = planOperationAuth({ operation: 'flip' });
			assert.equal(plan.allowsCliSession, true);
		});

		it('no other operation silently gains the CLI-session path', () => {
			for (const op of ['restore-legacy-only', 'delete-legacy-only', 'rollback-versioned-only']) {
				assert.equal(planOperationAuth({ operation: op }).allowsCliSession, undefined);
			}
		});

		it('restore-legacy-only prefers operator token, allows UA fallback (read-only)', () => {
			const plan = planOperationAuth({ operation: 'restore-legacy-only' });
			assert.equal(plan.needsInfisicalWrite, false);
			assert.equal(plan.needsInfisicalRead, true);
			assert.equal(plan.requiresOperatorToken, false);
			assert.equal(plan.allowsUaFallback, true);
		});

		it('delete-legacy-only needs no Infisical interaction at all', () => {
			const plan = planOperationAuth({ operation: 'delete-legacy-only' });
			assert.equal(plan.needsInfisicalWrite, false);
			assert.equal(plan.needsInfisicalRead, false);
			assert.equal(plan.requiresOperatorToken, false);
			assert.equal(plan.allowsUaFallback, false);
		});

		it('rollback-versioned-only needs no Infisical interaction at all', () => {
			const plan = planOperationAuth({ operation: 'rollback-versioned-only' });
			assert.equal(plan.needsInfisicalWrite, false);
			assert.equal(plan.needsInfisicalRead, false);
			assert.equal(plan.requiresOperatorToken, false);
			assert.equal(plan.allowsUaFallback, false);
		});

		it('throws on unknown operation', () => {
			assert.throws(() => planOperationAuth({ operation: 'bogus' }), /Unknown operation/);
		});
	});

	describe('resolveInfisicalCliPath (Issue #99 — native binary resolution)', () => {
		it('resolves to a real file path under node_modules/@infisical/cli/bin/', () => {
			const cliPath = resolveInfisicalCliPath();
			// The real install has `bin/infisical` (no extension, native ELF).
			assert.match(
				cliPath,
				/@infisical[\\/](?:cli|cli[\\/]node_modules[\\/](?:[^\\/.]+[\\/])?@infisical[\\/]cli)[\\/]bin[\\/]infisical$/,
			);
			assert.ok(existsSync(cliPath), `expected ${cliPath} to exist`);
			assert.ok(!cliPath.endsWith('.js'), `expected native binary, got ${cliPath}`);
		});

		it('uses bin.infisical string-form when package.json declares a string bin', () => {
			const fakePkgPath = '/tmp/fake-infisical-cli-pkg/package.json';
			const cliPath = resolveInfisicalCliPath({
				require_resolve: () => fakePkgPath,
				dirname: () => '/tmp/fake-infisical-cli-pkg',
				resolve: (dir, rel) => `${dir}/${rel}`,
				readFileSync: () =>
					JSON.stringify({ name: 'fake', version: '1.2.3', bin: './bin/infisical' }),
			});
			assert.equal(cliPath, '/tmp/fake-infisical-cli-pkg/./bin/infisical');
		});

		it('rejects a missing `infisical` entry in package.json#bin', () => {
			const fakePkgPath = '/tmp/fake-infisical-cli-pkg/package.json';
			assert.throws(
				() =>
					resolveInfisicalCliPath({
						require_resolve: () => fakePkgPath,
						dirname: () => '/tmp/fake-infisical-cli-pkg',
						resolve: (dir, rel) => `${dir}/${rel}`,
						readFileSync: () =>
							JSON.stringify({ name: 'fake', version: '1.2.3', bin: { other: './x' } }),
					}),
				/must declare an `infisical` entry/,
			);
		});

		it('rejects invalid JSON in package.json', () => {
			const fakePkgPath = '/tmp/fake-infisical-cli-pkg/package.json';
			assert.throws(
				() =>
					resolveInfisicalCliPath({
						require_resolve: () => fakePkgPath,
						dirname: () => '/tmp/fake-infisical-cli-pkg',
						resolve: (dir, rel) => `${dir}/${rel}`,
						readFileSync: () => '{not valid json',
					}),
				/is not valid JSON/,
			);
		});

		it('rejects a non-existent package path (require.resolve throws)', () => {
			assert.throws(
				() =>
					resolveInfisicalCliPath({
						require_resolve: () => {
							throw new Error("Cannot find module '@infisical/cli/package.json'");
						},
						dirname: () => '/tmp/x',
						resolve: (dir, rel) => `${dir}/${rel}`,
						readFileSync: () => '{}',
					}),
				/Cannot find module/,
			);
		});

		it('accepts an object-form bin field with an `infisical` key', () => {
			const fakePkgPath = '/tmp/fake-infisical-cli-pkg/package.json';
			const cliPath = resolveInfisicalCliPath({
				require_resolve: () => fakePkgPath,
				dirname: () => '/tmp/fake-infisical-cli-pkg',
				resolve: (dir, rel) => `${dir}/${rel}`,
				readFileSync: () =>
					JSON.stringify({
						name: 'fake',
						version: '1.2.3',
						bin: { infisical: './bin/infisical-native' },
					}),
			});
			assert.equal(cliPath, '/tmp/fake-infisical-cli-pkg/./bin/infisical-native');
		});

		it('throws when the resolved binary path ends in .js (would be a JS shim, not native)', () => {
			const fakePkgPath = '/tmp/fake-infisical-cli-pkg/package.json';
			assert.throws(
				() =>
					resolveInfisicalCliPath({
						require_resolve: () => fakePkgPath,
						dirname: () => '/tmp/fake-infisical-cli-pkg',
						resolve: (dir, rel) => `${dir}/${rel}`,
						readFileSync: () =>
							JSON.stringify({ name: 'fake', version: '1.2.3', bin: './bin/infisical.js' }),
					}),
				/binary path ends in \.js/,
			);
		});

		it('respects an injected moduleUrl (no implicit import.meta.url coupling in tests)', () => {
			// Inject a custom moduleUrl. The default impl would use
			// import.meta.url of the actual driver file; the test just
			// verifies the parameter is honored by the require path
			// resolution (we don't care about the resolved binary, only
			// that no exception is thrown for the parameter plumbing).
			const fakePkgPath = '/tmp/fake-infisical-cli-pkg/package.json';
			const cliPath = resolveInfisicalCliPath({
				moduleUrl: 'file:///tmp/driver.mjs',
				require_resolve: () => fakePkgPath,
				dirname: () => '/tmp/fake-infisical-cli-pkg',
				resolve: (dir, rel) => `${dir}/${rel}`,
				readFileSync: () =>
					JSON.stringify({ name: 'fake', version: '1.2.3', bin: './bin/infisical' }),
			});
			assert.equal(cliPath, '/tmp/fake-infisical-cli-pkg/./bin/infisical');
		});
	});

	describe('spawnInfisicalSet argv discipline (Issue #99 — no process.execPath wrap)', () => {
		it('uses deps.cliPath directly when supplied', () => {
			const calls = [];
			const fakeChild = { stdin: { write() {}, end() {} } };
			const fakeCliPath = '/tmp/fake-native-infisical';
			spawnInfisicalSet({
				yamlPath: '/tmp/foo.yaml',
				environment: 'prod',
				projectId: 'project-123',
				env: { FOO: 'bar' },
				deps: {
					spawn: (cmd, args, opts) => {
						calls.push({ cmd, args, opts });
						return fakeChild;
					},
					cliPath: fakeCliPath,
				},
			});
			assert.equal(calls.length, 1);
			assert.equal(calls[0].cmd, fakeCliPath);
			// Args should be the CLI argv only — NOT prefixed with process.execPath
			assert.deepEqual(calls[0].args, [
				'secrets',
				'set',
				'--file',
				'/tmp/foo.yaml',
				'--env',
				'prod',
				'--path',
				'/',
				'--projectId',
				'project-123',
			]);
			assert.equal(calls[0].opts.env.FOO, 'bar');
			assert.deepEqual(calls[0].opts.stdio, ['pipe', 'inherit', 'inherit']);
		});

		it('does NOT wrap the resolved CLI with process.execPath (the CLI is a native ELF, not a JS shim)', () => {
			const calls = [];
			const fakeChild = { stdin: { write() {}, end() {} } };
			spawnInfisicalSet({
				yamlPath: '/tmp/foo.yaml',
				environment: 'prod',
				projectId: 'project-123',
				env: {},
				deps: {
					spawn: (cmd, args, opts) => {
						calls.push({ cmd, args, opts });
						return fakeChild;
					},
					cliPath: '/tmp/resolved-native-infisical',
				},
			});
			// process.execPath is the Node binary. If the driver wrapped
			// the CLI with it, cmd would be Node — which would fail to
			// execute a native ELF. The driver MUST spawn the CLI
			// directly.
			assert.notEqual(calls[0].cmd, process.execPath);
		});
	});
});
