import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = resolve(HERE, 'check-release-version.mjs');

// Synthetic versions only. The checker under test forbids release
// literals in active surfaces, so every fixture version uses a major
// far away from any real release line and every assertion builds the
// expected strings dynamically.
const GOOD = '9.9.9';
const BAD = '9.9.8';
const goodBranch = 'release-9-9-9';

function writeFixture(dir, version) {
	mkdirSync(resolve(dir, 'src/home'), { recursive: true });
	mkdirSync(resolve(dir, 'src/http'), { recursive: true });
	mkdirSync(resolve(dir, 'test'), { recursive: true });
	mkdirSync(resolve(dir, 'e2e'), { recursive: true });
	mkdirSync(resolve(dir, 'scripts'), { recursive: true });
	writeFileSync(
		resolve(dir, 'package.json'),
		`${JSON.stringify({ name: 'version-check-fixture', version })}\n`,
	);
	writeFileSync(resolve(dir, 'README.md'), 'fixture readme, no version literal\n');
	writeFileSync(resolve(dir, '.dev.vars.example'), 'FIXTURE_EXAMPLE=1\n');
	writeFileSync(
		resolve(dir, 'src/home/version.ts'),
		"export { version } from '../../package.json';\n",
	);
	writeFileSync(resolve(dir, 'src/http/hono.ts'), 'export const app = {};\n');
}

function runChecker(dir, env) {
	return spawnSync(process.execPath, [CHECKER], {
		cwd: dir,
		encoding: 'utf8',
		env: {
			// Hermetic: drop any ambient CI refs, then apply the case.
			PATH: process.env.PATH ?? '',
			...env,
		},
	});
}

function scratchDir(t, version) {
	const dir = mkdtempSync(resolve(tmpdir(), 'check-release-version-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	writeFixture(dir, version);
	return dir;
}

describe('check-release-version.mjs pull_request base-ref enforcement (Issue #260)', () => {
	it('fails when the PR base is a release branch and the version mismatches', (t) => {
		const dir = scratchDir(t, BAD);
		const result = runChecker(dir, {
			GITHUB_HEAD_REF: '260',
			GITHUB_REF_NAME: '123/merge',
			GITHUB_BASE_REF: goodBranch,
		});
		assert.notEqual(result.status, 0);
		assert.match(
			result.stderr,
			new RegExp(
				`pull request base ${goodBranch} requires package\\.json version ${GOOD}, got ${BAD}`,
			),
		);
	});

	it('passes when the PR base is a release branch and the version matches', (t) => {
		const dir = scratchDir(t, GOOD);
		const result = runChecker(dir, {
			GITHUB_HEAD_REF: '260',
			GITHUB_REF_NAME: '123/merge',
			GITHUB_BASE_REF: goodBranch,
		});
		assert.equal(result.status, 0);
		assert.match(result.stdout, new RegExp(`release version source OK: ${GOOD}`));
	});

	it('keeps release-branch push semantics unchanged via GITHUB_HEAD_REF', (t) => {
		const mismatch = runChecker(scratchDir(t, BAD), {
			GITHUB_HEAD_REF: goodBranch,
		});
		assert.notEqual(mismatch.status, 0);
		assert.match(
			mismatch.stderr,
			new RegExp(
				`release branch ${goodBranch} requires package\\.json version ${GOOD}, got ${BAD}`,
			),
		);

		const match = runChecker(scratchDir(t, GOOD), {
			GITHUB_HEAD_REF: goodBranch,
		});
		assert.equal(match.status, 0);
		assert.match(match.stdout, new RegExp(`release version source OK: ${GOOD}`));
	});

	it('keeps release-branch push semantics unchanged via GITHUB_REF_NAME', (t) => {
		const mismatch = runChecker(scratchDir(t, BAD), {
			GITHUB_REF_NAME: goodBranch,
		});
		assert.notEqual(mismatch.status, 0);
		assert.match(
			mismatch.stderr,
			new RegExp(
				`release branch ${goodBranch} requires package\\.json version ${GOOD}, got ${BAD}`,
			),
		);
	});

	it('prefers the head ref when both head and base name a release', (t) => {
		// Head says GOOD and matches; base names a different release.
		// The head enforcement wins, so the run passes.
		const dir = scratchDir(t, GOOD);
		const result = runChecker(dir, {
			GITHUB_HEAD_REF: goodBranch,
			GITHUB_BASE_REF: 'release-9-9-8',
		});
		assert.equal(result.status, 0);
		assert.match(result.stdout, new RegExp(`release version source OK: ${GOOD}`));
	});

	describe('intentionally unenforced event shapes (explicit stdout note, never silent)', () => {
		it('notes the skip when no ref names a release (plain push to a ticket branch)', (t) => {
			const dir = scratchDir(t, GOOD);
			const result = runChecker(dir, {
				GITHUB_HEAD_REF: '260',
				GITHUB_REF_NAME: '260',
			});
			assert.equal(result.status, 0);
			assert.match(result.stdout, /version:check note: no release-x-y-z ref/);
			assert.match(result.stdout, new RegExp(`release version source OK: ${GOOD}`));
		});

		it('notes the skip for a stacked PR whose base is a ticket branch', (t) => {
			const dir = scratchDir(t, GOOD);
			const result = runChecker(dir, {
				GITHUB_HEAD_REF: '261',
				GITHUB_REF_NAME: '124/merge',
				GITHUB_BASE_REF: '260',
			});
			assert.equal(result.status, 0);
			assert.match(result.stdout, /version:check note: no release-x-y-z ref/);
		});

		it('notes the skip for a PR targeting main', (t) => {
			// A main-targeted PR has a non-release base, so the base
			// fallback yields no release name and the run must say so
			// instead of passing silently.
			const dir = scratchDir(t, GOOD);
			const result = runChecker(dir, {
				GITHUB_HEAD_REF: '262',
				GITHUB_REF_NAME: '126/merge',
				GITHUB_BASE_REF: 'main',
			});
			assert.equal(result.status, 0);
			assert.match(result.stdout, /version:check note: no release-x-y-z ref/);
		});

		it('notes the skip when no CI refs are set at all (local run)', (t) => {
			const dir = scratchDir(t, GOOD);
			const result = runChecker(dir, {});
			assert.equal(result.status, 0);
			assert.match(result.stdout, /version:check note: no release-x-y-z ref/);
		});
	});
});
