#!/usr/bin/env node --test
/**
 * capture-pseudo-locale-stress — pure-helper contract (Issue #429).
 *
 * What this covers, and why the browser is not in it
 * -------------------------------------------------
 * The capture's browser run is an evidence step: it screenshots a
 * report and exits non-zero when a frame breaks. Two things about it
 * can still rot silently, and both are testable here:
 *
 *   1. **The report text.** The HTML escapes every fixture string, so
 *      fixture data cannot rewrite the artefact that is supposed to
 *      prove the fixture, and the report prints the limits verbatim so
 *      a green screenshot cannot be read as more than it is.
 *   2. **The verdict logic.** `evaluateMeasurement` decides what the
 *      browser's facts mean, and `evaluateRun` decides what a pair of
 *      measurements (shipped breaking rules, and the same frames with a
 *      fixture-local mitigation) means together. Those decisions are the
 *      only part of the capture that can produce a false green, so they
 *      are asserted against hand-built facts — an overflowing frame, a
 *      missing meaning token, an isolate the renderer dropped, an
 *      unbalanced declaration, a missing webfont, a frame that overflows
 *      only without the mitigation — instead of being trusted to a
 *      Chromium run nobody re-reads.
 *
 * The screenshot itself is not asserted here; it is a committed
 * artefact with a human-readable report next to it.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { PSEUDO_SURFACE_SAMPLE_IDS } from '../src/i18n/pseudo-locale.ts';
import {
	buildReportModel,
	evaluateMeasurement,
	evaluateRun,
	renderReportHtml,
} from './capture-pseudo-locale-stress.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A report row shaped like the one `auditPseudoSamples()` produces. */
function auditRow(overrides = {}) {
	return {
		id: 'row-1',
		subject: 'a subject',
		direction: 'ltr',
		sourceCodePoints: 10,
		expandedCodePoints: 15,
		expandedTextCodePoints: 15,
		ratio: 1.5,
		ratioTarget: 1.5,
		expandable: true,
		expandableSlots: 6,
		protectedCodePoints: 0,
		whitespacePreserved: true,
		digitRunsPreserved: true,
		digitRuns: [],
		collapsesToSource: true,
		meaningTokens: [],
		bidi: { isolates: { lri: 0, pdi: 0 }, balanced: true, deprecatedControls: [] },
		longestWord: 6,
		expandedLongestWord: 9,
		documentedLimits: [],
		findings: [],
		ok: true,
		expandedText: 'expanded row 1',
		...overrides,
	};
}

function sample(overrides = {}) {
	return {
		id: 'row-1',
		subject: 'a subject',
		lang: 'en',
		direction: 'ltr',
		text: 'source row 1',
		meaningTokens: [],
		note: 'why this row exists',
		...overrides,
	};
}

function modelWith(rows = [auditRow()], samples = [sample()], limits = ['Not a translation.']) {
	return buildReportModel({
		audit: {
			samples: rows,
			passing: rows.filter((row) => row.ok).length,
			failing: rows.filter((row) => !row.ok).length,
			ok: rows.every((row) => row.ok),
		},
		samples,
		surfaceIds: PSEUDO_SURFACE_SAMPLE_IDS,
		fonts: {
			heading: '"Zen Kaku Gothic New", sans-serif',
			sans: '"Noto Sans JP", sans-serif',
			mono: 'monospace',
		},
		fontHref: 'https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New',
		limits,
	});
}

test('the report prints the shipped font stacks, not a restated font', () => {
	const model = modelWith();
	const html = renderReportHtml(model);
	assert.match(html, /--font-heading: "Zen Kaku Gothic New", sans-serif;/);
	assert.match(html, /fonts\.googleapis\.com\/css2\?family=Zen\+Kaku\+Gothic\+New/);
});

