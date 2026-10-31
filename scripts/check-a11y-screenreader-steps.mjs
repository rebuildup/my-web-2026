#!/usr/bin/env node

/**
 * check-a11y-screenreader-steps — keep the screen-reader procedure
 * ledger honest (Issue #402).
 *
 * What this gate is for
 * ---------------------
 * Whether a screen reader announces a heading, an operation name or an
 * input error in a way a person can act on is a judgement **a machine
 * cannot make**. The automated a11y gates in this repository decide what
 * a machine can decide (names, roles, contrast ratios, heading
 * outlines). They cannot decide what a listener hears.
 *
 * So this gate manages the RECORD of the manual review:
 *
 *   - which operation a person has to perform, on which surface, in
 *     which state, with which assistive technology, in which environment;
 *   - what announcement that operation is expected to produce;
 *   - whether the review has been performed at all, and if it has, who
 *     performed it, when, and what they actually heard.
 *
 * The central rule
 * -----------------
 * **An automated pass is not a screen-reader verification, and the two
 * can never be confused.** The axe audit of Issue #393 is a different
 * thing with a different owner: it can show that a control has an
 * accessible name, and it can never show that a person heard the name
 * in a useful order. A step that leans on an automated audit as its
 * human evidence is a violation.
 *
 * The second rule
 * ---------------
 * **A review that has not happened is "not-performed", not a failure and
 * not a pass.** The observation columns of a step stay empty until a
 * person fills them in, and an empty observation is never a violation.
 * A green run therefore means "the ledger of the manual review is
 * intact", never "the site was read aloud and confirmed".
 *
 * The rules
 * ---------
 *   step-field-missing
 *       A required field of a step is missing or empty.
 *   step-duplicate-id
 *       Two steps share an id.
 *   step-subject-unknown
 *       A step names a subject that is not in the ledger's vocabulary.
 *   step-state-unknown
 *       A step names a state that is not in the ledger's vocabulary.
 *   step-wcag-unknown
 *       A step names a success criterion that the ledger does not
 *       declare. An unknown number is never assumed to be covered.
 *   step-assistive-technology-unknown
 *       A step does not name one of the declared assistive technologies.
 *   step-result-invalid
 *       The recorded result is not one of the declared results.
 *   step-evidence-missing
 *       A performed step is missing the observation, the performer or
 *       the date.
 *   step-evidence-mismatch
 *       A step that claims "not-performed" carries an observation, or a
 *       performed step carries no observation.
 *   step-evidence-stale
 *       The observation is older than the review window, or its date is
 *       not a date, or it is in the future.
 *   step-surface-missing
 *       A step points at a file or a story export that does not exist.
 *       A review of a surface that is gone proves nothing.
 *   step-axe-substituted
 *       A step passes an automated audit off as the evidence of a human
 *       screen-reader verification.
 *   subject-uncovered
 *       A subject of the vocabulary has no step at all.
 *   state-uncovered
 *       A state of the vocabulary has no step at all.
 *   criterion-uncovered
 *       A success criterion the ledger declares has no step at all.
 *   fixture-expectation-mismatch
 *       A fixture does not behave the way its own expectation says.
 *   fixture-contract-missing
 *       A fixture file is missing, unparsable, or a directory is empty.
 *
 * Exit codes: 0 = the ledger is intact, 1 = at least one violation,
 * 2 = the gate cannot decide (the ledger cannot be read).
 *
 * Usage:
 *   node scripts/check-a11y-screenreader-steps.mjs [--quiet] [--json=FILE]
 *   node scripts/check-a11y-screenreader-steps.mjs --today=2026-10-23
 *   node scripts/check-a11y-screenreader-steps.mjs --ledger=<path>
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The committed ledger. Owner data: read by the gate, written by the reviewer. */
export const LEDGER_PATH = 'quality/screenreader-steps.json';

/** Where the gate's own fixtures live. */
export const FIXTURE_ROOT = 'scripts/fixtures/a11y-screenreader-steps';
export const FIXTURE_PASS_DIR = `${FIXTURE_ROOT}/pass`;
export const FIXTURE_FAIL_DIR = `${FIXTURE_ROOT}/fail`;

