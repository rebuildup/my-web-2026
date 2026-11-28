import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspectLocalD1Table, listD1StateFiles } from './_local-d1-state.mjs';

/**
 * `_local-d1-state.mjs` tests (Issue #1317).
 *
 * The module is the shared "does the local D1 know this table" check
 * behind BOTH the `vite.config.ts` startup warning and
 * `scripts/dev-doctor.mjs`. The fixtures mimic miniflare's persisted
 * layout (`<stateDir>/v3/d1/miniflare-D1DatabaseObject/*.sqlite`), and
 * the needle is the plain `CREATE TABLE` text SQLite stores in
 * `sqlite_master` — the same bytes a real migrated database carries.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');

async function withStateDir(fn) {
	const dir = mkdtempSync(join(tmpdir(), 'local-d1-state-'));
	try {
		await fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function writeD1File(stateDir, name, content) {
	const dir = join(stateDir, 'v3', 'd1', 'miniflare-D1DatabaseObject');
	mkdirSync(dir, { recursive: true });
	const file = join(dir, name);
	writeFileSync(file, content);
	return file;
}

describe('_local-d1-state.mjs', () => {
	it('reports empty when the state dir does not exist', async () => {
		await withStateDir(async (dir) => {
			const result = await inspectLocalD1Table({
				stateDir: join(dir, 'absent'),
				table: 'portfolio_project',
			});
			assert.equal(result.status, 'empty');
			assert.equal(result.filesScanned, 0);
		});
	});

	it('reports empty when v3/d1 exists but holds no sqlite files', async () => {
		await withStateDir(async (dir) => {
			mkdirSync(join(dir, 'v3', 'd1'), { recursive: true });
			writeFileSync(join(dir, 'v3', 'd1', 'readme.txt'), 'not sqlite');
			const result = await inspectLocalD1Table({
				stateDir: dir,
				table: 'portfolio_project',
			});
			assert.equal(result.status, 'empty');
		});
	});

	it('reports table-missing when sqlite files exist without the schema text', async () => {
		await withStateDir(async (dir) => {
			writeD1File(dir, 'aaa.sqlite', 'SQLite format 3\0unrelated schema');
			const result = await inspectLocalD1Table({
				stateDir: dir,
				table: 'portfolio_project',
			});
			assert.equal(result.status, 'table-missing');
			assert.equal(result.filesScanned, 1);
		});
	});

	it('reports table-found when a .sqlite carries the CREATE TABLE text', async () => {
		await withStateDir(async (dir) => {
			writeD1File(dir, 'aaa.sqlite', 'SQLite format 3\0CREATE TABLE portfolio_project (id TEXT)');
			const result = await inspectLocalD1Table({
				stateDir: dir,
				table: 'portfolio_project',
			});
			assert.equal(result.status, 'table-found');
			assert.equal(result.matchedFiles.length, 1);
		});
	});

	it('finds schema text that lives only in the -wal sidecar', async () => {
		await withStateDir(async (dir) => {
			writeD1File(dir, 'aaa.sqlite', 'SQLite format 3\0empty main file');
			writeD1File(dir, 'aaa.sqlite-wal', 'wal frames … CREATE TABLE portfolio_project (id TEXT)');
			const result = await inspectLocalD1Table({
				stateDir: dir,
				table: 'portfolio_project',
			});
			assert.equal(result.status, 'table-found');
		});
	});

	it('does NOT scan outside v3/d1 — the observability store logs SQL text', async () => {
		await withStateDir(async (dir) => {
			// The wobs trace store legitimately contains the string
			// `portfolio_project` (it logs queries). Scanning it would
			// report a table that does not exist.
			const obsDir = join(dir, 'v3', 'observability', 'miniflare-wobs-trace-store');
			mkdirSync(obsDir, { recursive: true });
			writeFileSync(
				join(obsDir, 'trace.sqlite'),
				'SQLite format 3\0SELECT * FROM portfolio_project',
			);
			writeD1File(dir, 'aaa.sqlite', 'SQLite format 3\0unrelated schema');
			const result = await inspectLocalD1Table({
				stateDir: dir,
				table: 'portfolio_project',
			});
			assert.equal(result.status, 'table-missing');
			assert.equal(result.filesScanned, 1);
		});
	});

	it('skips -shm files and non-sqlite siblings', async () => {
		await withStateDir(async (dir) => {
			writeD1File(dir, 'aaa.sqlite', 'SQLite format 3\0unrelated');
			writeD1File(dir, 'aaa.sqlite-shm', 'portfolio_project');
			writeD1File(dir, 'notes.txt', 'portfolio_project');
			const files = await listD1StateFiles(dir);
			assert.equal(files.length, 1);
			assert.match(files[0], /aaa\.sqlite$/);
		});
	});

	it('rejects an empty table name', async () => {
		await assert.rejects(
			inspectLocalD1Table({ stateDir: FIXTURES, table: '' }),
			/table must be a non-empty string/,
		);
	});
});
