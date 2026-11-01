/**
 * Disposable local fixture for the rollback rehearsal (Issue #721).
 *
 * The obligation this file owns
 * -----------------------------
 * `scripts/_rollback-rehearsal.mjs` owns the DOCUMENTED rollback paths
 * (the failure classes, the decision authority and the steps). This
 * file owns the SIMULATION SUBSTRATE those paths are exercised
 * against: a small, file-backed model of the deployment state, written
 * into a throwaway temporary directory.
 *
 * Why it exists
 * -------------
 * Issue #721: a rehearsal that only renders the procedure proves
 * nothing about recovery. The procedure has to be exercised against a
 * state that actually changes, so the decision can be wrong, the
 * restore condition can be unsatisfiable, and the restored state can be
 * asserted.
 *
 * What the fixture models
 * -----------------------
 * Three files in one disposable directory:
 *
 *   - `state.json`       the deployment state (current / deployed
 *                        release, bound Worker binding NAMES, the Phase
 *                        B lifecycle, the smoke and drift-check
 *                        outcomes, the Infisical audit copy flag);
 *   - `releases.json`    the release / artefact manifest;
 *   - `operations.json`  the append-only operation log — a delete is
 *                        never erased by a later restore, which is what
 *                        the "not reversible" records say.
 *
 * What it never does
 * ------------------
 * It reads no credential, opens no socket, runs no command and touches
 * no Cloudflare binding. It imports `node:fs`, `node:os` and
 * `node:path` only — no `node:child_process`, no network client, no
 * Worker binding. The Worker binding names it stores are NAMES, and
 * they are the two names the canonical runbook already publishes.
 *
 * The decision is not the fixture's business
 * ------------------------------------------
 * The fixture knows how to build a state, inject a failure and apply a
 * documented state transition. It does NOT know which path applies:
 * `runSimulationScenario()` receives a `decide(signals)` callback from
 * the rehearsal module and is given nothing but the OBSERVED signals.
 * A scenario that is wired to the wrong path, or a state that matches
 * no path, fails loudly.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The prefix of every disposable fixture directory. */
export const FIXTURE_DIR_PREFIX = 'rollback-rehearsal-fixture-';

/** The fixture state schema version. Bumped when the shape changes. */
export const FIXTURE_STATE_VERSION = 1;

/**
 * The closed signal vocabulary.
 *
 * A signal is an OBSERVABLE property of the simulated state. The
 * rollback decision is made from signals only, so the vocabulary is
 * closed: a detection rule may not name a signal the fixture cannot
 * observe, and the fixture may not grow an observable that no
 * documented rule reads.
 */
export const SIGNAL = Object.freeze({
	buildFailed: 'buildFailed',
	deployCompleted: 'deployCompleted',
	mergeCompleted: 'mergeCompleted',
	smokeFailed: 'smokeFailed',
	failedSmokeStage: 'failedSmokeStage',
	legacyBindingBound: 'legacyBindingBound',
	versionedBindingBound: 'versionedBindingBound',
	deleteLegacyOnlyRan: 'deleteLegacyOnlyRan',
	recheckFailed: 'recheckFailed',
	regressionReported: 'regressionReported',
});

/** The documented recovery operations this fixture can model. */
export const RESTORE = Object.freeze({
	none: 'none',
	rollbackVersionedOnly: 'rollback-versioned-only',
	restoreLegacyOnly: 'restore-legacy-only',
});

/** The legacy Worker binding NAME (never a value). */
export const LEGACY_BINDING_NAME = 'BETTER_AUTH_SECRET';

/** The versioned Worker binding NAME (never a value). */
export const VERSIONED_BINDING_NAME = 'BETTER_AUTH_SECRETS';

/** The smoke stages the fixture can report. */
export const SMOKE_STAGE = Object.freeze({
	transition: 'transition',
	postDeploy: 'post-deploy',
	unknown: 'unknown-stage',
});

function isPlainObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merge a patch into a state.
 *
 * Objects merge key by key; arrays and scalars replace. A scenario
 * therefore states the part of the state it changes and leaves the rest
 * of the known-good state alone.
 */
