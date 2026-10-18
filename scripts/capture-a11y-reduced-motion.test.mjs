import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import {
	EXPECTED_ANIMATION_NAME,
	FIXTURE_TEST_ID,
	MODE_TEST_ID,
	MOTION_HOOK,
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
	resolveStaticTarget,
	screenshotBudgetVerdict,
} from './capture-a11y-reduced-motion.mjs';

const require = createRequire(import.meta.url);
const { mkdtempSync, writeFileSync, mkdirSync } = require('node:fs');
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

/** A healthy pair of observations, with overrides per case. */
function observations(overrides = {}) {
	return {
		animated: {
			mode: 'no-preference',
			animationName: EXPECTED_ANIMATION_NAME,
			motionState: 'animated',
			label: '1,234 page views',
			digitSlots: 7,
			...overrides.animated,
		},
		reduced: {
			mode: 'reduce',
			animationName: 'none',
			motionState: 'reduced',
			label: '1,234 page views',
			digitSlots: 7,
			...overrides.reduced,
		},
	};
}

test('a healthy pair of observations passes', () => {
	assert.deepEqual(evaluateObservation(observations()), { ok: true, failures: [] });
});

test('a reduce context that still animates fails, and names what it saw', () => {
	const verdict = evaluateObservation(
		observations({ reduced: { animationName: 'counterDigitRoll' } }),
	);
	assert.equal(verdict.ok, false);
	assert.match(verdict.failures[0], /reduce context still animates with "counterDigitRoll"/);
});

test('a no-preference context that does NOT animate fails', () => {
	const verdict = evaluateObservation(observations({ animated: { animationName: 'none' } }));
	assert.equal(verdict.ok, false);
	assert.match(verdict.failures[0], /no-preference context animates with "none"/);
});

test('losing the value under reduced motion fails, even when nothing animates', () => {
	const verdict = evaluateObservation(observations({ reduced: { label: '1,200 page views' } }));
	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /accessible value changed with motion/);
});

test('dropping a digit slot under reduced motion fails', () => {
	const verdict = evaluateObservation(observations({ reduced: { digitSlots: 0 } }));
	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /digit slots differ/);
});

test('a banner that disagrees with the emulated preference fails', () => {
	const verdict = evaluateObservation(observations({ reduced: { mode: 'no-preference' } }));
	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /reduce context rendered mode "no-preference"/);
});

test('data-motion-state that disagrees with the preference fails', () => {
	const verdict = evaluateObservation(observations({ animated: { motionState: 'reduced' } }));
	assert.equal(verdict.ok, false);
	assert.match(verdict.failures.join('\n'), /data-motion-state disagrees/);
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
	assert.equal(MOTION_HOOK, '[data-motion="counter-roll"]');
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
	const header = headerSvg({
		animated: observations().animated,
		reduced: observations().reduced,
		gate: {
			violations: [],
			surfaces: [
				{
					file: 'src/home/access/tiles.tsx',
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
	assert.match(header.svg, /animation-name=counterDigitRoll/);
	assert.match(header.svg, /animation-name=none/);
	assert.match(header.svg, /machine-checked: gate 0 violation\(s\)/);
	assert.match(header.svg, /not machine-checked: reading comfort/);
	assert.match(header.svg, /2\.3\.3 Animation from Interactions AAA/);
	// The header must be tall enough for its own last row.
	assert.ok(header.height > 34 + 34 + 6 * 22, `header height ${header.height} is too short`);
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
	const header = headerSvg({
		animated: observations().animated,
		reduced: observations().reduced,
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
