#!/usr/bin/env node

/**
 * Public Japanese copy — editorial approval gate (Issue #506).
 *
 * What this gate is
 * -----------------
 * A pull request that changes the **Japanese text a visitor reads** is
 * an editorial change, and an editorial change is a human decision.
 * Nothing in this repository could prove that the person who wrote the
 * new sentence meant what it says, so this gate does not try. What it
 * does is make the *absence* of that decision visible:
 *
 *   1. It extracts **only** the Japanese text the pull request changed
 *      in a public copy surface (the diff's added / removed Japanese
 *      segments, nothing else in the file).
 *   2. It looks for an **owner approval record** in
 *      `quality/copy-editorial-approvals.json` that covers exactly
 *      that change set (bound by a fingerprint of the changed text).
 *   3. It resolves the record into three review dimensions and keeps
 *      their outcomes apart:
 *
 *        - `proposal` — the editing aid (yomiyasu or a comparable tool)
 *          was run over the changed text and its suggestions were
 *          adjudicated. A tool run is **evidence**, never approval.
 *        - `semantic` — the original text and the final text were
 *          compared, meaning-wise, and the comparison is written down
 *          per changed segment.
 *        - `approval` — the owner decided (`approved` / `rejected`),
 *          and the decision names its reviewer and its date **and**
 *          its provenance (Issue #720 — see below).
 *
 * The four verdicts are kept distinct on purpose, exactly like the
 * release-gate ledger they sit next to:
 *
 *   - `pass`            — the changed public Japanese text is covered by
 *                         a complete owner approval record.
 *   - `fail`            — a review was recorded and it says no, or the
 *                         record contradicts the change set.
 *   - `not run`         — the review was never recorded, **or** the
 *                         record that exists was written by an
 *                         automated side and no owner has confirmed it
 *                         (this is the NEEDS REVIEW state: the pull
 *                         request asks for an owner decision nobody has
 *                         taken yet).
 *   - `not applicable`  — the pull request changed no public Japanese
 *                         copy at all.
 *
 * `not run` and `fail` both stop the merge; they are different
 * sentences, and the report says which one it is.
 *
 * Owner approval means a traceable owner artefact (Issue #720)
 * ---------------------------------------------------------------
 * "Approved" is a claim about a human judgement, so the gate asks a
 * second question: **what traceable artefact says the owner decided?**
 * An approval record therefore carries a `provenance` block:
 *
 * ```jsonc
 * "provenance": {
 *   "kind": "owner-review" | "agent-recorded" | "unverified",
 *   "reference": "<a GitHub review / issue comment URL, or null>",
 *   "recordedBy": "<who wrote this record: 'agent' | a handle>",
 *   "ownerConfirmation": "confirmed" | "unconfirmed"
 * }
 * ```
 *
 * Only `kind: "owner-review"` + a `reference` + `ownerConfirmation:
 * "confirmed"` counts as an owner approval. A record an automated side
 * wrote is `kind: "agent-recorded"` / `ownerConfirmation:
 * "unconfirmed"`: it is **evidence that a review was prepared**, and
 * the gate reports it as *awaiting owner confirmation* with the rule
 * id `approval-owner-confirmation-missing` — never as approval. A
 * record with no `provenance` at all is rejected with
 * `approval-provenance-missing`.
 *
 * The editing aid (yomiyasu or a comparable tool) is evidence in the
 * same sense, and for the same reason: its output never approves
 * anything on its own.
 *
 * **The limit of what can be proven mechanically.** The gate checks the
 * *shape* of a reference — that a string is present and looks like a
 * reference — not who wrote the thing it points at. A reference is a
 * claim about a human action: the repository records the claim and
 * cannot independently prove it. The audit of the shipped records is
 * in
 * `docs/verification/governance/approval-provenance.md`.
 *
 * What this gate is not
 * ---------------------
 * It is not a Japanese proofreading tool and it does not judge prose.
 * It cannot tell whether a sentence is polite, clear or correct — the
 * editing aid referenced by the Issue may propose a rewording, but a
 * proposal is not proof (see `docs/domain/i18n.md` and
 * `docs/portfolio/decisions.md`, which already say so). The gate's only
 * claim is about **evidence**: a change of public Japanese copy carries
 * a recorded owner decision, or the change is reported as un-reviewed.
 *
 * It is also not a page-consolidation project and it does not require
 * every locale to be complete. The public copy surfaces are an explicit,
 * opt-in list (`quality/copy-editorial-surfaces.json`), and the copy
 * contract's per-capability locale opt-in
 * (`copy/resources.json`) is untouched by this gate.
 *
 * The editing aid and the provenance block are two faces of one rule:
 * **an automated side may prepare a review; only the owner may
 * approve it.** The gate never mistakes the first for the second.
 *
 * The change set is the pull request's OWN change set
 * ----------------------------------------------------
 * The gate diffs the **merge base** of the base ref and the head ref
 * (`git diff base...head`), never the two refs directly. A base branch
 * that moved on publishes its own text, and a two-dot diff reports that
 * text as if the pull request had changed it: the fingerprint of the
 * change set then differs between a local run and the CI run, the
 * owner cannot record an approval that CI accepts, and the report
 * describes files the pull request never touched.
 *
 * When the history is too shallow to compute a merge base — the
 * depth-1 clone `actions/checkout` makes — the head is the merge
 * commit GitHub builds for the pull request, and diffing it against
 * its first parent is the same change set: what the pull request
 * publishes on top of the base it was merged into. When neither can be
 * established, the gate does not guess: it exits 2 rather than judge a
 * change set it cannot see.
 *
 * Offline, read-only, no secret: the gate reads the git diff of two
 * refs plus two JSON files. It never writes to the tree, never contacts
 * a network, and never reads a credential.
 *
 * Usage:
 *   node scripts/check-copy-editorial-approval.mjs --base=release-0-7-0
 *   node scripts/check-copy-editorial-approval.mjs --base=release-0-7-0 \
 *     --format=html --out=.tmp/copy-editorial-approval.html
 *   node scripts/check-copy-editorial-approval.mjs --base=release-0-7-0 \
 *     --print-fingerprint
 *
 * Options:
 *   --base=<ref>      Base ref to diff against. Defaults to
 *                      `COPY_APPROVAL_BASE`, then to `GITHUB_BASE_REF`
 *                      (read as `origin/<ref>`). Without a base the
 *                      gate cannot know what changed and exits 2.
 *   --head=<ref>      Head ref to diff (default `HEAD`).
 *   --pr=<number>     Pull request number, used to report a stale
 *                      approval for the same pull request.
 *   --ledger=<path>   Approval ledger (default
 *                      `quality/copy-editorial-approvals.json`).
 *   --surfaces=<path> Public copy surface declaration (default
 *                      `quality/copy-editorial-surfaces.json`).
 *   --format=text|json|html   Output format (default `text`).
 *   --out=<path>      Write to a file instead of stdout.
 *   --print-fingerprint  Print the change set fingerprint and exit.
 *
 * Exit codes: 0 = pass / not applicable, 1 = fail / not run (NEEDS
 * REVIEW), 2 = bad input (no base ref, unreadable declaration).
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
	JAPANESE_PATTERN,
	REPO_ROOT,
	buildChangeSet,
	classifyFile,
	commitParents,
	commitSha,
	describeDiffBase,
	extractSegments,
	gitDiff,
	globToRegExp,
	hasJapanese,
	isCommentLine,
	matchesGlob,
	mergeBaseOf,
	pairEditSegments,
	parseDiff,
	readJson,
	refExists,
	resolveBaseRef,
	resolveDiffBase,
	stringLiterals,
} from './_copy-japanese-diff.mjs';

/**
 * The Japanese-segment extraction and git change-set helpers are shared
 * with the Issue #425 review-target collector
 * (`scripts/collect-japanese-copy-review.mjs`). They live in
 * `scripts/_copy-japanese-diff.mjs` so the approval gate and the
 * collector cannot drift on what "the Japanese text this pull request
 * changed" means. The names are re-exported here because this module is
 * the approval gate's public surface, and its tests import them from
 * here.
 */
