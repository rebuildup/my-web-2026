/**
 * Tests for the project-introduction publish path (Issue #739).
 *
 * These tests use **real git repositories in a temporary directory**, so
 * the lease behaviour is exercised rather than asserted. The bug this
 * module fixes is reproduced here on purpose: the plain
 * `--force-with-lease` form is shown to fail once the remote branch
 * exists and no remote-tracking ref was ever fetched, and the explicit
 * lease is shown to succeed in the same state.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
	buildPushArgv,
	leaseArgument,
	parseRemoteSha,
	publishBranch,
	resolveRemoteSha,
} from './_projects-sync-push.mjs';

const roots = [];

function git(args, options = {}) {
	const cwd = typeof options === 'string' ? options : (options.cwd ?? process.cwd());
	const result = spawnSync('git', args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * Build a throwaway remote with one commit and a `sync` branch.
 *
 * @param {{withRemoteBranch: boolean}} options
 */
function makeFixture({ withRemoteBranch }) {
	const root = mkdtempSync(join(tmpdir(), 'projects-sync-'));
	roots.push(root);
	const remote = join(root, 'remote.git');
	const work = join(root, 'work');
	git(['init', '-q', '--bare', remote], root);
	git(['init', '-q', work], root);
	git(['config', 'user.email', 'tester@example.invalid'], work);
	git(['config', 'user.name', 'tester'], work);
	git(['checkout', '-q', '-b', 'sync'], work);
	writeFileSync(join(work, 'snapshot.json'), '{"version":1}\n');
	git(['add', 'snapshot.json'], work);
	git(['commit', '-qm', 'initial'], work);
	git(['remote', 'add', 'origin', remote], work);
	if (withRemoteBranch) {
		git(['push', '-q', 'origin', 'sync:refs/heads/sync'], work);
	}
	return { root, remote, work };
}

after(() => {
	for (const root of roots) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe('the lease argument', () => {
	it('names the destination ref explicitly', () => {
		assert.equal(
			leaseArgument('projects-introduction-sync', 'a'.repeat(40)),
			`--force-with-lease=refs/heads/projects-introduction-sync:${'a'.repeat(40)}`,
		);
	});

	it('uses the empty form when the remote branch must not exist yet', () => {
		assert.equal(
			leaseArgument('projects-introduction-sync', null),
			'--force-with-lease=refs/heads/projects-introduction-sync:',
		);
	});
});

describe('the remote state reader', () => {
	it('returns null when the branch is absent', () => {
		const fixture = makeFixture({ withRemoteBranch: false });
		const sha = resolveRemoteSha({
			remote: fixture.remote,
			branch: 'sync',
			cwd: fixture.work,
			run: git,
		});
		assert.equal(sha, null);
	});

	it('returns the sha when the branch exists', () => {
		const fixture = makeFixture({ withRemoteBranch: true });
		const sha = resolveRemoteSha({
			remote: fixture.remote,
			branch: 'sync',
			cwd: fixture.work,
			run: git,
		});
		assert.match(String(sha), /^[0-9a-f]{40}$/);
	});

	it('fails closed when the remote cannot be read', () => {
		const fixture = makeFixture({ withRemoteBranch: false });
		assert.throws(
			() =>
				resolveRemoteSha({
					remote: join(fixture.root, 'does-not-exist.git'),
					branch: 'sync',
					cwd: fixture.work,
					run: git,
				}),
			/could not read the remote state/,
		);
	});
});

describe('ls-remote output parsing', () => {
	it('reads the sha out of a matching line', () => {
		const sha = 'b'.repeat(40);
		assert.equal(parseRemoteSha(`${sha}\trefs/heads/sync\n`), sha);
	});

	it('returns null for empty output', () => {
		assert.equal(parseRemoteSha(''), null);
		assert.equal(parseRemoteSha('\n'), null);
	});

	it('returns null for a malformed sha', () => {
		assert.equal(parseRemoteSha('not-a-sha\trefs/heads/sync\n'), null);
	});
});

describe('the push that the workflow used to run', () => {
	it('is rejected once the remote branch exists and no tracking ref was fetched', () => {
		// This is the reproduction of the daily failure: the workflow
		// fetched only the release base, so the destination branch had
		// no remote-tracking ref and the lease expected a branch that
		// does not exist.
		const fixture = makeFixture({ withRemoteBranch: true });
		git(['fetch', '-q', 'origin', '+refs/heads/sync:refs/remotes/origin/sync'], fixture.work);
		git(['update-ref', '-d', 'refs/remotes/origin/sync'], fixture.work);
		writeFileSync(join(fixture.work, 'snapshot.json'), '{"version":2}\n');
		git(['commit', '-qam', 'refresh'], fixture.work);

		const result = git(
			['push', '--force-with-lease', 'origin', 'sync:refs/heads/sync'],
			fixture.work,
		);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /stale info/);
	});
});

describe('the push this module builds', () => {
	it('creates the remote branch when it does not exist yet', () => {
		const fixture = makeFixture({ withRemoteBranch: false });
		const outcome = publishBranch({
			remote: fixture.remote,
			branch: 'sync',
			cwd: fixture.work,
			run: git,
		});
		assert.equal(outcome.published, true);
		assert.equal(outcome.expectedSha, null);
		const sha = resolveRemoteSha({
			remote: fixture.remote,
			branch: 'sync',
			cwd: fixture.work,
			run: git,
		});
		assert.match(String(sha), /^[0-9a-f]{40}$/);
	});

	it('updates the remote branch when it exists', () => {
		const fixture = makeFixture({ withRemoteBranch: true });
		writeFileSync(join(fixture.work, 'snapshot.json'), '{"version":2}\n');
		git(['commit', '-qam', 'refresh'], fixture.work);

		const outcome = publishBranch({
			remote: fixture.remote,
			branch: 'sync',
			cwd: fixture.work,
			run: git,
		});
		assert.equal(outcome.published, true);
		assert.match(String(outcome.expectedSha), /^[0-9a-f]{40}$/);
	});

	it('is rejected when the remote moved after the expectation was read', () => {
		const fixture = makeFixture({ withRemoteBranch: true });
		writeFileSync(join(fixture.work, 'snapshot.json'), '{"version":2}\n');
		git(['commit', '-qam', 'refresh'], fixture.work);

		// A stale expectation must not overwrite somebody else's push.
		const stale = 'c'.repeat(40);
		const argv = buildPushArgv({
			remote: fixture.remote,
			branch: 'sync',
			expectedSha: stale,
		});
		const result = git(argv, fixture.work);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /stale info/);
	});

	it('does not push at all in dry-run mode', () => {
		const fixture = makeFixture({ withRemoteBranch: false });
		const outcome = publishBranch({
			remote: fixture.remote,
			branch: 'sync',
			cwd: fixture.work,
			run: git,
			dryRun: true,
		});
		assert.equal(outcome.published, false);
		assert.equal(outcome.expectedSha, null);
		const sha = resolveRemoteSha({
			remote: fixture.remote,
			branch: 'sync',
			cwd: fixture.work,
			run: git,
		});
		assert.equal(sha, null);
	});
});
