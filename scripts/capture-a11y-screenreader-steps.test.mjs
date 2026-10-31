/**
 * The Issue #402 capture's own unit tests.
 *
 * The capture renders the record sheet of the screen-reader ledger. The
 * dangerous failure mode is not a broken picture: it is a picture that
 * looks like a screen-reader result. So the tests below pin the two
 * halves of the sheet apart — the machine-filled columns carry the
 * ledger's text, and the person-filled columns stay empty.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	HUMAN_COLUMNS,
	NOT_ENTERED,
	cellValue,
	renderSheetHtml,
	screenshotBudgetVerdict,
	sheetHeader,
	sheetRows,
} from './capture-a11y-screenreader-steps.mjs';
import { LEDGER_PATH, summarizeLedger } from './check-a11y-screenreader-steps.mjs';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

/** The committed ledger. */
const LEDGER = JSON.parse(readFileSync(join(REPO_ROOT, LEDGER_PATH), 'utf8'));

/** The sheet of the committed ledger. */
function sheet() {
	return renderSheetHtml(LEDGER, summarizeLedger(LEDGER), []);
}

test('the sheet has one row per step', () => {
	assert.equal(sheetRows(LEDGER).length, LEDGER.steps.length);
});

test('an empty observation cell shows the not-entered marker', () => {
	assert.equal(cellValue({ observedAnnounce: null }, 'observedAnnounce'), NOT_ENTERED);
	assert.equal(cellValue({ performer: '' }, 'performer'), NOT_ENTERED);
	assert.equal(cellValue({ performedAt: '   ' }, 'performedAt'), NOT_ENTERED);
	assert.equal(
		cellValue({ observedAnnounce: '読み上げられた' }, 'observedAnnounce'),
		'読み上げられた',
	);
});

test('the person-filled columns are empty while no review has been performed', () => {
	for (const row of sheetRows(LEDGER)) {
		for (const column of HUMAN_COLUMNS) {
			if (column === 'result') continue;
			assert.equal(row[column], NOT_ENTERED, `${row.id} must not show a ${column}`);
		}
	}
});

test('the sheet never shows an announcement the ledger does not carry', () => {
	const html = sheet();
	for (const step of LEDGER.steps) {
		assert.ok(html.includes(step.expectedAnnounce), `${step.id} lost its expected announcement`);
		assert.ok(
			!html.includes(`${step.operation}</div>`),
			`${step.id} must not render its operation twice`,
		);
	}
});

test('the sheet says that no review has been performed', () => {
	const header = sheetHeader(LEDGER, summarizeLedger(LEDGER), []);
	assert.ok(header.some((line) => line.includes('not performed')));
	assert.ok(header.some((line) => line.includes('no review has been performed')));
});

test('the sheet escapes the values it prints', () => {
	const html = renderSheetHtml(
		{
			...LEDGER,
			steps: [
				{
					...LEDGER.steps[0],
					operation: '<script>alert(1)</script>',
				},
			],
		},
		summarizeLedger(LEDGER),
		[],
	);
	assert.ok(!html.includes('<script>alert(1)</script>'));
	assert.ok(html.includes('&lt;script&gt;'));
});

test('the capture refuses an output path that is not WebP', () => {
	let failed = false;
	try {
		execFileSync(
			process.execPath,
			[
				'scripts/capture-a11y-screenreader-steps.mjs',
				'--screenshot=docs/verification/a11y/screenreader-steps.png',
			],
			{ cwd: REPO_ROOT, stdio: 'pipe' },
		);
	} catch (error) {
		failed = true;
		assert.match(String(error.stderr), /refusing to write/);
	}
	assert.equal(failed, true, 'the capture must refuse a non-WebP destination');
});

test('the capture reports whether the artefact fits the budget', () => {
	assert.equal(screenshotBudgetVerdict(100 * 1024).withinBudget, true);
	assert.equal(screenshotBudgetVerdict(500 * 1024).withinBudget, false);
	assert.equal(screenshotBudgetVerdict(500 * 1024).kb, 500);
});
