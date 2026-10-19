import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import {
	CASE_ATTRIBUTE,
	EXPECTED_ANIMATION_NAME,
	EXPECTED_CASE_IDS,
	FIXTURE_TEST_ID,
	MODE_TEST_ID,
	MODE_WAIT_ATTEMPTS,
	MOTION_HOOK,
	READ_FIXTURE,
	SCREENSHOT_BUDGET_BYTES,
	STORY_EXPORT,
	STORY_MODULE,
	assertWebpOutputPath,
	composeArtefact,
	escapeXml,
	evaluateObservation,
	harnessIndexHtml,
	harnessMainTsx,
	headerSvg,
	modeWaitFailure,
	resolveStaticTarget,
	screenshotBudgetVerdict,
} from './capture-a11y-reduced-motion.mjs';

const require = createRequire(import.meta.url);
const { mkdtempSync, writeFileSync, mkdirSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

/**
 * capture-a11y-reduced-motion — unit tests (Issue #403).
 *
 * The capture is the browser half of the evidence, so the parts that
 * decide PASS or FAIL have to be assertable without a browser:
 * `evaluateObservation` is the contract, and `composeArtefact` /
 * `headerSvg` decide whether the artefact a reviewer reads is the
 * artefact the assertions described.
 */

/** One fixture state as the browser reports it. */
function caseOf(caseId, overrides = {}) {
	const hasStrip = overrides.hasStrip ?? true;
	return {
		caseId,
		hasStrip,
		animationName: hasStrip ? EXPECTED_ANIMATION_NAME : null,
		animatedSlots: hasStrip ? 7 : 0,
		slotCount: hasStrip ? 7 : 0,
		motionState: hasStrip ? 'animated' : null,
		label: hasStrip ? '1,234 page views' : null,
		...overrides,
	};
}

/** The four states the Issue names, in the order the fixture renders them. */
function allCases(overrides = {}) {
	return EXPECTED_CASE_IDS.map((caseId) => {
		const defaults =
			caseId === '02-empty'
				? { label: '0 page views', text: '02 empty text' }
				: caseId === '03-failure'
					? { hasStrip: false, label: null, text: '03 failure text' }
					: { label: '1,234 page views', text: `${caseId} text` };
		return caseOf(caseId, { ...defaults, ...overrides[caseId] });
	});
}

/** A healthy pair of observations, with per-case overrides. */
function observations(overrides = {}) {
	return {
		animated: {
			mode: 'no-preference',
			cases: allCases(overrides.animated),
		},
		reduced: {
			mode: 'reduce',
			// What the reduce context is supposed to report, with the
			// test's own override applied last so a fixture can describe
			// the defect it is about.
			cases: EXPECTED_CASE_IDS.map((caseId) => {
				const reduced = allCases(overrides.reduced).find((entry) => entry.caseId === caseId);
				return reduced.hasStrip
					? {
							...reduced,
							animationName: 'none',
							animatedSlots: 0,
							motionState: 'reduced',
							...overrides.reduced?.[caseId],
						}
					: reduced;
			}),
		},
	};
}

test('a healthy pair of observations passes, with every fixture state compared', () => {
	assert.deepEqual(evaluateObservation(observations()), { ok: true, failures: [] });
});

test('a reduce context that still animates fails, and names the state and what it saw', () => {
	const verdict = evaluateObservation(
		observations({
			reduced: { '02-empty': { animationName: 'counterDigitRoll', animatedSlots: 7 } },
		}),
	);
	assert.equal(verdict.ok, false);
	assert.match(
		verdict.failures[0],
		/fixture state 02-empty: reduce context still animates 7 slot\(s\)/,
	);
});

test('a defect that only affects the SECOND state is caught, not just the first strip', () => {
	// The regression this shape exists for: with `querySelector` the
	// compact state was never read, so a zero-count or compact branch
	// could lose its value or keep animating and the capture would still
	// report success.
	const verdict = evaluateObservation(
		observations({ reduced: { '04-compact': { label: '1,200 page views' } } }),
	);
	assert.equal(verdict.ok, false);
	assert.match(
		verdict.failures.join('\n'),
		/fixture state 04-compact: the accessible value changed/,
	);
});

test('a no-preference context that does NOT animate fails', () => {
	const verdict = evaluateObservation(
		observations({ animated: { '01-normal': { animationName: 'none', animatedSlots: 0 } } }),
	);
	assert.equal(verdict.ok, false);
	assert.match(verdict.failures[0], /no-preference context animates with "none"/);
});

test('losing the value under reduced motion fails, even when nothing animates', () => {
	const verdict = evaluateObservation(
		observations({ reduced: { '01-normal': { label: '1,200 page views' } } }),
	);
	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /accessible value changed with motion/);
});

