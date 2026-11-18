#!/usr/bin/env node
/**
 * Resolve the base ref the scheduled sync workflows open their
 * review pull requests against (Issues #719 / #621).
 *
 * Why this exists: the workflows used to read
 * `vars.KEYBOARD_SYNC_BASE_REF` / `vars.PROJECTS_SYNC_BASE_REF`,
 * which had to be re-pointed by hand at every release transition —
 * and both rotted (one unset, one pointing at a deleted
 * `release-0-8-0`), so the schedulers failed every day until
 * someone noticed. The durable answer is to derive the base from
 * the repository itself: the active release branch is the highest
 * `release-<semver>` head on the remote.
 *
 * Resolution order:
 *   1. `SYNC_BASE_REF` env (or the caller's `--base` flag) — explicit
 *      override for transitions where two release branches coexist.
 *   2. The highest semver `release-x-y-z` branch on `origin`.
 *   3. Fail closed with a status-only error when no release branch
 *      exists — guessing `main` would open sync PRs against the
 *      released state, which is never the right base.
 *
 * Exit codes: 0 = ref printed on stdout, 1 = no release base found,
 * 2 = bad input / git failure.
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE_BRANCH = /^release-(\d+)-(\d+)-(\d+)$/;

/**
 * Parse `release-x-y-z` heads into comparable semver triples.
 * Returns [{ ref, major, minor, patch }] sorted descending.
 */
export function parseReleaseBranches(lines) {
	const out = [];
	for (const line of lines) {
		// `git ls-remote` emits "<sha>\t<ref>"; accept a bare ref too.
		const ref = line
			.trim()
			.split(/\s+/)
			.pop()
			.replace(/^refs\/heads\//, '');
		const m = RELEASE_BRANCH.exec(ref);
		if (!m) continue;
		out.push({ ref, major: +m[1], minor: +m[2], patch: +m[3] });
	}
	out.sort((a, b) => b.major - a.major || b.minor - a.minor || b.patch - a.patch);
	return out;
}

/** Highest semver release branch, or null. */
export function pickReleaseBase(lines) {
	const branches = parseReleaseBranches(lines);
	return branches.length > 0 ? branches[0].ref : null;
}

function listRemoteReleaseBranches(remote = 'origin') {
	const stdout = execFileSync('git', ['ls-remote', '--heads', remote, 'release-*'], {
		encoding: 'utf8',
	});
	return stdout.split('\n').filter(Boolean);
}

function main(argv) {
	const overrideIdx = argv.indexOf('--base');
	const override = overrideIdx >= 0 ? argv[overrideIdx + 1] : (process.env.SYNC_BASE_REF ?? '');
	if (override) {
		console.log(override);
		return;
	}
	let lines;
	try {
		lines = listRemoteReleaseBranches();
	} catch (error) {
		console.error(`[resolve-release-base] git ls-remote failed: ${error.message}`);
		process.exit(2);
	}
	const base = pickReleaseBase(lines);
	if (!base) {
		console.error(
			'[resolve-release-base] no release-x-y-z branch found on origin; ' +
				'set SYNC_BASE_REF (or the workflow var) to name the base explicitly.',
		);
		process.exit(1);
	}
	console.log(base);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main(process.argv.slice(2));
