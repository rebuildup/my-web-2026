import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compare, listClosedIssues } from './check-issue-closure-remote.mjs';

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

test('a closed issue with no ledger entry is R001', () => {
	const findings = compare([{ number: 274, title: 'x', closedAt: '2026-10-31' }], { entries: [] });
	assert.equal(findings.length, 1);
	assert.equal(findings[0].rule, 'R001');
});

test('a closed issue with a ledger entry produces no finding', () => {
	const findings = compare([{ number: 274, title: 'x', closedAt: '2026-10-31' }], {
		entries: [{ issue: 274, action: 'kept-closed' }],
	});
	assert.deepEqual(findings, []);
});

test('a ledger record of a reopen that GitHub does not show is R002', () => {
	const findings = compare([{ number: 274, title: 'x', closedAt: '2026-10-31' }], {
		entries: [{ issue: 274, action: 'reopened' }],
	});
	assert.ok(findings.some((f) => f.rule === 'R002'));
});

test('a ledger record of a reopen for an issue GitHub does not list as closed is R003', () => {
	const findings = compare([], { entries: [{ issue: 274, action: 'reopened' }] });
	assert.ok(findings.some((f) => f.rule === 'R003'));
});
