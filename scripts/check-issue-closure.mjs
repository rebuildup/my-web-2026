#!/usr/bin/env node
/**
 * Issue-closure evidence gate (Issue #741).
 *
 * Usage:
 *   node scripts/check-issue-closure.mjs
 *   node scripts/check-issue-closure.mjs --record=quality/issue-closure-ledger.json
 *
 * Why this exists
 * ---------------
 * On 2026-10-31 a single automated sweep closed 132 GitHub Issues with
 * `state_reason: completed`. 124 of them received the identical comment
 * "回収完了。release-0-8-0統合完了（#679待機中）。" — a statement about the
 * RELEASE BRANCH, not about the issue's own acceptance criteria. Concepts
 * that were never implemented (the Codex pet, the "現在地" Home surface,
 * the Notion CMS, the activity timeline) disappeared from the backlog the
 * same way implemented work did. The loss was not the wrong close; it was
 * that "integrated into the release" was allowed to read as "the original
 * goal was achieved", so an idea could never be told apart from a shipped
 * feature.
 *
 * This gate is the offline half of the repair. It reads ONE committed
 * record — `quality/issue-closure-ledger.json` — and checks that every
 * closed issue the repository knows about carries:
 *
 *   - a state from the closure vocabulary (not a free-text claim),
 *   - evidence that a reader can open, or an explicit decision with a
 *     written reason,
 *   - a truthful author mark: an agent-written record may never claim
 *     owner confirmation it cannot point at.
 *
 * What this gate deliberately does NOT do
 * ---------------------------------------
 *   - It does not count issues. The number of closed issues is not a
 *     quality metric and is not printed as a score.
 *   - It does not decide that a concept is bad, unwanted or finished.
 *     A concept that was never built is a legitimate state; the gate
 *     only requires that the state is written down and traceable.
 *   - It does not talk to GitHub. The remote half
 *     (`scripts/check-issue-closure-remote.mjs`) does that, and it runs
 *     as a CI step because it needs the network.
 *
 * Properties that make the output safe to paste into a PR
 * ---------------------------------------------------------
 * Offline and status-only: no network, no environment variable, no
 * secret, no Cloudflare binding. It prints issue numbers, states and
 * rule ids — never an issue body, so a private note cannot travel with
 * the report.
 *
 * Exit codes: 0 = no error-severity finding, 1 = at least one error,
 * 2 = unusable input (unreadable record / root).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The closure vocabulary (Issue #741). A closed issue is in exactly one
 * of these states; the vocabulary is the thing that makes "done" mean
 * one thing only.
 */
export const CLOSURE_STATES = [
	'implemented-and-verified',
	'partial',
	'research-complete-with-decision',
	'planned-unimplemented',
	'deferred-with-reason',
	'explicitly-rejected-with-reason',
	'unassessed',
	'private-not-exported',
];

/** States that assert the original goal was reached. */
export const COMPLETION_STATES = ['implemented-and-verified', 'research-complete-with-decision'];

/**
 * States that RESOLVE the issue: the goal was reached, OR the question
 * was answered with a written reason (deferred / rejected). A resolved
 * issue needs citable evidence and — for the latter three — a written
 * reason. A deferred or rejected issue is NOT "the feature shipped",
 * which is why `closure: "unsupported"` does not contradict it.
 */
export const RESOLUTION_STATES = [
	...COMPLETION_STATES,
	'deferred-with-reason',
	'explicitly-rejected-with-reason',
];

/** States that require a written decision. */
export const DECISION_STATES = [
	'research-complete-with-decision',
	'deferred-with-reason',
	'explicitly-rejected-with-reason',
];

/** The closure verdict: did the sweep's `completed` claim hold? */
export const CLOSURE_VERDICTS = ['supported', 'unsupported', 'awaiting-owner'];

const EVIDENCE_PATTERNS = [
	/^(?:[a-z0-9_.-]+\/)+[a-z0-9_.-]+$/i, // a repository path
	/^#\d+$/, // a pull request / issue number
	/^issue #\d+/i, // a dated comment on the issue itself
	/^https?:\/\/\S+$/, // a URL
	/\b[0-9a-f]{7,40}\b/, // a commit sha
];

/** The 2026-10-31 sweep comment. It is a statement about the release
 *  branch, never evidence about an issue's own acceptance criteria, so
 *  it may not appear as an issue's only evidence. */