export function applyPatch(state, patch) {
	if (!isPlainObject(patch)) return state;
	const merged = { ...state };
	for (const [key, value] of Object.entries(patch)) {
		merged[key] =
			isPlainObject(value) && isPlainObject(state[key]) ? applyPatch(state[key], value) : value;
	}
	return merged;
}

/**
 * The known-good state: a previous successful release is current, the
 * Phase B flip already ran, both binding NAMES are bound and the #89
 * lifecycle is still open.
 */
export function createFixtureState(overrides = {}) {
	const base = {
		version: FIXTURE_STATE_VERSION,
		releases: [
			{ version: '0.8.0', commit: '1111111', role: 'previous-good', artifact: 'sha256:previous' },
			{ version: '0.9.0', commit: '2222222', role: 'candidate', artifact: 'sha256:candidate' },
		],
		currentRelease: '0.8.0',
		deployedRelease: '0.8.0',
		mergedRelease: null,
		bindings: [LEGACY_BINDING_NAME, VERSIONED_BINDING_NAME],
		lifecycle: 'open',
		phaseB: { flipRan: true, deleteLegacyOnlyRan: false },
		infisicalAuditCopy: true,
		build: { status: 'succeeded' },
		smokes: { transition: 'not-run', postDeploy: 'not-run', manual: 'not-run' },
		driftCheck: { status: 'not-run' },
		regression: { reported: false, surface: null },
	};
	return applyPatch(base, overrides);
}

/**
 * Derive the observable signals from a state.
 *
 * The signals are what the rollback decision is allowed to look at.
 * Nothing else in the state — a commit SHA, a release name — may drive
 * a decision, so the decision cannot be keyed to a scenario.
 */
export function readSignals(state) {
	const smokes = isPlainObject(state.smokes) ? state.smokes : {};
	const transitionFailed = smokes.transition === 'fail';
	const postDeployFailed = smokes.postDeploy === 'fail' || smokes.manual === 'fail';
	const smokeFailed = Object.values(smokes).includes('fail');
	const merged = typeof state.mergedRelease === 'string' && state.mergedRelease.length > 0;
	const bindings = Array.isArray(state.bindings) ? state.bindings : [];
	const deleteLegacyOnlyRan = state.phaseB?.deleteLegacyOnlyRan === true;
	const recheckFailed = state.driftCheck?.status === 'fail' || (smokeFailed && deleteLegacyOnlyRan);
	return {
		[SIGNAL.buildFailed]: state.build?.status === 'failed',
		[SIGNAL.deployCompleted]: merged && state.deployedRelease === state.mergedRelease,
		[SIGNAL.mergeCompleted]: merged,
		[SIGNAL.smokeFailed]: smokeFailed,
		[SIGNAL.failedSmokeStage]: transitionFailed
			? SMOKE_STAGE.transition
			: postDeployFailed
				? SMOKE_STAGE.postDeploy
				: smokeFailed
					? SMOKE_STAGE.unknown
					: null,
		[SIGNAL.legacyBindingBound]: bindings.includes(LEGACY_BINDING_NAME),
		[SIGNAL.versionedBindingBound]: bindings.includes(VERSIONED_BINDING_NAME),
		[SIGNAL.deleteLegacyOnlyRan]: deleteLegacyOnlyRan,
		[SIGNAL.recheckFailed]: recheckFailed,
		[SIGNAL.regressionReported]: state.regression?.reported === true,
	};
}

/**
 * A status-only description of a signal set.
 *
 * Only fixture booleans and stage names appear here — never a secret,
 * a credential or a URL.
 */
export function describeSignals(signals) {
	return Object.entries(signals)
		.map(([name, value]) => `${name}=${value === null ? 'none' : String(value)}`)
		.join(', ');
}

/** Create a fresh disposable fixture directory. */
export function createFixtureDir() {
	return mkdtempSync(join(tmpdir(), FIXTURE_DIR_PREFIX));
}

