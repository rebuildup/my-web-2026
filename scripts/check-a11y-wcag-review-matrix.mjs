#!/usr/bin/env node

/**
 * check-a11y-wcag-review-matrix — keep the WCAG 2.2 A/AA manual review
 * matrix honest (Issue #410).
 *
 * What this gate is for
 * ---------------------
 * The automated a11y gates in this repository decide what a machine can
 * decide: names, roles, contrast ratios, heading structure, alt text.
 * They cannot decide whether a screen reader announces a status message
 * in a useful order, whether the keyboard path is complete, or whether
 * the page is still readable at 200 % zoom. Those judgements are made by
 * a person, and this gate manages the RECORD of that judgement:
 *
 *   - which WCAG 2.2 A/AA criteria this repository considers at all,
 *     and — for every criterion it does not cover — **why**;
 *   - which surface and which **state** of that surface the review is
 *     about;
 *   - whether the criterion is decided by a **machine** or by a **person**;
 *   - who performed the review, when, in which environment, and what
 *     the result was.
 *
 * The central rule
 * -----------------
 * **An automatic pass is not a human verification, and the two can never
 * be confused.** A criterion that a machine gate covers is recorded as
 * `auto-pass`; a criterion a person looked at is recorded as
 * `human-verified` (or `human-failed`). There is no code path that turns
 * an `auto-pass` into a `human-verified`, and a document that claims the
 * site conforms to WCAG 2.2 AA is a **violation** unless a human
 * verification exists and the document points at this matrix. A green run
 * of this gate therefore never means "the site is AA compliant"; it
 * means "the table that records the manual reviews is intact".
 *
 * The rules
 * ---------
 *   item-field-missing
 *       A required field of an item is missing or empty.
 *   item-duplicate-id
 *       Two items share an id.
 *   item-sc-unknown
 *       An item names a success criterion that is not a WCAG 2.2 A/AA
 *       criterion in {@link WCAG_22_CRITERIA}. An unknown number is
 *       never assumed to be covered.
 *   item-state-unknown
 *       An item names a state that is not in {@link REVIEW_STATES}.
 *   item-method-invalid
 *       An item does not say whether a machine or a person decides it.
 *   item-review-state-invalid
 *       The recorded review state does not fit the method (a machine
 *       item cannot be `human-verified`; a human item cannot be
 *       `auto-pass`; `not-reviewed` may not carry evidence).
 *   item-evidence-missing
 *       A performed review is missing the reviewer, the date, the
 *       environment or the result — or carries a result that disagrees
 *       with the recorded state.
 *   item-evidence-stale
 *       The evidence is older than the review window, or dated in the
 *       future. A stale record is a record that has to be made again.
 *   item-auto-gate-missing
 *       An item names an npm script that does not exist, so the machine
 *       half of the record points at nothing.
 *   surface-missing
 *       A surface points at a file or a story export that does not
 *       exist. A review of a surface that is gone proves nothing.
 *   surface-state-missing
 *       The (surface, state) pair is not available, or the state marker
 *       the surface declares is not in the source any more — the fixture
 *       no longer reproduces the state the table reviews.
 *   state-undisposed
 *       A state of the vocabulary is not enumerated in the matrix.
 *   state-uncovered
 *       An enumerated state has no item at all.
 *   criterion-undisposed
 *       A criterion is neither covered by an item nor excluded with a
 *       reason. "We did not look at it" is a decision, not a silence.
 *   criterion-exclusion-reason-missing
 *       A criterion is excluded without a reason.
 *   criterion-conflict
 *       A criterion is both covered by an item and excluded.
 *   compliance-claim-unbacked
 *       A document claims that the site conforms to WCAG 2.2 AA while no
 *       human verification exists, or without pointing at this matrix.
 *   fixture-expectation-mismatch
 *       A fixture does not behave the way its own expectation says.
 *   fixture-contract-missing
 *       A fixture file is missing, unparsable, or its directory is empty.
 *
 * Exit codes: 0 = the table is intact, 1 = at least one violation,
 * 2 = the gate cannot decide (the matrix cannot be read).
 *
 * Usage:
 *   node scripts/check-a11y-wcag-review-matrix.mjs [--quiet] [--json=FILE]
 *   node scripts/check-a11y-wcag-review-matrix.mjs --today=2026-10-23
 *   node scripts/check-a11y-wcag-review-matrix.mjs --matrix=<path>
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The committed matrix. Static data, read-only for the gate. */
export const MATRIX_PATH = 'quality/wcag-review-matrix.json';

/** Where the gate's own fixtures live. */
export const FIXTURE_ROOT = 'scripts/fixtures/a11y-wcag-review-matrix';
export const FIXTURE_PASS_DIR = `${FIXTURE_ROOT}/pass`;
export const FIXTURE_FAIL_DIR = `${FIXTURE_ROOT}/fail`;

/**
 * The fixture files this gate expects in each directory.
 *
 * The set is EXACT: a fixture that quietly lost a file would verify
 * less than it claims, and a file nobody registered would verify
 * something unread.
 */
