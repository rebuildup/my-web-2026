/**
 * `capture-i18n-unicode-slug` unit tests (Issue #433).
 *
 * The capture script generates the committed verification artefact, so
 * two things have to be pinned here: the pure helpers it builds the
 * evidence with (including the WebP-only guard that keeps a multi-
 * hundred-kilobyte PNG out of the tree), and the fact that the
 * evidence is produced from the SHIPPED policy rather than a copy.
 *
 * The browser is not launched: rendering is verified by the artefact
 * itself plus the `--no-capture` path.
 */

import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import {
	assertFixtureCount,
	assertWebpOutputPath,
	buildPalette,
	buildReportHtml,
	collectEvidence,
	codePointList,
	DEFAULT_SCREENSHOT,
	escapeHtml,
	EXPECTED_FIXTURE_COUNT,
	naiveSlugCollisions,
	naiveSlugify,
	parseArgs,
	SCREENSHOT_BUDGET_BYTES,
	screenshotBudgetVerdict,
} from './capture-i18n-unicode-slug.mjs';

test('assertWebpOutputPath refuses anything that is not a WebP', () => {
	assert.throws(
		() => assertWebpOutputPath('docs/verification/i18n/unicode-slug-validation.png'),
		/non-WebP/,
	);
	assert.equal(
		assertWebpOutputPath(DEFAULT_SCREENSHOT),
		'docs/verification/i18n/unicode-slug-validation.webp',
	);
});

test('assertWebpOutputPath refuses to write outside the repository', () => {
	assert.throws(() => assertWebpOutputPath('../outside.webp'), /outside the repository/);
	assert.throws(() => assertWebpOutputPath('/tmp/absolute.webp'), /outside the repository/);
});

test('screenshotBudgetVerdict measures the artefact budget', () => {
	assert.deepEqual(screenshotBudgetVerdict(1024), {
		bytes: 1024,
		kb: 1,
		withinBudget: true,
	});
	assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES).withinBudget, true);
	assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES + 1).withinBudget, false);
});

test('the committed artefact exists, is WebP, and fits the budget', () => {
	const bytes = statSync(new URL(`../${DEFAULT_SCREENSHOT}`, import.meta.url)).size;
	const verdict = screenshotBudgetVerdict(bytes);
	assert.equal(verdict.withinBudget, true);
	const head = readFileSync(new URL(`../${DEFAULT_SCREENSHOT}`, import.meta.url)).subarray(0, 12);
	// RIFF....WEBP
	assert.equal(head.subarray(0, 4).toString('ascii'), 'RIFF');
	assert.equal(head.subarray(8, 12).toString('ascii'), 'WEBP');
});

test('escapeHtml keeps the gate output from becoming markup', () => {
	assert.equal(escapeHtml('a < b & "c"'), 'a &lt; b &amp; &quot;c&quot;');
});

test('naiveSlugify reproduces the lossy derivation the policy refuses', () => {
	// These are the collisions the refusal exists to prevent.
	assert.equal(naiveSlugify('Caf\u00e9 notes'), 'cafe-notes');
	assert.equal(naiveSlugify('Cafe\u0301 notes'), 'cafe-notes');
	assert.equal(naiveSlugify('\ufb01nance report'), 'finance-report');
	assert.equal(naiveSlugify('5 \u00b5m tolerance'), '5-m-tolerance');
	assert.equal(naiveSlugify('5 \u03bcm tolerance'), '5-m-tolerance');
	assert.equal(naiveSlugify('\u2460 \u512a\u5148'), '1');
	assert.equal(naiveSlugify('\u2163 \u671f'), 'iv');
	assert.equal(naiveSlugify('\uff2d\uff35\uff2c\uff34\uff29 slicer'), 'multi-slicer');
	// The negation simply disappears: "N ≠ 3" becomes "n-3".
	assert.equal(naiveSlugify('N \u2260 3 (\u975e\u5bfe\u5fdc)'), 'n-3');
});

test('naiveSlugCollisions names the distinct words a lossy fold would merge', () => {
	const rows = [
		{ displayText: '5 \u00b5m tolerance' },
		{ displayText: '5 \u03bcm tolerance' },
		{ displayText: 'Multi slicer' },
		{ displayText: '\uff2d\uff35\uff2c\uff34\uff29 slicer' },
		{ displayText: 'Caf\u00e9' },
		{ displayText: 'Cafe\u0301' },
	];
	const collisions = naiveSlugCollisions(rows);
	const merged = collisions.map((collision) => collision.naive);
	// Two unit letters, and two ASCII/fullwidth spellings of one project.
	assert.ok(merged.includes('5-m-tolerance'));
	assert.ok(merged.includes('multi-slicer'));
	assert.ok(merged.includes('cafe'));
});

