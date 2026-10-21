import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	AGENTS_PATH,
	REHEARSAL_PATHS,
	RELEASE_PATH,
	RUNBOOK_PATH,
	assertNoSensitiveInText,
	findSensitiveInText,
	formatRollbackRehearsal,
	runRollbackRehearsal,
	validateRehearsal,
} from './_rollback-rehearsal.mjs';
import {
	PAGE_TEST_ID,
	PATH_TEST_ID,
	SCREENSHOT_BUDGET_BYTES,
	SCREENSHOT_MAX_WIDTH,
	SCREENSHOT_QUALITY_LADDER,
	assertWebpOutputPath,
	isLoopbackRequestUrl,
	parseArgs,
	promoteStagedCapture,
	renderRollbackRehearsalHtml,
	resolveStaticTarget,
	screenshotBudgetVerdict,
	stagedCapturePath,
} from './capture-rollback-rehearsal.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Tests for the offline rollback rehearsal (Issue #503).
 *
 * The rehearsal is a RECORD, not an action: it must never execute a
 * command, read a credential or make a request, and the artefact it
 * produces must be a WebP inside the committed-image budget. These tests
 * pin those invariants, plus the two properties that make the record
 * usable: the table validates, and the sensitive-value guard reports a
 * detector id and a line number without ever echoing the matched text.
 */
describe('rollback rehearsal — the record validates', () => {
	it('accepts the committed rehearsal table', () => {
		const validation = validateRehearsal(REHEARSAL_PATHS);
		assert.equal(validation.ok, true, JSON.stringify(validation.errors));
		assert.equal(validation.pathCount, REHEARSAL_PATHS.length);
	});

	it('rejects a table with no paths', () => {
		const validation = validateRehearsal([]);
		assert.equal(validation.ok, false);
		assert.ok(validation.errors.length > 0);
	});

	it('rejects a duplicated path id', () => {
		const [first, ...rest] = REHEARSAL_PATHS;
		const validation = validateRehearsal([first, first, ...rest]);
		assert.equal(validation.ok, false);
	});

	it('projects every failure class the runbook describes', () => {
		const result = runRollbackRehearsal();
		assert.equal(result.ok, true);
		assert.equal(result.summary.pathCount, 4);
		assert.ok(result.summary.stepCount > 0);
		assert.deepEqual(result.summary.failureClasses.sort(), [
			'failed-build',
			'failed-smoke',
			'post-deploy-regression',
		]);
	});
});

describe('rollback rehearsal — nothing is executed, read or requested', () => {
	it('records zero executed commands, requests and credential reads', () => {
		const { summary } = runRollbackRehearsal();
		assert.equal(summary.executedCommands, 0);
		assert.equal(summary.externalRequests, 0);
		assert.equal(summary.credentialsRead, 0);
	});

	it('marks every projected step as recorded rather than performed', () => {
		const result = runRollbackRehearsal();
		for (const path of result.paths) {
			for (const step of path.steps) {
				assert.equal(step.status, 'recorded');
			}
		}
	});

	it('names the runbook, the release guide and the agent contract it rehearses', () => {
		for (const relative of [RUNBOOK_PATH, RELEASE_PATH, AGENTS_PATH]) {
			assert.equal(existsSync(join(REPO_ROOT, relative)), true, relative);
		}
	});

	it('formats status-only lines that carry no fixture value', () => {
		const result = runRollbackRehearsal();
		const lines = formatRollbackRehearsal(result);
		assert.ok(lines.length > 0);
		for (const line of lines) {
			assert.equal(assertNoSensitiveInText(line).ok, true, line);
		}
	});
});

describe('rollback rehearsal — the sensitive-value guard', () => {
	it('reports a detector id and a line number, never the matched text', () => {
		const findings = findSensitiveInText('token=abcdefgh12345678');
		assert.equal(findings.length, 1);
		assert.equal(findings[0].detectorId, 'secret-assignment');
		assert.equal(findings[0].line, 1);
		assert.equal('text' in findings[0], false);
	});

	it('detects each guarded shape', () => {
		const cases = [
			['someone@example.com', 'email'],
			['Bearer AAAAAAAAAAAAAAAAAAAA', 'bearer-token'],
			['-----BEGIN RSA PRIVATE KEY-----', 'private-key'],
			['AKIAIOSFODNN7EXAMPLE', 'aws-access-key'],
		];
		for (const [text, detectorId] of cases) {
			const findings = findSensitiveInText(text);
			assert.equal(findings.length, 1, text);
			assert.equal(findings[0].detectorId, detectorId, text);
		}
	});

	it('passes clean text and reports the line of an offender', () => {
		assert.equal(
			assertNoSensitiveInText('the build failed; the operator restores the release').ok,
			true,
		);
		const findings = findSensitiveInText('first line\nsecond line\nAKIAIOSFODNN7EXAMPLE');
		assert.equal(findings[0].line, 3);
	});
});

