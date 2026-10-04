import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	AUDIT_ONLY_SECRET_NAME,
	BuildOutputError,
	RUNTIME_SECRET_NAMES,
	assertDeployableBuildOutput,
	assertDeployCredentialAvailable,
	assertNoAuditOnlySecrets,
	buildDeployArgv,
} from './_cf-build-output.mjs';

/**
 * Production deploy-path tests (Issue #247).
 *
 * The gate these pin is the one that changed meaning: permission to
 * deploy to production used to come from naming
 * `--config=wrangler.production.jsonc`. It now comes from the Build
 * Output actually being shipped.
 */

describe('buildDeployArgv (Issue #247)', () => {
	it('is the exact production cf prebuilt deploy', () => {
		assert.deepEqual(buildDeployArgv({ secretsFile: '/tmp/s.json' }), [
			'cf',
			'deploy',
			'--prebuilt',
			'--mode',
			'production',
			'--secrets-file',
			'/tmp/s.json',
		]);
	});

	it('appends --dry-run for the CI self-test path', () => {
		const argv = buildDeployArgv({ secretsFile: '/tmp/s.json', dryRun: true });
		assert.ok(argv.includes('--dry-run'));
		// The production flags must be identical either way.
		assert.ok(argv.includes('--prebuilt'));
		assert.deepEqual(argv.slice(argv.indexOf('--mode'), argv.indexOf('--mode') + 2), [
			'--mode',
			'production',
		]);
	});

	it('includes the executable so a caller cannot forget it', () => {
		// Regression: the builder originally returned args only, and a
		// caller passing them straight to `pnpm exec` silently ran
		// `pnpm exec deploy ...`.
		assert.equal(buildDeployArgv({ secretsFile: '/tmp/s.json' })[0], 'cf');
	});
});

describe('assertNoAuditOnlySecrets (Issue #243 regression)', () => {
	it('rejects a secrets file carrying the legacy audit-only secret', () => {
		assert.throws(
			() =>
				assertNoAuditOnlySecrets({
					BETTER_AUTH_SECRETS: 'x',
					[AUDIT_ONLY_SECRET_NAME]: 'y',
				}),
			BuildOutputError,
		);
	});

	it('accepts a secrets file with only the runtime set', () => {
		const clean = Object.fromEntries(RUNTIME_SECRET_NAMES.map((n) => [n, 'v']));
		assert.doesNotThrow(() => assertNoAuditOnlySecrets(clean));
	});
});

describe('assertDeployableBuildOutput (Issue #247)', () => {
	it('fails when there is no Build Output at all', () => {
		assert.throws(
			() => assertDeployableBuildOutput({ dir: '/tmp/definitely-not-here-xyz' }),
			/missing Build Output/,
		);
	});

	it('resolves account/worker defaults without a precedence bug', () => {
		// A previous version wrote `info.accountId !== options.accountId ?? DEFAULT`,
		// which parses as `(a !== b) ?? c` and never compares against the
		// default. With no options, the canonical defaults must still apply.
		// A wrong worker name must therefore be rejected.
		assert.throws(
			() => assertDeployableBuildOutput({ workerName: 'some-other-worker' }),
			/is not some-other-worker/,
		);
	});
});

describe('assertDeployCredentialAvailable (Issue #247)', () => {
	it('requires an explicit deploy-time credential for a production deploy', () => {
		assert.throws(() => assertDeployCredentialAvailable({}), /CLOUDFLARE_API_TOKEN is required/);
		assert.throws(() => assertDeployCredentialAvailable({ CLOUDFLARE_API_TOKEN: '' }), /required/);
	});

	it('passes when present, and never treats it as a runtime secret', () => {
		assert.doesNotThrow(() => assertDeployCredentialAvailable({ CLOUDFLARE_API_TOKEN: 't' }));
		// It must not appear in the runtime required-secret contract.
		assert.ok(!RUNTIME_SECRET_NAMES.includes('CLOUDFLARE_API_TOKEN'));
		assert.ok(!RUNTIME_SECRET_NAMES.includes(AUDIT_ONLY_SECRET_NAME));
	});
});
