/**
 * The Issue #410 gate's own unit tests.
 *
 * The gate is an assertion about a RECORD, so the tests are assertions
 * about the gate: every rule it can report is exercised by a matrix
 * that breaks exactly that rule, and the repository's own matrix is
 * checked to produce no violation at all.
 *
 * The fixtures under `scripts/fixtures/a11y-wcag-review-matrix/` are
 * read by the gate itself (the two-stage design every sibling gate
 * uses): a `pass` fixture must report nothing, a `fail` fixture must
 * report the rule it declares. These tests check that the fixture set
 * is exact and that the two stages agree.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	CLAIM_PHRASES,
	CLAIM_QUALIFIERS,
	EXPECTED_FIXTURE_FILES,
	FIXTURE_FAIL_DIR,
	FIXTURE_PASS_DIR,
	REVIEW_RECORD_STATES,
	REVIEW_STATES,
	RULES,
	WCAG_22_CRITERIA,
	auditFixtures,
	auditMatrix,
	collectClaimSurfaceFiles,
	collectEvidence,
	daysBetween,
	findClaims,
	isIsoDate,
	renderGateSummary,
	validateShape,
} from './check-a11y-wcag-review-matrix.mjs';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const TODAY = '2026-10-23';

/** Every criterion the vocabulary knows. */
const ALL_SC = Object.keys(WCAG_22_CRITERIA);

/** The criteria the fixture matrices exclude. */
const EXCLUDED_SC = ['1.2.2', '1.2.4', '3.3.7'];

/**
 * A matrix that breaks nothing: every criterion is covered or excluded,
 * every state of the vocabulary is enumerated and reviewed, and every
 * surface and marker exists in the repository.
 */
function validMatrix() {
	const states = REVIEW_STATES.map((state) => ({
		id: state.id,
		description: `the ${state.id} state`,
	}));
	const covered = ALL_SC.filter((sc) => !EXCLUDED_SC.includes(sc));
	const items = states.map((state, index) => ({
		id: `state-${state.id}`,
		sc: index === 0 ? covered : ['1.1.1'],
		subject: `the ${state.id} state`,
		scope: 'the fixture surface only',
		surface: 'form-gallery',
		state: state.id,
		method: 'machine',
		autoGates: ['a11y:contrast:check'],
		review: { state: 'auto-pass' },
	}));
	return {
		version: 1,
		updatedAt: TODAY,
		reviewWindowDays: 365,
		states,
		surfaces: [
			{
				id: 'form-gallery',
				kind: 'story',
				path: 'src/editorial/forms/form-errors.stories.tsx',
				export: 'Gallery',
				reproduces: { empty: ['空欄'], error: ['失敗'], narrow: ['縮小表示'] },
			},
		],
		items,
		excluded: EXCLUDED_SC.map((sc) => ({
			sc,
			reason: 'the fixture does not publish pre-recorded media',
		})),
	};
}

/** The rules a matrix reports. */
function rulesOf(matrix, options = {}) {
	return auditMatrix(matrix, { today: TODAY, repoRoot: REPO_ROOT, ...options }).violations.map(
		(violation) => violation.rule,
	);
}

/** The first item of a matrix. */
function firstItem(matrix) {
	return matrix.items[0];
}

/* ------------------------------------------------------------------ *
 * the vocabulary
 * ------------------------------------------------------------------ */

test('the vocabulary holds Level A and Level AA criteria only', () => {
	const levels = new Set(Object.values(WCAG_22_CRITERIA).map((criterion) => criterion.level));
	assert.deepEqual([...levels].sort(), ['A', 'AA']);
	for (const [sc, criterion] of Object.entries(WCAG_22_CRITERIA)) {
		assert.match(sc, /^\d+\.\d+\.\d+$/, 'an SC number is a dotted triple');
		assert.ok(criterion.name.length > 0, `${sc} needs a name`);
	}
});

test('every state of the vocabulary is unique and described', () => {
	const ids = REVIEW_STATES.map((state) => state.id);
	assert.equal(new Set(ids).size, ids.length);
	for (const state of REVIEW_STATES) {
		assert.ok(state.description.length > 0, `${state.id} needs a description`);
		assert.ok(['default', 'markup', 'interaction'].includes(state.kind));
	}
});