describe('rollback rehearsal — the capture artefact', () => {
	it('refuses a non-WebP output path', () => {
		assert.throws(() => assertWebpOutputPath('docs/verification/ops/rollback-rehearsal.png'));
		assert.doesNotThrow(() =>
			assertWebpOutputPath('docs/verification/ops/rollback-rehearsal.webp'),
		);
	});

	it('keeps the width cap and the budget, and offers a descending quality ladder', () => {
		assert.equal(SCREENSHOT_MAX_WIDTH, 1600);
		assert.equal(SCREENSHOT_BUDGET_BYTES, 300 * 1024);
		assert.deepEqual(SCREENSHOT_QUALITY_LADDER, [80, 72, 64, 56]);
		for (let index = 1; index < SCREENSHOT_QUALITY_LADDER.length; index += 1) {
			assert.ok(SCREENSHOT_QUALITY_LADDER[index] < SCREENSHOT_QUALITY_LADDER[index - 1]);
		}
	});

	it('decides the budget verdict on the byte count', () => {
		assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES).withinBudget, true);
		assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES + 1).withinBudget, false);
	});

	it('renders one path card per rehearsed path', () => {
		const result = runRollbackRehearsal();
		const html = renderRollbackRehearsalHtml(result);
		assert.ok(html.includes(`data-testid="${PAGE_TEST_ID}"`));
		const cards = html.split(`data-testid="${PATH_TEST_ID}"`).length - 1;
		assert.equal(cards, result.summary.pathCount);
		assert.equal(assertNoSensitiveInText(html).ok, true);
	});

	it('serves the report page at the root instead of the directory', () => {
		const dir = mkdtempSync(join(tmpdir(), 'rollback-rehearsal-'));
		try {
			writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>');
			const root = resolveStaticTarget(dir, '/');
			assert.equal(root.status, 200);
			assert.equal(root.file, join(dir, 'index.html'));
			assert.equal(resolveStaticTarget(dir, '/missing.html').status, 404);
			assert.equal(resolveStaticTarget(dir, '/../escape').status, 403);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('stages a candidate away from the committed path and promotes it only on success', () => {
		const dir = mkdtempSync(join(tmpdir(), 'rollback-rehearsal-'));
		try {
			const screenshot = join(dir, 'rollback-rehearsal.webp');
			const staged = stagedCapturePath(screenshot, dir);
			assert.notEqual(staged, screenshot);
			mkdirSync(dirname(staged), { recursive: true });
			writeFileSync(staged, 'candidate');
			promoteStagedCapture({ staged, screenshot, repoRoot: dir });
			assert.equal(readFileSync(screenshot, 'utf8'), 'candidate');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('rollback rehearsal — the capture stays on the loopback host', () => {
	it('treats loopback URLs as local and everything else as outbound', () => {
		assert.equal(isLoopbackRequestUrl('http://127.0.0.1:51234/index.html'), true);
		assert.equal(isLoopbackRequestUrl('http://localhost:51234/index.html'), true);
		assert.equal(isLoopbackRequestUrl('https://api.github.com/repos'), false);
		assert.equal(isLoopbackRequestUrl('https://rebuildup.dev/'), false);
	});
});

describe('rollback rehearsal — the CLI contract', () => {
	it('defaults to the committed WebP path and rejects an unknown option', () => {
		const options = parseArgs([]);
		assert.equal(options.screenshot, 'docs/verification/ops/rollback-rehearsal.webp');
		assert.throws(() => parseArgs(['--unknown-option']));
	});

	it('reads the base options', () => {
		const options = parseArgs(['--width=1200', '--no-capture', '--json-out=.tmp/r.json']);
		assert.equal(options.width, 1200);
		assert.equal(options.capture, false);
		assert.equal(options.jsonOut, '.tmp/r.json');
	});
});
