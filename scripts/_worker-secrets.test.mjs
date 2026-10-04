import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	assertWorkerSecretWriteAllowed,
	buildBulkSecretPayload,
	bulkUpdateWorkerSecrets,
	MAX_OPERATIONS,
} from './_worker-secrets.mjs';
import { ACCOUNT_ID, WORKER_NAME } from './_cloudflare-identity.mjs';

/**
 * Worker-secret adapter tests (Issue #247).
 *
 * The wire shape and the write gate are the two things a beta CLI
 * change or a careless caller could silently break, so both are
 * pinned here rather than inferred from documentation.
 */

const DUMMY = 'dummy-not-a-real-secret';

describe('buildBulkSecretPayload — Merge Patch shape', () => {
	it('emits the exact value-object shape for create/update', () => {
		assert.deepEqual(buildBulkSecretPayload({ BETTER_AUTH_SECRETS: DUMMY }), {
			secrets: {
				BETTER_AUTH_SECRETS: {
					type: 'secret_text',
					name: 'BETTER_AUTH_SECRETS',
					text: DUMMY,
				},
			},
		});
	});

	it('encodes a delete as null, never as an empty string', () => {
		assert.deepEqual(buildBulkSecretPayload({ BETTER_AUTH_SECRET: null }), {
			secrets: { BETTER_AUTH_SECRET: null },
		});
	});

	it('omits untouched bindings entirely so they stay unchanged', () => {
		const payload = buildBulkSecretPayload({ BETTER_AUTH_SECRET: null });
		assert.deepEqual(Object.keys(payload.secrets), ['BETTER_AUTH_SECRET']);
		assert.ok(!('BETTER_AUTH_SECRETS' in payload.secrets));
		assert.ok(!('MY_WEB_2026_CONSUMER_API_KEY' in payload.secrets));
		assert.ok(!('GOOGLE_ANALYTICS_MEASUREMENT_ID' in payload.secrets));
	});

	it('a one-key delete does not serialise the other secrets (#243)', () => {
		// Deleting the legacy binding must not re-send the current set:
		// re-sending races concurrent changes, a patch does not.
		const payload = buildBulkSecretPayload({ BETTER_AUTH_SECRET: null });
		assert.equal(Object.keys(payload.secrets).length, 1);
		assert.equal(payload.secrets.BETTER_AUTH_SECRET, null);
	});

	it('rejects an empty patch, an invalid name, and an empty value', () => {
		assert.throws(() => buildBulkSecretPayload({}), /empty bulk secret patch/);
		assert.throws(() => buildBulkSecretPayload({ 'bad name!': 'v' }), /invalid Worker secret name/);
		assert.throws(() => buildBulkSecretPayload({ OK_NAME: '' }), /non-empty string or null/);
		assert.throws(() => buildBulkSecretPayload([]), /must be an object/);
	});

	it('enforces a maximum operation count', () => {
		const many = Object.fromEntries(
			Array.from({ length: MAX_OPERATIONS + 1 }, (_, i) => [`S${i}`, 'v']),
		);
		assert.throws(() => buildBulkSecretPayload(many), /refusing a bulk secret patch/);
	});
});

describe('assertWorkerSecretWriteAllowed (lowest-layer gate)', () => {
	const base = { execute: true, env: { CLOUDFLARE_API_TOKEN: 't' } };

	it('authorizes the canonical identity with a Worker credential', () => {
		assert.doesNotThrow(() => assertWorkerSecretWriteAllowed({ ...base }));
	});

	it('rejects a missing execute before any network call', () => {
		assert.throws(
			() => assertWorkerSecretWriteAllowed({ execute: false, env: { CLOUDFLARE_API_TOKEN: 't' } }),
			/without an explicit execute/,
		);
	});

	it('rejects a wrong account and a wrong Worker name', () => {
		assert.throws(
			() => assertWorkerSecretWriteAllowed({ ...base, accountId: '0'.repeat(32) }),
			/on account/,
		);
		assert.throws(
			() => assertWorkerSecretWriteAllowed({ ...base, workerName: 'other' }),
			/on Worker/,
		);
	});

	it('requires a Worker-scoped credential and never accepts the D1 token', () => {
		assert.throws(
			() => assertWorkerSecretWriteAllowed({ ...base, env: {} }),
			/CLOUDFLARE_API_TOKEN/,
		);
		// A D1-scoped token presented as the Worker credential is a
		// different value, so the wrong token fails at the API rather
		// than silently working — and the helper offers no fallback.
		assert.throws(
			() =>
				assertWorkerSecretWriteAllowed({ ...base, env: { CLOUDFLARE_D1_API_TOKEN: 'd1-only' } }),
			/CLOUDFLARE_API_TOKEN is required/,
		);
	});
});

describe('bulkUpdateWorkerSecrets dry run', () => {
	it('reports names and operation types and sends nothing', async () => {
		const result = await bulkUpdateWorkerSecrets(
			{ BETTER_AUTH_SECRETS: DUMMY, BETTER_AUTH_SECRET: null },
			{ execute: false, env: { CLOUDFLARE_API_TOKEN: 't' } },
		);
		assert.equal(result.applied, false);
		assert.deepEqual(result.plan, [
			{ name: 'BETTER_AUTH_SECRETS', operation: 'create/update' },
			{ name: 'BETTER_AUTH_SECRET', operation: 'delete' },
		]);
		// No value, and no value length, in the reported plan.
		assert.ok(!JSON.stringify(result).includes(DUMMY));
	});

	it('validates before returning a plan, so an invalid patch fails offline', async () => {
		await assert.rejects(
			() => bulkUpdateWorkerSecrets({ 'bad name!': 'v' }, { execute: false, env: {} }),
			/invalid Worker secret name/,
		);
	});

	it('refuses a production mutation with no execute, before any network call', async () => {
		// The gate guards the mutation, so an un-authorised WRITE rejects.
		assert.throws(
			() =>
				assertWorkerSecretWriteAllowed({
					execute: false,
					env: { CLOUDFLARE_API_TOKEN: 't' },
				}),
			/without an explicit execute/,
		);
		// A dry run is the non-mutating path: it plans and sends nothing.
		const planned = await bulkUpdateWorkerSecrets(
			{ X: DUMMY },
			{
				execute: false,
				env: { CLOUDFLARE_API_TOKEN: 't' },
			},
		);
		assert.equal(planned.applied, false);
	});
});

describe('identity (Issue #247)', () => {
	it('pins the canonical account and Worker', () => {
		assert.equal(ACCOUNT_ID, 'c6ab6651a5d4d6d0d07686bbd3c3d56f');
		assert.equal(WORKER_NAME, 'my-web-2026');
	});
});
