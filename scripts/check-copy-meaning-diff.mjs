#!/usr/bin/env node
/**
 * Meaning-diff classifier and corpus gate (Issue #426).
 *
 * What this owns
 * --------------
 * The question "did this rewrite change what the sentence tells the
 * reader?". The answer is two independent axes plus one disposition:
 *
 *   meaning  — did a CLAIM change? A claim is a number, a negation or
 *              a permission / authority marker. `preserved` (no claim
 *              changed), `drift` (a claim changed) or `undetermined`
 *              (there is no original to compare against, or the locale
 *              has no marker list to judge it with).
 *   surface  — what KIND of textual difference is it? `typography` (a
 *              mechanical script rule separates the two sides),
 *              `prose` (the wording differs and no mechanical rule
 *              explains it) or `none` (the sides are identical, or
 *              there is no pair to compare).
 *   disposition — what must happen to the proposal. `review-required`
 *              (a person decides), `meaning-preserved` (the meaning
 *              axis is clean and the difference is mechanical) or
 *              `no-change` (the proposal is identical to the original).
 *
 * Why the disposition vocabulary has no auto-apply member
 * -------------------------------------------------------
 * Issue #426 requires that an AI proposal is never adopted
 * automatically. That rule is expressed as a TYPE, not as a
 * convention: `AUTO_APPLY_DISPOSITIONS` is the list of dispositions
 * that may be applied without a human decision, and it is empty. A
 * proposal can only become auto-applied by adding a member to that
 * list, which is a visible, reviewable change to a closed vocabulary —
 * not by a caller deciding to be helpful. `autoAdopt` is derived from
 * the list, so it is false for every input, including inputs nobody
 * thought about.
 *
 * Why the axes are separate
 * -------------------------
 * "The prose got worse" and "the meaning changed" are different
 * questions, and the difference between them is the point of this
 * ticket. A trailing space is a typography matter the script rules
 * decide; politeness, register and sentence length are prose matters
 * no rule can decide; a changed digit is a meaning matter, because the
 * number a reader is given is a fact about the platform. The Issue #428
 * gate already refuses to decide prose (`prose` is a human claim
 * there), and this module keeps that refusal instead of inventing a
 * prose score.
 *
 * The corpus
 * ----------
 * `test/fixtures/copy/meaning-diff/corpus.json` is the regression set:
 * one example sentence per class, each with the classification it must
 * produce. The corpus is a FIXTURE, not shipped copy — every sentence
 * in it is synthetic, and no case authorises its own rewrite. The
 * corpus also keeps the cases that need a person (`review-required`),
 * because a corpus that only held decidable cases would prove nothing
 * about the proposals that matter.
 *
 * Locale opt-in
 * -------------
 * The corpus is evaluated per locale, and a locale is only evaluated
 * when the copy contract (`copy/resources.json`) knows it AND at least
 * one feature opted into it. A corpus case for a locale nobody opted
 * into is an error — the corpus would be claiming coverage the
 * platform does not ship. A locale the contract knows but the corpus
 * does not cover is an `info`, not a gap: the corpus follows locale
 * opt-in, it does not require it.
 *
 * Reuse, not re-implementation
 * -----------------------------
 * The marker lists and the typography rules come from
 * `scripts/check-copy-i18n.mjs` (the Issue #428 gate) and the claim
 * comparison comes from `scripts/collect-japanese-copy-review.mjs`
 * (the Issue #425 collector). A second implementation of "is this a
 * typography difference" would be a second answer to the same
 * question, and the two answers would drift apart.
 *
 *   node scripts/check-copy-meaning-diff.mjs
 *   node scripts/check-copy-meaning-diff.mjs --format=json
 *   node scripts/check-copy-meaning-diff.mjs --format=html --out=.tmp/x.html
 *
 * Exit codes: 0 = no error finding, 1 = at least one error finding,
 * 2 = bad input.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	NEGATION_MARKERS,
	PERMISSION_MARKERS,
	SEVERITIES,
	typographyFindings,
} from './check-copy-i18n.mjs';
import { DRIFT_FLAGS, analyzeUnit } from './collect-japanese-copy-review.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Repo-relative path of the corpus fixture. */
export const CORPUS_PATH = 'test/fixtures/copy/meaning-diff/corpus.json';

