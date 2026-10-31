/**
 * The Issue #402 gate's own unit tests.
 *
 * The gate is the machine half of the Issue ("the record of the manual
 * screen-reader review stays intact"), so the rules have to be testable
 * without a screen reader: a rule that can only fail inside a real
 * assistive technology is a rule nobody re-runs when it breaks.
 *
 * The fixture assertions are deliberately strict. A test that only
 * checked "the fixture produced some output" would pass after a fixture
 * file was deleted or after the fixture stopped reproducing its defect,
 * so the roster is compared with the directory listing and every fail
 * fixture is matched against the rule it stands for.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	FIXTURE_FAIL_DIR,
	FIXTURE_FILES,
	FIXTURE_PASS_DIR,
	LEDGER_PATH,
	REQUIRED_STEP_FIELDS,
	RESULTS,
	RULES,
	daysBetween,
	evaluateFixtures,
	evaluateLedger,
	evaluateStep,
	hasObservation,
	isEmpty,
	isPerformed,
	leansOnAutomatedAudit,
	observationMentionsAudit,
	renderReport,
	repoFileExists,
	readFixtureFiles,
	readRepoFile,
	summarizeLedger,
} from './check-a11y-screenreader-steps.mjs';

const REPO_ROOT = new URL('..', import.meta.url).pathname;
const TODAY = new Date('2026-10-23T00:00:00Z');

/** The committed ledger. */
const LEDGER = JSON.parse(readFileSync(join(REPO_ROOT, LEDGER_PATH), 'utf8'));

/** Evaluate a ledger against the real repository. */
function evaluate(ledger, { today = TODAY } = {}) {
	return evaluateLedger({
		ledger,
		exists: (path) => repoFileExists(path, REPO_ROOT),
		readFile: (path) => readRepoFile(path, REPO_ROOT),
		today,
	});
}

/** The rules a ledger reports, without duplicates. */
function rulesOf(ledger) {
	return [...new Set(evaluate(ledger).map((violation) => violation.rule))].sort();
}

/** A copy of the committed ledger. */
function ledgerCopy() {
	return JSON.parse(JSON.stringify(LEDGER));
}

test('an empty observation is a legitimate state, not an incomplete record', () => {
	assert.equal(isEmpty(''), true);
	assert.equal(isEmpty('   '), true);
	assert.equal(isEmpty(null), true);
	assert.equal(isEmpty(undefined), true);
	assert.equal(isEmpty([]), true);
	assert.equal(isEmpty('value'), false);
});

test('a step that has not been performed carries no observation', () => {
	const step = { result: 'not-performed' };
	assert.equal(isPerformed(step), false);
	assert.equal(hasObservation(step), false);

	const performed = {
		result: 'pass',
		observedAnnounce: '「my-web-2026、見出しレベル 1」',
		performer: 'owner',
		performedAt: '2026-10-20',
	};
	assert.equal(isPerformed(performed), true);
	assert.equal(hasObservation(performed), true);
});