export const SWEEP_TEMPLATE_MARKERS = ['回収完了', 'release-0-8-0統合完了'];

function looksLikeEvidence(text) {
	return EVIDENCE_PATTERNS.some((pattern) => pattern.test(text));
}

function isSweepTemplate(text) {
	return SWEEP_TEMPLATE_MARKERS.some((marker) => text.includes(marker));
}

function readLedger(path) {
	let raw;
	try {
		raw = readFileSync(path, 'utf8');
	} catch {
		return { error: `unreadable record: ${path}` };
	}
	try {
		return { value: JSON.parse(raw) };
	} catch (error) {
		return { error: `unparsable record: ${path} (${error.message})` };
	}
}

/**
 * Validate one ledger entry.
 *
 * @param {Record<string, unknown>} entry
 * @returns {Array<{rule: string, issue: number|null, message: string}>}
 */
export function checkEntry(entry) {
	const findings = [];
	const issue = Number.isInteger(entry?.issue) ? entry.issue : null;
	const fail = (rule, message) => findings.push({ rule, issue, message });

	if (!entry || typeof entry !== 'object') {
		fail('E001', 'entry is not an object');
		return findings;
	}
	if (!Number.isInteger(entry.issue)) {
		fail('E001', 'entry.issue must be an integer issue number');
	}
	if (typeof entry.title !== 'string' || entry.title.trim() === '') {
		fail('E001', 'entry.title must be a non-empty string');
	}
	if (typeof entry.closedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(entry.closedAt)) {
		fail('E001', 'entry.closedAt must be an ISO date');
	}
	if (!CLOSURE_STATES.includes(entry.state)) {
		fail(
			'E002',
			`entry.state "${entry.state}" is not one of the closure vocabulary: ${CLOSURE_STATES.join(', ')}`,
		);
	}
	if (!CLOSURE_VERDICTS.includes(entry.closure)) {
		fail('E002', `entry.closure "${entry.closure}" is not one of: ${CLOSURE_VERDICTS.join(', ')}`);
	}

	const evidence = Array.isArray(entry.evidence) ? entry.evidence : null;
	if (!evidence) {
		fail('E001', 'entry.evidence must be an array');
	} else {
		const openable = evidence.filter(
			(item) => typeof item === 'string' && item.trim() !== '' && !isSweepTemplate(item),
		);
		if (RESOLUTION_STATES.includes(entry.state) && !openable.some(looksLikeEvidence)) {
			fail(
				'E003',
				`state "${entry.state}" claims the goal was reached but no evidence names a repository path, a pull request, a commit or a URL`,
			);
		}
		if (openable.length === 0 && evidence.length > 0) {
			fail(
				'E006',
				'the only evidence is the 2026-10-31 sweep template ("回収完了 / release-0-8-0統合完了"), which states release-branch integration, not the issue\'s own acceptance criteria',
			);
		}
	}

	if (DECISION_STATES.includes(entry.state)) {
		const decision = entry.decision;
		const reason = typeof decision?.reason === 'string' ? decision.reason.trim() : '';
		if (reason === '') {
			fail(
				'E005',
				`state "${entry.state}" requires a written decision reason (entry.decision.reason)`,
			);
		}
	}

	if (entry.closure === 'supported' && !RESOLUTION_STATES.includes(entry.state)) {
		fail(
			'E004',
			`closure "supported" contradicts state "${entry.state}", which does not resolve the issue`,
		);
	}
	if (entry.closure === 'unsupported' && COMPLETION_STATES.includes(entry.state)) {
		fail(
			'E004',
			`closure "unsupported" contradicts state "${entry.state}", which asserts that the goal was reached`,
		);
	}

	const recordedBy = entry.recordedBy;
	if (recordedBy !== 'agent' && typeof recordedBy !== 'string') {
		fail('E001', 'entry.recordedBy must be "agent" or a handle');
	}
	const ownerConfirmation = entry.ownerConfirmation;
	if (ownerConfirmation !== 'confirmed' && ownerConfirmation !== 'unconfirmed') {
		fail('E001', 'entry.ownerConfirmation must be "confirmed" or "unconfirmed"');
	}
	if (ownerConfirmation === 'confirmed') {
		const reference = typeof entry.ownerReference === 'string' ? entry.ownerReference.trim() : '';
		if (reference === '') {
			fail(
				'E007',
				'entry.ownerConfirmation is "confirmed" but no entry.ownerReference points at a traceable owner artefact',
			);
		}
	}
	if (
		recordedBy === 'agent' &&
		ownerConfirmation === 'confirmed' &&
		typeof entry.ownerReference === 'string' &&
		!/^https?:\/\/\S+$/.test(entry.ownerReference)
	) {
		fail(
			'E007',
			'an agent-written record may only claim owner confirmation through a URL that points at a traceable owner artefact',
		);
	}

	return findings;
}

