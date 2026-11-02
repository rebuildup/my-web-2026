import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	auditWindowStart,
	checkWindows,
	closingComment,
	compare,
	fetchIssueStates,
	hasClosureTrace,
	isSweepTemplate,
	listClosedIssues,
	summarizeWindows,
} from './check-issue-closure-remote.mjs';

function fakeFetch(items) {
	return async (url) => {
		const page = Number(new URL(url).searchParams.get('page') ?? '1');
		const slice = page === 1 ? items : [];
		return {
			ok: true,
			status: 200,
			json: async () => ({ items: slice }),
		};
	};
}

/**
 * A GraphQL fetch that answers with one issue per requested number.
 *
 * @param {(number: number) => object} shape
 */
function fakeGraphql(shape) {
	const calls = [];
	const fetchImpl = async (url, init) => {
		const query = JSON.parse(init.body).query;
		calls.push(query);
		const numbers = [...query.matchAll(/issue\(number: (\d+)\)/g)].map((m) => Number(m[1]));
		const repository = {};
		for (const number of numbers) {
			const value = shape(number);
			if (value) repository[`i${number}`] = value;
		}
		return {
			ok: true,
			status: 200,
			json: async () => ({ data: { repository } }),
		};
	};
	fetchImpl.calls = calls;
	return fetchImpl;
}

function state(overrides = {}) {
	return {
		number: 1,
		state: 'CLOSED',
		closedAt: '2026-10-31T00:00:00Z',
		comments: [],
		referencedPullRequests: [],
		referencedCommits: [],
		...overrides,
	};
}

/**
 * @param {string} body
 * @param {string} [createdAt]
 */
function comment(body, createdAt = '2026-10-31T00:00:00Z') {
	return { body, createdAt };
}

/** The frozen 2026-10-31 window, with a population the test can trim. */
function frozenWindow(population = 1) {
	return {
		id: 'sweep-2026-10-31',
		from: '2026-10-31',
		to: '2026-10-31',
		population,
	};
}

/** The open-ended window every closure after the sweep is recorded in. */
function trackedWindow() {
	return {
		id: 'tracked',
		from: '2026-11-01',
		to: null,
		population: null,
	};
}

test('listClosedIssues skips pull requests and keeps issues', async () => {
	const fetchImpl = fakeFetch([
		{ number: 1, title: 'an issue', closed_at: '2026-10-31T00:00:00Z' },
		{ number: 2, title: 'a pull request', closed_at: '2026-10-31T00:00:00Z', pull_request: {} },
	]);
	const closed = await listClosedIssues({
		repo: 'rebuildup/my-web-2026',
		since: '2026-10-01',
		fetchImpl,
	});
	assert.equal(closed.length, 1);
	assert.equal(closed[0].number, 1);
});

test('listClosedIssues fails when the API answers with an error status', async () => {
	const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
	await assert.rejects(
		() => listClosedIssues({ repo: 'rebuildup/my-web-2026', since: '2026-10-01', fetchImpl }),
		/503/,
	);
});

test('fetchIssueStates reads the state and the closure trace of every issue', async () => {
	const fetchImpl = fakeGraphql((number) =>
		state({
			number,
			state: 'OPEN',
			comments: { nodes: [{ body: '対応 PR #740', createdAt: '2026-10-20T00:00:00Z' }] },
			timelineItems: {
				nodes: [
					{
						__typename: 'CrossReferencedEvent',
						source: { __typename: 'PullRequest', number: 740 },
					},
					{ __typename: 'ReferencedEvent', commit: { oid: 'abc1234' } },
				],
			},
		}),
	);
	const states = await fetchIssueStates({
		repo: 'rebuildup/my-web-2026',
		numbers: [740, 741],
		fetchImpl,
	});
	assert.equal(states.size, 2);
	const entry = states.get(740);
	assert.equal(entry.state, 'OPEN');
	assert.deepEqual(entry.referencedPullRequests, [740]);
	assert.deepEqual(entry.referencedCommits, ['abc1234']);
	assert.deepEqual(entry.comments, [{ body: '対応 PR #740', createdAt: '2026-10-20T00:00:00Z' }]);
});

test('fetchIssueStates fails closed when the API answers with an error status', async () => {
	const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });
	await assert.rejects(
		() => fetchIssueStates({ repo: 'rebuildup/my-web-2026', numbers: [1], fetchImpl }),
		/403/,
	);
});

test('fetchIssueStates fails closed when GraphQL reports an error', async () => {
	const fetchImpl = async () => ({
		ok: true,
		status: 200,
		json: async () => ({ errors: [{ message: 'bad field' }] }),
	});
	await assert.rejects(
		() => fetchIssueStates({ repo: 'rebuildup/my-web-2026', numbers: [1], fetchImpl }),
		/bad field/,
	);
});

test('the release-branch sweep wording is recognised as a template', () => {
	assert.equal(isSweepTemplate('回収完了。release-0-8-0統合完了（#679待機中）。'), true);
	assert.equal(isSweepTemplate('2026-10-31 の一括クローズ'), true);
	assert.equal(isSweepTemplate('対応 PR #740 を merge しました'), false);
});

