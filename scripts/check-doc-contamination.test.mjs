import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * `check-doc-contamination.mjs` unit tests (Issue #1038).
 *
 * The gate exists because a shipped release carried three committed documents
 * with tool-serialisation fragments concatenated at EOF — invisible
 * to `tail` and to rendered review. The tests therefore cover BOTH
 * halves: the marker scanner itself, and the end-to-end "a committed
 * contaminated file fails the gate" path against an isolated git
 * fixture (the gate walks `git ls-files`, so a plain directory is not
 * enough — the fixture must be a real git repo).
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_SOURCE = readFileSync(resolve(HERE, 'check-doc-contamination.mjs'), 'utf8');

function makeFixture(files) {
	const dir = mkdtempSync(join(tmpdir(), 'doc-contamination-'));
	mkdirSync(join(dir, 'scripts'), { recursive: true });
	writeFileSync(join(dir, 'scripts', 'check-doc-contamination.mjs'), SCRIPT_SOURCE);
	for (const [relPath, content] of Object.entries(files)) {
		const abs = join(dir, relPath);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, content);
	}
	// `git ls-files` only reports tracked files, so the fixture stages
	// everything without committing (ls-files covers the index).
	execFileSync('git', ['init', '-q'], { cwd: dir });
	execFileSync('git', ['add', '-A'], { cwd: dir });
	return dir;
}

function runGate(dir, extraArgs = []) {
	return spawnSync('node', [join(dir, 'scripts', 'check-doc-contamination.mjs'), ...extraArgs], {
		cwd: dir,
		encoding: 'utf8',
	});
}

describe('check-doc-contamination', () => {
	it('passes a clean text tree', () => {
		const dir = makeFixture({
			'docs/a.md': '# clean\nordinary prose\n',
			'src/b.ts': 'export const x = 1;\n',
		});
		try {
			const res = runGate(dir);
			assert.equal(res.status, 0, res.stderr);
			assert.match(res.stdout, /clean/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('fails on each marker family, including EOF-concatenated fragments', () => {
		for (const marker of [
			'<' + '|' + 'end' + '_message' + '|' + '>',
			'end' + '_message',
			'message' + '_model',
			'content' + '_invoke_tool_json',
		]) {
			const dir = makeFixture({
				'docs/contaminated.md': `# title\nvisible text${marker}`,
			});
			try {
				const res = runGate(dir);
				assert.equal(res.status, 1, `marker ${JSON.stringify(marker)} should fail`);
				assert.match(res.stderr, /docs\/contaminated\.md/);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	it('does not flag prose that discusses the incident without the byte markers', () => {
		const dir = makeFixture({
			'docs/note.md':
				'# incident note\nTool serialisation fragments were stripped in commit 3965193c.\n',
		});
		try {
			const res = runGate(dir);
			assert.equal(res.status, 0, res.stderr);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('skips binary files even when they contain marker-like bytes', () => {
		const dir = makeFixture({
			'assets/blob.bin': Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('end' + '_message')]),
			'docs/ok.md': '# fine\n',
		});
		try {
			const res = runGate(dir);
			assert.equal(res.status, 0, res.stderr);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('writes a JSON report when --json is given', () => {
		const dir = makeFixture({
			'docs/bad.md': `text${'<' + '|' + 'message' + '_model'}`,
		});
		try {
			const out = join(dir, 'report.json');
			const res = runGate(dir, [`--json=${out}`]);
			assert.equal(res.status, 1);
			const report = JSON.parse(readFileSync(out, 'utf8'));
			// Overlapping markers may hit the same file more than once;
			// what matters is that the file is reported.
			assert.ok(report.hits.some((h) => h.relPath === 'docs/bad.md'));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
