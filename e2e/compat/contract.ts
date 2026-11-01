/**
 * Cross-engine public UI contract (Issue #415).
 *
 * The roster below is the closed set of public LANDING routes this
 * repository ships today. Detail surfaces that embed user content
 * (`/portfolio/$slug`, `/tools/$slug`) are out of scope by design: the
 * gate is about the shell / display contract, not per-record pages.
 * "Closed" is the important word: the compat gate asserts
 * every entry against three engines, and a route that is NOT in this
 * list is never reported as a pass — it is reported as "not covered"
 * (`docs/development.md` § Compat matrix). That is the anti-silent-pass
 * half of the Issue's 「未実装routeを無言の合格にしない」 requirement.
 *
 * Design constraints (why the assertions look the way they do)
 * -----------------------------------------------------------
 *   - Engine-agnostic only. Every rule is a DOM/status fact that
 *     Chromium, Firefox and WebKit must agree on. No vendor-prefixed
 *     geometry, no timing, no font metrics.
 *   - One observation, many rules. `observeRoute()` collects the facts
 *     ONCE and `assertRouteContract()` judges them from that snapshot.
 *     Asserting on the live locator would burn the 5 s expect timeout
 *     per rule inside the negative-control fixtures, and would make the
 *     failure message depend on which rule happened to run first.
 *   - The judge is a pure function over data. That is what lets
 *     `negative-control.spec.ts` prove the SAME helper rejects a
 *     deliberately broken page — a gate that cannot be shown to fail
 *     is a gate nobody can trust.
 */

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** One public route plus the display contract all three engines must satisfy. */
export interface CompatRoute {
	/** In-site path, relative to the Playwright `baseURL`. */
	readonly path: string;
	/** Stable file-name stem for the per-engine screenshot. */
	readonly slug: string;
	/** Editorial (Japanese) label used in the verification report. */
	readonly label: string;
	/** Canonical `<h1>` text contract. Regex on purpose: copy may be revised. */
	readonly h1: RegExp;
	/**
	 * `PublicNav` is opt-in per page (Issue #199): `/` deliberately
	 * renders none, and Issue #785 abolished the Issue #288 exclusion
	 * that also covered the Tools surfaces — they render it again.
	 * Pinning presence or absence here keeps a regression in either
	 * direction visible.
	 */
	readonly nav: 'present' | 'absent';
	/**
	 * Expected `<main id>` of the route's content landmark, or `'none'`
	 * when the route deliberately has none.
	 *
	 * The ids are per-surface on purpose (`about-main`,
	 * `design-system-main`) and `'none'` is a real, documented state:
	 * `/tools` renders no `<main>` landmark. That is a LANDMARK decision,
	 * not the chrome one — Issue #785 restored `PublicNav` and the
	 * breadcrumbs there, and the page still owns no content landmark.
	 * Encoding the expectation instead of assuming one
	 * shape means a page that gains or loses its landmark turns this
	 * matrix red in the direction it actually moved.
	 */
	readonly main: 'main' | 'about-main' | 'design-system-main' | 'none';
	/**
	 * Whether the route renders the skip-to-content link
	 * (`a[href="#main"]`). It exists on `/` and `/contact` only, and its
	 * target must resolve — a skip link pointing at a missing id is a
	 * keyboard dead end.
	 */
	readonly skipLink: boolean;
}

/**
 * The roster. Order is the visitor path, not alphabetical, so the
 * matrix report reads top-to-bottom like the site does.
 */
export const COMPAT_ROUTES: ReadonlyArray<CompatRoute> = [
	{
		path: '/',
		slug: 'home',
		label: 'ホーム',
		h1: /^my-web-2026$/,
		nav: 'absent',
		main: 'main',
		skipLink: true,
	},
	{
		path: '/portfolio',
		slug: 'portfolio',
		label: 'ポートフォリオ',
		h1: /主要な制作物/,
		nav: 'present',
		main: 'main',
		skipLink: false,
	},
	{
		path: '/tools',
		slug: 'tools',
		label: 'ツール',
		// Issue #785 rebuilt the index around a two-section card grid;
		// the <h1> is the Japanese surface title again (the old hero
		// read "my-web-2026 / Tools").
		h1: /^ツール$/,
		nav: 'present',
		main: 'none',
		skipLink: false,
	},
	{
		path: '/about',
		slug: 'about',
		label: '自己紹介',
		h1: /木村友亮/,
		nav: 'present',
		main: 'about-main',
		skipLink: false,
	},
	{
		path: '/contact',
		slug: 'contact',
		label: 'お問い合わせ',
		h1: /^Contact$/,
		nav: 'present',
		main: 'main',
		skipLink: true,
	},
	{
		path: '/design-system',
		slug: 'design-system',
		label: 'デザインシステム',
		h1: /Design System/,
		nav: 'present',
		main: 'design-system-main',
		skipLink: false,
	},
];

/** Facts collected from one rendered document. */
export interface RouteObservation {
	readonly path: string;
	readonly status: number | null;
	readonly title: string;
	readonly lang: string;
	readonly h1Count: number;
	readonly h1Text: string;
	readonly h1Visible: boolean;
	/** Every `<main>` in the document, whatever its id. */
	readonly mainCount: number;
	/** `<main>` ids in document order. */
	readonly mainIds: ReadonlyArray<string>;
	readonly mainVisible: boolean;
	readonly navCount: number;
	readonly skipLinkCount: number;
	/** Uncaught JS exceptions (`pageerror`) seen while the page loaded. */
	readonly pageErrors: ReadonlyArray<string>;
}