test('a trace is a referenced commit or a comment that names an artefact or a decision', () => {
	assert.equal(hasClosureTrace(state({ referencedCommits: ['abc1234'] })), true);
	assert.equal(
		hasClosureTrace(state({ comments: [comment('対応 PR #740 を merge しました')] })),
		true,
	);
	assert.equal(hasClosureTrace(state({ comments: [comment('重複のためクローズ')] })), true);
});

test('a bare pull-request reference is not a trace', () => {
	// "the PR was merged" does not prove the issue's goal was reached
	// (docs/verification/backlog/closure-audit-2026-10-31.md §2).
	assert.equal(hasClosureTrace(state({ referencedPullRequests: [740] })), false);
});

test('the sweep template alone is not a trace', () => {
	assert.equal(
		hasClosureTrace(
			state({ comments: [comment('回収完了。release-0-8-0統合完了（#679待機中）。')] }),
		),
		false,
	);
	assert.equal(hasClosureTrace(state()), false);
});

test('the closing comment is the last one written before the closure', () => {
	const issue = state({
		closedAt: '2026-10-31T00:00:00Z',
		comments: [
			comment('解放的条件を記載', '2026-10-30T00:00:00Z'),
			comment('回収完了。release-0-8-0統合完了（#679待機中）。', '2026-10-31T00:00:00Z'),
			comment('復旧コメント', '2026-11-01T00:00:00Z'),
		],
	});
	assert.equal(closingComment(issue), '回収完了。release-0-8-0統合完了（#679待機中）。');
});

test('an issue closed without a comment has no closing comment', () => {
	assert.equal(closingComment(state({ comments: [] })), null);
});

test('a closed issue with no ledger entry and no trace is R001', () => {
	const findings = compare({
		closed: [{ number: 274, title: 'x', closedAt: '2026-10-31' }],
		ledger: { entries: [] },
		states: new Map([[274, state({ number: 274 })]]),
	});
	assert.equal(findings.length, 1);
	assert.equal(findings[0].rule, 'R001');
	assert.equal(findings[0].issue, 274);
});

test('a closed issue with a ledger entry produces no finding', () => {
	const findings = compare({
		closed: [{ number: 274, title: 'x', closedAt: '2026-10-31' }],
		ledger: {
			audit: { windows: [frozenWindow()] },
			entries: [
				{ issue: 274, closedAt: '2026-10-31', window: 'sweep-2026-10-31', action: 'kept-closed' },
			],
		},
		states: new Map([[274, state({ number: 274 })]]),
	});
	assert.deepEqual(findings, []);
});

test('a closed issue with a closure trace but no ledger entry produces no finding', () => {
	const findings = compare({
		closed: [{ number: 274, title: 'x', closedAt: '2026-10-31' }],
		ledger: { entries: [] },
		states: new Map([[274, state({ number: 274, referencedCommits: ['dc46190b'] })]]),
	});
	assert.deepEqual(findings, []);
});

test('a ledger record of a reopen that GitHub shows as closed is R002', () => {
	const findings = compare({
		closed: [{ number: 274, title: 'x', closedAt: '2026-10-31' }],
		ledger: { entries: [{ issue: 274, action: 'reopened' }] },
		states: new Map([[274, state({ number: 274 })]]),
	});
	assert.ok(findings.some((f) => f.rule === 'R002'));
});

test('a ledger record of a kept closure that GitHub shows as open is R003', () => {
	const findings = compare({
		closed: [],
		ledger: { entries: [{ issue: 274, action: 'kept-closed' }] },
		states: new Map([[274, state({ number: 274, state: 'OPEN' })]]),
	});
	assert.ok(findings.some((f) => f.rule === 'R003'));
});

test('a ledger record GitHub cannot read is R004', () => {
	const findings = compare({
		closed: [],
		ledger: { entries: [{ issue: 274, action: 'reopened' }] },
		states: new Map(),
	});
	assert.ok(findings.some((f) => f.rule === 'R004'));
});

test('recording a new close in the derived window is not R005 (Issue #815)', () => {
	// The defect this pins: the ledger's population used to be ONE frozen
	// number compared with entries.length, so adding a genuine close turned
	// the gate red. A derived window has no frozen count to break.
	const findings = checkWindows({
		audit: { windows: [frozenWindow(1), trackedWindow()] },
		entries: [
			{ issue: 274, closedAt: '2026-10-31', window: 'sweep-2026-10-31' },
			{ issue: 808, closedAt: '2026-11-02', window: 'tracked' },
		],
	});
	assert.deepEqual(findings, []);
});

test('a frozen window must carry exactly its declared population', () => {
	const ledger = {
		audit: { windows: [frozenWindow(132), trackedWindow()] },
		entries: [{ issue: 274, closedAt: '2026-10-31', window: 'sweep-2026-10-31' }],
	};
	const findings = checkWindows(ledger);
	assert.equal(findings.length, 1);
	assert.equal(findings[0].rule, 'R005');
	assert.match(findings[0].message, /frozen population of 132/);
});

