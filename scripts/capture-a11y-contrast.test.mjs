/**
 * The Issue #399 capture script's own unit tests.
 *
 * The capture is an ASSERTION, not only a screenshot: it compares the
 * colours the browser rendered with the colours the gate measured. That
 * comparison is pure, so it can be tested without Chromium — a rule that
 * can only fail inside a browser is a rule nobody re-runs when it breaks.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	ARTEFACT,
	SCREENSHOT_BUDGET_BYTES,
	SCREENSHOT_MAX_WIDTH,
	assertWebpOutputPath,
	buildPanels,
	evaluateRendered,
	harnessHtml,
	panelRows,
} from './capture-a11y-contrast.mjs';
import { APPEARANCES, collectEvidence } from './check-a11y-contrast.mjs';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

test('the capture refuses a non-WebP artefact path', () => {
	assert.throws(() => assertWebpOutputPath('docs/verification/a11y/contrast.png'), /WebP/);
	assert.throws(() => assertWebpOutputPath('docs/verification/a11y/contrast.png'), /refusing/);
	assert.equal(
		assertWebpOutputPath('docs/verification/a11y/contrast.webp'),
		'docs/verification/a11y/contrast.webp',
	);
});

test('the capture refuses to write outside the repository', () => {
	assert.throws(() => assertWebpOutputPath('../escape.webp'), /outside the repository/);
});

test('the committed artefact is the WebP the Issue names', () => {
	assert.match(ARTEFACT, /\.webp$/);
	assert.equal(ARTEFACT, 'docs/verification/a11y/contrast.webp');
});

test('both appearances are rendered, each with its own swatch ids', async () => {
	const evidence = await collectEvidence();
	const light = panelRows(evidence, 'light');
	const dark = panelRows(evidence, 'dark');
	assert.equal(light.length, dark.length);
	assert.ok(light.length > 0);
	const ids = new Set([...light, ...dark].map((row) => row.id));
	assert.equal(ids.size, light.length + dark.length);
	for (const row of [...light, ...dark]) {
		assert.match(row.id, /^(light|dark)-/);
		assert.match(row.fgHex, /^#[0-9a-f]{6}$/);
		assert.match(row.bgHex, /^#[0-9a-f]{6}$/);
	}
});

test('the harness shows both appearances with the measured ratio', async () => {
	const evidence = await collectEvidence();
	const { rawTokens, semanticTokens } = await import('../src/editorial/tokens.ts').then(async (raw) => {
		const semantic = await import('../src/editorial/semantic-tokens.ts');
		return { rawTokens: raw.rawTokens, semanticTokens: semantic.semanticTokens };
	});
	const panels = buildPanels(evidence, { rawTokens, semanticTokens });
	assert.equal(panels.length, APPEARANCES.length);
	const html = harnessHtml(panels);
	assert.match(html, /data-appearance="light"/);
	assert.match(html, /data-appearance="dark"/);
	assert.match(html, /needs 4\.5:1/);
	assert.match(html, /needs 3:1/);
	// Every swatch of both panels is on the page.
	assert.equal(
		(html.match(/data-swatch=/g) ?? []).length,
		panels.reduce((total, panel) => total + panel.rows.length, 0),
	);
});

test('a rendered colour that contradicts the token is a failure', () => {
	const rows = [
		{
			id: 'light-a-on-b',
			fgHex: '#0f172a',
			bgHex: '#ffffff',
			ratio: 17.85,
			threshold: 4.5,
			pass: true,
		},
	];
	const verdict = evaluateRendered({
		rows,
		observations: [{ id: 'light-a-on-b', fg: '#000000', bg: '#ffffff' }],
	});
	assert.equal(verdict.ok, false);
	assert.match(verdict.failures[0], /rendered foreground/);
});

test('a swatch that was never rendered is a failure', () => {
	const verdict = evaluateRendered({
		rows: [
			{ id: 'light-a-on-b', fgHex: '#0f172a', bgHex: '#ffffff', ratio: 17.85, threshold: 4.5 },
		],
		observations: [],
	});
	assert.equal(verdict.ok, false);
	assert.match(verdict.failures[0], /did not render/);
});

test('the rendered colours that agree with the measurement pass', () => {
	const rows = [
		{
			id: 'light-a-on-b',
			fgHex: '#0f172a',
			bgHex: '#ffffff',
			ratio: 17.85,
			threshold: 4.5,
			pass: true,
		},
	];
	const verdict = evaluateRendered({
		rows,
		observations: [{ id: 'light-a-on-b', fg: '#0f172a', bg: '#ffffff' }],
	});
	assert.deepEqual(verdict.failures, []);
	assert.equal(verdict.ok, true);
});

test('the artefact budget is a WebP budget', () => {
	assert.ok(SCREENSHOT_MAX_WIDTH <= 1600);
	assert.ok(SCREENSHOT_BUDGET_BYTES > 0);
});

test('the capture reads the repository, not a copy of it', () => {
	assert.match(REPO_ROOT, /my-web-2026/);
});
