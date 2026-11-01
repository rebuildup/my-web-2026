import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	compare,
	fetchIssueStates,
	hasClosureTrace,
	isSweepTemplate,
	listClosedIssues,
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
			comments: { nodes: [{ body: '対応 PR #740' }] },
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
	assert.deepEqual(entry.comments, ['対応 PR #740']);
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

test('a trace is a referenced commit, a referenced pull request or a specific comment', () => {
	assert.equal(hasClosureTrace(state({ referencedCommits: ['abc1234'] })), true);
	assert.equal(hasClosureTrace(state({ referencedPullRequests: [740] })), true);
	assert.equal(hasClosureTrace(state({ comments: ['対応 PR #740 を merge しました'] })), true);
	assert.equal(hasClosureTrace(state({ comments: ['重複のためクローズ'] })), true);
});

test('the sweep template alone is not a trace', () => {
	assert.equal(
		hasClosureTrace(state({ comments: ['回収完了。release-0-8-0統合完了（#679待機中）。'] })),
		false,
	);
	assert.equal(hasClosureTrace(state()), false);
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
		ledger: { entries: [{ issue: 274, action: 'kept-closed' }] },
		states: new Map([[274, state({ number: 274 })]]),
	});
	assert.deepEqual(findings, []);
});

test('a closed issue with a closure trace but no ledger entry produces no finding', () => {
	const findings = compare({
		closed: [{ number: 274, title: 'x', closedAt: '2026-10-31' }],
		ledger: { entries: [] },
		states: new Map([[274, state({ number: 274, referencedPullRequests: [281] })]]),
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

test('a ledger population that does not match its entries is R005', () => {
	const findings = compare({
		closed: [],
		ledger: { audit: { population: 132 }, entries: [] },
		states: new Map(),
	});
	assert.ok(findings.some((f) => f.rule === 'R005'));
});