export const EXPECTED_FIXTURE_FILES = {
	pass: ['01-intact-matrix.json', '02-claim-with-human-verification.json'],
	fail: [
		'01-review-without-reviewer.json',
		'02-unknown-state.json',
		'03-not-reviewed-with-evidence.json',
		'04-missing-surface.json',
		'05-unbacked-claim.json',
		'06-exclusion-without-reason.json',
		'07-unknown-auto-gate.json',
		'08-stale-evidence.json',
		'09-uncovered-state.json',
		'10-conflicting-criterion.json',
	],
};

/**
 * The WCAG 2.2 A/AA criteria this matrix may speak about.
 *
 * Only Level A and Level AA criteria are listed: a Level AAA criterion
 * is not part of a conformance claim this repository makes, and mixing
 * the levels would blur the claim. The table is the vocabulary — an SC
 * number that is not in it is reported, never assumed.
 */
export const WCAG_22_CRITERIA = {
	'1.1.1': { level: 'A', name: 'Non-text Content' },
	'1.2.2': { level: 'A', name: 'Captions (Prerecorded)' },
	'1.2.4': { level: 'A', name: 'Audio Description (Prerecorded)' },
	'1.3.1': { level: 'A', name: 'Info and Relationships' },
	'1.3.2': { level: 'A', name: 'Meaningful Sequence' },
	'1.3.4': { level: 'AA', name: 'Orientation' },
	'1.3.5': { level: 'AA', name: 'Identify Input Purpose' },
	'1.4.1': { level: 'A', name: 'Use of Color' },
	'1.4.3': { level: 'AA', name: 'Contrast (Minimum)' },
	'1.4.4': { level: 'AA', name: 'Resize Text' },
	'1.4.10': { level: 'AA', name: 'Reflow' },
	'1.4.11': { level: 'AA', name: 'Non-text Contrast' },
	'1.4.12': { level: 'AA', name: 'Text Spacing' },
	'1.4.13': { level: 'AA', name: 'Content on Hover or Focus' },
	'2.1.1': { level: 'A', name: 'Keyboard' },
	'2.1.2': { level: 'A', name: 'No Keyboard Trap' },
	'2.4.1': { level: 'A', name: 'Bypass Blocks' },
	'2.4.2': { level: 'A', name: 'Page Titled' },
	'2.4.3': { level: 'A', name: 'Focus Order' },
	'2.4.6': { level: 'AA', name: 'Headings and Labels' },
	'2.4.7': { level: 'AA', name: 'Focus Visible' },
	'2.4.11': { level: 'AA', name: 'Focus Not Obscured (Minimum)' },
	'2.5.8': { level: 'AA', name: 'Target Size (Minimum)' },
	'3.1.1': { level: 'A', name: 'Language of Page' },
	'3.1.2': { level: 'A', name: 'Language of Parts' },
	'3.3.1': { level: 'A', name: 'Error Identification' },
	'3.3.2': { level: 'A', name: 'Labels or Instructions' },
	'3.3.7': { level: 'AA', name: 'Redundant Entry' },
	'4.1.2': { level: 'A', name: 'Name, Role, Value' },
	'4.1.3': { level: 'AA', name: 'Status Messages' },
};

/**
 * The state vocabulary.
 *
 * `default` is the surface in its shipped condition. `markup` states are
 * rendered by the surface itself, so the surface declares a marker that
 * has to be found in its source. `interaction` states are applied by the
 * reviewer (a zoom, a keyboard walk, a focus ring, a screen reader), so
 * they need no marker — they are an operation on any surface.
 */
export const REVIEW_STATES = [
	{ id: 'normal', kind: 'default', description: 'the surface in its shipped condition' },
	{ id: 'empty', kind: 'markup', description: 'the surface with nothing in it yet' },
	{ id: 'error', kind: 'markup', description: 'the surface in its failure state' },
	{ id: 'narrow', kind: 'markup', description: 'the surface at 320 CSS px' },
	{
		id: 'zoomed',
		kind: 'interaction',
		description: 'the surface at 200 % text zoom',
	},
	{
		id: 'text-spacing',
		kind: 'interaction',
		description: 'the surface with the SC 1.4.12 text spacing override applied',
	},
	{
		id: 'keyboard-only',
		kind: 'interaction',
		description: 'the surface operated with the keyboard alone',
	},
	{
		id: 'focus-visible',
		kind: 'interaction',
		description: 'the surface with a control holding the focus ring',
	},
	{
		id: 'screen-reader',
		kind: 'interaction',
		description: 'the surface read out by a screen reader',
	},
];

/** Who decides a criterion. Both values are mandatory, neither is a default. */
export const REVIEW_METHODS = ['machine', 'human'];

/**
 * The recorded state of a review, and what each state requires.
 *
 * `auto-pass` and `human-verified` are different states with different
 * requirements on purpose: the machine half never carries a reviewer,
 * a date or an environment, because nobody looked at it, and the human
 * half never carries an npm script, because a script did not look at it.
 */
export const REVIEW_RECORD_STATES = {
	'auto-pass': {
		method: 'machine',
		requires: [],
		forbids: ['assignedTo', 'reviewer', 'performedAt', 'environment', 'result'],
		result: null,
	},
	'human-verified': {
		method: 'human',
		requires: ['assignedTo', 'reviewer', 'performedAt', 'environment', 'result'],
		forbids: [],
		result: 'pass',
	},
	'human-failed': {
		method: 'human',
		requires: ['assignedTo', 'reviewer', 'performedAt', 'environment', 'result'],
		forbids: [],
		result: 'fail',
	},
	'not-reviewed': {
		method: 'human',
		requires: ['assignedTo'],
		forbids: ['reviewer', 'performedAt', 'environment', 'result'],
		result: null,
	},
};

