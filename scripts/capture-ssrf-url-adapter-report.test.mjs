import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	KNOWN_CODES,
	findSecretRow,
	measure,
	renderHtml,
} from './capture-ssrf-url-adapter-report.mjs';

/**
 * Unit coverage for the Issue #453 report generator.
 *
 * The script's own failure modes are what matter here, because the
 * artefact it writes is committed and reviewed as evidence: a silently
 * empty table, a row that renders a credential, or a matrix built by a
 * suite that quietly stopped running all produce a plausible-looking
 * image. These assert the guards fail loudly instead.
 *
 * Wired into `pnpm test` via `package.json#scripts.test`, so
 * `check-test-wiring` keeps this file reachable.
 */

/** A transport that answers exactly one URL, so a happy path is provable. */
function okTransport(url, body = 'ok') {
	const calls = [];
	return {
		calls,
		transport: async (requested, init) => {
			calls.push({ requested, init });
			if (requested !== url) throw new Error(`unexpected request to ${requested}`);
			return new Response(body, { headers: { 'content-type': 'text/plain' } });
		},
	};
}

test('findSecretRow refuses a row carrying a credential-shaped value', () => {
	const clean = { label: 'loopback', input: 'http://127.0.0.1/', code: 'private_address' };
	assert.equal(findSecretRow([clean]), undefined);

	assert.ok(findSecretRow([{ ...clean, input: 'https://h/?k=mk_abcdef' }]));
	assert.ok(findSecretRow([{ ...clean, reason: 'sent Bearer abc' }]));
	assert.ok(findSecretRow([{ ...clean, reason: `digest ${'a1b2c3d4'.repeat(6)}` }]));
	assert.ok(findSecretRow([{ ...clean, reason: 'authorization: eyJhbGciOiJIUzI1' }]));
});

test('findSecretRow allows a row that only NAMES a refused header', () => {
	// Naming the header is the refusal, not a leak. A pattern that
	// matched the bare word would make the credential-header row
	// unrenderable, which is how a guard quietly deletes evidence.
	const named = {
		label: 'credential header',
		input: 'https://api.github.com/user',
		code: 'credential_header_refused',
		reason: 'header "authorization" is never sent to a third-party origin',
	};
	assert.equal(findSecretRow([named]), undefined);
});

test('findSecretRow looks at every row, not only the first', () => {
	const rows = [
		{ label: 'a', input: 'https://api.github.com/', code: 'HTTP 200' },
		{ label: 'b', input: 'https://api.github.com/', code: 'set-cookie: x' },
	];
	assert.equal(findSecretRow(rows).label, 'b');
});

test('measure reports a fetched row with its hop count', async () => {
	const url = 'https://api.github.com/user';
	const { transport, calls } = okTransport(url);
	const rows = await measure([{ group: '取得できた', label: 'public', url }], { transport });

	assert.equal(rows.length, 1);
	assert.equal(rows[0].outcome, 'fetched');
	assert.equal(rows[0].code, 'HTTP 200');
	assert.equal(rows[0].hops, '0');
	assert.equal(rows[0].reason, '0 hop / 2 B');
	assert.equal(calls[0].init.redirect, 'manual');
});

test('measure reports a refusal without ever calling the transport', async () => {
	const { transport, calls } = okTransport('https://unused.example.org/');
	const rows = await measure(
		[{ group: 'ループバック / private', label: 'loopback', url: 'http://127.0.0.1:8787/' }],
		{ transport },
	);

	assert.equal(rows[0].outcome, 'refused');
	assert.equal(rows[0].code, 'private_address');
	assert.ok(KNOWN_CODES.has(rows[0].code));
	assert.deepEqual(calls, []);
});

test('measure shortens an over-long input instead of rendering a wall of text', async () => {
	const long = `https://api.github.com/${'a'.repeat(400)}`;
	const rows = await measure([{ group: '形', label: 'long', url: long }], {
		transport: okTransport('https://unused.example.org/').transport,
	});
	assert.equal(rows[0].input.length, 56);
	assert.ok(rows[0].input.endsWith('…'));
});

test('measure makes invisible characters visible', async () => {
	const rows = await measure(
		[{ group: '形', label: 'nl', url: 'https://api.github.com\n@169.254.169.254/' }],
		{ transport: okTransport('https://unused.example.org/').transport },
	);
	assert.ok(rows[0].input.includes('<lf>'));
	assert.equal(rows[0].code, 'invalid_url');
});

test('renderHtml escapes markup in every cell', () => {
	const html = renderHtml([
		{
			group: 'probe',
			label: '<script>alert(1)</script>',
			input: 'https://h/?a=<b>&c',
			outcome: 'refused',
			code: 'host_not_allowed',
			reason: 'a & b',
			hops: '0',
		},
	]);
	assert.ok(!html.includes('<script>'));
	assert.ok(html.includes('&lt;script&gt;'));
	assert.ok(html.includes('&amp;'));
	assert.ok(html.includes('&lt;b&gt;'));
});

test('renderHtml draws a group header per group and counts both outcomes', () => {
	const rows = [
		{
			group: 'g1',
			label: 'a',
			input: 'https://a/',
			outcome: 'fetched',
			code: 'HTTP 200',
			reason: '0 hop / 1 B',
			hops: '0',
		},
		{
			group: 'g1',
			label: 'b',
			input: 'http://10.0.0.1/',
			outcome: 'refused',
			code: 'private_address',
			reason: 'x',
			hops: '0',
		},
		{
			group: 'g2',
			label: 'c',
			input: 'file:///etc/passwd',
			outcome: 'refused',
			code: 'protocol_not_allowed',
			reason: 'y',
			hops: '0',
		},
	];
	const html = renderHtml(rows);
	assert.equal((html.match(/<tr class="group">/g) ?? []).length, 2);
	assert.ok(html.includes('取得成功 1 / 拒否 2'));
	assert.ok(html.includes('<tr class="ok">'));
	assert.ok(html.includes('<tr class="reject">'));
});

test('renderHtml survives an empty matrix rather than throwing', () => {
	const html = renderHtml([]);
	assert.ok(html.includes('取得成功 0 / 拒否 0'));
});
