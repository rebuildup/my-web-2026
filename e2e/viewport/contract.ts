/**
 * Viewport layout contract for the representative public surfaces
 * (Issue #417).
 *
 * Issue #415 already answers "does the public UI work in every engine".
 * This file answers the orthogonal question: "does the SAME surface
 * still lay out correctly when the viewport is a phone, a tablet in
 * either orientation, or a laptop". The two gates deliberately do not
 * overlap — a layout that is correct in Chromium can still overflow
 * horizontally on a 390px phone, and no amount of cross-engine
 * agreement makes that overflow acceptable.
 *
 * The roster is a CLOSED set of the representative surfaces the Issue
 * names (Home / Portfolio / Content) crossed with the four viewport
 * classes it names. "Closed" is the load-bearing word: the gate
 * asserts every cell, and a cell that was never executed is reported
 * as 「未実行（no silent pass）」 by
 * `scripts/make-viewport-diff-grid-report.mjs` rather than folded into
 * a pass.
 *
 * Design constraints (why the assertions look the way they do)
 * -----------------------------------------------------------
 *   - One observation, many rules. `observeLayout()` collects the
 *     facts ONCE and `assertViewportLayout()` judges them from that
 *     snapshot. Asserting on live locators would burn the expect
 *     timeout per rule inside the negative controls and make the
 *     failure message depend on which rule ran first.
 *   - The judge is a pure function over data. That is what lets
 *     `negative-control.spec.ts` feed it a deliberately broken page
 *     and prove the SAME judge rejects it — a gate that has only ever
 *     been seen green proves nothing.
 *   - Geometry, not aesthetics. Every rule below is a number the
 *     browser reports identically regardless of font stack or GPU, so
 *     the gate is not a proxy for "does this machine have the same
 *     fonts installed".
 */

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Horizontal overflow allowance, in CSS px.
 *
 * Sub-pixel layout rounding puts a fractional pixel on
 * `documentElement.scrollWidth` on some engines; anything at or below
 * this is rounding, anything above it is a real overflow the visitor
 * has to scroll sideways to escape.
 */
export const OVERFLOW_TOLERANCE_PX = 1;

/**
 * Smallest body font size the gate accepts, in CSS px.
 *
 * A viewport gate that only checks widths passes a page nobody can
 * read on a phone, so legibility is part of the same contract.
 */
export const MIN_BODY_FONT_PX = 14;

/**
 * Width at which `PublicNav` swaps its compact panel for the inline
 * desktop strip (`md` in `src/editorial/tokens.ts`, consumed by
 * `src/editorial/nav/PublicNav.tsx`).
 */
export const NAV_BREAKPOINT_PX = 768;

/** One viewport class the gate captures and judges. */
export interface ViewportSpec {
	readonly width: number;
	readonly height: number;
	/** Editorial (Japanese) label for the verification report. */
	readonly label: string;
	/** Stable file-name stem: `<route-slug>-<stem>.png`. */
	readonly stem: string;
}

/**
 * The four viewport classes, narrowest first.
 *
 * They are CSS-pixel captures (`deviceScaleFactor: 1` in
 * `playwright.viewport.config.ts`): the gate is about LAYOUT, and a
 * DPR-3 phone capture would triple every raster the diff has to read
 * without changing a single measured box. The device names record
 * which class of real device each width stands for (Issue #417 asks
 * for iOS and Android tablets to be included, so 768 / 1024 are the
 * tablet rows both platforms land on, not laptop guesses).
 */
export const VIEWPORTS: ReadonlyArray<ViewportSpec> = [
	{ width: 390, height: 844, label: '390 / スマホ（iPhone 14 相当）', stem: 'w390' },
	{ width: 768, height: 1024, label: '768 / タブレット縦（iPad / Android）', stem: 'w768' },
	{ width: 1024, height: 768, label: '1024 / タブレット横（iPad / Android）', stem: 'w1024' },
	{ width: 1440, height: 900, label: '1440 / ノートPC', stem: 'w1440' },
];

/** Which `PublicNav` shape a width is contractually required to render. */
export type NavMode = 'compact' | 'wide';

/** The nav mode a viewport must render, from the `md` breakpoint alone. */
export function expectedNavMode(viewport: ViewportSpec): NavMode {
	return viewport.width >= NAV_BREAKPOINT_PX ? 'wide' : 'compact';
}

/** One representative surface the gate captures and judges. */
export interface ViewportRoute {
	readonly path: string;
	readonly slug: string;
	/** The Issue's own grouping, kept verbatim in the report. */
	readonly group: 'Home' | 'Portfolio' | 'Content';
	readonly label: string;
	/** `PublicNav` is opt-in per page (Issue #199 / Issue #288). */
	readonly nav: 'present' | 'absent';
	/** `<main>` id this surface owns, or `'none'` when it owns none. */
	readonly main: 'main' | 'about-main' | 'none';
}

