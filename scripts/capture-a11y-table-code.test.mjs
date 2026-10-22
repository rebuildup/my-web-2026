/**
 * The Issue #407 capture's own unit tests.
 *
 * The capture is an assertion, so its decision function has to be
 * testable without a browser: `evaluateObservation` is what decides
 * whether an artefact may be written, and a version that can only fail
 * inside Chromium is one nobody re-runs when it breaks.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	EXPECTED_CASE_IDS,
	FOCUS_AND_READ,
	GUTTER,
	HARNESS_DIST,
	MOUNT_WAIT_ATTEMPTS,
	PANEL_WIDTH,
	READ_DOCUMENT,
	READ_SCROLL_LEFT,
	SCREENSHOT_BUDGET_BYTES,
	SCREENSHOT_MAX_WIDTH,
	SCROLL_SETTLE_ATTEMPTS,
	SCROLL_SETTLE_INTERVAL_MS,
	WCAG_MAPPING,
	assertWebpOutputPath,
	escapeXml,
	evaluateObservation,
	evidencePanelSvg,
	evidenceRows,
	harnessIndexHtml,
	harnessMainTsx,
	harnessViteConfig,
	headerSvg,
	resolveStaticTarget,
	screenshotBudgetVerdict,
} from './capture-a11y-table-code.mjs';
import { collectEvidence } from './check-table-code-a11y.mjs';

/** One healthy fixture state, as the browser would report it. */
function healthyObservation(overrides = {}) {
	return {
		viewportWidth: 375,
		documentScrollWidth: 375,
		documentClientWidth: 375,
		cases: EXPECTED_CASE_IDS.map((caseId) => ({
			caseId,
			tables: [
				{
					name: 'WCAG 2.2 success criteria',
					captionCount: 1,
					captionText: 'WCAG 2.2 success criteria',
					thTotal: 4,
					thScoped: 4,
					focusable: true,
					named: true,
					overflows: true,
					scrollWidth: 640,
					clientWidth: 327,
					scrollLeftAfterArrowKey: 40,
				},
			],
			codes: [
				{
					name: 'Sample markup',
					focusable: true,
					overflows: true,
					scrollWidth: 720,
					clientWidth: 327,
					scrollLeftAfterArrowKey: 40,
				},
			],
		})),
		...overrides,
	};
}

test('a healthy mobile observation passes', () => {
	const verdict = evaluateObservation(healthyObservation());

	assert.deepEqual(verdict.failures, []);
	assert.equal(verdict.ok, true);
});

test('a sideways-scrolling document is the 1.4.10 failure', () => {
	const verdict = evaluateObservation(
		healthyObservation({ documentScrollWidth: 900, documentClientWidth: 375 }),
	);

	assert.equal(verdict.ok, false);
	assert.match(verdict.failures[0], /1\.4\.10/);
});

test('a missing fixture state fails instead of verifying three of four', () => {
	const observation = healthyObservation();
	observation.cases = observation.cases.filter((entry) => entry.caseId !== '03-failure');

	const verdict = evaluateObservation(observation);

	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /03-failure/);
});

test('an unscoped header cell is the 1.3.1 failure', () => {
	const observation = healthyObservation();
	observation.cases[0].tables[0].thScoped = 3;

	const verdict = evaluateObservation(observation);

	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /1 unscoped header cell/);
});

test('an overflowing box the keyboard cannot move is the 2.1.1 failure', () => {
	const observation = healthyObservation();
	observation.cases[0].tables[0].scrollLeftAfterArrowKey = 0;

	const verdict = evaluateObservation(observation);

	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /ArrowRight did not move it/);
});

test('a box that fits is not required to move', () => {
	const observation = healthyObservation();
	observation.cases[0].tables[0].overflows = false;
	observation.cases[0].tables[0].scrollLeftAfterArrowKey = 0;

	assert.equal(evaluateObservation(observation).ok, true);
});

test('an unnamed or unfocusable region fails', () => {
	const observation = healthyObservation();
	observation.cases[0].tables[0].named = false;
	observation.cases[0].tables[0].focusable = false;
	observation.cases[0].codes[0].focusable = false;

	const failures = evaluateObservation(observation).failures.join('\n');

	assert.match(failures, /accessible name/);
	assert.match(failures, /not focusable/);
});

test('an empty caption fails even though the region is focusable', () => {
	const observation = healthyObservation();
	observation.cases[0].tables[0].captionText = '';

	assert.match(evaluateObservation(observation).failures.join('\n'), /empty caption/);
});

