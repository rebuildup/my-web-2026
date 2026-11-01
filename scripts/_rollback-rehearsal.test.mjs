import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	SIMULATION_SCENARIOS,
	UNKNOWN_FAILURE_SCENARIO,
	UNSATISFIABLE_RESTORE_SCENARIO,
	runSimulationScenario,
} from './_rollback-fixture.mjs';
import {
	ACTION_KIND,
	AGENTS_PATH,
	ERROR_CODE,
	EVIDENCE_LEVEL,
	FAILURE_CLASS,
	NOT_VERIFIED_FACTS,
	OUTCOME,
	REHEARSAL_PATHS,
	RELEASE_PATH,
	RUNBOOK_PATH,
	assertNoSensitiveInText,
	citationErrorCode,
	decideRollbackPath,
	detectionMatches,
	extractHeadings,
	findSensitiveInText,
	formatRollbackRehearsal,
	loadCitationIndex,
	runRollbackRehearsal,
	runRollbackSimulation,
	validateRehearsal,
} from './_rollback-rehearsal.mjs';
import {
	PAGE_TEST_ID,
	PATH_TEST_ID,
	SCREENSHOT_BUDGET_BYTES,
	SCREENSHOT_MAX_WIDTH,
	SCREENSHOT_QUALITY_LADDER,
	assertWebpOutputPath,
	isLoopbackRequestUrl,
	parseArgs,
	promoteStagedCapture,
	renderRollbackRehearsalHtml,
	resolveStaticTarget,
	screenshotBudgetVerdict,
	stagedCapturePath,
} from './capture-rollback-rehearsal.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Tests for the offline rollback rehearsal (Issue #503).
 *
 * The rehearsal is a RECORD, not an action: it must never execute a
 * command, read a credential or make a request, and the artefact it
 * produces must be a WebP inside the committed-image budget. These tests
 * pin those invariants, plus the two properties that make the record
 * usable: the table validates, and the sensitive-value guard reports a
 * detector id and a line number without ever echoing the matched text.
 */
describe('rollback rehearsal — the record validates', () => {
	it('accepts the committed rehearsal table', () => {
		const validation = validateRehearsal(REHEARSAL_PATHS);
		assert.equal(validation.ok, true, JSON.stringify(validation.errors));
		assert.equal(validation.pathCount, REHEARSAL_PATHS.length);
	});

	it('rejects a table with no paths', () => {
		const validation = validateRehearsal([]);
		assert.equal(validation.ok, false);
		assert.ok(validation.errors.length > 0);
	});

	it('rejects a duplicated path id', () => {
		const [first, ...rest] = REHEARSAL_PATHS;
		const validation = validateRehearsal([first, first, ...rest]);
		assert.equal(validation.ok, false);
	});

	it('projects every failure class the runbook describes', () => {
		const result = runRollbackRehearsal();
		assert.equal(result.ok, true);
		assert.equal(result.summary.pathCount, 5);
		assert.ok(result.summary.stepCount > 0);
		assert.deepEqual(result.summary.failureClasses.sort(), [
			'failed-build',
			'failed-smoke',
			'post-delete-recheck',
			'post-deploy-regression',
		]);
	});

	it('keeps a post-deploy smoke failure on the fix-forward path, not on a restore', () => {
		const path = REHEARSAL_PATHS.find((entry) => entry.id === 'failed-smoke-post-deploy');
		assert.ok(path, 'the post-deploy smoke path exists');
		assert.equal(path.outcome, OUTCOME.lifecycleOpen);
		const commands = path.steps
			.map((step) => step.action.command)
			.filter((command) => typeof command === 'string');
		assert.equal(
			commands.some((command) => command.includes('--restore-legacy-only')),
			false,
			'an ordinary post-deploy smoke failure must not point the operator at --restore-legacy-only',
		);
	});

	it('separates the post-delete re-check failure from the ordinary smoke failure', () => {
		const recheck = REHEARSAL_PATHS.find((entry) => entry.id === 'post-delete-recheck-failure');
		assert.ok(recheck, 'the post-delete re-check path exists');
		assert.equal(recheck.outcome, OUTCOME.operatorRestore);
		assert.notEqual(recheck.failureClass, FAILURE_CLASS.failedSmoke);
		const commands = recheck.steps
			.map((step) => step.action.command)
			.filter((command) => typeof command === 'string');
		assert.equal(
			commands.some((command) => command.includes('--restore-legacy-only')),
			true,
			'the post-delete re-check path is where the documented restore operation belongs',
		);
	});
});

