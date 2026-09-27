import assert from 'node:assert/strict';
import {
	parseArgs,
	parseVersionedSecrets,
	validateLegacyPlaintext,
	buildVersionedForm,
	buildYamlContent,
	assertYamlContentInvariant,
	buildBulkPayload,
	buildWranglerBulkArgs,
	buildInfisicalSetArgs,
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

	describe('bulk payload (stdin JSON for wrangler secret bulk)', () => {
		it('flip payload: { BETTER_AUTH_SECRETS: "1:<plaintext>" }', () => {
			const payload = buildBulkPayload({
				operation: 'flip',
				versionedForm: '1:my-plaintext',
			});
			assert.equal(payload, JSON.stringify({ BETTER_AUTH_SECRETS: '1:my-plaintext' }));
		});

		it('delete-legacy-only payload: { BETTER_AUTH_SECRET: null }', () => {
			const payload = buildBulkPayload({
				operation: 'delete-legacy-only',
			});
			assert.equal(payload, JSON.stringify({ BETTER_AUTH_SECRET: null }));
		});

		it('restore-legacy-only payload: { BETTER_AUTH_SECRET: "<plaintext>" }', () => {
			const payload = buildBulkPayload({
				operation: 'restore-legacy-only',
				legacyPlaintext: 'my-plaintext',
			});
			assert.equal(payload, JSON.stringify({ BETTER_AUTH_SECRET: 'my-plaintext' }));
		});

		it('rollback-versioned-only payload: { BETTER_AUTH_SECRETS: null }', () => {
			const payload = buildBulkPayload({
				operation: 'rollback-versioned-only',
			});
			assert.equal(payload, JSON.stringify({ BETTER_AUTH_SECRETS: null }));
		});

		it('rejects unknown operation', () => {
			assert.throws(() => buildBulkPayload({ operation: 'unknown-op' }), /Unknown operation/);
		});

		it('flip payload parses back to expected shape', () => {
			const payload = buildBulkPayload({
				operation: 'flip',
				versionedForm: '1:hello',
			});
			const parsed = JSON.parse(payload);
			assert.deepEqual(Object.keys(parsed), ['BETTER_AUTH_SECRETS']);
			assert.equal(parsed.BETTER_AUTH_SECRETS, '1:hello');
		});

		it('delete-legacy-only payload parses back with explicit null', () => {
			const payload = buildBulkPayload({ operation: 'delete-legacy-only' });
			const parsed = JSON.parse(payload);
			assert.equal(parsed.BETTER_AUTH_SECRET, null);
		});
	});

	describe('buildWranglerBulkArgs (argv discipline)', () => {
		it('uses "secret bulk" subcommand (NOT put/delete)', () => {
			const argv = buildWranglerBulkArgs();
			const idx = argv.indexOf('secret');
			assert.ok(idx >= 0, 'argv must contain "secret"');
			assert.equal(argv[idx + 1], 'bulk', 'argv must be "secret bulk ..."');
			assert.ok(!argv.includes('put'), 'argv must NOT contain "put"');
			assert.ok(!argv.includes('delete'), 'argv must NOT contain "delete"');
		});

		it('always includes -c wrangler.production.jsonc', () => {
			const argv = buildWranglerBulkArgs();
			const cIdx = argv.indexOf('-c');
			assert.ok(cIdx >= 0, 'argv must contain -c');
			assert.match(argv[cIdx + 1], /wrangler\.production\.jsonc$/);
		});
	});

	describe('buildInfisicalSetArgs (argv discipline)', () => {
		it('uses "secrets set --file <yaml> --env=prod --path=/"', () => {
			const argv = buildInfisicalSetArgs({ yamlPath: '/tmp/foo.yaml', environment: 'prod' });
			assert.deepEqual(argv, [
				'secrets',
				'set',
				'--file',
				'/tmp/foo.yaml',
				'--env',
				'prod',
				'--path',
				'/',
			]);
		});
	});
});
