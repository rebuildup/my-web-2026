import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	ALLOWED_RAW_COLORS,
	PALETTE_OWNER,
	evaluateRawColors,
	findRawColors,
	isRawColorValue,
	renderReport,
	scanSource,
} from './check-raw-color.mjs';

/**
 * `check-raw-color.mjs` unit tests (Issue #764).
 *
 * The gate exists because Issue #764's acceptance criteria include
 * "raw color / hardcoded token の直書きが gate で検出される". A gate
 * that only runs on the current tree is untested the moment the tree
 * is clean, so these tests drive it with fixture trees: the detection
 * rules, the allowlist arithmetic and the exit code are all asserted
 * without depending on what `src/` happens to contain today.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_SOURCE = readFileSync(resolve(HERE, 'check-raw-color.mjs'), 'utf8');

/**
 * Build an isolated `<repo>/src/...` tree and run the gate there.
 * `files` maps repo-relative paths to their contents.
 */
function runGate(files) {
	const repo = mkdtempSync(join(tmpdir(), 'check-raw-color-'));
	try {
		const scriptsDir = join(repo, 'scripts');
		mkdirSync(scriptsDir, { recursive: true });
		writeFileSync(join(scriptsDir, 'check-raw-color.mjs'), SCRIPT_SOURCE);
		for (const [path, content] of Object.entries(files)) {
			const target = join(repo, path);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, content);
		}
		try {
			const stdout = execFileSync(process.execPath, [join(scriptsDir, 'check-raw-color.mjs')], {
				cwd: repo,
				encoding: 'utf8',
				stdio: 'pipe',
			});
			return { code: 0, stdout };
		} catch (error) {
			return {
				code: error.status ?? 1,
				stdout: `${error.stdout ?? ''}`,
				stderr: `${error.stderr ?? ''}`,
			};
		}
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
}

/* ------------------------------------------------------------------ *
 * detection
 * ------------------------------------------------------------------ */

describe('isRawColorValue', () => {
	it('accepts a bare hex colour in any shipped width', () => {
		for (const value of ['#fff', '#ffff', '#0f172a', '#0f172a80']) {
			assert.equal(isRawColorValue(value), true, value);
		}
	});

	it('accepts a colour function with a numeric first argument', () => {
		assert.equal(isRawColorValue('rgba(0, 0, 0, 0.45)'), true);
		assert.equal(isRawColorValue('hsl(210 40% 20%)'), true);
		assert.equal(isRawColorValue('oklch(0.6 0.1 200)'), true);
	});

	it('accepts a hex inside a larger CSS value', () => {
		assert.equal(isRawColorValue('1px solid #0f172a'), true);
	});

	it('rejects an issue reference', () => {
		assert.equal(isRawColorValue('see Issue #433 for the rule'), false);
		assert.equal(isRawColorValue('(Issue #764): the gate'), false);
	});

	it('rejects prose that merely mentions a hex', () => {
		assert.equal(
			isRawColorValue(
				'the measured light steps were #ffffff and #f8fafc on the canvas, which is recorded in colors.md',
			),
			false,
		);
	});

	it('rejects a Japanese sentence that quotes hex colours', () => {
		assert.equal(isRawColorValue('#ffffff / #f8fafc / #0369a1 / #047857 を適用した'), false);
	});

	it('rejects token paths and named CSS values', () => {
		for (const value of ['surface.canvas', 'transparent', 'currentColor', 'none', '']) {
			assert.equal(isRawColorValue(value), false, value);
		}
	});
});

describe('findRawColors', () => {
	it('reports the line and column of each literal', () => {
		const source = ["const a = 'text.default';", "const b = '#0ea5e9';"].join('\n');
		assert.deepEqual(findRawColors(source), [{ line: 2, column: 10, literal: '#0ea5e9' }]);
	});

	it('skips comment lines so a documented example is not a decision', () => {
		const source = ['// color: "#0ea5e9"', ' * background: #ffffff', 'const x = 1;'].join('\n');
		assert.deepEqual(findRawColors(source), []);
	});

	it('finds a colour inside a JSX attribute', () => {
		const source = '<path fill="#ffd627" d="M0 0" />';
		assert.deepEqual(findRawColors(source), [{ line: 1, column: 11, literal: '#ffd627' }]);
	});
});

/* ------------------------------------------------------------------ *
 * verdict
 * ------------------------------------------------------------------ */

