import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { acquireSyncLock, isTransientStatus, pushWithRetry } from './_sync-ops.mjs';

const dirs = [];
function lockPath() {
	const dir = mkdtempSync(join(tmpdir(), 'sync-ops-'));
	dirs.push(dir);
	return join(dir, 'x.lock');
}
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('acquireSyncLock', () => {
	it('grants the lock once and refuses a second live holder', () => {
		const path = lockPath();
		const first = acquireSyncLock(path, { label: 't' });
		assert.ok(first);
		assert.equal(acquireSyncLock(path, { label: 't' }), null);
		first.release();
		const third = acquireSyncLock(path, { label: 't' });
		assert.ok(third);
		third.release();
	});

	it('reclaims a lock whose pid is dead', () => {
		const path = lockPath();
		writeFileSync(
			path,
			`${JSON.stringify({ pid: 99999999, startedAt: new Date().toISOString() })}\n`,
		);
		const lock = acquireSyncLock(path, { label: 't' });
		assert.ok(lock, 'dead-pid lock must be reclaimed');
		lock.release();
	});

	it('reclaims a lock older than the stale window even with a live pid', () => {
		const path = lockPath();
		writeFileSync(
			path,
			`${JSON.stringify({
				pid: process.pid,
				startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
			})}\n`,
		);
		const lock = acquireSyncLock(path, { staleMs: 60_000, label: 't' });
		assert.ok(lock);
		lock.release();
	});

	it('lock file records pid and label', () => {
		const path = lockPath();
		const lock = acquireSyncLock(path, { label: 'my-sync' });
		const info = JSON.parse(readFileSync(path, 'utf8'));
		assert.equal(info.pid, process.pid);
		assert.equal(info.label, 'my-sync');
		lock.release();
	});
});

describe('isTransientStatus', () => {
	it('retries 429 and 5xx only', () => {
		assert.equal(isTransientStatus(429), true);
		assert.equal(isTransientStatus(500), true);
		assert.equal(isTransientStatus(503), true);
		assert.equal(isTransientStatus(413), false);
		assert.equal(isTransientStatus(401), false);
		assert.equal(isTransientStatus(200), false);
	});
});

describe('pushWithRetry', () => {
	const okRes = () => new Response('{}', { status: 200 });

	it('returns the first successful response without retrying', async () => {
		let calls = 0;
		const realFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			calls += 1;
			return new Response('{}', { status: 200 });
		};
		try {
			const res = await pushWithRetry(
				'https://x.test/',
				{ method: 'PUT' },
				{
					retries: 3,
					backoffMs: 1,
					sleep: async () => {},
				},
			);
			assert.equal(res.status, 200);
			assert.equal(calls, 1);
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it('throws immediately on a non-transient status', async () => {
		// A 413 must NOT be retried — the request itself is too large.
		let calls = 0;
		const realFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			calls += 1;
			return new Response('too large', { status: 413 });
		};
		try {
			const res = await pushWithRetry(
				'https://x.test/',
				{},
				{
					retries: 3,
					backoffMs: 1,
					sleep: async () => {},
				},
			);
			assert.equal(res.status, 413);
			assert.equal(calls, 1);
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it('retries transient statuses then throws the last error', async () => {
		let calls = 0;
		const realFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			calls += 1;
			return new Response('err', { status: 503 });
		};
		try {
			await assert.rejects(
				pushWithRetry(
					'https://x.test/',
					{},
					{
						retries: 2,
						backoffMs: 1,
						sleep: async () => {},
					},
				),
				/503/,
			);
			assert.equal(calls, 3); // initial + 2 retries
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it('retries a transient failure then succeeds', async () => {
		let calls = 0;
		const realFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			calls += 1;
			return calls === 1 ? new Response('err', { status: 502 }) : okRes();
		};
		try {
			const res = await pushWithRetry(
				'https://x.test/',
				{},
				{
					retries: 2,
					backoffMs: 1,
					sleep: async () => {},
				},
			);
			assert.equal(res.status, 200);
			assert.equal(calls, 2);
		} finally {
			globalThis.fetch = realFetch;
		}
	});
});
