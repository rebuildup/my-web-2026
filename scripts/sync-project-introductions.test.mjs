import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { SNAPSHOT_DIR, syncSource } from './sync-project-introductions.mjs';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const COMMITTED = join(SNAPSHOT_DIR, 'dotfiles.json');

function tempSnapshotDir() {
	const dir = mkdtempSync(join(tmpdir(), 'project-introduction-'));
	copyFileSync(COMMITTED, join(dir, 'dotfiles.json'));
	return dir;
}

function silent() {
	return { write() {} };
}

async function runAgainst(responseFactory) {
	const dir = tempSnapshotDir();
	const before = readFileSync(join(dir, 'dotfiles.json'));
	const exitCode = await syncSource({
		now: NOW,
		snapshotDir: dir,
		fetchImpl: async () => responseFactory(),
		stdout: silent(),
		stderr: silent(),
	});
	const after = readFileSync(join(dir, 'dotfiles.json'));
	rmSync(dir, { recursive: true, force: true });
	return { exitCode, before, after };
}

describe('sync transport failures', () => {
	it('leaves the committed snapshot byte-identical on a rate limit', async () => {
		const { exitCode, before, after } = await runAgainst(
			() => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
		);
		assert.equal(exitCode, 1);
		assert.deepEqual(after, before);
	});

	it('leaves the committed snapshot byte-identical on a 5xx or malformed body', async () => {
		for (const response of [
			() => new Response('{}', { status: 503 }),
			() => new Response('not json', { status: 200 }),
		]) {
			const { exitCode, before, after } = await runAgainst(response);
			assert.equal(exitCode, 1);
			assert.deepEqual(after, before);
		}
	});
});