export {
	JAPANESE_PATTERN,
	REPO_ROOT,
	buildChangeSet,
	classifyFile,
	commitParents,
	commitSha,
	describeDiffBase,
	extractSegments,
	gitDiff,
	globToRegExp,
	hasJapanese,
	isCommentLine,
	matchesGlob,
	mergeBaseOf,
	pairEditSegments,
	parseDiff,
	readJson,
	refExists,
	resolveBaseRef,
	resolveDiffBase,
	stringLiterals,
};

/** Public copy surface declaration (which files hold visitor-facing copy). */
export const SURFACES_PATH = 'quality/copy-editorial-surfaces.json';

/** Owner approval ledger (the review evidence). */
export const LEDGER_PATH = 'quality/copy-editorial-approvals.json';

/** The committed fixtures (the gate's own test corpus). */
export const FIXTURE_DIR = 'test/fixtures/copy/editorial-approval';

/** The four verdicts, in report order. */
export const VERDICTS = ['pass', 'fail', 'not run', 'not applicable'];

/** The three review dimensions the Issue names. */
export const DIMENSIONS = ['proposal', 'semantic', 'approval'];

/** Decisions an owner may record. */
export const DECISIONS = ['approved', 'rejected'];

/**
 * The provenance kinds an approval record may carry (Issue #720).
 *
 * `owner-review`   — a traceable owner artefact exists (a GitHub review
 *                    or an issue comment by the owner).
 * `agent-recorded` — the record was written by an automated side; it is
 *                    evidence that a review was *prepared*, never that
 *                    the owner *approved* it.
 * `unverified`     — the record carries no usable provenance at all.
 */