test('the report escapes fixture data so a row cannot rewrite the artefact', () => {
	// The injected subject rides on a surface row, because that is where
	// a fixture string is rendered OUTSIDE the escaped verdict table.
	const id = PSEUDO_SURFACE_SAMPLE_IDS[0];
	const model = modelWith(
		[auditRow({ id })],
		[sample({ id, subject: '<script>alert(1)</script>', text: 'a < b & c' })],
	);
	const html = renderReportHtml(model);
	assert.ok(
		!html.includes('<script>alert(1)</script>'),
		'fixture subject reached the document raw',
	);
	assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
	assert.match(html, /a &lt; b &amp; c/);
});

test('the report prints the source and the expansion side by side', () => {
	const html = renderReportHtml(modelWith());
	assert.match(html, /source row 1/);
	assert.match(html, /expanded row 1/);
	assert.match(html, /1\.500/);
});

test('the report prints the limits verbatim, so a green picture is not read as RTL support', () => {
	const limits = [
		'Not RTL support. Mirroring and an RTL locale entry remain undecided owner decisions.',
	];
	const html = renderReportHtml(modelWith([auditRow()], [sample()], limits));
	assert.match(html, /Not RTL support\./);
	assert.match(html, /remain undecided owner decisions\./);
});

test('the report draws only the surface rows, before and after', () => {
	const rows = PSEUDO_SURFACE_SAMPLE_IDS.map((id) => auditRow({ id }));
	const samples = PSEUDO_SURFACE_SAMPLE_IDS.map((id, index) =>
		sample({ id, text: `source ${index}` }),
	);
	const html = renderReportHtml(modelWith(rows, samples));
	for (const id of PSEUDO_SURFACE_SAMPLE_IDS) {
		assert.equal(html.match(new RegExp(`data-pseudo-surface="${id}"`, 'g'))?.length, 1);
	}
	// Two frames per surface row: source and expansion.
	assert.equal(html.match(/data-pseudo-frame="before"/g)?.length, PSEUDO_SURFACE_SAMPLE_IDS.length);
	assert.equal(html.match(/data-pseudo-frame="after"/g)?.length, PSEUDO_SURFACE_SAMPLE_IDS.length);
	// Every audited row still appears in the verdict table.
	for (const id of PSEUDO_SURFACE_SAMPLE_IDS) {
		assert.ok(html.includes(`data-pseudo-audit="${id}"`));
	}
});

