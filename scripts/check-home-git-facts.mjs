#!/usr/bin/env node
/**
 * Offline validation of the committed home git-facts snapshot (Issue #316).
 *
 * `scripts/sync-home-git-facts.mjs` writes `src/home/current/git-facts.json`
 * from this repository's history. This is the cheap, offline half: it never
 * runs git, so it works on the depth-1 clone `validate:fast` runs on.
 *
 * What it proves — from the file alone:
 *
 *   - the snapshot parses and its shape is the version-1 shape, with no
 *     unknown top-level key (a schema change has to be visible);
 *   - every commit id is a full 40-character SHA, and the project set is a
 *     subset of the allowlist (this repository only — an external project's
 *     dates are the owner's to write, not git's to guess);
 *   - every date is a real `YYYY-MM-DD` calendar day, `firstCommit` is not
 *     after `lastCommit`, and no commit is dated after `generatedOn`;
 *   - `commits.recent <= commits.total === commitsTotal`, and `windowDays`
 *     is the window the section prints;
 *   - the recorded `headSha` is the last commit the snapshot names, so the
 *     file cannot claim two different heads.
 *
 * Freshness is reported, never gated. A stale snapshot is an uncomfortable
 * fact, not a broken file: the section prints the day it was measured
 * (`（YYYY-MM-DD 時点）`), so an old number is labelled, and a red build
 * cannot make a repository history younger.
 *
 * Exit codes: 0 = valid, 1 = invalid, 2 = bad input.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The snapshot this gate owns. */
export const SNAPSHOT_PATH = 'src/home/current/git-facts.json';

/**
 * The window the section prints. Kept in step with
 * `RECENT_UPDATE_WINDOW_DAYS` in `src/home/current/source.ts`; the vitest
 * suite `src/home/current/git-facts.test.ts` fails if the two disagree, so
 * this is a duplicated literal with a witness rather than a hidden truth.
 */
export const WINDOW_DAYS = 30;

/** The projects the snapshot may cover. */
export const TRACKED_PROJECT_IDS = ['my-web-2026'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const TOP_LEVEL_KEYS = [
	'schemaVersion',
	'generatedOn',
	'headSha',
	'commitsTotal',
	'windowDays',
	'projects',
];
const PROJECT_KEYS = ['firstCommit', 'lastCommit', 'commits'];
const COMMIT_KEYS = ['sha', 'date'];
const COUNT_KEYS = ['recent', 'total'];

/** Whether `value` is a real calendar day in `YYYY-MM-DD` form. */
export function isIsoDate(value) {
	if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) return false;
	return date.toISOString().slice(0, 10) === value;
}

