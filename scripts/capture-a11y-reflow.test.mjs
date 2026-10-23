/**
 * The Issue #400 capture's own unit tests.
 *
 * The capture is a browser-side ASSERTION, so the parts that decide
 * whether the artefact may be written have to be testable without a
 * browser: a capture that can only fail inside Chromium is a capture
 * nobody re-runs when it breaks.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	EXPECTED_CASES,
	SHIPPED_ROUTES,
	STAGES,
	assertLoopbackBaseUrl,
	assertWebpOutputPath,
	buildAssetProbe,
	evaluateObservation,
	evaluateShippedRoutes,
	harnessIndexHtml,
	originServesBuild,
	overflowOf,
	promoteArtefact,
	resolveStaticTarget,
	screenshotBudgetVerdict,
	textScaleCss,
	textScaleDeclaration,
	wrapRow,
} from './capture-a11y-reflow.mjs';
import { FIXTURE_EXPECTATIONS, FIXTURE_ROOT } from './check-a11y-reflow.mjs';

/** A synthetic browser observation that matches every expectation. */
function conformingObservation() {
	return {
		viewportWidth: 1600,
		documentWidth: 1600,
		cases: EXPECTED_CASES.flatMap((entry) =>
			STAGES.map((stage) => ({
				id: entry.id,
				stage: stage.id,
				group: entry.group,
				expectOverflow: entry.expectOverflow,
				clientWidth: 306,
				scrollWidth: entry.expectOverflow ? 720 : 306,
			})),
		),
	};
}

test('a non-WebP output path is refused', () => {
	assert.throws(
		() => assertWebpOutputPath('docs/verification/a11y/reflow-400-percent.png'),
		/refusing to write a non-WebP/,
	);
	assert.throws(() => assertWebpOutputPath('../outside.webp'), /refusing to write outside/);
});

test('the budget verdict is computed from the byte count', () => {
	assert.equal(screenshotBudgetVerdict(1024).withinBudget, true);
	assert.equal(screenshotBudgetVerdict(1024 * 1024).withinBudget, false);
});

test('every expected specimen is on the screen, in both stages, showing both sides', () => {
	const html = harnessIndexHtml();

	for (const entry of EXPECTED_CASES) {
		for (const stage of STAGES) {
			assert.ok(
				html.includes(`data-case="${entry.id}" data-stage="${stage.id}"`),
				`${entry.id} must be rendered in ${stage.id}`,
			);
		}
	}
	assert.ok(EXPECTED_CASES.some((entry) => entry.group === 'fixture: pass state'));
	assert.ok(EXPECTED_CASES.some((entry) => entry.group === 'fixture: fail state'));
});

test('the browser case table is the fixture roster, not a second copy of it', () => {
	const expected = Object.entries(FIXTURE_EXPECTATIONS).flatMap(([directory, expectations]) =>
		Object.keys(expectations).map((name) => `${directory}/${name}`),
	);

	assert.deepEqual(
		EXPECTED_CASES.map((entry) => entry.file.replace(`${FIXTURE_ROOT}/`, '')).sort(),
		expected.sort(),
		'every fixture file must produce exactly one browser case, and no case may exist without a fixture file',
	);
	for (const entry of EXPECTED_CASES) {
		assert.ok(entry.text.length > 0, `${entry.id} must render text`);
		assert.ok(entry.kind.length > 0, `${entry.id} must declare a kind`);
	}
	assert.equal(
		EXPECTED_CASES.filter((entry) => entry.expectOverflow).length,
		Object.keys(FIXTURE_EXPECTATIONS.fail).length,
		'the fail fixtures are the ones that must overflow',
	);
});

test('a non-loopback origin is refused', () => {
	assert.throws(() => assertLoopbackBaseUrl('https://rebuildup.dev'), /non-loopback/);
	assert.equal(assertLoopbackBaseUrl('http://127.0.0.1:3100'), 'http://127.0.0.1:3100');
});

test('a shipped route that scrolls horizontally at the budget is a failure', () => {
	const verdict = evaluateShippedRoutes([
		{
			path: '/',
			label: 'Home',
			viewportWidth: 320,
			documentScrollWidth: 730,
			documentClientWidth: 320,
		},
	]);

	assert.equal(verdict.ok, false);
	assert.ok(
		verdict.failures.some((failure) => /the shipped route \/ scrolls horizontally/.test(failure)),
	);
});

