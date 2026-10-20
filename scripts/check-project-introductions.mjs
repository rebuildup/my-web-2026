#!/usr/bin/env node
/**
 * Offline validation for committed project-introduction snapshots.
 *
 * This is the cheap half of the sync contract (the fetch half is
 * `scripts/sync-project-introductions.mjs`). It never touches the
 * network. It proves that:
 *
 *   - every `src/projects/snapshots/<id>.json` names an allowlisted
 *     source, and the file name matches that source id;
 *   - the provenance is internally consistent — the README URL is
 *     pinned to the recorded commit, and every section URL is a GitHub
 *     URL at that same commit;
 *   - the content digest still matches the stored introduction, so a
 *     hand-edited snapshot cannot be rendered as verified content;
 *   - links use a publishable scheme and the structure is the one the
 *     page schema expects.
 *
 * Freshness is reported, never gated. An old snapshot is an external
 * fact the repository may not be able to fix at build time; the page
 * renders it as explicitly not-current. Failing the build for it would
 * make every scheduled-sync outage a red CI run that no code change
 * can resolve.
 *
 * Exit codes: 0 = valid, 1 = invalid snapshot(s), 2 = bad input.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	MAX_AGE_HOURS,
	PROJECT_SOURCES,
	ageHours,
	validateSnapshot,
} from './_project-introduction.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SNAPSHOT_DIR = join(REPO_ROOT, 'src/projects/snapshots');

/** A status line for one snapshot. No document text is printed. */
export function describeSnapshot(fileName, snapshot, now) {
	const sourceId = fileName.replace(/\.json$/, '');
	const verifiedAge = ageHours(snapshot?.verifiedAt, now);
	const freshness =
		snapshot?.availability !== 'public'
			? 'unavailable'
			: verifiedAge === null
				? 'unknown'
				: verifiedAge > MAX_AGE_HOURS
					? 'stale'
					: 'current';
	return `${sourceId}: ${freshness} commit=${String(snapshot?.source?.commitSha ?? '').slice(0, 12)} verifiedAt=${snapshot?.verifiedAt ?? 'unknown'}`;
}

/** Validate every committed snapshot. Pure enough for tests. */
export function checkSnapshots({ snapshots, now = new Date() }) {
	const errors = [];
	const lines = [];
	const seen = new Set();
	for (const [fileName, snapshot] of snapshots) {
		const sourceId = fileName.replace(/\.json$/, '');
		if (!fileName.endsWith('.json')) {
			errors.push(`${fileName}: not a .json snapshot`);
			continue;
		}
		if (!PROJECT_SOURCES[sourceId]) {
			errors.push(`${fileName}: no allowlisted source named ${sourceId}`);
			continue;
		}
		seen.add(sourceId);
		const snapshotErrors = validateSnapshot(snapshot);
		for (const error of snapshotErrors) errors.push(`${fileName}: ${error}`);
		if (snapshotErrors.length === 0) lines.push(describeSnapshot(fileName, snapshot, now));
	}
	for (const sourceId of Object.keys(PROJECT_SOURCES)) {
		if (!seen.has(sourceId)) errors.push(`${sourceId}: no committed snapshot`);
	}
	return { errors, lines };
}

function main() {
	if (!existsSync(SNAPSHOT_DIR)) {
		process.stderr.write(`project-introductions: ${SNAPSHOT_DIR} does not exist\n`);
		return 1;
	}
	const names = readdirSync(SNAPSHOT_DIR)
		.filter((name) => name.endsWith('.json'))
		.sort();
	if (names.length === 0) {
		process.stderr.write('project-introductions: no snapshot is committed\n');
		return 1;
	}
	const snapshots = names.map((name) => {
		try {
			return [name, JSON.parse(readFileSync(join(SNAPSHOT_DIR, name), 'utf8'))];
		} catch {
			return [name, null];
		}
	});
	const { errors, lines } = checkSnapshots({ snapshots });
	if (errors.length > 0) {
		for (const error of errors) process.stderr.write(`project-introductions: ${error}\n`);
		return 1;
	}
	for (const line of lines) process.stdout.write(`${line}\n`);
	return 0;
}

const invokedDirectly =
	process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
	process.exitCode = main();
}
