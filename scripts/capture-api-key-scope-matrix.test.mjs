import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	extractTable,
	findSecretRow,
	parseRows,
	renderHtml,
} from './capture-api-key-scope-matrix.mjs';

/**
 * Capture-script tests for the API key scope / revocation matrix
 * artefact (Issue #442).
 *
 * The suite that measures the matrix runs in the workerd pool and
 * needs a real browser to produce the artefact, so these tests cover
 * the part that is pure logic and that a reviewer cannot eyeball: the
 * table extraction and — more importantly — the refusal to render a
 * row that carries credential-shaped material.
 *
 * The refusal is the security-relevant invariant. A renderer that
 * quietly starts publishing `apikey.key` hashes or an issued plaintext
 * is exactly the kind of regression that no code review catches,
 * because the artefact is an image.
 */

const START = '<!-- api-key-scope-matrix:start -->';
const END = '<!-- api-key-scope-matrix:end -->';

const SAMPLE_TABLE = [
	'| # | fixture | request | expected | status | error code |',
	'| --- | --- | --- | --- | --- | --- |',
	'| 1 | access_counter:read | `GET /api/v1/access/count/home-page` | 200 | 200 | — |',
	'| 2 | revoked (admin delete) | `GET /api/v1/access/count/home-page` | 401 invalid_api_key | 401 | invalid_api_key |',
].join('\n');

describe('extractTable', () => {
	it('returns the table between the markers', () => {
		const output = `noise\n${START}\n${SAMPLE_TABLE}\n${END}\nmore noise`;
		assert.equal(extractTable(output), SAMPLE_TABLE);
	});

	it('returns null when the markers are absent', () => {
		assert.equal(extractTable(SAMPLE_TABLE), null);
		assert.equal(extractTable(`${START}\n${SAMPLE_TABLE}`), null);
		assert.equal(extractTable(`${SAMPLE_TABLE}\n${END}`), null);
	});
});

describe('parseRows', () => {
	it('drops the header and keeps the measured columns', () => {
		const rows = parseRows(SAMPLE_TABLE);
		assert.equal(rows.length, 2);
		assert.deepEqual(rows[0], {
			index: '1',
			fixture: 'access_counter:read',
			request: 'GET /api/v1/access/count/home-page',
			expected: '200',
			status: '200',
			code: '—',
		});
		assert.equal(rows[1]?.code, 'invalid_api_key');
	});

	it('returns no rows for an empty block', () => {
		assert.deepEqual(parseRows(''), []);
	});
});

describe('findSecretRow', () => {
	it('accepts the measured matrix as-is', () => {
		// The table legitimately uses the words "key", "token", and
		// "revoked"; a keyword ban would refuse a truthful artefact.
		assert.equal(findSecretRow(parseRows(SAMPLE_TABLE)), null);
	});

	it('refuses an issued plaintext', () => {
		const rows = parseRows(
			[
				'| # | fixture | request | expected | status | error code |',
				'| --- | --- | --- | --- | --- | --- |',
				'| 1 | home key | `GET /api/v1/access/count/home-page` | 200 | 200 | — |',
			].join('\n'),
		);
		rows[0].fixture = 'mk_abcd1234efgh5678';
		assert.equal(findSecretRow(rows)?.index, '1');
	});

	it('refuses a stored hash and an Authorization value', () => {
		const hash = 'q'.repeat(43);
		assert.equal(findSecretRow([{ index: '1', fixture: hash }])?.index, '1');
		assert.equal(
			findSecretRow([{ index: '2', request: 'GET /x', authorization: 'Bearer abc123xyz' }])?.index,
			'2',
		);
	});

	it('keeps cells that describe a header without carrying one', () => {
		// Cell-anchored matching is what makes the guard usable: the
		// matrix has to be able to say "non-Bearer header" in prose.
		assert.equal(findSecretRow([{ index: '4', fixture: 'non-Bearer header' }]), null);
		assert.equal(findSecretRow([{ index: '5', fixture: 'empty Bearer value' }]), null);
		assert.equal(findSecretRow([{ index: '6', request: 'GET /api/v1/reactions?target=x' }]), null);
	});

	it('refuses an account address', () => {
		assert.equal(findSecretRow([{ index: '3', fixture: 'owner@rebuildup.dev' }])?.index, '3');
	});
});

describe('renderHtml', () => {
	it('escapes cell content and keeps the measured status', () => {
		const html = renderHtml(parseRows(SAMPLE_TABLE));
		assert.match(html, /API key scope \/ revocation matrix — Issue #442/);
		assert.match(html, /<td class="status">401<\/td>/);
		assert.ok(!html.includes('<script>'));
		assert.match(html, /invalid_api_key/);
	});

	it('escapes markup in a cell instead of injecting it', () => {
		const html = renderHtml([
			{
				index: '1',
				fixture: '<img src=x>',
				request: 'GET /x',
				expected: '—',
				status: '200',
				code: '—',
			},
		]);
		assert.ok(html.includes('&lt;img src=x&gt;'));
		assert.ok(!html.includes('<img src=x>'));
	});
});
