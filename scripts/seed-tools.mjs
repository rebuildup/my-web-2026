#!/usr/bin/env node
/**
 * Seed script — Tool Registry local-D1 surface (Issue #183).
 *
 * Reads `src/tools/manifest.json` and emits SQL statements that
 * UPSERT every Tool entry into a `tool` D1 table (CREATE TABLE IF
 * NOT EXISTS first). The host's `/tools/$slug` route reads from the
 * static manifest at build time (NOT from this table) — this script
 * is for the operational surface that keeps an audit-friendly
 * registry copy in D1 so that future operational tooling (e.g.
 * admin views, drift detection) can read the same roster the host
 * serves, in local development.
 *
 * The `tool` table is intentionally NOT in `migrations/` at
 * the current release. The Tools obligation is manifest-driven;
 * this script is opt-in and only writes a row when an operator
 * runs it. The produced SQL is idempotent
 * (`CREATE TABLE IF NOT EXISTS` + `INSERT OR REPLACE`), so
 * re-running is safe.
 *
 * Usage:
 *
 *   # Default — dry-run against local D1 (prints SQL only).
 *   pnpm run seed:tools
 *
 *   # Apply against local D1.
 *   pnpm run seed:tools -- --execute
 *
 *   # Target rejection pattern (AGENTS.md §4 / Issue #183 scope):
 *   # --target=remote requires --execute AND an explicit operator
 *   # authorization in the current interaction. The script exits 2
 *   # with a status-only message when --target=remote is passed
 *   # alone — operators run remote from a workstation with
 *   # Cloudflare credentials, not from an agent session.
 *
 *   pnpm run seed:tools -- --execute --target=remote
 *
 * Exit codes:
 *   0  success (dry-run or execute)
 *   1  manifest parse failure or wrangler d1 execute failure
 *   2  argument error (--target=remote without --execute, etc.)
 *
 * Idempotency: INSERT OR REPLACE on `tool.slug`. Re-running on a
 * populated DB is a no-op for unchanged rows.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));

function parseArg(set, name) {
	for (const a of set) {
		if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
	}
	return null;
}

const dryRun = args.has('--dry-run');
const execute = args.has('--execute');
const target = parseArg(args, '--target') ?? 'local';

if (target !== 'local' && target !== 'remote') {
	console.error(`[seed-tools] --target must be 'local' or 'remote', got: ${target}`);
	process.exit(2);
}

// Reject --target=remote unless --execute is also passed. Per
// AGENTS.md §4 / Issue #183 scope, the only safe path to seed the
// remote D1 is a workstation operator run with explicit
// authorization in the current interaction. Agents MUST NOT reach
// this branch silently — the script exits 2 and prints a status-
// only message.
if (target === 'remote' && !execute) {
	console.error(
		'[seed-tools] --target=remote requires --execute; this script refuses silent remote writes.',
	);
	console.error(
		'[seed-tools] Operators with explicit authorization in the current interaction may run:',
	);
	console.error('[seed-tools]   pnpm run seed:tools -- --execute --target=remote');
	process.exit(2);
}

// ---------------------------------------------------------------------------
// Manifest load
// ---------------------------------------------------------------------------

const manifestPath = resolve(root, 'src/tools/manifest.json');
if (!existsSync(manifestPath)) {
	console.error(`[seed-tools] manifest not found: ${manifestPath}`);
	process.exit(1);
}

let manifest;
try {
	manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (err) {
	console.error(`[seed-tools] failed to parse ${manifestPath}: ${err.message}`);
	process.exit(1);
}

if (!Array.isArray(manifest.tools)) {
	console.error('[seed-tools] manifest.tools is not an array');
	process.exit(1);
}

// ---------------------------------------------------------------------------
// SQL generation
// ---------------------------------------------------------------------------

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS tool (
	slug          TEXT PRIMARY KEY,
	display_name  TEXT NOT NULL,
	description   TEXT,
	canonical_repo TEXT,
	pinned_sha    TEXT,
	delivery_kind TEXT NOT NULL,
	classification TEXT NOT NULL,
	license       TEXT,
	notes         TEXT,
	created_at    INTEGER NOT NULL,
	updated_at    INTEGER NOT NULL
);
`.trim();

const escapeSingleQuote = (s) => String(s ?? '').replace(/'/g, "''");

const statements = [];
statements.push('-- Tool Registry seed (Issue #183).');
statements.push('-- Source: src/tools/manifest.json');
statements.push('-- Idempotent: CREATE TABLE IF NOT EXISTS + INSERT OR REPLACE.');
statements.push('');
statements.push(CREATE_TABLE_SQL);
statements.push('');

const now = Date.now();
for (const tool of manifest.tools) {
	const description = (tool.description ?? tool.notes ?? '').toString();
	const license = tool.license == null ? 'NULL' : `'${escapeSingleQuote(tool.license)}'`;
	statements.push(
		`INSERT OR REPLACE INTO tool (slug, display_name, description, canonical_repo, pinned_sha, delivery_kind, classification, license, notes, created_at, updated_at) VALUES ('${escapeSingleQuote(tool.slug)}', '${escapeSingleQuote(tool.display_name ?? '')}', '${escapeSingleQuote(description)}', '${escapeSingleQuote(tool.source?.canonical_repo ?? '')}', '${escapeSingleQuote(tool.source?.pinned_sha ?? '')}', '${escapeSingleQuote(tool.delivery?.kind ?? 'host_disabled')}', '${escapeSingleQuote(tool.classification ?? 'not_integrable_yet')}', ${license}, '${escapeSingleQuote(tool.notes ?? '')}', ${now}, ${now});`,
	);
}

const fullSql = `${statements.join('\n')}\n`;

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (dryRun || !execute) {
	// Default mode: dry-run. Print the SQL so the operator can
	// review the produced statement before any execution path.
	process.stdout.write(fullSql);
	console.error(`[seed-tools] dry-run: ${manifest.tools.length} tool(s) staged, target=${target}`);
	console.error(
		'[seed-tools] pass --execute to apply; pass --execute --target=remote for the remote D1 path',
	);
	process.exit(0);
}

// Execute against the resolved target. `--local` runs the local
// simulation; `--remote` requires explicit operator authorization
// in the current interaction (asserted above).
const tmp = mkdtempSync(join(tmpdir(), 'seed-tools-'));
const sqlPath = join(tmp, 'seed.sql');
writeFileSync(sqlPath, fullSql, { mode: 0o600 });

try {
	// Issue #247: D1 goes through the repository-owned cf driver.
	// `target` is already an explicit local/remote enum here; a remote
	// write additionally requires an explicit execute.
	const cfTarget = target === 'remote' ? 'production' : 'local';
	try {
		executeSqlFile(sqlPath, { target: cfTarget, execute: process.argv.includes('--execute') });
	} catch (error) {
		console.error(`[seed-tools] D1 write failed (${cfTarget}): ${error.message}`);
		process.exit(1);
	}
	console.error(
		`[seed-tools] inserted/updated ${manifest.tools.length} tool(s) (idempotent, target=${target})`,
	);
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
