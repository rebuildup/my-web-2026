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
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	CLAIM_NEGATIONS,
	CLAIM_PATTERNS,
	CLAIM_QUALIFIERS,
	EXPECTED_FIXTURE_FILES,
	EXPECTED_SCOPE_FIXTURE_FILES,
	FIXTURE_FAIL_DIR,
	FIXTURE_PASS_DIR,
	FIXTURE_REFERENCE_DATE,
	MATRIX_CITATIONS,
	REVIEW_RECORD_STATES,
	REVIEW_STATES,
	RULES,
	SCOPE_DECISIONS,
	SCOPE_DISPOSITIONS,
	SCOPE_FIXTURE_ROOT,
	WCAG_22_A_AA_UNIVERSE,
	WCAG_22_CRITERIA,
	WCAG_22_OBSOLETE_CRITERIA,
	auditCriterionUniverse,
	auditFixtures,
	auditMatrix,
	auditScopeDecisions,
	auditScopeDispositions,
	auditScopeFixtures,
	auditSurfaceTarget,
	citesCanonicalMatrix,
	collectClaimSurfaceFiles,
	collectEvidence,
	compareCriterionSets,
	compareCriterionUniverse,
	compareFixtureExpectations,
	compareScopeDecisions,
	daysBetween,
	findClaimMatches,
	findClaims,
	isIsoDate,
	loadScopeDecisions,
	looksLikeTableCoverageReason,
	parseOptions,
	parseScopeDecisionTable,
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
		'criterion-universe-mismatch',
		'compliance-claim-unbacked',
		'scope-decision-doc-mismatch',
		'scope-disposition-invalid',
		'scope-exclusion-not-a-product-fact',
		'scope-unverified-missing-review-plan',
		'scope-verified-without-review-record',
		'release-assessment-unbacked',
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
			phrase: 'AA 準拠',
			text: 'the site is AA 準拠済み',
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
			phrase: 'AA 準拠',
			text: 'the site is AA 準拠済み — see docs/verification/a11y/wcag-review-matrix.md',
		},
	];
	assert.ok(!rulesOf(matrix).includes('compliance-claim-unbacked'));
});

test('a claim that points at a document that is not the record is not backed', () => {
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
			phrase: 'AA 準拠',
			text: 'the site is AA 準拠済み — see wcag-review-matrix-old.md',
		},
	];
	assert.ok(rulesOf(matrix).includes('compliance-claim-unbacked'));
});

test('one verified item does not back a site-level claim while the rest is outstanding', () => {
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
	matrix.items[1] = {
		...matrix.items[1],
		method: 'human',
		autoGates: [],
		review: { state: 'not-reviewed', assignedTo: 'owner' },
	};
	matrix.$claims = [
		{
			file: 'docs/verification/a11y/example.md',
			line: 3,
			phrase: 'AA 準拠',
			text: 'the site is AA 準拠済み — see docs/verification/a11y/wcag-review-matrix.md',
		},
	];
	assert.ok(rulesOf(matrix).includes('compliance-claim-unbacked'));
});

test('a failed manual item does not back a site-level claim', () => {
	const matrix = validMatrix();
	matrix.items[0] = {
		...matrix.items[0],
		method: 'human',
		autoGates: [],
		review: {
			state: 'human-failed',
			assignedTo: 'owner',
			reviewer: 'owner',
			performedAt: '2026-10-01',
			environment: 'Chromium',
			result: 'fail',
		},
	};
	matrix.$claims = [
		{
			file: 'docs/verification/a11y/example.md',
			line: 3,
			phrase: 'AA 準拠',
			text: 'the site is AA 準拠済み — see docs/verification/a11y/wcag-review-matrix.md',
		},
	];
	assert.ok(rulesOf(matrix).includes('compliance-claim-unbacked'));
});

test('a line that qualifies the phrase is a mention, not a claim', () => {
	const claims = findClaims('この文書は AA に準拠 と書かない。', { file: 'a.md' });
	assert.deepEqual(claims, []);
	const real = findClaims('この文書は AA に準拠 です。', { file: 'a.md' });
	assert.equal(real.length, 1);
	assert.equal(real[0].phrase, 'AA に準拠');
	assert.equal(real[0].line, 1);
});

