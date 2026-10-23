/**
 * The Issue #397 capture's own unit tests.
 *
 * The capture is a browser-side ASSERTION, so the parts that decide whether
 * the artefact may be written have to be testable without a browser: a
 * capture that can only fail inside Chromium is a capture nobody re-runs
 * when it breaks.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	EXPECTED_CASES,
	assertWebpOutputPath,
	evaluateObservation,
	harnessIndexHtml,
	resolveStaticTarget,
	screenshotBudgetVerdict,
} from './capture-a11y-image-alt.mjs';

test('a non-WebP output path is refused', () => {
	assert.throws(
		() => assertWebpOutputPath('docs/verification/a11y/image-alt.png'),
		/refusing to write a non-WebP/,
	);
	assert.throws(
		() => assertWebpOutputPath('../outside.webp'),
		/refusing to write outside the repository/,
	);
});

test('the budget verdict is computed from the byte count', () => {
	assert.equal(screenshotBudgetVerdict(1024).withinBudget, true);
	assert.equal(screenshotBudgetVerdict(1024 * 1024).withinBudget, false);
});

test('every expected state is on the screen, and the screen shows both sides', () => {
	const html = harnessIndexHtml();

	for (const entry of EXPECTED_CASES) {
		assert.ok(html.includes(`data-case="${entry.id}"`), `${entry.id} must be rendered`);
	}
	assert.ok(
		EXPECTED_CASES.some((entry) => entry.group === 'shipped contract'),
		'the screen must show a shipped state',
	);
	assert.ok(
		EXPECTED_CASES.some((entry) => entry.group === 'reproduced defect'),
		'the screen must show a reproduced defect',
	);
});

test('every expected state resolves to the verdict the screen claims', () => {
	const alts = {
		'pass-meaningful': 'A terminal window',
		'pass-decorative': '',
		'fail-empty-alt-without-mark': '',
		'fail-blank-alt': ' ',
	};
	const verdict = evaluateObservation({
		cases: EXPECTED_CASES.map((entry) => ({
			caseId: entry.id,
			hasAlt: entry.id !== 'fail-missing-alt',
			alt: alts[entry.id] ?? null,
			attributes:
				entry.id === 'pass-decorative'
					? [
							{ name: 'alt', kind: 'string', value: '' },
							{ name: 'aria-hidden', kind: 'string', value: 'true' },
						]
					: entry.id === 'fail-missing-alt'
						? []
						: [{ name: 'alt', kind: 'string', value: alts[entry.id] ?? '' }],
		})),
	});

	assert.equal(verdict.ok, true, verdict.failures.join('; '));
	assert.equal(verdict.rows.length, EXPECTED_CASES.length);
});

test('a state that is missing from the screen is a failure', () => {
	const verdict = evaluateObservation({ cases: [] });

	assert.equal(verdict.ok, false);
	assert.match(verdict.failures[0], /were not rendered/);
});

test('the static server refuses to escape its root', () => {
	const resolved = resolveStaticTarget('/tmp', '/../../etc/passwd');

	assert.notEqual(resolved.status, 200);
});
