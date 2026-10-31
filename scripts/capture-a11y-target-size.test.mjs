/**
 * The Issue #401 capture's own unit tests.
 *
 * The capture is an assertion, so its decision function has to be
 * testable without a browser: `evaluateObservation` is what decides
 * whether an artefact may be written, and a version that can only fail
 * inside Chromium is one nobody re-runs when it breaks.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	GUTTER,
	HARNESS_DIST,
	PANEL_WIDTH,
	RENDER_WIDTH,
	SCREENSHOT_BUDGET_BYTES,
	SCREENSHOT_MAX_WIDTH,
	SURFACE_CAPTURES,
	WCAG_MAPPING,
	assertWebpOutputPath,
	boxCentre,
	circleIntersectsBox,
	circlesIntersect,
	equivalentClaimHolds,
	escapeXml,
	evaluateMeasuredTarget,
	evaluateMeasuredTargets,
	evaluateObservation,
	evidencePanelSvg,
	fixtureCases,
	harnessIndexHtml,
	harnessMainTsx,
	harnessViteConfig,
	headerSvg,
	resolveStaticTarget,
	screenshotBudgetVerdict,
	spacingClaimHolds,
} from './capture-a11y-target-size.mjs';
import { MIN_TARGET_PX } from './check-a11y-target-size.mjs';

/** One measured target, as the browser would report it. */
function target(overrides = {}) {
	return {
		id: 'target-1',
		tag: 'button',
		label: 'A',
		width: 24,
		height: 24,
		display: 'inline-flex',
		lineBoxes: 1,
		box: { x: 0, y: 0, width: 24, height: 24 },
		exceptionKind: null,
		exceptionReason: null,
		...overrides,
	};
}

/** One observation with a clean shipped surface and clean specimens. */
function healthyObservation(overrides = {}) {
	return {
		surfaces: [
			{
				id: 'nav-desktop',
				label: 'public nav (desktop)',
				path: '/about',
				targets: [target()],
				declaredExceptions: [],
			},
		],
		specimens: [
			{
				specimenId: 'pass/01-minimum-target',
				expectation: 'pass',
				sizeVerdict: 'pass',
				targets: [target({ id: 'pass#0' })],
				declaredExceptions: [],
			},
			{
				specimenId: 'fail/01-undersized-target',
				expectation: 'fail',
				sizeVerdict: 'fail',
				targets: [
					target({
						id: 'fail#0',
						width: 16,
						height: 16,
						box: { x: 0, y: 0, width: 16, height: 16 },
					}),
				],
				declaredExceptions: [],
			},
		],
		...overrides,
	};
}

test('the artefact is WebP only, and stays inside the repository', () => {
	assert.equal(
		assertWebpOutputPath('docs/verification/a11y/tap-target-overlay.webp'),
		'docs/verification/a11y/tap-target-overlay.webp',
	);
	assert.throws(() => assertWebpOutputPath('docs/verification/a11y/tap-target-overlay.png'));
	assert.throws(() => assertWebpOutputPath('../outside.webp'));
});

test('a capture over the budget is refused', () => {
	assert.equal(screenshotBudgetVerdict(1024).withinBudget, true);
	assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES + 1).withinBudget, false);
});

test('the circle of the minimum meets a box it touches and misses a box it does not', () => {
	const circle = { x: 12, y: 12, radius: MIN_TARGET_PX / 2 };
	assert.equal(circleIntersectsBox(circle, { x: 0, y: 0, width: 24, height: 24 }), true);
	assert.equal(circleIntersectsBox(circle, { x: 40, y: 0, width: 16, height: 16 }), false);
});

test('two circles of the minimum meet when their centres are closer than 24 px', () => {
	const a = { x: 8, y: 8, radius: 12 };
	const b = { x: 20, y: 8, radius: 12 };
	assert.equal(circlesIntersect(a, b), true);
	assert.equal(circlesIntersect(a, { x: 40, y: 8, radius: 12 }), false);
});

test('the spacing claim holds for a 16 px target with 24 px of space around it', () => {
	const small = target({
		id: 'a',
		width: 16,
		height: 16,
		box: { x: 0, y: 0, width: 16, height: 16 },
	});
	const neighbour = target({
		id: 'b',
		width: 16,
		height: 16,
		box: { x: 40, y: 0, width: 16, height: 16 },
	});
	assert.equal(spacingClaimHolds(small, [small, neighbour]), true);
});