export const PROVENANCE_KINDS = ['owner-review', 'agent-recorded', 'unverified'];

/** The two owner-confirmation states. */
export const OWNER_CONFIRMATIONS = ['confirmed', 'unconfirmed'];

/** Verdicts a per-segment semantic comparison may carry. */
export const COMPARISON_VERDICTS = ['equivalent', 'intentional'];

/**
 * The fingerprint of a change set.
 *
 * It binds an approval to the **final text** of every changed segment,
 * not to the diff context: a base branch that moved on changes the
 * "before" side of the diff without changing what the pull request
 * publishes, and an approval of the published text must survive that.
 * The "before" side is still recorded in the approval record — it is
 * what the owner compared against — but it is not part of the binding.
 */
export function fingerprintUnits(units) {
	const lines = units
		.map((unit) => `${unit.path}\t${unit.kind}\t${unit.after ?? unit.before ?? ''}`)
		.sort();
	const digest = createHash('sha256').update(lines.join('\n')).digest('hex');
	return `sha256:${digest}`;
}

function finding(code, severity, message) {
	return { code, severity, message };
}

/**
 * The provenance of one approval record (Issue #720).
 *
 * "Approved" is a claim about a human decision. This function decides
 * one thing only: does the record carry a **traceable owner artefact**?
 *
 * It does NOT decide who wrote the artefact the reference points at.
 * A reference is a claim about a human action; the repository records
 * the claim and cannot prove it (see
 * `docs/verification/governance/approval-provenance.md`).
 */
export function evaluateProvenance(record) {
	const provenance = record?.provenance ?? null;
	if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
		return {
			present: false,
			kind: 'unverified',
			reference: null,
			recordedBy: null,
			ownerConfirmation: 'unconfirmed',
			ownerConfirmed: false,
			reason: 'missing',
		};
	}
	const kind = typeof provenance.kind === 'string' ? provenance.kind.trim() : '';
	const reference = typeof provenance.reference === 'string' ? provenance.reference.trim() : '';
	const recordedBy = typeof provenance.recordedBy === 'string' ? provenance.recordedBy.trim() : '';
	const ownerConfirmation =
		typeof provenance.ownerConfirmation === 'string' ? provenance.ownerConfirmation.trim() : '';
	let reason = null;
	if (kind !== 'owner-review') {
		reason = 'not-an-owner-review';
	} else if (reference.length === 0) {
		reason = 'no-reference';
	} else if (ownerConfirmation !== 'confirmed') {
		reason = 'not-confirmed';
	}
	return {
		present: true,
		kind: kind.length > 0 ? kind : 'unverified',
		reference: reference.length > 0 ? reference : null,
		recordedBy: recordedBy.length > 0 ? recordedBy : null,
		ownerConfirmation: ownerConfirmation.length > 0 ? ownerConfirmation : 'unconfirmed',
		ownerConfirmed: reason === null,
		reason,
	};
}

/**
 * The ledger-wide provenance summary (Issue #720).
 *
 * The gate judges one change set at a time, but the ledger as a whole
 * carries a claim that readers (and CI) are tempted to read as "the
 * copy is owner-approved". The summary states the two populations
 * separately, so no report can imply owner approval where there is
 * none.
 */
export function summarizeLedger(ledger) {
	const records = Array.isArray(ledger?.records) ? ledger.records : [];
	let ownerConfirmed = 0;
	let awaitingConfirmation = 0;
	let missingProvenance = 0;
	for (const record of records) {
		const provenance = evaluateProvenance(record);
		if (!provenance.present) missingProvenance += 1;
		if (provenance.ownerConfirmed) ownerConfirmed += 1;
		else awaitingConfirmation += 1;
	}
	return {
		records: records.length,
		ownerConfirmed,
		awaitingConfirmation,
		missingProvenance,
	};
}

/** The human wording of one provenance state. */
export function provenanceLabel(provenance) {
	if (!provenance || !provenance.present) return 'no provenance recorded';
	if (provenance.ownerConfirmed) return 'owner-confirmed';
	return `awaiting owner confirmation (kind=${provenance.kind}, recordedBy=${provenance.recordedBy ?? '—'}, reference=${provenance.reference ?? 'none'})`;
}

/**
 * Resolve the approval record for a change set and the three review
 * dimensions it claims.
 *
 * The record is matched by fingerprint, so an approval cannot be reused
 * for a different text. A record for the same pull request with a
 * different fingerprint is reported as stale: the approved text is no
 * longer the text this pull request publishes.
 */
