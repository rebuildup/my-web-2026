/**
 * D1 backup / restore (Issue #461).
 *
 * The obligation this module owns
 * -------------------------------
 * A D1 backup is only useful if a restore can prove that what comes
 * back is the database that was exported. The dangerous outcome is
 * not "the restore did nothing". It is "the restore wrote part of a
 * backup and reported success", because a half-restored database
 * looks alive while missing rows that a later request will read.
 *
 * So this module owns two rules:
 *
 *   1. **Nothing is written until the backup is proven complete.**
 *      The exported document carries a canonical sha256 digest over
 *      its schema, row set and declared counts. A truncated download,
 *      an edited row, or a document whose `rowCount` disagrees with
 *      its rows is refused *before* the first statement reaches D1.
 *   2. **The restore is not "restored" until it is read back.** All
 *      drop / create / insert statements go through one D1
 *      `batch()`, which D1 executes as a single transaction; after it
 *      commits, the tables are exported again and compared with the
 *      backup. A batch that fails is reported as `apply_failed` and
 *      the transaction is rolled back, never as a partial success.
 *
 * What this is not
 * ----------------
 * This is the *proof* contract, not a production backup pipeline.
 * Every row is held in memory and every insert is one bound statement,
 * so the shape is sized for a disposable test database, not the
 * production row volume. A production-scale export/import is an
 * operator action (Cloudflare's own export/import surface) documented
 * in `docs/runbook/d1-backup-restore.md`; this repository runs that
 * procedure against a local fixture only.
 *
 * Status-only
 * -----------
 * `D1RestoreResult` carries a verdict, a reason code and counts. It
 * carries no table name, no column name, no row value, no database id
 * and no credential: the caller supplied the backup and already knows
 * its contents, and the operator report is designed to be pasted into
 * a PR. `formatD1RestoreReport` prints exactly those fields.
 */

/** Marker stored in every backup so another JSON file cannot be restored by accident. */
export const D1_BACKUP_FORMAT = 'my-web-2026.d1-backup';
export const D1_BACKUP_VERSION = 1;

/** A value as it is stored in the backup document. */
export type D1BackupScalar = null | number | string | { $blob: string };

export type D1BackupRow = D1BackupScalar[];

export interface D1BackupTable {
	/** Table name. Validated as a bare SQLite identifier. */
	name: string;
	/** Exact `CREATE TABLE` text from `sqlite_master`. */
	createSql: string;
	/** Column names in table order. */
	columns: string[];
	/** Rows in canonical (sorted) order. */
	rows: D1BackupRow[];
	/** Declared by the exporter; a mismatch with `rows.length` means partial. */
	rowCount: number;
}

export interface D1BackupIndex {
	name: string;
	table: string;
	/** Exact `CREATE INDEX` text from `sqlite_master`. */
	createSql: string;
}

export interface D1Backup {
	format: typeof D1_BACKUP_FORMAT;
	version: number;
	createdAt: string;
	tables: D1BackupTable[];
	indexes: D1BackupIndex[];
	digest: string;
}

export type D1BackupWithoutDigest = Omit<D1Backup, 'digest'>;

export interface D1ExportOptions {
	/** Restrict the export to these tables. Omit to export every user table. */
	tables?: readonly string[];
	/** Fixed timestamp for reproducible fixtures. */
	createdAt?: string;
}

/** Verdict vocabulary. Only `restored` is a pass. */
export const D1_RESTORE_VERDICT = Object.freeze({
	restored: 'restored',
	refused: 'refused',
	failed: 'failed',
} as const);

export type D1RestoreVerdict = (typeof D1_RESTORE_VERDICT)[keyof typeof D1_RESTORE_VERDICT];

/**
 * Why the run ended where it did. A code, never a message: an error
 * string is the one input that could carry a table name, a row value
 * or a path.
 */
export type D1RestoreReason =
	| '-'
	| 'unreadable_backup'
	| 'invalid_backup'
	| 'row_count_mismatch'
	| 'row_shape_mismatch'
	| 'digest_mismatch'
	| 'apply_failed'
	| 'readback_mismatch';

/** The checks a run can complete, in order. */
export type D1RestoreCheck = 'parse' | 'validate' | 'apply' | 'readback';

export interface D1BackupParseFailure {
	ok: false;
	reason: Exclude<D1RestoreReason, '-' | 'apply_failed' | 'readback_mismatch'>;
}

export type D1BackupParseResult = { ok: true; backup: D1Backup } | D1BackupParseFailure;