/**
 * The fixture files this gate expects in each directory.
 *
 * The set is EXACT: a fixture that quietly lost a file would verify
 * nothing, and a fixture nobody declared would verify nothing either.
 */
export const FIXTURE_FILES = {
	pass: ['01-intact-ledger.json', '02-performed-step.json'],
	fail: [
		'01-step-without-performer.json',
		'02-missing-surface.json',
		'03-axe-substituted.json',
		'04-unknown-subject.json',
		'05-not-performed-with-observation.json',
		'06-duplicate-id.json',
		'07-uncovered-criterion.json',
		'08-stale-observation.json',
	],
};

/**
 * How long a performed review stays evidence.
 *
 * A screen-reader review describes the surface as it was when it was
 * performed. When the surface has changed since, the record has to be
 * made again.
 */
export const REVIEW_WINDOW_DAYS = 365;

/**
 * The date a fixture is judged on.
 *
 * A fixture has to give the same verdict today and in a year, so the
 * freshness of its evidence is measured against a FIXED date instead
 * of the day the gate happens to run. The run date decides whether the
 * repository's own ledger is fresh — it must not decide whether a
 * fixture still passes. (The sibling gate of Issue #410 works the same
 * way, for the same reason.)
 */
export const FIXTURE_REFERENCE_DATE = '2026-10-23';

/** The results a step may carry. */
export const RESULTS = ['not-performed', 'pass', 'fail'];

/**
 * The fields every step must carry (pure).
 *
 * The observation columns are NOT in this list: they are empty until a
 * person performs the review, and an empty observation is a legitimate
 * state, not an incomplete record.
 */
export const REQUIRED_STEP_FIELDS = [
	'id',
	'subject',
	'operation',
	'surface',
	'assistiveTechnology',
	'environment',
	'expectedAnnounce',
	'result',
	'wcag',
];

/** The observation columns, in the order the record sheet prints them. */
export const OBSERVATION_FIELDS = ['observedAnnounce', 'performer', 'performedAt'];

/** The rule names, in report order. */
export const RULES = [
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
];

/**
 * The WCAG criteria this ledger speaks about.
 *
 * The vocabulary is closed on purpose: a criterion the ledger does not
 * declare is a criterion nobody decided to review, and it is never
 * assumed to be covered.
 */
export const WCAG_CRITERIA = {
	'1.3.1': { name: 'Info and Relationships', level: 'A' },
	'2.4.6': { name: 'Headings and Labels', level: 'AA' },
	'3.3.1': { name: 'Error Identification', level: 'A' },
	'4.1.2': { name: 'Name, Role, Value', level: 'A' },
};

/** Whether a value is missing or empty (pure). */
export function isEmpty(value) {
	if (value === undefined || value === null) return true;
	if (typeof value === 'string') return value.trim() === '';
	if (Array.isArray(value)) return value.length === 0;
	return false;
}

/** Whether a step carries an observation (pure). */
export function hasObservation(step) {
	return OBSERVATION_FIELDS.some((field) => !isEmpty(step?.[field]));
}

/** Whether a step claims the review has been performed (pure). */
export function isPerformed(step) {
	return step?.result === 'pass' || step?.result === 'fail';
}