/**
 * Validate a whole ledger.
 *
 * @param {unknown} ledger
 * @returns {{findings: Array<{rule: string, issue: number|null, message: string}>, summary: Record<string, unknown>}}
 */
export function checkLedger(ledger) {
	const findings = [];
	if (!ledger || typeof ledger !== 'object' || !Array.isArray(ledger.entries)) {
		return {
			findings: [{ rule: 'E001', issue: null, message: 'ledger.entries must be an array' }],
			summary: {},
		};
	}
	const seen = new Set();
	for (const entry of ledger.entries) {
		findings.push(...checkEntry(entry));
		const number = entry?.issue;
		if (Number.isInteger(number)) {
			if (seen.has(number)) {
				findings.push({
					rule: 'E008',
					issue: number,
					message: 'the same issue appears more than once in the ledger',
				});
			}
			seen.add(number);
		}
	}

	const byState = {};
	const byClosure = {};
	let awaitingOwner = 0;
	let agentRecorded = 0;
	let ownerConfirmed = 0;
	for (const entry of ledger.entries) {
		byState[entry?.state] = (byState[entry?.state] ?? 0) + 1;
		byClosure[entry?.closure] = (byClosure[entry?.closure] ?? 0) + 1;
		if (entry?.closure === 'awaiting-owner') awaitingOwner += 1;
		if (entry?.recordedBy === 'agent') agentRecorded += 1;
		if (entry?.ownerConfirmation === 'confirmed') ownerConfirmed += 1;
	}
	return {
		findings,
		summary: {
			entries: ledger.entries.length,
			byState,
			byClosure,
			awaitingOwner,
			agentRecorded,
			ownerConfirmed,
			awaitingOwnerConfirmation: ledger.entries.length - ownerConfirmed,
		},
	};
}

function formatSummary(summary) {
	const lines = [];
	lines.push(`issue closure ledger: ${summary.entries} recorded closure(s)`);
	for (const [state, count] of Object.entries(summary.byState ?? {}).sort()) {
		lines.push(`  state ${state}: ${count}`);
	}
	lines.push(`  closure supported: ${summary.byClosure?.supported ?? 0}`);
	lines.push(`  closure unsupported: ${summary.byClosure?.unsupported ?? 0}`);
	lines.push(`  closure awaiting-owner: ${summary.byClosure?.['awaiting-owner'] ?? 0}`);
	lines.push(
		`  records awaiting owner confirmation: ${summary.awaitingOwnerConfirmation} (of ${summary.entries})`,
	);
	lines.push(
		'  note: the number of closed issues is not a score. A concept that was never built is a legitimate state.',
	);
	return lines.join('\n');
}

export function main(argv) {
	const args = argv.slice(2);
	let recordPath = 'quality/issue-closure-ledger.json';
	for (const arg of args) {
		const match = /^--record=(.+)$/.exec(arg);
		if (match) recordPath = match[1];
	}
	const path = resolve(process.cwd(), recordPath);
	const { value, error } = readLedger(path);
	if (error) {
		process.stderr.write(`${error}\n`);
		return 2;
	}
	const { findings, summary } = checkLedger(value);
	const errors = findings.filter((finding) => finding.rule !== 'E009');
	if (errors.length > 0) {
		for (const finding of errors) {
			process.stderr.write(
				`${finding.rule} ${finding.issue === null ? '' : `#${finding.issue} `}${finding.message}\n`,
			);
		}
		process.stderr.write(`${errors.length} closure-evidence finding(s)\n`);
	}
	process.stdout.write(`${formatSummary(summary)}\n`);
	return errors.length > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exit(main(process.argv));
}
