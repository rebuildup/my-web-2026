/**
 * The Issue #396 capture's own unit tests.
 *
 * The capture is an assertion, so its decision function has to be
 * testable without a browser: `evaluateObservation` is what decides
 * whether an artefact may be written, and a version that can only fail
 * inside Chromium is one nobody re-runs when it breaks.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	CASES,
	FIXTURE_SELECTOR,
	GUTTER,
	HARNESS_DIST,
	PANEL_WIDTH,
	READ_CASES,
	SCREENSHOT_BUDGET_BYTES,
	SCREENSHOT_MAX_WIDTH,
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
} from './capture-a11y-icon-button-names.mjs';
import { collectEvidence } from './check-a11y-icon-button-names.mjs';

/** One healthy observation, as the browser would report it. */
function healthyObservation(overrides = {}) {
	return {
		cases: [
			{
				caseId: 'named',
				label: 'named icon button',
				expectation: 'named',
				hasButton: true,
				hasIcon: true,
				nameSource: 'aria-label',
				resolvedName: 'Close',
			},
			{
				caseId: 'unnamed',
				label: 'icon button without a name',
				expectation: 'unnamed',
				hasButton: true,
				hasIcon: true,
				nameSource: 'none',
				resolvedName: '',
			},
		],
		accessibilitySnapshot: '- button "Close"\n- button',
		...overrides,
	};
}

test('a healthy observation passes', () => {
	const verdict = evaluateObservation(healthyObservation());

	assert.deepEqual(verdict.failures, []);
	assert.equal(verdict.ok, true);
});

test('a named case that resolves no name fails', () => {
	const observation = healthyObservation();
	observation.cases[0].resolvedName = '';

	const verdict = evaluateObservation(observation);

	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /SC 4\.1\.2/);
});

test('an unnamed case that resolves a name fails: the defect is gone', () => {
	const observation = healthyObservation();
	observation.cases[1].resolvedName = 'Close';

	const verdict = evaluateObservation(observation);

	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /the defect this artefact reproduces is gone/);
});

test('a missing case fails instead of verifying one of two', () => {
	const observation = healthyObservation();
	observation.cases = observation.cases.filter((entry) => entry.caseId !== 'unnamed');

	const verdict = evaluateObservation(observation);

	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /unnamed/);
});

test('a case without a button or without an icon fails', () => {
	const observation = healthyObservation();
	observation.cases[0].hasButton = false;
	observation.cases[1].hasIcon = false;

	const failures = evaluateObservation(observation).failures.join('\n');

	assert.match(failures, /no button rendered/);
	assert.match(failures, /carries no icon/);
});

test('the capture refuses any artefact path that is not WebP inside the repo', () => {
	assert.equal(
		assertWebpOutputPath('docs/verification/a11y/icon-button-names.webp'),
		'docs/verification/a11y/icon-button-names.webp',
	);
	assert.throws(() => assertWebpOutputPath('docs/verification/a11y/icon-button-names.png'));
	assert.throws(() => assertWebpOutputPath('../outside.webp'));
});

test('the screenshot budget is the one the Issue policy states', () => {
	assert.equal(SCREENSHOT_MAX_WIDTH, 1600);
	assert.equal(SCREENSHOT_BUDGET_BYTES, 300 * 1024);
	assert.equal(screenshotBudgetVerdict(120_000).withinBudget, true);
	assert.equal(screenshotBudgetVerdict(400_000).withinBudget, false);
});

test('the harness renders the repository fixtures themselves', () => {
	const entry = harnessMainTsx();

	for (const entryCase of CASES) {
		assert.ok(entry.includes(entryCase.module.replace(/\.tsx$/, '')));
		assert.ok(entry.includes(entryCase.exportName));
	}
	assert.match(entry, /createRoot/);
	assert.match(entryIndex(), /<div id="root">/);
	assert.match(harnessViteConfig(), /outDir/);
	assert.match(HARNESS_DIST, /^\.tmp\//);
	assert.match(FIXTURE_SELECTOR, /^\[data-a11y-case\]$/);
});

/** The generated page, for the assertion above. */
function entryIndex() {
	return harnessIndexHtml();
}

test('the browser-side reader is a self-contained function', () => {
	// It is serialised into Chromium, so a closure reference would be a
	// runtime failure in the capture rather than a test failure here.
	const source = READ_CASES.toString();

	assert.doesNotMatch(source, /\bimport\b/);
	assert.doesNotMatch(source, /require\(/);
	assert.match(source, /aria-label/);
});

test('the evidence panel reports one row per measured case', () => {
	const rows = evidenceRows(healthyObservation());

	assert.equal(rows.length, 2);
	assert.match(rows[0], /named\s+name-source=aria-label\s+resolved="Close"/);
	assert.match(rows[1], /unnamed\s+name-source=none\s+resolved=""/);
});

test('the header names the WCAG mapping and separates human evaluation', () => {
	const gate = collectEvidence();
	const { height, svg } = headerSvg({ observation: healthyObservation(), gate });

	assert.ok(height > 100);
	assert.match(svg, /Issue #396/);
	assert.match(svg, /SC 4\.1\.2/);
	assert.match(svg, /not machine-checked/);
	for (const entry of WCAG_MAPPING) assert.ok(svg.includes(`${entry.sc} ${entry.level}`));
});

test('the evidence panel lists the accessibility tree and the human-evaluation list', () => {
	const panel = evidencePanelSvg({
		observation: healthyObservation(),
		gate: collectEvidence(),
		width: SCREENSHOT_MAX_WIDTH - PANEL_WIDTH - GUTTER,
	});

	assert.match(panel.svg, /machine-checked per case/);
	assert.match(panel.svg, /Chromium accessibility tree/);
	assert.match(panel.svg, /human evaluation \(not measured here\)/);
	assert.ok(panel.height > 100);
});

test('text drawn into an SVG band is escaped', () => {
	assert.equal(escapeXml('<script> & "x"'), '&lt;script&gt; &amp; &quot;x&quot;');
	assert.doesNotMatch(escapeXml('a < b & c'), /[<>](?!\w)/);
});

test('a request cannot escape the served root', () => {
	const root = process.cwd();

	assert.equal(resolveStaticTarget(root, '/../../etc/passwd').status, 403);
	assert.equal(resolveStaticTarget(root, '/package.json').status, 200);
	assert.equal(resolveStaticTarget(root, '/definitely-missing').status, 404);
});
