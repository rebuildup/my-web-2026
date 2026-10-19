import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PUBLIC_MEDIA_PREFIXES, isPublicMediaKey } from '../src/cloudflare/media-visibility.ts';
import {
	UNDECIDABLE_REASON,
	VERDICT,
	assertNoKeyInText,
	auditKeySet,
	collectBucketKeys,
	exitCodeFor,
	formatAuditReport,
	readPageKeys,
	undecidableAudit,
} from './_r2-media-key-set.mjs';

/**
 * R2 key-set audit tests (Issue #577, owner option (a)).
 *
 * The three properties the gate exists for, each asserted directly:
 *
 *   1. a key set inside the allowlist passes, and one key outside it
 *      fails with a count and never with a name;
 *   2. every state in which the audit cannot decide — no credential,
 *      an API failure, an unparseable page, an incomplete pagination
 *      walk, an empty production listing — exits non-zero, so a broken
 *      read is never mistaken for a clean bucket;
 *   3. the rendered report contains the verdict and the counts and no
 *      object key, in the formatter and in the CLI's real stdout.
 *
 * Nothing here reaches a network or a bucket: the paginator is an
 * injected stub, the CLI runs against recorded listings in
 * `quality/fixtures/r2-media-key-set/`, and the production path is
 * exercised only as far as it can be without a credential — which is
 * precisely the missing-credential branch.
 */

const CLI = fileURLToPath(new URL('./check-r2-media-key-set.mjs', import.meta.url));
const FIXTURE_DIR = fileURLToPath(
	new URL('../quality/fixtures/r2-media-key-set/', import.meta.url),
);

/** A child env with no Cloudflare credential at all. */
const CREDENTIAL_FREE_ENV = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };

