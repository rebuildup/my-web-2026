#!/usr/bin/env node
/**
 * Tests for the knip diff gate (Issue #531).
 *
 * The fixture proves the gate fails on a newly added unused dependency:
 * a synthetic project (in .tmp, gitignored) declares a dependency that
 * no source file imports and exports a symbol nobody consumes. Running
 * `scripts/check-knip.mjs --root <fixture>` must exit non-zero and name
 * both findings.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const SCRIPT = new URL('./check-knip.mjs', import.meta.url).pathname;

function makeFixture() {
	const root = mkdtempSync(join(tmpdir(), 'knip-fixture-'));
	const src = join(root, 'src');
	mkdirSync(src, { recursive: true });
	writeFileSync(
		join(root, 'package.json'),
		JSON.stringify(
			{
				name: 'knip-fixture',
				private: true,
				type: 'module',
				scripts: { build: 'node src/index.js' },
				dependencies: { 'totally-unused-dep': '^1.0.0' },
			},
			null,
			2,
		),
	);
	writeFileSync(join(src, 'index.js'), "import { used } from './lib.js';\nexport default used;\n");
	writeFileSync(join(src, 'lib.js'), "export const used = 'used';\nexport const dead = 'dead';\n");
	writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
	return root;
}

test('knip gate fails on a fixture with an unused dependency and unused export', () => {
	const fixture = makeFixture();
	try {
		const result = spawnSync(process.execPath, [SCRIPT, '--root', fixture], {
			encoding: 'utf8',
		});
		assert.equal(result.status, 1, `expected exit 1, stderr: ${result.stderr}`);
		assert.match(result.stderr, /dependencies \/ exports \/ files/);
		assert.match(result.stderr, /dependencies package\.json totally-unused-dep/);
		assert.match(result.stderr, /exports src\/lib\.js dead/);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

test('knip gate passes on a fixture without findings', () => {
	const fixture = makeFixture();
	// Make the dependency real: import it, use every export.
	writeFileSync(
		join(fixture, 'src', 'index.js'),
		"import { used, dead } from './lib.js';\nimport noop from 'totally-unused-dep';\nexport default [used, dead, typeof noop];\n",
	);
	try {
		const result = spawnSync(process.execPath, [SCRIPT, '--root', fixture], {
			encoding: 'utf8',
		});
		assert.equal(result.status, 0, `expected exit 0, stderr: ${result.stderr}`);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});