describe('evaluateRawColors', () => {
	const allowlist = [{ file: 'src/a.tsx', literal: '#fff', max: 1, reason: 'brand asset' }];

	it('passes a finding the allowlist covers', () => {
		const verdict = evaluateRawColors(
			[{ file: 'src/a.tsx', literal: '#fff', line: 1, column: 0 }],
			allowlist,
		);
		assert.deepEqual(verdict.violations, []);
		assert.deepEqual(verdict.stale, []);
		assert.equal(verdict.allowed.length, 1);
	});

	it('fails a finding with no allowlist entry', () => {
		const verdict = evaluateRawColors(
			[{ file: 'src/b.tsx', literal: '#000', line: 1, column: 0 }],
			allowlist,
		);
		assert.equal(verdict.violations.length, 1);
		assert.equal(verdict.violations[0].file, 'src/b.tsx');
	});

	it('fails a second occurrence beyond the permitted count', () => {
		const verdict = evaluateRawColors(
			[
				{ file: 'src/a.tsx', literal: '#fff', line: 1, column: 0 },
				{ file: 'src/a.tsx', literal: '#fff', line: 2, column: 0 },
			],
			allowlist,
		);
		assert.equal(verdict.violations.length, 1);
		assert.match(verdict.violations[0].reason, /permits 1, found 2/);
	});

	it('reports an unmatched allowlist entry as stale', () => {
		const verdict = evaluateRawColors([], allowlist);
		assert.equal(verdict.stale.length, 1);
	});
});

describe('renderReport', () => {
	it('states the scanned count and a clean verdict', () => {
		const report = renderReport({
			filesScanned: 3,
			...evaluateRawColors([]),
		});
		assert.match(report, /3 source file\(s\) scanned/);
		assert.match(report, /violations: none/);
	});

	it('names the file and literal, not the source line', () => {
		const report = renderReport({
			filesScanned: 1,
			...evaluateRawColors([{ file: 'src/b.tsx', literal: '#123456', line: 9, column: 4 }]),
		});
		assert.match(report, /src\/b\.tsx — "#123456"/);
		assert.doesNotMatch(report, /line 9/);
	});
});

/* ------------------------------------------------------------------ *
 * the real tree and the allowlist
 * ------------------------------------------------------------------ */

describe('the shipped tree', () => {
	it('has no raw colour outside the palette owner and the allowlist', () => {
		const scanned = scanSource();
		const verdict = evaluateRawColors(scanned.findings);
		assert.deepEqual(verdict.violations, []);
		assert.deepEqual(verdict.stale, []);
	});

	it('exempts the palette owner by path, not by directory', () => {
		assert.equal(PALETTE_OWNER, 'src/editorial/tokens.ts');
		const scanned = scanSource();
		assert.equal(
			scanned.findings.some((finding) => finding.file === PALETTE_OWNER),
			false,
		);
	});

	it('keeps every allowlist entry justified', () => {
		for (const entry of ALLOWED_RAW_COLORS) {
			assert.ok(entry.reason.length > 40, `${entry.file} ${entry.literal} needs a reason`);
			assert.ok(entry.max >= 1, `${entry.file} ${entry.literal} needs a count`);
		}
	});
});

/* ------------------------------------------------------------------ *
 * exit codes
 * ------------------------------------------------------------------ */

describe('the gate process', () => {
	it('exits 0 on a clean tree', () => {
		const result = runGate({
			'src/clean.tsx': "const x = css({ color: 'text.default' });\n",
		});
		assert.equal(result.code, 0, result.stdout + (result.stderr ?? ''));
	});

	it('exits 1 on a raw colour', () => {
		const result = runGate({
			'src/dirty.tsx': "const x = css({ color: '#0ea5e9' });\n",
		});
		assert.equal(result.code, 1);
		assert.match(result.stdout, /dirty\.tsx/);
	});

	it('does not flag a test or story file', () => {
		const result = runGate({
			'src/a.test.ts': "assert.equal(parse('#ff0000'), true);\n",
			'src/a.stories.tsx': "export const A = () => <div style={{ color: '#ff0000' }} />;\n",
		});
		assert.equal(result.code, 0, result.stdout + (result.stderr ?? ''));
	});

	it('exits 2 when there is no source tree', () => {
		const repo = mkdtempSync(join(tmpdir(), 'check-raw-color-empty-'));
		try {
			const scriptsDir = join(repo, 'scripts');
			mkdirSync(scriptsDir, { recursive: true });
			writeFileSync(join(scriptsDir, 'check-raw-color.mjs'), SCRIPT_SOURCE);
			let code = 0;
			try {
				execFileSync(process.execPath, [join(scriptsDir, 'check-raw-color.mjs')], {
					cwd: repo,
					stdio: 'pipe',
				});
			} catch (error) {
				code = error.status ?? 1;
			}
			assert.equal(code, 2);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});
});