/**
 * The words that turn a document into a conformance claim.
 *
 * A claim is a phrase that says the conformance is DONE. A phrase inside
 * a line that also carries a qualifier (`ない` / `禁止` / …) is a
 * mention of the phrase, not a claim — that is what lets this
 * repository document the phrase list without tripping over it.
 */
export const CLAIM_PHRASES = [
	'AA 準拠完了',
	'AA 適合完了',
	'AA 準拠済み',
	'AA 適合済み',
	'WCAG 2.2 AA 適合済み',
	'WCAG 2.2 AA 準拠済み',
	'WCAG 2.2 AA compliant',
];

/** A line that carries one of these is a mention, not a claim. */
export const CLAIM_QUALIFIERS = [
	'ない',
	'ません',
	'しない',
	'とは',
	'主張',
	'根拠',
	'禁止',
	'使わない',
	'書かない',
	'できません',
	'ではない',
	'ありません',
	'避免',
];

/**
 * Where a site-level conformance claim may be written.
 *
 * The documentation is where such a claim is made; a source comment
 * about one token pair is a different kind of statement and is not
 * scanned.
 */
export const CLAIM_SURFACE_ROOTS = ['README.md', 'docs'];

/** The rules this gate can report. */
export const RULES = [
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
];

/* ------------------------------------------------------------------ *
 * small pure helpers
 * ------------------------------------------------------------------ */

/** A non-empty trimmed string, or `null`. */
function filledString(value) {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** An ISO date (`YYYY-MM-DD`) that names a real day, or `null`. */
export function isIsoDate(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return false;
	// `Date` silently rolls 2026-10-32 over to November, so the round trip
	// is what tells a real day from a well-shaped number.
	return parsed.toISOString().slice(0, 10) === value;
}

/** Whole days between two ISO dates (`to - from`). */
export function daysBetween(fromIso, toIso) {
	const from = Date.parse(`${fromIso}T00:00:00Z`);
	const to = Date.parse(`${toIso}T00:00:00Z`);
	if (Number.isNaN(from) || Number.isNaN(to)) return null;
	return Math.round((to - from) / 86_400_000);
}

/** The UTC date of "now", as `YYYY-MM-DD`. */
export function todayIso(now = new Date()) {
	return now.toISOString().slice(0, 10);
}

/** Read and parse a JSON file. Throws when it cannot be read. */
export function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

/* ------------------------------------------------------------------ *
 * the matrix shape
 * ------------------------------------------------------------------ */

/**
 * The problems that make the matrix impossible to judge.
 *
 * A shape problem is not a violation: the gate cannot decide, so it
 * exits 2 rather than pretending the table is fine.
 */
export function validateShape(matrix) {
	const problems = [];
	if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) {
		return ['the matrix is not a JSON object'];
	}
	if (matrix.version !== 1) {
		problems.push(`version must be 1 (found ${JSON.stringify(matrix.version)})`);
	}
	if (!Array.isArray(matrix.items)) {
		problems.push('items must be an array');
	}
	if (!Array.isArray(matrix.surfaces)) {
		problems.push('surfaces must be an array');
	}
	if (!Array.isArray(matrix.states)) {
		problems.push('states must be an array');
	}
	if (!Array.isArray(matrix.excluded)) {
		problems.push('excluded must be an array');
	}
	if (
		typeof matrix.reviewWindowDays !== 'number' ||
		!Number.isInteger(matrix.reviewWindowDays) ||
		matrix.reviewWindowDays <= 0
	) {
		problems.push('reviewWindowDays must be a positive integer');
	}
	return problems;
}

/* ------------------------------------------------------------------ *
 * the audit
 * ------------------------------------------------------------------ */

/**
 * Audit one matrix.
 *
 * Returns the violations plus the summary the report prints. Every
 * function it calls is pure, so the fixtures can be audited the same
 * way the repository's own matrix is.
 */
