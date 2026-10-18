/**
 * Negative control for the compat gate (Issue #415).
 *
 * The Issue requires 「3 engineで主要表示が成立し、故意の破損でfail」
 * — the gate must be shown to FAIL on a deliberately broken page,
 * not merely to pass on a healthy one. A smoke that has only ever
 * been observed green proves nothing about its ability to go red, and
 * a selector typo would leave it green forever.
 *
 * Therefore this spec feeds the SAME `assertRouteContract` judge used
 * by `public-ui.spec.ts`:
 *
 *   1. three broken fixtures (missing `<main>`, missing `<h1>`,
 *      missing the opt-in `PublicNav`), each rejected by the exact
 *      rule that is supposed to catch it;
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
	COMPAT_ROUTES,
	type CompatRoute,
	type RouteObservation,
	assertRouteContract,
	observeCurrentDocument,
	observeRoute,
} from './contract';

/** `/about` — an opt-in route, so all four fixture rules can target it. */
const TARGET = COMPAT_ROUTES.find((route) => route.path === '/about') as CompatRoute;

/** A route that is intentionally not part of the roster. */
const UNIMPLEMENTED_PATH = '/compat-definitely-not-a-real-route';

interface BrokenFixture {
	readonly id: string;
	readonly label: string;
	readonly html: string;
	/** Substring of the failure message the responsible rule must produce. */
	readonly rule: string;
}

const BROKEN_FIXTURES: ReadonlyArray<BrokenFixture> = [
	{
		id: 'no-main-landmark',
		label: 'main#main が欠落（本文が空）',
		html: '<!doctype html><html lang="ja"><head><title>fixture</title></head><body><h1>木村友亮</h1><p>本文だけ。</p></body></html>',
		rule: 'must render exactly one <main>',
	},
	{
		id: 'no-h1',
		label: '正規の h1 が欠落（見出しゼロ）',
		html: '<!doctype html><html lang="ja"><head><title>fixture</title></head><body><main id="about-main"><h2>プロフィール</h2></main></body></html>',
		rule: 'must render exactly one <h1>',
	},
	{
		id: 'nav-not-mounted',
		label: 'opt-in 契約違反（PublicNav 未マウント）',
		html: '<!doctype html><html lang="ja"><head><title>fixture</title></head><body><main id="about-main"><h1>木村友亮</h1></main></body></html>',
		rule: 'must mount <nav aria-label="Public">',
	},
];

test.describe('negative control — a deliberately broken page is rejected', () => {
	for (const fixture of BROKEN_FIXTURES) {
		test(`${fixture.id} fails the contract (${fixture.label})`, async ({ page }) => {
			await page.setContent(fixture.html, { waitUntil: 'load' });

			const observation: RouteObservation = await observeCurrentDocument(
				page,
				`fixture:${fixture.id}`,
			);

			// The message is part of the assertion: a rejection for the
			// WRONG reason would hide a judge that passes broken pages
			// for an unrelated (and possibly benign) difference.
			expect(() => assertRouteContract(TARGET, observation)).toThrow(fixture.rule);
		});
	}
});

test.describe('negative control — an unimplemented route is never green', () => {
	test(`${UNIMPLEMENTED_PATH} is rejected, not skipped`, async ({ page }) => {
		const observation = await observeRoute(page, UNIMPLEMENTED_PATH);

		// Proof it is not silently "not covered": the router answered, so
		// the route is a real 404 surface rather than an absent one.
		expect(observation.status).toBe(404);
		expect(() => assertRouteContract(TARGET, observation)).toThrow('must respond 200 HTML');
	});
});

test.describe('negative control — the judge still accepts the real page', () => {
	test('/about satisfies the same judge that rejected the fixtures', async ({ page }) => {
		const observation = await observeRoute(page, TARGET.path);

		// Without this line the fixture rejections above would only prove
		// that `assertRouteContract` throws unconditionally.
		expect(() => assertRouteContract(TARGET, observation)).not.toThrow();
	});
});