export function evaluateApproval({ units, ledger, pr = null, diffBase = null }) {
	const fingerprint = fingerprintUnits(units);
	const records = Array.isArray(ledger?.records) ? ledger.records : [];
	const findings = [];
	const ledgerSummary = summarizeLedger(ledger);

	if (units.length === 0) {
		return {
			verdict: 'not applicable',
			fingerprint,
			units: [],
			dimensions: {
				proposal: 'not applicable',
				semantic: 'not applicable',
				approval: 'not applicable',
			},
			findings: [],
			record: null,
			provenance: null,
			ledgerSummary,
			pr,
			diffBase,
		};
	}

	const matching = records.filter((record) => record?.fingerprint === fingerprint);
	if (matching.length === 0) {
		const stale = pr ? records.filter((record) => Number(record?.pr) === Number(pr)) : [];
		if (stale.length > 0) {
			// A record exists for this pull request, but it approved other
			// text. That is a contradiction, not an un-taken decision.
			findings.push(
				finding(
					'stale-approval',
					'error',
					`An approval record exists for pull request #${pr}, but its fingerprint does not match the current change set. The approved text is not the text this pull request publishes.`,
				),
			);
			return {
				verdict: 'fail',
				fingerprint,
				units,
				dimensions: { proposal: 'fail', semantic: 'fail', approval: 'fail' },
				findings,
				record: null,
				provenance: null,
				ledgerSummary,
				pr,
				diffBase,
			};
		}
		findings.push(
			finding(
				'no-approval-record',
				'error',
				`No owner approval record covers this change set (fingerprint ${fingerprint}). The changed public Japanese copy is un-reviewed.`,
			),
		);
		return {
			verdict: 'not run',
			fingerprint,
			units,
			dimensions: { proposal: 'not run', semantic: 'not run', approval: 'not run' },
			findings,
			record: null,
			provenance: null,
			ledgerSummary,
			pr,
			diffBase,
		};
	}

	const record = matching[0];
	const provenance = evaluateProvenance(record);
	const dimensions = { proposal: 'not run', semantic: 'not run', approval: 'not run' };

	// 1. The editing aid: evidence, never approval.
	const proposal = record.proposal;
	if (proposal && proposal.ran === true) {
		const summary = typeof proposal.summary === 'string' ? proposal.summary.trim() : '';
		const disposition = typeof proposal.disposition === 'string' ? proposal.disposition.trim() : '';
		if (summary.length > 0 && disposition.length > 0) {
			dimensions.proposal = 'pass';
		} else {
			findings.push(
				finding(
					'proposal-incomplete',
					'error',
					'The approval record says the editing aid ran, but the suggestions or their disposition are not written down.',
				),
			);
		}
	} else {
		findings.push(
			finding(
				'proposal-not-run',
				'error',
				'The approval record does not say that the editing aid was run over the changed text.',
			),
		);
	}

	// 2. The semantic comparison: the original text against the final text.
	const comparisons = Array.isArray(record.comparisons) ? record.comparisons : [];
	const covered = new Set();
	let comparisonFailed = false;
	for (const unit of units) {
		const text = unit.after ?? unit.before ?? '';
		const match = comparisons.find(
			(entry) => entry?.path === unit.path && (entry?.after ?? entry?.text) === text,
		);
		if (!match) continue;
		covered.add(match);
		const note = typeof match.note === 'string' ? match.note.trim() : '';
		const verdict = typeof match.verdict === 'string' ? match.verdict.trim() : '';
		if (!COMPARISON_VERDICTS.includes(verdict) || note.length === 0) {
			comparisonFailed = true;
			findings.push(
				finding(
					'comparison-incomplete',
					'error',
					`The semantic comparison for "${text}" in ${unit.path} has no usable verdict (${COMPARISON_VERDICTS.join(' / ')}) or no written note.`,
				),
			);
		}
	}
	const uncovered = units.filter((unit) => {
		const text = unit.after ?? unit.before ?? '';
		return !comparisons.some(
			(entry) => entry?.path === unit.path && (entry?.after ?? entry?.text) === text,
		);
	});
	if (uncovered.length > 0) {
		findings.push(
			finding(
				'comparison-missing',
				'error',
				`${uncovered.length} changed segment(s) have no semantic comparison against the original text: ${uncovered
					.map((unit) => `${unit.path} (${unit.after ?? unit.before ?? ''})`)
					.join(', ')}.`,
			),
		);
	}
	for (const entry of comparisons) {
		if (covered.has(entry)) continue;
		findings.push(
			finding(
				'comparison-extra',
				'review',
				`The approval record compares "${entry?.after ?? entry?.text ?? ''}" in ${entry?.path ?? '?'}, which this change set does not change.`,
			),
		);
	}
	if (comparisonFailed) {
		dimensions.semantic = 'fail';
	} else if (uncovered.length === 0) {
		dimensions.semantic = 'pass';
	}

	// 3. The owner's decision — and the provenance that says a human
	//    took it (Issue #720).
	//
	//    `decision: "approved"` is a claim about a human judgement. It
	//    only counts as an owner approval when the record also carries a
	//    traceable owner artefact: provenance.kind = "owner-review", a
	//    non-empty reference, and ownerConfirmation = "confirmed". A
	//    record an automated side wrote is evidence that a review was
	//    *prepared*, and the gate reports it as awaiting owner
	//    confirmation — never as approval.
	const decision = typeof record.decision === 'string' ? record.decision.trim() : '';
	const reviewer = typeof record.reviewer === 'string' ? record.reviewer.trim() : '';
	const reviewedAt = typeof record.reviewedAt === 'string' ? record.reviewedAt.trim() : '';
	if (decision === 'rejected') {
		dimensions.approval = 'fail';
		findings.push(
			finding(
				'approval-rejected',
				'error',
				`The owner rejected this change set${reviewer ? ` (${reviewer})` : ''}. The changed public Japanese copy may not be published as it stands.`,
			),
		);
	} else if (decision === 'approved' && !provenance.present) {
		dimensions.approval = 'not run';
		findings.push(
			finding(
				'approval-provenance-missing',
				'error',
				'The approval record carries no provenance: nothing says who decided, or what traceable artefact says so. The changed public Japanese copy is un-reviewed.',
			),
		);
	} else if (decision === 'approved' && !provenance.ownerConfirmed) {
		dimensions.approval = 'not run';
		findings.push(
			finding(
				'approval-owner-confirmation-missing',
				'error',
				`This record was written by an automated side and no traceable owner confirmation exists, so the copy is un-reviewed (provenance: ${provenanceLabel(provenance)}). An owner approval needs provenance.kind "owner-review", a traceable reference — a GitHub review or an issue comment by the owner — and ownerConfirmation "confirmed".`,
			),
		);
	} else if (decision === 'approved' && reviewer.length > 0 && reviewedAt.length > 0) {
		dimensions.approval = 'pass';
	} else {
		findings.push(
			finding(
				'approval-incomplete',
				'error',
				'The approval record does not carry a complete owner decision (decision, reviewer, date).',
			),
		);
	}

	const failed = Object.values(dimensions).includes('fail');
	const notRun = Object.values(dimensions).includes('not run');
	const verdict = failed ? 'fail' : notRun ? 'not run' : 'pass';

	return {
		verdict,
		fingerprint,
		units,
		dimensions,
		findings,
		record,
		provenance,
		ledgerSummary,
		pr,
		diffBase,
	};
}

