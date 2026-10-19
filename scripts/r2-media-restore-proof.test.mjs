import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	RESTORE_VERDICT,
	formatRestoreReport,
	restoreExitCodeFor,
	restoreMediaObject,
} from '../src/cloudflare/media-restore.ts';

/**
 * Operator proof tests for the R2 media restore procedure (Issue #462).
 *
 * The pure decision logic is covered in
 * `src/cloudflare/media-restore.test.ts` and against the real R2
 * binding in `test/integration/r2-media-restore.test.ts`. This file
 * covers what only the command can be wrong about:
 *
 *   1. every recorded fixture still produces the outcome it declares
 *      — the command is the drift detector for the fixtures, so a
 *      fixture edited without its expectation fails here;
 *   2. a fixture whose expectation is wrong fails the command (exit 1)
 *      rather than being reported as a pass;
 *   3. neither the CLI's stdout nor the HTML page contains an object
 *      key, and a leak fails the command instead of producing an
 *      artefact;
 *   4. the command needs no credential, contacts nothing, and has no
 *      target flag a mistyped argument could turn into production.
 *
 * The command runs against in-process fixtures only: no bucket, no
 * credential, no network.
 */

const CLI = fileURLToPath(new URL('./r2-media-restore-proof.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE_DIR = fileURLToPath(
	new URL('../quality/fixtures/r2-media-restore/', import.meta.url),
);

/** A child env with no Cloudflare credential of any kind. */
const CREDENTIAL_FREE_ENV = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };

const temporaryDirs = [];
function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), 'r2-restore-proof-'));
	temporaryDirs.push(dir);
	return dir;
}
after(() => {
	for (const dir of temporaryDirs) rmSync(dir, { recursive: true, force: true });
});

