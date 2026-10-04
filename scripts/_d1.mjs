/**
 * Repository-owned D1 driver for `cf` (Issue #247, D1 slice).
 *
 * Why a driver instead of putting `cf d1 ...` in package.json
 * -----------------------------------------------------------------
 * `cf` treats **remote as the default** for D1. A bare
 * `cf d1 migrations apply <ID>` with a forgotten `--local` is a
 * PRODUCTION MIGRATION. Exposing that default in a package script is
 * exactly the wrong shape: the omission is silent and the blast
 * radius is production.
 *
 * So the target is an explicit enum, and a production write needs
 * three conditions, not one:
 *
 *   1. target === 'production'
 *   2. explicit execute
 *   3. the canonical account AND database ID match this repository
 *
 * `target: 'remote'` is deliberately NOT offered. Where the only
 * remote database is production, naming it `production` states the
 * mutation scope; `remote` hides it.
 *
 * Result shape
 * ------------
 * Remote `query` returns object rows; local `raw` returns
 * `{ columns, rows }`. Callers get ONE outward contract —
 * `Array<Record<string, unknown>>` — so a beta CLI envelope change is
 * absorbed in this one file. Parsers are built against fixtures
 * captured from real CLI output, not from the documentation.
 */

import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import {
	ACCOUNT_ID,
	D1_DATABASE_ID,
	LOCAL_D1_STATE_DIR,
	MIGRATIONS_DIR,
} from './_cloudflare-identity.mjs';

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');

/** The only targets. There is no `remote`. */
export const D1_TARGETS = /** @type {const} */ (['local', 'production']);

/** Cloudflare credential needed for a remote operation. Deploy-time only. */
function cloudflareEnv(env) {
	// Deliberately narrow: the D1 child gets the Cloudflare credential
	// and nothing else. Infisical material and Worker runtime secret
	// values must not reach a D1 subprocess.
	return {
		PATH: env.PATH,
		HOME: env.HOME,
		CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
	};
}

function cf(args, { env = process.env, cwd = REPO_ROOT, timeout = 600_000 } = {}) {
	return execFileSync('pnpm', ['exec', 'cf', ...args], {
		cwd,
		encoding: 'utf8',
		env: cloudflareEnv(env),
		timeout,
		maxBuffer: 64 * 1024 * 1024,
	});
}