/** Repo-relative path of the copy contract (the locale opt-in source). */
export const CONTRACT_PATH = 'copy/resources.json';

/** Corpus schema this gate understands. */
export const SUPPORTED_SCHEMA_VERSION = 1;

/** The meaning axis. */
export const MEANING_STATES = ['preserved', 'drift', 'undetermined'];

/** The surface axis — prose quality vs typography, stated explicitly. */
export const SURFACE_CLASSES = ['none', 'typography', 'prose'];

/** What must happen to a proposal. */
export const DISPOSITIONS = ['review-required', 'meaning-preserved', 'no-change'];

/**
 * Dispositions that may be applied without a human decision.
 *
 * Empty by construction. Issue #426 forbids adopting an AI proposal
 * automatically, and this list is where that rule lives: it is the
 * only way `autoAdopt` can ever become true, so the rule cannot be
 * weakened by a caller, by a heuristic change, or by a case nobody
 * thought about.
 */
export const AUTO_APPLY_DISPOSITIONS = [];

/** Evidence codes that are not one of the drift flags. */
export const UNDETERMINED_EVIDENCE = ['no-original', 'unjudged-locale'];

/** The drift flags the meaning axis can report, in report order. */
export const DRIFT_ORDER = ['number-drift', 'negation-drift', 'permission-drift'];

/**
 * Is this locale one the marker lists can judge?
 *
 * A locale with no marker list is unjudged rather than clean: the
 * classifier must not report "meaning preserved" for a locale whose
 * claims it cannot see.
 */
export function isJudgedLocale(locale) {
	return Boolean(NEGATION_MARKERS[locale] && PERMISSION_MARKERS[locale]);
}

/** The error codes the typography rules reported for one text. */
function typographyCodes(text, locale) {
	if (text === null || text === undefined) return [];
	return typographyFindings(text, locale, {})
		.filter((item) => item.severity === 'error')
		.map((item) => item.code);
}

/** Codes present on one side but not the other. */
function symmetricDifference(before, after) {
	return [...new Set([...before, ...after])]
		.filter((code) => before.includes(code) !== after.includes(code))
		.sort();
}

/**
 * Classify one proposal pair.
 *
 * `before` is the sentence as written, `after` the proposed rewrite.
 * `before: null` means there is no original to compare against.
 */
export function classifyProposal({ before, after, locale = 'ja' }) {
	const unjudged = !isJudgedLocale(locale);
	const paired = before !== null && before !== undefined && before !== after;
	const evidence = [];
	let meaning;

	if (unjudged) {
		// Fail closed: an unjudgeable locale is not a clean locale.
		meaning = 'undetermined';
		evidence.push('unjudged-locale');
	} else if (before === null || before === undefined) {
		meaning = 'undetermined';
		evidence.push('no-original');
	} else {
		const analysis = analyzeUnit(
			{ before, after, kind: paired ? 'modified' : 'removed' },
			locale,
		);
		const drift = DRIFT_ORDER.filter((flag) => analysis.risk.includes(flag));
		meaning = drift.length > 0 ? 'drift' : 'preserved';
		evidence.push(...drift);
	}

	const beforeCodes = typographyCodes(before, locale);
	const afterCodes = typographyCodes(after, locale);
	const typographyDelta = symmetricDifference(beforeCodes, afterCodes);
	evidence.push(...typographyDelta.map((code) => `typography:${code}`));

	let surface;
	if (typographyDelta.length > 0) {
		surface = 'typography';
	} else if (before === null || before === undefined || before === after) {
		surface = 'none';
	} else {
		surface = 'prose';
	}

	let disposition;
	if (meaning !== 'preserved' || surface === 'prose') {
		disposition = 'review-required';
	} else if (surface === 'typography') {
		disposition = 'meaning-preserved';
	} else {
		disposition = 'no-change';
	}

	return {
		locale,
		before,
		after,
		meaning,
		surface,
		disposition,
		evidence,
		autoAdopt: AUTO_APPLY_DISPOSITIONS.includes(disposition),
	};
}