export function auditMatrix(
	matrix,
	{ today, repoRoot = REPO_ROOT, packageScripts = null, claimSurfaces = null } = {},
) {
	const violations = [];
	const scripts = packageScripts ?? readPackageScripts(repoRoot);
	const add = (rule, file, message) => {
		violations.push({ rule, file, message });
	};

	const surfaces = new Map();
	for (const surface of Array.isArray(matrix.surfaces) ? matrix.surfaces : []) {
		if (surface && typeof surface.id === 'string') surfaces.set(surface.id, surface);
	}

	/* --- the state enumeration ------------------------------------ */
	const vocabulary = new Set(REVIEW_STATES.map((state) => state.id));
	const stateKinds = new Map(REVIEW_STATES.map((state) => [state.id, state.kind]));
	const enumerated = new Set();
	for (const entry of Array.isArray(matrix.states) ? matrix.states : []) {
		const id = entry && typeof entry.id === 'string' ? entry.id : null;
		if (!id) {
			add('state-undisposed', MATRIX_PATH, 'every state entry needs an id');
			continue;
		}
		if (!vocabulary.has(id)) {
			add(
				'item-state-unknown',
				MATRIX_PATH,
				`the state "${id}" is not one of the vocabulary (${[...vocabulary].join(', ')})`,
			);
			continue;
		}
		if (!filledString(entry.description)) {
			add('state-undisposed', MATRIX_PATH, `the state "${id}" needs a description`);
		}
		enumerated.add(id);
	}
	for (const state of REVIEW_STATES) {
		if (!enumerated.has(state.id)) {
			add(
				'state-undisposed',
				MATRIX_PATH,
				`the state "${state.id}" is not enumerated in the matrix; every state of the vocabulary must be enumerated here (the vocabulary is the gate's, so a state cannot be added by editing the table alone)`,
			);
		}
	}

	/* --- the items ------------------------------------------------ */
	const items = Array.isArray(matrix.items) ? matrix.items : [];
	const ids = new Set();
	const coveredCriteria = new Map();
	const usedStates = new Set();

	for (const item of items) {
		const label = item && typeof item.id === 'string' ? item.id : '(no id)';
		if (!item || typeof item !== 'object') {
			add('item-field-missing', MATRIX_PATH, 'every item must be an object');
			continue;
		}
		for (const field of ['id', 'subject', 'scope', 'surface', 'state', 'method']) {
			if (!filledString(item[field])) {
				add(
					'item-field-missing',
					MATRIX_PATH,
					`item ${label}: ${field} must be a non-empty string`,
				);
			}
		}
		if (filledString(item.id)) {
			if (ids.has(item.id)) {
				add('item-duplicate-id', MATRIX_PATH, `item ${label}: the id is used twice`);
			}
			ids.add(item.id);
		}

		/* the success criteria */
		if (!Array.isArray(item.sc) || item.sc.length === 0) {
			add(
				'item-field-missing',
				MATRIX_PATH,
				`item ${label}: sc must be a non-empty array of WCAG 2.2 A/AA criteria`,
			);
		} else {
			for (const sc of item.sc) {
				if (typeof sc !== 'string' || !WCAG_22_CRITERIA[sc]) {
					add(
						'item-sc-unknown',
						MATRIX_PATH,
						`item ${label}: "${sc}" is not a WCAG 2.2 A/AA criterion this matrix knows; an unknown criterion is never assumed to be covered`,
					);
					continue;
				}
				if (!coveredCriteria.has(sc)) coveredCriteria.set(sc, []);
				coveredCriteria.get(sc).push(label);
			}
		}

		/* the state */
		const state = filledString(item.state);
		if (state) {
			if (!vocabulary.has(state)) {
				add(
					'item-state-unknown',
					MATRIX_PATH,
					`item ${label}: the state "${state}" is not one of the vocabulary (${[...vocabulary].join(', ')})`,
				);
			} else {
				usedStates.add(state);
			}
		}

		/* the method */
		const method = filledString(item.method);
		if (method && !REVIEW_METHODS.includes(method)) {
			add(
				'item-method-invalid',
				MATRIX_PATH,
				`item ${label}: method must be one of ${REVIEW_METHODS.join(' / ')} (found ${JSON.stringify(item.method)})`,
			);
		}

		/* the machine half */
		const autoGates = item.autoGates ?? [];
		if (!Array.isArray(autoGates)) {
			add('item-field-missing', MATRIX_PATH, `item ${label}: autoGates must be an array`);
		} else {
			for (const script of autoGates) {
				if (!filledString(script)) {
					add(
						'item-field-missing',
						MATRIX_PATH,
						`item ${label}: every autoGates entry must be a non-empty string`,
					);
					continue;
				}
				if (scripts && !Object.hasOwn(scripts, script)) {
					add(
						'item-auto-gate-missing',
						MATRIX_PATH,
						`item ${label}: the npm script "${script}" does not exist in package.json, so the machine half of the record points at nothing`,
					);
				}
			}
		}

		/* the review record */
		const review = item.review;
		if (!review || typeof review !== 'object' || Array.isArray(review)) {
			add(
				'item-field-missing',
				MATRIX_PATH,
				`item ${label}: review must be an object with a state`,
			);
			continue;
		}
		const recordState = filledString(review.state);
		const record = recordState ? REVIEW_RECORD_STATES[recordState] : null;
		if (!record) {
			add(
				'item-review-state-invalid',
				MATRIX_PATH,
				`item ${label}: the review state must be one of ${Object.keys(REVIEW_RECORD_STATES).join(' / ')} (found ${JSON.stringify(review.state)})`,
			);
			continue;
		}
		if (method && method !== record.method) {
			add(
				'item-review-state-invalid',
				MATRIX_PATH,
				`item ${label}: the review state "${recordState}" belongs to a ${record.method} review, but the item says the method is "${method}"`,
			);
		}
		for (const field of record.requires) {
			if (!filledString(review[field])) {
				add(
					'item-evidence-missing',
					MATRIX_PATH,
					`item ${label}: a "${recordState}" review needs ${field}`,
				);
			}
		}
		for (const field of record.forbids) {
			if (review[field] !== undefined && review[field] !== null && review[field] !== '') {
				add(
					'item-review-state-invalid',
					MATRIX_PATH,
					`item ${label}: a "${recordState}" review must not carry ${field}; nobody looked at it, so there is no evidence to record`,
				);
			}
		}
		if (record.result && review.result !== record.result) {
			add(
				'item-evidence-missing',
				MATRIX_PATH,
				`item ${label}: a "${recordState}" review must record the result "${record.result}" (found ${JSON.stringify(review.result)})`,
			);
		}
		if (recordState === 'auto-pass' && method === 'machine' && autoGates.length === 0) {
			add(
				'item-review-state-invalid',
				MATRIX_PATH,
				`item ${label}: an "auto-pass" review must name the npm script that produced the pass`,
			);
		}

		/* the freshness of the evidence */
		const performedAt = filledString(review.performedAt);
		if (performedAt) {
			if (!isIsoDate(performedAt)) {
				add(
					'item-evidence-missing',
					MATRIX_PATH,
					`item ${label}: performedAt must be an ISO date (YYYY-MM-DD)`,
				);
			} else if (isIsoDate(today)) {
				const age = daysBetween(performedAt, today);
				if (age === null) {
					add(
						'item-evidence-missing',
						MATRIX_PATH,
						`item ${label}: performedAt (${performedAt}) cannot be compared with today (${today})`,
					);
				} else if (age < 0) {
					add(
						'item-evidence-stale',
						MATRIX_PATH,
						`item ${label}: performedAt (${performedAt}) is later than today (${today})`,
					);
				} else if (age > matrix.reviewWindowDays) {
					add(
						'item-evidence-stale',
						MATRIX_PATH,
						`item ${label}: the review is ${age} day(s) old, over the ${matrix.reviewWindowDays} day window; the review has to be made again`,
					);
				}
			}
		}

		/* the surface and the state it is reviewed in */
		const surfaceId = filledString(item.surface);
		if (surfaceId) {
			const surface = surfaces.get(surfaceId);
			if (!surface) {
				add(
					'surface-missing',
					MATRIX_PATH,
					`item ${label}: the surface "${surfaceId}" is not declared in surfaces`,
				);
			} else if (state) {
				const problem = auditSurfaceState(surface, state, { repoRoot });
				if (problem) {
					add('surface-state-missing', MATRIX_PATH, `item ${label}: ${problem}`);
				}
			}
		}
	}

	for (const state of enumerated) {
		if (!usedStates.has(state)) {
			add(
				'state-uncovered',
				MATRIX_PATH,
				`the state "${state}" is enumerated but no item reviews it`,
			);
		}
	}

	/* --- the excluded criteria ------------------------------------ */
	const excluded = new Map();
	for (const entry of Array.isArray(matrix.excluded) ? matrix.excluded : []) {
		const sc = entry && typeof entry.sc === 'string' ? entry.sc : null;
		if (!sc) {
			add('criterion-exclusion-reason-missing', MATRIX_PATH, 'every excluded entry needs an sc');
			continue;
		}
		if (!WCAG_22_CRITERIA[sc]) {
			add(
				'item-sc-unknown',
				MATRIX_PATH,
				`the excluded criterion "${sc}" is not a WCAG 2.2 A/AA criterion this matrix knows`,
			);
			continue;
		}
		if (!filledString(entry.reason)) {
			add(
				'criterion-exclusion-reason-missing',
				MATRIX_PATH,
				`the excluded criterion ${sc} needs a reason; an unexplained exclusion is an omission, not a decision`,
			);
			continue;
		}
		if (coveredCriteria.has(sc)) {
			add(
				'criterion-conflict',
				MATRIX_PATH,
				`the criterion ${sc} is both excluded and covered by ${coveredCriteria.get(sc).join(', ')}`,
			);
		}
		excluded.set(sc, entry.reason);
	}

	/* every criterion is either covered or excluded with a reason */
	for (const sc of Object.keys(WCAG_22_CRITERIA)) {
		if (!coveredCriteria.has(sc) && !excluded.has(sc)) {
			add(
				'criterion-undisposed',
				MATRIX_PATH,
				`the criterion ${sc} (${WCAG_22_CRITERIA[sc].level}) is neither covered by an item nor excluded with a reason`,
			);
		}
	}

	/* --- the conformance claim ------------------------------------ */
	const humanVerified = items.filter((item) => item?.review?.state === 'human-verified');
	// The repository's own documentation is always scanned. A matrix may
	// ADD claims (the fixtures do, so the rule can be exercised without a
	// document in the tree), but it can never switch the scan off.
	const claims = [
		...(claimSurfaces ?? scanClaimSurfaces({ repoRoot })),
		...(Array.isArray(matrix.$claims) ? matrix.$claims : []),
	];
	for (const claim of claims) {
		const backed = humanVerified.length > 0 && claim.citesMatrix;
		if (!backed) {
			add(
				'compliance-claim-unbacked',
				claim.file,
				`${claim.phrase} is claimed on line ${claim.line}, but ${
					humanVerified.length > 0
						? 'the line does not point at the review matrix'
						: 'no human verification exists — an automatic pass is not a human verification'
				}`,
			);
		}
	}

	return {
		violations,
		items,
		surfaces: [...surfaces.values()],
		states: [...enumerated],
		excluded: [...excluded.entries()].map(([sc, reason]) => ({ sc, reason })),
		coveredCriteria: [...coveredCriteria.entries()].map(([sc, ids]) => ({ sc, items: ids })),
		claims,
		humanVerified: humanVerified.length,
		outstanding: items.filter((item) => item?.review?.state === 'not-reviewed').length,
		machineChecked: items.filter((item) => item?.review?.state === 'auto-pass').length,
	};
}

