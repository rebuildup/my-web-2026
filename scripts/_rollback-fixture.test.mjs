import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	LEGACY_BINDING_NAME,
	RESTORE,
	RESTORE_OPERATIONS,
	SIGNAL,
	SIMULATION_SCENARIOS,
	UNKNOWN_FAILURE_SCENARIO,
	UNSATISFIABLE_RESTORE_SCENARIO,
	VERSIONED_BINDING_NAME,
	applyPatch,
	createFixtureDir,
	createFixtureState,
	describeSignals,
	readFixture,
	readOperations,
	readSignals,
	runSimulationScenario,
	writeFixture,
} from './_rollback-fixture.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Tests for the disposable local fixture (Issue #721).
 *
 * The fixture is the substrate the rollback rehearsal is exercised
 * against, so it has to be a real, file-backed state model: a scenario
 * that claims a restore has to have changed the state on disk, and a
 * restore whose documented precondition cannot be met has to fail
 * instead of quietly doing nothing.
 *
 * The safety boundary is pinned here as well: the fixture may not be
 * able to run a command, open a socket or read a credential.
 */
describe('rollback fixture — the state model', () => {
	it('starts from a known-good state with a previous successful release', () => {
		const state = createFixtureState();
		assert.equal(state.currentRelease, '0.8.0');
		assert.equal(state.deployedRelease, '0.8.0');
		assert.equal(state.mergedRelease, null);
		assert.equal(state.lifecycle, 'open');
		assert.equal(state.phaseB.flipRan, true);
		assert.equal(state.phaseB.deleteLegacyOnlyRan, false);
		assert.deepEqual(state.bindings, [LEGACY_BINDING_NAME, VERSIONED_BINDING_NAME]);
	});

	it('stores binding NAMES only', () => {
		const state = createFixtureState();
		for (const name of state.bindings) {
			assert.equal(typeof name, 'string');
			assert.ok(name.startsWith('BETTER_AUTH_'), name);
		}
	});

	it('merges a patch into the state without losing the rest', () => {
		const merged = applyPatch(createFixtureState(), { build: { status: 'failed' } });
		assert.equal(merged.build.status, 'failed');
		assert.equal(merged.currentRelease, '0.8.0');
		assert.equal(merged.bindings.length, 2);
	});

	it('derives the observable signals from the state', () => {
		const signals = readSignals(createFixtureState());
		assert.equal(signals[SIGNAL.buildFailed], false);
		assert.equal(signals[SIGNAL.deployCompleted], false);
		assert.equal(signals[SIGNAL.smokeFailed], false);
		assert.equal(signals[SIGNAL.failedSmokeStage], null);
		assert.equal(signals[SIGNAL.legacyBindingBound], true);
		assert.equal(signals[SIGNAL.versionedBindingBound], true);
		assert.equal(signals[SIGNAL.deleteLegacyOnlyRan], false);
		assert.equal(signals[SIGNAL.recheckFailed], false);
		assert.equal(signals[SIGNAL.regressionReported], false);
	});

	it('reports the smoke stage it observed', () => {
		const transition = readSignals(createFixtureState({ smokes: { transition: 'fail' } }));
		assert.equal(transition[SIGNAL.smokeFailed], true);
		assert.equal(transition[SIGNAL.failedSmokeStage], 'transition');
		const postDeploy = readSignals(createFixtureState({ smokes: { postDeploy: 'fail' } }));
		assert.equal(postDeploy[SIGNAL.failedSmokeStage], 'post-deploy');
	});

	it('describes the signals without carrying a value', () => {
		const text = describeSignals(readSignals(createFixtureState()));
		assert.ok(text.includes('buildFailed=false'));
		assert.ok(text.includes('failedSmokeStage=none'));
	});
});

describe('rollback fixture — the fixture is file-backed', () => {
	it('writes the state, the release manifest and the operation log', () => {
		const dir = createFixtureDir();
		try {
			writeFixture(dir, createFixtureState());
			assert.equal(existsSync(join(dir, 'state.json')), true);
			assert.equal(existsSync(join(dir, 'releases.json')), true);
			assert.equal(existsSync(join(dir, 'operations.json')), true);
			const reloaded = readFixture(dir);
			assert.equal(reloaded.currentRelease, '0.8.0');
			assert.deepEqual(readOperations(dir), []);
		} finally {
			rmDir(dir);
		}
	});
});

function rmDir(dir) {
	// The fixture directory is disposable; the tests remove it by hand
	// because the module deliberately keeps its own surface small.
	rmSync(dir, { recursive: true, force: true });
}

describe('rollback fixture — the scenario registry', () => {
	it('declares one scenario per documented path', () => {
		const ids = SIMULATION_SCENARIOS.map((scenario) => scenario.pathId);
		assert.equal(new Set(ids).size, ids.length, 'each path is simulated once');
		for (const scenario of SIMULATION_SCENARIOS) {
			assert.ok(scenario.id, 'the scenario has an id');
			assert.ok(scenario.title, 'the scenario has a title');
			assert.ok(scenario.before, 'the scenario declares the state before');
			assert.ok(scenario.inject, 'the scenario injects a failure');
			assert.ok(Array.isArray(scenario.exercisedSteps));
		}
	});

	it('names only restore operations the fixture implements', () => {
		for (const scenario of SIMULATION_SCENARIOS) {
			const kind = scenario.restore.kind;
			assert.ok(
				kind === RESTORE.none || Object.hasOwn(RESTORE_OPERATIONS, kind),
				`unknown restore operation: ${kind}`,
			);
			assert.ok(
				typeof scenario.restore.reason === 'string' && scenario.restore.reason.length > 0,
				'a restore that is not performed must record why',
			);
		}
	});

	it('expects only signals the fixture can observe', () => {
		const known = new Set(Object.values(SIGNAL));
		for (const scenario of SIMULATION_SCENARIOS) {
			for (const name of Object.keys(scenario.expect.signals)) {
				assert.ok(known.has(name), `unknown expected signal: ${name}`);
			}
		}
	});
});