test('the `before` frame carries the source string, not the expansion', () => {
	// Two frames under a `source` caption that both render the expansion
	// would be one measurement wearing two labels.
	const ids = PSEUDO_SURFACE_SAMPLE_IDS;
	const html = renderReportHtml(
		modelWith(
			ids.map((id) => auditRow({ id, expandedText: `expanded ${id}` })),
			ids.map((id) => sample({ id, text: `source words of ${id}` })),
		),
	);
	const before = /data-pseudo-frame="before"[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';
	assert.match(before, /source words of /);
	assert.ok(!before.includes('expanded '), 'the before frame renders the expansion');
});

test('the report separates the shipped rules from the fixture-local mitigation', () => {
	const html = renderReportHtml(modelWith());
	// The shipped rule is restated, so the measurement is never made
	// against CSS the product does not declare.
	assert.match(html, /word-break: auto-phrase;/);
	assert.match(html, /h3 \{ font-size: 18px; line-height: 1\.3; margin: 0; text-wrap: balance; \}/);
	// And the extra declaration is labelled as this report's, not the
	// editorial language's.
	assert.match(html, /html\.breaks-anywhere h3 \{ overflow-wrap: anywhere; \}/);
	assert.match(html, /NOT an editorial recipe/);
	assert.match(html, /data-role="shipped-overflow"/);
});

test('a failing audit row is printed as a failure, not hidden', () => {
	const html = renderReportHtml(
		modelWith([
			auditRow({ ok: false, findings: ['expansion reached 1.100x, below the 1.5x target'] }),
		]),
	);
	assert.match(html, /expansion reached 1\.100x, below the 1\.5x target/);
	assert.match(html, /class="bad"/);
});

/** A rendered frame fact, as the browser pass reports one. */
function frame(overrides = {}) {
	return {
		id: 'row-1',
		phase: 'before',
		scrollWidth: 320,
		clientWidth: 320,
		headingText: 'source row 1',
		isolates: { lri: 0, pdi: 0 },
		...overrides,
	};
}

/** A passing measurement: nothing overflows, every token reached the heading. */
function passingMeasurement(overrides = {}) {
	return evaluateMeasurement({
		page: { viewportWidth: 1440, documentScrollWidth: 1440 },
		frames: [frame(), frame({ phase: 'after', headingText: 'read-only stays' })],
		meaningTokens: [{ id: 'row-1', token: 'read-only' }],
		isolates: [{ id: 'rtl-1', lri: 2, pdi: 2 }],
		webfontLoaded: true,
		audit: { ok: true },
		...overrides,
	});
}

test('a measurement that broke nothing is accepted', () => {
	assert.deepEqual(passingMeasurement(), { ok: true, findings: [], layoutFindings: [] });
});

test('a frame that overflows horizontally fails the run', () => {
	const verdict = passingMeasurement({
		frames: [frame(), frame({ phase: 'after', scrollWidth: 361 })],
	});
	assert.equal(verdict.ok, false);
	assert.match(verdict.findings.join(' '), /frame row-1 \(after\) overflows: 361 > 320/);
});

test('a frame overflow is separated from the string-level findings', () => {
	// The one class of finding a CSS change can resolve, so the run-level
	// verdict has to be able to tell it apart from a lost token.
	const verdict = passingMeasurement({
		frames: [frame(), frame({ phase: 'after', scrollWidth: 361, headingText: 'read-only broke' })],
	});
	assert.deepEqual(verdict.layoutFindings, ['frame row-1 (after) overflows: 361 > 320']);
	assert.equal(verdict.ok, false);
});

test('the page overflowing fails the run even when every frame held', () => {
	const verdict = passingMeasurement({
		page: { viewportWidth: 1440, documentScrollWidth: 1600 },
	});
	assert.equal(verdict.ok, false);
	assert.match(verdict.findings.join(' '), /the page overflows horizontally: 1600 > 1440/);
});

test('a meaning token that did not reach the heading fails the run', () => {
	const verdict = passingMeasurement({
		frames: [frame(), frame({ phase: 'after', headingText: 'read\u00B7\u0301-only' })],
	});
	assert.equal(verdict.ok, false);
	assert.match(
		verdict.findings.join(' '),
		/meaning token "read-only" did not reach the rendered heading of row row-1/,
	);
});

test('a call-to-action chip cannot vouch for the heading it is checked against', () => {
	// The frame also renders a chip built from the same token list, so a
	// frame-wide search would pass a heading whose expansion had broken
	// the token. Only the heading node counts.
	const verdict = passingMeasurement({
		frames: [frame(), frame({ phase: 'after', headingText: 'read\u00B7\u0301-only' })],
	});
	assert.equal(verdict.ok, false);
});

test('a token with no rendered frame is a finding, not a silent pass', () => {
	const verdict = passingMeasurement({ frames: [] });
	assert.equal(verdict.ok, false);
	assert.match(verdict.findings.join(' '), /no rendered frame for row row-1/);
});

test('unbalanced isolates fail the run', () => {
	const verdict = passingMeasurement({ isolates: [{ id: 'rtl-1', lri: 2, pdi: 1 }] });
	assert.equal(verdict.ok, false);
	assert.match(verdict.findings.join(' '), /rtl-1 declares unbalanced isolates \(2\/1\)/);
});

test('an isolate the renderer dropped is a finding, not a check that cannot fail', () => {
	// The declared counts are balanced here; what differs is the TEXT
	// the browser laid out. Counting U+2066/U+2069 in the rendered
	// heading is what makes this assertion able to fail at all.
	const verdict = passingMeasurement({
		frames: [
			frame(),
			frame({
				id: 'rtl-1',
				phase: 'after',
				headingText: 'a run with no isolate in it',
				isolates: { lri: 0, pdi: 0 },
			}),
		],
		isolates: [{ id: 'rtl-1', lri: 2, pdi: 2 }],
	});
	assert.equal(verdict.ok, false);
	assert.match(
		verdict.findings.join(' '),
		/rtl-1: the rendered heading carries 0\/0 U\+2066\/U\+2069, but the row declares 2\/2/,
	);
});

test('an unloaded webfont fails the run, so a fallback-only run cannot read as coverage', () => {
	const verdict = passingMeasurement({ webfontLoaded: false });
	assert.equal(verdict.ok, false);
	assert.match(verdict.findings.join(' '), /the shipped webfont did not load/);
});

test('a failing fixture row fails the capture even when the browser is happy', () => {
	const verdict = passingMeasurement({ audit: { ok: false } });
	assert.equal(verdict.ok, false);
	assert.match(verdict.findings.join(' '), /the fixture audit itself reported a failing row/);
});

test('a frame that overflows only under the shipped rules is recorded, not failed', () => {
	// The shipped language has no freer break rule for a heading, so a
	// long compound overflows until `src/editorial/` decides otherwise.
	// That is a product observation; the run still passes, and says so.
	const shipped = passingMeasurement({
		frames: [frame(), frame({ phase: 'after', scrollWidth: 361, headingText: 'read-only stays' })],
	});
	const run = evaluateRun({ shipped, mitigated: passingMeasurement() });
	assert.equal(run.ok, true);
	assert.deepEqual(run.shippedOverflow, ['frame row-1 (after) overflows: 361 > 320']);
	assert.match(run.notes.join(' '), /overflow under the SHIPPED breaking rules/);
});

test('a frame that overflows even with the mitigation fails the run', () => {
	const broken = passingMeasurement({
		frames: [frame(), frame({ phase: 'after', scrollWidth: 361 })],
	});
	const run = evaluateRun({ shipped: broken, mitigated: broken });
	assert.equal(run.ok, false);
	assert.match(run.notes.join(' '), /even with the fixture-local overflow-wrap: anywhere/);
});

test('a lost token under the shipped rules fails the run even when the mitigation is green', () => {
	const shipped = passingMeasurement({
		frames: [frame(), frame({ phase: 'after', headingText: 'read\u00B7\u0301-only' })],
	});
	const run = evaluateRun({ shipped, mitigated: passingMeasurement() });
	assert.equal(run.ok, false);
	assert.match(run.findings.join(' '), /did not reach the rendered heading/);
});

/** Every `.ts` / `.tsx` under `src/`, depth first. */
function sourceFiles(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : [];
	});
}

test('no shipped runtime module imports the pseudo fixture', () => {
	// The fixture's strings are unapproved stress copy. Only the tests,
	// the capture and the Storybook preview may read them; if a route,
	// a server function or a component imported this module, the strings
	// would be one refactor away from shipping.
	const offenders = sourceFiles(join(REPO_ROOT, 'src'))
		.filter((path) => {
			const repoPath = relative(REPO_ROOT, path).split('\\').join('/');
			if (repoPath.startsWith('src/i18n/')) return false;
			if (/\.(test|spec|stories)\.tsx?$/.test(repoPath)) return false;
			return /from\s+['"][^'"]*i18n\/pseudo-locale(\.ts)?['"]/.test(readFileSync(path, 'utf8'));
		})
		.map((path) => relative(REPO_ROOT, path));
	assert.deepEqual(
		offenders,
		[],
		`shipped modules import the pseudo fixture: ${offenders.join(', ')}`,
	);
});