/** The days between two dates (pure). */
export function daysBetween(from, to) {
	return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * The tokens that name an automated audit.
 *
 * The rule is not about one product: it is about the CLAIM. A record
 * that says "the automated audit passed, so a person verified it" is
 * the defect the Issue names, whether the audit is axe, another
 * checker, or a script. The tokens are matched with word boundaries so
 * an ordinary word that happens to contain a token ("the taxes passed")
 * is not a false positive.
 */
export const AUTOMATED_AUDIT_TOKENS = [
	{ name: 'axe', pattern: /\baxe\b/i },
	{ name: '自動監査', pattern: /自動監査/ },
	{ name: '自動チェック', pattern: /自動チェック/ },
	{ name: 'automated audit', pattern: /\bautomated[\s-]+audit\b/i },
	{ name: 'automated check', pattern: /\bautomated[\s-]+check(?:er|ed|ing)?\b/i },
	{ name: 'checker', pattern: /\bchecker\b/i },
];

/**
 * The words that turn an audit mention into a VERIFICATION claim.
 *
 * A plain cross-reference ("the axe audit of Issue #393 is a different
 * thing") names an audit without claiming anything, and stays allowed.
 */
const VERIFICATION_WORDS = /合格|確認済|確認した|検証済|passed|passes|pass|verified/i;

/** How far apart an audit token and a verification word may be. */
const AUDIT_CLAIM_WINDOW = 30;

/**
 * Whether a piece of text leans on an automated audit as the evidence of
 * a human review (pure).
 *
 * Two shapes are refused:
 *
 *   - the text ties an automated audit to a verification claim
 *     ("the axe run passed, so it is verified");
 *   - a performed step's observation mentions an automated audit at all,
 *     because a screen-reader observation cannot come from one.
 *
 * A plain cross-reference ("the axe audit of Issue #393 is a different
 * thing") is not a claim and stays allowed.
 */
export function leansOnAutomatedAudit(text) {
	if (typeof text !== 'string' || text.trim() === '') return false;
	for (const token of AUTOMATED_AUDIT_TOKENS) {
		const pattern = new RegExp(token.pattern.source, `${token.pattern.flags.replace('g', '')}g`);
		let match = pattern.exec(text);
		while (match !== null) {
			const from = Math.max(0, match.index - AUDIT_CLAIM_WINDOW);
			const to = Math.min(text.length, match.index + match[0].length + AUDIT_CLAIM_WINDOW);
			if (VERIFICATION_WORDS.test(text.slice(from, to))) return true;
			if (match[0].length === 0) pattern.lastIndex += 1;
			match = pattern.exec(text);
		}
	}
	return false;
}

/** Whether a performed observation mentions an automated audit (pure). */
export function observationMentionsAudit(text) {
	if (typeof text !== 'string') return false;
	return AUTOMATED_AUDIT_TOKENS.some((token) => token.pattern.test(text));
}

/**
 * Whether a source file declares a named export (pure).
 *
 * The declaration is matched, not the mere occurrence of the name: a
 * story whose export name only survives in a comment or in a string is
 * not a story the step can be performed on.
 */
export function declaresExport(source, name) {
	if (typeof source !== 'string' || typeof name !== 'string' || name.trim() === '') return false;
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(
		`export\\s+(?:const|let|var|function|class|async\\s+function)\\s+${escaped}\\b`,
	).test(source);
}

/**
 * The violations of one step (pure over the step and the ledger).
 *
 * `exists` answers whether a repository-relative path exists, and
 * `readFile` reads a repository-relative path; both are injected so the
 * rule functions stay pure and testable.
 */
export function evaluateStep(step, { ledger, exists, readFile, today }) {
	const violations = [];
	const push = (rule, message, extra = {}) => {
		violations.push({ rule, id: step?.id ?? null, message, ...extra });
	};

	for (const field of REQUIRED_STEP_FIELDS) {
		if (isEmpty(step?.[field])) {
			push('step-field-missing', `the step does not say \`${field}\``, { field });
		}
	}
	if (!isEmpty(step?.wcag) && !Array.isArray(step.wcag)) {
		push('step-field-missing', 'the step does not list its success criteria', {
			field: 'wcag',
		});
	}

	const subjects = new Set((ledger?.subjects ?? []).map((subject) => subject.id));
	if (!isEmpty(step?.subject) && !subjects.has(step.subject)) {
		push(
			'step-subject-unknown',
			`the step names the subject \`${step.subject}\`, which the ledger does not declare`,
		);
	}

	const states = new Set((ledger?.states ?? []).map((state) => state.id));
	const surface = step?.surface;
	const surfaceObject =
		surface && typeof surface === 'object' && !Array.isArray(surface) ? surface : null;
	if (!surfaceObject) {
		// The surface has to be an object with a path. A surface that is
		// a bare string (or anything else) is a broken record, and the
		// existence check must not be skipped because of it: a step
		// whose surface cannot be read is a step whose surface cannot
		// be proved to exist.
		push('step-field-missing', 'the step does not describe its surface as an object with a path', {
			field: 'surface',
		});
		const candidate = typeof surface === 'string' ? surface.trim() : '';
		if (candidate !== '' && !exists(candidate)) {
			push(
				'step-surface-missing',
				`the step points at \`${candidate}\`, which does not exist; a review of a surface that is gone proves nothing`,
			);
		}
	} else {
		if (!isEmpty(surfaceObject.state) && !states.has(surfaceObject.state)) {
			push(
				'step-state-unknown',
				`the step names the state \`${surfaceObject.state}\`, which the ledger does not declare`,
			);
		}
		const path = surfaceObject.path;
		if (isEmpty(path)) {
			push('step-field-missing', 'the step does not say which surface it is about', {
				field: 'surface.path',
			});
		} else if (!exists(path)) {
			push(
				'step-surface-missing',
				`the step points at \`${path}\`, which does not exist; a review of a surface that is gone proves nothing`,
			);
		} else if (!isEmpty(surfaceObject.export)) {
			const source = readFile(path) ?? '';
			if (!declaresExport(source, surfaceObject.export)) {
				push(
					'step-surface-missing',
					`the step points at the export \`${surfaceObject.export}\` of \`${path}\`, which that file does not declare`,
				);
			}
		}
	}

	if (!isEmpty(step?.wcag) && Array.isArray(step.wcag)) {
		for (const criterion of step.wcag) {
			if (!(criterion in WCAG_CRITERIA)) {
				push(
					'step-wcag-unknown',
					`the step names the success criterion ${criterion}, which the ledger does not declare`,
				);
			}
		}
	}

	const technologies = (ledger?.assistiveTechnologies ?? []).map((entry) => entry.id);
	if (!isEmpty(step?.assistiveTechnology) && technologies.length > 0) {
		const named = technologies.some((technology) =>
			String(step.assistiveTechnology).toLowerCase().includes(technology.toLowerCase()),
		);
		if (!named) {
			push(
				'step-assistive-technology-unknown',
				`the step does not name one of the declared assistive technologies (${technologies.join(', ')})`,
			);
		}
	}

	if (!isEmpty(step?.result) && !RESULTS.includes(step.result)) {
		push(
			'step-result-invalid',
			`the step records the result \`${step.result}\`, which is not one of ${RESULTS.join(' / ')}`,
		);
	}

	if (isPerformed(step)) {
		for (const field of OBSERVATION_FIELDS) {
			if (isEmpty(step[field])) {
				push(
					'step-evidence-missing',
					`the step claims the review was performed but does not say \`${field}\``,
					{ field },
				);
			}
		}
		if (!isEmpty(step.performedAt)) {
			const date = new Date(`${step.performedAt}T00:00:00Z`);
			if (Number.isNaN(date.getTime())) {
				push(
					'step-evidence-stale',
					`the step records the date \`${step.performedAt}\`, which is not a date`,
				);
			} else if (date.getTime() > today.getTime()) {
				push(
					'step-evidence-stale',
					`the step records the date \`${step.performedAt}\`, which is in the future`,
				);
			} else {
				const window = ledger?.reviewWindowDays ?? REVIEW_WINDOW_DAYS;
				if (daysBetween(date, today) > window) {
					push(
						'step-evidence-stale',
						`the step was performed on \`${step.performedAt}\`, which is older than the ${window}-day review window; the review has to be made again`,
					);
				}
			}
		}
		if (observationMentionsAudit(step.observedAnnounce)) {
			push(
				'step-axe-substituted',
				'the step passes an automated audit off as the observation of a screen-reader review; a listener has to do the listening',
			);
		}
	} else if (hasObservation(step)) {
		push(
			'step-evidence-mismatch',
			'the step carries an observation but does not claim the review was performed',
		);
	}

	const notes = typeof step?.notes === 'string' ? step.notes : '';
	if (leansOnAutomatedAudit(notes) || leansOnAutomatedAudit(step?.observedAnnounce)) {
		push(
			'step-axe-substituted',
			'the step leans on an automated audit as the evidence of a human screen-reader verification',
		);
	}

	return violations;
}

/**
 * The shape a ledger must have (pure).
 *
 * A ledger that cannot be read is NOT a ledger without problems: it is
 * a ledger the gate cannot judge, and the two are different verdicts.
 * The shape is therefore checked before anything else, and a broken
 * shape ends the run as "cannot decide" (exit 2) instead of "no
 * violations" (exit 0).
 *
 * The vocabulary (subjects / states / wcag / assistive technologies) is
 * part of the shape: a ledger that declares nothing to cover is a
 * ledger whose coverage rules can never fire, so a green run would
 * mean nothing.
 */
export function validateLedgerShape(ledger) {
	const problems = [];
	if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
		return ['the ledger is not a JSON object'];
	}
	if (!Array.isArray(ledger.steps)) {
		problems.push('steps must be an array');
	}
	for (const [field, label] of [
		['subjects', 'subjects'],
		['states', 'states'],
		['wcag', 'wcag'],
		['assistiveTechnologies', 'assistive technologies'],
	]) {
		if (!Array.isArray(ledger[field]) || ledger[field].length === 0) {
			problems.push(`${label} must be a non-empty array`);
		}
	}
	if (
		typeof ledger.reviewWindowDays !== 'number' ||
		!Number.isInteger(ledger.reviewWindowDays) ||
		ledger.reviewWindowDays <= 0
	) {
		problems.push('reviewWindowDays must be a positive integer');
	}
	return problems;
}

