import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const COUNTS = 'test/fixtures/miro-source-counts-small.json';

const run = (fixture, extra = []) => {
	try {
		return execFileSync(
			'node',
			['scripts/validate-miro-import.mjs', fixture, `--counts=${COUNTS}`, ...extra],
			{ encoding: 'utf8' },
		);
	} catch (e) {
		return { code: e.status, out: `${e.stdout}${e.stderr}` };
	}
};

test('valid export passes schema, references and completeness floors', () => {
	const out = run('test/fixtures/miro-board-valid.json');
	assert.match(out, /OK — 2 items \(2 stickies\), 1 connectors, 1 frames/);
	assert.match(out, /floors/);
});

test('unresolved connector endpoint fails', () => {
	const out = run('test/fixtures/miro-board-bad-connector.json');
	assert.equal(out.code, 1);
	assert.match(out.out, /unresolved/);
});

test('self-consistent but truncated export fails the source-counts floor', () => {
	const out = run('test/fixtures/miro-board-truncated.json');
	assert.equal(out.code, 1);
	assert.match(out.out, /below the source-observed minimum/);
});

test('duplicate connector id fails', () => {
	const out = run('test/fixtures/miro-board-dup-ids.json');
	assert.equal(out.code, 1);
	assert.match(out.out, /duplicate connector id/);
});

test('unknown parentFrameId fails while a frame endpoint resolves', () => {
	const out = run('test/fixtures/miro-board-bad-frame.json');
	assert.equal(out.code, 1);
	assert.match(out.out, /references unknown frame/);
	assert.doesNotMatch(out.out, /unresolved/);
});

test('wrong board id fails the identity check', () => {
	const out = run('test/fixtures/miro-board-wrong-board.json');
	assert.equal(out.code, 1);
	assert.match(out.out, /does not match source-counts boardId/);
});

test('schema violation (additional property) fails', () => {
	const out = run('test/fixtures/miro-board-schema-violation.json');
	assert.equal(out.code, 1);
	assert.match(out.out, /schema \/items\/0/);
});

test('the shipped source-counts floors are the observed 571/583/1', async () => {
	const { readFileSync } = await import('node:fs');
	const counts = JSON.parse(readFileSync('quality/miro/source-counts.json', 'utf8'));
	assert.equal(counts.boardId, 'uXjVEZdqDp4=');
	assert.deepEqual(counts.minimums, { stickies: 571, connectors: 583, frames: 1 });
});
