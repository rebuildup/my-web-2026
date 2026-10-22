/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	D1_RESTORE_VERDICT,
	type D1Backup,
	type D1BackupWithoutDigest,
	computeD1BackupDigest,
	exportD1Backup,
	formatD1RestoreReport,
	restoreD1Database,
} from '../../src/cloudflare/d1-backup';

/**
 * D1 backup / restore proof (Issue #461), executed against the local
 * workerd D1 binding.
 *
 * The claim under test
 * --------------------
 * A disposable database can be seeded, exported, dropped, and
 * restored so that the restored **schema and row set are exactly the
 * exported ones** — and a backup that is unreadable, partial, or
 * inapplicable fails loudly instead of leaving a half-restored
 * database.
 *
 * What it runs against
 * --------------------
 * `env.DB` from the `@cloudflare/vitest-plugin` test pool: a real D1
 * (SQLite) binding in local workerd, with isolated storage per test
 * file. No production database, no remote read, no credential, no
 * deploy. Every row below is synthetic: fixed strings, fixed numbers,
 * and a 3-byte BLOB. No personal data, no real identifier.
 *
 * The fixture tables are created here rather than taken from the
 * application schema, because the contract under test is the
 * backup/restore procedure, not any one migration. The schema uses a
 * `UNIQUE` constraint and an explicit index so the export has to
 * carry more than bare column definitions.
 *
 * Why the failure cases matter as much as the success case
 * --------------------------------------------------------
 * A restore that writes nothing is visible. A restore that writes
 * *most* of a backup is not: the surviving tables answer queries and
 * the missing rows surface later, as a wrong page rather than a
 * failed operation. So the tests below assert both the verdict AND
 * the database state after a refusal or a failed batch.
 */

const TABLES = ['d1_backup_fixture_notes', 'd1_backup_fixture_metrics'];
const FIXED_AT = '2026-10-20T00:00:00.000Z';

// `D1Database.exec()` splits on newlines, which does not fit a
// multi-line `CREATE TABLE`. Each statement is prepared separately and
// executed through one batch instead.
const SETUP_STATEMENTS = [
	'DROP TABLE IF EXISTS d1_backup_fixture_notes',
	'DROP TABLE IF EXISTS d1_backup_fixture_metrics',
	`CREATE TABLE d1_backup_fixture_notes (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0
)`,
	'CREATE INDEX idx_d1_backup_fixture_notes_slug ON d1_backup_fixture_notes(slug)',
	`CREATE TABLE d1_backup_fixture_metrics (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  amount REAL NOT NULL,
  payload BLOB
)`,
	`INSERT INTO d1_backup_fixture_notes (id, slug, body, pinned) VALUES
  (1, 'fixture-note-alpha', 'synthetic body alpha', 0),
  (2, 'fixture-note-beta', 'synthetic body beta', 1),
  (3, 'fixture-note-gamma', 'synthetic body gamma', 0)`,
	`INSERT INTO d1_backup_fixture_metrics (id, label, amount, payload) VALUES
  (1, 'fixture-metric-alpha', 1.5, x'00ff10'),
  (2, 'fixture-metric-beta', -2.25, x'89'),
  (3, 'fixture-metric-gamma', 0, NULL)`,
];