test('the spacing claim does not hold for a 16 px target with 2 px of space around it', () => {
	const small = target({
		id: 'a',
		width: 16,
		height: 16,
		box: { x: 0, y: 0, width: 16, height: 16 },
	});
	const neighbour = target({
		id: 'b',
		width: 16,
		height: 16,
		box: { x: 18, y: 0, width: 16, height: 16 },
	});
	assert.equal(spacingClaimHolds(small, [small, neighbour]), false);
});

test('a target of exactly the minimum is compliant', () => {
	const result = evaluateMeasuredTarget({ target: target(), others: [target()] });
	assert.equal(result.verdict, 'compliant');
	assert.equal(result.exception, null);
});

test('an inline target is the inline exception, decided by measurement', () => {
	const result = evaluateMeasuredTarget({
		target: target({ width: 20, height: 20, display: 'inline' }),
		others: [],
	});
	assert.equal(result.verdict, 'compliant-by-exception');
	assert.equal(result.exception, 'inline');
});

test('a small target with no exception is a violation', () => {
	const result = evaluateMeasuredTarget({
		target: target({ width: 20, height: 20 }),
		others: [],
	});
	assert.equal(result.verdict, 'violation');
});

test('a declared spacing exception is accepted only when the geometry holds', () => {
	const small = target({
		id: 'a',
		width: 16,
		height: 16,
		box: { x: 0, y: 0, width: 16, height: 16 },
	});
	const far = target({
		id: 'b',
		width: 16,
		height: 16,
		box: { x: 40, y: 0, width: 16, height: 16 },
	});
	const declared = { kind: 'spacing', reason: 'the chips are 24 px apart' };
	const accepted = evaluateMeasuredTarget({
		target: small,
		others: [small, far],
		declaredException: declared,
	});
	assert.equal(accepted.verdict, 'compliant-by-exception');
	assert.equal(accepted.exception, 'spacing');

	const near = { ...far, box: { x: 18, y: 0, width: 16, height: 16 } };
	const refused = evaluateMeasuredTarget({
		target: small,
		others: [small, near],
		declaredException: declared,
	});
	assert.equal(refused.verdict, 'violation');
});

test('a declared essential exception is accepted, and recorded', () => {
	const result = evaluateMeasuredTarget({
		target: target({ width: 20, height: 20 }),
		others: [],
		declaredException: { kind: 'essential', reason: 'the mark is the brand' },
	});
	assert.equal(result.verdict, 'compliant-by-exception');
	assert.equal(result.exception, 'essential');
});

test('a declared equivalent exception is accepted only when the named control is there and meets the minimum', () => {
	const small = target({
		id: 'a',
		width: 16,
		height: 16,
		box: { x: 0, y: 0, width: 16, height: 16 },
	});
	const declared = {
		kind: 'equivalent',
		reason: 'the full-size button offers the same function',
		equivalent: { ref: '#full-size-button', found: true, width: 24, height: 24, meets: true },
	};
	const accepted = evaluateMeasuredTarget({
		target: small,
		others: [small],
		declaredException: declared,
	});
	assert.equal(accepted.verdict, 'compliant-by-exception');
	assert.equal(accepted.exception, 'equivalent');
	assert.match(accepted.reason, /human evaluation/);

	const absent = evaluateMeasuredTarget({
		target: small,
		others: [small],
		declaredException: {
			...declared,
			equivalent: { ref: '#missing', found: false, width: null, height: null, meets: false },
		},
	});
	assert.equal(absent.verdict, 'violation');
	assert.equal(absent.exception, null);

	const undersized = evaluateMeasuredTarget({
		target: small,
		others: [small],
		declaredException: {
			...declared,
			equivalent: { ref: '#small', found: true, width: 16, height: 16, meets: false },
		},
	});
	assert.equal(undersized.verdict, 'violation');
});

test('the equivalent claim needs a named control, and says which part it cannot check', () => {
	assert.equal(equivalentClaimHolds({ kind: 'equivalent', reason: 'why' }).holds, false);
	assert.equal(
		equivalentClaimHolds({
			kind: 'equivalent',
			reason: 'why',
			equivalent: { ref: '#a', found: true, width: 24, height: 24, meets: true },
		}).holds,
		true,
	);
	assert.match(
		equivalentClaimHolds({
			kind: 'equivalent',
			reason: 'why',
			equivalent: { ref: '#a', found: false, width: null, height: null, meets: false },
		}).reason,
		/not on the same page/,
	);
});

