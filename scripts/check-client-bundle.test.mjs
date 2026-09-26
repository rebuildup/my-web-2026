import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

const checker = resolve('scripts/check-client-bundle.mjs');

test('fails when the client output contains no inspectable assets', async (t) => {
	const emptyOutput = await mkdtemp(resolve(tmpdir(), 'my-web-client-output-'));
	t.after(() => rm(emptyOutput, { recursive: true, force: true }));

	const result = spawnSync(process.execPath, [checker, emptyOutput], {
		encoding: 'utf8',
	});

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Client output contains no inspectable assets/);
});
