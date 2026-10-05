import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACCOUNT_ID, R2_BUCKET_NAME } from './_cloudflare-identity.mjs';
import {
	MAX_OPERATIONS,
	R2_TARGETS,
	assertProductionWriteAllowed,
	getObject,
	putObject,
	resolveTarget,
} from './_r2.mjs';

/**
 * R2 driver tests (Issue #247, cleanup slice).
 *
 * The safety model and the CLI translation are the two things a beta
 * CLI change or a careless caller could silently break, so both are
 * pinned here rather than inferred from documentation.
 *
 * Nothing in this file reaches the network. Every remote-path test uses
 * a missing or dummy credential so the gate — never an API call — is
 * what decides the outcome.
 */

const DUMMY_R2 = 'dummy-not-a-real-r2-token';
const R2_ENV = { CLOUDFLARE_R2_API_TOKEN: DUMMY_R2, PATH: '/bin', HOME: '/tmp' };

describe('resolveTarget', () => {
	it('defaults to local, never to production', () => {
		// An omitted target here would be a production upload. The safe
		// default is load-bearing.
		assert.equal(resolveTarget(undefined), 'local');
		assert.equal(resolveTarget(null), 'local');
	});

	it('offers no "remote" target', () => {
		assert.deepEqual([...R2_TARGETS], ['local', 'production']);
		assert.throws(() => resolveTarget('remote'), /no "remote" target|refusing R2 target/);
	});

	it('rejects any unknown target', () => {
		assert.throws(() => resolveTarget('prod'), /refusing R2 target/);
		assert.throws(() => resolveTarget('staging'), /refusing R2 target/);
	});
});

describe('assertProductionWriteAllowed (lowest-layer gate)', () => {
	it('authorizes the canonical identity with an R2-scoped credential', () => {
		assert.doesNotThrow(() =>
			assertProductionWriteAllowed({ target: 'production', execute: true, env: R2_ENV }),
		);
	});

	it('refuses a production write without an explicit execute', () => {
		assert.throws(
			() => assertProductionWriteAllowed({ target: 'production', execute: false, env: R2_ENV }),
			/requires an explicit execute/,
		);
	});

	it('refuses a non-canonical bucket and a non-canonical account', () => {
		assert.throws(
			() =>
				assertProductionWriteAllowed({
					target: 'production',
					execute: true,
					bucketName: 'other-bucket',
					env: R2_ENV,
				}),
			/against bucket/,
		);
		assert.throws(
			() =>
				assertProductionWriteAllowed({
					target: 'production',
					execute: true,
					accountId: '0'.repeat(32),
					env: R2_ENV,
				}),
			/on account/,
		);
	});

	it('requires an R2 credential and never accepts the Worker or D1 token', () => {
		assert.throws(
			() => assertProductionWriteAllowed({ target: 'production', execute: true, env: {} }),
			/CLOUDFLARE_R2_API_TOKEN/,
		);
		// Neither sibling token is a fallback. Accepting one would widen
		// that token's capability into R2 without anyone deciding to.
		for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_D1_API_TOKEN']) {
			assert.throws(
				() =>
					assertProductionWriteAllowed({
						target: 'production',
						execute: true,
						env: { [key]: 'not-r2-scoped' },
					}),
				/CLOUDFLARE_R2_API_TOKEN is required/,
				`${key} must not be accepted as an R2 credential`,
			);
		}
	});

	it('does not gate local writes', () => {
		assert.doesNotThrow(() =>
			assertProductionWriteAllowed({ target: 'local', execute: false, env: {} }),
		);
	});
});

describe('putObject validation happens before any network call', () => {
	it('plans without sending when execute is false', () => {
		const result = putObject('portfolio/x.jpg', '/tmp/x.jpg', {
			target: 'local',
			contentType: 'image/jpeg',
			env: {},
		});
		assert.equal(result.applied, false);
		assert.equal(result.key, 'portfolio/x.jpg');
		assert.equal(result.bucket, R2_BUCKET_NAME);
		assert.equal(result.contentType, 'image/jpeg');
	});

	it('rejects a non-canonical bucket in dry run, before anything else', () => {
		assert.throws(
			() =>
				putObject('a.jpg', '/tmp/a.jpg', {
					target: 'local',
					contentType: 'image/jpeg',
					bucketName: 'elsewhere',
					env: {},
				}),
			/against bucket/,
		);
	});

	it('requires an explicit content type rather than defaulting one', () => {
		// Portfolio media is served with its stored type by the R2 custom
		// domain, so a guessed MIME type is a correctness bug.
		for (const bad of [undefined, null, '', 'image', 'not a type']) {
			assert.throws(
				() => putObject('a.jpg', '/tmp/a.jpg', { target: 'local', contentType: bad, env: {} }),
				/explicit valid content type/,
				`contentType ${JSON.stringify(bad)} must be rejected`,
			);
		}
	});

	it('rejects malformed object keys', () => {
		for (const bad of ['', null, 42, 'has\nnewline', '/leading', 'trailing/']) {
			assert.throws(
				() =>
					putObject(bad, '/tmp/a.jpg', {
						target: 'local',
						contentType: 'image/jpeg',
						env: {},
					}),
				/invalid R2 object key|must not start or end/,
				`key ${JSON.stringify(bad)} must be rejected`,
			);
		}
	});

	it('accepts a nested key with slashes', () => {
		const result = putObject('portfolio/multislicer/20250503_multi.jpg', '/tmp/a.jpg', {
			target: 'local',
			contentType: 'image/jpeg',
			env: {},
		});
		assert.equal(result.applied, false);
	});

	it('refuses an un-authorised production write before any network call', () => {
		// `execute: false` is the gate rejecting the mutation, so it must
		// not be reported as a no-op the way a dry run is.
		assert.throws(
			() =>
				putObject('a.jpg', '/tmp/a.jpg', {
					target: 'production',
					execute: false,
					contentType: 'image/jpeg',
					env: R2_ENV,
				}),
			/requires an explicit execute/,
		);
	});

	it('refuses a production write with no R2 credential, naming the variable', () => {
		assert.throws(
			() =>
				putObject('a.jpg', '/tmp/a.jpg', {
					target: 'production',
					execute: true,
					contentType: 'image/jpeg',
					env: { CLOUDFLARE_API_TOKEN: 'worker-token' },
				}),
			/CLOUDFLARE_R2_API_TOKEN is required/,
		);
	});
});

describe('getObject validation', () => {
	it('refuses a non-canonical bucket', () => {
		assert.throws(
			() => getObject('a.jpg', { target: 'local', bucketName: 'elsewhere', env: {} }),
			/against bucket/,
		);
	});

	it('refuses a malformed key', () => {
		// Both rejection paths are real: a non-string / control-char key
		// fails the grammar, and a leading slash fails the shape check.
		for (const bad of ['', null, 42, '/abs.jpg']) {
			assert.throws(
				() => getObject(bad, { target: 'local', env: {} }),
				/invalid R2 object key|must not start or end/,
				`key ${JSON.stringify(bad)} must be rejected`,
			);
		}
	});
});

describe('identity (Issue #247)', () => {
	it('pins the canonical account and bucket', () => {
		assert.equal(ACCOUNT_ID, 'c6ab6651a5d4d6d0d07686bbd3c3d56f');
		assert.equal(R2_BUCKET_NAME, 'my-web-2026');
	});
});

describe('limits', () => {
	it('publishes a max-operation ceiling', () => {
		assert.equal(typeof MAX_OPERATIONS, 'number');
		assert.ok(MAX_OPERATIONS > 0);
	});
});
