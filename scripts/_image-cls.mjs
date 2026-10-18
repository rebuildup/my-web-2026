/**
 * Shared measurement contract for the image CLS surface (Issue #486).
 *
 * One definition of "how the image CLS regression is measured", used
 * by BOTH consumers:
 *
 *   - `e2e/image-cls.spec.ts` — the gate (fails the build),
 *   - `scripts/image-cls-report.mjs` — the evidence PNG in
 *     `docs/verification/perf/images-cls-fixture.webp`.
 *
 * They must not drift. A report that used a shorter delay or no CPU
 * throttling would print a number the gate never asserted, which is
 * the classic false green (skills/quality-gate §14). So the
 * conditions below are constants, not defaults.
 *
 * Conditions and why each one is pinned
 * -------------------------------------
 *
 *   `IMAGE_RESPONSE_DELAY_MS` — Chromium starts a `loading="lazy"`
 *   fetch only when the image approaches the viewport. Without an
 *   artificial delay the fixture PNG can be decoded before the first
 *   paint of the scrolled-to region, the box never collapses, and the
 *   measurement reports 0 for a component that has no reservation at
 *   all. 700ms is comfortably longer than the local fetch+decode of
 *   a 5KB fixture, so the "before" state really does paint a 0px box.
 *
 *   `CPU_THROUGHPLE_RATE` — 4x is Lighthouse's default mobile
 *   throttle and the slowest setting that still keeps an E2E run
 *   under the 30s timeout. CLS is a layout property, not a JS-speed
 *   property, so throttling changes nothing about the verdict — it is
 *   recorded to make the number comparable with the Lighthouse runs
 *   in #384–#387, not to make the test flaky.
 *
 *   `CLS_BUDGET` — 0. Core Web Vitals calls anything above 0.1
 *   "good" and above 0.25 "poor"; a reservation contract that exists
 *   to remove shift entirely should not spend part of that budget on
 *   one figure.
 *
 * `LAZY_SCOPE_*` — a fixture page with four cells cannot be measured
 * as one number: `unknown-size` renders with NO reservation by
 * design (that is the degradation path, see
 * `src/portfolio/components/PortfolioMedia.tsx`), so its own growth
 * would pollute a page-total and mask a regression in the cell that
 * matters. Layout-shift entries carry `sources`, so the measurement
 * is scoped to the nodes that the lazy cell can move.
 */

/** Route that hosts the fixture section. */
export const IMAGE_CLS_ROUTE = '/design-system';

/** `data-cls-fixture` value of the cell under measurement. */
export const LAZY_SCOPE_FIXTURE = 'lazy-cover';

/** Path of the fixture raster the lazy cell loads. */
export const LAZY_SCOPE_IMAGE = '/fixtures/cls-inline-1280x720.png';

/** Intrinsic size of that raster, as `scripts/generate-image-fixtures.mjs` writes it. */
export const LAZY_SCOPE_SIZE = { width: 1280, height: 720 };

/** Artificial response delay for the fixture raster (see the header). */
export const IMAGE_RESPONSE_DELAY_MS = 700;

/** CDP CPU throttling multiplier (see the header). */
export const CPU_THROUGHPLE_RATE = 4;

/** Pass criterion for the scoped CLS score. */
export const CLS_BUDGET = 0;

/** Sub-pixel tolerance when comparing two bounding boxes, in CSS px. */
export const BOX_EPSILON_PX = 0.5;

/**
 * Installed with `page.addInitScript` before navigation.
 *
 * `buffered: true` is required: entries recorded before an observer
 * attaches are still delivered, so the observer does not have to win
 * a race against first paint.
 *
 * `hadRecentInput` is filtered because Chromium excludes
 * input-adjacent shifts from CLS by definition — keeping them would
 * let a click anywhere on the page inflate a passive-scroll
 * measurement.
 *
 * Source nodes are recorded as descriptors, not element handles,
 * because a handle cannot cross the `page.evaluate` boundary
 * cheaply; a descriptor is enough to attribute the shift to a cell.
 */
export const LAYOUT_SHIFT_INIT_SCRIPT = `
(() => {
  const describe = (node) => {
    if (!node || node.nodeType !== 1) return null;
    const figure = node.closest ? node.closest('[data-cls-fixture]') : null;
    return {
      nodeName: node.nodeName.toLowerCase(),
      id: node.id || null,
      clsFixture: node.getAttribute('data-cls-fixture'),
      clsSentinel: node.getAttribute('data-cls-sentinel'),
      inFixture: figure ? figure.getAttribute('data-cls-fixture') : null,
    };
  };
  window.__imageCls = { total: 0, scoped: 0, entries: [], error: null };
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        const sources = (entry.sources || []).map((source) => describe(source.node));
        const inScope = sources.some(
          (source) =>
            source &&
            (source.inFixture === ${JSON.stringify(LAZY_SCOPE_FIXTURE)} ||
              (source.clsSentinel !== null && source.clsSentinel !== undefined)),
        );
        window.__imageCls.total += entry.value;
        if (inScope) window.__imageCls.scoped += entry.value;
        window.__imageCls.entries.push({
          value: entry.value,
          startTime: Math.round(entry.startTime),
          hadRecentInput: entry.hadRecentInput === true,
          inScope,
          sources,
        });
      }
    });
    observer.observe({ type: 'layout-shift', buffered: true });
  } catch (error) {
    window.__imageCls.error = String(error);
  }
})();
`;