function runCli(args, env = CREDENTIAL_FREE_ENV) {
	const result = spawnSync(process.execPath, [CLI, ...args], {
		encoding: 'utf8',
		env,
		cwd: fileURLToPath(new URL('..', import.meta.url)),
	});
	return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function fixture(name) {
	return JSON.parse(readFileSync(`${FIXTURE_DIR}${name}`, 'utf8'));
}

/** Verdict line of a rendered report, parsed the way an operator reads it. */
function verdictOf(text) {
	return /verdict=(\w+)/.exec(text)?.[1];
}

const META = {
	source: 'fixture',
	target: 'fixture',
	bucket: 'my-web-2026',
	prefixCount: PUBLIC_MEDIA_PREFIXES.length,
	prefixSource: 'src/cloudflare/media-visibility.ts',
};

describe('the audit reads the shipped allowlist, not a copy of it', () => {
	it('accepts a key under every declared public prefix', () => {
		assert.ok(PUBLIC_MEDIA_PREFIXES.length > 0, 'the allowlist must not be empty');
		for (const prefix of PUBLIC_MEDIA_PREFIXES) {
			assert.equal(isPublicMediaKey(`${prefix}anything.webp`), true);
			const audit = auditKeySet([`${prefix}anything.webp`], isPublicMediaKey);
			assert.equal(audit.verdict, VERDICT.ok);
		}
	});

	it('refuses a namespace nobody declared', () => {
		const audit = auditKeySet(['not-a-declared-namespace/cover.webp'], isPublicMediaKey);
		assert.equal(audit.verdict, VERDICT.violation);
		assert.equal(audit.keysOutsideAllowlist, 1);
	});
});

describe('auditKeySet', () => {
	it('passes a key set that is entirely inside the allowlist', () => {
		const audit = auditKeySet(
			['portfolio/example/cover.webp', 'reactions/deadbeef.png'],
			isPublicMediaKey,
		);
		assert.equal(audit.verdict, VERDICT.ok);
		assert.equal(audit.keysTotal, 2);
		assert.equal(audit.keysInsideAllowlist, 2);
		assert.equal(audit.keysOutsideAllowlist, 0);
		assert.equal(exitCodeFor(audit), 0);
	});

	it('fails on a single key outside the allowlist and counts it', () => {
		const audit = auditKeySet(
			['portfolio/example/cover.webp', 'private/draft/secret-cover.webp'],
			isPublicMediaKey,
		);
		assert.equal(audit.verdict, VERDICT.violation);
		assert.equal(audit.keysTotal, 2);
		assert.equal(audit.keysInsideAllowlist, 1);
		assert.equal(audit.keysOutsideAllowlist, 1);
		assert.equal(exitCodeFor(audit), 1);
	});

	it('counts a malformed key as unowned rather than skipping it', () => {
		// An unclassifiable key is an unowned key: dropping it would turn
		// "we could not judge this one" into a pass.
		const audit = auditKeySet(['portfolio/example/cover.webp', '../escape.webp'], isPublicMediaKey);
		assert.equal(audit.verdict, VERDICT.violation);
		assert.equal(audit.keysTotal, 2);
		assert.equal(audit.keysOutsideAllowlist, 1);
	});

	it('is undecidable — never a pass — when a key is not a string', () => {
		const audit = auditKeySet(['portfolio/example/cover.webp', 42], isPublicMediaKey);
		assert.equal(audit.verdict, VERDICT.undecidable);
		assert.equal(audit.keysTotal, null);
		assert.equal(exitCodeFor(audit), 2);
	});
});

describe('readPageKeys', () => {
	it('reads the array of object entries the CLI prints', () => {
		const read = readPageKeys('[{"key":"portfolio/example/cover.webp"}]', 1000);
		assert.deepEqual(read.keys, ['portfolio/example/cover.webp']);
		assert.equal(read.truncated, false);
	});

	it('reads the S3-style envelope an API-backed listing may answer with', () => {
		const read = readPageKeys(
			{ objects: [{ key: 'portfolio/example/cover.webp' }], truncated: false },
			1000,
		);
		assert.deepEqual(read.keys, ['portfolio/example/cover.webp']);
		assert.equal(read.truncated, false);
	});

	it('treats a response that declares itself truncated as incomplete', () => {
		const read = readPageKeys(
			{ objects: [{ key: 'portfolio/example/cover.webp' }], truncated: true },
			1000,
		);
		assert.equal(read.truncated, true);
	});

	it('refuses a non-JSON page instead of reading it as empty', () => {
		assert.equal(
			readPageKeys('Error: authentication failed', 1000).reason,
			UNDECIDABLE_REASON.listingUnparseable,
		);
		assert.equal(readPageKeys('', 1000).reason, UNDECIDABLE_REASON.listingUnparseable);
		assert.equal(readPageKeys(null, 1000).reason, UNDECIDABLE_REASON.listingUnparseable);
		assert.equal(
			readPageKeys({ cursor: null }, 1000).reason,
			UNDECIDABLE_REASON.listingUnparseable,
		);
	});

	it('refuses a page whose entries carry no usable key', () => {
		assert.equal(
			readPageKeys('[{"name":"portfolio/example/cover.webp"}]', 1000).reason,
			UNDECIDABLE_REASON.listingUnparseable,
		);
	});
});

describe('collectBucketKeys', () => {
	it('accepts a response shorter than the requested page size', async () => {
		const collected = await collectBucketKeys({
			listPage: () => [{ key: 'portfolio/a/cover.webp' }],
			perPage: 1000,
		});
		assert.deepEqual(collected.keys, ['portfolio/a/cover.webp']);
		assert.equal(collected.pagesWalked, 1);
	});

	it('refuses a full page rather than claiming it read the bucket', async () => {
		// The driver cannot continue past a full page (no cursor in the
		// CLI output, and the continuation flag is ignored locally), so a
		// full page means the enumeration is unknown, not clean.
		const listPage = ({ perPage }) =>
			Array.from({ length: perPage }, (_, i) => ({ key: `portfolio/p${i}/cover.webp` }));
		const collected = await collectBucketKeys({ listPage, perPage: 3 });
		assert.equal(collected.reason, UNDECIDABLE_REASON.listingIncomplete);
	});

	it('returns no keys for an empty listing', async () => {
		const collected = await collectBucketKeys({ listPage: () => [], perPage: 1000 });
		assert.deepEqual(collected.keys, []);
	});
});

describe('the rendered report is status-only', () => {
	const keys = ['portfolio/example/cover.webp', 'private/draft/hidden-cover.webp'];

	it('carries the verdict, the counts, and no key', () => {
		const text = formatAuditReport(auditKeySet(keys, isPublicMediaKey), META);
		assert.equal(verdictOf(text), VERDICT.violation);
		assert.match(text, /keys_total=2/);
		assert.match(text, /keys_outside_allowlist=1/);
		assert.match(text, /diff=present/);
		for (const key of keys) assert.equal(text.includes(key), false);
		assert.doesNotThrow(() => assertNoKeyInText(text, keys));
	});

	it('prints "unknown" rather than "0" when the audit could not look', () => {
		const text = formatAuditReport(undecidableAudit(UNDECIDABLE_REASON.listingFailed), META);
		assert.equal(verdictOf(text), VERDICT.undecidable);
		assert.match(text, /keys_total=unknown/);
		assert.equal(text.includes('keys_total=0'), false);
		assert.match(text, /diff=unknown/);
	});

	it('refuses to render a report that names an object key', () => {
		assert.throws(
			() => assertNoKeyInText(`keys: ${keys[1]}`, keys),
			/status-only contract is not negotiable/,
		);
	});

	it('does not treat a short fragment as a leak', () => {
		// A one- or two-character "key" cannot be told apart from prose,
		// so the guard starts where a real object key starts.
		assert.doesNotThrow(() => assertNoKeyInText('verdict=OK', ['ab']));
	});
});

describe('the CLI', () => {
	it('passes the clean fixture and fails the out-of-allowlist fixture', () => {
		const clean = runCli(['--fixture=quality/fixtures/r2-media-key-set/clean.json']);
		const violation = runCli(['--fixture=quality/fixtures/r2-media-key-set/out-of-allowlist.json']);
		assert.equal(clean.status, fixture('clean.json').expect.exitCode);
		assert.equal(verdictOf(clean.stdout), fixture('clean.json').expect.verdict);
		assert.equal(violation.status, fixture('out-of-allowlist.json').expect.exitCode);
		assert.equal(verdictOf(violation.stdout), fixture('out-of-allowlist.json').expect.verdict);
		assert.match(violation.stdout, /keys_outside_allowlist=1/);
	});

	it('fails closed on an empty listing and on an unparseable one', () => {
		for (const name of ['empty-listing.json', 'unparseable-listing.json']) {
			const run = runCli([`--fixture=quality/fixtures/r2-media-key-set/${name}`]);
			assert.equal(run.status, fixture(name).expect.exitCode, name);
			assert.equal(verdictOf(run.stdout), fixture(name).expect.verdict, name);
			assert.notEqual(run.status, 0, name);
		}
	});

	it('prints no object key, whatever the verdict', () => {
		const listing = JSON.parse(readFileSync(`${FIXTURE_DIR}out-of-allowlist.json`, 'utf8')).listing;
		const keys = [...listing.matchAll(/"key": "([^"]+)"/g)].map((match) => match[1]);
		assert.ok(keys.length > 0);
		const run = runCli(['--fixture=quality/fixtures/r2-media-key-set/out-of-allowlist.json']);
		for (const key of keys) assert.equal(run.stdout.includes(key), false);
	});

	it('marks a fixture run as a demonstration, not a release verdict', () => {
		const run = runCli(['--fixture=quality/fixtures/r2-media-key-set/clean.json']);
		assert.match(run.stdout, /source=fixture/);
		assert.match(run.stdout, /NOT a release verdict/);
	});

	it('fails closed on the production target when the R2 credential is absent', () => {
		// No credential is the state CI is always in, and it must be a
		// failed audit rather than a silent pass.
		const run = runCli(['--target=production'], CREDENTIAL_FREE_ENV);
		assert.equal(run.status, 2);
		assert.equal(verdictOf(run.stdout), VERDICT.undecidable);
		assert.match(run.stdout, /reason=credential_missing/);
	});

	it('refuses a usage error instead of reporting a security verdict', () => {
		const run = runCli(['--target=staging']);
		assert.equal(run.status, 2);
		assert.equal(verdictOf(run.stdout), undefined);
		assert.match(run.stderr, /no "remote" target/);
	});
});
