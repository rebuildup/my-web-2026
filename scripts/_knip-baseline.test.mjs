#!/usr/bin/env node
/**
 * Tests for the knip baseline contract (Issue #733, V-6).
 *
 * The baseline is recorded debt. These tests pin the two rules that make
 * it a debt rather than a budget nobody decided:
 *
 * 1. a baseline without a usable ceiling (and a stated reason for it) is
 *    not a valid record, and
 * 2. an update may shrink the record but may not grow it past the
 *    ceiling.
 *
 * The CLI-level consequences live in `scripts/check-knip.test.mjs`; this
 * file pins the decision logic itself, without touching the repository's
 * own baseline.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	BASELINE_SCHEMA,
	DEFAULT_CEILING_RATIONALE,
	baselineDocument,
	baselineViolations,
	planBaselineUpdate,
} from './_knip-baseline.mjs';

const sound = {
	_schema: BASELINE_SCHEMA,
	ceiling: 2,
	ceiling_rationale: 'the debt recorded for this repository',
	findings: ['exports src/a.ts b'],
};

test('a baseline with a ceiling and a stated reason is sound', () => {
	assert.deepEqual(baselineViolations(sound), []);
});

test('a baseline without a ceiling is unbounded debt', () => {
	const violations = baselineViolations({ ...sound, ceiling: undefined });
	assert.equal(violations.length, 1);
	assert.match(violations[0], /no usable `ceiling`/);
});

test('a baseline without a stated reason is not a decision', () => {
	const violations = baselineViolations({ ...sound, ceiling_rationale: '  ' });
	assert.equal(violations.length, 1);
	assert.match(violations[0], /no `ceiling_rationale`/);
});

test('a baseline that grew past its ceiling is refused', () => {
	const violations = baselineViolations({ ...sound, findings: ['a', 'b', 'c'] });
	assert.equal(violations.length, 1);
	assert.match(violations[0], /records 3 findings, which is more than its ceiling of 2/);
});

test('an update may shrink the recorded debt and keeps the ceiling', () => {
	const plan = planBaselineUpdate({ ...sound, findings: ['a', 'b'] }, ['a']);
	assert.equal(plan.allowed, true);
	assert.equal(plan.ceiling, 2, 'the ceiling is read, never raised by an update');
	assert.equal(plan.rationale, sound.ceiling_rationale);
});

test('an update may not grow the recorded debt past the ceiling', () => {
	const plan = planBaselineUpdate(sound, ['a', 'b', 'c']);
	assert.equal(plan.allowed, false);
	assert.equal(plan.ceiling, 2);
	assert.match(plan.reason, /more than the recorded ceiling of 2/);
	assert.match(plan.reason, /raise the ceiling .* by hand/);
});

test('a baseline written before the ceiling rule migrates to the current debt', () => {
	const plan = planBaselineUpdate({ _schema: 1, findings: ['a'] }, ['a', 'b']);
	assert.equal(plan.allowed, true);
	assert.equal(plan.ceiling, 2, 'the migration ceiling is the debt at migration time');
	assert.equal(plan.rationale, DEFAULT_CEILING_RATIONALE);
});

test('the document an update writes carries the ceiling, its reason and the findings', () => {
	const plan = planBaselineUpdate(sound, ['a']);
	const document = baselineDocument({ ...plan, findings: ['a'] });
	assert.equal(document._schema, BASELINE_SCHEMA);
	assert.equal(document.ceiling, 2);
	assert.equal(document.ceiling_rationale, sound.ceiling_rationale);
	assert.deepEqual(document.findings, ['a']);
});
