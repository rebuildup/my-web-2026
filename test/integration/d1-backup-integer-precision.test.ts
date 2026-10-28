/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	D1BackupExportError,
	D1_RESTORE_VERDICT,
	type D1Backup,
	type D1BackupTable,
	computeD1BackupDigest,
	exportD1Backup,
	restoreD1Database,
} from '../../src/cloudflare/d1-backup';

/**
 * D1 backup / restore integer precision (Issue #701).
 *
 * The claim under test
 * --------------------
 * A backup document carries the value that was stored, and a value the
 * D1 JavaScript adapter cannot carry exactly is **refused** rather
 * than written as a plausible-looking number. SQLite stores an INTEGER
 * as a 64-bit integer; the adapter hands the value over as a double,
 * so an int64 outside ±(2^53 − 1) reaches JavaScript already rounded.
 * A document, a digest and a read-back comparison built on that same
 * rounded number agree with each other and prove nothing about the
 * int64 that was stored — which is the failure this suite exists to
 * rule out.
 *
 * How the comparison is made independent of the export
 * ----------------------------------------------------
 * The expected rows below are **literals written in this file**. The
 * restored rows are compared against those literals, not against the
 * exported document: comparing a restore with the document it came
 * from would pass even when both carry the same rounded value. The
 * fixture is the source of truth, the export is the thing under test.
 *
 * What it runs against
 * --------------------
 * `env.DB` from the `@cloudflare/vitest-plugin` test pool: a real D1
 * (SQLite) binding in local workerd, with isolated storage per test
 * file. No production database, no remote read, no credential, no
 * deploy. Every row is synthetic.
 *
 * The int64 rows are inserted as SQL **literals** rather than as bound
 * parameters, because a bound JavaScript number is a double: the
 * literal is the only way to put the exact int64 into the database and
 * observe what the adapter does with it.
 */

const SAFE_TABLE = 'd1_precision_fixture_safe';
const UNSAFE_TABLE = 'd1_precision_fixture_unsafe';

const FIXED_AT = '2026-10-28T00:00:00.000Z';

const SETUP_STATEMENTS = [
	`DROP TABLE IF EXISTS ${SAFE_TABLE}`,
	`DROP TABLE IF EXISTS ${UNSAFE_TABLE}`,
	`CREATE TABLE ${SAFE_TABLE} (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  boundary INTEGER NOT NULL,
  measure REAL NOT NULL,
  optional INTEGER
)`,
	`CREATE TABLE ${UNSAFE_TABLE} (
  id INTEGER PRIMARY KEY,
  value INTEGER NOT NULL
)`,
	// The boundary values, as SQL literals: 2^53 − 1 and its negative
	// are inside the range a double carries exactly.
	`INSERT INTO ${SAFE_TABLE} (id, label, boundary, measure, optional) VALUES
  (1, 'safe-max', 9007199254740991, 1.5, 9007199254740991),
  (2, 'safe-min', -9007199254740991, -2.25, -9007199254740991),
  (3, 'real-fraction', 0, 0.1, NULL),
  (4, 'real-integral', 42, 2, 0)`,
	// The values the adapter cannot carry: ±2^53 and the SQLite int64
	// bounds. The int64 maximum is not representable at all — the
	// literal already reads as 2^63.
	`INSERT INTO ${UNSAFE_TABLE} (id, value) VALUES
  (1, 9007199254740992),
  (2, -9007199254740992),
  (3, 9223372036854775807),
  (4, -9223372036854775808)`,
];

/**
 * The rows the fixture is expected to hold, written out here so the
 * comparison never depends on what the export produced.
 */
const EXPECTED_SAFE_ROWS = [
	{
		id: 1,
		label: 'safe-max',
		boundary: 9007199254740991,
		measure: 1.5,
		optional: 9007199254740991,
	},
	{
		id: 2,
		label: 'safe-min',
		boundary: -9007199254740991,
		measure: -2.25,
		optional: -9007199254740991,
	},
	{ id: 3, label: 'real-fraction', boundary: 0, measure: 0.1, optional: null },
	{ id: 4, label: 'real-integral', boundary: 42, measure: 2, optional: 0 },
];

/**
 * What the adapter delivers for the unsafe rows, as exact integers.
 *
 * The int64 maximum is the case that proves the point: SQLite holds
 * 9223372036854775807 exactly, and the adapter hands the row over as
 * 2^63 — a different integer. The int64 minimum is delivered exactly
 * (−2^63 is representable), and is still refused: the int64 below it
 * rounds onto the same double, so the document could not say which of
 * the two was stored.
 */
const DELIVERED_AS_INT64 = [
	9007199254740992n,
	-9007199254740992n,
	9223372036854775808n,
	-9223372036854775808n,
];