/**
 * The violations of the whole ledger (pure over the ledger and the
 * repository).
 */
export function evaluateLedger({ ledger, exists, readFile, today }) {
	const violations = [];
	const steps = Array.isArray(ledger?.steps) ? ledger.steps : [];

	const seen = new Set();
	for (const step of steps) {
		violations.push(...evaluateStep(step, { ledger, exists, readFile, today }));
		const id = step?.id;
		if (!isEmpty(id)) {
			if (seen.has(id)) {
				violations.push({
					rule: 'step-duplicate-id',
					id,
					message: `two steps share the id \`${id}\``,
				});
			}
			seen.add(id);
		}
	}

	const usedSubjects = new Set(steps.map((step) => step?.subject).filter((id) => !isEmpty(id)));
	for (const subject of ledger?.subjects ?? []) {
		if (!usedSubjects.has(subject.id)) {
			violations.push({
				rule: 'subject-uncovered',
				id: null,
				message: `the subject \`${subject.id}\` (${subject.description}) has no step at all`,
			});
		}
	}

	const usedStates = new Set(
		steps.map((step) => step?.surface?.state).filter((id) => !isEmpty(id)),
	);
	for (const state of ledger?.states ?? []) {
		if (!usedStates.has(state.id)) {
			violations.push({
				rule: 'state-uncovered',
				id: null,
				message: `the state \`${state.id}\` (${state.description}) has no step at all`,
			});
		}
	}

	const usedCriteria = new Set(
		steps.flatMap((step) => (Array.isArray(step?.wcag) ? step.wcag : [])),
	);
	for (const criterion of ledger?.wcag ?? []) {
		if (!usedCriteria.has(criterion.id)) {
			violations.push({
				rule: 'criterion-uncovered',
				id: null,
				message: `the success criterion ${criterion.id} (${criterion.name}) has no step at all`,
			});
		}
	}

	return violations;
}