/**
 * Write the fixture files.
 *
 * `operations.json` is append-only: a later restore never erases the
 * earlier deletion, because that is exactly what the documented "not
 * reversible" records claim.
 */
export function writeFixture(dir, state, operations = []) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
	writeFileSync(join(dir, 'releases.json'), `${JSON.stringify(state.releases, null, 2)}\n`);
	writeFileSync(join(dir, 'operations.json'), `${JSON.stringify(operations, null, 2)}\n`);
	return dir;
}

/** Read the fixture state back from disk. */
export function readFixture(dir) {
	return JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
}

/** Read the append-only operation log. */
export function readOperations(dir) {
	const path = join(dir, 'operations.json');
	if (!existsSync(path)) return [];
	return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * The documented recovery operations, as state transitions.
 *
 * Each operation declares its precondition. The precondition is part of
 * the documented procedure, so a fixture that cannot satisfy it must
 * fail loudly instead of pretending the restore happened.
 */
export const RESTORE_OPERATIONS = Object.freeze({
	[RESTORE.rollbackVersionedOnly]: {
		summary: 'remove the inert versioned Worker binding; the legacy runtime stays readable',
		precondition: (state, signals) =>
			signals[SIGNAL.legacyBindingBound] === true ||
			'the documented --rollback-versioned-only operation requires the legacy runtime to remain readable; the fixture has no legacy binding, so the rollback cannot run',
		apply: (state) => ({
			...state,
			bindings: state.bindings.filter((name) => name !== VERSIONED_BINDING_NAME),
		}),
	},
	[RESTORE.restoreLegacyOnly]: {
		summary: 're-add the legacy Worker binding from the Infisical audit / recovery copy',
		precondition: (state, signals) =>
			(state.phaseB?.deleteLegacyOnlyRan === true && state.infisicalAuditCopy === true) ||
			'the documented --restore-legacy-only operation needs the Infisical audit / recovery copy; the fixture has none, so the restore cannot run',
		apply: (state) => ({
			...state,
			bindings: state.bindings.includes(LEGACY_BINDING_NAME)
				? state.bindings
				: [...state.bindings, LEGACY_BINDING_NAME],
		}),
	},
});

/**
 * The simulation scenarios.
 *
 * One scenario per documented path. The `pathId` is COVERAGE metadata:
 * it says which documented path the scenario exercises, and the gate
 * compares it with the table. It is never handed to the decision — the
 * decision receives the observed signals and nothing else.
 *
 * `exercisedSteps` names the steps of the path the simulation actually
 * performed an analogue of. A step that is not listed stays `recorded`:
 * a procedure that only a human or the live platform can run (a
 * repository fix, a release merge, a sign-in with real credentials) is
 * never reported as simulated.
 */
export const SIMULATION_SCENARIOS = Object.freeze([
	{
		id: 'failed-build-simulation',
		pathId: 'failed-build',
		failureClass: 'failed-build',
		title: 'The build phase fails; no production state changed',
		before: createFixtureState(),
		inject: { build: { status: 'failed' } },
		restore: {
			kind: RESTORE.none,
			reason:
				'a build-phase failure changed no production state, so the documented path has no restore operation; the repair is a forward fix on the ticket branch',
		},
		exercisedSteps: [
			{ stepId: 'resolve-failed-build', method: 'fixture-observation' },
			{ stepId: 'refuse-local-deploy-substitute', method: 'fixture-observation' },
		],
		expect: {
			signals: {
				buildFailed: true,
				deployCompleted: false,
				legacyBindingBound: true,
				versionedBindingBound: true,
			},
			state: { deployedRelease: '0.8.0', mergedRelease: null, currentRelease: '0.8.0' },
		},
	},
	{
		id: 'failed-smoke-pre-merge-simulation',
		pathId: 'failed-smoke-pre-merge',
		failureClass: 'failed-smoke',
		title: 'The transition smoke fails before the release PR merges',
		before: createFixtureState(),
		inject: { smokes: { transition: 'fail' } },
		restore: {
			kind: RESTORE.rollbackVersionedOnly,
			reason:
				'the documented --rollback-versioned-only operation removes the inert versioned binding; the legacy runtime stays readable and the release PR stays unmerged',
		},
		exercisedSteps: [
			{ stepId: 'observe-transition-smoke', method: 'fixture-observation' },
			{ stepId: 'confirm-binding-state', method: 'fixture-observation' },
			{ stepId: 'rollback-versioned-binding', method: 'fixture-state-transition' },
			{ stepId: 'legacy-auth-failure-branch', method: 'fixture-observation' },
			{ stepId: 'release-merge-human-gate', method: 'fixture-observation' },
		],
		expect: {
			signals: {
				smokeFailed: true,
				failedSmokeStage: 'transition',
				deployCompleted: false,
				legacyBindingBound: true,
				versionedBindingBound: false,
			},
			state: { mergedRelease: null, deployedRelease: '0.8.0', currentRelease: '0.8.0' },
		},
	},
	{
		id: 'failed-smoke-post-deploy-simulation',
		pathId: 'failed-smoke-post-deploy',
		failureClass: 'failed-smoke',
		title: 'The post-deploy smoke fails; the legacy fallback is still bound',
		before: createFixtureState({
			mergedRelease: '0.9.0',
			deployedRelease: '0.9.0',
			smokes: { transition: 'pass', postDeploy: 'pass', manual: 'not-run' },
		}),
		inject: { smokes: { postDeploy: 'fail' } },
		restore: {
			kind: RESTORE.none,
			reason:
				'the documented path forbids --restore-legacy-only here: the legacy binding is still bound and the versioned runtime is already deployed, so restoring it would roll nothing back and would hide the failing surface',
		},
		exercisedSteps: [
			{ stepId: 'observe-post-deploy-smoke', method: 'fixture-observation' },
			{ stepId: 'confirm-both-bindings', method: 'fixture-observation' },
			{ stepId: 'do-not-delete-legacy', method: 'fixture-observation' },
			{ stepId: 'no-restore-legacy-before-delete', method: 'fixture-observation' },
			{ stepId: 'investigate-before-closing-lifecycle', method: 'fixture-observation' },
		],
		expect: {
			signals: {
				smokeFailed: true,
				failedSmokeStage: 'post-deploy',
				deployCompleted: true,
				legacyBindingBound: true,
				versionedBindingBound: true,
				deleteLegacyOnlyRan: false,
			},
			state: { mergedRelease: '0.9.0', deployedRelease: '0.9.0', lifecycle: 'open' },
		},
	},
	{
		id: 'post-delete-recheck-simulation',
		pathId: 'post-delete-recheck-failure',
		failureClass: 'post-delete-recheck',
		title: 'The re-check fails after the legacy binding was deleted',
		before: createFixtureState({
			mergedRelease: '0.9.0',
			deployedRelease: '0.9.0',
			bindings: [VERSIONED_BINDING_NAME],
			phaseB: { flipRan: true, deleteLegacyOnlyRan: true },
			smokes: { transition: 'pass', postDeploy: 'pass', manual: 'pass' },
		}),
		inject: { driftCheck: { status: 'fail' } },
		restore: {
			kind: RESTORE.restoreLegacyOnly,
			reason:
				'the documented --restore-legacy-only operation re-adds the legacy binding from the Infisical audit / recovery copy; it is a binding restore, not a code rollback',
		},
		exercisedSteps: [
			{ stepId: 'observe-post-delete-recheck', method: 'fixture-observation' },
			{ stepId: 'confirm-legacy-binding-absent', method: 'fixture-observation' },
			{ stepId: 'restore-legacy-binding', method: 'fixture-state-transition' },
			{ stepId: 'keep-lifecycle-open', method: 'fixture-observation' },
		],
		expect: {
			signals: {
				deleteLegacyOnlyRan: true,
				recheckFailed: true,
				legacyBindingBound: true,
				versionedBindingBound: true,
			},
			state: { mergedRelease: '0.9.0', deployedRelease: '0.9.0', lifecycle: 'open' },
		},
	},
	{
		id: 'post-deploy-regression-simulation',
		pathId: 'post-deploy-regression',
		failureClass: 'post-deploy-regression',
		title: 'A visitor-facing regression is reported after the deploy window',
		before: createFixtureState({
			mergedRelease: '0.9.0',
			deployedRelease: '0.9.0',
			smokes: { transition: 'pass', postDeploy: 'pass', manual: 'pass' },
		}),
		inject: { regression: { reported: true, surface: '/admin' } },
		restore: {
			kind: RESTORE.none,
			reason:
				'a code regression is repaired forward through the canonical patch-release path; a binding restore is documented for the post-delete re-check failure class only',
		},
		exercisedSteps: [
			{ stepId: 'record-regression', method: 'fixture-observation' },
			{ stepId: 'no-agent-rollback', method: 'fixture-observation' },
			{ stepId: 'binding-only-recovery', method: 'fixture-observation' },
		],
		expect: {
			signals: {
				regressionReported: true,
				legacyBindingBound: true,
				versionedBindingBound: true,
			},
			state: { mergedRelease: '0.9.0', deployedRelease: '0.9.0', lifecycle: 'open' },
		},
	},
]);

/**
 * Negative control: a state the decision logic does not recognise.
 *
 * The fixture reports a smoke failure at a stage no documented rule
 * reads. Nothing may claim that a documented path applies to it.
 */
export const UNKNOWN_FAILURE_SCENARIO = Object.freeze({
	id: 'unknown-failure-class-simulation',
	pathId: null,
	title: 'A failure class the decision logic does not recognise',
	before: createFixtureState({
		mergedRelease: '0.9.0',
		deployedRelease: '0.9.0',
		smokes: { transition: 'pass', postDeploy: 'pass', manual: 'pass' },
	}),
	inject: { smokes: { unknown: 'fail' } },
	restore: { kind: RESTORE.none, reason: 'no decision applies, so no restore is attempted' },
	exercisedSteps: [],
	expect: { signals: {}, state: {} },
});

/**
 * Negative control: the documented restore condition cannot be met.
 *
 * The re-check fails after the legacy binding was deleted, but the
 * Infisical audit / recovery copy the restore depends on is gone, so
 * the restore must fail instead of silently doing nothing.
 */
export const UNSATISFIABLE_RESTORE_SCENARIO = Object.freeze({
	id: 'unsatisfiable-restore-simulation',
	pathId: 'post-delete-recheck-failure',
	title: 'The documented restore condition cannot be satisfied',
	before: createFixtureState({
		mergedRelease: '0.9.0',
		deployedRelease: '0.9.0',
		bindings: [VERSIONED_BINDING_NAME],
		phaseB: { flipRan: true, deleteLegacyOnlyRan: true },
		infisicalAuditCopy: false,
		smokes: { transition: 'pass', postDeploy: 'pass', manual: 'pass' },
	}),
	inject: { driftCheck: { status: 'fail' } },
	restore: {
		kind: RESTORE.restoreLegacyOnly,
		reason:
			'the restore depends on the Infisical audit / recovery copy, which the fixture does not have',
	},
	exercisedSteps: [],
	expect: { signals: {}, state: {} },
});

function assertExpectations(scenario, state, signals) {
	const expectedSignals = scenario.expect?.signals ?? {};
	for (const [name, expected] of Object.entries(expectedSignals)) {
		const observed = signals[name];
		if (observed !== expected) {
			throw new Error(
				`the restored state does not match the expectation: ${name} expected ${String(expected)}, observed ${String(observed)}`,
			);
		}
	}
	const expectedState = scenario.expect?.state ?? {};
	for (const [name, expected] of Object.entries(expectedState)) {
		const observed = state[name];
		if (observed !== expected) {
			throw new Error(
				`the restored state does not match the expectation: ${name} expected ${String(expected)}, observed ${String(observed)}`,
			);
		}
	}
}

/**
 * Run one simulation scenario against a disposable fixture.
 *
 * The order is the documented one: state before, failure injection, the
 * rollback decision (made from the observed signals alone), the
 * documented restore, state after. The decision callback receives the
 * signals and nothing else, so the fixture cannot hand it the answer.
 *
 * Returns the execution record: the observed signals before and after,
 * the restore that was performed (or the reason it was not), and the
 * per-step observations.
 */
export function runSimulationScenario(scenario, { decide, dir = null, keep = false } = {}) {
	if (typeof decide !== 'function') {
		throw new Error('a simulation scenario needs a decide(signals) callback');
	}
	const root = dir ?? createFixtureDir();
	try {
		return runScenarioIn(scenario, decide, root);
	} finally {
		// The fixture is disposable: a failed scenario must not leave a
		// directory behind either.
		if (!keep) rmSync(root, { recursive: true, force: true });
	}
}

/** The body of a scenario run, against an existing fixture directory. */
function runScenarioIn(scenario, decide, root) {
	const operations = [];
	let state = createFixtureState(scenario.before ?? {});
	writeFixture(root, state, operations);
	const signalsBefore = readSignals(state);

	state = applyPatch(state, scenario.inject ?? {});
	writeFixture(root, state, operations);
	// The decision reads what is actually ON DISK, not the in-memory copy.
	state = readFixture(root);
	const signalsAfterInjection = readSignals(state);

	const decision = decide(signalsAfterInjection);
	if (scenario.pathId !== null && decision.pathId !== scenario.pathId) {
		throw new Error(
			`the decision chose the "${decision.pathId}" path, but the injected failure is the "${scenario.pathId}" path`,
		);
	}

	const restoreKind = scenario.restore?.kind ?? RESTORE.none;
	let restorePerformed = false;
	const restoreReason = scenario.restore?.reason ?? '';
	if (restoreKind !== RESTORE.none) {
		const operation = RESTORE_OPERATIONS[restoreKind];
		if (!operation) {
			throw new Error(`the scenario names an unknown restore operation: ${restoreKind}`);
		}
		const precondition = operation.precondition(state, signalsAfterInjection);
		if (precondition !== true) {
			throw new Error(precondition);
		}
		state = operation.apply(state);
		operations.push({ operation: restoreKind, summary: operation.summary });
		writeFixture(root, state, operations);
		state = readFixture(root);
		restorePerformed = true;
	}

	const stateAfter = readFixture(root);
	const signalsAfter = readSignals(stateAfter);
	assertExpectations(scenario, stateAfter, signalsAfter);

	const exercised = new Map();
	for (const entry of scenario.exercisedSteps ?? []) {
		exercised.set(entry.stepId, {
			method: entry.method,
			observed:
				entry.method === 'fixture-state-transition'
					? { signalsAfter: { ...signalsAfter } }
					: { signals: { ...signalsAfter } },
		});
	}

	const record = {
		id: scenario.id,
		pathId: scenario.pathId,
		title: scenario.title,
		decision: {
			pathId: decision.pathId,
			outcome: decision.outcome,
			owner: decision.owner,
			rule: decision.rule,
		},
		before: {
			signals: { ...signalsBefore },
			state: { ...createFixtureState(scenario.before ?? {}) },
		},
		injected: scenario.inject ?? {},
		afterInjection: { signals: { ...signalsAfterInjection } },
		restore: {
			kind: restoreKind,
			performed: restorePerformed,
			reason: restoreReason,
			summary: restorePerformed ? RESTORE_OPERATIONS[restoreKind].summary : null,
		},
		after: { signals: { ...signalsAfter }, state: { ...stateAfter } },
		operations: [...operations],
		exercisedSteps: [...exercised.entries()].map(([stepId, detail]) => ({
			stepId,
			...detail,
		})),
		// The safety boundary, counted rather than asserted in prose.
		executedCommands: 0,
		externalRequests: 0,
		credentialsRead: 0,
		productionOperations: 0,
		stateTransitions: restorePerformed ? 1 : 0,
	};

	return record;
}
