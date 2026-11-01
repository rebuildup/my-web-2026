#!/usr/bin/env node
/**
 * Issue-closure remote audit (Issue #741).
 *
 * Usage:
 *   node scripts/check-issue-closure-remote.mjs --since=2026-10-31
 *   GITHUB_TOKEN=… node scripts/check-issue-closure-remote.mjs
 *
 * Why this exists
 * ---------------
 * `scripts/check-issue-closure.mjs` checks that the committed ledger is
 * honest. It cannot check that the ledger is COMPLETE — that needs to
 * know what GitHub actually closed. This script is the other half: it
 * asks GitHub which issues were closed in a window and reports every
 * closure the repository has no record of.
 *
 * It exists because of 2026-10-31, when 132 issues were closed in one
 * automated sweep with a single templated comment and no per-issue
 * evidence. A gate that only reads the repository would have stayed
 * green through that sweep, because the sweep wrote no repository record
 * at all.
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
 *   error → the step fails. An issue was closed with no ledger entry
 *           (R001), the ledger claims a recovery that did not happen
 *           (R002), or the ledger and GitHub disagree about whether a
 *           tracked issue is closed (R003).
 *   The API being unreachable is exit 2 (unusable input), never a clean
 *   bill of health: a registry outage must not read as "everything is
 *           accounted for".
 *
 * Properties that make the output safe to paste into a PR
 * ---------------------------------------------------------
 * Status-only: it prints issue numbers, titles (already public in the
 * repository), states and rule ids. It never prints an issue body, a
 * comment, a credential or a raw API error body.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_REPO = 'rebuildup/my-web-2026';
const DEFAULT_SINCE = '2026-10-01';
const API = 'https://api.github.com';

function parseArgs(argv) {
	const args = {
		repo: DEFAULT_REPO,
		since: DEFAULT_SINCE,
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

/**
 * List the issues closed on or after `since`.
 *
 * @param {{repo: string, since: string, token: string|null, fetchImpl?: typeof fetch}} options
 * @returns {Promise<Array<{number: number, title: string, closedAt: string}>>}
 */
export async function listClosedIssues({ repo, since, token = null, fetchImpl = fetch }) {
	const issues = [];
	for (let page = 1; page <= 10; page += 1) {
		const query = encodeURIComponent(`repo:${repo} is:issue closed:>=${since}`);
		const url = `${API}/search/issues?q=${query}&per_page=100&page=${page}`;
		const headers = {
			accept: 'application/vnd.github+json',
			'user-agent': 'my-web-2026-issue-closure-audit',
		};
		if (token) headers.authorization = `Bearer ${token}`;
		const response = await fetchImpl(url, { headers });
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
 * Compare GitHub's closed set with the committed ledger.
 *
 * @param {Array<{number: number, title: string, closedAt: string}>} closed
 * @param {unknown} ledger
 * @returns {Array<{rule: string, issue: number|null, message: string}>}
 */
export function compare(closed, ledger) {
	const findings = [];
	const entries = Array.isArray(ledger?.entries) ? ledger.entries : [];
	const byIssue = new Map(entries.map((entry) => [Number(entry?.issue), entry]));

	for (const issue of closed) {
		const entry = byIssue.get(issue.number);
		if (!entry) {
			findings.push({
				rule: 'R001',
				issue: issue.number,
				message: 'closed on GitHub with no entry in the issue-closure ledger',
			});
			continue;
		}
		if (entry.action === 'reopened' && issue.number && issue.closedAt) {
			findings.push({
				rule: 'R002',
				issue: issue.number,
				message:
					'the ledger records a reopen that GitHub does not show — the issue is still closed',
			});
		}
	}

	for (const entry of entries) {
		const number = Number(entry?.issue);
		if (!Number.isInteger(number)) continue;
		if (entry.action !== 'reopened') continue;
		const stillClosed = closed.find((issue) => issue.number === number);
		if (!stillClosed) {
			findings.push({
				rule: 'R003',
				issue: number,
				message:
					'the ledger records a reopen but the issue is not in the closed set — the recovery state does not match GitHub',
			});
		}
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
	const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
	let closed;
	try {
		closed = await listClosedIssues({ repo: args.repo, since: args.since, token });
	} catch (error) {
		process.stderr.write(
			`unusable input: the GitHub API could not be read (${error.message}). This is not a clean bill of health.\n`,
		);
		return 2;
	}
	const findings = compare(closed, ledger);
	for (const finding of findings) {
		process.stderr.write(
			`${finding.rule} ${finding.issue === null ? '' : `#${finding.issue} `}${finding.message}\n`,
		);
	}
	process.stdout.write(
		`issue closure remote audit: ${closed.length} issue(s) closed since ${args.since} in ${args.repo}\n`,
	);
	process.stdout.write(
		`  closed without a ledger entry: ${findings.filter((f) => f.rule === 'R001').length}\n`,
	);
	process.stdout.write(
		`  recovery state mismatches: ${findings.filter((f) => f.rule !== 'R001').length}\n`,
	);
	return findings.length > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exit(await main(process.argv));
}