async function dropFixture(): Promise<void> {
	await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DROP TABLE IF EXISTS "${table}"`)));
}

interface SchemaRow {
	type: string;
	name: string;
	tbl_name: string;
	sql: string | null;
}

async function schemaSnapshot(): Promise<SchemaRow[]> {
	const result = await env.DB.prepare(
		`SELECT type, name, tbl_name, sql
     FROM sqlite_master
     WHERE name LIKE 'd1_backup_fixture_%'
     ORDER BY type, name`,
	).all<SchemaRow>();
	return result.results ?? [];
}

async function fixtureTableCount(): Promise<number> {
	const result = await env.DB.prepare(
		`SELECT COUNT(*) AS present FROM sqlite_master
     WHERE type = 'table' AND name IN ('d1_backup_fixture_notes', 'd1_backup_fixture_metrics')`,
	).first<number>('present');
	return result ?? 0;
}

async function noteBodies(): Promise<string[]> {
	const result = await env.DB.prepare('SELECT body FROM d1_backup_fixture_notes ORDER BY id').all<{
		body: string;
	}>();
	return (result.results ?? []).map((row) => row.body);
}

async function exportFixture(): Promise<D1Backup> {
	return exportD1Backup(env.DB, { tables: TABLES, createdAt: FIXED_AT });
}

/** The export sorts tables by name so the digest is independent of read order. */
function tableNamed(backup: D1Backup, name: string): D1Backup['tables'][number] {
	const table = backup.tables.find((entry) => entry.name === name);
	if (!table) throw new Error('fixture table missing from the backup');
	return table;
}

function withoutDigest(backup: D1Backup): D1BackupWithoutDigest {
	const { digest: _digest, ...rest } = backup;
	return rest;
}

async function resign(backup: D1Backup): Promise<D1Backup> {
	return { ...backup, digest: await computeD1BackupDigest(withoutDigest(backup)) };
}

beforeEach(async () => {
	await env.DB.batch(SETUP_STATEMENTS.map((sql) => env.DB.prepare(sql)));
});

describe('a disposable local D1 is exported, dropped, and restored exactly', () => {
	it('restores the exact schema and row set, including the BLOB and index', async () => {
		const schemaBefore = await schemaSnapshot();
		const backup = await exportFixture();

		// The export describes two tables, five synthetic rows and the
		// explicit index. A digest is present and is 64 lowercase hex.
		expect(backup.tables.map((table) => table.name)).toEqual([...TABLES].sort());
		expect(backup.tables.map((table) => table.rowCount)).toEqual([3, 3]);
		expect(backup.indexes.map((index) => index.name)).toEqual(['idx_d1_backup_fixture_notes_slug']);
		expect(backup.digest).toMatch(/^[0-9a-f]{64}$/);

		// 1. The database is dropped: both tables are gone, not just
		//    emptied, so a restore has to recreate the schema too.
		await dropFixture();
		expect(await fixtureTableCount()).toBe(0);
		expect(await schemaSnapshot()).toEqual([]);

		// 2. The backup is imported.
		const result = await restoreD1Database(env.DB, JSON.stringify(backup));
		expect(result).toMatchObject({
			verdict: D1_RESTORE_VERDICT.restored,
			reason: '-',
			applied: true,
			tables: 2,
			rows: 6,
			checks: ['parse', 'validate', 'apply', 'readback'],
		});

		// 3. Schema matches exactly: the same sqlite_master rows,
		//    including the stored CREATE INDEX text.
		expect(await schemaSnapshot()).toEqual(schemaBefore);

		// 4. Row set matches exactly. Comparing a fresh export to
		//    the original compares columns, row order (canonical),
		//    values and declared counts.
		const readback = await exportFixture();
		expect(readback.tables).toEqual(backup.tables);
		expect(readback.indexes).toEqual(backup.indexes);
		expect(readback.digest).toBe(backup.digest);

		// 5. The BLOB survived the round trip byte for byte.
		const metric = await env.DB.prepare(
			'SELECT payload FROM d1_backup_fixture_metrics WHERE id = 1',
		).first<ArrayBuffer>('payload');
		expect(metric).not.toBeNull();
		expect(Array.from(new Uint8Array(metric ?? new ArrayBuffer(0)))).toEqual([0x00, 0xff, 0x10]);

		// 6. The report is status-only: no table name, no row value.
		const report = formatD1RestoreReport(result, { target: 'local-fixture' });
		expect(report).toContain('verdict=restored');
		expect(report).toContain('tables=2 rows=6');
		expect(report).not.toContain('d1_backup_fixture');
		expect(report).not.toContain('fixture-note-alpha');
	});
});

describe('a backup that cannot be proven does not write', () => {
	it('refuses an unreadable (truncated) document and creates nothing', async () => {
		const backup = await exportFixture();
		const truncated = JSON.stringify(backup).slice(0, 12);

		await dropFixture();
		expect(await fixtureTableCount()).toBe(0);

		const result = await restoreD1Database(env.DB, truncated);

		expect(result).toMatchObject({
			verdict: D1_RESTORE_VERDICT.refused,
			reason: 'unreadable_backup',
			applied: false,
			tables: 0,
			rows: 0,
			checks: [],
		});
		// Not a half-database: nothing was created.
		expect(await fixtureTableCount()).toBe(0);
		expect(await schemaSnapshot()).toEqual([]);
	});

	it('refuses a saved backup whose rows were edited after capture', async () => {
		const backup = await exportFixture();
		const tampered = structuredClone(backup);
		// Change one synthetic value, leave the digest untouched.
		tableNamed(tampered, 'd1_backup_fixture_notes').rows[0][1] = 'fixture-note-tampered';

		const result = await restoreD1Database(env.DB, tampered);
		expect(result).toMatchObject({
			verdict: D1_RESTORE_VERDICT.refused,
			reason: 'digest_mismatch',
			applied: false,
		});
		// The live rows are the seeded ones; the refused document was
		// never applied.
		expect(await noteBodies()).toEqual([
			'synthetic body alpha',
			'synthetic body beta',
			'synthetic body gamma',
		]);
	});

	it('refuses a partial backup whose declared row count exceeds its rows', async () => {
		const backup = await exportFixture();
		const partial = structuredClone(backup);
		tableNamed(partial, 'd1_backup_fixture_notes').rows.pop();
		// Leave rowCount at 3: the document now claims a row it does
		// not carry.
		const result = await restoreD1Database(env.DB, partial);

		expect(result).toMatchObject({
			verdict: D1_RESTORE_VERDICT.refused,
			reason: 'row_count_mismatch',
			applied: false,
		});
		expect(await noteBodies()).toHaveLength(3);
	});

	it('refuses a row whose width does not match its columns', async () => {
		const backup = await exportFixture();
		const malformed = structuredClone(backup);
		const malformedNotes = tableNamed(malformed, 'd1_backup_fixture_notes');
		malformedNotes.rows[0] = malformedNotes.rows[0].slice(0, 2);

		const result = await restoreD1Database(env.DB, malformed);

		expect(result).toMatchObject({
			verdict: D1_RESTORE_VERDICT.refused,
			reason: 'row_shape_mismatch',
			applied: false,
		});
		expect(await noteBodies()).toHaveLength(3);
	});

	it('refuses a number JSON cannot represent without changing it', async () => {
		const backup = await exportFixture();
		// `JSON.parse('1e999')` is `Infinity`, which the exporter never
		// writes (exporting one fails) and SQLite cannot store. A document
		// edited to carry it must be refused before any statement runs,
		// not rounded or turned into `null` on the way in.
		const impossible = JSON.stringify(backup).replace('"synthetic body alpha"', '1e999');

		const result = await restoreD1Database(env.DB, impossible);

		expect(result).toMatchObject({
			verdict: D1_RESTORE_VERDICT.refused,
			reason: 'invalid_backup',
			applied: false,
		});
		expect(await noteBodies()).toEqual([
			'synthetic body alpha',
			'synthetic body beta',
			'synthetic body gamma',
		]);
	});
});

describe('a failed apply is rolled back, not partially committed', () => {
	it('leaves no table behind when one insert violates the schema', async () => {
		const backup = await exportFixture();
		const inapplicable = structuredClone(backup);
		// A duplicate primary key is structurally valid but cannot be
		// inserted. The digest is recomputed so the document reaches
		// the apply step; the failure must happen inside D1's batch.
		const inapplicableNotes = tableNamed(inapplicable, 'd1_backup_fixture_notes');
		inapplicableNotes.rows.push([...inapplicableNotes.rows[0]]);
		inapplicableNotes.rowCount = inapplicableNotes.rows.length;
		const resigned = await resign(inapplicable);

		await dropFixture();
		expect(await fixtureTableCount()).toBe(0);

		const result = await restoreD1Database(env.DB, resigned);

		expect(result).toMatchObject({
			verdict: D1_RESTORE_VERDICT.failed,
			reason: 'apply_failed',
			applied: false,
		});
		// D1 runs a batch as one transaction. The CREATE TABLE and the
		// first INSERT from the same batch must have rolled back with
		// the failing INSERT: a half-restored database is the failure
		// this test exists to rule out.
		expect(await fixtureTableCount()).toBe(0);
		expect(await schemaSnapshot()).toEqual([]);
	});
});