test('the qualifier list is not empty and the pattern list is not empty', () => {
	assert.ok(CLAIM_PATTERNS.length > 0);
	assert.ok(CLAIM_QUALIFIERS.length > 0);
	assert.ok(CLAIM_NEGATIONS.length > 0);
});

test('the claim is the predicate, not a finished sentence', () => {
	for (const text of [
		'このサイトは WCAG 2.2 AA に準拠しています。',
		'このサイトは WCAG 2.2 AA に適合しています。',
		'このサイトは WCAG 2.2 AA 準拠済みです。',
		'このサイトは WCAG 2.2 AA 適合済みです。',
		'このサイトは WCAG 2.2 AA 準拠完了です。',
		'このサイトは WCAG 2.2 AA 適合完了と書いた。',
		'This site is WCAG 2.2 AA compliant.',
	]) {
		const claims = findClaims(text, { file: 'a.md' });
		assert.equal(claims.length, 1, `${text} must be reported as a claim`);
	}
});

test('a negation in another clause does not weaken the claim', () => {
	for (const text of [
		'説明がないが、このサイトは WCAG 2.2 AA 適合済みです。',
		'根拠がないが、このサイトは WCAG 2.2 AA 準拠済みです。',
		'記録が無い、しかしこのサイトは WCAG 2.2 AA に適合しています。',
	]) {
		const claims = findClaims(text, { file: 'a.md' });
		assert.equal(claims.length, 1, `${text} must be reported as a claim`);
	}
});

test('a qualifier next to the phrase turns the line into a mention', () => {
	for (const text of [
		'この文書は AA 準拠と主張しない。',
		'この文書は AA 適合の根拠にはならない。',
		'AA 準拠という語句は禁止',
	]) {
		const claims = findClaims(text, { file: 'a.md' });
		assert.deepEqual(claims, [], `${text} must be a mention`);
	}
});

test('a qualifier that is cut off from the phrase by a clause separator does not frame it', () => {
	const claims = findClaims('禁止語句: AA 準拠', { file: 'a.md' });
	assert.equal(claims.length, 1, 'the separator ends the qualifier\u2019s clause');
});

