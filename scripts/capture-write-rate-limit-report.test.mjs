import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	extractTable,
	findSecretRow,
	parseRows,
	renderHtml,
} from './capture-write-rate-limit-report.mjs';

/**
 * Pure-surface tests for the Issue #456 verification capture.
 *
 * The capture's real job (spawn the suite, screenshot Chromium) is
 * exercised by running it; what can silently rot is the parsing and
 * the leak guard, because a broken extractor produces an *empty or
 * wrong* artefact that still looks like a successful run.
 */

const START = '<!-- write-rate-limit-matrix:start -->';
const END = '<!-- write-rate-limit-matrix:end -->';

const TABLE = [
	'| # | エンドポイント | 入力 / 条件 | status | error | Retry-After |',
	'| --- | --- | --- | --- | --- | --- |',
	'| 1 | PUT /api/v1/reactions | 有効な body | 200 | — | — |',
	'| 2 | PUT /api/v1/reactions | 61 回目 | 429 | rate_limited | 60 |',
].join('\n');

test('extractTable returns the block between the markers', () => {
	const output = `noise\n${START}\n${TABLE}\n${END}\nmore noise`;
	assert.equal(extractTable(output), TABLE);
});

test('extractTable returns null when the suite printed no markers', () => {
	assert.equal(extractTable('the suite failed before printing'), null);
	assert.equal(extractTable(`${START}\n${TABLE}\n`), null);
});

test('parseRows drops the header and separator, then maps the cells', () => {
	const rows = parseRows(TABLE);
	assert.equal(rows.length, 2);
	assert.deepEqual(rows[0], {
		index: '1',
		endpoint: 'PUT /api/v1/reactions',
		input: '有効な body',
		status: '200',
		code: '—',
		retryAfter: '—',
	});
	assert.deepEqual(rows[1], {
		index: '2',
		endpoint: 'PUT /api/v1/reactions',
		input: '61 回目',
		status: '429',
		code: 'rate_limited',
		retryAfter: '60',
	});
});

test('parseRows keeps every measurement when the separator line is absent', () => {
	// Regression: a parser that blindly skipped two lines would drop the
	// first measured case and still produce a plausible-looking report.
	const withoutSeparator = TABLE.split('\n')
		.filter((line) => !/^\|[\s|:-]+\|$/.test(line.trim()))
		.join('\n');
	const rows = parseRows(withoutSeparator);
	assert.equal(rows.length, 2);
	assert.equal(rows[0].input, '有効な body');
	assert.equal(rows[1].status, '429');
});

test('renderHtml marks accepted, rejected, and throttled rows differently', () => {
	const html = renderHtml(parseRows(TABLE));
	assert.match(html, /<tr class="ok">/);
	assert.match(html, /<tr class="throttle">/);
	assert.ok(html.includes('rate_limited'));
	assert.ok(html.includes('Retry-After'));
});

test('renderHtml escapes markup coming from the measured table', () => {
	const rows = parseRows(
		[
			'| # | エンドポイント | 入力 / 条件 | status | error | Retry-After |',
			'| --- | --- | --- | --- | --- | --- |',
			'| 1 | <img src=x onerror=alert(1)> | `<b>` | 200 | — | — |',
		].join('\n'),
	);
	const html = renderHtml(rows);
	assert.ok(!html.includes('<img src=x'));
	assert.ok(html.includes('&lt;img src=x'));
});

test('findSecretRow rejects a row that carries credential material', () => {
	assert.equal(findSecretRow(parseRows(TABLE)), undefined);
	const leaky = [
		{
			index: '1',
			endpoint: 'PUT /api/v1/reactions',
			input: 'Authorization: Bearer mk_home_real',
			status: '200',
			code: '—',
			retryAfter: '—',
		},
	];
	assert.equal(findSecretRow(leaky)?.endpoint, 'PUT /api/v1/reactions');
});