describe('rollback rehearsal — a citation must resolve', () => {
	it('resolves every citation in the committed table against the real documents', () => {
		const index = loadCitationIndex(REPO_ROOT);
		for (const path of REHEARSAL_PATHS) {
			const citations = [
				path.trigger.source,
				path.decisionPoint.authority,
				...path.steps.map((step) => step.authority),
			];
			for (const citation of citations) {
				assert.equal(
					citationErrorCode(citation, index),
					null,
					`unresolved citation: ${JSON.stringify(citation)}`,
				);
			}
		}
	});

	it('finds a heading that is really in the runbook', () => {
		const index = loadCitationIndex(REPO_ROOT);
		const headings = index.get(RUNBOOK_PATH);
		assert.ok(headings instanceof Set);
		assert.equal(headings.has('## Recovery operations (Phase B driver)'), true);
	});

	it('rejects a citation into a document this repository does not own', () => {
		const paths = structuredClone(REHEARSAL_PATHS);
		paths[0].trigger.source = { file: 'missing.md', heading: '## Anything' };
		const validation = validateRehearsal(paths);
		assert.equal(validation.ok, false);
		assert.ok(
			validation.errors.some((error) => error.code === ERROR_CODE.citationDocumentUnknown),
			JSON.stringify(validation.errors),
		);
	});

	it('rejects a citation to a heading that was renamed or deleted', () => {
		const paths = structuredClone(REHEARSAL_PATHS);
		paths[0].decisionPoint.authority = {
			file: RUNBOOK_PATH,
			heading: '## A heading that no longer exists',
		};
		const validation = validateRehearsal(paths);
		assert.equal(validation.ok, false);
		assert.ok(
			validation.errors.some((error) => error.code === ERROR_CODE.citationHeadingMissing),
			JSON.stringify(validation.errors),
		);
	});

	it('reads the headings of a markdown document', () => {
		const headings = extractHeadings('# Title\n\ntext\n\n## Second heading\n');
		assert.equal(headings.has('# Title'), true);
		assert.equal(headings.has('## Second heading'), true);
		assert.equal(headings.size, 2);
	});
});

describe('rollback rehearsal — a human gate must say what it gates', () => {
	it('rejects a human gate step with no summary', () => {
		const paths = structuredClone(REHEARSAL_PATHS);
		const gate = paths
			.flatMap((path) => path.steps)
			.find((step) => step.action.kind === ACTION_KIND.humanGate);
		assert.ok(gate, 'the table has a human gate step');
		gate.action.summary = undefined;
		const validation = validateRehearsal(paths);
		assert.equal(validation.ok, false);
		assert.ok(
			validation.errors.some((error) => error.code === ERROR_CODE.actionSummaryMissing),
			JSON.stringify(validation.errors),
		);
	});
});