test('a qualifier in the next sentence does not frame the phrase', () => {
	const claims = findClaims('AA 適合済みの検査が 1 件ある。ただし証跡はない。', { file: 'a.md' });
	assert.equal(claims.length, 1, 'the negation belongs to another sentence');
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
 * the criterion universe (Codex finding X1)
 * ------------------------------------------------------------------ */

test('the universe is the single source of truth for levels and names', () => {
	for (const [sc, criterion] of Object.entries(WCAG_22_CRITERIA)) {
		assert.deepEqual(criterion, WCAG_22_A_AA_UNIVERSE[sc], `${sc} must come from the universe`);
	}
	for (const decision of SCOPE_DECISIONS) {
		assert.equal(decision.level, WCAG_22_A_AA_UNIVERSE[decision.sc].level);
		assert.equal(decision.name, WCAG_22_A_AA_UNIVERSE[decision.sc].name);
	}
});

test('the universe holds every Level A and Level AA criterion of WCAG 2.2', () => {
	const levels = Object.values(WCAG_22_A_AA_UNIVERSE).map((criterion) => criterion.level);
	assert.equal(Object.keys(WCAG_22_A_AA_UNIVERSE).length, 55);
	assert.equal(levels.filter((level) => level === 'A').length, 31);
	assert.equal(levels.filter((level) => level === 'AA').length, 24);
});

test('the obsolete criterion is recorded, not silently dropped', () => {
	assert.equal(WCAG_22_OBSOLETE_CRITERIA['4.1.1'].name, 'Parsing');
	assert.ok(!Object.keys(WCAG_22_A_AA_UNIVERSE).includes('4.1.1'));
	assert.ok(!Object.keys(WCAG_22_CRITERIA).includes('4.1.1'));
	assert.ok(!SCOPE_DECISIONS.some((decision) => decision.sc === '4.1.1'));
});

test('the two lists decide every criterion of the universe', () => {
	assert.deepEqual(compareCriterionUniverse(), []);
});

test('a criterion that neither list decides is reported', () => {
	const table = Object.fromEntries(
		Object.entries(WCAG_22_CRITERIA).filter(([sc]) => sc !== '1.4.3'),
	);
	const problems = compareCriterionSets({
		universe: WCAG_22_A_AA_UNIVERSE,
		table,
		scope: SCOPE_DECISIONS.map((decision) => ({
			sc: decision.sc,
			level: decision.level,
			name: decision.name,
		})),
	});
	assert.ok(problems.some((problem) => problem.includes('1.4.3')));
});

test('a criterion that is not a WCAG 2.2 A/AA criterion is reported', () => {
	const problems = compareCriterionSets({
		universe: WCAG_22_A_AA_UNIVERSE,
		table: {
			...WCAG_22_CRITERIA,
			'1.2.8': { level: 'AA', name: 'Media Alternative (Prerecorded)' },
		},
		scope: [],
	});
	assert.ok(problems.some((problem) => problem.includes('1.2.8')));
});

test('the obsolete criterion is reported with its reason', () => {
	const problems = compareCriterionSets({
		universe: WCAG_22_A_AA_UNIVERSE,
		table: { ...WCAG_22_CRITERIA, '4.1.1': { level: 'A', name: 'Parsing' } },
		scope: [],
	});
	assert.ok(problems.some((problem) => problem.includes('obsolete')));
});

test('the gate reports no universe violation', () => {
	assert.deepEqual(auditCriterionUniverse(), []);
});

/* ------------------------------------------------------------------ *
 * the conformance claim (Codex findings X2, X3, X6)
 * ------------------------------------------------------------------ */

test('the claim patterns do not depend on a fixed phrase list', () => {
	for (const text of [
		'このサイトは WCAG 2.2 AA に適合しています。',
		'このサイトは WCAG 2.2 AA に準拠しています。',
		'This site conforms to WCAG 2.2 AA.',
		'The site is WCAG 2.2 AA compliant.',
		'This site meets WCAG 2.2.',
		'WCAG 2.2 AA conformance is claimed here.',
	]) {
		const claims = findClaims(text, { file: 'a.md' });
		assert.equal(claims.length, 1, `${text} must be reported as a claim`);
	}
});

test('an English negation that is on another line still qualifies the claim', () => {
	const claims = findClaims(
		'A green run of this gate means the TABLE is intact.\nIt does not mean the site conforms to WCAG 2.2 AA.',
		{ file: 'a.md' },
	);
	assert.deepEqual(claims, []);
});

test('a claim that does not name the record is not backed', () => {
	assert.equal(citesCanonicalMatrix('see wcag-review-matrix', { repoRoot: REPO_ROOT }), false);
	assert.equal(
		citesCanonicalMatrix('see docs/verification/a11y/wcag-review-matrix.md', {
			repoRoot: REPO_ROOT,
		}),
		true,
	);
	assert.equal(
		citesCanonicalMatrix('see quality/wcag-review-matrix.json', { repoRoot: REPO_ROOT }),
		true,
	);
	assert.equal(
		citesCanonicalMatrix('see wcag-review-matrix-old.md', { repoRoot: REPO_ROOT }),
		false,
		'a file that does not exist is not a citation',
	);
});

test('a claim is backed when every manual item is verified and the record is named', () => {
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
			phrase: 'AA 準拠',
			text: 'the site is AA 準拠済み — see docs/verification/a11y/wcag-review-matrix.md',
		},
	];
	assert.ok(!rulesOf(matrix).includes('compliance-claim-unbacked'));
});

/* ------------------------------------------------------------------ *
 * the fixtures and the surfaces (Codex findings X4, X5)
 * ------------------------------------------------------------------ */

test('the fixture verdict does not depend on the day the gate runs', () => {
	const audited = auditFixtures({ repoRoot: REPO_ROOT, today: '2099-01-01' });
	for (const file of audited.files.filter((entry) => entry.expectation === 'pass')) {
		assert.deepEqual(file.violations, [], `${file.path} must report nothing`);
	}
	assert.equal(FIXTURE_REFERENCE_DATE, '2026-10-23');
});

test('a surface that points at a file that does not exist is reported', () => {
	const matrix = validMatrix();
	matrix.surfaces[0] = {
		...matrix.surfaces[0],
		path: 'src/editorial/forms/does-not-exist.stories.tsx',
	};
	assert.ok(rulesOf(matrix).includes('surface-missing'));
});