export interface D1RestoreResult {
	verdict: D1RestoreVerdict;
	reason: D1RestoreReason;
	/** `true` only when the transaction committed and the read-back matched. */
	applied: boolean;
	/** Tables in the backup (0 when nothing was applied). */
	tables: number;
	/** Rows in the backup (0 when nothing was applied). */
	rows: number;
	/** Checks that ran, in order. */
	checks: readonly D1RestoreCheck[];
}

/** Export-side failure. The message never contains a table name or a value. */
export class D1BackupExportError extends Error {
	readonly reason:
		| 'table_not_found'
		| 'schema_read_failed'
		| 'row_read_failed'
		| 'unsupported_value';

	constructor(reason: D1BackupExportError['reason']) {
		super(`d1_backup_export:${reason}`);
		this.name = 'D1BackupExportError';
		this.reason = reason;
	}
}

/** Lowercase hex sha256, available in workerd and Node without a dependency. */
async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	// Chunked so a large BLOB cannot blow the argument limit of
	// `String.fromCharCode`.
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
	}
	return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

function isBlobValue(value: unknown): value is { $blob: string } {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		typeof (value as { $blob?: unknown }).$blob === 'string'
	);
}

/**
 * Convert one value read from D1 into the backup representation.
 *
 * D1 returns BLOBs as `ArrayBuffer` in workerd; the CLI's JSON surface
 * renders them as `number[]`. Both are accepted so the same contract
 * holds whichever adapter is in front of the database.
 */
function encodeValue(value: unknown): D1BackupScalar {
	if (value === null || typeof value === 'string') return value;
	if (typeof value === 'number') {
		// JSON has no NaN / Infinity. Writing one would silently become
		// `null` in the document, so an unrepresentable value is an
		// export failure rather than a quiet data change.
		if (!Number.isFinite(value)) throw new D1BackupExportError('unsupported_value');
		return value;
	}
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (value instanceof ArrayBuffer) return { $blob: bytesToBase64(new Uint8Array(value)) };
	if (ArrayBuffer.isView(value)) {
		return {
			$blob: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
		};
	}
	if (Array.isArray(value) && value.every((entry) => typeof entry === 'number')) {
		return { $blob: bytesToBase64(Uint8Array.from(value)) };
	}
	throw new D1BackupExportError('unsupported_value');
}