/**
 * Read the landmark facts from the CURRENT document.
 *
 * Every count is taken BEFORE any text read, and a text read only
 * happens when its element exists. `locator.textContent()` waits for
 * the element, so a document that legitimately renders no `<h1>` (a
 * 404 surface, a broken fixture) would otherwise burn the whole test
 * timeout before the judge ever saw the fact it was about to assert.
 */
async function readLandmarks(page: Page): Promise<{
	h1Count: number;
	h1Text: string;
	h1Visible: boolean;
	mainCount: number;
	mainIds: string[];
	mainVisible: boolean;
	navCount: number;
	skipLinkCount: number;
}> {
	const h1 = page.locator('h1');
	const h1Count = await h1.count();
	const h1Visible = h1Count > 0 && (await h1.first().isVisible());
	const main = page.locator('main');
	const mainCount = await main.count();
	const mainIds: string[] = [];
	for (let i = 0; i < mainCount; i += 1) {
		mainIds.push((await main.nth(i).getAttribute('id')) ?? '');
	}

	return {
		h1Count,
		h1Text: h1Count > 0 ? ((await h1.first().textContent())?.trim() ?? '') : '',
		h1Visible,
		mainCount,
		mainIds,
		mainVisible: mainCount > 0 && (await main.first().isVisible()),
		navCount: await page.locator('nav[aria-label="Public"]').count(),
		skipLinkCount: await page.locator('a[href="#main"]').count(),
	};
}

/**
 * Navigate to `path` and collect the facts above.
 *
 * Uncaught exceptions are registered BEFORE the navigation, so a
 * throw during hydration is captured. Console noise (failed font
 * requests, GA) is deliberately NOT collected: those are network
 * events whose presence differs per environment, and failing on them
 * would make this gate a proxy for internet access rather than for
 * rendering.
 */
export async function observeRoute(page: Page, path: string): Promise<RouteObservation> {
	const pageErrors: string[] = [];
	const onPageError = (error: Error): void => {
		pageErrors.push(error.message.split('\n')[0] ?? error.name);
	};
	page.on('pageerror', onPageError);

	try {
		const response = await page.goto(path, { waitUntil: 'load' });
		// The SSR response is already complete at `load`; a short settle
		// lets the hydrated client paint so visibility is measured on the
		// final tree rather than a half-hydrated one. Fixed and short on
		// purpose — no engine-differential timing is allowed into a gate.
		await page.waitForTimeout(300);

		return {
			path,
			status: response?.status() ?? null,
			title: await page.title(),
			lang: await page.evaluate(() => document.documentElement.lang),
			...(await readLandmarks(page)),
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
 * to navigate to, and pretending otherwise would hide the very thing
 * being tested.
 */
export async function observeCurrentDocument(
	page: Page,
	path: string,
	status: number | null = 200,
): Promise<RouteObservation> {
	return {
		path,
		status,
		title: await page.title(),
		lang: await page.evaluate(() => document.documentElement.lang),
		...(await readLandmarks(page)),
		pageErrors: [],
	};
}

/**
 * Judge one observation against one route contract.
 *
 * Throws (via Playwright `expect`) on the first violated rule. Pure and
 * synchronous so `negative-control.spec.ts` can assert that it rejects
 * a broken fixture — and that it accepts the real page, which is what
 * makes the rejection meaningful rather than a helper that always
 * throws.
 */
export function assertRouteContract(route: CompatRoute, observation: RouteObservation): void {
	const where = `${observation.path} (${route.label})`;

	// 1. The route must actually exist. A 404 / 5xx / missing response
	//    is the "unimplemented route" case the Issue calls out: it must
	//    be red, never a skipped-but-green cell.
	expect(observation.status, `${where} must respond 200 HTML`).toBe(200);

	// 2. Exactly one canonical h1, visible, matching the documented text.
	expect(observation.h1Count, `${where} must render exactly one <h1>`).toBe(1);
	expect(observation.h1Visible, `${where} <h1> must be visible`).toBe(true);
	expect(observation.h1Text, `${where} <h1> text must match ${String(route.h1)}`).toMatch(route.h1);

	// 3. The content landmark, in the shape this route actually
	//    documents. `/tools` deliberately has none; the rest expose
	//    exactly one `<main>` with a known id.
	if (route.main === 'none') {
		expect(observation.mainCount, `${where} must not grow a <main> landmark`).toBe(0);
	} else {
		expect(observation.mainCount, `${where} must render exactly one <main>`).toBe(1);
		expect(observation.mainIds, `${where} <main> id must be "${route.main}"`).toEqual([route.main]);
		expect(observation.mainVisible, `${where} <main> must be visible`).toBe(true);
	}

	// 3b. A skip link pointing nowhere is a keyboard dead end, so where
	//     the link exists its target must exist too — and where it does
	//     not exist, it must not appear.
	if (route.skipLink) {
		expect(observation.skipLinkCount, `${where} must render the skip-to-content link`).toBe(1);
		expect(observation.mainIds, `${where} skip link target main#main must exist`).toContain('main');
	} else {
		expect(
			observation.skipLinkCount,
			`${where} must not render a link to a #main target it does not own`,
		).toBe(0);
	}

	// 4. `PublicNav` presence follows the per-page opt-in contract
	//    (Issue #199; the Tools exclusion Issue #288 added was abolished
	//    by #785) in both directions.
	if (route.nav === 'present') {
		expect(observation.navCount, `${where} must mount <nav aria-label="Public">`).toBe(1);
	} else {
		expect(observation.navCount, `${where} must NOT mount the public nav`).toBe(0);
	}

	// 5. The document is Japanese (`<html lang="ja">` in `__root.tsx`).
	expect(observation.lang, `${where} must declare <html lang="ja">`).toBe('ja');

	// 6. No uncaught JS exception while the route rendered.
	expect(observation.pageErrors, `${where} must render without an uncaught JS exception`).toEqual(
		[],
	);
}