test('a surface whose story export was renamed is reported', () => {
	const matrix = validMatrix();
	matrix.surfaces[0] = { ...matrix.surfaces[0], export: 'GalleryThatWasRenamed' };
	assert.ok(rulesOf(matrix).includes('surface-missing'));
});

test('the surface is checked for every state, not only for the markup ones', () => {
	const matrix = validMatrix();
	matrix.surfaces[0] = {
		...matrix.surfaces[0],
		path: 'src/editorial/forms/does-not-exist.stories.tsx',
	};
	const audited = auditMatrix(matrix, { today: TODAY, repoRoot: REPO_ROOT });
	const surfaceMissing = audited.violations.filter((v) => v.rule === 'surface-missing');
	assert.ok(surfaceMissing.length > 0);
	assert.ok(
		surfaceMissing.every((v) => typeof v.message === 'string' && v.message.length > 0),
		'a surface violation has to say what is wrong',
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

test('a fixture is judged on its own: the repository documentation is not scanned', () => {
	const audited = auditFixtures({ repoRoot: REPO_ROOT, today: TODAY });
	for (const file of audited.files) {
		for (const claim of file.claims) {
			assert.ok(
				String(claim.file ?? '').startsWith('fixtures/'),
				`${file.path} must not inherit a claim from the repository documentation`,
			);
		}
	}
});

test('a fail fixture must declare exactly the rules it produces', () => {
	assert.deepEqual(
		compareFixtureExpectations('fail', ['item-evidence-missing'], ['item-evidence-missing']),
		[],
	);
	assert.equal(
		compareFixtureExpectations(
			'fail',
			['item-evidence-missing'],
			['item-evidence-missing', 'state-uncovered'],
		).length,
		1,
		'a rule the fixture produces but does not declare is a mismatch',
	);
	assert.equal(
		compareFixtureExpectations('fail', ['item-evidence-missing'], []).length,
		1,
		'a rule the fixture expects but does not produce is a mismatch',
	);
	assert.equal(
		compareFixtureExpectations('fail', [], ['item-evidence-missing']).length,
		2,
		'a fail fixture that declares nothing is a mismatch',
	);
	assert.equal(
		compareFixtureExpectations('pass', [], ['item-evidence-missing']).length,
		1,
		'a pass fixture that reports a violation is a mismatch',
	);
});

/* ------------------------------------------------------------------ *
 * the scope decisions
 * ------------------------------------------------------------------ */

test('the scope decisions hold every A/AA criterion the table does not carry', () => {
	const vocabulary = new Set(Object.keys(WCAG_22_CRITERIA));
	const decided = new Set(SCOPE_DECISIONS.map((decision) => decision.sc));
	assert.equal(decided.size, SCOPE_DECISIONS.length, 'a scope decision is listed twice');
	for (const sc of decided) {
		assert.ok(
			!vocabulary.has(sc),
			`SC ${sc} is in the vocabulary and must not be a scope decision`,
		);
	}
	for (const decision of SCOPE_DECISIONS) {
		assert.ok(['A', 'AA'].includes(decision.level), `SC ${decision.sc} needs an A/AA level`);
		assert.ok(decision.name.length > 0, `SC ${decision.sc} needs a name`);
		assert.ok(decision.reason.length > 0, `SC ${decision.sc} needs a reason`);
		assert.ok(decision.evidence.length > 0, `SC ${decision.sc} needs an evidence`);
	}
});

test('every scope decision carries a disposition with meaning', () => {
	for (const decision of SCOPE_DECISIONS) {
		assert.ok(
			SCOPE_DISPOSITIONS.includes(decision.disposition),
			`SC ${decision.sc} needs one of ${SCOPE_DISPOSITIONS.join(' / ')}`,
		);
		if (decision.disposition === 'not-applicable') {
			assert.ok(decision.reviewer === undefined, `SC ${decision.sc} must not name a reviewer`);
			assert.ok(decision.steps === undefined, `SC ${decision.sc} must not carry steps`);
			continue;
		}
		assert.ok(
			typeof decision.reviewer === 'string' && decision.reviewer.length > 0,
			`SC ${decision.sc} must name who reviews it`,
		);
		assert.ok(
			Array.isArray(decision.steps) && decision.steps.length > 0,
			`SC ${decision.sc} must carry reproduction steps`,
		);
		for (const step of decision.steps) {
			assert.ok(typeof step === 'string' && step.trim().length > 0, 'a step must be readable');
		}
	}
});

test('no criterion claims to be applicable-and-verified without a human record', () => {
	const verified = SCOPE_DECISIONS.filter(
		(decision) => decision.disposition === 'applicable-and-verified',
	);
	assert.deepEqual(
		verified.map((decision) => decision.sc),
		[],
		'no owner measurement exists in this repository, so no criterion may claim to be verified',
	);
});

test('the disposition counts are the ones the release assessment states', () => {
	const counts = Object.fromEntries(
		SCOPE_DISPOSITIONS.map((id) => [
			id,
			SCOPE_DECISIONS.filter((decision) => decision.disposition === id).length,
		]),
	);
	assert.equal(counts['not-applicable'], 13);
	assert.equal(counts['applicable-unverified'], 12);
	assert.equal(counts['applicable-and-verified'], 0);
	const evidence = collectEvidence({ today: TODAY, repoRoot: REPO_ROOT });
	assert.deepEqual(evidence.dispositionCounts, counts);
});

test('the documentation states the scope decisions the gate holds', () => {
	assert.deepEqual(auditScopeDecisions({ repoRoot: REPO_ROOT }), []);
});

test('a scope decision the documentation does not state is reported', () => {
	const rows = parseScopeDecisionTable(
		'| SC | レベル | 名前 | 区分 | 理由 | 証跡 | 検査者 | 手順 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 1.2.1 | A | Audio-only | not-applicable | a reason | an evidence | — | — |\n',
	);
	assert.equal(rows.length, 1);
	const problems = compareScopeDecisions(rows);
	assert.ok(problems.length > 0, 'a partial scope table is a mismatch');
});

test('a documented scope decision with another disposition is reported', () => {
	const rows = parseScopeDecisionTable(
		[
			'| SC | レベル | 名前 | 区分 | 理由 | 証跡 | 検査者 | 手順 |',
			'| --- | --- | --- | --- | --- | --- | --- | --- |',
			'| 1.2.1 | A | Audio-only | not-applicable | a reason | an evidence | — | — |',
		].join('\n'),
	);
	const problems = compareScopeDecisions(rows, [
		{
			sc: '1.2.1',
			level: 'A',
			name: 'Audio-only',
			disposition: 'applicable-unverified',
			reason: 'a reason',
			evidence: 'an evidence',
			reviewer: 'owner',
			steps: ['a step'],
		},
	]);
	assert.ok(
		problems.some((problem) => problem.includes('disposition')),
		'a different disposition is a mismatch',
	);
});

/* ------------------------------------------------------------------ *
 * the dispositions (Issue #722)
 * ------------------------------------------------------------------ */

test('"we have no item for it" is not an applicability argument', () => {
	for (const text of [
		'リンクの目的を文脈ごとに検査する項目をこの表に持たない。',
		'複数の到達経路を検査する項目をこの表に持たない。',
		'ヘルプの置き方の検査項目をこの表に持たない。',
		'この表に検査項目が無い。',
		'There is no item in this table for it.',
		'No owner is assigned to it.',
	]) {
		assert.ok(
			looksLikeTableCoverageReason(text),
			`"${text}" must be recognised as an admission that nobody looked`,
		);
	}
});

test('a fact about the published product is not a table-coverage reason', () => {
	for (const text of [
		'事前録音の音声・動画だけのコンテンツを出荷していない。',
		'`src/**` に `<audio>` / `<video>` 要素も `autoplay` 属性も無く、事前録音のメディアを同梱する Tool も無い。',
		'`src/**` の keydown ハンドラは `Escape`・矢印キー・`Home` / `End` のみで、単一文字のショートカットは無い。',
	]) {
		assert.ok(
			!looksLikeTableCoverageReason(text),
			`"${text}" is a product fact and must be accepted`,
		);
	}
});

test('a "not applicable" decision that only says the table has no item is refused', () => {
	const violations = auditScopeDispositions([
		{
			sc: '2.4.4',
			disposition: 'not-applicable',
			reason: 'リンクの目的を文脈ごとに検査する項目をこの表に持たない。',
			evidence: 'この表に検査項目が無い。',
		},
	]);
	assert.deepEqual(
		violations.map((violation) => violation.rule),
		['scope-exclusion-not-a-product-fact', 'scope-exclusion-not-a-product-fact'],
	);
});

test('an "applicable but unverified" decision without steps is refused', () => {
	const violations = auditScopeDispositions([
		{
			sc: '3.2.3',
			disposition: 'applicable-unverified',
			reason: 'ページを越えたナビゲーションがある。',
			evidence: 'リンクの相対順序を記録する。',
			reviewer: 'owner',
		},
	]);
	assert.deepEqual(
		violations.map((violation) => violation.rule),
		['scope-unverified-missing-review-plan'],
	);
});

test('an "applicable and verified" decision without a human record is refused', () => {
	const violations = auditScopeDispositions([
		{
			sc: '2.4.6',
			disposition: 'applicable-and-verified',
			reason: '見出しの文言がそのセクションを説明している。',
			evidence: 'すべての見出しを読んだ。',
			reviewer: 'owner',
			steps: ['すべての公開画面の見出しを読む。'],
		},
	]);
	assert.deepEqual(
		violations.map((violation) => violation.rule),
		['scope-verified-without-review-record', 'scope-verified-without-review-record'],
	);
});

test('the shipped scope decisions break no rule', () => {
	assert.deepEqual(auditScopeDispositions(SCOPE_DECISIONS), []);
});

test('the scope fixtures are exactly the expected set and behave as they declare', () => {
	const audited = auditScopeFixtures({ repoRoot: REPO_ROOT });
	assert.deepEqual(audited.violations, []);
	assert.equal(
		audited.files.length,
		EXPECTED_SCOPE_FIXTURE_FILES.pass.length + EXPECTED_SCOPE_FIXTURE_FILES.fail.length,
	);
	for (const [expectation, expected] of Object.entries(EXPECTED_SCOPE_FIXTURE_FILES)) {
		const directory = resolve(REPO_ROOT, SCOPE_FIXTURE_ROOT, expectation);
		const found = readdirSync(directory)
			.filter((name) => name.endsWith('.json'))
			.sort();
		assert.deepEqual(found, [...expected].sort(), `${directory} must hold exactly its fixtures`);
	}
});

test('the negative controls make the gate red with the new rule ids', () => {
	for (const [fixture, rule] of [
		['01-table-coverage-exclusion.json', 'scope-exclusion-not-a-product-fact'],
		['02-unverified-without-steps.json', 'scope-unverified-missing-review-plan'],
		['03-verified-without-review-record.json', 'scope-verified-without-review-record'],
	]) {
		const path = resolve(REPO_ROOT, SCOPE_FIXTURE_ROOT, 'fail', fixture);
		const result = spawnSync(
			process.execPath,
			[
				resolve(REPO_ROOT, 'scripts/check-a11y-wcag-review-matrix.mjs'),
				`--scope-decisions=${path}`,
				'--quiet',
			],
			{ cwd: REPO_ROOT, encoding: 'utf8' },
		);
		assert.equal(result.status, 1, `${fixture} must make the gate red`);
		assert.match(result.stderr, new RegExp(rule), `${fixture} must report ${rule}`);
	}
});

test('a scope decision file is read as data', () => {
	const path = resolve(REPO_ROOT, SCOPE_FIXTURE_ROOT, 'pass', '01-product-fact-exclusion.json');
	const decisions = loadScopeDecisions(path);
	assert.equal(decisions.length, 1);
	assert.deepEqual(auditScopeDispositions(decisions), []);
});

test('the ledger does not claim that the AA audit is complete', () => {
	const matrix = validMatrix();
	matrix.releaseAssessment = { aaAuditComplete: true };
	const rules = rulesOf(matrix);
	assert.ok(rules.includes('release-assessment-unbacked'));
});

test('the repository ledger states that the audit is not complete', () => {
	const evidence = collectEvidence({ today: TODAY, repoRoot: REPO_ROOT });
	assert.equal(evidence.matrix.releaseAssessment.aaAuditComplete, false);
	assert.equal(evidence.matrix.releaseAssessment.humanReviewOutstanding, evidence.outstanding);
});

test('the report separates the ledger structure from the audited quality', () => {
	const report = renderGateSummary(collectEvidence({ today: TODAY, repoRoot: REPO_ROOT }));
	assert.match(report, /release assessment \(the ledger's structure and the audited quality/);
	assert.match(report, /ledger structure: GREEN/);
	assert.match(report, /audited quality: NOT PASSED/);
	assert.match(report, /this is NOT a WCAG 2\.2 AA audit/);
	assert.match(report, /the outstanding manual items are outstanding/);
	assert.match(report, /Issue #718/);
	assert.match(report, /not-applicable: 13/);
	assert.match(report, /applicable-unverified: 12/);
	assert.match(report, /applicable-and-verified: 0/);
});

test('the report does not turn an open Issue into an unfixed axe violation', () => {
	const report = renderGateSummary(collectEvidence({ today: TODAY, repoRoot: REPO_ROOT }));
	assert.doesNotMatch(report, /still-open quality item/);
	assert.match(report, /hold 0 entries/);
	assert.match(report, /not for a recorded axe violation/);
});

test('the report reads the recorded axe-violation state from the ledger', () => {
	const matrix = validMatrix();
	matrix.releaseAssessment = {
		...(matrix.releaseAssessment ?? {}),
		knownAxeViolations: {
			issue: '#718',
			state: 'fixed',
			recordedViolations: 0,
			ledgers: ['e2e/a11y/axe-baseline.json'],
		},
	};
	const evidence = { ...collectEvidence({ today: TODAY, repoRoot: REPO_ROOT }), matrix };
	const report = renderGateSummary(evidence);
	assert.match(report, /e2e\/a11y\/axe-baseline\.json/);
	assert.match(report, /hold 0 entries/);
});

/* ------------------------------------------------------------------ *
 * the command line
 * ------------------------------------------------------------------ */

test('an option takes its value attached or as the next argument', () => {
	assert.equal(parseOptions(['--today=2026-10-23']).today, '2026-10-23');
	assert.equal(parseOptions(['--today', '2026-10-23']).today, '2026-10-23');
	assert.equal(parseOptions(['--matrix=quality/x.json']).matrix, 'quality/x.json');
	assert.equal(parseOptions(['--matrix', 'quality/x.json']).matrix, 'quality/x.json');
	assert.equal(parseOptions(['--json=a.json']).json, 'a.json');
	assert.equal(parseOptions(['--json', 'a.json']).json, 'a.json');
	assert.equal(parseOptions(['--quiet']).quiet, true);
});

test('an option without a value is refused', () => {
	assert.throws(() => parseOptions(['--today']));
	assert.throws(() => parseOptions(['--matrix']));
	assert.throws(() => parseOptions(['--today', '--quiet']));
	assert.throws(() => parseOptions(['--unknown']));
});

test('a matrix that cannot be read is exit code 2', () => {
	const result = spawnSync(
		process.execPath,
		[
			resolve(REPO_ROOT, 'scripts/check-a11y-wcag-review-matrix.mjs'),
			'--matrix=quality/does-not-exist.json',
		],
		{ cwd: REPO_ROOT, encoding: 'utf8' },
	);
	assert.equal(result.status, 2, result.stderr);
	assert.match(result.stderr, /does-not-exist\.json/);
});

test('a matrix that cannot be read is exit code 2 with the value spelled separately', () => {
	const result = spawnSync(
		process.execPath,
		[
			resolve(REPO_ROOT, 'scripts/check-a11y-wcag-review-matrix.mjs'),
			'--matrix',
			'quality/does-not-exist.json',
		],
		{ cwd: REPO_ROOT, encoding: 'utf8' },
	);
	assert.equal(result.status, 2, result.stderr);
	assert.match(result.stderr, /does-not-exist\.json/);
});

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
		'release-assessment-unbacked',
	]) {
		assert.ok(produced.has(rule), `a fixture must produce ${rule}`);
	}
});

test('every scope rule is exercised by a scope fixture', () => {
	const audited = auditScopeFixtures({ repoRoot: REPO_ROOT, today: TODAY });
	const produced = new Set(audited.files.flatMap((file) => file.produced));
	for (const rule of [
		'scope-exclusion-not-a-product-fact',
		'scope-unverified-missing-review-plan',
		'scope-verified-without-review-record',
	]) {
		assert.ok(produced.has(rule), `a scope fixture must produce ${rule}`);
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