/** Whole days from `from` to `to`; `NaN` when either is not a real day. */
export function daysBetween(from, to) {
	if (!isIsoDate(from) || !isIsoDate(to)) return Number.NaN;
	return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function hasExactKeys(object, keys) {
	const actual = Object.keys(object).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/**
 * Validate one snapshot. Pure: `today` is passed in, so a test can pin it.
 *
 * Returns `{ errors, warnings, summary }` — status-only strings, never a
 * document value that is not already public in the file.
 */
export function validateSnapshot(snapshot, { today, maxAgeDays = WINDOW_DAYS } = {}) {
	const errors = [];
	const warnings = [];

	if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
		return { errors: ['snapshot is not a JSON object'], warnings, summary: null };
	}
	if (!hasExactKeys(snapshot, TOP_LEVEL_KEYS)) {
		errors.push(`top-level keys are not exactly ${TOP_LEVEL_KEYS.join(', ')}`);
	}

	if (snapshot.schemaVersion !== 1)
		errors.push(`schemaVersion is not 1 (${snapshot.schemaVersion})`);
	if (!FULL_SHA.test(String(snapshot.headSha ?? '')))
		errors.push('headSha is not a full 40-character SHA');
	if (!isIsoDate(snapshot.generatedOn)) {
		errors.push('generatedOn is not a real YYYY-MM-DD day');
	} else if (isIsoDate(today) && daysBetween(snapshot.generatedOn, today) < 0) {
		errors.push('generatedOn is in the future');
	}
	if (!Number.isInteger(snapshot.commitsTotal) || snapshot.commitsTotal <= 0) {
		errors.push('commitsTotal is not a positive integer');
	}
	if (snapshot.windowDays !== WINDOW_DAYS) {
		errors.push(`windowDays is not the published window (${WINDOW_DAYS})`);
	}

	const projects = snapshot.projects;
	if (projects === null || typeof projects !== 'object' || Array.isArray(projects)) {
		errors.push('projects is not an object');
		return { errors, warnings, summary: null };
	}
	const ids = Object.keys(projects).sort();
	if (ids.length === 0) errors.push('projects is empty');
	for (const id of ids) {
		if (!TRACKED_PROJECT_IDS.includes(id)) {
			errors.push(`project "${id}" is not in the tracked allowlist`);
		}
	}

	for (const [id, project] of Object.entries(projects)) {
		const where = `project "${id}"`;
		if (project === null || typeof project !== 'object' || Array.isArray(project)) {
			errors.push(`${where} is not an object`);
			continue;
		}
		if (!hasExactKeys(project, PROJECT_KEYS)) {
			errors.push(`${where} keys are not exactly ${PROJECT_KEYS.join(', ')}`);
		}
		for (const [name, commit] of [
			['firstCommit', project.firstCommit],
			['lastCommit', project.lastCommit],
		]) {
			if (commit === null || typeof commit !== 'object') {
				errors.push(`${where} ${name} is not an object`);
				continue;
			}
			if (!hasExactKeys(commit, COMMIT_KEYS)) {
				errors.push(`${where} ${name} keys are not exactly ${COMMIT_KEYS.join(', ')}`);
			}
			if (!FULL_SHA.test(String(commit.sha ?? ''))) {
				errors.push(`${where} ${name}.sha is not a full 40-character SHA`);
			}
			if (!isIsoDate(commit.date)) errors.push(`${where} ${name}.date is not a real day`);
		}

		const first = project.firstCommit?.date;
		const last = project.lastCommit?.date;
		if (isIsoDate(first) && isIsoDate(last) && daysBetween(first, last) < 0) {
			errors.push(`${where} firstCommit is after lastCommit`);
		}
		if (
			isIsoDate(last) &&
			isIsoDate(snapshot.generatedOn) &&
			daysBetween(last, snapshot.generatedOn) < 0
		) {
			errors.push(`${where} lastCommit is dated after generatedOn`);
		}
		if (project.lastCommit?.sha !== snapshot.headSha) {
			errors.push(`${where} lastCommit.sha is not the recorded headSha`);
		}

		const counts = project.commits;
		if (counts === null || typeof counts !== 'object') {
			errors.push(`${where} commits is not an object`);
			continue;
		}
		if (!hasExactKeys(counts, COUNT_KEYS)) {
			errors.push(`${where} commits keys are not exactly ${COUNT_KEYS.join(', ')}`);
		}
		if (!Number.isInteger(counts.recent) || counts.recent < 0) {
			errors.push(`${where} commits.recent is not a non-negative integer`);
		}
		if (!Number.isInteger(counts.total) || counts.total <= 0) {
			errors.push(`${where} commits.total is not a positive integer`);
		}
		if (Number.isInteger(counts.total) && counts.total !== snapshot.commitsTotal) {
			errors.push(`${where} commits.total disagrees with commitsTotal`);
		}
		if (
			Number.isInteger(counts.recent) &&
			Number.isInteger(counts.total) &&
			counts.recent > counts.total
		) {
			errors.push(`${where} commits.recent exceeds commits.total`);
		}
	}

	let summary = null;
	if (errors.length === 0) {
		const age = isIsoDate(today) ? daysBetween(snapshot.generatedOn, today) : Number.NaN;
		const ageText = Number.isFinite(age) ? ` (${age} day(s) old)` : '';
		summary = `${SNAPSHOT_PATH}: ${ids.length} project(s), head ${String(snapshot.headSha).slice(0, 8)}, ${snapshot.commitsTotal} commits, generatedOn ${snapshot.generatedOn}${ageText}`;
		if (Number.isFinite(age) && age > maxAgeDays) {
			warnings.push(
				`snapshot is ${age} day(s) old; the section prints the measurement day, but a refresh is overdue (pnpm run current:facts:sync)`,
			);
		}
	}

	return { errors, warnings, summary };
}

function main(argv) {
	if (argv.includes('--help')) {
		process.stdout.write(
			`usage: node scripts/check-home-git-facts.mjs [--max-age-days=N]\n\nvalidates ${SNAPSHOT_PATH} offline (no git history required).\n--max-age-days=N  warn (never fail) when the snapshot is older than N days\n`,
		);
		return 0;
	}
	let maxAgeDays = WINDOW_DAYS;
	const unknown = [];
	for (const arg of argv) {
		const match = /^--max-age-days=(\d+)$/.exec(arg);
		if (match) {
			maxAgeDays = Number(match[1]);
			continue;
		}
		unknown.push(arg);
	}
	if (unknown.length > 0) {
		process.stderr.write(`unknown option: ${unknown.join(' ')}\n`);
		return 2;
	}

	let snapshot;
	try {
		snapshot = JSON.parse(readFileSync(join(REPO_ROOT, SNAPSHOT_PATH), 'utf8'));
	} catch (error) {
		process.stderr.write(`cannot read ${SNAPSHOT_PATH}: ${error.message}\n`);
		return 1;
	}

	const today = new Date().toISOString().slice(0, 10);
	const { errors, warnings, summary } = validateSnapshot(snapshot, { today, maxAgeDays });
	for (const warning of warnings) process.stdout.write(`warning: ${warning}\n`);
	if (errors.length > 0) {
		for (const error of errors) process.stderr.write(`error: ${error}\n`);
		process.stderr.write(`invalid: ${SNAPSHOT_PATH} (${errors.length} problem(s))\n`);
		return 1;
	}
	process.stdout.write(`ok: ${summary}\n`);
	return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exitCode = main(process.argv.slice(2));
}
