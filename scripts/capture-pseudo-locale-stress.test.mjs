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
 *      browser's facts mean. That decision is the only part of the
 *      capture that can produce a false green, so it is asserted
 *      against hand-built facts — an overflowing frame, a missing
 *      meaning token, unbalanced isolates, a missing webfont — instead
 *      of being trusted to a Chromium run nobody re-reads.
 *
 * The screenshot itself is not asserted here; it is a committed
 * artefact with a human-readable report next to it.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	SURFACE_SAMPLE_IDS,
	buildReportModel,
	evaluateMeasurement,
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
	const id = SURFACE_SAMPLE_IDS[0];
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
	const rows = SURFACE_SAMPLE_IDS.map((id, index) => auditRow({ id }));
	const samples = SURFACE_SAMPLE_IDS.map((id, index) => sample({ id, text: `source ${index}` }));
	const html = renderReportHtml(modelWith(rows, samples));
	for (const id of SURFACE_SAMPLE_IDS) {
		assert.equal(html.match(new RegExp(`data-pseudo-surface="${id}"`, 'g'))?.length, 1);
	}
	// Two frames per surface row: source and expansion.
	assert.equal(html.match(/data-pseudo-frame="before"/g)?.length, SURFACE_SAMPLE_IDS.length);
	assert.equal(html.match(/data-pseudo-frame="after"/g)?.length, SURFACE_SAMPLE_IDS.length);
	// Every audited row still appears in the verdict table.
	for (const id of SURFACE_SAMPLE_IDS) {
		assert.ok(html.includes(`data-pseudo-audit="${id}"`));
	}
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

/** A passing measurement: nothing overflows, every token reached the DOM. */
function passingMeasurement(overrides = {}) {
	return evaluateMeasurement({
		page: { viewportWidth: 1440, documentScrollWidth: 1440 },
		frames: [
			{ id: 'row-1', phase: 'before', scrollWidth: 320, clientWidth: 320, text: 'source row 1' },
			{ id: 'row-1', phase: 'after', scrollWidth: 320, clientWidth: 320, text: 'read-only stays' },
		],
		meaningTokens: [{ id: 'row-1', token: 'read-only' }],
		isolates: [{ id: 'rtl-1', lri: 2, pdi: 2 }],
		webfontLoaded: true,
		audit: { ok: true },
		...overrides,
	});
}

test('a measurement that broke nothing is accepted', () => {
	assert.deepEqual(passingMeasurement(), { ok: true, findings: [] });
});

test('a frame that overflows horizontally fails the run', () => {
	const verdict = passingMeasurement({
		frames: [
			{ id: 'row-1', phase: 'before', scrollWidth: 320, clientWidth: 320, text: '' },
			{ id: 'row-1', phase: 'after', scrollWidth: 361, clientWidth: 320, text: '' },
		],
	});
	assert.equal(verdict.ok, false);
	assert.match(verdict.findings.join(' '), /frame row-1 \(after\) overflows: 361 > 320/);
});

test('the page overflowing fails the run even when every frame held', () => {
	const verdict = passingMeasurement({
		page: { viewportWidth: 1440, documentScrollWidth: 1600 },
	});
	assert.equal(verdict.ok, false);
	assert.match(verdict.findings.join(' '), /the page overflows horizontally: 1600 > 1440/);
});

test('a meaning token that did not reach the DOM fails the run', () => {
	const verdict = passingMeasurement({
		frames: [
			{ id: 'row-1', phase: 'before', scrollWidth: 320, clientWidth: 320, text: '' },
			{
				id: 'row-1',
				phase: 'after',
				scrollWidth: 320,
				clientWidth: 320,
				text: 'read\u00B7\u0301-only',
			},
		],
	});
	assert.equal(verdict.ok, false);
	assert.match(
		verdict.findings.join(' '),
		/meaning token "read-only" did not reach the DOM of row row-1/,
	);
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
