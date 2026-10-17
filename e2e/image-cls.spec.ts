import { type Page, expect, test } from '@playwright/test';
import {
	BOX_EPSILON_PX,
	CLS_BUDGET,
	CPU_THROUGHPLE_RATE,
	IMAGE_CLS_ROUTE,
	IMAGE_RESPONSE_DELAY_MS,
	LAYOUT_SHIFT_INIT_SCRIPT,
	LAZY_SCOPE_FIXTURE,
	LAZY_SCOPE_IMAGE,
	LAZY_SCOPE_IMG_SELECTOR,
	LAZY_SCOPE_SENTINEL_SELECTOR,
	LAZY_SCOPE_SIZE,
	readLayoutShift,
	sleep,
	stripImageReservation,
} from '../scripts/_image-cls.mjs';

/**
 * Image CLS regression surface (Issue #486).
 *
 * The unit tests in `PortfolioMedia.client.test.tsx` assert the DOM
 * half of the reservation contract (the `width` / `height`
 * attributes exist). This spec asserts the half that only a real
 * layout engine can answer: with a late, throttled image fetch, does
 * the reserved box actually keep its height, and does anything below
 * it move?
 *
 * Target: `/design-system` section `07 — Image`, which renders the
 * PRODUCTION `PortfolioMediaFigure` with fixture rows. `/portfolio`
 * itself cannot be used — `composeMediaUrl` returns `null` until the
 * R2 public custom domain is bound, and `MEDIA_PUBLIC_BASE_URL` is a
 * production-only var, so every local render there takes the
 * placeholder branch and proves nothing about the `<img>`.
 *
 * Conditions (delay / CPU throttle / budget) live in
 * `scripts/_image-cls.mjs` so this gate and
 * `scripts/image-cls-report.mjs` measure under identical conditions.
 *
 * Scope: local runs only in practice — the section ships with this
 * change, and `playwright.config.ts` runs every non-`prod-*` spec
 * against whatever `PLAYWRIGHT_BASE_URL` points at.
 */

type Measurement = {
	cls: { total: number; scoped: number; entries: unknown[]; error: string | null };
	boxBefore: { width: number; height: number } | null;
	boxAfter: { width: number; height: number } | null;
	sentinelBefore: { x: number; y: number } | null;
	sentinelAfter: { x: number; y: number } | null;
};

/**
 * Fail loudly when a box could not be measured.
 *
 * A missing bounding box means the locator resolved nothing, and a
 * spec that then compares `undefined` heights would quietly pass on
 * `NaN` comparisons. The measurement is the deliverable here, so a
 * measurement that did not happen is an error, not a 0.
 */
function requireBoxes(measurement: Measurement): {
	before: { width: number; height: number };
	after: { width: number; height: number };
	sentinelBefore: { x: number; y: number };
	sentinelAfter: { x: number; y: number };
} {
	const { boxBefore, boxAfter, sentinelBefore, sentinelAfter } = measurement;
	if (!boxBefore || !boxAfter || !sentinelBefore || !sentinelAfter) {
		throw new Error(`image CLS measurement produced no boxes: ${JSON.stringify(measurement)}`);
	}
	return { before: boxBefore, after: boxAfter, sentinelBefore, sentinelAfter };
}

/**
 * Drive one measurement pass.
 *
 * `stripReservation` emulates the pre-#486 rendering (see
 * `stripImageReservation`). It is applied after the DOM is parsed but
 * BEFORE the throttled image response lands, because a decoded image
 * carries its own ratio and stripping after the fact would be a
 * no-op — i.e. a measurement that would silently report "no
 * regression" for a component that never had a reservation.
 */
async function measure(
	page: Page,
	options: { stripReservation?: boolean } = {},
): Promise<Measurement> {
	await page.addInitScript({ content: LAYOUT_SHIFT_INIT_SCRIPT });
	// Delay only the fixture raster the lazy cell requests. The rest of
	// the page (HTML, CSS, the eager cover) is untouched so the
	// measurement isolates the lazy path.
	await page.route(`**${LAZY_SCOPE_IMAGE}`, async (route) => {
		await sleep(IMAGE_RESPONSE_DELAY_MS);
		await route.continue();
	});

	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROUGHPLE_RATE });

	await page.goto(`${IMAGE_CLS_ROUTE}#design-system-image`, {
		waitUntil: options.stripReservation ? 'commit' : 'load',
	});
	const img = page.locator(LAZY_SCOPE_IMG_SELECTOR);
	await img.waitFor({ state: 'attached' });

	if (options.stripReservation) {
		const result = await stripImageReservation(page);
		expect(result.stripped).toBe(true);
	}

	// The reservation must already be measurable BEFORE the bytes
	// arrive: a 0px-tall box here is exactly the regression.
	await img.scrollIntoViewIfNeeded();
	const boxBefore = await img.boundingBox();
	const sentinel = page.locator(LAZY_SCOPE_SENTINEL_SELECTOR);
	const sentinelBefore = await sentinel.boundingBox();

	await page.waitForFunction(
		(selector) => {
			const node = document.querySelector(selector);
			return node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0;
		},
		LAZY_SCOPE_IMG_SELECTOR,
		{ timeout: 20_000 },
	);

	const boxAfter = await img.boundingBox();
	const sentinelAfter = await sentinel.boundingBox();
	// Let the compositor settle so the load-time shift, if any, has
	// been delivered to the observer before it is read.
	await sleep(250);
	const cls = await readLayoutShift(page);
	await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });

	return { cls, boxBefore, boxAfter, sentinelBefore, sentinelAfter };
}

