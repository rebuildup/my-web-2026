import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	AUTO_APPLY_DISPOSITIONS,
	evaluateCorpus,
	loadContract,
	loadCorpus,
} from './check-copy-meaning-diff.mjs';
import {
	ARTEFACT_PATH,
	HTML_REPORT_PATH,
	JSON_REPORT_PATH,
	REPORT_DIR,
	TEXT_REPORT_PATH,
	WEBP_MAX_BYTES,
	assertWebpOutputPath,
	buildReportFiles,
	buildReportModel,
	screenshotBudgetVerdict,
} from './make-copy-meaning-diff-report.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Regression suite for the meaning-diff verification report (Issue #426).
 *
 * The report is what a reviewer reads, so the two properties that make
 * it trustworthy are asserted here:
 *
 * 1. The report is generated FROM the corpus, through the gate's own
 *    evaluation — not from a second classification that could drift
 *    away from the gate.
 * 2. The report enumerates the meaning-preservation violations: every
 *    proposal whose claim (a number, a negation, a permission marker)
 *    did not survive the rewrite is listed with its evidence code.
 *
 * The auto-apply vocabulary is asserted empty in both directions: the
 * gate exposes no disposition that may be applied without a person, and
 * the report counts zero auto-appliable cases.
 */

const corpus = loadCorpus();
const contract = loadContract();
const result = evaluateCorpus(corpus, { contract });

describe('make-copy-meaning-diff-report — the report is generated from the corpus', () => {
	it('the shipped corpus evaluates without a finding', () => {
		assert.equal(result.summary.errors, 0, JSON.stringify(result.findings));
		assert.equal(result.summary.failed, 0);
		assert.equal(result.summary.total, corpus.cases.length);
	});

	it('the report carries the corpus, not a subset of it', () => {
		const files = buildReportFiles(result);

		assert.match(files.html, /Meaning-diff corpus/);
		assert.match(files.html, /permission-widened/);
		assert.match(files.html, /no-original/);
		assert.match(files.text, /meaning-diff corpus/);
		for (const testCase of corpus.cases) {
			assert.ok(
				files.text.includes(testCase.id),
				`the text report must list the case ${testCase.id}`,
			);
		}
	});

	it('the report names the paths it writes', () => {
		assert.equal(REPORT_DIR, '.tmp/copy-meaning-diff-report');
		assert.equal(HTML_REPORT_PATH, `${REPORT_DIR}/meaning-diff-evaluation.html`);
		assert.equal(TEXT_REPORT_PATH, `${REPORT_DIR}/meaning-diff-evaluation.txt`);
		assert.equal(JSON_REPORT_PATH, `${REPORT_DIR}/report.json`);
		assert.equal(ARTEFACT_PATH, 'docs/verification/copy/meaning-diff-evaluation.webp');
	});
});

describe('make-copy-meaning-diff-report — the report enumerates the meaning violations', () => {
	it('every case the gate classified as a drift is listed, with its evidence', () => {
		const model = buildReportModel(result);
		const driftRows = result.rows.filter((row) => row.actual.meaning === 'drift');

		assert.equal(model.meaningViolations.length, driftRows.length);
		assert.equal(model.meaningViolations.length > 0, true);
		for (const row of driftRows) {
			const listed = model.meaningViolations.find((item) => item.id === row.id);
			assert.ok(listed, `the report must list ${row.id}`);
			assert.deepEqual(listed.evidence, row.actual.evidence);
			assert.equal(listed.disposition, 'review-required');
		}
	});

	it('the three claim kinds Issue #426 names are visible in the report', () => {
		const model = buildReportModel(result);
		const evidence = new Set(model.meaningViolations.flatMap((item) => item.evidence));

		assert.ok(evidence.has('permission-drift'), 'a changed permission must be listed');
		assert.ok(evidence.has('number-drift'), 'a changed number must be listed');
		assert.ok(evidence.has('negation-drift'), 'an inverted negation must be listed');
	});

	it('the rendered report shows the violations, not only the model', () => {
		const files = buildReportFiles(result);

		for (const code of ['permission-drift', 'number-drift', 'negation-drift']) {
			assert.ok(files.html.includes(code), `the page must show ${code}`);
			assert.ok(files.text.includes(code), `the text report must show ${code}`);
		}
		assert.match(files.html, /meaning-drift/);
		assert.match(files.text, /meaning=drift/);
	});

	it('the report counts the axes it shows', () => {
		const model = buildReportModel(result);

		assert.equal(
			model.byMeaning.preserved + model.byMeaning.drift + model.byMeaning.undetermined,
			result.rows.length,
		);
		assert.equal(model.bySurface.typography, 1);
		assert.equal(model.byDisposition['review-required'], result.summary.reviewRequired);
		assert.equal(model.byDisposition['no-change'], 1);
	});

	it('nothing in the report is auto-appliable', () => {
		const model = buildReportModel(result);

		assert.deepEqual(AUTO_APPLY_DISPOSITIONS, []);
		assert.equal(model.autoAdoptCount, 0);
		assert.equal(
			result.rows.some((row) => row.actual.autoAdopt),
			false,
		);
	});
});

describe('make-copy-meaning-diff-report — the artefact is WebP and inside the budget', () => {
	it('a PNG destination is refused', () => {
		assert.throws(
			() => assertWebpOutputPath('docs/verification/copy/meaning-diff-evaluation.png'),
			/non-WebP/,
		);
	});

	it('the committed path is accepted and stays inside the repository', () => {
		assert.equal(
			assertWebpOutputPath(ARTEFACT_PATH, REPO_ROOT),
			'docs/verification/copy/meaning-diff-evaluation.webp',
		);
		assert.throws(() => assertWebpOutputPath('../outside.webp', REPO_ROOT), /outside/);
	});

	it('the budget verdict is a boundary, not a rounding rule', () => {
		assert.equal(screenshotBudgetVerdict(WEBP_MAX_BYTES).withinBudget, true);
		assert.equal(screenshotBudgetVerdict(WEBP_MAX_BYTES + 1).withinBudget, false);
	});
});