test('an entry closed outside its window date range is R005', () => {
	const findings = checkWindows({
		audit: { windows: [frozenWindow(1), trackedWindow()] },
		entries: [
			{ issue: 274, closedAt: '2026-10-31', window: 'sweep-2026-10-31' },
			// A 2026-10-31 close cannot claim the post-sweep window.
			{ issue: 275, closedAt: '2026-10-31', window: 'tracked' },
		],
	});
	assert.equal(findings.length, 1);
	assert.equal(findings[0].rule, 'R005');
	assert.match(findings[0].message, /#275 was closed 2026-10-31, outside audit window "tracked"/);
});

test('an entry that names no window, or an undeclared one, is R005', () => {
	const unnamed = checkWindows({
		audit: { windows: [{ id: 'w', from: '2026-10-31', to: null, population: null }] },
		entries: [{ issue: 274, closedAt: '2026-10-31' }],
	});
	assert.equal(unnamed.length, 1);
	assert.match(unnamed[0].message, /#274 names no audit window/);

	const undeclared = checkWindows({
		audit: { windows: [{ id: 'w', from: '2026-10-31', to: null, population: null }] },
		entries: [{ issue: 274, closedAt: '2026-10-31', window: 'nowhere' }],
	});
	assert.equal(undeclared.length, 1);
	assert.match(undeclared[0].message, /#274 names audit window "nowhere", which is not declared/);
});

test('overlapping windows are R005 because attribution would be ambiguous', () => {
	const findings = checkWindows({
		audit: {
			windows: [
				{ id: 'a', from: '2026-10-31', to: '2026-11-05', population: null },
				{ id: 'b', from: '2026-11-01', to: null, population: null },
			],
		},
		entries: [],
	});
	assert.equal(findings.length, 1);
	assert.match(findings[0].message, /overlap/);
});

test('a ledger with entries but no declared window is R005', () => {
	const findings = checkWindows({
		entries: [{ issue: 274, closedAt: '2026-10-31', window: 'sweep-2026-10-31' }],
	});
	assert.equal(findings.length, 1);
	assert.match(findings[0].message, /declares no audit window/);
});

test('the derived window has no count assertion, and the summary names it', () => {
	const ledger = {
		audit: { windows: [frozenWindow(2), trackedWindow()] },
		entries: [
			{ issue: 274, closedAt: '2026-10-31', window: 'sweep-2026-10-31' },
			{ issue: 275, closedAt: '2026-10-31', window: 'sweep-2026-10-31' },
			{ issue: 808, closedAt: '2026-11-02', window: 'tracked' },
			{ issue: 809, closedAt: '2026-11-03', window: 'tracked' },
		],
	};
	assert.deepEqual(checkWindows(ledger), []);
	assert.deepEqual(summarizeWindows(ledger), [
		'sweep-2026-10-31: 2 recorded (frozen population 2)',
		'tracked: 2 recorded (population derived from entries)',
	]);
});

test('the audit window starts at the earliest declared window', () => {
	assert.equal(
		auditWindowStart({ audit: { windows: [trackedWindow(), frozenWindow(1)] } }),
		'2026-10-31',
	);
	// A ledger written before windows existed still has a start date.
	assert.equal(auditWindowStart({ audit: { closedAt: '2026-10-01' } }), '2026-10-01');
	assert.equal(auditWindowStart({}), null);
});

test('a mass closure that used the release-branch template is R006', () => {
	const template = '回収完了。release-0-8-0統合完了（#679待機中）。';
	const numbers = [801, 802, 803, 804, 805];
	const findings = compare({
		closed: numbers.map((number) => ({ number, title: 'x', closedAt: '2026-10-31' })),
		ledger: { entries: [] },
		states: new Map(
			numbers.map((number) => [
				number,
				state({ number, comments: [comment(template)], referencedCommits: ['abc1234'] }),
			]),
		),
	});
	assert.equal(findings.filter((f) => f.rule === 'R006').length, 1);
});

test('a mass closure the ledger records issue by issue is not R006', () => {
	const template = '回収完了。release-0-8-0統合完了（#679待機中）。';
	const numbers = [801, 802, 803, 804, 805];
	const findings = compare({
		closed: numbers.map((number) => ({ number, title: 'x', closedAt: '2026-10-31' })),
		ledger: {
			entries: numbers.map((number) => ({ issue: number, action: 'kept-closed' })),
		},
		states: new Map(
			numbers.map((number) => [
				number,
				state({ number, comments: [comment(template)], referencedCommits: ['abc1234'] }),
			]),
		),
	});
	assert.equal(findings.filter((f) => f.rule === 'R006').length, 0);
});

test('a small group sharing the template is not R006', () => {
	const template = '回収完了。release-0-8-0統合完了（#679待機中）。';
	const numbers = [801, 802];
	const findings = compare({
		closed: numbers.map((number) => ({ number, title: 'x', closedAt: '2026-10-31' })),
		ledger: { entries: [] },
		states: new Map(
			numbers.map((number) => [
				number,
				state({ number, comments: [comment(template)], referencedCommits: ['abc1234'] }),
			]),
		),
	});
	assert.equal(findings.filter((f) => f.rule === 'R006').length, 0);
});