/** Read and parse the corpus fixture. Throws a caller-readable Error. */
export function loadCorpus(corpusPath = CORPUS_PATH) {
	const absolute = resolve(REPO_ROOT, corpusPath);
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(absolute, 'utf8'));
	} catch (error) {
		throw new Error(`cannot read corpus ${corpusPath}: ${error.message}`);
	}
	if (parsed.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
		throw new Error(
			`corpus ${corpusPath}: schemaVersion ${parsed.schemaVersion} is not supported (expected ${SUPPORTED_SCHEMA_VERSION})`,
		);
	}
	return parsed;
}

/** Read and parse the copy contract. Throws a caller-readable Error. */
export function loadContract(contractPath = CONTRACT_PATH) {
	const absolute = resolve(REPO_ROOT, contractPath);
	try {
		return JSON.parse(readFileSync(absolute, 'utf8'));
	} catch (error) {
		throw new Error(`cannot read contract ${contractPath}: ${error.message}`);
	}
}

/** Every locale at least one feature opted into. */
export function optedInLocales(contract) {
	const locales = new Set();
	for (const feature of contract.features ?? []) {
		for (const locale of Object.keys(feature.locales ?? {})) {
			locales.add(locale);
		}
	}
	return [...locales].sort();
}

function finding({ code, severity, message, id = null, detail = null }) {
	return { code, severity, message, id, detail };
}

/**
 * Evaluate the corpus.
 *
 * The result carries one row per case with the classification the
 * classifier produced and the classification the case demands, plus the
 * findings a reader must see: a case whose classification moved is an
 * error, and the locale opt-in state is reported per locale.
 */
export function evaluateCorpus(corpus, { contract = null } = {}) {
	const findings = [];
	const rows = [];
	const seen = new Set();

	for (const testCase of corpus.cases ?? []) {
		if (!testCase.id) {
			findings.push(
				finding({
					code: 'case-without-id',
					severity: 'error',
					message: 'A corpus case has no id; every case must be addressable.',
				}),
			);
			continue;
		}
		if (seen.has(testCase.id)) {
			findings.push(
				finding({
					code: 'duplicate-case-id',
					severity: 'error',
					message: `Corpus case "${testCase.id}" appears more than once.`,
					id: testCase.id,
				}),
			);
			continue;
		}
		seen.add(testCase.id);

		const actual = classifyProposal({
			before: testCase.before ?? null,
			after: testCase.after ?? null,
			locale: testCase.locale,
		});
		const expected = testCase.expect ?? {};
		const mismatches = [];
		for (const key of ['meaning', 'surface', 'disposition']) {
			if (expected[key] !== actual[key]) {
				mismatches.push(`${key}: expected "${expected[key]}", got "${actual[key]}"`);
			}
		}
		const expectedEvidence = [...(expected.evidence ?? [])].sort();
		const actualEvidence = [...actual.evidence].sort();
		if (expectedEvidence.join(' ') !== actualEvidence.join(' ')) {
			mismatches.push(
				`evidence: expected [${expectedEvidence.join(', ')}], got [${actualEvidence.join(', ')}]`,
			);
		}
		if (mismatches.length > 0) {
			findings.push(
				finding({
					code: 'classification-changed',
					severity: 'error',
					message: `Corpus case "${testCase.id}" no longer classifies as the corpus pins it — ${mismatches.join('; ')}.`,
					id: testCase.id,
					detail: mismatches.join('; '),
				}),
			);
		}
		if (actual.autoAdopt) {
			findings.push(
				finding({
					code: 'auto-apply-disposition',
					severity: 'error',
					message: `Corpus case "${testCase.id}" classified as auto-appliable. Issue #426 forbids adopting a proposal automatically.`,
					id: testCase.id,
				}),
			);
		}
		rows.push({ id: testCase.id, locale: testCase.locale, before: testCase.before ?? null, after: testCase.after ?? null, expected, actual, ok: mismatches.length === 0 });
	}

	// The cases that need a person must stay in the corpus: a corpus
	// holding only decidable cases would prove nothing about the
	// proposals that matter.
	const humanCases = rows.filter((row) => row.actual.disposition === 'review-required');
	for (const flag of DRIFT_FLAGS) {
		const covered = humanCases.some((row) => row.actual.evidence.includes(flag));
		if (!covered) {
			findings.push(
				finding({
					code: 'drift-axis-has-no-human-case',
					severity: 'error',
					message: `No corpus case reports "${flag}" as a case a person must review. The corpus must keep the cases that need human approval.`,
					detail: flag,
				}),
			);
		}
	}

	// Locale opt-in. The corpus follows the contract, it does not widen it.
	const corpusLocales = corpus.locales ?? [];
	const knownLocales = contract?.knownLocales ?? [];
	const optedIn = optedInLocales(contract ?? { features: [] });
	for (const locale of corpusLocales) {
		if (!knownLocales.includes(locale)) {
			findings.push(
				finding({
					code: 'unknown-locale',
					severity: 'error',
					message: `Corpus locale "${locale}" is not in ${CONTRACT_PATH}#knownLocales.`,
					detail: locale,
				}),
			);
			continue;
		}
		if (!optedIn.includes(locale)) {
			findings.push(
				finding({
					code: 'locale-not-opted-in',
					severity: 'error',
					message: `Corpus locale "${locale}" is known but no feature opted into it. A corpus case for a locale the platform does not ship would claim coverage that does not exist.`,
					detail: locale,
				}),
			);
		}
	}
	for (const locale of knownLocales) {
		if (!corpusLocales.includes(locale)) {
			findings.push(
				finding({
					code: 'locale-without-corpus',
					severity: 'info',
					message: `Locale "${locale}" is known to the copy contract but the corpus does not cover it. Corpus coverage follows locale opt-in; a locale nobody ships does not need a corpus.`,
					detail: locale,
				}),
			);
		}
	}
	for (const row of rows) {
		if (row.locale && !corpusLocales.includes(row.locale)) {
			findings.push(
				finding({
					code: 'case-locale-not-declared',
					severity: 'error',
					message: `Corpus case "${row.id}" uses locale "${row.locale}", which the corpus does not declare.`,
					id: row.id,
				}),
			);
		}
	}

	const errors = findings.filter((item) => item.severity === 'error').length;
	return {
		rows,
		findings,
		summary: {
			total: rows.length,
			passed: rows.filter((row) => row.ok).length,
			failed: rows.filter((row) => !row.ok).length,
			reviewRequired: humanCases.length,
			errors,
			infos: findings.length - errors,
			locales: corpusLocales,
		},
	};
}

