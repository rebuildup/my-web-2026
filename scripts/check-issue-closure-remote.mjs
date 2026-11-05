#!/usr/bin/env node
/**
 * Issue-closure remote audit (Issue #741).
 *
 * Usage:
 *   node scripts/check-issue-closure-remote.mjs
 *   node scripts/check-issue-closure-remote.mjs --since=2026-10-31
 *   GITHUB_TOKEN=… node scripts/check-issue-closure-remote.mjs
 *
 * Why this exists
 * ---------------
 * `scripts/check-issue-closure.mjs` checks that the committed ledger is
 * honest. It cannot check that the ledger is COMPLETE — that needs to
 * know what GitHub actually did. This script is the other half: it asks
 * GitHub what state the tracked issues are in, and it reports every
 * closure the repository has no record of.
 *
 * It exists because of 2026-10-31, when 132 issues were closed in one
 * automated sweep with a single templated comment and no per-issue
 * evidence. A gate that only reads the repository would have stayed
 * green through that sweep, because the sweep wrote no repository record
 * at all.
 *
 * What it checks
 * --------------
 * The ledger is the living record of closure decisions, so the gate
 * checks two independent things:
 *
 *   1. **Ledger ↔ GitHub agreement** (R002 / R003 / R004 / R005). For
 *      every entry the ledger carries, the issue's CURRENT GitHub state
 *      must match the action the ledger recorded — a `reopened` entry
 *      must be open, a `kept-closed` entry must be closed. This is what
 *      a set-membership check gets wrong: a reopened issue leaves the
 *      "currently closed" set, so inferring its state from that set
 *      cannot distinguish "reopened on purpose" from "never closed".
 *      The state is read from GitHub directly.
 *
 *   2. **Closures with no record and no evidence** (R001). Every issue
 *      closed inside the audited window must carry EITHER a ledger
 *      entry (a recorded decision) OR a trace attached to the closure
 *      itself — a commit that referenced the issue, or a comment that
 *      names the artefact or records an explicit decision. A closure
 *      with none of those is exactly the 2026-10-31 shape: the issue
 *      disappeared from the backlog with nothing a reader could open.
 *
 *      A bare pull-request reference is deliberately NOT a trace. The
 *      audit's own standard says that "the PR was merged" does not
 *      prove the issue's goal was reached, and the measurement agrees:
 *      on the reconstructed 2026-10-31 state, treating a merged-PR
 *      reference as evidence caught only 57 of the 132 swept issues,
 *      while the commit-or-comment bar caught 92 of the 104 issues
 *      the audit judged unsupported or awaiting the owner.
 *
 *   3. **Mass closures with one template** (R006). A closure operation
 *      that shares ONE closing comment across several issues is a mass
 *      operation, and a mass operation needs a per-issue record. When
 *      such a cluster uses the release-branch wording ("回収完了" /
 *      "統合完了" / "一括クローズ"), the gate reports the cluster even
 *      if individual issues happen to carry an incidental reference:
 *      the damage of 2026-10-31 was the operation, not the individual
 *      comments.
 *
 * The window
 * ----------
 * The ledger declares its windows in `audit.windows` (Issue #815). A
 * window is a date range plus the population it covers:
 *
 *   - `population: <integer>` is a FROZEN window. The entries attributed
 *     to it must number exactly that, so the 2026-10-31 sweep's 132
 *     entries can never be silently trimmed or padded.
 *   - `population: null` is a DERIVED window. Its population is the
 *     entries attributed to it, so recording a new close cannot turn the
 *     gate red. It still has a date range: an entry cannot be parked
 *     outside the period it claims to cover.
 *
 * Every entry names its window (`entry.window`) and its `closedAt` must
 * fall inside that window. The audit's `--since=` default is the
 * earliest window start, because that is the population the ledger
 * claims to cover; the history before it is out of the audit's scope.
 * `--since=` overrides it. A closure outside every window is not an
 * audit finding: closing an issue is normal development work, and the
 * gate is not a licence system.
 *
 * Why it is a CI step and not part of `validate:fast`
 * --------------------------------------------------
 * It needs the GitHub API, and `validate:fast` is offline and
 * read-only by contract (the same reason the dependency advisory gate
 * is a CI step — see AGENTS.md §5). The decision logic is here, in
 * this script, not in workflow YAML, so the same verdict is reproducible
 * locally with the same command.
 *
 * Failure contract
 * ----------------
 *   error → the step fails. An issue was closed with neither a ledger
 *           entry nor a trace (R001), the ledger and GitHub disagree
 *           about a tracked issue's state (R002 / R003), a ledger entry
 *           cannot be read (R004), the ledger's windows and its entries
 *           disagree — an entry is unattributed or outside its window,
 *           or a frozen window's entry count does not match (R005) — or
 *           a mass closure used the release-branch template without a
 *           per-issue record (R006).
 *   The API being unreachable is exit 2 (unusable input), never a clean
 *   bill of health: a registry outage must not read as "everything is
 *           accounted for".
 *
 * Properties that make the output safe to paste into a PR
 * ---------------------------------------------------------
 * Status-only: it prints issue numbers and rule ids. It never prints an
 * issue body, a comment body, a credential or a raw API error body.
 * Comment bodies ARE read (they are the evidence), but only a boolean
 * derived from them is ever printed.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SWEEP_TEMPLATE_MARKERS } from './check-issue-closure.mjs';

const DEFAULT_REPO = 'rebuildup/my-web-2026';
const API = 'https://api.github.com';
const GRAPHQL_API = 'https://api.github.com/graphql';

/**
 * Phrases that mark a closure comment as a statement about the RELEASE
 * BRANCH rather than about the issue's own acceptance criteria. The
 * shared list lives in the offline gate; these two catch the same
 * family of wording with a different sweep vocabulary.
 */