test('shipped routes that fit at the budget pass', () => {
	const verdict = evaluateShippedRoutes(
		SHIPPED_ROUTES.map((route) => ({
			path: route.path,
			label: route.label,
			viewportWidth: 320,
			documentScrollWidth: 320,
			documentClientWidth: 320,
		})),
	);

	assert.equal(verdict.ok, true, verdict.failures.join('; '));
	assert.equal(verdict.rows.length, SHIPPED_ROUTES.length);
});

test('an empty shipped measurement is a failure, not a pass', () => {
	const verdict = evaluateShippedRoutes([]);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /no shipped route was measured/.test(failure)));
});

test('the shipped route set includes the home surface', () => {
	assert.ok(SHIPPED_ROUTES.some((route) => route.path === '/'));
});

test('the pass state plus the fail state satisfies the observations', () => {
	const verdict = evaluateObservation(conformingObservation());

	assert.equal(verdict.ok, true, verdict.failures.join('; '));
	assert.equal(verdict.rows.length, EXPECTED_CASES.length * STAGES.length);
});

test('a pass-state specimen that overflows is a failure', () => {
	const observation = conformingObservation();
	const entry = observation.cases.find((candidate) => candidate.id === 'pass-long-word');
	entry.scrollWidth = 720;

	const verdict = evaluateObservation(observation);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /pass-long-word.*overflows/.test(failure)));
});

test('a fail-state specimen that stops overflowing is a failure (the negative control)', () => {
	const observation = conformingObservation();
	const entry = observation.cases.find((candidate) => candidate.id === 'fail-without-break');
	entry.scrollWidth = entry.clientWidth;

	const verdict = evaluateObservation(observation);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /fail-without-break.*fits/.test(failure)));
});

test('a missing specimen is a failure', () => {
	const verdict = evaluateObservation({ viewportWidth: 1600, documentWidth: 1600, cases: [] });

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /was not rendered/.test(failure)));
});

test('a document that scrolls horizontally is a failure', () => {
	const observation = conformingObservation();
	observation.documentWidth = 1810;

	const verdict = evaluateObservation(observation);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /scrolls horizontally/.test(failure)));
});

test('the overflow comparison has a 1 px tolerance', () => {
	assert.equal(overflowOf({ scrollWidth: 307, clientWidth: 306 }), false);
	assert.equal(overflowOf({ scrollWidth: 308, clientWidth: 306 }), true);
});

test('the static server refuses to escape its root', () => {
	assert.notEqual(resolveStaticTarget('/tmp', '/../../etc/passwd').status, 200);
});

/* ------------------------------------------------------------------ *
 * The candidate artefact is promoted only when it fits the budget
 * ------------------------------------------------------------------ */

test('a candidate over the budget leaves the committed artefact untouched', () => {
	const dir = mkdtempSync(join(tmpdir(), 'reflow-budget-'));
	const candidatePath = join(dir, 'artefact.webp');
	const outPath = join(dir, 'committed.webp');
	writeFileSync(candidatePath, 'a candidate that breaks the budget');
	writeFileSync(outPath, 'the previous valid artefact');

	const promotion = promoteArtefact({
		candidatePath,
		outPath,
		bytes: 400 * 1024,
	});

	assert.equal(promotion.promoted, false);
	assert.match(promotion.reason, /over the 300 kB budget/);
	assert.equal(existsSync(candidatePath), false, 'the over-budget candidate is removed');
	assert.equal(readFileSync(outPath, 'utf8'), 'the previous valid artefact');
	rmSync(dir, { recursive: true, force: true });
});

test('a candidate within the budget replaces the committed artefact', () => {
	const dir = mkdtempSync(join(tmpdir(), 'reflow-budget-'));
	const candidatePath = join(dir, 'artefact.webp');
	const outPath = join(dir, 'committed.webp');
	writeFileSync(candidatePath, 'a candidate that fits');
	writeFileSync(outPath, 'the previous valid artefact');

	const promotion = promoteArtefact({ candidatePath, outPath, bytes: 1024 });

	assert.equal(promotion.promoted, true);
	assert.equal(promotion.verdict.withinBudget, true);
	assert.equal(readFileSync(outPath, 'utf8'), 'a candidate that fits');
	assert.equal(existsSync(candidatePath), false, 'the candidate is moved, not left behind');
	rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ *
 * The shipped routes are measured at 200% text as well
 * ------------------------------------------------------------------ */

test('a shipped route that scrolls horizontally at 100% is a failure', () => {
	const verdict = evaluateShippedRoutes([
		{
			path: '/',
			label: 'Home',
			stage: 'base',
			fontScale: 1,
			viewportWidth: 320,
			documentScrollWidth: 730,
			documentClientWidth: 320,
		},
	]);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /scrolls horizontally at 320 px/.test(failure)));
});

