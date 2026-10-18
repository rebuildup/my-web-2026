/**
 * Negative control for the viewport gate (Issue #417).
 *
 * The Issue requires 「意図的破損のsnapshotに赤いdiffが出る」, and
 * `visual-diff.spec.ts` proves the pixel layer goes red. This file
 * proves the GEOMETRY layer goes red on the same kind of damage: a
 * smoke that has only ever been observed green proves nothing about
 * its ability to fail, and a selector typo would leave it green
 * forever.
 *
 * Therefore this spec feeds the SAME `assertViewportLayout` judge used
 * by `layout.spec.ts`:
 *
 *   1. broken fixtures — a 1600px column forced into a phone
 *      viewport, a missing `<main>`, an inverted nav mode, and body
 *      text set below the legibility floor — each rejected by the
 *      exact rule that is supposed to catch it;
 *   2. an unimplemented route, which must never be reported as a pass
 *      because it "did not assert anything interesting";
 *   3. the real page, which must still be ACCEPTED — without this the
 *      fixture rejections would only prove that the helper throws.
 *
 * The fixtures are inline `page.setContent()` documents, not extra
 * routes: they exist only in this spec, so they can never be mistaken
 * for shipped surfaces, and no other test can start depending on them.
 */

import { expect, test } from '@playwright/test';
import {
	type LayoutObservation,
	VIEWPORTS,
	VIEWPORT_ROUTES,
	type ViewportRoute,
	assertViewportLayout,
	observeCurrentDocument,
	observeLayout,
} from './contract';

/** `/about` — an opt-in nav route, so both nav-mode rules can target it. */
const TARGET = VIEWPORT_ROUTES.find((route) => route.path === '/about') as ViewportRoute;
const PHONE = VIEWPORTS[0];
const DESKTOP = VIEWPORTS[VIEWPORTS.length - 1];

/** A route that is intentionally not part of the roster. */
const UNIMPLEMENTED_PATH = '/viewport-definitely-not-a-real-route';

interface BrokenFixture {
	readonly id: string;
	readonly label: string;
	readonly html: string;
	/** Substring of the failure message the responsible rule must produce. */
	readonly rule: string;
	/** Which roster viewport the fixture is measured at. */
	readonly viewportIndex: number;
	readonly route: ViewportRoute;
}

const BROKEN_FIXTURES: ReadonlyArray<BrokenFixture> = [
	{
		id: 'horizontal-overflow',
		label: 'スマホ幅で 1600px 固定カラム（横スクロール発生）',
		html: '<!doctype html><html lang="ja"><head><title>fixture</title><style>body{margin:0}main{width:1600px}</style></head><body><main id="about-main"><h1>木村友亮</h1></main></body></html>',
		rule: 'must not scroll sideways',
		viewportIndex: 0,
		route: TARGET,
	},
	{
		id: 'no-main-landmark',
		label: '本文ランドマーク欠落（本文が空）',
		html: '<!doctype html><html lang="ja"><head><title>fixture</title></head><body><h1>木村友亮</h1><p>本文だけ。</p></body></html>',
		rule: 'must render exactly one <main>',
		viewportIndex: 0,
		route: TARGET,
	},
	{
		id: 'nav-mode-inverted',
		label: 'nav 契約違反（スマホ幅でデスクトップ nav が残る）',
		html: '<!doctype html><html lang="ja"><head><title>fixture</title><style>.nav{width:200px;height:40px}</style></head><body><nav aria-label="Public"><div class="nav" data-testid="public-nav-desktop"></div></nav><main id="about-main"><h1>木村友亮</h1></main></body></html>',
		rule: 'must collapse the desktop nav below 768px',
		viewportIndex: 0,
		route: TARGET,
	},
	{
		id: 'illegible-body-copy',
		label: '可読性下限割れ（body が 10px）',
		// Measured at the phone width with a rendered nav, so the nav
		// rules pass and the legibility floor is the rule under test —
		// a fixture rejected for a different reason would not prove the
		// rule it is named after.
		html: '<!doctype html><html lang="ja"><head><title>fixture</title><style>body{font-size:10px;margin:0}.toggle{width:44px;height:44px}</style></head><body><nav aria-label="Public"><button class="toggle" aria-controls="panel"></button></nav><main id="about-main"><h1>木村友亮</h1></main></body></html>',
		rule: 'body font size must stay legible',
		viewportIndex: 0,
		route: TARGET,
	},
];

test.describe('negative control — a deliberately broken page is rejected', () => {
	for (const fixture of BROKEN_FIXTURES) {
		test(`${fixture.id} fails the contract (${fixture.label})`, async ({ page }) => {
			const viewport = VIEWPORTS[fixture.viewportIndex];
			await page.setViewportSize({ width: viewport.width, height: viewport.height });
			await page.setContent(fixture.html, { waitUntil: 'load' });

			const observation: LayoutObservation = await observeCurrentDocument(
				page,
				`fixture:${fixture.id}`,
			);

			// The message is part of the assertion: a rejection for the
			// WRONG reason would hide a judge that passes broken pages
			// for an unrelated (and possibly benign) difference.
			expect(() => assertViewportLayout(fixture.route, viewport, observation)).toThrow(
				fixture.rule,
			);
		});
	}
});

test.describe('negative control — an unimplemented route is never green', () => {
	test(`${UNIMPLEMENTED_PATH} is rejected, not skipped`, async ({ page }) => {
		await page.setViewportSize({ width: PHONE.width, height: PHONE.height });
		const observation = await observeLayout(page, UNIMPLEMENTED_PATH);

		// Proof it is not silently "not covered": the router answered,
		// so the route is a real 404 surface rather than an absent one.
		expect(observation.status).toBe(404);
		expect(() => assertViewportLayout(TARGET, PHONE, observation)).toThrow('must respond 200 HTML');
	});
});

test.describe('negative control — the judge still accepts the real page', () => {
	test(`${TARGET.path} satisfies the same judge that rejected the fixtures`, async ({ page }) => {
		await page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });
		const observation = await observeLayout(page, TARGET.path);

		// Without this line the fixture rejections above would only prove
		// that `assertViewportLayout` throws unconditionally.
		expect(() => assertViewportLayout(TARGET, DESKTOP, observation)).not.toThrow();
	});
});