const SWEEP_TEMPLATE_PATTERNS = [...SWEEP_TEMPLATE_MARKERS, '一括クローズ', '一括回収'];

/**
 * An artefact a reader can open: a pull request number, a commit sha
 * or a URL.
 */
const ARTEFACT_PATTERN = /(?:#\d+|\b[0-9a-f]{7,40}\b|https?:\/\/\S+)/;

/**
 * Words that make a comment a recorded DECISION even when it names no
 * artefact: a hold, a rejection, a duplicate, a deferral. The audit
 * requires a written reason for those, not a linked artefact.
 */
const DECISION_PATTERN =
	/(重複|却下|保留|延期|見送り|不採用|実装しない|対応しない|duplicate|reject|defer|won'?t fix|not planned)/i;

function parseArgs(argv) {
	const args = {
		repo: DEFAULT_REPO,
		since: null,
		record: 'quality/issue-closure-ledger.json',
	};
	for (const arg of argv.slice(2)) {
		const repo = /^--repo=(.+)$/.exec(arg);
		if (repo) {
			args.repo = repo[1];
			continue;
		}
		const since = /^--since=(.+)$/.exec(arg);
		if (since) {
			args.since = since[1];
			continue;
		}
		const record = /^--record=(.+)$/.exec(arg);
		if (record) {
			args.record = record[1];
		}
	}
	return args;
}

function readLedger(path) {
	try {
		return { value: JSON.parse(readFileSync(path, 'utf8')) };
	} catch (error) {
		return { error: `unusable record: ${path} (${error.message})` };
	}
}

function headersFor(token) {
	const headers = {
		accept: 'application/vnd.github+json',
		'user-agent': 'my-web-2026-issue-closure-audit',
	};
	if (token) headers.authorization = `Bearer ${token}`;
	return headers;
}

/**
 * List the issues that are closed on GitHub on or after `since`.
 *
 * Note that GitHub's search index only reports an issue while it is
 * closed: an issue that was closed and later reopened leaves the set.
 * That is why this list can never be the population — it is only the
 * set of closures that still hold.
 *
 * @param {{repo: string, since: string, token: string|null, fetchImpl?: typeof fetch}} options
 * @returns {Promise<Array<{number: number, title: string, closedAt: string}>>}
 */
export async function listClosedIssues({ repo, since, token = null, fetchImpl = fetch }) {
	const issues = [];
	for (let page = 1; page <= 10; page += 1) {
		const query = encodeURIComponent(`repo:${repo} is:issue closed:>=${since}`);
		const url = `${API}/search/issues?q=${query}&per_page=100&page=${page}`;
		const response = await fetchImpl(url, { headers: headersFor(token) });
		if (!response.ok) {
			const error = new Error(`github search failed with status ${response.status}`);
			error.status = response.status;
			throw error;
		}
		const payload = await response.json();
		const items = payload?.items ?? [];
		for (const item of items) {
			if (item.pull_request) continue; // a pull request is not an issue
			issues.push({
				number: item.number,
				title: item.title,
				closedAt: item.closed_at ?? '',
			});
		}
		if (items.length < 100) break;
	}
	return issues;
}

/**
 * Read the current GitHub state of every given issue, together with the
 * trace its closure left.
 *
 * Uses one aliased GraphQL query per batch, so the whole population
 * costs a handful of requests instead of one request per issue.
 *
 * @param {{repo: string, numbers: number[], token: string|null, fetchImpl?: typeof fetch, batchSize?: number}} options
 * @returns {Promise<Map<number, {number: number, state: string, closedAt: string|null, comments: Array<{body: string, createdAt: string|null}>, referencedPullRequests: number[], referencedCommits: string[]}>>}
 */
export async function fetchIssueStates({
	repo,
	numbers,
	token = null,
	fetchImpl = fetch,
	batchSize = 40,
}) {
	const [owner, name] = repo.split('/');
	const states = new Map();
	const unique = [...new Set(numbers)].filter((n) => Number.isInteger(n));
	for (let index = 0; index < unique.length; index += batchSize) {
		const chunk = unique.slice(index, index + batchSize);
		const fields = chunk
			.map(
				(number, offset) => `
i${offset}: issue(number: ${number}) {
  number
  state
  closedAt
  comments(last: 30) { nodes { body createdAt } }
  timelineItems(first: 30, itemTypes: [CROSS_REFERENCED_EVENT, REFERENCED_EVENT]) {
    nodes {
      __typename
      ... on CrossReferencedEvent { source { __typename ... on PullRequest { number } } }
      ... on ReferencedEvent { commit { oid } }
    }
  }
}`,
			)
			.join('\n');
		const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {${fields} } }`;
		const response = await fetchImpl(GRAPHQL_API, {
			method: 'POST',
			headers: { ...headersFor(token), 'content-type': 'application/json' },
			body: JSON.stringify({ query }),
		});
		if (!response.ok) {
			const error = new Error(`github graphql failed with status ${response.status}`);
			error.status = response.status;
			throw error;
		}
		const payload = await response.json();
		if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
			throw new Error(`github graphql returned an error (${payload.errors[0].message})`);
		}
		const repository = payload?.data?.repository;
		if (!repository) {
			throw new Error('github graphql returned no repository');
		}
		for (const value of Object.values(repository)) {
			if (!value) continue;
			const timeline = value.timelineItems?.nodes ?? [];
			states.set(value.number, {
				number: value.number,
				state: value.state,
				closedAt: value.closedAt ?? null,
				comments: (value.comments?.nodes ?? []).map((node) => ({
					body: node?.body ?? '',
					createdAt: node?.createdAt ?? null,
				})),
				referencedPullRequests: timeline
					.filter((node) => node?.__typename === 'CrossReferencedEvent' && node.source?.number)
					.map((node) => node.source.number),
				referencedCommits: timeline
					.filter((node) => node?.__typename === 'ReferencedEvent' && node.commit?.oid)
					.map((node) => node.commit.oid),
			});
		}
	}
	return states;
}

/**
 * Is this comment the release-branch template rather than a statement
 * about the issue?
 *
 * @param {string} body
 * @returns {boolean}
 */
export function isSweepTemplate(body) {
	if (typeof body !== 'string') return false;
	return SWEEP_TEMPLATE_PATTERNS.some((pattern) => body.includes(pattern));
}

/**
 * Does the closure leave a trace a reader can open?
 *
 * A trace is one of:
 *   - a commit whose message referenced the issue,
 *   - a comment that names an artefact (a pull request, a commit, a URL)
 *     or that records an explicit decision (a hold, a rejection, a
 *     duplicate, a deferral).
 *
 * A bare pull-request reference is NOT a trace: the audit's standard is
 * that "the PR was merged" does not prove the issue's goal was reached,
 * and the measurement agrees — a merged-PR reference on the
 * reconstructed 2026-10-31 state left 57 of the 132 swept issues
 * looking accounted for, against 92 of the 104 the audit judged
 * unsupported or awaiting the owner under the commit-or-comment bar.
 *
 * The release-branch template is NOT a trace either: it states that a
 * branch was integrated, not that this issue's own goal was reached.
 *
 * @param {{comments: Array<{body: string, createdAt: string|null}>, referencedPullRequests: number[], referencedCommits: string[]}|undefined} issue
 * @returns {boolean}
 */
export function hasClosureTrace(issue) {
	if (!issue) return false;
	if ((issue.referencedCommits ?? []).length > 0) return true;
	return (issue.comments ?? []).some(
		(comment) =>
			typeof comment?.body === 'string' &&
			comment.body.trim() !== '' &&
			!isSweepTemplate(comment.body) &&
			(ARTEFACT_PATTERN.test(comment.body) || DECISION_PATTERN.test(comment.body)),
	);
}

/**
 * The comment the issue was closed with: the last one written at or
 * before the closure.
 *
 * A cluster detector needs the CLOSING comment, not any comment: a
 * later comment (a recovery note, a follow-up discussion) says nothing
 * about how the issue was closed.
 *
 * @param {{closedAt: string|null, comments: Array<{body: string, createdAt: string|null}>}} issue
 * @returns {string|null}
 */
export function closingComment(issue) {
	if (!issue) return null;
	const closedAt = issue.closedAt ? new Date(issue.closedAt).getTime() : Number.POSITIVE_INFINITY;
	const before = (issue.comments ?? []).filter((comment) => {
		if (!comment?.createdAt) return true;
		return new Date(comment.createdAt).getTime() <= closedAt;
	});
	if (before.length === 0) return null;
	const last = before[before.length - 1];
	return typeof last.body === 'string' && last.body.trim() !== '' ? last.body : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value) {
	return typeof value === 'string' && ISO_DATE.test(value);
}

/**
 * The earliest declared window start — the date the audit's default
 * `--since=` begins. Falls back to `audit.closedAt` for a ledger written
 * before windows existed.
 *
 * @param {unknown} ledger
 * @returns {string|null}
 */
export function auditWindowStart(ledger) {
	const windows = Array.isArray(ledger?.audit?.windows) ? ledger.audit.windows : [];
	const starts = windows
		.map((window) => window?.from)
		.filter(isIsoDate)
		.sort();
	return starts[0] ?? (isIsoDate(ledger?.audit?.closedAt) ? ledger.audit.closedAt : null);
}

/**
 * One line per declared window, for the human summary. This is not a
 * score: it makes the ledger's own coverage visible.
 *
 * @param {unknown} ledger
 * @returns {string[]}
 */
export function summarizeWindows(ledger) {
	const entries = Array.isArray(ledger?.entries) ? ledger.entries : [];
	const windows = Array.isArray(ledger?.audit?.windows) ? ledger.audit.windows : [];
	const counts = new Map();
	for (const entry of entries) {
		const id = typeof entry?.window === 'string' ? entry.window : null;
		if (id === null) continue;
		counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	return windows.map((window) => {
		const id = typeof window?.id === 'string' ? window.id : '(unnamed)';
		const population = Number.isInteger(window?.population)
			? `frozen population ${window.population}`
			: 'population derived from entries';
		return `${id}: ${counts.get(id) ?? 0} recorded (${population})`;
	});
}

/**
 * R005 — the ledger's windows and its entries agree (Issue #815).
 *
 * The rule this replaces compared ONE frozen number (`audit.population`)
 * with `entries.length`, which meant no new close could ever be
 * recorded. The window keeps that guarantee where it is meaningful —
 * a frozen historical population — and derives it everywhere the
 * ledger keeps growing:
 *
 *   - every entry names a declared window, and its `closedAt` falls
 *     inside that window's dates (so an entry cannot be parked in a
 *     window that does not cover it);
 *   - a frozen window carries exactly its declared number of entries
 *     (so the 2026-10-31 population of 132 cannot be trimmed or padded);
 *   - a derived window's population is its entries, and needs no count.
 *
 * @param {unknown} ledger
 * @returns {Array<{rule: string, issue: number|null, message: string}>}
 */
export function checkWindows(ledger) {
	const findings = [];
	const entries = Array.isArray(ledger?.entries) ? ledger.entries : [];
	const windows = Array.isArray(ledger?.audit?.windows) ? ledger.audit.windows : [];
	const fail = (message) => findings.push({ rule: 'R005', issue: null, message });

	if (windows.length === 0) {
		if (entries.length > 0) {
			fail(
				`the ledger carries ${entries.length} entries but declares no audit window (audit.windows); every entry must belong to a declared window`,
			);
		}
		return findings;
	}

	const byId = new Map();
	for (const window of windows) {
		if (!window || typeof window.id !== 'string' || window.id.trim() === '') {
			fail('an audit window has no id');
			continue;
		}
		if (byId.has(window.id)) {
			fail(`audit window "${window.id}" is declared more than once`);
			continue;
		}
		if (!isIsoDate(window.from) || (window.to !== null && !isIsoDate(window.to))) {
			fail(`audit window "${window.id}" must declare from / to as ISO dates (to may be null)`);
			continue;
		}
		if (window.to !== null && window.to < window.from) {
			fail(`audit window "${window.id}" ends before it starts`);
			continue;
		}
		if (
			window.population !== null &&
			!(Number.isInteger(window.population) && window.population >= 0)
		) {
			fail(
				`audit window "${window.id}" must declare population as a non-negative integer (frozen) or null (derived)`,
			);
			continue;
		}
		byId.set(window.id, { ...window, members: [] });
	}

	const ordered = [...byId.values()].sort((a, b) => a.from.localeCompare(b.from));
	for (let index = 1; index < ordered.length; index += 1) {
		const previous = ordered[index - 1];
		const previousEnd = previous.to ?? '9999-12-31';
		if (ordered[index].from <= previousEnd) {
			fail(`audit windows "${previous.id}" and "${ordered[index].id}" overlap`);
		}
	}

	for (const entry of entries) {
		const number = Number(entry?.issue);
		const label = Number.isInteger(number) ? `#${number}` : 'an entry';
		const id = entry?.window;
		if (typeof id !== 'string' || id.trim() === '') {
			fail(`entry ${label} names no audit window`);
			continue;
		}
		const window = byId.get(id);
		if (!window) {
			fail(`entry ${label} names audit window "${id}", which is not declared`);
			continue;
		}
		const closedAt = typeof entry?.closedAt === 'string' ? entry.closedAt.slice(0, 10) : '';
		if (!isIsoDate(closedAt)) {
			fail(`entry ${label} has no ISO closedAt date, so its window cannot be checked`);
			continue;
		}
		if (closedAt < window.from || (window.to !== null && closedAt > window.to)) {
			fail(
				`entry ${label} was closed ${closedAt}, outside audit window "${window.id}" (${window.from}..${window.to ?? 'open'})`,
			);
			continue;
		}
		window.members.push(number);
	}

	for (const window of byId.values()) {
		if (window.population === null) continue;
		if (window.members.length !== window.population) {
			fail(
				`audit window "${window.id}" declares a frozen population of ${window.population}, but ${window.members.length} entries are attributed to it`,
			);
		}
	}

	return findings;
}

/**
 * Compare GitHub with the committed ledger.
 *
 * @param {{closed: Array<{number: number, title: string, closedAt: string}>, ledger: unknown, states: Map<number, object>}} input
 * @returns {Array<{rule: string, issue: number|null, message: string}>}
 */
export function compare({ closed, ledger, states }) {
	const findings = [];
	const entries = Array.isArray(ledger?.entries) ? ledger.entries : [];
	const byIssue = new Map(entries.map((entry) => [Number(entry?.issue), entry]));

	for (const issue of closed) {
		if (byIssue.has(issue.number)) continue; // the ledger records this closure
		if (hasClosureTrace(states.get(issue.number))) continue; // the closure left a trace
		findings.push({
			rule: 'R001',
			issue: issue.number,
			message:
				'closed with no ledger entry and no trace (no referenced commit, and no comment naming an artefact or recording a decision) — record the outcome before closing it',
		});
	}

	for (const entry of entries) {
		const number = Number(entry?.issue);
		if (!Number.isInteger(number)) continue;
		const state = states.get(number);
		if (!state) {
			findings.push({
				rule: 'R004',
				issue: number,
				message: 'the ledger records this issue, but GitHub could not read it',
			});
			continue;
		}
		if (entry.action === 'reopened' && state.state === 'CLOSED') {
			findings.push({
				rule: 'R002',
				issue: number,
				message:
					'the ledger records a reopen, but GitHub shows the issue closed — the recovery state does not match',
			});
		}
		if (entry.action === 'kept-closed' && state.state !== 'CLOSED') {
			findings.push({
				rule: 'R003',
				issue: number,
				message:
					'the ledger records a kept closure, but GitHub shows the issue open — the ledger must record the reopen and its reason',
			});
		}
	}

	findings.push(...checkWindows(ledger));
	findings.push(...detectMassClosure({ closed, states, byIssue }));

	return findings;
}

/**
 * How many issues may share one closing comment before the gate calls
 * it a mass operation.
 *
 * The 2026-10-31 sweep wrote the same comment on 124 issues. A mass
 * operation is not itself wrong — closing ten issues that ten merged
 * pull requests delivered is normal development work — but it needs a
 * per-issue record, and the release-branch wording is the specific
 * pattern the audit has to forbid.
 */
const MASS_CLOSURE_THRESHOLD = 5;

/**
 * Detect a mass closure that used the release-branch template.
 *
 * Issues the ledger records are exempt: the ledger IS the per-issue
 * record of decisions, and the offline gate refuses to accept the
 * template comment as that record's evidence.
 *
 * @param {{closed: Array<{number: number}>, states: Map<number, object>, byIssue: Map<number, unknown>}} input
 * @returns {Array<{rule: string, issue: number|null, message: string}>}
 */
export function detectMassClosure({ closed, states, byIssue }) {
	const clusters = new Map();
	for (const issue of closed) {
		if (byIssue.has(issue.number)) continue; // the ledger records this closure
		const comment = closingComment(states.get(issue.number));
		if (comment === null || !isSweepTemplate(comment)) continue;
		const key = comment.trim();
		if (!clusters.has(key)) clusters.set(key, []);
		clusters.get(key).push(issue.number);
	}
	const findings = [];
	for (const members of clusters.values()) {
		if (members.length < MASS_CLOSURE_THRESHOLD) continue;
		findings.push({
			rule: 'R006',
			issue: null,
			message:
				`${members.length} issues were closed with the same release-branch template comment and no per-issue record ` +
				`(#${members.slice(0, 10).join(', #')}${members.length > 10 ? ', …' : ''}) — record each issue separately before closing it`,
		});
	}
	return findings;
}

export async function main(argv) {
	const args = parseArgs(argv);
	const { value: ledger, error } = readLedger(resolve(process.cwd(), args.record));
	if (error) {
		process.stderr.write(`${error}\n`);
		return 2;
	}
	const since = args.since ?? auditWindowStart(ledger) ?? '2026-10-31';
	const entries = Array.isArray(ledger?.entries) ? ledger.entries : [];
	const tracked = entries.map((entry) => Number(entry?.issue)).filter(Number.isInteger);
	const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;

	let closed;
	let states;
	try {
		closed = await listClosedIssues({ repo: args.repo, since, token });
		const numbers = [...new Set([...tracked, ...closed.map((issue) => issue.number)])];
		states = await fetchIssueStates({ repo: args.repo, numbers, token });
	} catch (error) {
		process.stderr.write(
			`unusable input: the GitHub API could not be read (${error.message}). This is not a clean bill of health.\n`,
		);
		return 2;
	}

	const findings = compare({ closed, ledger, states });
	for (const finding of findings) {
		process.stderr.write(
			`${finding.rule} ${finding.issue === null ? '' : `#${finding.issue} `}${finding.message}\n`,
		);
	}
	process.stdout.write(
		`issue closure remote audit: ${tracked.length} tracked issue(s), ${closed.length} closure(s) still closed since ${since} in ${args.repo}\n`,
	);
	for (const line of summarizeWindows(ledger)) {
		process.stdout.write(`  window ${line}\n`);
	}
	process.stdout.write(
		`  closures with neither a ledger entry nor a trace: ${findings.filter((f) => f.rule === 'R001').length}\n`,
	);
	process.stdout.write(
		`  ledger / GitHub disagreements: ${findings.filter((f) => f.rule !== 'R001').length}\n`,
	);
	return findings.length > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exit(await main(process.argv));
}
