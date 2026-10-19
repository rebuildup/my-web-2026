/**
 * Visual-diff controls for the viewport gate (Issue #417).
 *
 * 「意図的破損のsnapshotに赤いdiffが出る」 is an acceptance criterion,
 * so it has to be demonstrated, not asserted in prose. This spec runs
 * three controls against the real `/` surface, each writing one JSON
 * record under `.tmp/viewport-controls/` that
 * `scripts/make-viewport-diff-grid-report.mjs` renders into the
 * committed grid:
 *
 *   1. `stability` — capture the page twice with nothing changed. The
 *      diff must stay inside `STABLE_MAX_RATIO`. This is the
 *      誤検知 guard: if an unchanged page produced a diff, every
 *      other cell in the report would be unreadable, so the failure
 *      mode is "the harness lies", not "the page moved".
 *   2. `breakage` — inject one deliberately broken layout rule and
 *      re-capture. The diff must exceed `MIN_BREAKAGE_RATIO`, the red
 *      overlay must show where it moved, AND the geometry judge in
 *      `./contract.ts` must reject the same page. The second half
 *      matters: a pixel gate that goes red while the layout contract
 *      still passes would mean the two layers disagree about what
 *      "broken" is.
 *   3. `viewport-shift` — the same page at 390px, against a 390px-wide
 *      CROP of the 1440px layout. Two viewports of different widths
 *      cannot be compared as whole rasters (`comparePng` refuses a
 *      size mismatch rather than comparing a corner), so the desktop
 *      side is cropped to the phone's raster size. The diff must
 *      exceed the floor, i.e. the responsive layout really does change
 *      between the two ends of the roster. A harness that reported
 *      "no difference" here would satisfy control 1 forever while
 *      detecting nothing.
 *
 * Why no committed pixel baseline
 * -------------------------------
 * A baseline captured on one host cannot be compared against another
 * host's capture without turning font and platform differences into
 * failures, which is the 誤検知 the Issue forbids. Both sides of
 * every comparison here are produced by the same browser build in the
 * same run, so a non-zero diff is attributable to the page. Committing
 * cross-machine baselines is recorded as an open decision in the PR
 * rather than half-implemented here.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { MIN_BREAKAGE_RATIO, STABLE_MAX_RATIO, comparePng } from '../../scripts/_viewport-diff.mjs';
import {
	VIEWPORTS,
	VIEWPORT_ROUTES,
	assertViewportLayout,
	observeCurrentDocument,
	observeLayout,
} from './contract';

const SHOT_DIR = join('.tmp', 'viewport-screenshots');
const CONTROL_DIR = join('.tmp', 'viewport-controls');

/** The surface every control runs against — the Home roster entry. */
const HOME = VIEWPORT_ROUTES.find(
	(route) => route.path === '/',
) as (typeof VIEWPORT_ROUTES)[number];
const PHONE = VIEWPORTS[0];
const DESKTOP = VIEWPORTS[VIEWPORTS.length - 1];

/**
 * The injected breakage. One rule, unmistakable in a diff: the content
 * column is forced to a fixed 1600px, which is wider than every
 * viewport in the roster. It is the classic responsive defect this
 * gate exists to catch — a desktop-sized grid with no narrow-viewport
 * fallback — expressed as a single declaration so the control cannot
 * drift into testing something else.
 */
const BREAKAGE_CSS = 'main { width: 1600px !important; max-width: none !important; }';