test.describe('image layout contract (/design-system 07 — Image)', () => {
	test('every fixture cell renders the component that ships in production', async ({ page }) => {
		const res = await page.goto(`${IMAGE_CLS_ROUTE}#design-system-image`);
		expect(res?.status()).toBe(200);
		await expect(page.locator('h1#design-system-hero-title')).toBeVisible();
		for (const id of [LAZY_SCOPE_FIXTURE, 'eager-cover', 'placeholder', 'unknown-size']) {
			await expect(page.locator(`[data-cls-fixture="${id}"]`)).toHaveCount(1);
		}
	});

	test('the <img> declares its intrinsic size and lazy-loads (width/height / loading / srcset)', async ({
		page,
	}) => {
		await page.goto(`${IMAGE_CLS_ROUTE}#design-system-image`);

		const lazy = page.locator(LAZY_SCOPE_IMG_SELECTOR);
		await expect(lazy).toHaveAttribute('width', String(LAZY_SCOPE_SIZE.width));
		await expect(lazy).toHaveAttribute('height', String(LAZY_SCOPE_SIZE.height));
		await expect(lazy).toHaveAttribute('loading', 'lazy');
		await expect(lazy).toHaveAttribute('decoding', 'async');
		await expect(lazy).toHaveAttribute('alt', /CLS fixture/);

		// `srcset` / `sizes` are measured, not assumed: this repository
		// has no variant pipeline behind them (see
		// `docs/verification/perf/README.md`), so the element must NOT
		// claim a rendition set that nothing would ever produce. When a
		// pipeline is added, this assertion is the line that changes.
		expect(await lazy.getAttribute('srcset')).toBeNull();
		expect(await lazy.getAttribute('sizes')).toBeNull();

		const eager = page.locator('[data-cls-fixture="eager-cover"] img');
		await expect(eager).toHaveAttribute('loading', 'eager');
		await expect(eager).toHaveAttribute('width', '1600');
		await expect(eager).toHaveAttribute('height', '900');

		// A row with no measured size degrades to "no reservation"
		// rather than to `width="0"` or a forced (distorting) ratio.
		const unknown = page.locator('[data-cls-fixture="unknown-size"] img');
		expect(await unknown.getAttribute('width')).toBeNull();
		expect(await unknown.getAttribute('height')).toBeNull();

		// The placeholder frame reserves the same ratio the image used,
		// so the error swap cannot change the box.
		const placeholder = page.locator('[data-cls-fixture="placeholder"] figure[role="img"]');
		await expect(placeholder).toHaveCount(1);
		expect(await placeholder.evaluate((node) => getComputedStyle(node).aspectRatio)).toMatch(
			/1600\s*\/\s*900/,
		);
	});

	test('a late lazy image keeps its reserved height — no layout shift (#486 AC1)', async ({
		page,
	}) => {
		const measurement = await measure(page);
		const boxes = requireBoxes(measurement);

		expect(measurement.cls.error).toBeNull();

		// The box is already its final size before the bytes arrive…
		expect(Math.abs(boxes.after.height - boxes.before.height)).toBeLessThanOrEqual(BOX_EPSILON_PX);
		// …and the content below it never moved.
		expect(Math.abs(boxes.sentinelAfter.y - boxes.sentinelBefore.y)).toBeLessThanOrEqual(
			BOX_EPSILON_PX,
		);

		expect(measurement.cls.scoped).toBeLessThanOrEqual(CLS_BUDGET);
	});

	test('the measurement can still detect the regression (false-green guard)', async ({ page }) => {
		// Without this test the gate above is worthless: a spec that
		// reports 0 because nothing was ever measured would pass the
		// same way. Stripping the reservation reproduces the pre-#486
		// DOM, and the SAME conditions must then produce a shift.
		const measurement = await measure(page, { stripReservation: true });
		const boxes = requireBoxes(measurement);

		expect(measurement.cls.error).toBeNull();

		// The broken rendering collapses the box while the image is in
		// flight and then grows it back to the same height.
		expect(boxes.before.height).toBeLessThan(BOX_EPSILON_PX);
		expect(boxes.after.height).toBeGreaterThan(boxes.before.height + 1);

		// And the sentinel below it was pushed down by that growth.
		expect(boxes.sentinelAfter.y).toBeGreaterThan(boxes.sentinelBefore.y + 1);
		expect(measurement.cls.scoped).toBeGreaterThan(0);
	});
});
