import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * UI composition-contract gate tests (Issue #1107, ADR-0022).
 *
 * The gate is AST-based over src/**; the contract data is
 * quality/ui-contract.json. These tests pin the two properties the
 * release depends on: the contract file is well-formed, and the gate
 * itself is green on the current tree (legacy debt lives in the
 * allowlists, which the gate itself keeps honest by failing on stale
 * entries).
 */

describe('check-ui-contract', () => {
	it('contract JSON is well-formed and declares all clauses', () => {
		const contract = JSON.parse(readFileSync('quality/ui-contract.json', 'utf8'));
		for (const clause of ['C-1', 'C-2', 'C-3', 'C-4', 'C-5', 'C-6', 'C-7', 'C-8']) {
			assert.ok(contract.clauses[clause], `missing clause ${clause}`);
		}
		for (const tone of contract.tones) {
			assert.equal(typeof tone, 'string');
		}
		for (const key of [
			'colorAllowlist',
			'gridAllowlist',
			'sectionAllowlist',
			'controlAllowlist',
			'listAllowlist',
			'enumerationAllowlist',
			'duplicateAllowlist',
		]) {
			assert.ok(Array.isArray(contract[key]), `missing allowlist ${key}`);
		}
	});

	it('gate exits 0 on the current tree', () => {
		const result = spawnSync('node', ['scripts/check-ui-contract.mjs'], {
			encoding: 'utf8',
			timeout: 120_000,
		});
		assert.equal(result.status, 0, result.stdout + result.stderr);
	});
});