/**
 * The roster. Order is the Issue's grouping (Home → Portfolio →
 * Content), so the grid report reads in the same order.
 */
export const VIEWPORT_ROUTES: ReadonlyArray<ViewportRoute> = [
	{ path: '/', slug: 'home', group: 'Home', label: 'ホーム', nav: 'absent', main: 'main' },
	{
		path: '/portfolio',
		slug: 'portfolio',
		group: 'Portfolio',
		label: 'ポートフォリオ',
		nav: 'present',
		main: 'main',
	},
	{
		path: '/about',
		slug: 'about',
		group: 'Content',
		label: '自己紹介',
		nav: 'present',
		main: 'about-main',
	},
	{
		path: '/contact',
		slug: 'contact',
		group: 'Content',
		label: 'お問い合わせ',
		nav: 'present',
		main: 'main',
	},
];

/** Facts collected from one rendered document at one viewport. */
export interface LayoutObservation {
	readonly path: string;
	readonly status: number | null;
	readonly viewport: { readonly width: number; readonly height: number };
	/** `document.documentElement.clientWidth` — the CSS viewport width. */
	readonly clientWidth: number;
	/** `document.documentElement.scrollWidth` — wider means sideways scroll. */
	readonly scrollWidth: number;
	/** `scrollWidth - clientWidth`, the overflow in CSS px. */
	readonly overflowPx: number;
	readonly mainCount: number;
	readonly mainIds: ReadonlyArray<string>;
	readonly mainVisible: boolean;
	readonly mainLeft: number;
	readonly mainRight: number;
	readonly bodyFontSize: number;
	readonly desktopNavVisible: boolean;
	readonly mobileToggleVisible: boolean;
	/** Uncaught JS exceptions (`pageerror`) seen while the page loaded. */
	readonly pageErrors: ReadonlyArray<string>;
}

/**
 * Read the layout facts from the CURRENT document.
 *
 * Shared by the gate (after a navigation) and the negative controls
 * (after `page.setContent()`), so a fixture and the real page are
 * measured by exactly the same code. There is no navigation here: the
 * negative controls deliberately load documents the router never
 * served, and pretending otherwise would hide the thing being tested.
 */
async function measureCurrentDocument(
	page: Page,
): Promise<Omit<LayoutObservation, 'path' | 'status' | 'viewport' | 'pageErrors'>> {
	return page.evaluate(() => {
		const root = document.documentElement;
		const isRendered = (selector: string): boolean => {
			const element = document.querySelector(selector);
			if (!element) return false;
			const style = window.getComputedStyle(element);
			if (style.visibility === 'hidden' || style.display === 'none') return false;
			const rect = element.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0;
		};
		const mains = [...document.querySelectorAll('main')];
		const mainRect = mains[0]?.getBoundingClientRect();

		const clientWidth = root.clientWidth;
		const scrollWidth = root.scrollWidth;

		return {
			clientWidth,
			scrollWidth,
			overflowPx: scrollWidth - clientWidth,
			mainCount: mains.length,
			mainIds: mains.map((main) => main.id),
			// Reuse the rendered-element test rather than `mainRect !== undefined`:
			// `getBoundingClientRect()` always returns a DOMRect, so the old
			// expression was true whenever a `<main>` existed — a
			// `display:none` or 0x0 landmark would have passed every rule.
			mainVisible: isRendered('main'),
			mainLeft: mainRect?.left ?? Number.NaN,
			mainRight: mainRect?.right ?? Number.NaN,
			bodyFontSize: Number.parseFloat(window.getComputedStyle(document.body).fontSize),
			desktopNavVisible: isRendered('[data-testid="public-nav-desktop"]'),
			mobileToggleVisible: isRendered('nav[aria-label="Public"] button[aria-controls]'),
		};
	});
}

/**
 * Navigate to `path` at the CURRENT viewport and collect the facts
 * above in one round trip.
 *
 * Uncaught exceptions are registered BEFORE the navigation so a throw
 * during hydration is captured. Console noise (failed font requests,
 * analytics) is deliberately not collected: those are network events
 * whose presence differs per environment, and failing on them would
 * make this gate a proxy for internet access rather than for layout.
 */
export async function observeLayout(page: Page, path: string): Promise<LayoutObservation> {
	const pageErrors: string[] = [];
	const onPageError = (error: Error): void => {
		pageErrors.push(error.message.split('\n')[0] ?? error.name);
	};
	page.on('pageerror', onPageError);

	try {
		const response = await page.goto(path, { waitUntil: 'load' });
		// The SSR response is complete at `load`; a short settle lets
		// the hydrated client paint so every box is measured on the
		// final tree. Fixed and short on purpose — a layout gate must
		// not depend on machine speed.
		await page.waitForTimeout(300);

		return {
			path,
			status: response?.status() ?? null,
			viewport: page.viewportSize() ?? { width: 0, height: 0 },
			...(await measureCurrentDocument(page)),
			pageErrors,
		};
	} finally {
		page.off('pageerror', onPageError);
	}
}

