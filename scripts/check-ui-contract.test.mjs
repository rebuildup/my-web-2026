import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * UI composition-contract gate tests (Issue #1107, ADR-0022).
 *
 * The gate is AST-based over the scan root; policy data is
 * quality/ui-contract.json (fixture variant:
 * scripts/fixtures/ui-contract/contract.json). These tests pin:
 *
 *  - the real contract file is well-formed and declares C-1…C-8;
 *  - the gate is green on the current tree (legacy debt lives in
 *    signature allowlists, which the gate keeps honest by failing on
 *    stale entries);
 *  - every clause detects a planted violation and accepts clean code;
 *  - allowlist entries waive EXACTLY their recorded signatures: a new
 *    violation in an allowlisted file fails, a shrunken debt fails as
 *    stale until the entry shrinks.
 */

const SCRIPT = 'scripts/check-ui-contract.mjs';
const REAL_CONTRACT = 'quality/ui-contract.json';
const FIXTURE_CONTRACT = 'scripts/fixtures/ui-contract/contract.json';
const VIOLATING = 'scripts/fixtures/ui-contract/cases/violating';
const CLEAN = 'scripts/fixtures/ui-contract/cases/clean';

function runGate(args) {
	return spawnSync('node', [SCRIPT, ...args], {
		encoding: 'utf8',
		timeout: 120_000,
	});
}

function runJson(args) {
	const r = runGate([...args, '--json']);
	assert.equal(r.status !== null, true, `gate did not exit: ${r.error}`);
	return { status: r.status, data: JSON.parse(r.stdout) };
}

describe('check-ui-contract', () => {
	it('real contract JSON is well-formed and declares all clauses', () => {
		const contract = JSON.parse(readFileSync(REAL_CONTRACT, 'utf8'));
		for (const clause of ['C-1', 'C-2', 'C-3', 'C-4', 'C-5', 'C-6', 'C-7', 'C-8']) {
			assert.ok(contract.clauses[clause], `missing clause ${clause}`);
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
		const r = runGate([]);
		assert.equal(r.status, 0, r.stdout + r.stderr);
	});

	it('detects every clause C-1…C-8 on the violating fixture', () => {
		const { status, data } = runJson(['--root', VIOLATING, '--contract', FIXTURE_CONTRACT]);
		assert.equal(status, 1);
		const clauses = new Set(data.violations.map((v) => v.clause));
		for (const c of ['C-1', 'C-2', 'C-3', 'C-4', 'C-5', 'C-6', 'C-8']) {
			assert.ok(clauses.has(c), `clause ${c} not detected`);
		}
		assert.ok(data.c7.length >= 1, 'C-7 duplicate literal group not detected');
	});

	it('passes the clean fixture', () => {
		const r = runGate(['--root', CLEAN, '--contract', FIXTURE_CONTRACT]);
		assert.equal(r.status, 0, r.stdout + r.stderr);
	});

	it('allowlist waives exactly the recorded signatures', () => {
		// 1. scan the violating fixture and build an allowlist that
		//    mirrors every violation signature.
		const first = runJson(['--root', VIOLATING, '--contract', FIXTURE_CONTRACT]);
		const LIST = {
			'C-1': 'sectionAllowlist',
			'C-2': 'colorAllowlist',
			'C-3': 'sectionAllowlist',
			'C-4': 'gridAllowlist',
			'C-5': 'listAllowlist',
			'C-6': 'controlAllowlist',
			'C-8': 'enumerationAllowlist',
		};
		const contract = JSON.parse(readFileSync(FIXTURE_CONTRACT, 'utf8'));
		const groups = new Map();
		for (const v of first.data.violations) {
			const ln = LIST[v.clause];
			const key = `${ln}${v.file}`;
			if (!groups.has(key)) groups.set(key, { ln, file: v.file, sig: new Map() });
			const g = groups.get(key);
			g.sig.set(v.detail, (g.sig.get(v.detail) ?? 0) + 1);
		}
		for (const g of groups.values()) {
			contract[g.ln].push({
				path: g.file,
				clause: 'fixture',
				reason: 'fixture waiver',
				signatures: Object.fromEntries(g.sig),
			});
		}
		// C-7 duplicateAllowlist for the shared literal file set
		for (const d of first.data.c7) {
			contract.duplicateAllowlist.push({ files: d.files, reason: 'fixture waiver' });
		}
		const dir = mkdtempSync(join(tmpdir(), 'uic-'));
		const contractPath = join(dir, 'contract.json');
		writeFileSync(contractPath, JSON.stringify(contract));

		// 2. mirrored allowlist -> gate green
		const second = runGate(['--root', VIOLATING, '--contract', contractPath]);
		assert.equal(second.status, 0, second.stdout + second.stderr);

		// 3. remove one signature -> that violation is live again
		const narrowed = JSON.parse(JSON.stringify(contract));
		const entry = narrowed.sectionAllowlist.find((e) => e.path.includes('page.tsx'));
		const dropped = Object.keys(entry.signatures)[0];
		delete entry.signatures[dropped];
		const narrowedPath = join(dir, 'contract-narrowed.json');
		writeFileSync(narrowedPath, JSON.stringify(narrowed));
		const third = runJson(['--root', VIOLATING, '--contract', narrowedPath]);
		assert.equal(third.status, 1);
		assert.ok(
			third.data.violations.some((v) => v.detail === dropped),
			`expected live violation for dropped signature ${dropped}`,
		);

		// 4. bogus extra signature -> stale entry fails
		const bloated = JSON.parse(JSON.stringify(contract));
		const bloatedEntry = bloated.sectionAllowlist.find((e) => e.path.includes('page.tsx'));
		bloatedEntry.signatures['never: happens'] = 1;
		const bloatedPath = join(dir, 'contract-bloated.json');
		writeFileSync(bloatedPath, JSON.stringify(bloated));
		const fourth = runJson(['--root', VIOLATING, '--contract', bloatedPath]);
		assert.equal(fourth.status, 1);
		assert.ok(
			fourth.data.stale.some(
				(s) => s.includes('never: happens') || s.includes('no live violation'),
			),
			'expected stale-signature failure',
		);
	});
});
