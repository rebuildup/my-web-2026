#!/usr/bin/env node
/**
 * Sync a public project introduction from its canonical repository.
 *
 * Usage:
 *   node scripts/sync-project-introductions.mjs [--source dotfiles] [--dry-run]
 *
 * What it does
 * ------------
 *   1. reads the committed snapshot at `src/projects/snapshots/<id>.json`
 *      (the last known introduction);
 *   2. performs the three allowlisted GitHub reads defined in
 *      `scripts/_project-introduction.mjs` — repository metadata, the
 *      default-branch commit, and `README.md` pinned at that commit;
 *   3. extracts the allowlisted introduction sections and sanitizes
 *      links;
 *   4. writes the snapshot only when the CONTENT changed or the weekly
 *      verification heartbeat is due.
 *
 * Failure semantics:
 *   - a transport failure (timeout / network / 401 / 403 / 429 / 5xx /
 *     oversized or non-JSON body) exits 1 and writes NOTHING. The
 *     committed snapshot keeps its last `verifiedAt`, so the page ages
 *     into its explicit stale state. A transient GitHub outage is never
 *     recorded as "this repository is no longer public".
 *   - a source-state failure (repository deleted, private, archived,
 *     default branch moved, README no longer in the expected shape)
 *     records `availability: "unavailable"` with the reason and
 *     preserves the last known introduction. The page renders it as
 *     "last known, not current" with reason-specific copy.
 *
 * The script never reads a credential, never sends an Authorization
 * header, and never prints README content. Output is status-only.
 *
 * Exit codes: 0 = synced / unchanged / recorded unavailable,
 * 1 = transport or validation failure, 2 = usage error.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	DEFAULT_SOURCE_ID,
	PROJECT_SOURCES,
	ProjectSourceTransportError,
	ProjectSourceUnavailable,
	buildUnavailableSnapshot,
	fetchPublicSnapshot,
	planSnapshotWrite,
	serializeSnapshot,
	validateSnapshot,
} from './_project-introduction.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SNAPSHOT_DIR = join(REPO_ROOT, 'src/projects/snapshots');

const USAGE = `sync-project-introductions — fetch one allowlisted public README

  node scripts/sync-project-introductions.mjs [--source <id>] [--dry-run]

  --source <id>   declared source (default: ${DEFAULT_SOURCE_ID})
  --dry-run       fetch and report, write nothing
  --help          print this text
`;

/** Parse argv without accepting an arbitrary URL or path. */
export function parseArgs(argv) {
	let sourceId = DEFAULT_SOURCE_ID;
	let dryRun = false;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--help' || arg === '-h') return { help: true };
		if (arg === '--dry-run') {
			dryRun = true;
			continue;
		}
		if (arg === '--source') {
			const value = argv[index + 1];
			if (!value) throw new ProjectSourceTransportError('--source needs a value');
			sourceId = value;
			index += 1;
			continue;
		}
		throw new ProjectSourceTransportError(`unknown argument: ${arg}`);
	}
	if (!PROJECT_SOURCES[sourceId]) {
		throw new ProjectSourceTransportError(`unknown source: ${sourceId}`);
	}
	return { help: false, sourceId, dryRun };
}

export function snapshotPathFor(sourceId, snapshotDir = SNAPSHOT_DIR) {
	return join(snapshotDir, `${sourceId}.json`);
}

/** Read the committed snapshot, or `null` when this is the first run. */
export function readPreviousSnapshot(sourceId, snapshotDir = SNAPSHOT_DIR) {
	const path = snapshotPathFor(sourceId, snapshotDir);
	if (!existsSync(path)) return null;
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		throw new ProjectSourceTransportError(`${sourceId}: committed snapshot is not valid JSON`);
	}
	const errors = validateSnapshot(parsed);
	if (errors.length > 0) {
		throw new ProjectSourceTransportError(
			`${sourceId}: committed snapshot is invalid (${errors[0]})`,
		);
	}
	return parsed;
}

/** Status-only line. Never prints document text. */
function report(status, fields, stdout = process.stdout) {
	const parts = [`${status} source=${fields.sourceId}`];
	if (fields.commitSha) parts.push(`commit=${fields.commitSha.slice(0, 12)}`);
	if (fields.reason) parts.push(`reason=${fields.reason}`);
	if (fields.written !== undefined) parts.push(`written=${fields.written}`);
	stdout.write(`${parts.join(' ')}\n`);
}

/**
 * Run one sync. Exported so a test can point it at a temporary
 * `snapshotDir` and prove that a transport failure leaves the committed
 * snapshot byte-identical.
 */
export async function syncSource({
	sourceId = DEFAULT_SOURCE_ID,
	now = new Date(),
	fetchImpl = globalThis.fetch,
	snapshotDir = SNAPSHOT_DIR,
	dryRun = false,
	stdout = process.stdout,
	stderr = process.stderr,
} = {}) {
	let previous;
	try {
		previous = readPreviousSnapshot(sourceId, snapshotDir);
	} catch (error) {
		stderr.write(`${error.message}\n`);
		return 1;
	}

	let next;
	try {
		next = await fetchPublicSnapshot({
			sourceId,
			now,
			fetchImpl,
			previous,
		});
	} catch (error) {
		if (error instanceof ProjectSourceUnavailable) {
			if (!previous) {
				stderr.write(
					`${sourceId}: source is unavailable and no snapshot exists (${error.reason})\n`,
				);
				return 1;
			}
			next = buildUnavailableSnapshot(previous, error.reason, now);
			const plan = planSnapshotWrite(previous, next, now);
			if (!dryRun && plan.write) {
				writeFileSync(snapshotPathFor(sourceId, snapshotDir), serializeSnapshot(next));
			}
			report(
				'unavailable',
				{
					sourceId,
					commitSha: previous.source.commitSha,
					reason: error.reason,
					written: !dryRun && plan.write,
				},
				stdout,
			);
			return 0;
		}
		if (error instanceof ProjectSourceTransportError) {
			stderr.write(`${sourceId}: sync failed (${error.message})\n`);
			return 1;
		}
		stderr.write(`${sourceId}: sync failed (unexpected error)\n`);
		return 1;
	}

	const errors = validateSnapshot(next);
	if (errors.length > 0) {
		stderr.write(`${sourceId}: generated snapshot is invalid (${errors[0]})\n`);
		return 1;
	}

	const plan = planSnapshotWrite(previous, next, now);
	if (!dryRun && plan.write) {
		mkdirSync(snapshotDir, { recursive: true });
		writeFileSync(snapshotPathFor(sourceId, snapshotDir), serializeSnapshot(next));
	}
	report(
		plan.write ? 'synced' : 'unchanged',
		{
			sourceId,
			commitSha: next.source.commitSha,
			reason: plan.reason,
			written: !dryRun && plan.write,
		},
		stdout,
	);
	return 0;
}

async function main() {
	let args;
	try {
		args = parseArgs(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`${error.message}\n${USAGE}`);
		return 2;
	}
	if (args.help) {
		process.stdout.write(USAGE);
		return 0;
	}
	return syncSource({ sourceId: args.sourceId, dryRun: args.dryRun });
}

const invokedDirectly =
	process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
	const code = await main();
	process.exitCode = code;
}