interface SafeRow {
	id: number;
	label: string;
	boundary: number;
	measure: number;
	optional: number | null;
}

async function dropFixtures(): Promise<void> {
	await env.DB.batch(
		[SAFE_TABLE, UNSAFE_TABLE].map((table) => env.DB.prepare(`DROP TABLE IF EXISTS "${table}"`)),
	);
}

async function readSafeRows(): Promise<SafeRow[]> {
	const result = await env.DB.prepare(
		`SELECT id, label, boundary, measure, optional FROM ${SAFE_TABLE} ORDER BY id`,
	).all<SafeRow>();
	return result.results ?? [];
}

async function readUnsafeValues(): Promise<number[]> {
	const result = await env.DB.prepare(`SELECT value FROM ${UNSAFE_TABLE} ORDER BY id`).all<{
		value: number;
	}>();
	return (result.results ?? []).map((row) => row.value);
}

async function exportSafe(): Promise<D1Backup> {
	return exportD1Backup(env.DB, { tables: [SAFE_TABLE], createdAt: FIXED_AT });
}

function tableNamed(backup: D1Backup, name: string): D1BackupTable {
	const table = backup.tables.find((entry) => entry.name === name);
	if (!table) throw new Error('fixture table missing from the backup');
	return table;
}

function withoutDigest(backup: D1Backup) {
	const { digest: _digest, ...rest } = backup;
	return rest;
}

async function resign(backup: D1Backup): Promise<D1Backup> {
	return { ...backup, digest: await computeD1BackupDigest(withoutDigest(backup)) };
}

beforeEach(async () => {
	await env.DB.batch(SETUP_STATEMENTS.map((sql) => env.DB.prepare(sql)));
});

describe('a value the adapter can carry survives the round trip exactly', () => {
	it('restores the boundary integers, the REALs and the NULL against the fixture', async () => {
		// The database really holds the boundary integers: they are read
		// back through the same adapter the export uses.
		const before = await readSafeRows();
		expect(before).toEqual(EXPECTED_SAFE_ROWS);

		const backup = await exportSafe();
		expect(tableNamed(backup, SAFE_TABLE).rowCount).toBe(EXPECTED_SAFE_ROWS.length);

		await dropFixtures();
		const result = await restoreD1Database(env.DB, JSON.stringify(backup));

		expect(result).toMatchObject({
			verdict: D1_RESTORE_VERDICT.restored,
			reason: '-',
			applied: true,
			tables: 1,
			rows: EXPECTED_SAFE_ROWS.length,
		});

		// The comparison is against the fixture's literals, not against
		// the document: the restore must reproduce what was stored.
		expect(await readSafeRows()).toEqual(EXPECTED_SAFE_ROWS);
	});
});

describe('a value the adapter cannot carry is refused, never written', () => {
	it('refuses the export of ±2^53 and of the SQLite int64 bounds', async () => {
		// What the adapter delivers for the four rows: none of them is
		// an integer a double carries exactly.
		const delivered = await readUnsafeValues();
		expect(delivered.every((value) => !Number.isSafeInteger(value))).toBe(true);
		expect(delivered.map((value) => BigInt(value))).toEqual(DELIVERED_AS_INT64);

		// The export of the table that holds them fails as a whole: no
		// partial document, no quiet rounding.
		const failure = await exportD1Backup(env.DB, {
			tables: [UNSAFE_TABLE],
			createdAt: FIXED_AT,
		}).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(D1BackupExportError);
		// The refusal names a reason code and nothing else.
		expect((failure as D1BackupExportError).reason).toBe('unsupported_value');

		// The rows are untouched: a refused export writes nothing.
		expect(await readUnsafeValues()).toEqual(delivered);
	});

	it('refuses a document whose digest is valid but whose integer is not', async () => {
		const backup = await exportSafe();
		const tampered = structuredClone(backup);
		const table = tableNamed(tampered, SAFE_TABLE);
		// Replace a boundary value with 2^53 and re-sign the document:
		// the digest is well formed and matches the content, and the
		// content is still not restorable.
		table.rows[0][2] = 9007199254740992;
		table.rows[0][4] = 9007199254740992;
		const resigned = await resign(tampered);

		await dropFixtures();

		const result = await restoreD1Database(env.DB, resigned);

		expect(result).toMatchObject({
			verdict: D1_RESTORE_VERDICT.refused,
			reason: 'invalid_backup',
			applied: false,
			tables: 0,
			rows: 0,
		});
		// Nothing was created: the refusal happened before a statement.
		const created = await env.DB.prepare(
			`SELECT COUNT(*) AS present FROM sqlite_master WHERE type = 'table' AND name = ?`,
		)
			.bind(SAFE_TABLE)
			.first<number>('present');
		expect(created).toBe(0);
	});
});