/** A summary of the ledger, for the report and for the capture (pure). */
export function summarizeLedger(ledger) {
	const steps = Array.isArray(ledger?.steps) ? ledger.steps : [];
	const performed = steps.filter((step) => isPerformed(step));
	return {
		steps: steps.length,
		performed: performed.length,
		notPerformed: steps.length - performed.length,
		subjects: (ledger?.subjects ?? []).length,
		states: (ledger?.states ?? []).length,
		criteria: (ledger?.wcag ?? []).length,
		technologies: (ledger?.assistiveTechnologies ?? []).length,
	};
}

/**
 * The gate's own fixtures (pure over the fixture files).
 *
 * Every fixture is a complete ledger, so the same rule functions judge
 * it. A fixture declares the rules it expects in `$expects`; the gate
 * compares the rules it actually found with that expectation.
 *
 * The fixtures are judged on a FIXED reference date
 * ({@link FIXTURE_REFERENCE_DATE}), never on the day the gate runs: a
 * fixture that passed yesterday and fails today because the calendar
 * moved is a fixture nobody can repair.
 */
export function evaluateFixtures({
	fixtureFiles,
	exists,
	readFile,
	referenceDate = FIXTURE_REFERENCE_DATE,
}) {
	const violations = [];
	const today = new Date(`${referenceDate}T00:00:00Z`);
	if (Number.isNaN(today.getTime())) {
		throw new Error(
			`the fixture reference date is not a date: ${referenceDate} (it must be a fixed date, not the run date)`,
		);
	}
	for (const [kind, expectedFiles] of Object.entries(FIXTURE_FILES)) {
		const directory = kind === 'pass' ? FIXTURE_PASS_DIR : FIXTURE_FAIL_DIR;
		const present = fixtureFiles[kind] ?? [];
		if (present.length === 0) {
			violations.push({
				rule: 'fixture-contract-missing',
				id: null,
				message: `the ${kind} fixture directory \`${directory}\` is empty`,
			});
			continue;
		}
		for (const expected of expectedFiles) {
			if (!present.includes(expected)) {
				violations.push({
					rule: 'fixture-contract-missing',
					id: null,
					message: `the ${kind} fixture \`${expected}\` is missing from \`${directory}\``,
				});
			}
		}
		for (const unexpected of present) {
			if (!expectedFiles.includes(unexpected)) {
				violations.push({
					rule: 'fixture-contract-missing',
					id: null,
					message: `the ${kind} fixture \`${unexpected}\` is not declared in the gate's fixture contract`,
				});
			}
		}
		for (const file of expectedFiles) {
			if (!present.includes(file)) continue;
			const path = `${directory}/${file}`;
			const source = readFile(path);
			if (source === null) {
				violations.push({
					rule: 'fixture-contract-missing',
					id: null,
					message: `the fixture \`${path}\` cannot be read`,
				});
				continue;
			}
			let fixture;
			try {
				fixture = JSON.parse(source);
			} catch (error) {
				violations.push({
					rule: 'fixture-contract-missing',
					id: null,
					message: `the fixture \`${path}\` is not parsable JSON: ${error.message}`,
				});
				continue;
			}
			const expected = Array.isArray(fixture.$expects) ? fixture.$expects : [];
			const shapeProblems = validateLedgerShape(fixture);
			if (shapeProblems.length > 0) {
				violations.push({
					rule: 'fixture-contract-missing',
					id: null,
					message: `the fixture \`${path}\` is not a ledger: ${shapeProblems.join('; ')}`,
				});
				continue;
			}
			const found = evaluateLedger({ ledger: fixture, exists, readFile, today });
			const foundRules = [...new Set(found.map((violation) => violation.rule))].sort();
			const expectedRules = [...new Set(expected)].sort();
			if (foundRules.join(',') !== expectedRules.join(',')) {
				violations.push({
					rule: 'fixture-expectation-mismatch',
					id: null,
					message: `the fixture \`${path}\` reports [${foundRules.join(', ')}] but expects [${expectedRules.join(', ')}]`,
				});
			}
		}
	}
	return violations;
}