/** Convert a backup value back into something a D1 bind accepts. */
function decodeValue(value: D1BackupScalar): unknown {
	if (!isBlobValue(value)) return value;
	const bytes = base64ToBytes(value.$blob);
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function isBareIdentifier(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function quoteIdentifier(name: string): string {
	// Names are validated by `isBareIdentifier` before this is called.
	return `"${name}"`;
}

/**
 * Canonical projection used for the digest. Constructing the object in
 * a fixed key order makes the digest independent of how a JSON parser
 * happened to order the input object.
 */
function canonical(backup: D1BackupWithoutDigest): unknown {
	return {
		format: backup.format,
		version: backup.version,
		createdAt: backup.createdAt,
		tables: backup.tables.map((table) => ({
			name: table.name,
			createSql: table.createSql,
			columns: table.columns,
			rows: table.rows,
			rowCount: table.rowCount,
		})),
		indexes: backup.indexes.map((index) => ({
			name: index.name,
			table: index.table,
			createSql: index.createSql,
		})),
	};
}

/** The digest an exporter must publish and a restorer must recompute. */
export async function computeD1BackupDigest(backup: D1BackupWithoutDigest): Promise<string> {
	return sha256Hex(JSON.stringify(canonical(backup)));
}

/** Total rows across every table. */
export function backupRowCount(backup: Pick<D1Backup, 'tables'>): number {
	return backup.tables.reduce((total, table) => total + table.rows.length, 0);
}

function isInternalSchemaObject(name: string): boolean {
	// `sqlite_%` is SQLite's own bookkeeping; `_cf_%` is D1's. Neither
	// belongs in a user backup, and restoring either would be wrong.
	return name.startsWith('sqlite_') || name.startsWith('_cf_');
}

function assertKnownTables(
	schemaRows: { name: string; type: string }[],
	requested: readonly string[],
) {
	const available = new Set(
		schemaRows
			.filter((row) => row.type === 'table' && !isInternalSchemaObject(row.name))
			.map((row) => row.name),
	);
	for (const name of requested) {
		if (!available.has(name)) throw new D1BackupExportError('table_not_found');
	}
}

interface SchemaRow {
	type: string;
	name: string;
	tbl_name: string;
	sql: string | null;
}

/**
 * Export a D1 database (or a named subset of its tables) into a
 * self-describing, digest-protected document.
 *
 * The exported shape is deliberately SQLite-native: the exact
 * `CREATE TABLE` / `CREATE INDEX` text is retained, so a restore
 * recreates the schema SQLite recorded rather than a reconstruction
 * of it.
 */
export async function exportD1Backup(
	db: D1Database,
	options: D1ExportOptions = {},
): Promise<D1Backup> {
	let schemaRows: SchemaRow[];
	try {
		const result = await db
			.prepare(
				`SELECT type, name, tbl_name, sql
         FROM sqlite_master
         WHERE type IN ('table', 'index') AND sql IS NOT NULL
         ORDER BY type, name`,
			)
			.all<SchemaRow>();
		schemaRows = result.results ?? [];
	} catch {
		throw new D1BackupExportError('schema_read_failed');
	}

	if (options.tables) {
		assertKnownTables(schemaRows, options.tables);
	}

	const requested = options.tables ? new Set(options.tables) : null;
	const tableNames = schemaRows
		.filter(
			(row) =>
				row.type === 'table' &&
				!isInternalSchemaObject(row.name) &&
				(requested === null || requested.has(row.name)),
		)
		.map((row) => row.name)
		.sort();

	const tables: D1BackupTable[] = [];
	for (const name of tableNames) {
		const schema = schemaRows.find((row) => row.type === 'table' && row.name === name);
		if (!schema?.sql) throw new D1BackupExportError('schema_read_failed');

		let columns: string[];
		try {
			const columnResult = await db
				.prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid')
				.bind(name)
				.all<{ name: string }>();
			columns = (columnResult.results ?? []).map((row) => row.name);
		} catch {
			throw new D1BackupExportError('schema_read_failed');
		}
		if (columns.length === 0) throw new D1BackupExportError('schema_read_failed');

		let rows: D1BackupRow[];
		try {
			const rowResult = await db
				.prepare(`SELECT * FROM ${quoteIdentifier(name)}`)
				.all<Record<string, unknown>>();
			rows = (rowResult.results ?? []).map((row) =>
				columns.map((column) => encodeValue(row[column])),
			);
		} catch (error) {
			if (error instanceof D1BackupExportError) throw error;
			throw new D1BackupExportError('row_read_failed');
		}

		// Row order is not part of the database, so the backup defines
		// one. Sorting the canonical JSON makes the digest stable
		// even when SQLite returns rows in a different order.
		rows.sort((left, right) => {
			const a = JSON.stringify(left);
			const b = JSON.stringify(right);
			return a < b ? -1 : a > b ? 1 : 0;
		});

		tables.push({
			name,
			createSql: schema.sql,
			columns,
			rows,
			rowCount: rows.length,
		});
	}

	const indexes: D1BackupIndex[] = schemaRows
		.filter(
			(row) =>
				row.type === 'index' &&
				!isInternalSchemaObject(row.name) &&
				row.sql !== null &&
				(requested === null || requested.has(row.tbl_name)),
		)
		.map((row) => ({
			name: row.name,
			table: row.tbl_name,
			createSql: row.sql as string,
		}))
		.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

	const withoutDigest: D1BackupWithoutDigest = {
		format: D1_BACKUP_FORMAT,
		version: D1_BACKUP_VERSION,
		createdAt: options.createdAt ?? new Date().toISOString(),
		tables,
		indexes,
	};

	return { ...withoutDigest, digest: await computeD1BackupDigest(withoutDigest) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is D1BackupScalar {
	if (value === null || typeof value === 'string') return true;
	// `JSON.parse('1e999')` yields `Infinity`, which the exporter can
	// never produce and SQLite cannot store. Reject it here so an
	// inapplicable document fails as `invalid_backup`, not at apply.
	if (typeof value === 'number') return Number.isFinite(value);
	return isBlobValue(value) && /^[A-Za-z0-9+/]*={0,2}$/.test(value.$blob);
}

type StructuralFailure = Extract<
	D1BackupParseFailure['reason'],
	'invalid_backup' | 'row_count_mismatch' | 'row_shape_mismatch'
>;

function validateStructure(value: unknown):
	| { ok: true; backup: D1BackupWithoutDigest }
	| {
			ok: false;
			reason: StructuralFailure;
	  } {
	if (!isRecord(value)) return { ok: false, reason: 'invalid_backup' };
	if (value.format !== D1_BACKUP_FORMAT || value.version !== D1_BACKUP_VERSION) {
		return { ok: false, reason: 'invalid_backup' };
	}
	if (typeof value.createdAt !== 'string' || !Array.isArray(value.tables)) {
		return { ok: false, reason: 'invalid_backup' };
	}
	if (!Array.isArray(value.indexes)) return { ok: false, reason: 'invalid_backup' };

	const tableNames = new Set<string>();
	const tables: D1BackupTable[] = [];
	for (const rawTable of value.tables) {
		if (!isRecord(rawTable)) return { ok: false, reason: 'invalid_backup' };
		const name = rawTable.name;
		if (!isBareIdentifier(name) || tableNames.has(name.toLowerCase())) {
			return { ok: false, reason: 'invalid_backup' };
		}
		tableNames.add(name.toLowerCase());

		const createSql = rawTable.createSql;
		if (
			typeof createSql !== 'string' ||
			!/^\s*CREATE\s+TABLE\b/i.test(createSql) ||
			!Array.isArray(rawTable.columns) ||
			!Array.isArray(rawTable.rows)
		) {
			return { ok: false, reason: 'invalid_backup' };
		}

		const columnNames = new Set<string>();
		for (const column of rawTable.columns) {
			if (!isBareIdentifier(column) || columnNames.has(column.toLowerCase())) {
				return { ok: false, reason: 'invalid_backup' };
			}
			columnNames.add(column.toLowerCase());
		}
		if (columnNames.size === 0) return { ok: false, reason: 'invalid_backup' };

		if (
			typeof rawTable.rowCount !== 'number' ||
			!Number.isInteger(rawTable.rowCount) ||
			rawTable.rowCount < 0
		) {
			return { ok: false, reason: 'invalid_backup' };
		}
		if (rawTable.rowCount !== rawTable.rows.length) {
			return { ok: false, reason: 'row_count_mismatch' };
		}

		const rows: D1BackupRow[] = [];
		for (const rawRow of rawTable.rows) {
			if (!Array.isArray(rawRow) || rawRow.length !== columnNames.size) {
				return { ok: false, reason: 'row_shape_mismatch' };
			}
			if (!rawRow.every(isScalar)) return { ok: false, reason: 'invalid_backup' };
			rows.push(rawRow as D1BackupRow);
		}

		tables.push({
			name,
			createSql,
			columns: rawTable.columns as string[],
			rows,
			rowCount: rawTable.rowCount,
		});
	}

	const indexNames = new Set<string>();
	const indexes: D1BackupIndex[] = [];
	for (const rawIndex of value.indexes) {
		if (!isRecord(rawIndex)) return { ok: false, reason: 'invalid_backup' };
		const name = rawIndex.name;
		const table = rawIndex.table;
		const createSql = rawIndex.createSql;
		if (
			!isBareIdentifier(name) ||
			indexNames.has(name.toLowerCase()) ||
			!isBareIdentifier(table) ||
			!tableNames.has(table.toLowerCase()) ||
			typeof createSql !== 'string' ||
			!/^\s*CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(createSql)
		) {
			return { ok: false, reason: 'invalid_backup' };
		}
		indexNames.add(name.toLowerCase());
		indexes.push({ name, table, createSql });
	}

	return {
		ok: true,
		backup: {
			format: D1_BACKUP_FORMAT,
			version: D1_BACKUP_VERSION,
			createdAt: value.createdAt,
			tables,
			indexes,
		},
	};
}

/**
 * Parse and verify a backup document.
 *
 * The order is deliberate: syntax, then structure, then counts, then
 * the digest. Every failure is a refusal, and a caller that refuses
 * has not touched the database.
 */
export async function parseD1Backup(input: string | unknown): Promise<D1BackupParseResult> {
	let value: unknown;
	if (typeof input === 'string') {
		try {
			value = JSON.parse(input);
		} catch {
			return { ok: false, reason: 'unreadable_backup' };
		}
	} else {
		value = input;
	}

	const structural = validateStructure(value);
	if (!structural.ok) return structural;

	const raw = value as Record<string, unknown>;
	if (typeof raw.digest !== 'string' || !/^[0-9a-f]{64}$/.test(raw.digest)) {
		return { ok: false, reason: 'invalid_backup' };
	}
	const digest = await computeD1BackupDigest(structural.backup);
	if (digest !== raw.digest) return { ok: false, reason: 'digest_mismatch' };

	return { ok: true, backup: { ...structural.backup, digest: raw.digest } };
}

function sameCanonicalContent(backup: D1Backup, readback: D1Backup): boolean {
	return JSON.stringify(canonical(backup)) === JSON.stringify(canonical(readback));
}

function failed(
	verdict: D1RestoreVerdict,
	reason: D1RestoreReason,
	checks: D1RestoreCheck[],
	tables = 0,
	rows = 0,
): D1RestoreResult {
	return { verdict, reason, applied: false, tables, rows, checks };
}

/**
 * Restore a backup into `db`.
 *
 * Order (each step short-circuits):
 *
 *   1. parse the document                  → `refused` / `unreadable_backup`
 *   2. validate structure and counts       → `refused` / `invalid_backup` …
 *   3. verify the digest                   → `refused` / `digest_mismatch`
 *   4. one `batch()`: drop, create, insert → `failed` / `apply_failed`
 *   5. export again and compare            → `failed` / `readback_mismatch`
 *
 * Steps 1-3 never issue a statement. Step 4 is a single D1 batch,
 * which D1 executes as one transaction: an insert that violates a
 * constraint rolls the whole batch back, so a failed apply leaves the
 * target exactly as it was.
 */
export async function restoreD1Database(
	db: D1Database,
	input: string | unknown,
): Promise<D1RestoreResult> {
	const checks: D1RestoreCheck[] = [];

	// 1-3. Parse, validate, and verify before touching D1.
	const parsed = await parseD1Backup(input);
	if (!parsed.ok) {
		return failed(D1_RESTORE_VERDICT.refused, parsed.reason, checks);
	}
	checks.push('parse', 'validate');
	const backup = parsed.backup;
	const tableCount = backup.tables.length;
	const rowCount = backupRowCount(backup);

	// 4. One transaction. `defer_foreign_keys` keeps the drop/create
	// order from mattering inside the batch, which is important when
	// one restored table references another.
	const statements: D1PreparedStatement[] = [db.prepare('PRAGMA defer_foreign_keys = ON')];
	for (const table of [...backup.tables].reverse()) {
		statements.push(db.prepare(`DROP TABLE IF EXISTS ${quoteIdentifier(table.name)}`));
	}
	for (const table of backup.tables) {
		statements.push(db.prepare(table.createSql));
	}
	for (const index of backup.indexes) {
		statements.push(db.prepare(index.createSql));
	}
	for (const table of backup.tables) {
		const columns = table.columns.map(quoteIdentifier).join(', ');
		const placeholders = table.columns.map(() => '?').join(', ');
		const sql = `INSERT INTO ${quoteIdentifier(table.name)} (${columns}) VALUES (${placeholders})`;
		for (const row of table.rows) {
			statements.push(db.prepare(sql).bind(...row.map(decodeValue)));
		}
	}
	try {
		await db.batch(statements);
	} catch {
		return failed(D1_RESTORE_VERDICT.failed, 'apply_failed', checks, tableCount, rowCount);
	}
	checks.push('apply');

	// 5. Read back. A committed batch is not the claim; matching
	// schema and rows are.
	let readback: D1Backup;
	try {
		readback = await exportD1Backup(db, {
			tables: backup.tables.map((table) => table.name),
			createdAt: backup.createdAt,
		});
	} catch {
		return failed(D1_RESTORE_VERDICT.failed, 'readback_mismatch', checks, tableCount, rowCount);
	}
	checks.push('readback');
	if (!sameCanonicalContent(backup, readback)) {
		return failed(D1_RESTORE_VERDICT.failed, 'readback_mismatch', checks, tableCount, rowCount);
	}

	return {
		verdict: D1_RESTORE_VERDICT.restored,
		reason: '-',
		applied: true,
		tables: tableCount,
		rows: rowCount,
		checks,
	};
}

/** Exit code for one outcome. A refusal is bad input (2); a broken apply is 1. */
export function restoreExitCodeFor(result: D1RestoreResult): 0 | 1 | 2 {
	if (result.verdict === D1_RESTORE_VERDICT.restored) return 0;
	return result.verdict === D1_RESTORE_VERDICT.refused ? 2 : 1;
}

/**
 * Render the status-only report for one run.
 *
 * Every line is a verdict, a reason code, a count or the checks that
 * ran. No table name, no column name, no row value, no database id,
 * no credential.
 */
export function formatD1RestoreReport(result: D1RestoreResult, meta: { target: string }): string {
	const lines = [
		`[d1-restore] target=${meta.target}`,
		`[d1-restore] verdict=${result.verdict}`,
		`[d1-restore] reason=${result.reason}`,
		`[d1-restore] exit=${restoreExitCodeFor(result)}`,
		`[d1-restore] tables=${result.tables} rows=${result.rows}`,
		`[d1-restore] checks=${result.checks.length > 0 ? result.checks.join('>') : 'none'}`,
		'[d1-restore] printed=verdict,reason-codes,counts only (no table name, no row value, no database id, no credential)',
	];
	return `${lines.join('\n')}\n`;
}
