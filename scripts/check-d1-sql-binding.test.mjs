import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	findInterpolatedSqlStatements,
	interpolationsIn,
	readCallArgument,
	unusedAllowlistEntries,
} from './check-d1-sql-binding.mjs';

/**
 * Fixture coverage for the D1 statement-shape gate (Issue #452).
 *
 * The gate is only worth running if it fails when it should. The
 * fixture below plants one violation of each shape the gate claims to
 * catch and asserts which files it reports; the dead-allowlist cases
 * pin the rule that an exemption nobody reaches must fail; the final
 * case runs the gate against the real repository so a regression in
 * the scanner cannot turn it into a silent no-op.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function stage(files) {
	const root = mkdtempSync(join(tmpdir(), 'check-d1-sql-binding-'));
	for (const [relativePath, contents] of Object.entries(files)) {
		const full = join(root, relativePath);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, contents);
	}
	return root;
}

/**
 * The batched `IN (…)` reads `src/portfolio/load.ts` issues for a
 * whole page of project ids (Issue #491). The placeholder chain is
 * allowlisted structure, so a fixture tree that stages that file has
 * to stage the statements too — otherwise the reachability guard
 * reports the real entries as dead configuration.
 */
const BATCHED_DECLS = [
	'const linkPlaceholders = chunk.map((_, i) => `?${i + 1}`).join(", ");',
	'const mediaPlaceholders = chunk.map((_, i) => `?${i + 1}`).join(", ");',
];

// The statements must reach `prepare()` INLINE: a template assigned to a
// variable first is out of the scanner's scope by design, which is exactly
// the case the gate is supposed to report as dead configuration.
const BATCHED_STATEMENTS = [
	'return db.prepare(`SELECT * FROM portfolio_link WHERE project_id IN (${linkPlaceholders})`).bind(...chunk).all();',
	'return db.prepare(`SELECT * FROM portfolio_media WHERE project_id IN (${mediaPlaceholders})`).bind(...chunk).all();',
];

const BATCHED_LINES = [...BATCHED_DECLS, ...BATCHED_STATEMENTS];

describe('check-d1-sql-binding — argument reader', () => {
	it('keeps parentheses that belong to the argument', () => {
		const source = "db.prepare('SELECT * FROM t WHERE a = ?1 AND b IN (SELECT 1)').run()";
		const { text } = readCallArgument(source, source.indexOf('('));
		assert.equal(text, "'SELECT * FROM t WHERE a = ?1 AND b IN (SELECT 1)'");
	});

	it('keeps a `)` that lives inside a string literal', () => {
		const source = "db.prepare(`SELECT ')' AS x`).run()";
		const { text } = readCallArgument(source, source.indexOf('('));
		assert.equal(text, "`SELECT ')' AS x`");
	});

	it('reports the template expressions and ignores `${` inside a quoted string', () => {
		assert.deepEqual(interpolationsIn('`a = ${col} AND b = ${value}`'), ['col', 'value']);
		assert.deepEqual(interpolationsIn("'literal ${ not an interpolation'"), []);
		assert.deepEqual(interpolationsIn('SELECT 1'), []);
	});
});

