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
 *      entry (a recorded decision) OR evidence attached to the closure
 *      itself — a commit that referenced the issue, a pull request that
 *      delivered it, or a comment that names the artefact. A closure
 *      with none of those is exactly the 2026-10-31 shape: the issue
 *      disappeared from the backlog with nothing a reader could open.
 *
 * The window
 * ----------
 * The window starts at the ledger's own audited date
 * (`audit.closedAt`, 2026-10-31) by default, because that is the
 * population the ledger claims to cover; the history before it is out
 * of the audit's scope. `--since=` overrides it. A closure outside the
 * window is not an audit finding: closing an issue is normal development
 * work, and the gate is not a licence system.
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
 *           entry nor evidence (R001), the ledger and GitHub disagree
 *           about a tracked issue's state (R002 / R003), a ledger entry
 *           cannot be read (R004), or the ledger's own population count
 *           does not match its entries (R005).
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
 * @returns {Promise<Map<number, {number: number, state: string, closedAt: string|null, comments: string[], referencedPullRequests: number[], referencedCommits: string[]}>>}
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
  comments(last: 5) { nodes { body } }
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
				comments: (value.comments?.nodes ?? []).map((node) => node?.body ?? ''),
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
 *   - a pull request that referenced the issue,
 *   - a comment that names an artefact (a pull request, a commit, a URL)
 *     or that records an explicit decision (a hold, a rejection, a
 *     duplicate, a deferral).
 *
 * The release-branch template is NOT a trace: it states that a branch
 * was integrated, not that this issue's own goal was reached.
 *
 * @param {{comments: string[], referencedPullRequests: number[], referencedCommits: string[]}|undefined} issue
 * @returns {boolean}
 */
export function hasClosureTrace(issue) {
	if (!issue) return false;
	if (issue.referencedCommits.length > 0) return true;
	if (issue.referencedPullRequests.length > 0) return true;
	return issue.comments.some(
		(body) =>
			typeof body === 'string' &&
			body.trim() !== '' &&
			!isSweepTemplate(body) &&
			(ARTEFACT_PATTERN.test(body) || DECISION_PATTERN.test(body)),
	);
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
				'closed with no ledger entry and no trace (no referenced commit, no referenced pull request, no comment naming an artefact or recording a decision)',
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

	const population = Number(ledger?.audit?.population);
	if (Number.isInteger(population) && population !== entries.length) {
		findings.push({
			rule: 'R005',
			issue: null,
			message: `the ledger declares an audited population of ${population}, but it carries ${entries.length} entries`,
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
	const since = args.since ?? ledger?.audit?.closedAt ?? '2026-10-31';
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
