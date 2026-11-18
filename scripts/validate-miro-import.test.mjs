import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const run = (f) => {
	try {
		return execFileSync('node', ['scripts/validate-miro-import.mjs', f], { encoding: 'utf8' });
	} catch (e) {
		return { code: e.status, out: `${e.stdout}${e.stderr}` };
	}
};

test('valid export passes', () => {
	const out = run('test/fixtures/miro-board-valid.json');
	assert.match(out, /OK — 2 items, 1 connectors, 1 frames/);
});

test('unresolved connector endpoint fails', () => {
	const out = run('test/fixtures/miro-board-bad-connector.json');
	assert.equal(out.code, 1);
	assert.match(out.out, /unresolved/);
});