describe('check-d1-sql-binding — documented scanner limits', () => {
	it('does not see concatenation inside a call argument', () => {
		// Documented blind spot, not an accident: only backtick templates are
		// inspected. See the "Scanner limits" section of the gate docstring.
		const root = stage({
			'src/bad/concat.ts': "db.prepare('SELECT * FROM t WHERE k = ' + key).all();\n",
		});
		try {
			assert.deepEqual(findInterpolatedSqlStatements({ root }), []);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('check-d1-sql-binding — fixture tree', () => {
	it('reports interpolated statements and ignores compliant ones', () => {
		const root = stage({
			// Violation: a value spliced into the statement text.
			'src/bad/filter.ts': [
				'export function find(db, slug) {',
				"\treturn db.prepare(`SELECT id FROM project WHERE slug = '${slug}'`).all();",
				'}',
			].join('\n'),
			// Violation via `exec`, which the gate must cover too.
			'src/bad/exec.ts': "db.exec(`DELETE FROM t WHERE k = '${key}'`);\n",
			// Violation via `batch`, the third SQL_CALL and the one whose
			// argument is an array of statements.
			'src/bad/batch.ts': [
				'export function wipe(db, table) {',
				'\treturn db.batch([`DELETE FROM ${table} WHERE k = ?1`]).run();',
				'}',
			].join('\n'),
			// Compliant: bound parameters.
			'src/good/filter.ts':
				"db.prepare('SELECT id FROM project WHERE slug = ?1').bind(slug).all();\n",
			// Compliant: structure chosen from two literals.
			'src/good/toggle.ts': [
				"const sql = flag ? 'SELECT a FROM t' : 'SELECT b FROM t';",
				'return db.prepare(sql).all();',
			].join('\n'),
			// Allowlisted: structure-only interpolation, exactly the shape
			// `src/portfolio/load.ts` uses for its cursor predicate — the
			// statement reaches `prepare()` inline, so the allowlist is live.
			'src/portfolio/load.ts': [
				'const cursorPredicate = cursor ? ` AND id > ${value}` : "";',
				'return db.prepare(`SELECT * FROM portfolio_project${cursorPredicate}`).bind(value).all();',
				...BATCHED_LINES,
			].join('\n'),
			// Skipped: fixture setup in a test file is not a shipped statement.
			'src/bad/filter.test.ts': 'db.prepare(`DELETE FROM ${table}`).run();\n',
		});
		try {
			const violations = findInterpolatedSqlStatements({ root });
			assert.deepEqual(
				violations.map((violation) => violation.file),
				['src/bad/batch.ts', 'src/bad/exec.ts', 'src/bad/filter.ts'],
			);
			assert.equal(violations[0].method, 'batch');
			assert.equal(violations[0].expression, 'table');
			assert.equal(violations[1].method, 'exec');
			assert.equal(violations[2].method, 'prepare');
			assert.equal(violations[2].expression, 'slug');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('reports an allowlist entry the scan never reached', () => {
		// The dead-configuration guard: if `src/portfolio/load.ts` stops
		// passing its statement inline, the entry exempts nothing and the
		// gate must say so instead of passing silently.
		const root = stage({
			'src/good/filter.ts': "db.prepare('SELECT 1').all();\n",
			'src/portfolio/load.ts': [
				'const cursorPredicate = cursor ? ` AND id > ${value}` : "";',
				'const sql = `SELECT * FROM portfolio_project${cursorPredicate}`;',
				'return db.prepare(sql).bind(value).all();',
				...BATCHED_LINES,
			].join('\n'),
		});
		try {
			const unused = unusedAllowlistEntries({ root });
			assert.deepEqual(
				unused.map((entry) => `${entry.file} / ${entry.identifier}`),
				['src/portfolio/load.ts / cursorPredicate'],
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('reports no unused entry when the allowlisted statement is inline', () => {
		const root = stage({
			'src/portfolio/load.ts': [
				'const cursorPredicate = cursor ? ` AND id > ${value}` : "";',
				'return db.prepare(`SELECT * FROM portfolio_project${cursorPredicate}`).bind(value).all();',
				...BATCHED_LINES,
			].join('\n'),
		});
		try {
			assert.deepEqual(unusedAllowlistEntries({ root }), []);
			assert.deepEqual(findInterpolatedSqlStatements({ root }), []);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('is clean for an empty src tree', () => {
		const root = stage({ 'src/a.ts': 'export const x = 1;\n' });
		try {
			assert.deepEqual(findInterpolatedSqlStatements({ root }), []);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('check-d1-sql-binding — this repository', () => {
	it('every D1 statement in src/ binds its values', () => {
		const violations = findInterpolatedSqlStatements({ root: REPO_ROOT });
		assert.deepEqual(
			violations.map((violation) => violation.snippet),
			[],
			'interpolated D1 statements found — bind them, or justify the structure in the allowlist',
		);
	});

	it('every SQL_STRUCTURE_ALLOWLIST entry is reached by a real statement', () => {
		assert.deepEqual(
			unusedAllowlistEntries({ root: REPO_ROOT }).map(
				(entry) => `${entry.file} / ${entry.identifier}`,
			),
			[],
			'dead allowlist entry — delete it, or pass the statement to prepare() inline',
		);
	});
});
