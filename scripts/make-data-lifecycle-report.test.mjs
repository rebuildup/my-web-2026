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
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	DATA_LIFECYCLE_ENTRIES,
	DELETION_REQUEST_CHANNEL,
	UNSUPPORTED_PUBLIC_CLAIMS,
	parseEvidencePath,
} from '../src/privacy/data-lifecycle.ts';
import {
	findScheduledHandlers,
	readSourceTree,
	renderReport,
	stripComments,
	summariseReport,
} from './make-data-lifecycle-report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
			],
		},
		{
			name: '/repo/src/privacy/data-lifecycle.test.ts',
			assertionResults: [
				{
					fullName: 'retention is observed',
					status: 'failed',
					duration: 3.1,
				},
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

test('summariseReport groups the assertions per suite file', () => {
	// The report renders one row per suite file (plus every failure in
	// full), so the grouping is part of the contract: a suite that
	// fails must not be summarised as a pass.
	assert.equal(SUMMARY.files.length, 2);
	assert.equal(SUMMARY.files[0].file.split('/').slice(-1)[0], 'data-lifecycle.test.ts');
	assert.equal(SUMMARY.files[0].passed, 1);
	assert.equal(SUMMARY.files[0].failed, 0);
	assert.equal(SUMMARY.files[1].failed, 1);
	assert.equal(SUMMARY.files[1].failures[0].title, 'retention is observed');
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
	// The failing assertion itself is printed in full — the summary
	// row says "1 failed", the detail row says which one.
	assert.ok(html.includes('失敗した assertion'));
	assert.ok(html.includes('retention is observed'));
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

test('the purge-job claim is checked against the Worker source', () => {
	// Non-vacuity on the current tree: this is the assertion that keeps
	// the registry's "no purge job ships" sentence true.
	const hits = findScheduledHandlers(readSourceTree(ROOT));
	assert.deepEqual(hits, [], `unexpected scheduled handler in ${hits.join(', ')}`);
});

test('a scheduled handler is detected when one is declared', () => {
	assert.deepEqual(
		findScheduledHandlers([
			{ file: 'src/server.ts', source: 'export default { async scheduled() {} };' },
		]),
		['src/server.ts'],
	);
	assert.deepEqual(
		findScheduledHandlers([
			{ file: 'src/server.ts', source: 'const handler = { scheduled: purge };' },
		]),
		['src/server.ts'],
	);
});

test('prose about a missing purge job is not read as a handler', () => {
	// Comments are stripped first: `src/**` discusses scheduled work in
	// prose, and a naive grep would report a purge job that is not there.
	const prose = `
/**
 * No scheduled handler ships: this platform has no purge job.
 */
// it is scheduled from retryWakeupMs
export const retry = { retryWakeupMs: 5 };
`;
	assert.deepEqual(findScheduledHandlers([{ file: 'src/x.ts', source: prose }]), []);
	assert.ok(!stripComments(prose).includes('scheduled'));
});

test('the deployment configuration declares no Cron trigger', () => {
	// The configuration half of the same claim. Naming `wrangler.jsonc`
	// is allowed HERE and not in the report script: the static half of
	// `pnpm run wrangler:independence:check` scans `scripts/**` but
	// exempts `*.test.mjs`.
	const config = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8');
	const code = config.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
	assert.equal(/"crons"\s*:/.test(code), false);
});

test('every evidence pointer names a file that exists', () => {
	// The registry's evidence pointers are the only way a reviewer
	// re-derives a published claim, so a pointer that names a file
	// nobody can open is not evidence. The runtime guard only checks
	// that a pointer *looks like* a path; this is the half that
	// resolves it. It runs here (Node) because the workerd pool has
	// no filesystem — the leaf rule exempts test files, and this file
	// is a `*.test.mjs` under `scripts/`.
	for (const entry of DATA_LIFECYCLE_ENTRIES) {
		for (const pointer of entry.evidence) {
			const file = parseEvidencePath(pointer);
			assert.ok(
				file.includes('/') || /\.[a-z]+$/i.test(file),
				`evidence pointer names no path: ${pointer}`,
			);
			assert.ok(
				existsSync(join(ROOT, file)),
				`evidence pointer names a missing file: ${pointer} (${file})`,
			);
		}
	}
});