describe('rollback fixture — a scenario really changes the state', () => {
	it('runs the post-delete re-check scenario against a disposable directory', () => {
		const dir = createFixtureDir();
		try {
			const scenario = SIMULATION_SCENARIOS.find(
				(entry) => entry.pathId === 'post-delete-recheck-failure',
			);
			assert.ok(scenario, 'the post-delete re-check scenario exists');
			const record = runSimulationScenario(scenario, {
				decide: () => ({
					pathId: 'post-delete-recheck-failure',
					outcome: 'operator-restore',
					owner: 'repository-owner',
					rule: 'restore the legacy binding',
				}),
				dir,
				keep: true,
			});
			assert.equal(record.restore.performed, true);
			assert.equal(record.restore.kind, RESTORE.restoreLegacyOnly);
			// Before the restore the legacy binding is gone: the deletion
			// already ran. After the restore it is bound again.
			assert.equal(record.before.signals[SIGNAL.legacyBindingBound], false);
			assert.equal(record.after.signals[SIGNAL.legacyBindingBound], true);
			// The state on disk changed: the legacy binding was re-added.
			const onDisk = readFixture(dir);
			assert.ok(onDisk.bindings.includes(LEGACY_BINDING_NAME));
			assert.ok(onDisk.bindings.includes(VERSIONED_BINDING_NAME));
			assert.equal(record.after.signals[SIGNAL.legacyBindingBound], true);
			assert.equal(record.after.state.lifecycle, 'open');
			assert.equal(record.after.signals[SIGNAL.deleteLegacyOnlyRan], true);
		} finally {
			rmDir(dir);
		}
	});

	it('records the reason when no restore is performed', () => {
		const scenario = SIMULATION_SCENARIOS.find((entry) => entry.pathId === 'failed-build');
		const record = runSimulationScenario(scenario, {
			decide: () => ({
				pathId: 'failed-build',
				outcome: 'no-deploy',
				owner: 'release-operator',
				rule: 'fix forward',
			}),
		});
		assert.equal(record.restore.performed, false);
		assert.equal(record.restore.kind, RESTORE.none);
		assert.ok(record.restore.reason.length > 0);
	});

	it('reports zero commands, requests, credentials and production operations', () => {
		for (const scenario of SIMULATION_SCENARIOS) {
			const record = runSimulationScenario(scenario, {
				decide: () => ({
					pathId: scenario.pathId,
					outcome: 'x',
					owner: 'repository-owner',
					rule: 'x',
				}),
			});
			assert.equal(record.executedCommands, 0);
			assert.equal(record.externalRequests, 0);
			assert.equal(record.credentialsRead, 0);
			assert.equal(record.productionOperations, 0);
		}
	});
});

describe('rollback fixture — the negative controls fail loudly', () => {
	it('refuses a failure class the decision logic does not recognise', () => {
		assert.throws(
			() =>
				runSimulationScenario(UNKNOWN_FAILURE_SCENARIO, {
					decide: () => {
						throw new Error(
							'the observed state matches no documented rollback path: smokeFailed=true, failedSmokeStage=unknown-stage',
						);
					},
				}),
			/the observed state matches no documented rollback path/,
		);
	});

	it('refuses a restore whose documented precondition cannot be met', () => {
		assert.throws(
			() =>
				runSimulationScenario(UNSATISFIABLE_RESTORE_SCENARIO, {
					decide: () => ({
						pathId: 'post-delete-recheck-failure',
						outcome: 'operator-restore',
						owner: 'repository-owner',
						rule: 'restore the legacy binding',
					}),
				}),
			/the documented --restore-legacy-only operation needs the Infisical audit \/ recovery copy; the fixture has none, so the restore cannot run/,
		);
	});

	it('refuses a scenario whose decision does not match the injected failure', () => {
		const scenario = SIMULATION_SCENARIOS.find((entry) => entry.pathId === 'failed-build');
		assert.throws(
			() =>
				runSimulationScenario(scenario, {
					decide: () => ({
						pathId: 'post-deploy-regression',
						outcome: 'canonical-patch-release',
						owner: 'repository-owner',
						rule: 'x',
					}),
				}),
			/the decision chose the "post-deploy-regression" path, but the injected failure is the "failed-build" path/,
		);
	});
});

describe('rollback fixture — the safety boundary', () => {
	it('imports no process, network or Cloudflare surface', () => {
		const source = readFileSync(join(REPO_ROOT, 'scripts/_rollback-fixture.mjs'), 'utf8');
		assert.equal(
			/from\s+['"]node:(child_process|https?|net|tls|dgram)['"]/.test(source),
			false,
			'the fixture must not be able to run a command or open a socket',
		);
		assert.equal(/wrangler|infisical\s+secrets/.test(source), false);
	});

	it('keeps the fixture directory outside the repository', () => {
		const dir = createFixtureDir();
		try {
			assert.equal(dir.startsWith(REPO_ROOT), false);
		} finally {
			rmDir(dir);
		}
	});
});