/** Verdict label used in the report (the human wording of `not run`). */
export function verdictLabel(verdict) {
	return verdict === 'not run' ? 'NEEDS REVIEW' : verdict.toUpperCase();
}

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function unitText(unit) {
	return unit.after ?? unit.before ?? '';
}

/** Terminal report. Default output; also the text pasted into a PR. */
export function renderText(result) {
	const lines = [];
	const summary = result.ledgerSummary ?? null;
	lines.push('public Japanese copy — editorial approval gate (Issue #506)');
	lines.push(`  verdict: ${verdictLabel(result.verdict)}`);
	lines.push(`  fingerprint: ${result.fingerprint}`);
	if (result.diffBase) {
		lines.push(`  change set: ${result.diffBase.ref} (${describeDiffBase(result.diffBase)})`);
	}
	lines.push(
		`  changed public segments: ${result.units.length}  (review dimensions: ${DIMENSIONS.map(
			(dimension) => `${dimension}=${result.dimensions[dimension]}`,
		).join(', ')})`,
	);
	if (summary) {
		lines.push(
			`  approval ledger: ${summary.records} record(s) — owner-confirmed ${summary.ownerConfirmed}, awaiting owner confirmation ${summary.awaitingConfirmation}`,
		);
		lines.push(`  change sets waiting for an owner decision: ${summary.awaitingConfirmation}`);
	}
	if (result.provenance) {
		lines.push(`  this record's provenance: ${provenanceLabel(result.provenance)}`);
	}
	if (result.units.length === 0) {
		lines.push(
			'  NOT APPLICABLE: this change set changes no Japanese text in a public copy surface.',
		);
	}
	for (const unit of result.units) {
		const before = unit.before === null ? '—' : unit.before;
		const after = unit.after === null ? '—' : unit.after;
		lines.push(`  [${unit.kind}] ${unit.path}`);
		lines.push(`      before: ${before}`);
		lines.push(`      after:  ${after}`);
	}
	for (const item of result.findings) {
		lines.push(`  [${item.severity}] ${item.code}  ${item.message}`);
	}
	lines.push('');
	lines.push('Reading the verdict:');
	lines.push(
		'  - pass           the changed public Japanese copy carries a complete owner approval record whose provenance is owner-confirmed (a traceable owner artefact)',
	);
	lines.push(
		'  - fail           a review was recorded and it says no, or the record contradicts the change set',
	);
	lines.push(
		'  - NEEDS REVIEW   the review was never recorded, or the record that exists was written by an automated side and no owner confirmed it: the copy is un-reviewed',
	);
	lines.push('  - not applicable this change set changes no public Japanese copy');
	lines.push('');
	lines.push('What this gate does not prove:');
	lines.push(
		'  - it checks the SHAPE of a reference, not who wrote the thing the reference points at.',
	);
	lines.push(
		'  - a reference is a claim about a human action; the repository records the claim, it does not prove it.',
	);
	return `${lines.join('\n')}\n`;
}