/** Read the fixture file names of both directories (pure over the fs). */
export function readFixtureFiles(repoRoot = REPO_ROOT) {
	const read = (directory) => {
		const absolute = join(repoRoot, directory);
		if (!existsSync(absolute)) return [];
		return readdirSync(absolute)
			.filter((name) => name.endsWith('.json'))
			.sort();
	};
	return { pass: read(FIXTURE_PASS_DIR), fail: read(FIXTURE_FAIL_DIR) };
}

/**
 * Whether an absolute path lies inside the repository (pure).
 *
 * Containment is decided on PATH SEGMENTS, never on characters. A
 * string-prefix test is not a containment test: with the repository at
 * `/work/repo`, the sibling directory `/work/repo-private` starts with
 * the string `/work/repo`, so a prefix guard lets `../repo-private/…`
 * pass and a file that lives OUTSIDE the repository is accepted as an
 * in-repository surface. That is exactly what this gate exists to
 * refuse.
 *
 * The decision is therefore made with `relative(root, absolute)`:
 *
 *   - an empty result is the repository root itself — a directory, not
 *     a reviewable surface, so it is refused;
 *   - a result that starts with `..` (as a segment) is outside;
 *   - an absolute result is on a different root.
 */
export function isInsideRepository(absolute, repoRoot = REPO_ROOT) {
	const root = resolve(repoRoot);
	const target = resolve(absolute);
	const inside = relative(root, target);
	if (inside === '') return false;
	if (isAbsolute(inside)) return false;
	if (inside === '..' || inside.startsWith(`..${sep}`)) return false;
	return true;
}