test('dropping a digit slot under reduced motion fails', () => {
	const verdict = evaluateObservation(
		observations({ reduced: { '01-normal': { slotCount: 0, animatedSlots: 0 } } }),
	);
	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /digit slots differ/);
});

test('a state that renders in one mode and not the other fails', () => {
	const verdict = evaluateObservation(
		observations({ reduced: { '02-empty': { hasStrip: false } } }),
	);
	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /02-empty rendered a digit strip in one mode/);
});

test('a fixture state that stopped rendering fails instead of silently shrinking coverage', () => {
	const verdict = evaluateObservation({
		animated: { mode: 'no-preference', cases: [caseOf('01-normal')] },
		reduced: {
			mode: 'reduce',
			cases: [
				caseOf('01-normal', { animationName: 'none', motionState: 'reduced', animatedSlots: 0 }),
			],
		},
	});
	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /did not render fixture state\(s\) 02-empty/);
});

test('a banner that disagrees with the emulated preference fails', () => {
	const base = observations();
	const verdict = evaluateObservation({
		...base,
		reduced: { ...base.reduced, mode: 'no-preference' },
	});
	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /reduce context rendered mode "no-preference"/);
});

test('data-motion-state that disagrees with the preference fails', () => {
	const verdict = evaluateObservation(
		observations({ animated: { '01-normal': { motionState: 'reduced' } } }),
	);
	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /data-motion-state disagrees/);
});

test('the mode wait is bounded, and says what it saw', () => {
	// The capture used to swallow the timeout and call itself again, so
	// a fixture that never reached the expected mode hung forever
	// instead of reporting the cause.
	const error = modeWaitFailure({
		expectedMode: 'reduce',
		observedMode: 'no-preference',
		attempts: MODE_WAIT_ATTEMPTS,
	});
	assert.match(error.message, /no-preference/);
	assert.match(error.message, /reduce/);
	assert.match(error.message, new RegExp(`after ${MODE_WAIT_ATTEMPTS} wait\\(s\\)`));
	assert.ok(MODE_WAIT_ATTEMPTS <= 5, 'the bound has to be small enough to fail a CI run');
});

test('the screenshot budget is a stated number, not a vibe', () => {
	assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES).withinBudget, true);
	assert.equal(screenshotBudgetVerdict(SCREENSHOT_BUDGET_BYTES + 1).withinBudget, false);
});

test('a non-WebP or out-of-repository artefact path is refused', () => {
	assert.throws(() => assertWebpOutputPath('docs/verification/a11y/x.png'), /non-WebP/);
	assert.throws(() => assertWebpOutputPath('../outside.webp'), /outside the repository/);
	assert.equal(
		assertWebpOutputPath('docs/verification/a11y/x.webp'),
		'docs/verification/a11y/x.webp',
	);
});