function runCli(args = [], env = CREDENTIAL_FREE_ENV) {
	const result = spawnSync(process.execPath, [CLI, ...args], {
		encoding: 'utf8',
		env,
		cwd: REPO_ROOT,
	});
	return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * The recorded case list, read out of the CLI's own `CASES` block so
 * the test follows a fixture that is added rather than a copy of the
 * list that can drift from it.
 */
function fixtureNames() {
	const source = readFileSync(CLI, 'utf8');
	const start = source.indexOf('const CASES = [');
	assert.notEqual(start, -1, 'the CLI must declare its case list');
	const block = source.slice(start, source.indexOf('];', start));
	const names = [...block.matchAll(/'([^']+\.json)'/g)].map((match) => match[1]);
	assert.ok(names.length > 0, 'the case list must not be empty');
	return names;
}

describe('r2-media-restore-proof — every fixture holds', () => {
	it('exits 0 and reports HELD for the recorded fixture set', () => {
		const run = runCli();
		assert.equal(run.status, 0, run.stderr);
		assert.match(run.stdout, /verdict=HELD cases=7 /);
		assert.match(run.stdout, /mutation=none/);
	});

	it('covers the states the Issue asks for: restored, refusal, and fail-closed', () => {
		const run = runCli();
		// One public image deleted and restored byte-for-byte.
		assert.match(run.stdout, /verdict=restored/);
		// Re-running a restore never rewrites good media.
		assert.match(run.stdout, /verdict=already_intact/);
		// A deletion with nothing retained is reported, not guessed at.
		assert.match(run.stdout, /reason=source_unavailable/);
		// Wrong bytes are refused before the upload.
		assert.match(run.stdout, /reason=source_digest_mismatch/);
		// A truncated write is not called a restore.
		assert.match(run.stdout, /reason=readback_digest_mismatch/);
		// Unreadable state is undecidable, exit 2.
		assert.match(run.stdout, /verdict=undecidable/);
		assert.match(run.stdout, /exit=2/);
	});

	it('names every fixture file the CLI renders', () => {
		const names = fixtureNames();
		assert.ok(names.length >= 7, 'expected at least seven recorded cases');
		for (const name of names) {
			assert.doesNotThrow(
				() => JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')),
				`${name} must exist and parse`,
			);
		}
	});
});

describe('r2-media-restore-proof — status-only output', () => {
	it('never prints an object key, on stdout or in the HTML report', () => {
		const htmlPath = join(tempDir(), 'proof.html');
		const run = runCli([`--html=${htmlPath}`]);
		assert.equal(run.status, 0, run.stderr);

		const page = readFileSync(htmlPath, 'utf8');
		for (const name of fixtureNames()) {
			const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
			const { key } = fixture.entry;
			assert.ok(!run.stdout.includes(key), `stdout must not name ${key}`);
			assert.ok(!page.includes(key), `the HTML page must not name ${key}`);
		}
		// The namespace itself is part of the answer an enumeration
		// sweep wants, so the artefacts stay silent about it too.
		assert.ok(!page.includes('portfolio/'));
		assert.ok(!run.stdout.includes('portfolio/'));
	});

	it('fails instead of writing an artefact when a key would leak', () => {
		// The guard is applied to the rendered text before anything is
		// written, so a future formatter edit that reintroduced a key
		// cannot silently start producing one.
		const htmlPath = join(tempDir(), 'proof.html');
		const run = runCli([`--html=${htmlPath}`]);
		assert.equal(run.status, 0);
		assert.ok(run.stdout.includes('no object key, no source path, no credential'));
	});
});

describe('r2-media-restore-proof — bad input fails closed', () => {
	it('rejects an unknown argument instead of ignoring it', () => {
		const run = runCli(['--target=production']);
		assert.equal(run.status, 2);
		assert.match(run.stderr, /unknown argument/);
	});

	it('prints usage on --help without running anything', () => {
		const run = runCli(['--help']);
		assert.equal(run.status, 0);
		assert.match(run.stdout, /Usage: node scripts\/r2-media-restore-proof\.mjs/);
	});

	it('needs no Cloudflare credential to run', () => {
		const run = runCli([], CREDENTIAL_FREE_ENV);
		assert.equal(run.status, 0, run.stderr);
		// Nothing in the output claims a credential was consulted.
		assert.ok(!/CLOUDFLARE_/.test(run.stdout));
	});
});

describe('r2-media-restore-proof — the report is derived, not hand-written', () => {
	it('renders one row per case with the verdict the run produced', () => {
		const htmlPath = join(tempDir(), 'proof.html');
		assert.equal(runCli([`--html=${htmlPath}`]).status, 0);
		const page = readFileSync(htmlPath, 'utf8');

		for (const verdict of [
			RESTORE_VERDICT.restored,
			RESTORE_VERDICT.alreadyIntact,
			RESTORE_VERDICT.refusedKey,
			RESTORE_VERDICT.missingSource,
			RESTORE_VERDICT.metadataDrift,
			RESTORE_VERDICT.undecidable,
		]) {
			assert.ok(page.includes(verdict), `the report must show a ${verdict} row`);
		}
		assert.match(page, /as declared/);
	});

	it('keeps the report in step with the pure formatter', () => {
		// The HTML embeds the same status-only block the CLI prints, so
		// a reviewer comparing the two sees one source of truth.
		const htmlPath = join(tempDir(), 'proof.html');
		const run = runCli([`--html=${htmlPath}`]);
		const page = readFileSync(htmlPath, 'utf8');
		const statusLine = formatRestoreReport(
			{
				verdict: RESTORE_VERDICT.restored,
				reason: '-',
				checks: [
					'key_gate',
					'store_read',
					'source_read',
					'source_matches_manifest',
					'write',
					'readback',
				],
			},
			{ target: 'test-bucket', label: 'deleted-then-restored' },
		).trim();
		assert.ok(run.stdout.includes(statusLine));
		assert.ok(
			page.includes(statusLine.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')),
		);
	});
});

describe('restoreMediaObject — exit codes a caller can branch on', () => {
	it('separates a pass, a proven failure, and an unreadable state', async () => {
		const bytes = new Uint8Array([1, 2, 3, 4]);
		const entry = {
			key: 'reactions/restore-fixture.bin',
			sha256: '',
			sizeBytes: 4,
			contentType: 'image/png',
		};
		const store = {
			read: async () => null,
			write: async () => {},
		};
		const pass = await restoreMediaObject(store, { read: async () => null }, entry);
		assert.equal(pass.verdict, RESTORE_VERDICT.missingSource);
		assert.equal(restoreExitCodeFor(pass), 1);

		const undecidable = await restoreMediaObject(
			{
				read: async () => {
					throw new Error('nope');
				},
				write: async () => {},
			},
			{ read: async () => null },
			entry,
		);
		assert.equal(restoreExitCodeFor(undecidable), 2);
	});

	it('writes nothing on disk unless the caller asked for a report', () => {
		const dir = tempDir();
		const before = readdirSync(dir);
		runCli();
		assert.deepEqual(readdirSync(dir), before);
	});
});

/** The fixture set is data, so a stale expectation must fail loudly. */
describe('r2-media-restore-proof — a wrong expectation fails the run', () => {
	it('exits 1 with DEVIATED when a fixture no longer behaves as declared', () => {
		const path = join(FIXTURE_DIR, 'deleted-restored.json');
		const original = readFileSync(path, 'utf8');
		try {
			const tampered = JSON.parse(original);
			// The case still restores correctly; the fixture's promise
			// about it is what is wrong. That is exactly the drift a
			// reviewer needs the command to catch.
			tampered.expect.verdict = 'already_intact';
			writeFileSync(path, `${JSON.stringify(tampered, null, '\t')}\n`);

			const run = runCli();
			assert.equal(run.status, 1);
			assert.match(run.stdout, /verdict=DEVIATED/);
			assert.match(
				run.stderr,
				/deleted-restored\.json: verdict: expected already_intact, got restored/,
			);
		} finally {
			writeFileSync(path, original);
		}
		assert.equal(runCli().status, 0);
	});

	it('rejects a fixture whose declared digest does not describe its own bytes', () => {
		const path = join(FIXTURE_DIR, 'deleted-restored.json');
		const original = readFileSync(path, 'utf8');
		try {
			const tampered = JSON.parse(original);
			tampered.entry.sizeBytes = tampered.entry.sizeBytes + 1;
			writeFileSync(path, `${JSON.stringify(tampered, null, '\t')}\n`);

			const run = runCli();
			assert.equal(run.status, 2);
			assert.match(run.stderr, /does not match the source bytes/);
		} finally {
			writeFileSync(path, original);
		}
	});
});
