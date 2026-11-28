/**
 * Local D1 persisted-state inspection (Issue #1317).
 *
 * Why a file scan instead of a query
 * ----------------------------------
 * The dev server's local D1 lives in miniflare's persisted state under
 * `LOCAL_STATE_DIR` (`.tmp/d1state`), shared with every `cf ... --local`
 * command (`scripts/_cloudflare-identity.mjs`). The observed failure
 * this module exists for: a fresh `.tmp/d1state` (or one that never saw
 * `pnpm db:migrate:apply:local`) has NO `portfolio_project` table, so
 * `/portfolio` and `/about` return 500 while `/` keeps working — a
 * silent failure until a data route is hit.
 *
 * The canonical read path (`scripts/_d1.mjs` → `cf d1 raw --local`)
 * spawns a whole `cf`/miniflare process — far too heavy for a
 * dev-server startup warning, and it cannot run inside `vite.config.ts`
 * at all (that file is loaded by the Vite config pipeline, not by a
 * script). What IS cheap and reliable: SQLite stores the
 * `sqlite_master` schema as plain `CREATE TABLE …` text inside the
 * database file (and inside the `-wal` sidecar until checkpoint). A
 * byte scan for the table name is therefore a sound heuristic for
 * "does this local D1 know the table" — it can only false-negative if
 * the schema text were somehow absent, which SQLite never does for an
 * applied migration.
 *
 * Scope is deliberately narrow: only files under `<stateDir>/v3/d1/`
 * are scanned. The same state tree also holds the observability trace
 * store, whose sqlite files legitimately CONTAIN the string
 * `portfolio_project` (they log SQL) — scanning the whole tree would
 * report a table that does not exist.
 *
 * This module is pure fs — no `cf`, no credentials, no binding. Both
 * consumers (`vite.config.ts` startup warning, `scripts/dev-doctor.mjs`)
 * share it so the two cannot disagree about what "empty local D1"
 * means.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Miniflare's persisted D1 subtree inside `LOCAL_STATE_DIR`. */
const D1_STATE_SUBDIR = join('v3', 'd1');

/**
 * Files whose bytes can carry schema text: the database itself and its
 * write-ahead log (un-checkpointed pages live only in `-wal`). The
 * `-shm` index never holds row/schema payload and is skipped.
 */
const SQLITE_STATE_RE = /\.sqlite(?:-wal)?$/;

/**
 * Recursively list the sqlite state files under `<stateDir>/v3/d1`.
 * Returns repo-relative-ish absolute paths. Missing directory → `[]`
 * (the caller distinguishes "no state at all" from "state without the
 * table" via `inspectLocalD1Table`).
 */
export async function listD1StateFiles(stateDir) {
	const root = join(stateDir, D1_STATE_SUBDIR);
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true, recursive: true });
	} catch {
		return [];
	}
	return entries
		.filter((entry) => entry.isFile() && SQLITE_STATE_RE.test(entry.name))
		.map((entry) => join(entry.parentPath ?? entry.path ?? root, entry.name));
}

/**
 * Inspect the local D1 state for one table.
 *
 * Returns one of:
 *   - `{ status: 'missing', … }`        — `<stateDir>` has no `v3/d1` at all
 *   - `{ status: 'empty', … }`          — state dir exists but holds no sqlite files
 *   - `{ status: 'table-found', … }`    — at least one file contains the table's schema text
 *   - `{ status: 'table-missing', … }`  — sqlite files exist but none names the table
 *
 * `matchedFiles` lists the files that carried the needle, for diagnostics.
 * `filesScanned` counts every candidate file, so a `table-missing`
 * verdict on zero scanned files is distinguishable from a real scan.
 */
export async function inspectLocalD1Table({ stateDir, table }) {
	if (typeof table !== 'string' || table.length === 0) {
		throw new Error('inspectLocalD1Table: table must be a non-empty string');
	}
	const needle = Buffer.from(table, 'utf8');
	const files = await listD1StateFiles(stateDir);
	const base = { table, filesScanned: files.length, matchedFiles: [] };
	if (files.length === 0) {
		// `v3/d1` absent entirely vs present-but-fileless is the same
		// operator fact: no local D1 has ever been written here.
		return { ...base, status: 'empty' };
	}
	const matchedFiles = [];
	for (const file of files) {
		let bytes;
		try {
			bytes = await readFile(file);
		} catch {
			continue; // unreadable file (locked/partial) — skip, never fail the check
		}
		if (bytes.includes(needle)) matchedFiles.push(file);
	}
	return {
		...base,
		matchedFiles,
		status: matchedFiles.length > 0 ? 'table-found' : 'table-missing',
	};
}