test('the capture refuses any artefact path that is not WebP inside the repo', () => {
	assert.equal(
		assertWebpOutputPath('docs/verification/a11y/table-code-mobile.webp'),
		'docs/verification/a11y/table-code-mobile.webp',
	);
	assert.throws(() => assertWebpOutputPath('docs/verification/a11y/table-code-mobile.png'));
	assert.throws(() => assertWebpOutputPath('../outside.webp'));
});

test('the screenshot budget is the one the Issue policy states', () => {
	assert.equal(SCREENSHOT_MAX_WIDTH, 1600);
	assert.equal(SCREENSHOT_BUDGET_BYTES, 300 * 1024);
	assert.equal(screenshotBudgetVerdict(120_000).withinBudget, true);
	assert.equal(screenshotBudgetVerdict(400_000).withinBudget, false);
});

test('the harness renders the shipped fixture and the shipped stylesheet', () => {
	const entry = harnessMainTsx();
	assert.match(entry, /src\/styles\.css/);
	assert.match(entry, /TableCodeFixture/);
	assert.match(entry, /createRoot/);
	assert.match(harnessIndexHtml(), /<div id="root">/);
	assert.match(harnessViteConfig(), /outDir/);
	assert.match(HARNESS_DIST, /^\.tmp\//);
	assert.ok(MOUNT_WAIT_ATTEMPTS >= 1, 'the wait must be bounded');
});

test('the scroll settle wait is bounded', () => {
	// Chromium animates keyboard scrolling; waiting forever would turn a
	// box that does not move into a hung capture.
	assert.ok(SCROLL_SETTLE_ATTEMPTS >= 2 && SCROLL_SETTLE_ATTEMPTS <= 20);
	assert.ok(SCROLL_SETTLE_INTERVAL_MS <= 500);
	// The reader itself runs in Chromium; only its shape is asserted here.
	assert.match(READ_SCROLL_LEFT.toString(), /scrollLeft/);
});

test('the keyboard probe takes its arguments as one serialisable object', () => {
	// Playwright passes a single argument into `page.evaluate`; a second
	// positional one only fails inside Chromium.
	// The body runs in Chromium, so only its signature is asserted here;
	// its behaviour is asserted by the capture itself.
	assert.match(FOCUS_AND_READ.toString(), /\{ *selector, index *\}/);
});

test('the browser-side readers are self-contained functions', () => {
	// They are serialised into Chromium, so a closure reference would be
	// a runtime failure in the capture rather than a test failure here.
	for (const fn of [READ_DOCUMENT, FOCUS_AND_READ, READ_SCROLL_LEFT]) {
		const source = fn.toString();
		assert.doesNotMatch(source, /\bimport\b/);
		assert.doesNotMatch(source, /require\(/);
	}
});

test('the evidence panel reports one row per measured surface', () => {
	const rows = evidenceRows(healthyObservation());

	assert.equal(rows.length, EXPECTED_CASE_IDS.length * 3);
	assert.ok(rows[0].startsWith('01-normal table'));
	assert.match(rows[1], /arrow-key scrollLeft=40px/);
	assert.match(rows.join('\n'), /04-compact code/);
});

test('the header names the WCAG mapping and separates human evaluation', () => {
	const gate = collectEvidence();
	const { height, svg } = headerSvg({ observation: healthyObservation(), gate });

	assert.ok(height > 100);
	assert.match(svg, /Issue #407/);
	assert.match(svg, /SC 1\.4\.10 Reflow, AA/);
	assert.match(svg, /not machine-checked/);
	for (const entry of WCAG_MAPPING) assert.ok(svg.includes(`${entry.sc} ${entry.level}`));
});

test('the evidence panel lists the gate verdict and the human-evaluation list', () => {
	const panel = evidencePanelSvg({
		observation: healthyObservation(),
		gate: collectEvidence(),
		width: SCREENSHOT_MAX_WIDTH - PANEL_WIDTH - GUTTER,
	});

	assert.match(panel.svg, /machine-checked per surface/);
	assert.match(panel.svg, /human evaluation \(not measured here\)/);
	assert.ok(panel.height > 100);
});

test('text drawn into an SVG band is escaped', () => {
	// The panel text carries measured numbers and fixture names, so the
	// escaper is asserted directly: an unescaped `<` in the band would
	// silently truncate the SVG.
	assert.equal(escapeXml('<script> & "x"'), '&lt;script&gt; &amp; &quot;x&quot;');
	assert.doesNotMatch(escapeXml('a < b & c'), /[<>](?!\w)/);
});

test('a request cannot escape the served root', () => {
	const root = process.cwd();

	assert.equal(resolveStaticTarget(root, '/../../etc/passwd').status, 403);
	assert.equal(resolveStaticTarget(root, '/package.json').status, 200);
	assert.equal(resolveStaticTarget(root, '/definitely-missing').status, 404);
});