test('the review record states are separate: an automatic pass is not a human verification', () => {
	assert.deepEqual(Object.keys(REVIEW_RECORD_STATES).sort(), [
		'auto-pass',
		'human-failed',
		'human-verified',
		'not-reviewed',
	]);
	assert.equal(REVIEW_RECORD_STATES['auto-pass'].method, 'machine');
	assert.equal(REVIEW_RECORD_STATES['human-verified'].method, 'human');
	assert.equal(REVIEW_RECORD_STATES['auto-pass'].result, null);
	assert.equal(REVIEW_RECORD_STATES['human-verified'].result, 'pass');
	assert.equal(REVIEW_RECORD_STATES['human-failed'].result, 'fail');
});

test('the rules the gate can report are the documented ones', () => {
	for (const rule of [
		'item-field-missing',
		'item-duplicate-id',
		'item-sc-unknown',
		'item-state-unknown',
		'item-method-invalid',
		'item-review-state-invalid',
		'item-evidence-missing',
		'item-evidence-stale',
		'item-auto-gate-missing',
		'surface-missing',
		'surface-state-missing',
		'state-undisposed',
		'state-uncovered',
		'criterion-undisposed',
		'criterion-exclusion-reason-missing',
		'criterion-conflict',
		'compliance-claim-unbacked',
		'fixture-expectation-mismatch',
		'fixture-contract-missing',
	]) {
		assert.ok(RULES.includes(rule), `${rule} must be a documented rule`);
	}
});

/* ------------------------------------------------------------------ *
 * the shape
 * ------------------------------------------------------------------ */

test('a matrix that is not a matrix cannot be judged', () => {
	assert.deepEqual(validateShape(null), ['the matrix is not a JSON object']);
	assert.deepEqual(validateShape([]), ['the matrix is not a JSON object']);
	assert.ok(
		validateShape({ version: 2, items: [], surfaces: [], states: [], excluded: [] }).length > 0,
	);
	assert.ok(validateShape({ ...validMatrix(), reviewWindowDays: 0 }).length > 0);
	assert.deepEqual(validateShape(validMatrix()), []);
});

/* ------------------------------------------------------------------ *
 * the items
 * ------------------------------------------------------------------ */

test('a required field that is missing is reported', () => {
	for (const field of ['id', 'subject', 'scope', 'surface', 'state', 'method']) {
		const matrix = validMatrix();
		delete firstItem(matrix)[field];
		assert.ok(rulesOf(matrix).includes('item-field-missing'), `a missing ${field} is reported`);
	}
});

test('two items with the same id are reported', () => {
	const matrix = validMatrix();
	matrix.items[1].id = matrix.items[0].id;
	assert.ok(rulesOf(matrix).includes('item-duplicate-id'));
});

test('a success criterion the vocabulary does not know is reported', () => {
	const matrix = validMatrix();
	matrix.items[0].sc = ['9.9.9'];
	assert.ok(rulesOf(matrix).includes('item-sc-unknown'));
});

test('a state the vocabulary does not know is reported', () => {
	const matrix = validMatrix();
	matrix.items[0].state = 'wide-screen';
	assert.ok(rulesOf(matrix).includes('item-state-unknown'));
});

test('an item that does not say who decides it is reported', () => {
	const matrix = validMatrix();
	matrix.items[0].method = 'somebody';
	assert.ok(rulesOf(matrix).includes('item-method-invalid'));
});

test('an automatic pass may not be recorded as a human verification', () => {
	const matrix = validMatrix();
	matrix.items[0].method = 'human';
	matrix.items[0].review = { state: 'auto-pass' };
	assert.ok(rulesOf(matrix).includes('item-review-state-invalid'));
});

test('a human item may not be recorded as an automatic pass', () => {
	const matrix = validMatrix();
	matrix.items[0].method = 'human';
	matrix.items[0].autoGates = [];
	matrix.items[0].review = { state: 'human-verified' };
	// The state belongs to a human review, so the method fits — but the
	// evidence is missing.
	assert.ok(!rulesOf(matrix).includes('item-review-state-invalid'));
	assert.ok(rulesOf(matrix).includes('item-evidence-missing'));
});

test('an automatic pass carries no reviewer, date, environment or result', () => {
	for (const field of ['reviewer', 'performedAt', 'environment', 'result']) {
		const matrix = validMatrix();
		matrix.items[0].review[field] = 'something';
		assert.ok(
			rulesOf(matrix).includes('item-review-state-invalid'),
			`an automatic pass must not carry ${field}`,
		);
	}
});

test('an automatic pass must name the gate that produced it', () => {
	const matrix = validMatrix();
	matrix.items[0].autoGates = [];
	assert.ok(rulesOf(matrix).includes('item-review-state-invalid'));
});