/**
 * The absolute path of a repository-relative path (or null).
 *
 * The path is resolved against the repository root, so `..` segments
 * are collapsed before the containment decision is made, and the result
 * is kept only when it is really inside the repository.
 */
export function resolveInsideRepository(path, repoRoot = REPO_ROOT) {
	if (typeof path !== 'string' || path === '') return null;
	const root = resolve(repoRoot);
	const absolute = resolve(root, path);
	if (!isInsideRepository(absolute, root)) return null;
	return absolute;
}

/** Read a repository-relative file (or null). */
export function readRepoFile(path, repoRoot = REPO_ROOT) {
	const absolute = resolveInsideRepository(path, repoRoot);
	if (absolute === null) return null;
	if (!existsSync(absolute)) return null;
	return readFileSync(absolute, 'utf8');
}

/** Whether a repository-relative path exists inside the repository. */
export function repoFileExists(path, repoRoot = REPO_ROOT) {
	const absolute = resolveInsideRepository(path, repoRoot);
	if (absolute === null) return false;
	return existsSync(absolute);
}

/** The report the gate prints (pure). */
export function renderReport({ ledger, summary, violations }) {
	const lines = [];
	lines.push('screen reader procedure ledger — Issue #402');
	lines.push(
		`read ${summary.steps} step(s) from ${LEDGER_PATH}; ${summary.performed} performed, ${summary.notPerformed} not performed`,
	);
	lines.push('');
	lines.push('machine-checked:');
	const checks = [
		[
			'step-record-complete',
			['step-field-missing', 'step-duplicate-id'],
			'every step names the operation, the surface, the assistive technology, the environment and the expected announcement (SC 1.3.1 / 2.4.6 / 3.3.1 / 4.1.2)',
		],
		[
			'step-vocabulary-known',
			[
				'step-subject-unknown',
				'step-state-unknown',
				'step-wcag-unknown',
				'step-assistive-technology-unknown',
				'step-result-invalid',
			],
			'every step names a subject, a state, a success criterion, an assistive technology and a result the ledger declares',
		],
		[
			'step-surface-exists',
			['step-surface-missing'],
			'every step points at a surface that still exists (a review of a surface that is gone proves nothing)',
		],
		[
			'step-observation-is-human',
			['step-axe-substituted'],
			'no step passes an automated audit off as the evidence of a screen-reader verification',
		],
		[
			'step-observation-consistent',
			['step-evidence-missing', 'step-evidence-mismatch', 'step-evidence-stale'],
			'a performed step carries its observation, its performer and its date, and a step that has not been performed carries no observation',
		],
		[
			'coverage',
			['subject-uncovered', 'state-uncovered', 'criterion-uncovered'],
			'every declared subject, state and success criterion has a step (a silence is a decision, not a coverage)',
		],
		[
			'fixture',
			['fixture-expectation-mismatch', 'fixture-contract-missing'],
			'the gate fixtures reproduce the states they stand for',
		],
	];
	for (const [name, rules, description] of checks) {
		const count = violations.filter((violation) => rules.includes(violation.rule)).length;
		lines.push(
			`  ${count === 0 ? 'ok  ' : 'FAIL'} ${name.padEnd(28)} [${rules.join(', ')}] ${description}`,
		);
	}
	lines.push('');
	lines.push('not machine-checked (human evaluation):');
	lines.push(
		'  - whether the announcement is the one the step expects, in that order, and in a form a person can act on',
	);
	lines.push(
		'  - whether the announcement is complete (a truncated label, a lost role, a silent state change)',
	);
	lines.push(
		'  - whether the review still describes the surface after the surface changed (the review window is a floor, not a proof)',
	);
	lines.push('');
	if (violations.length === 0) {
		lines.push('no violations');
		lines.push('');
		lines.push(
			'no violations means the LEDGER is intact. It does not mean the site was read aloud:',
			`${summary.notPerformed} of ${summary.steps} step(s) are still not performed.`,
		);
	} else {
		lines.push(`violations (${violations.length}):`);
		for (const violation of violations) {
			lines.push(
				`  [${violation.rule}] ${violation.id ? `${violation.id} — ` : ''}${violation.message}`,
			);
		}
	}
	return lines.join('\n');
}