/**
 * Audit one (surface, state) pair.
 *
 * `default` states are always available; `interaction` states are an
 * operation the reviewer applies to any surface; `markup` states have
 * to be declared by the surface, with a marker that is still in the
 * source.
 */
export function auditSurfaceState(surface, state, { repoRoot = REPO_ROOT } = {}) {
	const kind = stateKindsOf(state);
	if (kind === 'default' || kind === 'interaction') return null;

	const reproduces = surface.reproduces ?? {};
	const markers = reproduces[state];
	if (!Array.isArray(markers) || markers.length === 0) {
		return `the surface "${surface.id}" does not declare the state "${state}"`;
	}

	const path = resolve(repoRoot, surface.path ?? '');
	if (!existsSync(path)) {
		return `the surface "${surface.id}" points at ${surface.path}, which does not exist`;
	}
	const source = readFileSync(path, 'utf8');
	for (const marker of markers) {
		if (typeof marker !== 'string' || marker.length === 0) {
			return `the surface "${surface.id}" declares an empty marker for the state "${state}"`;
		}
		if (marker.startsWith('export:')) {
			const name = marker.slice('export:'.length);
			if (!new RegExp(`export\\s+const\\s+${name}\\b`).test(source)) {
				return `the surface "${surface.id}" no longer exports "${name}", so it no longer reproduces the state "${state}"`;
			}
			continue;
		}
		if (!source.includes(marker)) {
			return `the surface "${surface.id}" no longer contains "${marker}", so it no longer reproduces the state "${state}"`;
		}
	}
	return null;
}