function parseCfJson(stdout) {
	const trimmed = String(stdout ?? '').trim();
	if (trimmed.length === 0) return null;
	// `cf` prints a leading progress/log preamble before JSON on some
	// commands; take the first balanced JSON document.
	const start = trimmed.search(/[[{]/);
	if (start === -1) return null;
	try {
		return JSON.parse(trimmed.slice(start));
	} catch {
		// The payload may have a trailing log line. Retry from the last
		// balanced closing bracket.
		const end = Math.max(trimmed.lastIndexOf(']'), trimmed.lastIndexOf('}'));
		if (end <= start) throw new Error('could not parse cf JSON output');
		return JSON.parse(trimmed.slice(start, end + 1));
	}
}

/**
 * Normalise the several real shapes `cf` emits into object rows.
 *
 * `raw` (local) -> `[{ success, results: { columns, rows } }]`
 * `query` (remote) -> `[{ success, results: [ {col: val} ] }]`
 *
 * Exported so the parser is testable against captured fixtures.
 */
export function normaliseRows(payload) {
	if (payload === null || payload === undefined) return [];
	// Unwrap the Cloudflare-style envelope if present.
	const results = Array.isArray(payload) ? payload : (payload?.result ?? payload);
	const first = Array.isArray(results) ? results[0] : results;
	if (!first) return [];

	// Shape A: raw -> { columns: [...], rows: [[...]] }
	const raw = first.results ?? first;
	if (raw && Array.isArray(raw.columns) && Array.isArray(raw.rows)) {
		return raw.rows.map((row) => {
			const obj = {};
			raw.columns.forEach((col, i) => {
				obj[col] = row[i];
			});
			return obj;
		});
	}
	// Shape B: query -> [{ col: value }]
	if (Array.isArray(raw)) return raw;
	if (raw && typeof raw === 'object') return [raw];
	return [];
}

/** Resolve + validate a target. Throws rather than defaulting to production. */
export function resolveTarget(target) {
	if (target === undefined || target === null) return 'local'; // safe default
	if (!D1_TARGETS.includes(target)) {
		throw new Error(
			`refusing D1 target ${JSON.stringify(target)}: expected one of ${D1_TARGETS.join(', ')}. There is no "remote" target; the only remote database is production and it must be named.`,
		);
	}
	return target;
}

/**
 * The lowest-level production WRITE gate (Issue #247).
 *
 * EVERY production write primitive calls this, so the gate does not
 * depend on a caller remembering one `if`. A production mutation
 * requires ALL of:
 *
 *   - target === 'production'
 *   - execute === true
 *   - the canonical account id
 *   - the canonical database id
 *
 * Identity is checked against the canonical constants — NEVER against a
 * database NAME and never against a config file path. Read paths
 * (`queryRows`, `listMigrations`) deliberately do not call this.
 */
export function assertProductionWriteAllowed({
	target,
	execute,
	kind = 'mutation',
	databaseId = D1_DATABASE_ID,
	accountId = ACCOUNT_ID,
}) {
	if (target !== 'production') return; // local is the safe default
	if (!execute) {
		throw new Error(
			`refusing a production D1 ${kind}: requires an explicit execute. cf applies by default and treats remote as the default, so an omitted flag IS a production write.`,
		);
	}
	if (databaseId !== D1_DATABASE_ID) {
		throw new Error(
			`refusing a production D1 ${kind} against database ${databaseId}: expected ${D1_DATABASE_ID}.`,
		);
	}
	if (accountId !== ACCOUNT_ID) {
		throw new Error(`refusing a production D1 ${kind} on account ${accountId}.`);
	}
}

function localArgs(databaseId) {
	return ['d1', 'raw', databaseId, '--local', '--persist-to', join(REPO_ROOT, LOCAL_D1_STATE_DIR)];
}

function remoteArgs(databaseId) {
	return ['d1', 'query', databaseId];
}

/**
 * Run a read-only query. Returns object rows.
 *
 * Local uses `cf d1 raw --local` (the supported local surface);
 * `cf d1 query --local` is not implemented in this CLI. Reading the
 * persisted SQLite file or poking the dev server's explorer endpoint
 * is NOT a canonical path for repository scripts.
 */
export function queryRows(
	sql,
	{ target = 'local', databaseId = D1_DATABASE_ID, accountId = ACCOUNT_ID, env = process.env } = {},
) {
	const resolved = resolveTarget(target);
	if (resolved === 'production') {
		// Read-only: identity is still checked, but no execute gate applies.
		if (databaseId !== D1_DATABASE_ID || accountId !== ACCOUNT_ID) {
			throw new Error('refusing a production D1 read against a non-canonical identity.');
		}
	}
	const args = resolved === 'local' ? localArgs(databaseId) : remoteArgs(databaseId);
	const stdout = cf([...args, '--sql', sql], { env });
	return normaliseRows(parseCfJson(stdout));
}

/**
 * Apply migrations.
 *
 * `cf d1 migrations apply` has **no** execute flag — it applies, and
 * D1 defaults to REMOTE. So "did the caller mean to write?" cannot be
 * expressed to the CLI. It is expressed HERE instead: a production
 * apply requires `execute: true` from the caller, and without it we
 * only list what is pending.
 *
 * Local always carries `--local --persist-to`; a missing flag would
 * otherwise mean "production".
 */
export function applyMigrations({
	target = 'local',
	execute = false,
	databaseId = D1_DATABASE_ID,
	accountId = ACCOUNT_ID,
	env = process.env,
} = {}) {
	const resolved = resolveTarget(target);
	const local = resolved === 'local';

	// Only a PRODUCTION apply needs the execute gate: a local apply is
	// the safe default. Without `--execute` on production we report
	// pending migrations and change nothing.
	if (resolved === 'production' && !execute) {
		return {
			applied: false,
			pending: parseCfJson(cf(['d1', 'migrations', 'list', databaseId], { env })),
		};
	}

	assertProductionWriteAllowed({
		target: resolved,
		execute: true,
		kind: 'migration apply',
		databaseId,
		accountId,
	});

	const args = ['d1', 'migrations', 'apply', databaseId, '--dir', MIGRATIONS_DIR];
	if (local) args.push('--local', '--persist-to', join(REPO_ROOT, LOCAL_D1_STATE_DIR));
	return { applied: true, output: parseCfJson(cf(args, { env })) };
}

/** List migrations without applying. */
export function listMigrations({
	target = 'local',
	databaseId = D1_DATABASE_ID,
	env = process.env,
} = {}) {
	const resolved = resolveTarget(target);
	const args = ['d1', 'migrations', 'list', databaseId];
	if (resolved === 'local')
		args.push('--local', '--persist-to', join(REPO_ROOT, LOCAL_D1_STATE_DIR));
	return parseCfJson(cf(args, { env }));
}

/**
 * Execute a batch of statements. Large SQL goes through `--batch @file`
 * so a multi-statement bundle never lands in argv.
 */
export function executeBatch(
	batchFile,
	{ target = 'local', databaseId = D1_DATABASE_ID, accountId = ACCOUNT_ID, env = process.env } = {},
) {
	const resolved = resolveTarget(target);
	assertProductionWriteAllowed({
		target: resolved,
		execute: true,
		kind: 'batch',
		databaseId,
		accountId,
	});
	const args =
		resolved === 'local'
			? [
					'd1',
					'raw',
					databaseId,
					'--local',
					'--persist-to',
					join(REPO_ROOT, LOCAL_D1_STATE_DIR),
					'--batch',
					`@${batchFile}`,
				]
			: ['d1', 'query', databaseId, '--batch', `@${batchFile}`];
	const stdout = cf(args, { env });
	return normaliseRows(parseCfJson(stdout));
}
