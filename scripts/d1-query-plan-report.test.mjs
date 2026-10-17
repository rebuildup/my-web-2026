/**
 * `scripts/d1-query-plan-report.mjs` (Issue #491).
 *
 * The renderer is the only piece between the workerd measurement
 * (`src/portfolio/load.query-budget.test.ts`) and the committed
 * screenshot. It must therefore fail LOUDLY on missing or malformed
 * input: a report that silently renders an empty table would make
 * "no N+1 detected" indistinguishable from "nothing ran".
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'd1-query-plan-report.mjs');
const PREFIX = 'D1_QUERY_PLAN_V1 ';

const SERIES = {
	kind: 'series',
	issue: 491,
	workload: 'portfolio list page (/portfolio), public+published rows only',
	schemaSource: 'migrations/0007_portfolio.sql',
	d1Target: 'local miniflare SQLite binding',
	chunkSize: 100,
	detailBudget: 3,
	linksPerProject: 3,
	mediaPerProject: 2,
	rows: [
		{
			pageSize: 1,
			projects: 1,
			statements: 3,
			budget: 3,
			legacyStatements: 3,
			elapsedMs: 1,
		},
		{
			pageSize: 500,
			projects: 500,
			statements: 11,
			budget: 11,
			legacyStatements: 1001,
			elapsedMs: 42,
		},
	],
	detail: [{ projectId: 'x', statements: 3 }],
	plans: { links: ['SEARCH portfolio_link USING INDEX idx_portfolio_link_project (project_id=?)'] },
	statements: { links: 'SELECT * FROM portfolio_link WHERE project_id IN (?1, ?2)' },
};

function run(args, input) {
	return spawnSync(process.execPath, [SCRIPT, ...args], {
		encoding: 'utf8',
		input,
	});
}

describe('d1-query-plan-report', () => {
	it('renders the measured numbers into a self-contained HTML report', () => {
		const result = run([], `${PREFIX}${JSON.stringify(SERIES)}\n`);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /<!doctype html>/i);
		// before / after are both present, with the real figures.
		assert.match(result.stdout, /1001/);
		assert.match(result.stdout, />11</);
		assert.match(result.stdout, /idx_portfolio_link_project/);
		assert.match(result.stdout, /PASS/);
	});

	it('tolerates a reporter prefix before the record marker', () => {
		const result = run(
			[],
			`stdout | src\/portfolio\/load.query-budget.test.ts > suite\n${PREFIX}${JSON.stringify(SERIES)}\n`,
		);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /<!doctype html>/i);
	});

	it('fails when the capture carries no measurement record', () => {
		const result = run([], 'Test Files 1 passed (1)\n');
		assert.equal(result.status, 1);
		assert.match(result.stderr, /no D1_QUERY_PLAN_V1 series record/);
	});

	it('fails when the record carries no rows', () => {
		const result = run(
			[],
			`${PREFIX}${JSON.stringify({ kind: 'series', issue: 491, rows: [] })}\n`,
		);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /no rows/);
	});

	it('fails on a truncated record rather than rendering a partial table', () => {
		const result = run([], `${PREFIX}{"kind":"series","rows":[{"pageSize":1,`);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /no D1_QUERY_PLAN_V1 series record/);
	});

	it('reports FAIL when a fixture size exceeds its budget', () => {
		const breaching = {
			...SERIES,
			rows: [{ ...SERIES.rows[0], statements: 9, budget: 3 }],
		};
		const result = run([], `${PREFIX}${JSON.stringify(breaching)}\n`);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, />FAIL</);
	});

	it('writes to --out and creates the parent directory', () => {
		const dir = mkdtempSync(join(tmpdir(), 'd1-report-'));
		try {
			const out = join(dir, 'nested', 'report.html');
			const result = run(['--out', out], `${PREFIX}${JSON.stringify(SERIES)}\n`);
			assert.equal(result.status, 0, result.stderr);
			const html = readFileSync(out, 'utf8');
			assert.match(html, /<!doctype html>/i);
			assert.equal(result.stdout, '');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('reads the capture from --input', () => {
		const dir = mkdtempSync(join(tmpdir(), 'd1-report-in-'));
		try {
			const capture = join(dir, 'vitest.log');
			const out = join(dir, 'report.html');
			writeFileSync(capture, `noise\n${PREFIX}${JSON.stringify(SERIES)}\n`);
			const result = run(['--input', capture, '--out', out]);
			assert.equal(result.status, 0, result.stderr);
			assert.match(readFileSync(out, 'utf8'), /<!doctype html>/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('rejects unknown flags with a usage error', () => {
		const result = run(['--png', 'x.png'], '');
		assert.equal(result.status, 2);
		assert.match(result.stderr, /usage: d1-query-plan-report/);
	});

	it('records host facts and the measured commit in the header', () => {
		const result = run(['--source-sha', 'abc1234'], `${PREFIX}${JSON.stringify(SERIES)}\n`);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /source abc1234/);
		assert.match(result.stdout, /node v\d+/);
	});
});