/** The kind of a state in the vocabulary. */
function stateKindsOf(state) {
	return REVIEW_STATES.find((entry) => entry.id === state)?.kind ?? null;
}

/* ------------------------------------------------------------------ *
 * the claim surfaces
 * ------------------------------------------------------------------ */

/** Every markdown file the claim scan reads. */
export function collectClaimSurfaceFiles({ repoRoot = REPO_ROOT } = {}) {
	const files = [];
	for (const root of CLAIM_SURFACE_ROOTS) {
		const absolute = resolve(repoRoot, root);
		if (!existsSync(absolute)) continue;
		if (statSync(absolute).isFile()) {
			files.push(root);
			continue;
		}
		for (const file of walkMarkdown(absolute, repoRoot)) files.push(file);
	}
	return files.sort();
}

/** Every `.md` file under a directory, as repo-relative paths. */
function walkMarkdown(directory, repoRoot) {
	const found = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const absolute = join(directory, entry.name);
		if (entry.isDirectory()) {
			found.push(...walkMarkdown(absolute, repoRoot));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith('.md')) {
			found.push(relative(repoRoot, absolute));
		}
	}
	return found;
}

/**
 * Find the conformance claims in the documentation.
 *
 * A claim is a line that carries one of {@link CLAIM_PHRASES} and no
 * qualifier from {@link CLAIM_QUALIFIERS} — a line that also says the
 * phrase is not allowed, or that it is not a claim, mentions the phrase
 * without making the claim.
 */
export function findClaims(text, { file = null } = {}) {
	const claims = [];
	const lines = String(text).split('\n');
	lines.forEach((line, index) => {
		const qualified = CLAIM_QUALIFIERS.some((qualifier) => line.includes(qualifier));
		if (qualified) return;
		for (const phrase of CLAIM_PHRASES) {
			const at = line.indexOf(phrase);
			if (at === -1) continue;
			claims.push({
				file,
				line: index + 1,
				phrase,
				text: line.trim(),
				citesMatrix: line.includes('wcag-review-matrix'),
			});
		}
	});
	return claims;
}

/** Read every claim surface and collect the claims. */
export function scanClaimSurfaces({ repoRoot = REPO_ROOT } = {}) {
	const claims = [];
	for (const file of collectClaimSurfaceFiles({ repoRoot })) {
		const text = readFileSync(resolve(repoRoot, file), 'utf8');
		claims.push(...findClaims(text, { file }));
	}
	return claims;
}

/* ------------------------------------------------------------------ *
 * the fixtures
 * ------------------------------------------------------------------ */

/** The fixture files of one directory, sorted by name. */
export function collectFixtureFiles(directory) {
	if (!existsSync(directory)) return [];
	return readdirSync(directory)
		.filter((name) => name.endsWith('.json'))
		.sort()
		.map((name) => join(directory, name));
}

/**
 * Audit every fixture of the repository.
 *
 * A `pass` fixture must produce no violation at all; a `fail` fixture
 * must produce every rule it declares (`$expects`). The set of fixture
 * files is exact, so a fixture that quietly lost a file cannot "verify"
 * less than it claims.
 */
