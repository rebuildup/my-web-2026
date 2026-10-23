import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	OUTBOUND_BLOCKED_STATUS,
	createOutboundPolicy,
	outboundBlockedBody,
} from './_vitest-outbound-policy.mjs';

describe('outboundBlockedBody', () => {
	it('names the path of the blocked request', () => {
		assert.equal(
			outboundBlockedBody('https://example.com/api/v1/access/hit'),
			'outbound request blocked by the test pool (Issue #261): /api/v1/access/hit',
		);
	});

	it('keeps a value that is not a URL as it is', () => {
		assert.equal(
			outboundBlockedBody('not a url'),
			'outbound request blocked by the test pool (Issue #261): not a url',
		);
	});
});

describe('createOutboundPolicy', () => {
	it('answers every outbound request with the blocked status', async () => {
		const policy = createOutboundPolicy();
		const res = await policy({ url: 'https://example.com/api/v1/reactions' });
		assert.equal(res.status, OUTBOUND_BLOCKED_STATUS);
		assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
		assert.match(await res.text(), /blocked by the test pool/);
	});

	it('answers even when the platform hands over no url', async () => {
		const policy = createOutboundPolicy();
		const res = await policy({});
		assert.equal(res.status, OUTBOUND_BLOCKED_STATUS);
		assert.match(await res.text(), /blocked by the test pool/);
	});
});
