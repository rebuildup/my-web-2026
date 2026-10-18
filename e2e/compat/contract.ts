/**
 * Cross-engine public UI contract (Issue #415).
 *
 * The roster below is the closed set of public routes this repository
 * ships today. "Closed" is the important word: the compat gate asserts
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
	 * `PublicNav` is opt-in per page (Issue #199 / #288): `/` and the
	 * Tools surfaces deliberately render none. Pinning presence or
	 * absence here keeps a regression in either direction visible.
	 */
	readonly nav: 'present' | 'absent';
}

/**
 * The roster. Order is the visitor path, not alphabetical, so the
 * matrix report reads top-to-bottom like the site does.
 */
export const COMPAT_ROUTES: ReadonlyArray<CompatRoute> = [
	{ path: '/', slug: 'home', label: 'ホーム', h1: /^my-web-2026$/, nav: 'absent' },
	{
		path: '/portfolio',
		slug: 'portfolio',
		label: 'ポートフォリオ',
		h1: /主要な制作物/,
		nav: 'present',
	},
	{ path: '/tools', slug: 'tools', label: 'ツール', h1: /Tools/, nav: 'absent' },
	{ path: '/about', slug: 'about', label: '自己紹介', h1: /木村友亮/, nav: 'present' },
	{ path: '/contact', slug: 'contact', label: 'お問い合わせ', h1: /^Contact$/, nav: 'present' },
	{
		path: '/design-system',
		slug: 'design-system',
		label: 'デザインシステム',
		h1: /Design System/,
		nav: 'present',
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
	readonly mainCount: number;
	readonly mainVisible: boolean;
	readonly navCount: number;
	/** Uncaught JS exceptions (`pageerror`) seen while the page loaded. */
	readonly pageErrors: ReadonlyArray<string>;
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

		const h1First = page.locator('h1').first();
		const h1Visible = (await h1First.count()) > 0 && (await h1First.isVisible());
		const main = page.locator('main#main');

		return {
			path,
			status: response?.status() ?? null,
			title: await page.title(),
			lang: await page.evaluate(() => document.documentElement.lang),
			h1Count: await page.locator('h1').count(),
			h1Text: (await h1First.textContent())?.trim() ?? '',
			h1Visible,
			mainCount: await main.count(),
			mainVisible: (await main.count()) > 0 && (await main.isVisible()),
			navCount: await page.locator('nav[aria-label="Public"]').count(),
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
	const h1First = page.locator('h1').first();
	const h1Visible = (await h1First.count()) > 0 && (await h1First.isVisible());
	const main = page.locator('main#main');
	const mainCount = await main.count();

	return {
		path,
		status,
		title: await page.title(),
		lang: await page.evaluate(() => document.documentElement.lang),
		h1Count: await page.locator('h1').count(),
		h1Text: (await h1First.textContent())?.trim() ?? '',
		h1Visible,
		mainCount,
		mainVisible: mainCount > 0 && (await main.isVisible()),
		navCount: await page.locator('nav[aria-label="Public"]').count(),
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

	// 3. The `main#main` landmark every public surface renders — the
	//    skip link's target. Without it, keyboard users land nowhere.
	expect(observation.mainCount, `${where} must render main#main`).toBe(1);
	expect(observation.mainVisible, `${where} main#main must be visible`).toBe(true);

	// 4. `PublicNav` presence follows the per-page opt-in contract
	//    (Issue #199 / #288) in both directions.
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
