import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	buildRunRecord,
	inventoryArtefacts,
	planRuns,
	runCommand,
} from './record-release-quality-runs.mjs';
import { loadRoster } from './release-quality-dashboard.mjs';

/**
 * Fixture coverage for the run-record producer (Issue #493).
 *
 * The record is the only thing that may turn a NOT RUN row into PASS, so
 * the policy that decides *which* commands this script is willing to run
 * is pinned here: a signal that needs a build, the network, a browser or
 * a Worker is recorded as skipped rather than executed by default. That
 * is the difference between "not measured" and "measured", and getting
 * it wrong would make the dashboard claim coverage nobody produced.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SIGNALS = [
	{ id: 'offline-gate', state: 'implemented', command: 'pnpm run x', requirements: [] },
	{ id: 'network-gate', state: 'implemented', command: 'pnpm run y', requirements: ['network'] },
	{
		id: 'build-gate',
		state: 'implemented',
		command: 'pnpm run z',
		requirements: ['build', 'browser'],
	},
	{ id: 'planned-family', state: 'planned', family: 'a11y', command: null, requirements: [] },
];

describe('planRuns', () => {
	it('runs only the requirement-free signals by default', () => {
		const plan = planRuns({ signals: SIGNALS });
		assert.deepEqual(
			plan.map((entry) => entry.id),
			['offline-gate', 'network-gate', 'build-gate'],
		);
		assert.equal(plan[0].skipped, undefined);
	});

	it('records unmet requirements as a skip instead of running them', () => {
		const plan = planRuns({ signals: SIGNALS });
		const network = plan.find((entry) => entry.id === 'network-gate');
		assert.equal(network.skipped, true);
		assert.match(network.reason, /requires network/);

		const build = plan.find((entry) => entry.id === 'build-gate');
		assert.match(build.reason, /requires build \+ browser/);
	});

	it('runs a requirement-bearing signal only when the requirement is allowed', () => {
		const plan = planRuns({ signals: SIGNALS, allowed: ['network'] });
		assert.equal(plan.find((entry) => entry.id === 'network-gate').skipped, undefined);
		assert.equal(plan.find((entry) => entry.id === 'build-gate').skipped, true);
	});

	it('never plans a planned (unimplemented) family', () => {
		const plan = planRuns({ signals: SIGNALS, allowed: ['network', 'build', 'browser'] });
		assert.ok(!plan.some((entry) => entry.id === 'planned-family'));
	});

	it('honours --only and --skip', () => {
		assert.deepEqual(
			planRuns({ signals: SIGNALS, only: ['network-gate'] }).map((entry) => entry.id),
			['network-gate'],
		);
		assert.deepEqual(
			planRuns({ signals: SIGNALS, skip: ['offline-gate'] })
				.map((entry) => entry.id)
				.filter((id) => id !== 'network-gate' && id !== 'build-gate'),
			[],
		);
	});
});

describe('runCommand', () => {
	it('records exit code 0 for a succeeding command and its duration', () => {
		const result = runCommand({ command: 'exit 0', cwd: REPO_ROOT, env: process.env });
		assert.equal(result.exitCode, 0);
		assert.ok(Number.isInteger(result.durationMs) && result.durationMs >= 0);
	});

	it('records the failing exit code instead of throwing', () => {
		const result = runCommand({ command: 'exit 3', cwd: REPO_ROOT, env: process.env });
		assert.equal(result.exitCode, 3);
	});

	it('does not return the command output in the record', () => {
		const result = runCommand({
			command: 'printf a-secret-looking-value',
			cwd: REPO_ROOT,
			env: process.env,
		});
		assert.deepEqual(Object.keys(result).sort(), ['durationMs', 'exitCode']);
	});
});

describe('inventoryArtefacts', () => {
	it('lists only the artefacts that exist, with their size', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dashboard-artefacts-'));
		try {
			writeFileSync(join(dir, 'report.html'), '<!doctype html>');
			const artefacts = inventoryArtefacts({
				paths: ['report.html', 'missing.html'],
				cwd: dir,
			});
			assert.deepEqual(artefacts, [{ path: 'report.html', bytes: 15 }]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('buildRunRecord', () => {
	it('writes a record whose fields are only status-level facts', () => {
		const record = buildRunRecord({
			sourceSha: 'abc123def456',
			capturedAt: '2026-10-19T00:00:00.000Z',
			environment: { runner: 'local', node: process.version },
			runs: [
				{ id: 'b', exit_code: 0, duration_ms: 10, artifacts: [] },
				{ id: 'a', exit_code: 1, duration_ms: 20, artifacts: [] },
			],
			skipped: [{ id: 'c', skipped: true, reason: 'requires network' }],
		});
		assert.deepEqual(
			record.runs.map((entry) => entry.id),
			['a', 'b', 'c'],
		);
		assert.equal(record.version, 1);
		assert.equal(record.source_sha, 'abc123def456');
		const serialised = JSON.stringify(record);
		assert.ok(
			!/stdout|stderr|output/i.test(serialised),
			'the record must not carry command output',
		);
	});
});

describe('the real roster', () => {
	it('loads and validates against the committed manifest', () => {
		const { errors } = loadRoster({ root: REPO_ROOT });
		assert.deepEqual(errors, []);
	});

	it('plans at least one signal without executing anything here', () => {
		const { roster } = loadRoster({ root: REPO_ROOT });
		const plan = planRuns({ signals: roster.signals });
		const runnable = plan.filter((entry) => !entry.skipped);
		assert.ok(runnable.length >= 5, `only ${runnable.length} runnable signals declared`);
		for (const entry of plan) {
			assert.ok(entry.id && entry.command, `${entry.id} must name the command it decides about`);
			assert.ok(
				!/stdout|stderr|output|exit_code/i.test(JSON.stringify(entry)),
				`${entry.id} must be planned without any command output`,
			);
			if (entry.skipped) assert.match(entry.reason, /requires /);
		}
	});
});