/** Parse the command line arguments. */
export function parseArgs(argv) {
	const options = {
		quiet: false,
		jsonOut: null,
		today: new Date().toISOString().slice(0, 10),
		ledger: LEDGER_PATH,
	};
	for (const arg of argv) {
		const separator = arg.indexOf('=');
		const flag = (
			arg.startsWith('--') ? arg.slice(2, separator === -1 ? undefined : separator) : arg
		).replace(/^--/, '');
		const value = separator === -1 ? null : arg.slice(separator + 1);
		if (flag === 'quiet') options.quiet = true;
		else if (flag === 'json') options.jsonOut = value;
		else if (flag === 'today') options.today = value;
		else if (flag === 'ledger') options.ledger = value;
	}
	return options;
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const source = readRepoFile(options.ledger);
	if (source === null) {
		process.stderr.write(`[check-a11y-screenreader-steps] cannot read ${options.ledger}\n`);
		process.exit(2);
	}
	let ledger;
	try {
		ledger = JSON.parse(source);
	} catch (error) {
		process.stderr.write(
			`[check-a11y-screenreader-steps] ${options.ledger} is not parsable JSON: ${error.message}\n`,
		);
		process.exit(2);
	}
	const today = new Date(`${options.today}T00:00:00Z`);
	if (Number.isNaN(today.getTime())) {
		process.stderr.write(
			`[check-a11y-screenreader-steps] --today is not a date: ${options.today}\n`,
		);
		process.exit(2);
	}

	const exists = (path) => repoFileExists(path);
	const readFile = (path) => readRepoFile(path);
	const violations = [
		...evaluateLedger({ ledger, exists, readFile, today }),
		...evaluateFixtures({ fixtureFiles: readFixtureFiles(), exists, readFile, today }),
	];
	const summary = summarizeLedger(ledger);

	if (!options.quiet) {
		process.stdout.write(`${renderReport({ ledger, summary, violations })}\n`);
	}
	if (options.jsonOut) {
		const absolute = resolve(REPO_ROOT, options.jsonOut);
		process.stdout.write(
			`[check-a11y-screenreader-steps] report → ${relative(REPO_ROOT, absolute)}\n`,
		);
		mkdirSync(dirname(absolute), { recursive: true });
		writeFileSync(
			absolute,
			`${JSON.stringify({ issue: '#402', summary, violations }, null, '\t')}\n`,
		);
	}
	process.exit(violations.length > 0 ? 1 : 0);
}

if (process.argv[1]?.endsWith('check-a11y-screenreader-steps.mjs')) {
	main();
}