export function auditFixtures({
	repoRoot = REPO_ROOT,
	today = '2026-10-23',
	packageScripts = null,
} = {}) {
	const violations = [];
	const files = [];
	const scripts = packageScripts ?? readPackageScripts(repoRoot);

	for (const [directory, expectation] of [
		[FIXTURE_PASS_DIR, 'pass'],
		[FIXTURE_FAIL_DIR, 'fail'],
	]) {
		const absolute = resolve(repoRoot, directory);
		const found = collectFixtureFiles(absolute);
		if (found.length === 0) {
			violations.push({
				rule: 'fixture-contract-missing',
				file: directory,
				message: `${directory} holds no fixture file; the ${expectation} fixture has no source`,
			});
			continue;
		}
		const expected = EXPECTED_FIXTURE_FILES[expectation] ?? [];
		const foundNames = found.map((path) => path.slice(path.lastIndexOf('/') + 1));
		for (const name of expected) {
			if (!foundNames.includes(name)) {
				violations.push({
					rule: 'fixture-expectation-mismatch',
					file: `${directory}/${name}`,
					message: `the ${expectation} fixture ${name} is missing; the expected fixture set is ${expected.join(', ')}`,
				});
			}
		}
		for (const name of foundNames) {
			if (!expected.includes(name)) {
				violations.push({
					rule: 'fixture-expectation-mismatch',
					file: `${directory}/${name}`,
					message: `the ${expectation} fixture ${name} is not part of the expected fixture set (${expected.join(', ')})`,
				});
			}
		}
		for (const path of found) {
			const relativePath = path.slice(repoRoot.length + 1);
			let fixture = null;
			try {
				fixture = readJson(path);
			} catch (error) {
				violations.push({
					rule: 'fixture-contract-missing',
					file: relativePath,
					message: `the fixture cannot be parsed: ${error.message}`,
				});
				continue;
			}
			const shapeProblems = validateShape(fixture);
			if (shapeProblems.length > 0) {
				violations.push({
					rule: 'fixture-contract-missing',
					file: relativePath,
					message: `the fixture is not a matrix: ${shapeProblems.join('; ')}`,
				});
				continue;
			}
			const audited = auditMatrix(fixture, { today, repoRoot, packageScripts: scripts });
			const produced = new Set(audited.violations.map((violation) => violation.rule));
			const expects = Array.isArray(fixture.$expects) ? fixture.$expects : [];
			if (expectation === 'pass') {
				if (audited.violations.length > 0) {
					violations.push({
						rule: 'fixture-expectation-mismatch',
						file: relativePath,
						message: `the pass fixture reports ${audited.violations.length} violation(s): ${[...produced].join(', ')}`,
					});
				}
			} else {
				for (const rule of expects) {
					if (!produced.has(rule)) {
						violations.push({
							rule: 'fixture-expectation-mismatch',
							file: relativePath,
							message: `the fail fixture expects "${rule}" and the audit did not report it`,
						});
					}
				}
				if (expects.length === 0) {
					violations.push({
						rule: 'fixture-expectation-mismatch',
						file: relativePath,
						message: 'a fail fixture must declare the rules it expects ($expects)',
					});
				}
			}
			files.push({
				path: relativePath,
				expectation,
				expects,
				produced: [...produced],
				violations: audited.violations,
			});
		}
	}

	return { files, violations };
}

/* ------------------------------------------------------------------ *
 * the report
 * ------------------------------------------------------------------ */

/** The human-readable report. */
export function renderGateSummary(evidence) {
	const lines = [];
	lines.push('WCAG 2.2 A/AA manual review matrix — Issue #410');
	lines.push(
		`matrix: ${evidence.matrixPath} (revision ${evidence.updatedAt}, review window ${evidence.reviewWindowDays} day(s))`,
	);
	lines.push(
		`${evidence.items.length} item(s): ${evidence.machineChecked} machine-checked, ${evidence.humanReviewed} human review(s) — ${evidence.humanVerified} human-verified, ${evidence.humanFailed} human-failed, ${evidence.outstanding} outstanding`,
	);
	lines.push('');
	lines.push('machine-checked (an npm gate decided it — NOT a human verification):');
	for (const item of evidence.items.filter((entry) => entry.review?.state === 'auto-pass')) {
		lines.push(
			`  ok   ${item.id.padEnd(26)} ${scLabel(item)} ${item.surface.padEnd(22)} [${item.state}] ${(item.autoGates ?? []).join(', ')}`,
		);
	}
	lines.push('');
	lines.push('human review (a person performs it; an automatic pass is not a substitute):');
	const humanItems = evidence.items.filter((entry) => entry.review?.state !== 'auto-pass');
	if (humanItems.length === 0) {
		lines.push('  (none)');
	}
	for (const item of humanItems) {
		const verdict =
			item.review?.state === 'human-verified'
				? 'verified'
				: item.review?.state === 'human-failed'
					? 'FAILED'
					: 'outstanding';
		lines.push(
			`  ${verdict.padEnd(11)} ${item.id.padEnd(26)} ${scLabel(item)} ${item.surface.padEnd(22)} [${item.state}]`,
		);
	}
	lines.push('');
	lines.push('excluded criteria (stated, not dropped silently):');
	if (evidence.excluded.length === 0) lines.push('  (none)');
	for (const entry of evidence.excluded) {
		lines.push(`  - SC ${entry.sc} ${WCAG_22_CRITERIA[entry.sc].name} — ${entry.reason}`);
	}
	lines.push('');
	lines.push(
		`site-level conformance claim: ${
			evidence.humanVerified > 0
				? 'available (a human verification exists and the claim must point at this matrix)'
				: 'NOT available — no human verification exists, so no document may claim WCAG 2.2 AA conformance'
		}`,
	);
	lines.push(
		'a green run of this gate means the TABLE is intact. It does not mean the site conforms to WCAG 2.2 AA.',
	);
	lines.push('');
	if (evidence.violations.length > 0) {
		lines.push(`violations (${evidence.violations.length}):`);
		for (const violation of evidence.violations) {
			lines.push(`  [${violation.rule}] ${violation.file} — ${violation.message}`);
		}
	} else {
		lines.push('no violations');
	}
	return lines.join('\n');
}

