/**
 * Publish the refreshed project-introduction snapshot safely
 * (Issue #739).
 *
 * The problem this module exists for
 * ---------------------------------
 * `.github/workflows/projects-sync.yml` used to publish the refreshed
 * snapshot with the plain `--force-with-lease` form. That form takes
 * its expectation from the **remote-tracking ref** of the destination
 * branch. The workflow only ever fetched the release base, so
 * `refs/remotes/origin/projects-introduction-sync` did not exist, and
 * git therefore expected the remote branch to be **absent**. The first
 * run created the branch and succeeded; every later run was rejected
 * with `stale info` — so the daily snapshot refresh failed every day
 * and the published snapshot silently went stale.
 *
 * The fix
 * -------
 * The expectation is resolved from the **remote's current state** at
 * push time (`git ls-remote`), not from a local ref that may never
 * have been fetched:
 *
 * - the remote branch exists → the lease names its current sha, so the
 *   push is allowed only if nobody else pushed in the meantime;
 * - the remote branch does not exist → the lease is the empty form
 *   (`refs/heads/<branch>:`), which git reads as "this ref must not
 *   exist yet", so the first push creates it and a concurrent creation
 *   is still rejected.
 *
 * The lease argument is therefore always **explicit**, and the module
 * never depends on a remote-tracking ref being present.
 *
 * Safety boundary
 * ---------------
 * This module talks to exactly one git remote, and it is the remote it
 * is given. It reads no credential, opens no socket other than git's
 * own transport, touches no Cloudflare binding and touches no
 * production surface. It prints **status-only** output: the resolved
 * expectation and the git exit status — never a token, never a
 * credential.
 */

import { spawnSync } from 'node:child_process';

/** The refname a lease argument names, for a given branch. */
export function leaseRefname(branch) {
	return `refs/heads/${branch}`;
}

/**
 * Parse `git ls-remote <remote> refs/heads/<branch>` output.
 *
 * @param {string} stdout raw ls-remote output
 * @returns {string | null} the sha, or `null` when the branch is absent
 */
export function parseRemoteSha(stdout) {
	const line = String(stdout ?? '')
		.split('\n')
		.map((entry) => entry.trim())
		.find((entry) => entry.length > 0);
	if (!line) return null;
	const [sha] = line.split(/\s+/);
	return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/**
 * Build the lease argument for an explicit expectation.
 *
 * @param {string} branch destination branch
 * @param {string | null} expectedSha the sha the remote must be at, or
 *   `null` when the remote branch must not exist yet
 * @returns {string} the `--force-with-lease=` argument
 */
export function leaseArgument(branch, expectedSha) {
	const ref = leaseRefname(branch);
	return `--force-with-lease=${ref}:${expectedSha ?? ''}`;
}

/**
 * Build the full argv for the publish push.
 *
 * @param {{remote: string, branch: string, expectedSha: string | null}} input
 * @returns {string[]}
 */
export function buildPushArgv({ remote, branch, expectedSha }) {
	return [
		'push',
		leaseArgument(branch, expectedSha),
		'--quiet',
		remote,
		`${branch}:${leaseRefname(branch)}`,
	];
}

/**
 * Resolve the remote's current sha for a branch.
 *
 * @param {{remote: string, branch: string, cwd?: string, run?: Function}} input
 * @returns {string | null} the sha, or `null` when the branch is absent
 */
export function resolveRemoteSha({ remote, branch, cwd = process.cwd(), run = git }) {
	const result = run(['ls-remote', remote, leaseRefname(branch)], { cwd });
	if (result.status !== 0) {
		throw new Error(
			`could not read the remote state of ${leaseRefname(branch)} (git ls-remote exited ${result.status})`,
		);
	}
	return parseRemoteSha(result.stdout);
}

/**
 * The default git runner. Returns a status-only result record.
 *
 * @param {string[]} args
 * @param {{cwd?: string}} options
 */
export function git(args, { cwd = process.cwd() } = {}) {
	const result = spawnSync('git', args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	return {
		status: result.status ?? 1,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	};
}

/**
 * Publish the current branch with an explicit lease.
 *
 * @param {{remote: string, branch: string, cwd?: string, run?: Function, dryRun?: boolean}} input
 * @returns {{published: boolean, expectedSha: string | null, status: number}}
 */
export function publishBranch({ remote, branch, cwd = process.cwd(), run = git, dryRun = false }) {
	const expectedSha = resolveRemoteSha({ remote, branch, cwd, run });
	const argv = buildPushArgv({ remote, branch, expectedSha });
	if (dryRun) {
		return { published: false, expectedSha, status: 0, argv };
	}
	const result = run(argv, { cwd });
	return {
		published: result.status === 0,
		expectedSha,
		status: result.status,
		stderr: result.stderr,
	};
}

/**
 * CLI entry point: `node scripts/_projects-sync-push.mjs push
 * --remote origin --branch <branch> [--dry-run]`.
 *
 * The output is status-only: what was expected, and whether the push
 * succeeded.
 */
export function main(argv) {
	const args = argv.slice(2);
	if (args[0] !== 'push') {
		process.stderr.write(
			'usage: node scripts/_projects-sync-push.mjs push --remote <remote> --branch <branch> [--dry-run]\n',
		);
		return 2;
	}
	const read = (flag) => {
		const at = args.indexOf(flag);
		return at === -1 ? '' : (args[at + 1] ?? '');
	};
	const remote = read('--remote');
	const branch = read('--branch');
	const dryRun = args.includes('--dry-run');
	if (!remote || !branch) {
		process.stderr.write('both --remote and --branch are required\n');
		return 2;
	}
	let outcome;
	try {
		outcome = publishBranch({ remote, branch, dryRun });
	} catch (error) {
		process.stderr.write(
			`publish failed: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		return 1;
	}
	if (dryRun) {
		process.stdout.write(`would push ${branch} with lease ${outcome.expectedSha ?? '<absent>'}\n`);
		return 0;
	}
	if (!outcome.published) {
		process.stderr.write(
			`publish rejected: the remote moved under us (expected ${outcome.expectedSha ?? '<absent>'}). The snapshot was NOT published; the committed snapshot is unchanged and stays stale until the next successful run.\n`,
		);
		return 1;
	}
	process.stdout.write(`published ${branch} (lease ${outcome.expectedSha ?? '<absent>'})\n`);
	return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exit(main(process.argv));
}