test('codePointList prints the code points a reader cannot see', () => {
	assert.equal(codePointList('cafe\u0301'), 'U+0063 U+0061 U+0066 U+0065 U+0301');
	assert.equal(codePointList('ab'), 'U+0061 U+0062');
});

test('assertFixtureCount refuses a partial decision table', () => {
	assert.equal(assertFixtureCount(new Array(EXPECTED_FIXTURE_COUNT).fill({})), EXPECTED_FIXTURE_COUNT);
	assert.throws(() => assertFixtureCount([]), /whole decision table/);
	assert.throws(() => assertFixtureCount(new Array(3).fill({})), /expected 17 fixture rows/);
});

test('parseArgs has reproducible defaults and rejects nonsense', () => {
	const defaults = parseArgs([]);
	assert.equal(defaults.screenshot, DEFAULT_SCREENSHOT);
	assert.equal(defaults.width, 1440);
	assert.equal(defaults.capture, true);
	assert.equal(parseArgs(['--no-capture']).capture, false);
	assert.equal(parseArgs(['--width=1200']).width, 1200);
	assert.throws(() => parseArgs(['--width=wide']), /--width/);
	assert.throws(() => parseArgs(['--nope']), /unknown option/);
});

test('the evidence is produced by the shipped policy, not a copy', async () => {
	const evidence = await collectEvidence();
	assert.equal(evidence.rows.length, EXPECTED_FIXTURE_COUNT);
	assert.equal(evidence.gate.violations.length, 0);
	// The collision catalog is fixed data: two findings every run.
	assert.deepEqual(
		evidence.collisions.map((collision) => collision.kind).sort(),
		['duplicate-url', 'normalization-alias'],
	);
	// Every accepted slug is ASCII, so the artefact can state the
	// guarantee rather than assert it.
	for (const row of evidence.rows) {
		for (const verdict of row.verdicts) {
			if (!verdict.ok) continue;
			assert.ok([...verdict.slug].every((char) => (char.codePointAt(0) ?? 0) <= 0x7f));
		}
	}
});

test('buildReportHtml renders one row per fixture and escapes command output', () => {
	const evidence = {
		palette: '--bg-canvas: #ffffff;',
		fonts: { body: 'system-ui', heading: 'system-ui', mono: 'monospace' },
		rows: [
			{
				id: 'demo',
				displayText: 'Caf\u00e9',
				displayForm: 'NFC',
				compatFoldRisk: false,
				compatibilityChanges: [],
				candidate: 'caf\u00e9',
				verdicts: [
					{ ok: false, reason: 'non-ascii', offenders: [] },
					{ ok: true, slug: 'cafe' },
				],
			},
		],
		collisions: [{ kind: 'duplicate-url', key: 'cafe', detail: '2 entries claim /cafe' }],
		naiveCollisions: [],
		gate: { lines: ['[i18n:policy:check] OK <b>not markup</b>'], violations: [] },
	};
	const html = buildReportHtml(evidence);
	assert.match(html, /<html lang="ja">/);
	assert.equal(html.match(/<td class="id">/g).length, 1, 'one fixture row per decision-table entry');
	assert.match(html, /<td><code>duplicate-url<\/code><\/td>/);
	assert.match(html, /拒否 \(non-ascii\)/);
	assert.match(html, /受理 \/cafe/);
	assert.match(html, /&lt;b&gt;not markup&lt;\/b&gt;/);
	assert.equal(html.includes('<b>not markup</b>'), false);
});

test('buildReportHtml states what the artefact does NOT prove', async () => {
	const html = buildReportHtml(await collectEvidence());
	assert.match(html, /証明していないこと/);
	assert.match(html, /自動品質保証の証拠ではない/);
});

test('buildPalette resolves the shipped semantic tokens into CSS', async () => {
	const [editorial, semantic] = await Promise.all([
		import('../src/editorial/tokens.ts'),
		import('../src/editorial/semantic-tokens.ts'),
	]);
	const palette = buildPalette(editorial.rawTokens, semantic.semanticTokens);
	assert.match(palette, /--bg-canvas: #[0-9a-f]{6};/);
	assert.equal(palette.includes('{colors.'), false, 'no unresolved token reference may reach the CSS');
});