import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	AUTO_APPLY_DISPOSITIONS,
	CORPUS_PATH,
	CONTRACT_PATH,
	DISPOSITIONS,
	MEANING_STATES,
	SURFACE_CLASSES,
	classifyProposal,
	evaluateCorpus,
	isJudgedLocale,
	loadContract,
	loadCorpus,
	optedInLocales,
	renderHtml,
	renderJson,
	renderText,
} from './check-copy-meaning-diff.mjs';
import { PERMISSION_MARKERS } from './check-copy-i18n.mjs';
import * as meaningDiff from './check-copy-meaning-diff.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'scripts/check-copy-meaning-diff.mjs');

/**
 * Regression suite for the meaning-diff corpus (Issue #426).
 *
 * The corpus is the ticket's deliverable: example sentences whose
 * rewriting changes — or does not change — what the reader is told.
 * These cases pin three things.
 *
 * 1. The corpus classifies as the corpus pins it. A drift in the
 *    heuristic is a red test, because the corpus is the contract the
 *    heuristic has to keep.
 * 2. The three examples the Issue names are detected. `未公開→公開` is
 *    the interesting one: `未公開` CONTAINS the substring `公開`, so a
 *    naive substring test reports the same marker set on both sides and
 *    the access-control widening is invisible. The compound marker is
 *    what makes the two sides differ.
 * 3. Nothing is auto-applied. The disposition vocabulary that could
 *    authorise an adoption is empty, and the classifier writes nothing.
 */

function runCli(args) {
	try {
		const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		});
		return { status: 0, stdout, stderr: '' };
	} catch (error) {
		return {
			status: error.status ?? 1,
			stdout: error.stdout ?? '',
			stderr: error.stderr ?? '',
		};
	}
}