/**
 * Collect the same facts from the CURRENT document without navigating.
 *
 * Used by the negative controls, which load a deliberately broken
 * fixture with `page.setContent()` — there is no `baseURL` document
 * to navigate to.
 */
export async function observeCurrentDocument(
	page: Page,
	path: string,
	status: number | null = 200,
): Promise<LayoutObservation> {
	return {
		path,
		status,
		viewport: page.viewportSize() ?? { width: 0, height: 0 },
		...(await measureCurrentDocument(page)),
		pageErrors: [],
	};
}

/**
 * Judge one observation against one route contract at one viewport.
 *
 * Throws (via Playwright `expect`) on the first violated rule. Pure
 * and synchronous, so the negative controls can assert it rejects a
 * deliberately broken document — and that it accepts the real page,
 * which is what makes the rejection meaningful rather than a helper
 * that always throws.
 */
export function assertViewportLayout(
	route: ViewportRoute,
	viewport: ViewportSpec,
	observation: LayoutObservation,
): void {
	const where = `${observation.path} @${viewport.width}px (${route.label})`;

	// 1. The route must actually exist at this viewport. A 404 / 5xx is
	//    the 「未実装route」 case the Issue calls out: it must be red,
	//    never a skipped-but-green cell.
	expect(observation.status, `${where} must respond 200 HTML`).toBe(200);

	// 2. No sideways scroll. This is the responsive regression the
	//    Issue is about, and it is the one rule every surface shares
	//    at every width.
	expect(
		observation.overflowPx,
		`${where} must not scroll sideways (scrollWidth ${observation.scrollWidth} > clientWidth ${observation.clientWidth})`,
	).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

	// 3. The content landmark exists, and sits inside the viewport
	//    horizontally. A landmark narrower than the viewport is fine
	//    (centred layouts); one wider than it is the same overflow as
	//    rule 2, reported against the element that causes it.
	expect(observation.mainCount, `${where} must render exactly one <main>`).toBe(1);
	expect(observation.mainIds, `${where} <main> id must be "${route.main}"`).toEqual([route.main]);
	expect(observation.mainVisible, `${where} <main> must be visible`).toBe(true);
	expect(
		observation.mainRight,
		`${where} <main> must not extend past the viewport edge`,
	).toBeLessThanOrEqual(viewport.width + OVERFLOW_TOLERANCE_PX);
	expect(
		observation.mainLeft,
		`${where} <main> must not start left of the viewport`,
	).toBeGreaterThanOrEqual(-OVERFLOW_TOLERANCE_PX);

	// 4. `PublicNav` shape follows the `md` breakpoint, in both
	//    directions: a compact panel that leaks onto a laptop, or an
	//    inline strip that never collapses on a phone, are both
	//    regressions. Routes that opt out must render neither.
	const mode = expectedNavMode(viewport);
	if (route.nav === 'absent') {
		expect(observation.desktopNavVisible, `${where} must NOT mount the desktop nav`).toBe(false);
		expect(observation.mobileToggleVisible, `${where} must NOT mount the nav toggle`).toBe(false);
	} else if (mode === 'compact') {
		expect(
			observation.desktopNavVisible,
			`${where} must collapse the desktop nav below ${NAV_BREAKPOINT_PX}px`,
		).toBe(false);
		expect(
			observation.mobileToggleVisible,
			`${where} must mount the nav toggle below ${NAV_BREAKPOINT_PX}px`,
		).toBe(true);
	} else {
		expect(
			observation.desktopNavVisible,
			`${where} must render the desktop nav at ${NAV_BREAKPOINT_PX}px and above`,
		).toBe(true);
		expect(
			observation.mobileToggleVisible,
			`${where} must hide the nav toggle at ${NAV_BREAKPOINT_PX}px and above`,
		).toBe(false);
	}

	// 5. Legible body text. A phone-width capture that is technically
	//    free of overflow but set at 10px is a broken phone layout.
	expect(
		observation.bodyFontSize,
		`${where} body font size must stay legible (>= ${MIN_BODY_FONT_PX}px)`,
	).toBeGreaterThanOrEqual(MIN_BODY_FONT_PX);

	// 6. No uncaught JS exception while the route rendered at this
	//    viewport — hydration that only breaks at one width is still a
	//    broken width.
	expect(observation.pageErrors, `${where} must render without an uncaught JS exception`).toEqual(
		[],
	);
}
