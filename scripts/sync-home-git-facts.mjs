#!/usr/bin/env node

/**
 * sync-home-git-facts — produce `src/home/current/git-facts.json`, the
 * offline git snapshot the "現在地 / Where I am now" section reads
 * (Issue #316).
 *
 * Why a snapshot and not a request-time `git log`
 * -----------------------------------------------
 *   - The Worker has no repository. A page render cannot run git, and it
 *     must not gain an outbound request to learn a commit count.
 *   - A value that changes without a commit cannot be reviewed. The
 *     snapshot is committed, so "the start date moved" is a diff a reviewer
 *     sees.
 *   - `pnpm run validate:fast` is offline and runs on a depth-1 clone, so it
 *     cannot re-derive these numbers. It checks the SNAPSHOT (shape, dates
 *     not in the future, freshness); re-deriving is this script's `--check`
 *     mode, which needs the history and therefore runs where the history is
 *     (a developer machine, this command, on demand).
 *
 * What the snapshot claims, and what it cannot
 * --------------------------------------------
 * Every value here is reproducible from the named commit, which is why the
 * section tags these facts `git`. The snapshot says nothing about whether
 * the owner is still working: that is what `startedOn` + `updatedOn` tell a
 * reader, and the section prints them as they are.
 *
 * Output is status-only: file path, counts, verdict. No secret is read, no
 * binding is touched, nothing is printed but numbers about this repository.
 *
 * Usage:
 *   node scripts/sync-home-git-facts.mjs            # write the snapshot
 *   node scripts/sync-home-git-facts.mjs --check    # fail if it is stale
 *   node scripts/sync-home-git-facts.mjs --help
 *
 * Exit codes: 0 = written / up to date, 1 = stale (with `--check`),
 * 2 = bad input or no git history.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The snapshot this script owns. */
export const SNAPSHOT_PATH = 'src/home/current/git-facts.json';

/**
 * The counting window, in days. Kept in step with
 * `RECENT_UPDATE_WINDOW_DAYS` in `src/home/current/source.ts`; the section
 * prints the window stored in the snapshot, and
 * `src/home/current/git-facts.test.ts` fails if the two disagree.
 */
export const WINDOW_DAYS = 30;

/**
 * The projects the snapshot covers.
 *
 * Only a project whose history IS this repository belongs here. An external
 * project's dates are the owner's to write (`roster.ts`), not git's to
 * guess.
 */
export const TRACKED_PROJECTS = [
	/** The only project whose history is this repository. */
	{ id: 'my-web-2026' },
];

/** Run git and return trimmed stdout. Throws on a non-zero exit. */
function git(args, cwd = REPO_ROOT) {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** `YYYY-MM-DD` for a UTC instant. */
function utcDate(date) {
	return date.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` shifted by a whole number of days (UTC). */
export function shiftDate(dateString, days) {
	const date = new Date(`${dateString}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return utcDate(date);
}

/**
 * Build the snapshot from the repository at `cwd`.
 *
 * Pure with respect to the clock: `today` is passed in, so the output is a
 * function of (history, today) and a test can reproduce it.
 */
export function buildSnapshot({ cwd = REPO_ROOT, today = utcDate(new Date()) } = {}) {
	const headSha = git(['rev-parse', 'HEAD'], cwd);
	const commitsTotal = Number(git(['rev-list', '--count', 'HEAD'], cwd));
	const since = `${shiftDate(today, -WINDOW_DAYS)}T00:00:00Z`;

	/**
	 * The oldest root commit — the project's first commit.
	 *
	 * No pathspec: history simplification would omit merges and commits
	 * that are tree-identical to a parent, so the count would stop being
	 * "the commits of this repository".
	 */
	const firstCommitOf = () => {
		const roots = git(['rev-list', '--max-parents=0', 'HEAD'], cwd).split('\n').filter(Boolean);
		if (roots.length === 0) throw new Error('the repository has no root commit');
		// More than one root is possible after a history rewrite; the
		// earliest date wins, because that is when the project began.
		let earliest = null;
		for (const sha of roots) {
			const date = git(['show', '-s', '--format=%ad', '--date=short', sha], cwd);
			if (!earliest || date < earliest.date) earliest = { sha, date };
		}
		return earliest;
	};

	const projects = {};
	for (const project of TRACKED_PROJECTS) {
		const first = firstCommitOf();
		const lastSha = git(['rev-list', '-1', 'HEAD'], cwd);
		const last = {
			sha: lastSha,
			date: git(['show', '-s', '--format=%ad', '--date=short', lastSha], cwd),
		};
		const total = Number(git(['rev-list', '--count', 'HEAD'], cwd));
		const recent = Number(git(['rev-list', '--count', `--since=${since}`, 'HEAD'], cwd));
		projects[project.id] = {
			firstCommit: first,
			lastCommit: last,
			commits: { recent, total },
		};
	}

	return {
		schemaVersion: 1,
		generatedOn: today,
		headSha,
		commitsTotal,
		windowDays: WINDOW_DAYS,
		projects,
	};
}

/** The snapshot file, formatted the way the repository formats JSON. */
export function formatSnapshot(snapshot) {
	return `${JSON.stringify(snapshot, null, '\t')}\n`;
}

function main(argv) {
	if (argv.includes('--help')) {
		process.stdout.write(
			`usage: node scripts/sync-home-git-facts.mjs [--check]\n\nwrites ${SNAPSHOT_PATH} from this repository's history.\n--check  fail (exit 1) when the committed snapshot differs from a fresh one\n`,
		);
		return 0;
	}
	const checkOnly = argv.includes('--check');
	const unknown = argv.filter((arg) => arg !== '--check');
	if (unknown.length > 0) {
		process.stderr.write(`unknown option: ${unknown.join(' ')}\n`);
		return 2;
	}

	const snapshot = buildSnapshot();
	const next = formatSnapshot(snapshot);
	const target = join(REPO_ROOT, SNAPSHOT_PATH);

	if (checkOnly) {
		let current = '';
		try {
			current = readFileSync(target, 'utf8');
		} catch {
			current = '';
		}
		if (current !== next) {
			process.stderr.write(
				`stale: ${SNAPSHOT_PATH} does not match this repository's history.\nrun: pnpm run current:facts:sync\n`,
			);
			return 1;
		}
		process.stdout.write(
			`ok: ${SNAPSHOT_PATH} is current (head ${snapshot.headSha.slice(0, 8)}, ` +
				`${snapshot.commitsTotal} commits)\n`,
		);
		return 0;
	}

	writeFileSync(target, next);
	process.stdout.write(
		`wrote ${SNAPSHOT_PATH} (head ${snapshot.headSha.slice(0, 8)}, ` +
			`${snapshot.commitsTotal} commits, generatedOn ${snapshot.generatedOn})\n`,
	);
	return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`sync failed: ${error.message}\n`);
		process.exitCode = 2;
	}
}