/** `SC 1.4.3 (AA)` for an item. */
function scLabel(item) {
	const sc = (item.sc ?? []).map((entry) => `${entry} (${WCAG_22_CRITERIA[entry]?.level ?? '?'})`);
	return sc.join(', ');
}

/* ------------------------------------------------------------------ *
 * entry point
 * ------------------------------------------------------------------ */

/** The npm scripts of the repository, or `null` when they cannot be read. */
export function readPackageScripts(repoRoot = REPO_ROOT) {
	try {
		const manifest = readJson(resolve(repoRoot, 'package.json'));
		return manifest.scripts ?? {};
	} catch {
		return null;
	}
}

/** Collect every piece of evidence the gate reports. */
export function collectEvidence({
	today = todayIso(),
	repoRoot = REPO_ROOT,
	matrixPath = MATRIX_PATH,
} = {}) {
	const absolute = resolve(repoRoot, matrixPath);
	if (!existsSync(absolute)) {
		throw new Error(`the review matrix ${matrixPath} does not exist`);
	}
	let matrix = null;
	try {
		matrix = readJson(absolute);
	} catch (error) {
		throw new Error(`the review matrix ${matrixPath} cannot be parsed: ${error.message}`);
	}
	const shapeProblems = validateShape(matrix);
	if (shapeProblems.length > 0) {
		throw new Error(`the review matrix ${matrixPath} is not a matrix: ${shapeProblems.join('; ')}`);
	}
	const packageScripts = readPackageScripts(repoRoot);
	const audited = auditMatrix(matrix, { today, repoRoot, packageScripts });
	const fixtures = auditFixtures({ repoRoot, today, packageScripts });
	return {
		matrix,
		matrixPath,
		updatedAt: filledString(matrix.updatedAt) ?? '(no revision recorded)',
		reviewWindowDays: matrix.reviewWindowDays,
		items: audited.items,
		surfaces: audited.surfaces,
		states: audited.states,
		excluded: audited.excluded,
		coveredCriteria: audited.coveredCriteria,
		claims: audited.claims,
		humanVerified: audited.humanVerified,
		humanFailed: audited.items.filter((item) => item?.review?.state === 'human-failed').length,
		humanReviewed: audited.items.filter((item) => item?.review?.state !== 'auto-pass').length,
		outstanding: audited.outstanding,
		machineChecked: audited.machineChecked,
		fixtures: fixtures.files,
		violations: [...audited.violations, ...fixtures.violations],
	};
}

function usage() {
	process.stderr.write(
		'usage: check-a11y-wcag-review-matrix.mjs [--quiet] [--json=FILE] [--today=YYYY-MM-DD] [--matrix=PATH]\n',
	);
}

export function runGate(argv = process.argv.slice(2)) {
	const quiet = argv.includes('--quiet');
	const jsonIndex = argv.indexOf('--json');
	const jsonOut = jsonIndex === -1 ? null : (argv[jsonIndex + 1] ?? null);
	const todayIndex = argv.indexOf('--today');
	const today = todayIndex === -1 ? todayIso() : (argv[todayIndex + 1] ?? todayIso());
	const matrixIndex = argv.indexOf('--matrix');
	const matrixPath = matrixIndex === -1 ? MATRIX_PATH : (argv[matrixIndex + 1] ?? MATRIX_PATH);
	for (const arg of argv) {
		if (
			arg.startsWith('--') &&
			!['--quiet', '--json', '--today', '--matrix'].includes(arg.split('=')[0])
		) {
			usage();
			throw new Error(`unknown option: ${arg}`);
		}
	}
	if (jsonIndex !== -1 && jsonOut === null) {
		usage();
		throw new Error('--json requires a path');
	}

	const evidence = collectEvidence({ today, matrixPath });

	if (!quiet) {
		process.stdout.write(`${renderGateSummary(evidence)}\n`);
	}
	for (const violation of evidence.violations) {
		process.stderr.write(`error [${violation.rule}]: ${violation.message}\n`);
	}
	if (jsonOut) {
		const target = resolve(REPO_ROOT, jsonOut);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`);
		process.stdout.write(`check-a11y-wcag-review-matrix: report ${jsonOut}\n`);
	}
	return evidence.violations.length === 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		if (!runGate()) process.exit(1);
	} catch (error) {
		process.stderr.write(`check-a11y-wcag-review-matrix: ${error.message}\n`);
		process.exit(2);
	}
}