test('a performed review without a reviewer is reported', () => {
	const matrix = validMatrix();
	matrix.items[0].method = 'human';
	matrix.items[0].autoGates = [];
	matrix.items[0].review = {
		state: 'human-verified',
		assignedTo: 'owner',
		performedAt: '2026-10-01',
		environment: 'Chromium',
		result: 'pass',
	};
	assert.ok(rulesOf(matrix).includes('item-evidence-missing'));
});

test('a performed review whose result disagrees with its state is reported', () => {
	const matrix = validMatrix();
	matrix.items[0].method = 'human';
	matrix.items[0].autoGates = [];
	matrix.items[0].review = {
		state: 'human-verified',
		assignedTo: 'owner',
		reviewer: 'owner',
		performedAt: '2026-10-01',
		environment: 'Chromium',
		result: 'fail',
	};
	assert.ok(rulesOf(matrix).includes('item-evidence-missing'));
});

test('a review that is waiting for a person carries no evidence', () => {
	const matrix = validMatrix();
	matrix.items[0].method = 'human';
	matrix.items[0].autoGates = [];
	matrix.items[0].review = { state: 'not-reviewed', assignedTo: 'owner', result: 'pass' };
	assert.ok(rulesOf(matrix).includes('item-review-state-invalid'));
});

test('a review that is waiting for a person names who owes it', () => {
	const matrix = validMatrix();
	matrix.items[0].method = 'human';
	matrix.items[0].autoGates = [];
	matrix.items[0].review = { state: 'not-reviewed' };
	assert.ok(rulesOf(matrix).includes('item-evidence-missing'));
});

test('evidence older than the review window is reported', () => {
	const matrix = validMatrix();
	matrix.items[0].method = 'human';
	matrix.items[0].autoGates = [];
	matrix.items[0].review = {
		state: 'human-verified',
		assignedTo: 'owner',
		reviewer: 'owner',
		performedAt: '2024-01-01',
		environment: 'Chromium',
		result: 'pass',
	};
	assert.ok(rulesOf(matrix).includes('item-evidence-stale'));
});

test('evidence dated in the future is reported', () => {
	const matrix = validMatrix();
	matrix.items[0].method = 'human';
	matrix.items[0].autoGates = [];
	matrix.items[0].review = {
		state: 'human-verified',
		assignedTo: 'owner',
		reviewer: 'owner',
		performedAt: '2027-01-01',
		environment: 'Chromium',
		result: 'pass',
	};
	assert.ok(rulesOf(matrix).includes('item-evidence-stale'));
});

test('an npm script that does not exist is reported', () => {
	const matrix = validMatrix();
	matrix.items[0].autoGates = ['a11y:gate-that-does-not-exist'];
	assert.ok(rulesOf(matrix).includes('item-auto-gate-missing'));
});

/* ------------------------------------------------------------------ *
 * the surfaces
 * ------------------------------------------------------------------ */

test('a surface that is not declared is reported', () => {
	const matrix = validMatrix();
	matrix.items[0].surface = 'route-that-was-removed';
	assert.ok(rulesOf(matrix).includes('surface-missing'));
});

test('a surface whose file is gone is reported', () => {
	const matrix = validMatrix();
	matrix.surfaces[0].path = 'src/editorial/forms/a-story-that-was-removed.stories.tsx';
	assert.ok(rulesOf(matrix).includes('surface-state-missing'));
});

test('a surface that no longer reproduces the reviewed state is reported', () => {
	const matrix = validMatrix();
	// The story still exists, but the panel the table reviews is gone.
	matrix.surfaces[0].reproduces.narrow = ['縮小表示という語はもう無い'];
	assert.ok(rulesOf(matrix).includes('surface-state-missing'));
});

test('a story export that is gone is reported', () => {
	const matrix = validMatrix();
	matrix.surfaces[0].reproduces.narrow = ['export:ARemovedStory'];
	assert.ok(rulesOf(matrix).includes('surface-state-missing'));
});

test('a state the surface does not declare is reported', () => {
	const matrix = validMatrix();
	matrix.surfaces[0].reproduces = {};
	const errorItem = matrix.items.find((item) => item.state === 'empty');
	errorItem.state = 'empty';
	assert.ok(rulesOf(matrix).includes('surface-state-missing'));
});

/* ------------------------------------------------------------------ *
 * the states and the criteria
 * ------------------------------------------------------------------ */

test('a state of the vocabulary that is not enumerated is reported', () => {
	const matrix = validMatrix();
	matrix.states = matrix.states.filter((state) => state.id !== 'zoomed');
	assert.ok(rulesOf(matrix).includes('state-undisposed'));
});

test('an enumerated state that nobody reviews is reported', () => {
	const matrix = validMatrix();
	matrix.items = matrix.items.filter((item) => item.state !== 'screen-reader');
	assert.ok(rulesOf(matrix).includes('state-uncovered'));
});

