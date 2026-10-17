import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	interpolationsIn,
	readCallArgument,
	findInterpolatedSqlStatements,
} from './check-d1-sql-binding.mjs';

/**
 * Fixture coverage for the D1 statement-shape gate (Issue #452).
 *
 * The gate is only worth running if it fails when it should. The
 * fixture below plants one violation of each shape the gate claims to
 * catch and asserts which files it reports; the final case runs the
 * gate against the real repository so a regression in the scanner
 * cannot turn it into a silent no-op.
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
			// Compliant: bound parameters.
			'src/good/filter.ts':
				"db.prepare('SELECT id FROM project WHERE slug = ?1').bind(slug).all();\n",
			// Compliant: structure chosen from two literals.
			'src/good/toggle.ts': [
				"const sql = flag ? 'SELECT a FROM t' : 'SELECT b FROM t';",
				'return db.prepare(sql).all();',
			].join('\n'),
			// Allowlisted: structure-only interpolation, exactly the shape
			// `src/portfolio/load.ts` uses for its cursor predicate.
			'src/portfolio/load.ts': [
				'const cursorPredicate = cursor ? ` AND id > ${value}` : "";',
				'return db.prepare(`SELECT * FROM portfolio_project${cursorPredicate}`).bind(value).all();',
			].join('\n'),
			// Skipped: fixture setup in a test file is not a shipped statement.
			'src/bad/filter.test.ts': 'db.prepare(`DELETE FROM ${table}`).run();\n',
		});
		try {
			const violations = findInterpolatedSqlStatements({ root });
			assert.deepEqual(
				violations.map((violation) => violation.file),
				['src/bad/exec.ts', 'src/bad/filter.ts'],
			);
			assert.equal(violations[0].method, 'exec');
			assert.equal(violations[1].method, 'prepare');
			assert.equal(violations[1].expression, 'slug');
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
});
