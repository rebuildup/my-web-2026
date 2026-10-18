import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	ARTIFACT,
	extractMatrix,
	findSecretRow,
	parseRows,
	renderHtml,
} from './capture-image-upload-guards-report.mjs';

/**
 * Pure-surface tests for the Issue #458 verification capture.
 *
 * The capture's real job (spawn the suite, screenshot Chromium) is
 * exercised by running it; what can silently rot is the parsing and
 * the leak guard, because a broken extractor produces an *empty or
 * wrong* artefact that still looks like a successful run.
 */

const START = '<!-- image-upload-guards-matrix:start -->';
const END = '<!-- image-upload-guards-matrix:end -->';

const TABLE = [
	'| # | 入力 | 宣言 MIME | 実体(署名) | ファイル名 | サイズ | 結果 | コード | R2 key |',
	'| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
	'| 1 | 実PNG | `image/png` | `image/png` | `reaction.png` | 67 B | accepted | `stored` | `reactions/<sha256>.png` |',
	'| 2 | テキスト→png | `image/png` | `none` | `fake.png` | 30 B | rejected | `unrecognized_signature` | — |',
].join('\n');

test('extractMatrix returns the block between the markers', () => {
	const output = `noise\n${START}\n${TABLE}\n${END}\nmore noise`;
	assert.equal(extractMatrix(output), TABLE);
});

test('extractMatrix returns null when the suite printed no markers', () => {
	assert.equal(extractMatrix('the suite failed before printing'), null);
	assert.equal(extractMatrix(`${START}\n${TABLE}\n`), null);
});

test('extractMatrix strips the vitest stdout prefix from every line', () => {
	// Regression: vitest echoes test-process writes as `stdout: <line>`.
	// Without the strip, `parseRows` sees zero table rows and the capture
	// fails (loud) instead of writing a wrong artefact (quiet).
	const prefixed = TABLE.split('\n')
		.map((line) => `stdout: ${line}`)
		.join('\n');
	const output = `${START}\n${prefixed}\n${END}`;
	assert.equal(extractMatrix(output), TABLE);
	assert.equal(parseRows(extractMatrix(output)).length, 2);
});

test('parseRows drops the header and separator, then maps the cells', () => {
	const rows = parseRows(TABLE);
	assert.equal(rows.length, 2);
	assert.deepEqual(rows[0], {
		index: '1',
		label: '実PNG',
		declared: 'image/png',
		detected: 'image/png',
		filename: 'reaction.png',
		size: '67 B',
		verdict: 'accepted',
		code: 'stored',
		r2Key: 'reactions/<sha256>.png',
	});
	assert.deepEqual(rows[1], {
		index: '2',
		label: 'テキスト→png',
		declared: 'image/png',
		detected: 'none',
		filename: 'fake.png',
		size: '30 B',
		verdict: 'rejected',
		code: 'unrecognized_signature',
		r2Key: '—',
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
	assert.equal(rows[0].label, '実PNG');
	assert.equal(rows[1].code, 'unrecognized_signature');
});

test('parseRows returns an empty list for an empty matrix', () => {
	assert.deepEqual(parseRows(''), []);
});

test('renderHtml separates accepted rows from rejected rows', () => {
	const html = renderHtml(parseRows(TABLE));
	assert.match(html, /<tr class="ok">/);
	assert.match(html, /<tr class="reject">/);
	assert.ok(html.includes('unrecognized_signature'));
	assert.ok(html.includes('2 ケース（登録 1 / 拒否 1）'));
});

test('renderHtml escapes markup coming from the measured table', () => {
	const rows = parseRows(
		[
			'| # | 入力 | 宣言 MIME | 実体(署名) | ファイル名 | サイズ | 結果 | コード | R2 key |',
			'| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
			'| 1 | <img src=x onerror=alert(1)> | `image/png` | `none` | `<b>.png` | 1 B | rejected | `unrecognized_signature` | — |',
		].join('\n'),
	);
	const html = renderHtml(rows);
	assert.ok(!html.includes('<img src=x'));
	assert.ok(html.includes('&lt;img src=x'));
});

test('renderHtml ellipsises an over-long cell instead of blowing up the layout', () => {
	const rows = parseRows(
		[
			'| # | 入力 | 宣言 MIME | 実体(署名) | ファイル名 | サイズ | 結果 | コード | R2 key |',
			'| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
			`| 1 | 不正ファイル名 | \`image/png\` | \`image/png\` | \`${'a'.repeat(256)}\` | 67 B | rejected | \`invalid_filename\` | — |`,
		].join('\n'),
	);
	const html = renderHtml(rows);
	assert.ok(!html.includes('a'.repeat(256)));
	assert.ok(html.includes('…'));
});

test('the committed artefact is a compressed WebP, not a PNG', () => {
	// Verification screenshots are committed, so the repo budget for
	// them is a moderately compressed WebP at width ≤ 1600 / quality
	// 80 — the same report is ~390 KB as a lossless PNG.
	assert.equal(ARTIFACT.path, 'docs/verification/security/image-upload-guards.webp');
	assert.ok(ARTIFACT.path.endsWith('.webp'));
	assert.ok(ARTIFACT.maxWidth <= 1600);
	assert.equal(ARTIFACT.quality, 80);
});

test('findSecretRow rejects a row that carries credential material', () => {
	assert.equal(findSecretRow(parseRows(TABLE)), undefined);
	const leaky = [
		{
			index: '1',
			label: '実PNG',
			declared: 'image/png',
			detected: 'image/png',
			filename: 'Authorization: Bearer mk_home_real.png',
			size: '67 B',
			verdict: 'accepted',
			code: 'stored',
			r2Key: 'reactions/<sha256>.png',
		},
	];
	assert.equal(findSecretRow(leaky)?.index, '1');
});