function recordControl(record: Record<string, unknown>): void {
	mkdirSync(CONTROL_DIR, { recursive: true });
	writeFileSync(join(CONTROL_DIR, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
}

/** Capture options shared by every control so the rasters are comparable. */
const CAPTURE = {
	fullPage: false,
	animations: 'disabled' as const,
	caret: 'hide' as const,
};

test.describe('visual-diff controls', () => {
	test.use({ viewport: { width: PHONE.width, height: PHONE.height } });

	test('an unchanged page compares equal to its own re-capture', async ({ page }) => {
		await page.goto(HOME.path, { waitUntil: 'load' });
		await page.waitForTimeout(300);
		const baseline = await page.screenshot(CAPTURE);

		await page.reload({ waitUntil: 'load' });
		await page.waitForTimeout(300);
		const current = await page.screenshot(CAPTURE);

		const result = await comparePng(baseline, current);
		recordControl({
			id: 'stability',
			label: `${HOME.path} @${PHONE.width}px — 無変更の再キャプチャ`,
			expectation: `差分率 ≤ ${STABLE_MAX_RATIO}`,
			ratio: result.ratio,
			changedPixels: result.changedPixels,
			totalPixels: result.totalPixels,
			viewport: PHONE,
			verdict: result.stable ? 'stable' : 'unstable',
		});

		expect(
			result.ratio,
			`an unchanged ${HOME.path} capture must not differ from its re-capture`,
		).toBeLessThanOrEqual(STABLE_MAX_RATIO);
	});

	test('a deliberately broken layout produces a red diff the judge also rejects', async ({
		page,
	}) => {
		await page.goto(HOME.path, { waitUntil: 'load' });
		await page.waitForTimeout(300);
		const baseline = await page.screenshot(CAPTURE);
		writeFileSync(join(SHOT_DIR, 'control-baseline-390.png'), baseline);

		await page.addStyleTag({ content: BREAKAGE_CSS });
		await page.waitForTimeout(300);
		const broken = await page.screenshot(CAPTURE);
		const result = await comparePng(baseline, broken);
		writeFileSync(join(SHOT_DIR, 'control-broken-390.png'), broken);
		writeFileSync(join(SHOT_DIR, 'control-diff-390.png'), result.overlayPng);

		// The geometry layer must agree with the pixel layer. Without
		// this line a red diff could come from a benign animation while
		// the layout contract stayed green.
		//
		// Measured in place, NOT through `observeLayout()`: that helper
		// navigates, which would throw away the injected stylesheet and
		// judge the healthy page instead of the broken one.
		const observation = await observeCurrentDocument(page, `${HOME.path}#broken`, 200);
		const rejected = (() => {
			try {
				assertViewportLayout(HOME, PHONE, observation);
				return null;
			} catch (error) {
				return error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error);
			}
		})();

		recordControl({
			id: 'breakage',
			label: `${HOME.path} @${PHONE.width}px — 意図的破損（main を 1600px に固定）`,
			expectation: `差分率 ≥ ${MIN_BREAKAGE_RATIO}`,
			ratio: result.ratio,
			changedPixels: result.changedPixels,
			totalPixels: result.totalPixels,
			viewport: PHONE,
			verdict: result.broken ? 'red-diff' : 'no-diff',
			judgeRejected: rejected !== null,
			judgeDetail: rejected,
			baselinePath: 'control-baseline-390.png',
			currentPath: 'control-broken-390.png',
			overlayPath: 'control-diff-390.png',
		});

		expect(rejected, 'the layout judge must reject the broken page').not.toBeNull();
		expect(
			result.ratio,
			'the deliberate layout break must show up as a diff above the breakage floor',
		).toBeGreaterThanOrEqual(MIN_BREAKAGE_RATIO);
	});

	test('the two ends of the roster do not look the same', async ({ page }) => {
		await page.goto(HOME.path, { waitUntil: 'load' });
		await page.setViewportSize({ width: PHONE.width, height: PHONE.height });
		await page.waitForTimeout(300);
		const phone = await page.screenshot(CAPTURE);

		writeFileSync(join(SHOT_DIR, 'control-phone-390.png'), phone);
		await page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });
		await page.waitForTimeout(300);
		// Cropped to the phone raster so both sides of the comparison
		// are 390x844. The desktop layout centres a max-width column,
		// so this crop is mostly gutter — which is exactly the
		// difference the control is asserting.
		const desktopCrop = await page.screenshot({
			...CAPTURE,
			clip: { x: 0, y: 0, width: PHONE.width, height: PHONE.height },
		});
		writeFileSync(join(SHOT_DIR, 'control-desktop-crop-1440.png'), desktopCrop);

		const result = await comparePng(phone, desktopCrop);
		writeFileSync(join(SHOT_DIR, 'control-diff-viewport-shift.png'), result.overlayPng);
		recordControl({
			id: 'viewport-shift',
			label: `${HOME.path} — ${PHONE.width}px と ${DESKTOP.width}px（${PHONE.width}px に切り出し）の比較`,
			expectation: `差分率 ≥ ${MIN_BREAKAGE_RATIO}`,
			ratio: result.ratio,
			changedPixels: result.changedPixels,
			totalPixels: result.totalPixels,
			viewport: PHONE,
			verdict: result.broken ? 'red-diff' : 'no-diff',
			baselinePath: 'control-phone-390.png',
			currentPath: 'control-desktop-crop-1440.png',
			overlayPath: 'control-diff-viewport-shift.png',
		});

		expect(
			result.ratio,
			`${HOME.path} must render differently at ${PHONE.width}px and ${DESKTOP.width}px`,
		).toBeGreaterThanOrEqual(MIN_BREAKAGE_RATIO);
	});
});