function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** A sentence rendered as a side-by-side pair. */
function pairHtml(before, after) {
	return `<div class="pair">
		<div class="side"><span class="tag">before</span><p>${escapeHtml(before ?? '— (no original) —')}</p></div>
		<div class="side"><span class="tag">after</span><p>${escapeHtml(after ?? '— (removed) —')}</p></div>
	</div>`;
}

export function renderText(result) {
	const lines = [];
	lines.push(`meaning-diff corpus — ${result.summary.total} case(s)`);
	lines.push(
		`  ${result.summary.passed} classified as pinned, ${result.summary.failed} drifted from the corpus, ${result.summary.reviewRequired} need a person`,
	);
	for (const row of result.rows) {
		lines.push('');
		lines.push(`${row.ok ? 'ok  ' : 'FAIL'} ${row.id} [${row.locale}]`);
		lines.push(`  before: ${row.before ?? '(no original)'}`);
		lines.push(`  after:  ${row.after ?? '(removed)'}`);
		lines.push(
			`  meaning=${row.actual.meaning} surface=${row.actual.surface} disposition=${row.actual.disposition} autoAdopt=${row.actual.autoAdopt}`,
		);
		lines.push(`  evidence: ${row.actual.evidence.join(', ') || '(none)'}`);
	}
	if (result.findings.length > 0) {
		lines.push('');
		lines.push('findings');
		for (const item of result.findings) {
			lines.push(`  [${item.severity}] ${item.code}: ${item.message}`);
		}
	}
	return `${lines.join('\n')}\n`;
}

export function renderJson(result) {
	return `${JSON.stringify(result, null, 1)}\n`;
}