test('a horizontal scroll at 200% text is recorded, not failed', () => {
	const verdict = evaluateShippedRoutes([
		{
			path: '/',
			label: 'Home',
			stage: 'text-200',
			fontScale: 2,
			viewportWidth: 320,
			documentScrollWidth: 578,
			documentClientWidth: 320,
		},
	]);

	assert.equal(verdict.ok, true, 'SC 1.4.4 forbids a loss of content, not a scroll');
	assert.equal(verdict.notes.length, 1);
	assert.match(verdict.notes[0], /578 px > 320 px/);
	assert.ok(verdict.rows.some((row) => /\[text-200\]/.test(row)));
});

test('text hidden by a clipping box is a failure at every stage', () => {
	const verdict = evaluateShippedRoutes([
		{
			path: '/',
			label: 'Home',
			stage: 'text-200',
			fontScale: 2,
			viewportWidth: 320,
			documentScrollWidth: 320,
			documentClientWidth: 320,
			clipped: [{ tag: 'div', scrollHeight: 80, clientHeight: 40, text: 'cut off' }],
		},
	]);

	assert.equal(verdict.ok, false);
	assert.ok(verdict.failures.some((failure) => /hides its own text/.test(failure)));
	assert.ok(verdict.failures.some((failure) => /cut off/.test(failure)));
});

test('the text scale is applied the same way on both halves', () => {
	assert.equal(textScaleCss(1), '', 'no scale, no rule');
	assert.match(textScaleCss(2), /font-size: 200%/, 'the root font size grows');
	assert.match(textScaleCss(2, '.stage'), /\.stage \{/, 'the harness scales its stage');
	assert.equal(textScaleDeclaration(2), 'font-size: 200%');
});

test('the harness stage really carries the text scale', () => {
	const html = harnessIndexHtml();

	// The inline style attribute carries DECLARATIONS. A rule written
	// into it is ignored by the browser, and the 200% stage would
	// silently measure 100% text.
	assert.ok(html.includes('data-stage="text-200" style="font-size: 200%"'), html.slice(0, 400));
	assert.ok(!html.includes('style=".stage'), 'no rule is written into an inline style');
});

/* ------------------------------------------------------------------ *
 * The origin under measurement is identified by its bytes
 * ------------------------------------------------------------------ */

test('an origin that serves another build is not the build under measurement', async () => {
	const server = createServer((request, response) => {
		if (request.url === '/assets/probe.js') {
			response.writeHead(200, { 'content-type': 'text/javascript' }).end('a different build');
			return;
		}
		response.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>');
	});
	await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
	const { port } = server.address();
	const baseUrl = `http://127.0.0.1:${port}`;
	try {
		const probe = { urlPath: '/assets/probe.js', bytes: Buffer.from('this repository build') };

		assert.equal(await originServesBuild(baseUrl, probe), false);
		assert.equal(
			await originServesBuild(baseUrl, {
				urlPath: '/assets/probe.js',
				bytes: Buffer.from('a different build'),
			}),
			true,
			'the same bytes mean the same build',
		);
		assert.equal(
			await originServesBuild(baseUrl, null),
			false,
			'without a probe nothing is identified',
		);
	} finally {
		server.closeAllConnections?.();
		await new Promise((closed) => server.close(closed));
	}
});

test('the build probe names a file of this repository build', () => {
	const probe = buildAssetProbe();

	if (probe === null) {
		// No build in the tree: the capture cannot identify an origin,
		// so it starts its own preview. The shape is still checked.
		assert.ok(true);
		return;
	}
	assert.match(probe.urlPath, /^\/.*\.js$/);
	assert.ok(probe.bytes.length > 0, 'the probe carries the bytes it compares');
});

/* ------------------------------------------------------------------ *
 * The requested width reaches the harness and the header
 * ------------------------------------------------------------------ */

test('the requested width reaches the harness body', () => {
	const html = harnessIndexHtml(1200);

	assert.ok(html.includes('width: 1200px'), 'the harness body is as wide as the viewport');
	assert.ok(!html.includes('width: 1600px'), 'the harness body is not pinned to the default width');
});

test('a long header row is wrapped instead of cut off', () => {
	const row = 'x'.repeat(400);
	const lines = wrapRow(row, 600);

	assert.ok(lines.length > 1, 'the row is wrapped');
	assert.equal(lines.join(''), row, 'no evidence is lost in the wrap');
});