test('the harness renders the SHIPPED story, not a copy of it', () => {
	const main = harnessMainTsx();
	assert.match(main, new RegExp(STORY_MODULE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
	assert.match(main, new RegExp(`\\{ ${STORY_EXPORT} \\}`));
	assert.match(main, /src\/styles\.css/);
	assert.match(harnessIndexHtml(), /id="root"/);
	assert.equal(FIXTURE_TEST_ID, 'reduced-motion-fixture');
	assert.equal(MODE_TEST_ID, 'reduced-motion-mode');
	assert.equal(CASE_ATTRIBUTE, 'data-case');
	assert.equal(MOTION_HOOK, '[data-motion="counter-roll"]');
});

test('the observation reads every state, not the first strip on the page', () => {
	// `querySelector` was the reason a defect in the empty / compact
	// states could not fail this capture.
	const reader = READ_FIXTURE.toString();
	assert.match(reader, /querySelectorAll\(`\[\$\{caseAttribute\}\]`\)/);
	assert.doesNotMatch(reader, /document\.querySelector\(hook\)/);
	for (const field of [
		'animationName',
		'animatedSlots',
		'slotCount',
		'motionState',
		'label',
		'text',
	]) {
		assert.match(reader, new RegExp(`${field}:`), `${field} must be read per state`);
	}
});

test('the shipped fixture declares exactly the states the capture asserts', () => {
	const story = readFileSync(new URL(`../${STORY_MODULE}`, import.meta.url), 'utf8');
	for (const caseId of EXPECTED_CASE_IDS) {
		const key = caseId.slice(3);
		assert.match(
			story,
			new RegExp(`${key}: '${caseId}'`),
			`${caseId} must be published by the fixture`,
		);
	}
	assert.match(story, /data-case=\{caseId\}/, 'each case must render its identity');
});

test('the static server refuses to serve outside its root', () => {
	const root = mkdtempSync(join(tmpdir(), 'a11y-static-'));
	mkdirSync(join(root, 'assets'));
	writeFileSync(join(root, 'index.html'), '<!doctype html><title>root</title>');
	writeFileSync(join(root, 'assets', 'app.css'), 'body{}');
	assert.equal(resolveStaticTarget(root, '/').status, 200);
	assert.equal(resolveStaticTarget(root, '/index.html').contentType, 'text/html; charset=utf-8');
	assert.equal(resolveStaticTarget(root, '/assets/app.css').contentType, 'text/css; charset=utf-8');
	assert.equal(resolveStaticTarget(root, '/missing.js').status, 404);
	assert.equal(resolveStaticTarget(root, '/../etc/passwd').status, 403);
});

test('escapeXml neutralises gate text before it reaches the header', () => {
	assert.equal(escapeXml('a & b <c> "d"'), 'a &amp; b &lt;c&gt; &quot;d&quot;');
});

test('the header states both modes, the machine split and the WCAG levels', () => {
	const base = observations();
	const header = headerSvg({
		animated: base.animated,
		reduced: base.reduced,
		gate: {
			violations: [],
			surfaces: [
				{
					file: 'src/home/access/tiles.tsx',
					region: 'DigitStrip',
					hooks: [{ name: 'counter-roll' }],
					renderTimeOptOut: true,
					stylesheetOptOut: 'src/styles.css:271',
				},
			],
			stylesheet: {
				floor: {
					missing: [],
					declarations: ['animation-duration', 'transition-duration', 'scroll-behavior'],
				},
			},
		},
		panelWidth: 795,
	});
	assert.match(header.svg, /prefers-reduced-motion: on \/ off/);
	for (const caseId of EXPECTED_CASE_IDS) {
		assert.ok(header.svg.includes(caseId), `${caseId} must be named in the header`);
	}
	assert.match(header.svg, /01-normal=counterDigitRoll 7\/7 slots/);
	assert.match(header.svg, /01-normal=none 0\/7 slots/);
	assert.match(header.svg, /03-failure=no strip/);
	assert.match(
		header.svg,
		/4 fixture state\(s\) compared per mode; identical label, slot count and text in both modes: yes/,
	);
	assert.match(header.svg, /tiles\.tsx#DigitStrip hook=counter-roll/);
	assert.match(header.svg, /machine-checked: gate 0 violation\(s\)/);
	assert.match(header.svg, /not machine-checked: reading comfort/);
	assert.match(header.svg, /2\.3\.3 Animation from Interactions AAA/);
	// The header must be tall enough for its own last row.
	assert.ok(header.height > 34 + 34 + 7 * 22, `header height ${header.height} is too short`);
});

test('composeArtefact stacks the header ABOVE the panels instead of over them', async () => {
	const sharp = (await import('sharp')).default;
	const dir = mkdtempSync(join(tmpdir(), 'a11y-compose-'));
	const animatedPng = join(dir, 'on.png');
	const reducedPng = join(dir, 'off.png');
	// Different heights on purpose: the shorter panel must be padded, not
	// stretched, or the two renders would no longer be comparable.
	await sharp({ create: { width: 800, height: 400, channels: 3, background: '#ffffff' } })
		.png()
		.toFile(animatedPng);
	await sharp({ create: { width: 800, height: 300, channels: 3, background: '#eeeeee' } })
		.png()
		.toFile(reducedPng);
	const base = observations();
	const header = headerSvg({
		animated: base.animated,
		reduced: base.reduced,
		gate: {
			violations: [],
			surfaces: [],
			stylesheet: { floor: { missing: [], declarations: [] } },
		},
		panelWidth: 795,
	});
	const outPath = join(dir, 'out.webp');
	const geometry = await composeArtefact({ sharp, animatedPng, reducedPng, header, outPath });
	const meta = await sharp(outPath).metadata();
	assert.equal(geometry.headerHeight, header.height);
	// header + the taller panel, never header + taller panel - header.
	assert.equal(meta.height, header.height + geometry.bodyHeight);
	// Above the seam is the cream header band; below it is the panel.
	const { data, info } = await sharp(outPath).raw().toBuffer({ resolveWithObject: true });
	const at = (x, y) => {
		const i = (y * info.width + x) * info.channels;
		return [data[i], data[i + 1], data[i + 2]];
	};
	const [headerR, headerG] = at(5, 4);
	assert.ok(
		Math.abs(headerR - 244) < 12 && Math.abs(headerG - 239) < 12,
		`expected the cream header band at the top, got ${at(5, 4)}`,
	);
	const [panelR, panelG, panelB] = at(5, header.height + 10);
	assert.ok(
		Math.abs(panelR - 255) < 12 && Math.abs(panelG - 255) < 12 && Math.abs(panelB - 255) < 12,
		`expected the white panel below the seam, got ${at(5, header.height + 10)}`,
	);
});