test('the days between two dates are counted in whole days', () => {
	assert.equal(daysBetween(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-02T00:00:00Z')), 1);
	assert.equal(daysBetween(new Date('2026-01-02T00:00:00Z'), new Date('2026-01-01T00:00:00Z')), -1);
});

test('an automated audit is refused as the evidence of a human review', () => {
	assert.equal(leansOnAutomatedAudit('axe の合格だけで確認済みとする。'), true);
	assert.equal(leansOnAutomatedAudit('the axe run passed, so it is verified'), true);
	assert.equal(leansOnAutomatedAudit('axe-core の監査は Issue #393 の担当'), false);
	assert.equal(leansOnAutomatedAudit('axe の監査は別の Issue で実施している'), false);
	assert.equal(leansOnAutomatedAudit(''), false);
	assert.equal(observationMentionsAudit('「my-web-2026、見出しレベル 1」'), false);
	assert.equal(observationMentionsAudit('axe-core が 0 violations'), true);
});

test('the committed ledger is intact', () => {
	const violations = evaluate(LEDGER);
	assert.deepEqual(
		violations.map((violation) => `${violation.rule}:${violation.id ?? ''}`),
		[],
	);
});

test('the committed ledger has not been reviewed yet, and says so', () => {
	const summary = summarizeLedger(LEDGER);
	assert.equal(summary.steps, LEDGER.steps.length);
	assert.equal(summary.performed, 0);
	assert.equal(summary.notPerformed, LEDGER.steps.length);
});

test('every step names the operation, the surface, the assistive technology and the expectation', () => {
	for (const step of LEDGER.steps) {
		for (const field of REQUIRED_STEP_FIELDS) {
			assert.equal(isEmpty(step[field]), false, `${step.id} is missing ${field}`);
		}
		assert.equal(RESULTS.includes(step.result), true);
	}
});

test('a step without a required field is reported', () => {
	const ledger = ledgerCopy();
	const { operation, ...withoutOperation } = ledger.steps[0];
	ledger.steps[0] = withoutOperation;
	assert.equal(rulesOf(ledger).includes('step-field-missing'), true);
});

test('a performed step without a performer is reported', () => {
	const ledger = ledgerCopy();
	const { performer, ...withoutPerformer } = ledger.steps[0];
	ledger.steps[0] = {
		...withoutPerformer,
		result: 'pass',
		observedAnnounce: '「本文へスキップ、リンク」',
		performedAt: '2026-10-20',
	};
	assert.equal(rulesOf(ledger).includes('step-evidence-missing'), true);
});

test('a step that has not been performed but carries an observation is reported', () => {
	const ledger = ledgerCopy();
	ledger.steps[0].observedAnnounce = '「本文へスキップ、リンク」';
	assert.equal(rulesOf(ledger).includes('step-evidence-mismatch'), true);
});

test('a step that points at a surface that is gone is reported', () => {
	const ledger = ledgerCopy();
	ledger.steps[0].surface.path = 'src/routes/does-not-exist.tsx';
	assert.equal(rulesOf(ledger).includes('step-surface-missing'), true);
});

test('a path that escapes the repository is refused, even when the sibling directory shares the repository prefix', () => {
	const base = mkdtempSync(join(tmpdir(), 'a11y-screenreader-steps-'));
	try {
		const root = join(base, 'repo');
		const sibling = join(base, 'repo-private');
		mkdirSync(root, { recursive: true });
		mkdirSync(sibling, { recursive: true });
		writeFileSync(join(sibling, 'evidence.tsx'), 'export const Evidence = 1;\n');

		// The escape lands on a real file, and its path starts with the
		// repository root as a STRING — the case a prefix comparison
		// cannot tell apart from a path inside the repository.
		assert.equal(join(sibling, 'evidence.tsx').startsWith(root), true);
		assert.equal(repoFileExists('../repo-private/evidence.tsx', root), false);
		assert.equal(readRepoFile('../repo-private/evidence.tsx', root), null);

		// A file that really is inside the repository is still found.
		writeFileSync(join(root, 'inside.tsx'), 'export const Inside = 1;\n');
		assert.equal(repoFileExists('inside.tsx', root), true);
		assert.equal(readRepoFile('inside.tsx', root), 'export const Inside = 1;\n');

		// The repository root itself is a directory, not a reviewable surface.
		assert.equal(repoFileExists('.', root), false);
		assert.equal(repoFileExists('..', root), false);

		// The gate stays fail-closed: a step that points outside the
		// repository is a violation, never a pass.
		const ledger = ledgerCopy();
		ledger.steps[0].surface.path = '../repo-private/evidence.tsx';
		const violations = evaluateStep(ledger.steps[0], {
			ledger,
			exists: (path) => repoFileExists(path, root),
			readFile: (path) => readRepoFile(path, root),
			today: TODAY,
		});
		assert.equal(
			violations.some((violation) => violation.rule === 'step-surface-missing'),
			true,
		);
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test('a step that points at a story export that is gone is reported', () => {
	const ledger = ledgerCopy();
	ledger.steps[0].surface.path = 'src/editorial/forms/form-errors.stories.tsx';
	ledger.steps[0].surface.export = 'NoSuchStory';
	assert.equal(rulesOf(ledger).includes('step-surface-missing'), true);
});

test('a step that leans on an automated audit is reported', () => {
	const ledger = ledgerCopy();
	ledger.steps[0].notes = 'axe の合格だけで確認済みとする。';
	assert.equal(rulesOf(ledger).includes('step-axe-substituted'), true);
});

test('a performed step whose observation comes from an automated audit is reported', () => {
	const ledger = ledgerCopy();
	const step = ledger.steps[0];
	step.result = 'pass';
	step.observedAnnounce = 'axe-core が 0 violations だった';
	step.performer = 'owner';
	step.performedAt = '2026-10-20';
	assert.equal(rulesOf(ledger).includes('step-axe-substituted'), true);
});

test('a step that names an unknown subject, state, criterion or technology is reported', () => {
	const subject = ledgerCopy();
	subject.steps[0].subject = 'colour-contrast';
	assert.equal(rulesOf(subject).includes('step-subject-unknown'), true);

	const state = ledgerCopy();
	state.steps[0].surface.state = 'zoomed-to-400-percent';
	assert.equal(rulesOf(state).includes('step-state-unknown'), true);

	const criterion = ledgerCopy();
	criterion.steps[0].wcag = ['9.9.9'];
	assert.equal(rulesOf(criterion).includes('step-wcag-unknown'), true);

	const technology = ledgerCopy();
	technology.steps[0].assistiveTechnology = 'SomeOtherReader';
	assert.equal(rulesOf(technology).includes('step-assistive-technology-unknown'), true);
});

test('a step with a result outside the vocabulary is reported', () => {
	const ledger = ledgerCopy();
	ledger.steps[0].result = 'maybe';
	assert.equal(rulesOf(ledger).includes('step-result-invalid'), true);
});

test('two steps with the same id are reported', () => {
	const ledger = ledgerCopy();
	ledger.steps[1].id = ledger.steps[0].id;
	assert.equal(rulesOf(ledger).includes('step-duplicate-id'), true);
});

test('a declared subject, state or criterion without a step is reported', () => {
	const subject = ledgerCopy();
	subject.steps = subject.steps.filter((step) => step.subject !== 'input-error');
	assert.equal(rulesOf(subject).includes('subject-uncovered'), true);

	const state = ledgerCopy();
	state.steps = state.steps.filter((step) => step.surface?.state !== 'error');
	assert.equal(rulesOf(state).includes('state-uncovered'), true);

	const criterion = ledgerCopy();
	for (const step of criterion.steps) {
		step.wcag = step.wcag.filter((entry) => entry !== '3.3.1');
		if (step.wcag.length === 0) step.wcag = ['1.3.1'];
	}
	assert.equal(rulesOf(criterion).includes('criterion-uncovered'), true);
});

test('an observation older than the review window has to be made again', () => {
	const ledger = ledgerCopy();
	const step = ledger.steps[0];
	step.result = 'pass';
	step.observedAnnounce = '「本文へスキップ、リンク」';
	step.performer = 'owner';
	step.performedAt = '2024-01-05';
	assert.equal(rulesOf(ledger).includes('step-evidence-stale'), true);
});

test('an observation dated in the future is refused', () => {
	const ledger = ledgerCopy();
	const step = ledger.steps[0];
	step.result = 'pass';
	step.observedAnnounce = '「本文へスキップ、リンク」';
	step.performer = 'owner';
	step.performedAt = '2027-01-05';
	assert.equal(rulesOf(ledger).includes('step-evidence-stale'), true);
});

test('every rule the Issue names is a rule the gate knows', () => {
	for (const rule of [
		'step-field-missing',
		'step-duplicate-id',
		'step-subject-unknown',
		'step-state-unknown',
		'step-wcag-unknown',
		'step-assistive-technology-unknown',
		'step-result-invalid',
		'step-evidence-missing',
		'step-evidence-mismatch',
		'step-evidence-stale',
		'step-surface-missing',
		'step-axe-substituted',
		'subject-uncovered',
		'state-uncovered',
		'criterion-uncovered',
		'fixture-expectation-mismatch',
		'fixture-contract-missing',
	]) {
		assert.equal(RULES.includes(rule), true, `${rule} is not a rule the gate knows`);
	}
});

test('the fixture roster matches the fixture directory exactly', () => {
	const files = readFixtureFiles(REPO_ROOT);
	assert.deepEqual(files.pass, FIXTURE_FILES.pass);
	assert.deepEqual(files.fail, FIXTURE_FILES.fail);
});

test('every pass fixture produces no violation', () => {
	for (const file of readFixtureFiles(REPO_ROOT).pass) {
		const fixture = JSON.parse(readFileSync(join(REPO_ROOT, FIXTURE_PASS_DIR, file), 'utf8'));
		assert.deepEqual(evaluate(fixture), [], `${file} must not report a violation`);
	}
});

test('every fail fixture reproduces exactly the rule it stands for', () => {
	for (const file of readFixtureFiles(REPO_ROOT).fail) {
		const fixture = JSON.parse(readFileSync(join(REPO_ROOT, FIXTURE_FAIL_DIR, file), 'utf8'));
		const found = rulesOf(fixture);
		assert.deepEqual(
			found,
			[...new Set(fixture.$expects)].sort(),
			`${file} does not stand for what it claims`,
		);
	}
});

test('a fixture that stops reproducing its defect is reported', () => {
	const files = readFixtureFiles(REPO_ROOT);
	const violations = evaluateFixtures({
		fixtureFiles: files,
		exists: (path) => repoFileExists(path, REPO_ROOT),
		readFile: (path) => readRepoFile(path, REPO_ROOT),
		today: TODAY,
	});
	assert.deepEqual(
		violations.map((violation) => violation.rule),
		[],
	);
});

test('a fixture that is missing from the roster is reported', () => {
	const violations = evaluateFixtures({
		fixtureFiles: { pass: [], fail: readFixtureFiles(REPO_ROOT).fail },
		exists: (path) => repoFileExists(path, REPO_ROOT),
		readFile: (path) => readRepoFile(path, REPO_ROOT),
		today: TODAY,
	});
	assert.equal(
		violations.some((violation) => violation.rule === 'fixture-contract-missing'),
		true,
	);
});

test('the report says that an intact ledger is not a screen-reader verification', () => {
	const report = renderReport({
		ledger: LEDGER,
		summary: summarizeLedger(LEDGER),
		violations: [],
	});
	assert.match(report, /no violations/);
	assert.match(report, /not mean the site was read aloud/);
	assert.match(report, /9 of 9 step\(s\) are still not performed/);
});

test('a step is judged by the same function whether it is a fixture or the ledger', () => {
	const step = LEDGER.steps[0];
	const violations = evaluateStep(step, {
		ledger: LEDGER,
		exists: (path) => repoFileExists(path, REPO_ROOT),
		readFile: (path) => readRepoFile(path, REPO_ROOT),
		today: TODAY,
	});
	assert.deepEqual(violations, []);
});