export function renderHtml(result) {
	const rows = result.rows
		.map(
			(row) => `<tr class="${row.ok ? 'ok' : 'bad'}">
			<td><code>${escapeHtml(row.id)}</code></td>
			<td>${pairHtml(row.before, row.after)}</td>
			<td><span class="badge meaning-${escapeHtml(row.actual.meaning)}">${escapeHtml(row.actual.meaning)}</span></td>
			<td><span class="badge surface-${escapeHtml(row.actual.surface)}">${escapeHtml(row.actual.surface)}</span></td>
			<td><span class="badge disposition-${escapeHtml(row.actual.disposition)}">${escapeHtml(row.actual.disposition)}</span></td>
			<td class="evidence">${escapeHtml(row.actual.evidence.join(', ') || '—')}</td>
		</tr>`,
		)
		.join('\n');

	const findings = result.findings.length
		? `<table class="findings">
			<thead><tr><th>severity</th><th>code</th><th>message</th></tr></thead>
			<tbody>${result.findings
				.map(
					(item) => `<tr class="sev-${escapeHtml(item.severity)}">
					<td><span class="badge ${escapeHtml(item.severity)}">${escapeHtml(item.severity)}</span></td>
					<td><code>${escapeHtml(item.code)}</code></td>
					<td>${escapeHtml(item.message)}</td>
				</tr>`,
				)
				.join('\n')}</tbody>
		</table>`
		: '<p class="empty">No findings: every case classifies as the corpus pins it, and the locale opt-in state matches the copy contract.</p>';

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Meaning-diff corpus — Issue #426</title>
<style>
	:root { color-scheme: light; }
	* { box-sizing: border-box; }
	body {
		margin: 0; padding: 48px 56px 64px;
		background: #f6f4ef; color: #16150f;
		font: 15px/1.6 ui-sans-serif, system-ui, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
	}
	h1 { font-size: 30px; line-height: 1.2; margin: 0 0 8px; letter-spacing: -0.01em; }
	h2 { font-size: 19px; margin: 0 0 10px; }
	code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
	.lede { max-width: 82ch; margin: 0 0 28px; color: #4a473c; }
	.summary { display: flex; gap: 10px; flex-wrap: wrap; margin: 0 0 22px; }
	.summary span { border-radius: 999px; padding: 4px 13px; font-size: 13px; border: 1px solid transparent; }
	.summary .n { background: #efede6; border-color: #d9d4c7; color: #4a473c; }
	.summary .bad { background: #fbe6e1; border-color: #e8b4a6; color: #8c2f18; }
	.summary .good { background: #eef3e8; border-color: #b7c9a4; color: #3c5a2c; }
	.summary .info { background: #e9eef5; border-color: #b9c8da; color: #2b4763; }
	section { background: #fffdf8; border: 1px solid #e2ddd1; border-radius: 10px; padding: 24px 28px; margin-bottom: 24px; }
	table { width: 100%; border-collapse: collapse; font-size: 14px; }
	th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid #ece7db; vertical-align: top; }
	th { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: #6b6759; }
	td.evidence { white-space: nowrap; color: #6b6759; font-size: 13px; }
	tr.bad td:first-child { box-shadow: inset 3px 0 0 #c2482a; }
	.badge { display: inline-block; border-radius: 999px; padding: 2px 10px; font-size: 12px; border: 1px solid transparent; white-space: nowrap; }
	.meaning-drift { background: #fbe6e1; border-color: #e8b4a6; color: #8c2f18; }
	.meaning-preserved { background: #eef3e8; border-color: #b7c9a4; color: #3c5a2c; }
	.meaning-undetermined { background: #fdf3dc; border-color: #e4ce9a; color: #6d5312; }
	.surface-typography { background: #e9eef5; border-color: #b9c8da; color: #2b4763; }
	.surface-prose { background: #f3eef7; border-color: #cdb8db; color: #4d2b63; }
	.surface-none { background: #efede6; border-color: #d9d4c7; color: #6b6759; }
	.disposition-review-required { background: #fbe6e1; border-color: #e8b4a6; color: #8c2f18; }
	.disposition-meaning-preserved { background: #eef3e8; border-color: #b7c9a4; color: #3c5a2c; }
	.disposition-no-change { background: #efede6; border-color: #d9d4c7; color: #6b6759; }
	.badge.error { background: #fbe6e1; border-color: #e8b4a6; color: #8c2f18; }
	.badge.info { background: #e9eef5; border-color: #b9c8da; color: #2b4763; }
	.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
	.pair .side { background: #fbf8f1; border: 1px solid #ece7db; border-radius: 7px; padding: 8px 10px; }
	.pair p { margin: 4px 0 0; }
	.pair .tag { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #8d8877; }
	.empty { margin: 0; color: #4a473c; }
	.legend dl { margin: 0; display: grid; grid-template-columns: 240px 1fr; gap: 8px 20px; }
	.legend dt { font-weight: 600; }
	.legend dd { margin: 0; }
</style>
</head>
<body>
<h1>Meaning-diff corpus — Issue #426</h1>
<p class="lede">
	Every example sentence a rewriting tool proposed, with the classification the
	classifier gives it. The corpus is a regression set, not shipped copy: the
	sentences are synthetic and no case authorises its own rewrite.
	<b>Auto-apply is not a disposition</b> — the vocabulary that could authorise an
	adoption is empty, so no case can be applied without a person deciding.
</p>
<p class="summary">
	<span class="n">${result.summary.total} cases</span>
	<span class="${result.summary.failed === 0 ? 'good' : 'bad'}">${result.summary.passed} classified as pinned</span>
	<span class="${result.summary.failed === 0 ? 'good' : 'bad'}">${result.summary.failed} drifted from the corpus</span>
	<span class="info">${result.summary.reviewRequired} need a person</span>
	<span class="n">locales: ${escapeHtml(result.summary.locales.join(', ') || '—')}</span>
</p>
<section>
	<h2>The corpus</h2>
	<table>
		<thead><tr><th>case</th><th>proposal</th><th>meaning</th><th>surface</th><th>disposition</th><th>evidence</th></tr></thead>
		<tbody>${rows}</tbody>
	</table>
</section>
<section>
	<h2>Findings</h2>
	${findings}
</section>
<div class="legend section">
	<h2>How to read this report</h2>
	<dl>
		<dt>meaning</dt><dd>whether a CLAIM changed — a number, a negation, or a permission marker. <code>preserved</code>, <code>drift</code>, or <code>undetermined</code> when there is no original to compare against.</dd>
		<dt>surface</dt><dd>what KIND of difference it is. <code>typography</code> is a mechanical script rule the machine decides; <code>prose</code> is register, politeness and wording, which no rule decides and which therefore stays with a person.</dd>
		<dt>disposition</dt><dd>what must happen to the proposal. <code>review-required</code> (a person decides), <code>meaning-preserved</code> (the meaning axis is clean and the difference is mechanical), <code>no-change</code> (the proposal is identical to the original).</dd>
		<dt>auto-apply</dt><dd>not a disposition. The list of dispositions that may be applied without a human decision is empty, so no proposal is ever adopted automatically.</dd>
	</dl>
</div>
</body>
</html>
`;
}

function parseArgs(argv) {
	const options = {
		corpus: CORPUS_PATH,
		contract: CONTRACT_PATH,
		format: 'text',
		out: null,
	};
	for (const arg of argv) {
		if (arg.startsWith('--corpus=')) options.corpus = arg.slice('--corpus='.length);
		else if (arg.startsWith('--contract=')) options.contract = arg.slice('--contract='.length);
		else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length);
		else if (arg.startsWith('--format=')) options.format = arg.slice('--format='.length);
		else throw new Error(`unknown option: ${arg}`);
	}
	return options;
}

function main(argv) {
	let options;
	try {
		options = parseArgs(argv);
	} catch (error) {
		process.stderr.write(`[check-copy-meaning-diff] ${error.message}\n`);
		return 2;
	}
	if (!['text', 'json', 'html'].includes(options.format)) {
		process.stderr.write(`[check-copy-meaning-diff] unknown --format: ${options.format}\n`);
		return 2;
	}

	let corpus;
	let contract;
	try {
		corpus = loadCorpus(options.corpus);
		contract = loadContract(options.contract);
	} catch (error) {
		process.stderr.write(`[check-copy-meaning-diff] ${error.message}\n`);
		return 2;
	}

	const result = evaluateCorpus(corpus, { contract });
	const rendered =
		options.format === 'json'
			? renderJson(result)
			: options.format === 'html'
				? renderHtml(result)
				: renderText(result);

	if (options.out) {
		const absolute = resolve(REPO_ROOT, options.out);
		mkdirSync(dirname(absolute), { recursive: true });
		writeFileSync(absolute, rendered);
	} else {
		process.stdout.write(rendered);
	}
	return result.summary.errors > 0 ? 1 : 0;
}

export { SEVERITIES };

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exit(main(process.argv.slice(2)));
}