/** Selector for the box that holds the lazy figure AND the sentinel below it. */
export const LAZY_SCOPE_REGION_SELECTOR = '[data-cls-region="lazy-region"]';

/**
 * How far the sentinel sits below the top of the lazy region.
 *
 * This is the quantity the acceptance criterion is actually about:
 * "the placeholder height is maintained while the image is lazy", i.e.
 * the image does not push the content below it.
 *
 * The obvious measurements are both wrong:
 *
 *   - the sentinel's ABSOLUTE y folds in every unrelated shift ABOVE
 *     it on the page — the web-font swap alone moves it by more than a
 *     pixel here — so the gate would really be asserting "this page
 *     never reflows anywhere", which is neither true nor this
 *     ticket's claim, and it was observed to flake under CI load.
 *   - the gap between the figure's BOTTOM and the sentinel is
 *     invariant to the image's own growth (the sentinel moves down by
 *     exactly the height the figure gained), so it reads 0 for the
 *     broken rendering too.
 *
 * Referencing the region's top keeps both properties: a shift above
 * the region moves the region and the sentinel together (offset
 * unchanged), while growth inside the region pushes only the sentinel
 * (offset grows by the height gained).
 */
export function regionSentinelOffset(region, sentinel) {
	return sentinel.y - region.y;
}

/** Selector for the `<img>` the lazy cell renders. */
export const LAZY_SCOPE_IMG_SELECTOR = `[data-cls-fixture="${LAZY_SCOPE_FIXTURE}"] img`;

/**
 * Read a locator's box in DOCUMENT coordinates.
 *
 * `locator.boundingBox()` is viewport-relative, and the viewport can
 * move by a fraction of a pixel without any content moving: Chromium's
 * scroll anchoring reacts to the decoded image, and
 * `scrollIntoViewIfNeeded` rounds to whole pixels. Measured that way,
 * the sentinel reads a spurious ~1.4px "movement" in the reserved
 * rendering that is really a scroll delta.
 *
 * CLS itself is computed in document space, so the sentinel has to be
 * measured there too — otherwise the acceptance check is really
 * asserting "scrolling did not jitter", which is a different (and much
 * weaker) claim.
 */
export async function readDocumentBox(locator) {
	return locator.evaluate((node) => {
		const rect = node.getBoundingClientRect();
		return {
			x: rect.x + window.scrollX,
			y: rect.y + window.scrollY,
			width: rect.width,
			height: rect.height,
		};
	});
}

/**
 * Selector for the element the lazy cell's growth would push down.
 *
 * Layout shift is only reported when rendered content MOVES. A figure
 * that grows at the very bottom of the document moves nothing, and
 * would score 0 no matter how badly its box was broken. The sentinel
 * is that trailing content, and its own position is the direct
 * measurement the acceptance criterion asks for.
 */
export const LAZY_SCOPE_SENTINEL_SELECTOR = '[data-cls-sentinel="below-lazy-cover"]';

/**
 * Read the accumulated layout-shift state out of the page.
 *
 * Returns `{ total, scoped, entries, error }` with the numbers
 * rounded to 5 decimals — a layout-shift value is a float with many
 * digits and printing them all implies a precision the measurement
 * does not have.
 */
export async function readLayoutShift(page) {
	const raw = await page.evaluate(() => {
		const state = window.__imageCls ?? { total: 0, scoped: 0, entries: [], error: null };
		return { total: state.total, scoped: state.scoped, entries: state.entries, error: state.error };
	});
	return {
		total: Number(raw.total.toFixed(5)),
		scoped: Number(raw.scoped.toFixed(5)),
		error: raw.error,
		entries: raw.entries.map((entry) => ({ ...entry, value: Number(entry.value.toFixed(5)) })),
	};
}

/**
 * Remove the two reservation mechanisms from the lazy `<img>`.
 *
 * This is how the "before" measurement is produced. It is not a
 * re-implementation of the old component: pre-#486 `PortfolioMediaFigure`
 * emitted exactly `src` / `alt` / `loading` / `decoding` / `class`,
 * and the class carries no ratio, so deleting the `width` / `height`
 * attributes and the inline `aspect-ratio` reproduces that DOM
 * precisely. Emulating beats checking out an old revision because
 * the two states are then measured under identical network, CPU and
 * viewport conditions.
 *
 * Must run BEFORE the image decodes: once the bytes are decoded, the
 * browser derives the ratio from the image itself and removing the
 * attributes no longer changes anything.
 */
export async function stripImageReservation(page) {
	return page.evaluate((selector) => {
		const img = document.querySelector(selector);
		if (!img) return null;
		img.removeAttribute('width');
		img.removeAttribute('height');
		img.style.removeProperty('aspect-ratio');
		const decoded = img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
		return {
			// The reservation really is gone right now. Verified by the
			// caller rather than assumed: React re-applies the inline
			// style during hydration, so a strip that ran before
			// hydration finished can be silently undone.
			hasWidth: img.hasAttribute('width'),
			hasHeight: img.hasAttribute('height'),
			aspectRatio: img.style.aspectRatio,
			decoded,
			src: img.getAttribute('src'),
		};
	}, LAZY_SCOPE_IMG_SELECTOR);
}

/** `await sleep(ms)` without pulling in a dependency. */
export function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