describe('rollback rehearsal — nothing is executed, read or requested', () => {
	it('records zero executed commands, requests and credential reads', () => {
		const { summary } = runRollbackRehearsal();
		assert.equal(summary.executedCommands, 0);
		assert.equal(summary.externalRequests, 0);
		assert.equal(summary.credentialsRead, 0);
	});

	it('marks every projected step as recorded rather than performed', () => {
		const result = runRollbackRehearsal();
		for (const path of result.paths) {
			for (const step of path.steps) {
				assert.equal(step.action.executedByRehearsal, false);
				if (step.evidence === EVIDENCE_LEVEL.recorded) {
					assert.equal(step.status, 'recorded');
					assert.equal(step.simulation, null);
				}
			}
		}
	});

	it('separates a recording from an execution', () => {
		const result = runRollbackRehearsal();
		const steps = result.paths.flatMap((path) => path.steps);
		const recorded = steps.filter((step) => step.evidence === EVIDENCE_LEVEL.recorded);
		const simulated = steps.filter((step) => step.evidence === EVIDENCE_LEVEL.simulatedAndTested);
		assert.ok(recorded.length > 0, 'a procedure only a human can run stays recorded');
		assert.ok(simulated.length > 0, 'the exercised steps carry the simulation level');
		for (const step of simulated) {
			assert.equal(step.status, 'simulated');
			assert.ok(step.simulation, 'a simulated step names its scenario');
			assert.equal(step.simulation.scenarioId.length > 0, true);
		}
	});

	it('names the runbook, the release guide and the agent contract it rehearses', () => {
		for (const relative of [RUNBOOK_PATH, RELEASE_PATH, AGENTS_PATH]) {
			assert.equal(existsSync(join(REPO_ROOT, relative)), true, relative);
		}
	});

	it('imports no process, network or Cloudflare surface', () => {
		for (const file of ['scripts/_rollback-rehearsal.mjs', 'scripts/_rollback-fixture.mjs']) {
			const source = readFileSync(join(REPO_ROOT, file), 'utf8');
			assert.equal(
				/from\s+['"]node:(child_process|https?|net|tls|dgram)['"]/.test(source),
				false,
				`${file} must not be able to run a command or open a socket`,
			);
		}
	});

	it('formats status-only lines that carry no fixture value', () => {
		const result = runRollbackRehearsal();
		const lines = formatRollbackRehearsal(result);
		assert.ok(lines.length > 0);
		for (const line of lines) {
			assert.equal(assertNoSensitiveInText(line).ok, true, line);
		}
	});
});

describe('rollback rehearsal — the decision is made from the observed state', () => {
	it('gives every path a detection rule over observable signals', () => {
		for (const path of REHEARSAL_PATHS) {
			assert.ok(path.detection, `${path.id} declares a detection rule`);
			assert.ok(Object.keys(path.detection).length > 0, `${path.id} has a non-empty rule`);
		}
	});

	it('rejects a path with no detection rule', () => {
		const paths = structuredClone(REHEARSAL_PATHS);
		paths[0].detection = undefined;
		const validation = validateRehearsal(paths);
		assert.equal(validation.ok, false);
		assert.ok(
			validation.errors.some((error) => error.code === ERROR_CODE.detectionMissing),
			JSON.stringify(validation.errors),
		);
	});

	it('rejects a detection rule that names a signal the fixture cannot observe', () => {
		const paths = structuredClone(REHEARSAL_PATHS);
		paths[0].detection = { somethingTheFixtureCannotSee: true };
		const validation = validateRehearsal(paths);
		assert.equal(validation.ok, false);
		assert.ok(
			validation.errors.some((error) => error.code === ERROR_CODE.detectionSignalUnknown),
			JSON.stringify(validation.errors),
		);
	});

	it('decides exactly one documented path per scenario', () => {
		for (const scenario of SIMULATION_SCENARIOS) {
			const record = runSimulationScenario(scenario, {
				decide: (signals) => decideRollbackPath(signals),
			});
			assert.equal(record.decision.pathId, scenario.pathId, scenario.id);
		}
	});

	it('matches a detection rule only when every signal it names agrees', () => {
		assert.equal(detectionMatches({ buildFailed: true }, { buildFailed: true }), true);
		assert.equal(detectionMatches({ buildFailed: true }, { buildFailed: false }), false);
		assert.equal(
			detectionMatches({ buildFailed: true }, { buildFailed: true, deployCompleted: false }),
			true,
		);
	});

	it('refuses a state that matches no documented path', () => {
		assert.throws(
			() => decideRollbackPath({ buildFailed: false, smokeFailed: false }),
			/the observed state matches no documented rollback path/,
		);
	});

	it('refuses a state that matches more than one documented path', () => {
		const overlapping = structuredClone(REHEARSAL_PATHS);
		overlapping[1].detection = { ...overlapping[0].detection };
		assert.throws(
			() => decideRollbackPath({ buildFailed: true, deployCompleted: false }, overlapping),
			/the observed state matches 2 documented rollback paths \(failed-build, failed-smoke-pre-merge\): the detection rules overlap/,
		);
	});
});

describe('rollback rehearsal — the simulation covers the table', () => {
	it('simulates every documented path', () => {
		const simulated = new Set(SIMULATION_SCENARIOS.map((scenario) => scenario.pathId));
		for (const path of REHEARSAL_PATHS) {
			assert.ok(simulated.has(path.id), `the path ${path.id} has no simulation scenario`);
		}
		assert.equal(simulated.size, REHEARSAL_PATHS.length);
	});

	it('exercises steps that exist in the path it claims to cover', () => {
		for (const scenario of SIMULATION_SCENARIOS) {
			const path = REHEARSAL_PATHS.find((entry) => entry.id === scenario.pathId);
			assert.ok(path, `the scenario ${scenario.id} names a documented path`);
			assert.equal(
				scenario.failureClass,
				path.failureClass,
				`${scenario.id} injects a different failure class than the documented path`,
			);
			for (const step of scenario.exercisedSteps) {
				assert.ok(
					path.steps.some((entry) => entry.id === step.stepId),
					`${scenario.id} exercises an unknown step: ${step.stepId}`,
				);
			}
		}
	});

	it('runs every scenario and reports zero external effect', () => {
		const simulation = runRollbackSimulation();
		assert.equal(simulation.ok, true, JSON.stringify(simulation.errors));
		assert.equal(simulation.records.length, SIMULATION_SCENARIOS.length);
		assert.equal(simulation.summary.executedCommands, 0);
		assert.equal(simulation.summary.externalRequests, 0);
		assert.equal(simulation.summary.credentialsRead, 0);
		assert.equal(simulation.summary.productionOperations, 0);
		assert.ok(simulation.summary.simulatedStepCount > 0);
		assert.ok(simulation.summary.stateTransitions > 0, 'a restore really changed the fixture');
	});

	it('records the observed state before and after each scenario', () => {
		const simulation = runRollbackSimulation();
		for (const record of simulation.records) {
			assert.ok(record.before.signals, `${record.id} records the state before`);
			assert.ok(record.after.signals, `${record.id} records the state after`);
			assert.ok(record.decision.pathId, `${record.id} records the decision`);
			assert.ok(record.decision.rule, `${record.id} records the deciding rule`);
		}
	});

	it('records why a restore was not performed', () => {
		const simulation = runRollbackSimulation();
		const withoutRestore = simulation.records.filter((record) => !record.restore.performed);
		assert.ok(withoutRestore.length > 0);
		for (const record of withoutRestore) {
			assert.ok(record.restore.reason.length > 0, `${record.id} must say why it did not restore`);
		}
	});

	it('really restores the legacy binding after the post-delete re-check failure', () => {
		const simulation = runRollbackSimulation();
		const record = simulation.records.find(
			(entry) => entry.pathId === 'post-delete-recheck-failure',
		);
		assert.ok(record, 'the post-delete re-check scenario ran');
		assert.equal(record.restore.performed, true);
		assert.equal(record.restore.kind, 'restore-legacy-only');
		assert.equal(record.before.signals.legacyBindingBound, false);
		assert.equal(record.after.signals.legacyBindingBound, true);
		assert.equal(record.after.signals.versionedBindingBound, true);
		assert.equal(record.after.state.deployedRelease, record.before.state.deployedRelease);
	});

	it('really removes the inert versioned binding after the transition smoke failure', () => {
		const simulation = runRollbackSimulation();
		const record = simulation.records.find((entry) => entry.pathId === 'failed-smoke-pre-merge');
		assert.ok(record, 'the transition smoke scenario ran');
		assert.equal(record.restore.performed, true);
		assert.equal(record.restore.kind, 'rollback-versioned-only');
		assert.equal(record.before.signals.versionedBindingBound, true);
		assert.equal(record.after.signals.versionedBindingBound, false);
		assert.equal(record.after.signals.legacyBindingBound, true);
	});
});

describe('rollback rehearsal — the negative controls fail loudly', () => {
	it('refuses a failure class the decision logic does not recognise', () => {
		assert.throws(
			() =>
				runSimulationScenario(UNKNOWN_FAILURE_SCENARIO, {
					decide: (signals) => decideRollbackPath(signals),
				}),
			/the observed state matches no documented rollback path/,
		);
	});

	it('refuses a restore whose documented precondition cannot be met', () => {
		assert.throws(
			() =>
				runSimulationScenario(UNSATISFIABLE_RESTORE_SCENARIO, {
					decide: (signals) => decideRollbackPath(signals),
				}),
			/the documented --restore-legacy-only operation needs the Infisical audit \/ recovery copy; the fixture has none, so the restore cannot run/,
		);
	});

	it('reports a failed simulation instead of a partial PASS', () => {
		const result = runRollbackRehearsal(REHEARSAL_PATHS, {
			scenarios: [UNSATISFIABLE_RESTORE_SCENARIO],
		});
		assert.equal(result.ok, false);
		assert.equal(result.paths.length, 0);
		assert.ok(
			result.errors.some((error) => error.code === ERROR_CODE.simulationFailed),
			JSON.stringify(result.errors),
		);
	});
});

describe('rollback rehearsal — the evidence levels stay distinct', () => {
	it('reports the levels that are present and no stronger one', () => {
		const result = runRollbackRehearsal();
		assert.deepEqual(result.evidence.levels, [
			EVIDENCE_LEVEL.recorded,
			EVIDENCE_LEVEL.simulatedAndTested,
		]);
		assert.equal(result.evidence.highest, EVIDENCE_LEVEL.simulatedAndTested);
		assert.equal(result.evidence.humanVerified, false);
		assert.equal(result.evidence.productionVerified, false);
	});

	it('never claims a human or a production verification', () => {
		const result = runRollbackRehearsal();
		for (const path of result.paths) {
			for (const step of path.steps) {
				assert.notEqual(step.evidence, EVIDENCE_LEVEL.humanVerified);
				assert.notEqual(step.evidence, EVIDENCE_LEVEL.productionVerified);
			}
		}
		assert.equal(result.summary.simulatedSteps > 0, true);
		assert.equal(result.summary.recordedSteps > 0, true);
	});

	it('rejects a table step that claims an evidence level it has not earned', () => {
		const paths = structuredClone(REHEARSAL_PATHS);
		paths[0].steps[0].evidence = EVIDENCE_LEVEL.productionVerified;
		const validation = validateRehearsal(paths);
		assert.equal(validation.ok, false);
		assert.ok(
			validation.errors.some((error) => error.code === ERROR_CODE.stepEvidenceNotRecorded),
			JSON.stringify(validation.errors),
		);
	});

	it('rejects a table step with no evidence level', () => {
		const paths = structuredClone(REHEARSAL_PATHS);
		paths[0].steps[0].evidence = undefined;
		const validation = validateRehearsal(paths);
		assert.equal(validation.ok, false);
		assert.ok(
			validation.errors.some((error) => error.code === ERROR_CODE.stepEvidenceMissing),
			JSON.stringify(validation.errors),
		);
	});

	it('lists the facts only the live platform can prove', () => {
		const result = runRollbackRehearsal();
		assert.ok(result.evidence.notVerified.length > 0);
		for (const fact of result.evidence.notVerified) {
			assert.ok(fact.fact.length > 0);
			assert.ok(fact.reason.length > 0);
			assert.ok(
				[EVIDENCE_LEVEL.humanVerified, EVIDENCE_LEVEL.productionVerified].includes(fact.requires),
				fact.requires,
			);
		}
		assert.equal(result.evidence.notVerified.length, NOT_VERIFIED_FACTS.length);
	});
});

describe('rollback rehearsal — the sensitive-value guard', () => {
	it('reports a detector id and a line number, never the matched text', () => {
		const findings = findSensitiveInText('token=abcdefgh12345678');
		assert.equal(findings.length, 1);
		assert.equal(findings[0].detectorId, 'secret-assignment');
		assert.equal(findings[0].line, 1);
		assert.equal('text' in findings[0], false);
	});

	it('detects each guarded shape', () => {
		const cases = [
			['someone@example.com', 'email'],
			['Bearer AAAAAAAAAAAAAAAAAAAA', 'bearer-token'],
			['-----BEGIN RSA PRIVATE KEY-----', 'private-key'],
			['AKIAIOSFODNN7EXAMPLE', 'aws-access-key'],
		];
		for (const [text, detectorId] of cases) {
			const findings = findSensitiveInText(text);
			assert.equal(findings.length, 1, text);
			assert.equal(findings[0].detectorId, detectorId, text);
		}
	});

	it('passes clean text and reports the line of an offender', () => {
		assert.equal(
			assertNoSensitiveInText('the build failed; the operator restores the release').ok,
			true,
		);
		const findings = findSensitiveInText('first line\nsecond line\nAKIAIOSFODNN7EXAMPLE');
		assert.equal(findings[0].line, 3);
	});
});

describe('rollback rehearsal — the capture artefact', () => {
	it('refuses a non-WebP output path', () => {
		assert.throws(() => assertWebpOutputPath('docs/verification/ops/rollback-rehearsal.png'));
		assert.doesNotThrow(() =>
			assertWebpOutputPath('docs/verification/ops/rollback-rehearsal.webp'),
		);
	});

	it('keeps the width cap and the budget, and offers a descending quality ladder', () => {
		assert.equal(SCREENSHOT_MAX_WIDTH, 1600);
		assert.equal(SCREENSHOT_BUDGET_BYTES, 300 * 1024);
		assert.deepEqual(SCREENSHOT_QUALITY_LADDER, [80, 72, 64, 56]);
		for (let index = 1; index < SCREENSHOT_QUALITY_LADDER.length; index += 1) {
			assert.ok(SCREENSHOT_QUALITY_LADDER[index] < SCREENSHOT_QUALITY_LADDER[index - 1]);
		}
	});

	it('decides the budget verdict on the byte count', () => {
		assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES).withinBudget, true);
		assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES + 1).withinBudget, false);
	});

	it('renders one path card per rehearsed path', () => {
		const result = runRollbackRehearsal();
		const html = renderRollbackRehearsalHtml(result);
		assert.ok(html.includes(`data-testid="${PAGE_TEST_ID}"`));
		const cards = html.split(`data-testid="${PATH_TEST_ID}"`).length - 1;
		assert.equal(cards, result.summary.pathCount);
		assert.equal(assertNoSensitiveInText(html).ok, true);
	});

	it('advertises a regeneration command that exists in package.json', () => {
		const html = renderRollbackRehearsalHtml(runRollbackRehearsal());
		const match = /Regenerate: <code>pnpm run ([^<]+)<\/code>/.exec(html);
		assert.ok(match, 'the page states how to regenerate the artefact');
		const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
		assert.ok(
			typeof pkg.scripts[match[1]] === 'string',
			`package.json has no "${match[1]}" script to regenerate the artefact with`,
		);
	});

	it('serves the report page at the root instead of the directory', () => {
		const dir = mkdtempSync(join(tmpdir(), 'rollback-rehearsal-'));
		try {
			writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>');
			const root = resolveStaticTarget(dir, '/');
			assert.equal(root.status, 200);
			assert.equal(root.file, join(dir, 'index.html'));
			assert.equal(resolveStaticTarget(dir, '/missing.html').status, 404);
			assert.equal(resolveStaticTarget(dir, '/../escape').status, 403);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('stages a candidate away from the committed path and promotes it only on success', () => {
		const dir = mkdtempSync(join(tmpdir(), 'rollback-rehearsal-'));
		try {
			const screenshot = join(dir, 'rollback-rehearsal.webp');
			const staged = stagedCapturePath(screenshot, dir);
			assert.notEqual(staged, screenshot);
			mkdirSync(dirname(staged), { recursive: true });
			writeFileSync(staged, 'candidate');
			promoteStagedCapture({ staged, screenshot, repoRoot: dir });
			assert.equal(readFileSync(screenshot, 'utf8'), 'candidate');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('rollback rehearsal — the capture stays on the loopback host', () => {
	it('treats loopback URLs as local and everything else as outbound', () => {
		assert.equal(isLoopbackRequestUrl('http://127.0.0.1:51234/index.html'), true);
		assert.equal(isLoopbackRequestUrl('http://localhost:51234/index.html'), true);
		assert.equal(isLoopbackRequestUrl('https://api.github.com/repos'), false);
		assert.equal(isLoopbackRequestUrl('https://rebuildup.dev/'), false);
	});
});

describe('rollback rehearsal — the CLI contract', () => {
	it('defaults to the committed WebP path and rejects an unknown option', () => {
		const options = parseArgs([]);
		assert.equal(options.screenshot, 'docs/verification/ops/rollback-rehearsal.webp');
		assert.throws(() => parseArgs(['--unknown-option']));
	});

	it('reads the base options', () => {
		const options = parseArgs(['--width=1200', '--no-capture', '--json-out=.tmp/r.json']);
		assert.equal(options.width, 1200);
		assert.equal(options.capture, false);
		assert.equal(options.jsonOut, '.tmp/r.json');
	});
});