test('a criterion that is neither covered nor excluded is reported', () => {
	const matrix = validMatrix();
	matrix.excluded = matrix.excluded.filter((entry) => entry.sc !== '1.2.4');
	matrix.items[0].sc = matrix.items[0].sc.filter((sc) => sc !== '1.2.4');
	assert.ok(rulesOf(matrix).includes('criterion-undisposed'));
});

test('an exclusion without a reason is reported', () => {
	const matrix = validMatrix();
	matrix.excluded[0].reason = '   ';
	assert.ok(rulesOf(matrix).includes('criterion-exclusion-reason-missing'));
});

test('a criterion that is both covered and excluded is reported', () => {
	const matrix = validMatrix();
	matrix.excluded.push({ sc: '1.1.1', reason: 'a contradictory record' });
	assert.ok(rulesOf(matrix).includes('criterion-conflict'));
});

/* ------------------------------------------------------------------ *
 * the conformance claim
 * ------------------------------------------------------------------ */

test('a claim without a human verification is reported', () => {
	const matrix = validMatrix();
	matrix.$claims = [
		{
			file: 'docs/verification/a11y/example.md',
			line: 3,
			phrase: CLAIM_PHRASES[0],
			text: 'the site is AA 準拠済み',
			citesMatrix: true,
		},
	];
	assert.ok(rulesOf(matrix).includes('compliance-claim-unbacked'));
});

test('a claim with a human verification that points at the matrix is accepted', () => {
	const matrix = validMatrix();
	matrix.items[0] = {
		...matrix.items[0],
		method: 'human',
		autoGates: [],
		review: {
			state: 'human-verified',
			assignedTo: 'owner',
			reviewer: 'owner',
			performedAt: '2026-10-01',
			environment: 'Chromium',
			result: 'pass',
		},
	};
	matrix.$claims = [
		{
			file: 'docs/verification/a11y/example.md',
			line: 3,
			phrase: CLAIM_PHRASES[0],
			text: 'the site is AA 準拠済み — see docs/verification/a11y/wcag-review-matrix.md',
			citesMatrix: true,
		},
	];
	assert.ok(!rulesOf(matrix).includes('compliance-claim-unbacked'));
});

test('a line that qualifies the phrase is a mention, not a claim', () => {
	const claims = findClaims(`この文書は ${CLAIM_PHRASES[0]} と書かない。`, { file: 'a.md' });
	assert.deepEqual(claims, []);
	const real = findClaims(`この文書は ${CLAIM_PHRASES[0]} です。`, { file: 'a.md' });
	assert.equal(real.length, 1);
	assert.equal(real[0].phrase, CLAIM_PHRASES[0]);
	assert.equal(real[0].line, 1);
});

test('the qualifier list is not empty and the phrase list is not empty', () => {
	assert.ok(CLAIM_PHRASES.length > 0);
	assert.ok(CLAIM_QUALIFIERS.length > 0);
});

test('the documentation is the claim surface, and it is read', () => {
	const files = collectClaimSurfaceFiles({ repoRoot: REPO_ROOT });
	assert.ok(files.includes('README.md'));
	assert.ok(
		files.includes('docs/verification/a11y/axe-route-report.md'),
		'the a11y verification notes are claim surfaces',
	);
});

/* ------------------------------------------------------------------ *
 * the helpers
 * ------------------------------------------------------------------ */

test('the date helpers read an ISO date and a distance', () => {
	assert.equal(isIsoDate('2026-10-23'), true);
	assert.equal(isIsoDate('2026-10-32'), false);
	assert.equal(isIsoDate('not a date'), false);
	assert.equal(daysBetween('2026-10-01', '2026-10-23'), 22);
	assert.equal(daysBetween('2026-10-23', '2026-10-01'), -22);
});

/* ------------------------------------------------------------------ *
 * the repository's own matrix
 * ------------------------------------------------------------------ */

test('the repository matrix reports no violation', () => {
	const evidence = collectEvidence({ today: TODAY, repoRoot: REPO_ROOT });
	assert.deepEqual(evidence.violations, []);
});

test('the repository matrix covers every criterion or excludes it with a reason', () => {
	const evidence = collectEvidence({ today: TODAY, repoRoot: REPO_ROOT });
	for (const sc of ALL_SC) {
		const covered = evidence.coveredCriteria.some((entry) => entry.sc === sc);
		const excluded = evidence.excluded.some((entry) => entry.sc === sc);
		assert.ok(covered || excluded, `SC ${sc} must be covered or excluded`);
	}
	for (const entry of evidence.excluded) {
		assert.ok(entry.reason.trim().length > 0, `SC ${entry.sc} needs a reason`);
	}
});