test('the declared exception reaches the target it was written for, and no other', () => {
	const rows = evaluateMeasuredTargets({
		targets: [
			target({ id: 'a', width: 20, height: 20 }),
			target({ id: 'b', width: 20, height: 20 }),
		],
		declaredExceptions: [{ targetId: 'b', kind: 'essential', reason: 'the mark is the brand' }],
	});
	assert.equal(rows[0].verdict, 'violation');
	assert.equal(rows[1].verdict, 'compliant-by-exception');
});

test('a healthy observation passes', () => {
	const verdict = evaluateObservation(healthyObservation());
	assert.equal(verdict.ok, true);
	assert.deepEqual(verdict.failures, []);
});

test('a shipped surface with a small target fails the capture', () => {
	const observation = healthyObservation();
	observation.surfaces[0].targets[0] = target({ width: 16, height: 16 });
	const verdict = evaluateObservation(observation);
	assert.equal(verdict.ok, false);
	assert.match(verdict.failures[0], /violates SC 2\.5\.8/);
});

test('a pass specimen that measures a violation fails the capture', () => {
	const observation = healthyObservation();
	observation.specimens[0].targets[0] = target({ width: 16, height: 16 });
	const verdict = evaluateObservation(observation);
	assert.equal(verdict.ok, false);
	assert.match(verdict.failures[0], /passing state is no longer reproduced/);
});

test('a fail specimen that measures no violation fails the capture (the negative control)', () => {
	const observation = healthyObservation();
	observation.specimens[1].targets[0] = target();
	const verdict = evaluateObservation(observation);
	assert.equal(verdict.ok, false);
	assert.match(verdict.failures[0], /negative control is gone/);
});

test('the fixture cases come from the gate roster, pass and fail', () => {
	const cases = fixtureCases();
	assert.equal(cases.length, 10);
	assert.equal(cases.filter((entry) => entry.expectation === 'pass').length, 5);
	assert.equal(cases.filter((entry) => entry.expectation === 'fail').length, 5);
	for (const entry of cases) {
		assert.ok(entry.module.startsWith('scripts/fixtures/a11y-target-size/'));
		assert.ok(entry.exportName.length > 0);
	}
});

test('the harness imports the fixture files themselves', () => {
	const main = harnessMainTsx();
	for (const entry of fixtureCases()) {
		assert.ok(main.includes(entry.module.replace(/\.tsx$/, '')));
		assert.ok(main.includes(entry.exportName));
	}
	assert.ok(harnessIndexHtml().includes('./main.tsx'));
	assert.ok(harnessViteConfig().includes(HARNESS_DIST));
});

test('the served path cannot escape the served root', () => {
	assert.equal(resolveStaticTarget('/tmp/root', '/../../etc/passwd').status, 403);
	assert.equal(resolveStaticTarget('/tmp/root', '/missing.js').status, 404);
});

test('the artefact geometry is one width wide', () => {
	assert.equal(RENDER_WIDTH + GUTTER + PANEL_WIDTH, SCREENSHOT_MAX_WIDTH);
	assert.equal(WCAG_MAPPING[0].sc, '2.5.8');
	assert.equal(WCAG_MAPPING[1].sc, '2.5.7');
});

test('the header and the panel name what was measured and what was not', () => {
	const observation = healthyObservation();
	const verdict = evaluateObservation(observation);
	const gate = {
		violations: [],
		fixture: { rows: [] },
		humanEvaluation: ['whether a 24 px target is comfortable with a thumb'],
	};
	const header = headerSvg({ observation, verdict, gate });
	assert.match(header.svg, /tap \/ click target size/);
	assert.match(header.svg, /not machine-checked/);
	const panel = evidencePanelSvg({ observation, verdict, gate, width: PANEL_WIDTH });
	assert.match(panel.svg, /machine-checked per target/);
	assert.match(panel.svg, /human evaluation/);
});

test('the shipped surfaces are the three the Issue names', () => {
	assert.deepEqual(
		SURFACE_CAPTURES.map((surface) => surface.id),
		['nav-desktop', 'nav-mobile', 'filter', 'picker'],
	);
	for (const surface of SURFACE_CAPTURES) {
		assert.ok(surface.selector.length > 0);
		assert.ok(surface.clip.length > 0);
	}
});

test('the box centre is the middle of the box', () => {
	assert.deepEqual(boxCentre({ x: 10, y: 20, width: 30, height: 40 }), { x: 25, y: 40 });
});

test('the panel text is escaped', () => {
	assert.equal(escapeXml('a & b < c > d " e'), 'a &amp; b &lt; c &gt; d &quot; e');
});