function digest(path) {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const corpus = loadCorpus();
const contract = loadContract();
const result = evaluateCorpus(corpus, { contract });

describe('check-copy-meaning-diff — the corpus classifies as it is pinned', () => {
	it('reports no error finding against the committed corpus', () => {
		const errors = result.findings.filter((item) => item.severity === 'error');
		assert.deepEqual(
			errors.map((item) => `${item.code}: ${item.message}`),
			[],
		);
		assert.equal(result.summary.failed, 0);
		assert.equal(result.summary.passed, corpus.cases.length);
	});

	it('classifies every case exactly as the corpus expects', () => {
		for (const row of result.rows) {
			assert.equal(row.actual.meaning, row.expected.meaning, `${row.id}: meaning`);
			assert.equal(row.actual.surface, row.expected.surface, `${row.id}: surface`);
			assert.equal(
				row.actual.disposition,
				row.expected.disposition,
				`${row.id}: disposition`,
			);
			assert.deepEqual(
				[...row.actual.evidence].sort(),
				[...(row.expected.evidence ?? [])].sort(),
				`${row.id}: evidence`,
			);
		}
	});

	it('keeps the cases that need a person in the corpus', () => {
		const human = result.rows.filter((row) => row.actual.disposition === 'review-required');
		assert.ok(human.length > 0, 'the corpus must keep cases a person has to decide');
		for (const flag of ['number-drift', 'negation-drift', 'permission-drift']) {
			assert.ok(
				human.some((row) => row.actual.evidence.includes(flag)),
				`the corpus must keep a human-review case for ${flag}`,
			);
		}
	});

	it('rejects a corpus whose cases no longer classify as pinned', () => {
		const broken = {
			...corpus,
			cases: [
				{
					id: 'planted',
					locale: 'ja',
					before: '公開されているレポートは5件です。',
					after: '公開されているレポートは50件です。',
					expect: { meaning: 'preserved', surface: 'none', disposition: 'no-change', evidence: [] },
				},
			],
		};
		const brokenResult = evaluateCorpus(broken, { contract });
		const codes = brokenResult.findings.map((item) => item.code);
		assert.ok(codes.includes('classification-changed'));
		assert.equal(brokenResult.summary.errors > 0, true);
	});
});

describe('check-copy-meaning-diff — the examples Issue #426 names', () => {
	it('detects 未公開 → 公開 as a permission drift', () => {
		const proposal = classifyProposal({
			before: 'このレポートは未公開です。',
			after: 'このレポートは公開です。',
			locale: 'ja',
		});
		assert.equal(proposal.meaning, 'drift');
		assert.ok(proposal.evidence.includes('permission-drift'));
		assert.equal(proposal.disposition, 'review-required');
	});

	it('detects 公開 → 未公開 as a permission drift too', () => {
		const proposal = classifyProposal({
			before: 'このレポートは公開です。',
			after: 'このレポートは未公開です。',
			locale: 'ja',
		});
		assert.equal(proposal.meaning, 'drift');
		assert.ok(proposal.evidence.includes('permission-drift'));
	});

	it('lists 未公開 as its own permission marker', () => {
		// Without the compound marker the two sides carry the SAME
		// marker set (`公開` is a substring of `未公開`), the set
		// comparison finds no difference, and the widening ships.
		assert.ok(PERMISSION_MARKERS.ja.includes('未公開'));
		assert.ok(PERMISSION_MARKERS.ja.includes('公開'));
	});

	it('detects 5 → 50 as a number drift', () => {
		const proposal = classifyProposal({
			before: '公開されているレポートは5件です。',
			after: '公開されているレポートは50件です。',
			locale: 'ja',
		});
		assert.equal(proposal.meaning, 'drift');
		assert.ok(proposal.evidence.includes('number-drift'));
	});

	it('detects 可能 → 不可能 as a negation drift', () => {
		const proposal = classifyProposal({
			before: 'この操作は可能です。',
			after: 'この操作は不可能です。',
			locale: 'ja',
		});
		assert.equal(proposal.meaning, 'drift');
		assert.ok(proposal.evidence.includes('negation-drift'));
	});
});

describe('check-copy-meaning-diff — prose and typography are different questions', () => {
	it('routes a prose-only difference to a person', () => {
		const proposal = classifyProposal({
			before: 'お問い合わせはフォームからお願いします。',
			after: 'お問い合わせはフォームからお送りください。',
			locale: 'ja',
		});
		assert.equal(proposal.meaning, 'preserved');
		assert.equal(proposal.surface, 'prose');
		assert.equal(proposal.disposition, 'review-required');
	});

	it('classifies a mechanical typography difference on the surface axis', () => {
		const proposal = classifyProposal({
			before: '設定は保存されました。',
			after: '設定は保存されました ',
			locale: 'ja',
		});
		assert.equal(proposal.meaning, 'preserved');
		assert.equal(proposal.surface, 'typography');
		assert.equal(proposal.disposition, 'meaning-preserved');
		assert.ok(proposal.evidence.includes('typography:stray-whitespace'));
	});

	it('calls a rewrite with no original undetermined, not preserved', () => {
		const proposal = classifyProposal({
			before: null,
			after: 'このレポートは公開です。',
			locale: 'ja',
		});
		assert.equal(proposal.meaning, 'undetermined');
		assert.ok(proposal.evidence.includes('no-original'));
		assert.equal(proposal.disposition, 'review-required');
	});

	it('treats an identical rewrite as no change', () => {
		const proposal = classifyProposal({
			before: 'このレポートは公開です。',
			after: 'このレポートは公開です。',
			locale: 'ja',
		});
		assert.equal(proposal.meaning, 'preserved');
		assert.equal(proposal.surface, 'none');
		assert.equal(proposal.disposition, 'no-change');
	});
});

describe('check-copy-meaning-diff — nothing is applied automatically', () => {
	it('has an empty auto-apply vocabulary', () => {
		assert.deepEqual(AUTO_APPLY_DISPOSITIONS, []);
		for (const disposition of DISPOSITIONS) {
			assert.equal(AUTO_APPLY_DISPOSITIONS.includes(disposition), false);
		}
	});

	it('never marks a corpus case as auto-appliable', () => {
		for (const row of result.rows) {
			assert.equal(row.actual.autoAdopt, false, `${row.id} must not be auto-appliable`);
		}
	});

	it('exports no function that applies a proposal', () => {
		// A constant can only describe a vocabulary; an exported FUNCTION
		// named after a write path is the shape an auto-apply would take.
		for (const [name, value] of Object.entries(meaningDiff)) {
			if (typeof value !== 'function') continue;
			assert.doesNotMatch(
				name,
				/apply|adopt|commit|write|publish/i,
				`export "${name}" looks like a write path; the classifier may only classify`,
			);
		}
	});

	it('writes nothing while it classifies', () => {
		const before = [digest(join(REPO_ROOT, CORPUS_PATH)), digest(join(REPO_ROOT, CONTRACT_PATH))];
		runCli([]);
		const after = [digest(join(REPO_ROOT, CORPUS_PATH)), digest(join(REPO_ROOT, CONTRACT_PATH))];
		assert.deepEqual(after, before);
	});
});

describe('check-copy-meaning-diff — locale follows opt-in', () => {
	it('covers only the locales the contract opted into', () => {
		assert.deepEqual([...corpus.locales].sort(), [...optedInLocales(contract)].sort());
	});

	it('reports a corpus locale nobody opted into as an error', () => {
		const widened = {
			...corpus,
			locales: [...corpus.locales, 'fr'],
			cases: corpus.cases.map((testCase) => ({ ...testCase, locale: 'fr' })),
		};
		const widenedResult = evaluateCorpus(widened, { contract });
		const codes = widenedResult.findings.map((item) => item.code);
		assert.ok(codes.includes('unknown-locale'));
	});

	it('reports a known but unopted locale as an error', () => {
		const contractWithKnownLocale = {
			...contract,
			knownLocales: [...contract.knownLocales, 'fr'],
		};
		const widened = {
			...corpus,
			locales: [...corpus.locales, 'fr'],
			cases: corpus.cases.map((testCase) => ({ ...testCase, locale: 'fr' })),
		};
		const widenedResult = evaluateCorpus(widened, { contract: contractWithKnownLocale });
		const codes = widenedResult.findings.map((item) => item.code);
		assert.ok(codes.includes('locale-not-opted-in'));
	});

	it('reports a known locale without a corpus as information, not a gap', () => {
		const contractWithKnownLocale = {
			...contract,
			knownLocales: [...contract.knownLocales, 'fr'],
		};
		const widenedResult = evaluateCorpus(corpus, { contract: contractWithKnownLocale });
		const item = widenedResult.findings.find((entry) => entry.code === 'locale-without-corpus');
		assert.ok(item);
		assert.equal(item.severity, 'info');
	});

	it('calls a locale with no marker list unjudged rather than clean', () => {
		assert.equal(isJudgedLocale('ja'), true);
		assert.equal(isJudgedLocale('fr'), false);
		const proposal = classifyProposal({
			before: 'Ce rapport est public.',
			after: 'Ce rapport est privé.',
			locale: 'fr',
		});
		assert.equal(proposal.meaning, 'undetermined');
		assert.ok(proposal.evidence.includes('unjudged-locale'));
		assert.equal(proposal.disposition, 'review-required');
	});
});

describe('check-copy-meaning-diff — the report shapes', () => {
	it('keeps the three axes and the disposition vocabulary closed', () => {
		assert.deepEqual(MEANING_STATES, ['preserved', 'drift', 'undetermined']);
		assert.deepEqual(SURFACE_CLASSES, ['none', 'typography', 'prose']);
		assert.deepEqual(DISPOSITIONS, ['review-required', 'meaning-preserved', 'no-change']);
	});

	it('renders text, json and html without throwing', () => {
		assert.ok(renderText(result).includes('permission-widened'));
		assert.ok(JSON.parse(renderJson(result)).summary.total === corpus.cases.length);
		assert.ok(renderHtml(result).includes('Meaning-diff corpus'));
	});

	it('exits 0 against the committed corpus', () => {
		const run = runCli([]);
		assert.equal(run.status, 0, run.stderr);
	});
});