test('the repository matrix states every state and reviews every state', () => {
	const evidence = collectEvidence({ today: TODAY, repoRoot: REPO_ROOT });
	assert.equal(evidence.states.length, REVIEW_STATES.length);
	const reviewed = new Set(evidence.items.map((item) => item.state));
	for (const state of REVIEW_STATES) {
		assert.ok(reviewed.has(state.id), `the state ${state.id} must be reviewed by an item`);
	}
});

test('the repository matrix names a machine gate for every automatic pass', () => {
	const evidence = collectEvidence({ today: TODAY, repoRoot: REPO_ROOT });
	const automatic = evidence.items.filter((item) => item.review?.state === 'auto-pass');
	assert.ok(automatic.length > 0, 'the matrix has machine-checked items');
	for (const item of automatic) {
		assert.ok(item.autoGates.length > 0, `${item.id} must name its gate`);
	}
});

test('the repository matrix has no human verification yet, and says so', () => {
	const evidence = collectEvidence({ today: TODAY, repoRoot: REPO_ROOT });
	assert.equal(evidence.humanVerified, 0);
	assert.ok(evidence.outstanding > 0, 'the outstanding human reviews are reported');
	const report = renderGateSummary(evidence);
	assert.match(report, /site-level conformance claim: NOT available/);
	assert.match(report, /does not mean the site conforms to WCAG 2\.2 AA/);
});

test('the report separates the two kinds of review', () => {
	const report = renderGateSummary(collectEvidence({ today: TODAY, repoRoot: REPO_ROOT }));
	assert.match(report, /machine-checked \(an npm gate decided it — NOT a human verification\)/);
	assert.match(
		report,
		/human review \(a person performs it; an automatic pass is not a substitute\)/,
	);
	assert.match(report, /excluded criteria \(stated, not dropped silently\)/);
});

/* ------------------------------------------------------------------ *
 * the fixtures
 * ------------------------------------------------------------------ */

test('the fixture directories exist and hold exactly the expected files', () => {
	for (const [directory, expected] of [
		[FIXTURE_PASS_DIR, EXPECTED_FIXTURE_FILES.pass],
		[FIXTURE_FAIL_DIR, EXPECTED_FIXTURE_FILES.fail],
	]) {
		const absolute = resolve(REPO_ROOT, directory);
		assert.ok(existsSync(absolute), `${directory} must exist`);
		const found = readdirSync(absolute)
			.filter((name) => name.endsWith('.json'))
			.sort();
		assert.deepEqual(found, [...expected].sort(), `${directory} must hold exactly its fixtures`);
	}
});

test('the fixture audit agrees with the expectations the fixtures declare', () => {
	const audited = auditFixtures({ repoRoot: REPO_ROOT, today: TODAY });
	assert.deepEqual(audited.violations, []);
	assert.equal(
		audited.files.length,
		EXPECTED_FIXTURE_FILES.pass.length + EXPECTED_FIXTURE_FILES.fail.length,
	);
});

test('every rule the fixtures can produce is exercised by a fixture', () => {
	const audited = auditFixtures({ repoRoot: REPO_ROOT, today: TODAY });
	const produced = new Set(audited.files.flatMap((file) => file.produced));
	for (const rule of [
		'item-evidence-missing',
		'item-state-unknown',
		'item-review-state-invalid',
		'surface-missing',
		'surface-state-missing',
		'compliance-claim-unbacked',
		'criterion-exclusion-reason-missing',
		'item-auto-gate-missing',
		'item-evidence-stale',
		'state-uncovered',
		'criterion-conflict',
	]) {
		assert.ok(produced.has(rule), `a fixture must produce ${rule}`);
	}
});

test('the pass fixtures report nothing at all', () => {
	const audited = auditFixtures({ repoRoot: REPO_ROOT, today: TODAY });
	for (const file of audited.files.filter((entry) => entry.expectation === 'pass')) {
		assert.deepEqual(file.violations, [], `${file.path} must report nothing`);
	}
});

test('a fixture that is not a matrix is refused', () => {
	const matrix = validMatrix();
	matrix.version = 7;
	assert.ok(validateShape(matrix).length > 0);
});

test('the gate can be pointed at another matrix', () => {
	const evidence = collectEvidence({
		today: TODAY,
		repoRoot: REPO_ROOT,
		matrixPath: join(FIXTURE_PASS_DIR, '01-intact-matrix.json'),
	});
	assert.deepEqual(evidence.violations, []);
});
