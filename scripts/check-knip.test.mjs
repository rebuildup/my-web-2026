#!/usr/bin/env node
/**
 * Tests for the knip diff gate (Issue #531).
 *
 * The fixture proves the gate fails on a newly added unused dependency:
 * a synthetic project (in an OS temp dir) declares a dependency that
 * no source file imports and exports a symbol nobody consumes. Running
 * `scripts/check-knip.mjs --root <fixture>` must exit non-zero and name
 * both findings.
 *
 * A second pair of cases drives the baseline diff itself (the production
 * path): a finding recorded in `quality/knip-baseline.json` must not fail
 * the gate, an unbaselined one must, and a baseline entry whose finding
 * disappeared must be reported as resolved rather than silently ignored.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// `URL#pathname` percent-encodes; `fileURLToPath` does not, and a checkout
// path containing a space would otherwise spawn a script that does not exist.
const SCRIPT = fileURLToPath(new URL('./check-knip.mjs', import.meta.url));

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

/** Record a baseline for a fixture, as `pnpm run knip:update` would. */
function writeBaseline(fixture, findings, ceiling = findings.length) {
	mkdirSync(join(fixture, 'quality'), { recursive: true });
	writeFileSync(
		join(fixture, 'quality', 'knip-baseline.json'),
		`${JSON.stringify(
			{
				_schema: 2,
				ceiling,
				ceiling_rationale: 'fixture baseline: the debt recorded for this fixture',
				findings,
			},
			null,
			'\t',
		)}\n`,
	);
}

test('knip gate diffs against the baseline: baselined finding passes, unbaselined one fails', () => {
	// This is the production path (Issue #531 diff-gate semantics) that the two
	// fixture tests above cannot reach: only findings missing from the baseline
	// may fail the gate, and a finding that disappeared is reported as resolved.
	const fixture = makeFixture();
	writeBaseline(fixture, ['dependencies package.json totally-unused-dep']);
	try {
		const baselined = spawnSync(process.execPath, [SCRIPT, '--root', fixture], {
			encoding: 'utf8',
		});
		assert.equal(baselined.status, 1, 'the unbaselined export must still fail');
		assert.match(baselined.stderr, /exports src\/lib\.js dead/);
		assert.doesNotMatch(baselined.stderr, /totally-unused-dep/);
		assert.match(baselined.stdout, /2 findings \(1 baselined, 1 new, ceiling 1\)/);

		// Baseline both findings: the gate is green and the baselined-only
		// finding is reported as resolved debt to clean up.
		writeBaseline(fixture, [
			'dependencies package.json totally-unused-dep',
			'exports src/lib.js dead',
		]);
		const allBaselined = spawnSync(process.execPath, [SCRIPT, '--root', fixture], {
			encoding: 'utf8',
		});
		assert.equal(allBaselined.status, 0, `expected exit 0, stderr: ${allBaselined.stderr}`);
		assert.match(allBaselined.stdout, /2 findings \(2 baselined, 0 new, ceiling 2\)/);

		// Remove the unused export without touching the baseline: the gate must
		// stay green but nag that the baseline is now stale.
		writeFileSync(join(fixture, 'src', 'lib.js'), "export const used = 'used';\n");
		const resolved = spawnSync(process.execPath, [SCRIPT, '--root', fixture], {
			encoding: 'utf8',
		});
		assert.equal(resolved.status, 0, `expected exit 0, stderr: ${resolved.stderr}`);
		assert.match(resolved.stdout, /1 findings \(2 baselined, 0 new, ceiling 2\)/);
		assert.match(resolved.stdout, /1 baselined findings no longer appear/);
		assert.match(resolved.stdout, /pnpm run knip:update/);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

test('knip gate rejects a --root or --update invocation that cannot be honoured', () => {
	const fixture = makeFixture();
	try {
		const noValue = spawnSync(process.execPath, [SCRIPT, '--root'], { encoding: 'utf8' });
		assert.equal(noValue.status, 1, '--root without a directory must fail');
		assert.match(noValue.stderr, /--root requires a directory argument/);

		const both = spawnSync(process.execPath, [SCRIPT, '--update', '--root', fixture], {
			encoding: 'utf8',
		});
		assert.equal(both.status, 1, '--update with --root must fail');
		assert.match(both.stderr, /cannot be combined with --root/);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

/**
 * Issue #733 (V-6) — the recorded debt needs a ceiling.
 *
 * The diff gate refuses *new* findings, but nothing stopped the baseline
 * itself from growing: the debt was unbounded, so the only thing the
 * gate protected was the difference, not the total.
 */
test('knip gate refuses a baseline without a ceiling', () => {
	const fixture = makeFixture();
	try {
		mkdirSync(join(fixture, 'quality'), { recursive: true });
		writeFileSync(
			join(fixture, 'quality', 'knip-baseline.json'),
			`${JSON.stringify({ _schema: 2, findings: [] }, null, '\t')}\n`,
		);
		const result = spawnSync(process.execPath, [SCRIPT, '--root', fixture], { encoding: 'utf8' });
		assert.equal(result.status, 1, `expected exit 1, stderr: ${result.stderr}`);
		assert.match(result.stderr, /no usable `ceiling`/);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

test('knip gate refuses a baseline whose recorded debt grew past its ceiling', () => {
	const fixture = makeFixture();
	try {
		writeBaseline(fixture, ['exports src/lib.js dead'], 0);
		const result = spawnSync(process.execPath, [SCRIPT, '--root', fixture], { encoding: 'utf8' });
		assert.equal(result.status, 1, `expected exit 1, stderr: ${result.stderr}`);
		assert.match(result.stderr, /more than its ceiling of 0/);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

test('knip gate refuses a baseline whose ceiling nobody can explain', () => {
	const fixture = makeFixture();
	try {
		mkdirSync(join(fixture, 'quality'), { recursive: true });
		writeFileSync(
			join(fixture, 'quality', 'knip-baseline.json'),
			`${JSON.stringify({ _schema: 2, ceiling: 5, findings: [] }, null, '\t')}\n`,
		);
		const result = spawnSync(process.execPath, [SCRIPT, '--root', fixture], { encoding: 'utf8' });
		assert.equal(result.status, 1, `expected exit 1, stderr: ${result.stderr}`);
		assert.match(result.stderr, /no `ceiling_rationale`/);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});
