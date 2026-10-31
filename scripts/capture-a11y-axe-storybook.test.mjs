/**
 * The Issue #392 capture script's own unit tests.
 *
 * The capture writes a committed artefact, so the parts that decide
 * WHERE and WHAT is written are tested offline: a capture that wrote a
 * PNG, or wrote outside the repository, or audited a deployment
 * instead of the local preview would be a defect nobody notices until
 * the diff is reviewed.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	REPORT_WIDTH,
	SCREENSHOT_BUDGET_BYTES,
	SCREENSHOT_MAX_WIDTH,
	SCREENSHOT_QUALITY,
	assertLoopbackBaseUrl,
	assertWebpOutputPath,
	escapeHtml,
	renderTable,
	reportHtml,
	serveDirectory,
} from './capture-a11y-axe-storybook.mjs';

const REPO_ROOT = process.cwd();

/** One GET with the path sent verbatim (no normalisation). */
function rawGet(baseUrl, path) {
	return new Promise((done) => {
		const url = new URL(baseUrl);
		const req = request({ host: url.hostname, port: url.port, path, method: 'GET' }, (response) => {
			let body = '';
			response.on('data', (chunk) => {
				body += chunk;
			});
			response.on('end', () => done({ status: response.statusCode ?? 0, body }));
		});
		req.on('error', () => done({ status: 0, body: '' }));
		req.end();
	});
}

test('the capture refuses a non-WebP artefact', () => {
	assert.throws(() => assertWebpOutputPath('docs/verification/a11y/shot.png'), /non-WebP/);
	assert.equal(
		assertWebpOutputPath('docs/verification/a11y/axe-storybook-pass-fail.webp'),
		'docs/verification/a11y/axe-storybook-pass-fail.webp',
	);
});

test('the capture refuses to write outside the repository', () => {
	assert.throws(() => assertWebpOutputPath('../outside.webp'), /outside the repository/);
});

test('the capture audits a loopback origin only', () => {
	assert.equal(assertLoopbackBaseUrl('http://localhost:6006'), 'http://localhost:6006');
	assert.equal(assertLoopbackBaseUrl('http://127.0.0.1:6006'), 'http://127.0.0.1:6006');
	assert.throws(() => assertLoopbackBaseUrl('https://rebuildup.dev'), /non-loopback/);
});

test('the capture keeps the committed artefact inside the image budget', () => {
	assert.ok(SCREENSHOT_MAX_WIDTH <= 1600, 'the width cap is 1600 px');
	assert.equal(SCREENSHOT_QUALITY, 80);
	assert.equal(SCREENSHOT_BUDGET_BYTES, 300 * 1024);
	assert.ok(REPORT_WIDTH <= SCREENSHOT_MAX_WIDTH, 'the report is rendered inside the width cap');
});

test('the report escapes the text it renders', () => {
	assert.equal(
		escapeHtml('<img src=x onerror="boom()">'),
		'&lt;img src=x onerror=&quot;boom()&quot;&gt;',
	);
	assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

test('the audit table renders one row per story', () => {
	const table = renderTable([
		{
			story: 'src/editorial/primitives/Badge.stories.tsx#Neutral',
			verdict: 'pass',
			rules: [],
		},
		{
			story: 'src/editorial/primitives/Badge.stories.tsx#Accent',
			verdict: 'fail',
			rules: [
				{
					ruleId: 'image-alt',
					tags: ['wcag2a', 'wcag111'],
					nodes: [{ target: 'img' }],
				},
			],
		},
	]);
	assert.equal(table.match(/class="row"/g)?.length, 2);
	assert.match(table, /Badge\.stories\.tsx#Neutral/);
	assert.match(table, /image-alt/);
	assert.match(table, /state fail/);
});

test('the report separates the machine result from the human evaluation', () => {
	const html = reportHtml({
		summaries: [
			{
				story: 'src/editorial/primitives/Badge.stories.tsx#Neutral',
				verdict: 'pass',
				rules: [],
			},
		],
		pass: { caption: 'the audited story', png: Buffer.from('png') },
		fail: { caption: 'the negative control', png: Buffer.from('png') },
		baseUrl: 'http://localhost:6006',
		gateExitCode: 0,
		axeVersion: '4.14.0',
	});
	assert.match(html, /human evaluation \(not decided by this gate\)/);
	assert.match(html, /stories audited/);
	assert.match(html, /the negative control/);
	assert.match(html, /4\.14\.0/);
});

test('the report server answers on loopback and refuses a path escape', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'a11y-axe-storybook-'));
	try {
		writeFileSync(join(directory, 'index.html'), '<!doctype html><title>report</title>');
		const server = await serveDirectory(directory);
		try {
			const ok = await fetch(`${server.baseUrl}/`);
			assert.equal(ok.status, 200);
			assert.match(await ok.text(), /report/);
			// `fetch` normalises the path, so the traversal is sent raw.
			const escaped = await rawGet(server.baseUrl, '/../../etc/passwd');
			assert.notEqual(escaped.status, 200);
			assert.ok(
				!escaped.body.includes('root:'),
				'the traversal must not read a file outside the root',
			);
		} finally {
			await server.close();
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test('the committed artefact exists and is a WebP', () => {
	const artefact = join(REPO_ROOT, 'docs/verification/a11y/axe-storybook-pass-fail.webp');
	assert.ok(existsSync(artefact), 'the capture has been run');
});
