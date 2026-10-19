#!/usr/bin/env node
/**
 * Report-renderer contract for Issue #496.
 *
 * The screenshot in the PR body is only evidence if the page it comes
 * from is a function of the registry rather than a hand-written HTML
 * file. These assertions run against fixtures, so a renderer change
 * that drops an entry, hides a `pending` status or stops reporting the
 * purge-job verdict fails here instead of shipping a flattering image.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	DATA_LIFECYCLE_ENTRIES,
	DELETION_REQUEST_CHANNEL,
	UNSUPPORTED_PUBLIC_CLAIMS,
} from '../src/privacy/data-lifecycle.ts';
import {
	detectScheduledPurge,
	renderReport,
	summariseReport,
} from './make-data-lifecycle-report.mjs';

const SUMMARY = summariseReport({
	testResults: [
		{
			name: '/repo/test/integration/data-lifecycle.test.ts',
			assertionResults: [
				{
					fullName: 'the served document publishes the registry',
					status: 'passed',
					duration: 12.4,
				},
				{ fullName: 'retention is observed', status: 'failed', duration: 3.1 },
			],
		},
	],
});

function render(overrides = {}) {
	return renderReport({
		summary: SUMMARY,
		entries: DATA_LIFECYCLE_ENTRIES,
		refusals: UNSUPPORTED_PUBLIC_CLAIMS,
		deletionWindow: DELETION_REQUEST_CHANNEL.statement,
		purgeJobDeclared: false,
		...overrides,
	});
}

test('summariseReport counts assertions and separates failures', () => {
	assert.equal(SUMMARY.total, 2);
	assert.equal(SUMMARY.passed, 1);
	assert.equal(SUMMARY.failed, 1);
	assert.equal(SUMMARY.assertions[0].file.split('/').slice(-1)[0], 'data-lifecycle.test.ts');
});

test('every registry entry, both locales and the deletion window reach the page', () => {
	const html = render();
	for (const entry of DATA_LIFECYCLE_ENTRIES) {
		assert.ok(html.includes(`<code>${entry.id}</code>`), `entry ${entry.id} missing`);
		assert.ok(html.includes(entry.label.ja), `ja label of ${entry.id} missing`);
		assert.ok(html.includes(entry.label.en), `en label of ${entry.id} missing`);
		// The three retention-relevant cells, and the publication status.
		assert.ok(html.includes(entry.stores.ja));
		assert.ok(html.includes(entry.retention.statement.ja));
		assert.ok(html.includes(entry.deletion.statement.ja));
		assert.ok(html.includes(entry.transfer.statement.ja));
		assert.ok(html.includes(entry.publication.status));
	}
	assert.ok(html.includes(DELETION_REQUEST_CHANNEL.statement.ja));
	assert.ok(html.includes(DELETION_REQUEST_CHANNEL.statement.en));
});

test('every refusal renders with the repository fact that forbids it', () => {
	const html = render();
	for (const refusal of UNSUPPORTED_PUBLIC_CLAIMS) {
		assert.ok(html.includes(`<code>${refusal.id}</code>`), `refusal ${refusal.id} missing`);
		assert.ok(html.includes(refusal.why), `refusal reason of ${refusal.id} missing`);
		for (const pattern of refusal.patterns) {
			assert.ok(html.includes(pattern), `pattern ${pattern} missing`);
		}
	}
});

test('the purge-job verdict is rendered from the argument, not hard-coded', () => {
	assert.ok(render().includes('not declared'));
	const detected = render({ purgeJobDeclared: true });
	assert.ok(detected.includes('WRONG'));
	assert.ok(!detected.includes('not declared'));
});

test('a failed assertion is rendered as FAIL', () => {
	const html = render();
	assert.ok(html.includes('>PASS<'));
	assert.ok(html.includes('>FAILED<'));
	assert.ok(html.includes('tr class="failed"'));
});

test('text is escaped, so a registry sentence cannot inject markup', () => {
	const hostile = [
		{
			id: 'hostile',
			label: { ja: '<script>alert(1)</script>', en: '<b>x</b>' },
			stores: { ja: 'a & b', en: 'a & b' },
			retention: { kind: 'none', statement: { ja: '<img src=x>', en: '<img src=x>' } },
			deletion: { channel: 'not-applicable', statement: { ja: '-', en: '-' } },
			transfer: { target: 'none', statement: { ja: '-', en: '-' } },
			visibility: { ja: '-', en: '-' },
			evidence: ['src/x.ts'],
			publication: { status: 'approved', note: { ja: '-', en: '-' } },
		},
	];
	const html = render({ entries: hostile });
	assert.ok(!html.includes('<script>alert(1)</script>'));
	assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
	assert.ok(html.includes('a &amp; b'));
});

test('detectScheduledPurge only fires on a declared cron trigger', () => {
	assert.equal(detectScheduledPurge('{"name": "my-web-2026"}'), false);
	assert.equal(detectScheduledPurge('// "crons": ["0 3 * * *"]\n{\n  "name": "x"\n}'), true);
	assert.equal(
		detectScheduledPurge('{\n  "triggers": {\n    "crons": ["0 3 * * *"]\n  }\n}'),
		true,
	);
	// A JSONC comment naming crons is not a trigger.
	assert.equal(detectScheduledPurge('{\n  // no "crons" here\n  "name": "x"\n}'), false);
});