/** Machine-readable report. */
export function renderJson(result) {
	return `${JSON.stringify(
		{
			schemaVersion: 1,
			verdict: result.verdict,
			fingerprint: result.fingerprint,
			dimensions: result.dimensions,
			units: result.units,
			findings: result.findings,
			provenance: result.provenance ?? null,
			ledgerSummary: result.ledgerSummary ?? null,
			pr: result.pr,
			diffBase: result.diffBase ?? null,
		},
		null,
		2,
	)}\n`;
}

const DIMENSION_LABELS = {
	proposal: 'Editing aid (推敲提案)',
	semantic: 'Comparison with the original (原文との意味比較)',
	approval: 'Owner decision (owner の採否)',
};

/**
 * Self-contained HTML report — the surface the verification artefact
 * captures.
 *
 * `changeSet` (optional) adds the per-file classification: which
 * changed file was treated as public copy, and why every other changed
 * file was out of scope. A gate that silently skipped a file would
 * look exactly like a gate that found nothing to review, so the report
 * prints the skipped files too.
 */
export function renderHtml(result, { fixtures = [], sourceSha = null, changeSet = null } = {}) {
	const summary = result.ledgerSummary ?? null;
	const unitRows = result.units
		.map(
			(unit) => `<tr>
			<td><code>${escapeHtml(unit.path)}</code></td>
			<td>${escapeHtml(unit.kind)}</td>
			<td class="text">${escapeHtml(unit.before ?? '—')}</td>
			<td class="text">${escapeHtml(unit.after ?? '—')}</td>
		</tr>`,
		)
		.join('\n');

	const dimensionRows = DIMENSIONS.map(
		(dimension) => `<tr>
			<td>${escapeHtml(DIMENSION_LABELS[dimension])}</td>
			<td><span class="badge ${escapeHtml(result.dimensions[dimension])}">${escapeHtml(
				result.dimensions[dimension],
			)}</span></td>
		</tr>`,
	).join('\n');

	const findingRows = result.findings
		.map(
			(item) => `<tr class="sev-${escapeHtml(item.severity)}">
			<td><span class="badge ${escapeHtml(item.severity)}">${escapeHtml(item.severity)}</span></td>
			<td><code>${escapeHtml(item.code)}</code></td>
			<td>${escapeHtml(item.message)}</td>
		</tr>`,
		)
		.join('\n');

	const fixtureRows = fixtures
		.map(
			(fixture) => `<tr>
			<td><code>${escapeHtml(fixture.name)}</code></td>
			<td><span class="badge ${escapeHtml(fixture.verdict)}">${escapeHtml(
				fixture.verdict === 'not run' ? 'NEEDS REVIEW' : fixture.verdict,
			)}</span></td>
			<td>${escapeHtml(fixture.note)}</td>
		</tr>`,
		)
		.join('\n');

	const fileRows = changeSet
		? [
				...changeSet.publicFiles.map(
					(file) =>
						`<tr><td><code>${escapeHtml(file.path)}</code></td><td>public copy</td><td>${escapeHtml(
							'declared public copy surface',
						)}</td></tr>`,
				),
				...changeSet.otherFiles.map(
					(file) =>
						`<tr class="off"><td><code>${escapeHtml(file.path)}</code></td><td>out of scope</td><td>${escapeHtml(
							file.reason,
						)}</td></tr>`,
				),
			].join('\n')
		: '';

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Public Japanese copy — editorial approval gate</title>
<style>
	:root { color-scheme: light; }
	* { box-sizing: border-box; }
	body {
		margin: 0; padding: 48px 56px 64px;
		background: #f6f4ef; color: #16150f;
		font: 15px/1.65 ui-sans-serif, system-ui, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
	}
	h1 { font-size: 30px; line-height: 1.2; margin: 0 0 8px; letter-spacing: -0.01em; }
	h2 { font-size: 20px; margin: 0 0 12px; }
	code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
	.lede { max-width: 82ch; margin: 0 0 32px; color: #4a473c; }
	section { background: #fffdf8; border: 1px solid #e2ddd1; border-radius: 10px; padding: 24px 28px; margin-bottom: 24px; }
	.verdict { display: inline-block; border-radius: 999px; padding: 6px 18px; font-weight: 700; font-size: 15px; border: 1px solid transparent; }
	.pass { background: #e6f0e2; border-color: #a9c69c; color: #2f5a24; }
	.fail { background: #fbe6e1; border-color: #e8b4a6; color: #8c2f18; }
	.not-run { background: #fdf3dc; border-color: #e4ce9a; color: #6d5312; }
	.not-applicable { background: #e9eef5; border-color: #b9c8da; color: #2b4763; }
	.review { background: #fdf3dc; border-color: #e4ce9a; color: #6d5312; }
	.info { background: #e9eef5; border-color: #b9c8da; color: #2b4763; }
	table { width: 100%; border-collapse: collapse; font-size: 14px; }
	th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #ece7db; vertical-align: top; }
	th { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: #6b6759; }
	td.text { white-space: pre-wrap; }
	.meta { color: #6b6759; font-size: 14px; margin: 0 0 18px; }
	.legend dl { margin: 0; display: grid; grid-template-columns: 220px 1fr; gap: 8px 20px; }
	.legend dt { font-weight: 600; }
	.legend dd { margin: 0; color: #4a473c; }
	ul.scope { margin: 0; padding-left: 20px; color: #4a473c; }
</style>
</head>
<body>
<h1>Public Japanese copy — editorial approval gate</h1>
<p class="lede">
	Issue #506. A change to the Japanese text a visitor reads is an editorial change, so the
	change set is extracted from the pull request diff and matched against an owner approval
	record. The editing aid (yomiyasu or a comparable tool) is <em>evidence</em>: its output
	never approves anything on its own.
</p>
<section>
	<h2>Verdict</h2>
	<p><span class="verdict ${escapeHtml(result.verdict)}">${escapeHtml(
		verdictLabel(result.verdict),
	)}</span></p>
	<p class="meta">fingerprint <code>${escapeHtml(result.fingerprint)}</code>${
		result.diffBase
			? ` · change set <code>${escapeHtml(result.diffBase.ref)}</code> (${escapeHtml(
					describeDiffBase(result.diffBase),
				)})`
			: ''
	}${sourceSha ? ` · source <code>${escapeHtml(sourceSha)}</code>` : ''}
	</p>
	<table>
		<thead><tr><th>review dimension</th><th>status</th></tr></thead>
		<tbody>${dimensionRows}</tbody>
	</table>
</section>
<section>
	<h2>Owner approval provenance (Issue #720)</h2>
	<p class="meta">
		ledger <code>${escapeHtml(String(summary ? summary.records : 0))}</code> record(s) ·
		owner-confirmed <code>${escapeHtml(String(summary ? summary.ownerConfirmed : 0))}</code> ·
		awaiting owner confirmation <code>${escapeHtml(String(summary ? summary.awaitingConfirmation : 0))}</code>
	</p>
	<p class="meta">
		this change set's record: <code>${escapeHtml(provenanceLabel(result.provenance))}</code>
	</p>
	<p class="meta">
		The gate checks the <em>shape</em> of a reference, not who wrote the thing the reference points
		at. A reference is a claim about a human action; the repository records the claim, it does not
		independently prove it.
	</p>
</section>
<section>
	<h2>Changed public Japanese text</h2>
	${
		result.units.length === 0
			? '<p>This change set changes no Japanese text in a public copy surface.</p>'
			: `<table>
				<thead><tr><th>file</th><th>change</th><th>before</th><th>after</th></tr></thead>
				<tbody>${unitRows}</tbody>
			</table>`
	}
</section>
<section>
	<h2>Findings</h2>
	${
		result.findings.length === 0
			? '<p>No finding: the changed public Japanese copy carries a complete owner approval record.</p>'
			: `<table>
				<thead><tr><th>severity</th><th>finding</th><th>detail</th></tr></thead>
				<tbody>${findingRows}</tbody>
			</table>`
	}
</section>
<section>
	<h2>Changed files and their classification</h2>
	${
		changeSet === null
			? ''
			: `<table>
				<thead><tr><th>file</th><th>classification</th><th>reason</th></tr></thead>
				<tbody>${fileRows}</tbody>
			</table>`
	}
</section>
<section>
	<h2>The four verdicts (fixtures)</h2>
	<p class="meta">The committed fixtures under <code>test/fixtures/copy/editorial-approval/</code> resolve to these four states.</p>
	<table>
		<thead><tr><th>fixture</th><th>verdict</th><th>what it proves</th></tr></thead>
		<tbody>${fixtureRows}</tbody>
	</table>
</section>
<div class="legend">
	<h2>How to read this report</h2>
	<dl>
		<dt>pass</dt><dd>the changed public Japanese copy carries a complete owner approval record (proposal + comparison + decision) whose provenance is owner-confirmed — a traceable owner artefact.</dd>
		<dt>fail</dt><dd>a review was recorded and it says no, or the record contradicts the change set. The change may not be published as it stands.</dd>
		<dt>not run (NEEDS REVIEW)</dt><dd>the review was never recorded, or the record that exists was written by an automated side and no owner confirmed it. The copy is un-reviewed.</dd>
		<dt>not applicable</dt><dd>the change set changes no public Japanese copy, so no review is owed.</dd>
	</dl>
</div>
<section>
	<h2>Out of scope (declared, not forgotten)</h2>
	<ul class="scope">
		<li>Japanese text in internal documents, skills, scripts and tests — contributor-facing, not visitor-facing.</li>
		<li>Admin surfaces (<code>src/admin/**</code>, <code>src/routes/admin.*</code>) — owner-only, behind authentication.</li>
		<li>Storybook samples, fixtures and design-system demo routes — not published copy.</li>
		<li>Prose quality itself: register, honorifics, word order. The gate records a human decision; it never grades Japanese.</li>
		<li>Locale coverage: a capability's published languages stay an opt-in copy decision in <code>copy/resources.json</code>.</li>
	</ul>
</section>
</body>
</html>
`;
}

export function exitCodeForVerdict(verdict, { allowUnreviewed = false } = {}) {
	if (verdict === 'pass' || verdict === 'not applicable') return 0;
	if (verdict === 'not run') return allowUnreviewed ? 0 : 1;
	if (verdict === 'fail') return 1;
	return 2;
}

function parseArgs(argv) {
	const options = {
		base: null,
		head: 'HEAD',
		pr: null,
		ledger: LEDGER_PATH,
		surfaces: SURFACES_PATH,
		format: 'text',
		out: null,
		printFingerprint: false,
		allowUnreviewed: false,
	};
	for (const arg of argv) {
		// `pnpm run <script> -- <args>` forwards the separator; the runbook
		// documents that form, so it is not an unknown option.
		if (arg === '--') continue;
		if (arg.startsWith('--base=')) options.base = arg.slice('--base='.length);
		else if (arg.startsWith('--head=')) options.head = arg.slice('--head='.length);
		else if (arg.startsWith('--pr=')) options.pr = arg.slice('--pr='.length);
		else if (arg.startsWith('--ledger=')) options.ledger = arg.slice('--ledger='.length);
		else if (arg.startsWith('--surfaces=')) options.surfaces = arg.slice('--surfaces='.length);
		else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length);
		else if (arg.startsWith('--format=')) options.format = arg.slice('--format='.length);
		else if (arg === '--print-fingerprint') options.printFingerprint = true;
		else if (arg === '--allow-unreviewed') options.allowUnreviewed = true;
		else throw new Error(`unknown option: ${arg}`);
	}
	return options;
}

export function main(argv, { env = process.env } = {}) {
	let options;
	try {
		options = parseArgs(argv);
	} catch (error) {
		process.stderr.write(`[check-copy-editorial-approval] ${error.message}\n`);
		return 2;
	}
	if (!['text', 'json', 'html'].includes(options.format)) {
		process.stderr.write(`[check-copy-editorial-approval] unknown --format: ${options.format}\n`);
		return 2;
	}

	let surfaces;
	let ledger;
	try {
		surfaces = readJson(options.surfaces, 'public copy surface declaration');
		ledger = readJson(options.ledger, 'approval ledger');
	} catch (error) {
		process.stderr.write(`[check-copy-editorial-approval] ${error.message}\n`);
		return 2;
	}

	const base = resolveBaseRef(options.base, env);
	if (!base) {
		process.stderr.write(
			'[check-copy-editorial-approval] no base ref: pass --base=<ref> (or set COPY_APPROVAL_BASE / GITHUB_BASE_REF). The gate cannot judge a change set it cannot see.\n',
		);
		return 2;
	}
	if (!refExists(options.head)) {
		process.stderr.write(`[check-copy-editorial-approval] head ref not found: ${options.head}\n`);
		return 2;
	}

	// Judge the pull request's OWN change set, never the two refs
	// directly: a base branch that moved on would otherwise publish its
	// own text into the report and the fingerprint. No merge base and no
	// merge commit means the change set is unknown — exit 2, do not
	// guess.
	const diffBase = resolveDiffBase(base, options.head);
	if (!diffBase) {
		process.stderr.write(
			`[check-copy-editorial-approval] no change set: neither the merge base of ${base} and ${options.head} nor the first parent of the head commit is reachable (shallow clone?). Fetch more history; the gate will not judge a diff it cannot compute.\n`,
		);
		return 2;
	}

	let diffText;
	try {
		diffText = gitDiff(diffBase.ref, options.head);
	} catch (error) {
		process.stderr.write(
			`[check-copy-editorial-approval] cannot diff ${diffBase.ref}..${options.head}\n`,
		);
		return 2;
	}

	const changeSet = buildChangeSet(diffText, surfaces);
	const result = evaluateApproval({
		units: changeSet.units,
		ledger,
		pr: options.pr ? Number(options.pr) : null,
		diffBase,
	});

	if (options.printFingerprint) {
		process.stdout.write(`${result.fingerprint}\n`);
		return 0;
	}

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

	if (options.allowUnreviewed && result.verdict === 'not run') {
		process.stdout.write(
			'::warning title=Public copy review pending::Owner review is unconfirmed; technical CI continues. This is not an approval.\n',
		);
	}
	return exitCodeForVerdict(result.verdict, { allowUnreviewed: options.allowUnreviewed });
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exit(main(process.argv.slice(2)));
}
