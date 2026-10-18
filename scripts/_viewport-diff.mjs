/**
 * Shared pixel-diff contract for the viewport regression gate
 * (Issue #417).
 *
 * One definition of "how two viewport captures are compared", used by
 * BOTH consumers:
 *
 *   - `e2e/viewport/visual-diff.spec.ts` — the gate (red on a layout
 *     change it can see),
 *   - `scripts/make-viewport-diff-grid-report.mjs` — the evidence
 *     WebP in `docs/verification/compat/viewport-diff-grid.webp`.
 *
 * They must not drift. A report that printed a ratio computed with a
 * looser tolerance than the gate asserted would be a false green
 * (skills/quality-gate §14), so the thresholds below are constants
 * rather than per-call options, and `renderOverlay` is the only
 * function that decides what "red" looks like.
 *
 * What is compared, and what is deliberately not
 * ----------------------------------------------
 *   The two raster sides are produced by the SAME browser build in
 *   the SAME run (baseline capture → current capture), so a diff is
 *   attributable to the page, not to a font or platform difference
 *   between two machines. This module never compares a committed
 *   baseline against another machine's capture — that comparison is
 *   the source of the "誤検知" (false positive) this Issue forbids,
 *   and it stays out of the gate until the capture environment is
 *   pinned to one image (recorded as an open decision in the PR).
 *
 * Conditions and why each one is pinned
 * -------------------------------------
 *
 *   `DIFF_CHANNEL_TOLERANCE` — a screenshot re-encoded through the
 *   same pipeline can move a channel by a unit or two without a pixel
 *   having been repainted. Comparing channels exactly would make the
 *   gate report a change for AA noise. 16/255 (~6%) is well below any
 *   real layout change: a one-column reflow moves hundreds of pixels
 *   past it.
 *
 *   `STABLE_MAX_RATIO` — the false-positive guard. Re-capturing an
 *   unchanged page must stay at 0 changed pixels; the small allowance
 *   covers caret / focus-ring / animation-phase differences that are
 *   not layout. A run that exceeds it is reported as an unstable
 *   capture rather than silently averaged away.
 *
 *   `MIN_BREAKAGE_RATIO` — the sensitivity floor. A deliberate layout
 *   break must exceed it, otherwise a diff engine that silently
 *   returned "no difference" would pass every control below. The
 *   window between the two constants is what makes the gate
 *   falsifiable rather than decorative.
 */

/**
 * Per-channel difference (0-255) below which a pixel counts as
 * unchanged. See the header.
 */
export const DIFF_CHANNEL_TOLERANCE = 16;

/**
 * Maximum share of changed pixels two captures of the SAME unchanged
 * page may differ by (`0.2%`).
 */
export const STABLE_MAX_RATIO = 0.002;

/**
 * Minimum share of changed pixels a deliberate layout break must
 * produce (`1%`). Strictly greater than `STABLE_MAX_RATIO`; the
 * constants are asserted against each other in the unit test so the
 * window can never close silently.
 */
export const MIN_BREAKAGE_RATIO = 0.01;

/** RGB written on every pixel the diff considers changed. */
export const OVERLAY_CHANGED_RGB = [192, 32, 42];

/**
 * Luminance weight applied to an unchanged pixel before it is written
 * into the overlay, so the red stays readable against page content.
 */
export const OVERLAY_DIM_FACTOR = 0.28;

/**
 * Decode a PNG into a raw RGBA raster.
 *
 * `ensureAlpha()` normalises channels, so a caller never has to know
 * whether the source PNG had an alpha plane.
 */
export async function decodePng(png) {
	const sharp = (await import('sharp')).default;
	const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	return { data, width: info.width, height: info.height, channels: info.channels };
}

/**
 * Compare two rasters of the same size.
 *
 * Returns a 1-byte-per-pixel mask alongside the counts so the caller
 * can render an overlay without recomputing the comparison.
 *
 * Throws on a size mismatch: two captures of different viewports are
 * not comparable, and silently comparing the overlapping corner would
 * report a difference (or a match) that says nothing about either
 * side.
 */
export function diffRasters(baseline, current) {
	if (baseline.width !== current.width || baseline.height !== current.height) {
		throw new Error(
			`raster size mismatch: baseline ${baseline.width}x${baseline.height} vs current ${current.width}x${current.height}`,
		);
	}
	const { width, height, channels } = current;
	const totalPixels = width * height;
	const changed = new Uint8Array(totalPixels);
	let changedPixels = 0;

	for (let pixel = 0; pixel < totalPixels; pixel += 1) {
		const offset = pixel * channels;
		const delta = Math.max(
			Math.abs(current.data[offset] - baseline.data[offset]),
			Math.abs(current.data[offset + 1] - baseline.data[offset + 1]),
			Math.abs(current.data[offset + 2] - baseline.data[offset + 2]),
		);
		if (delta > DIFF_CHANNEL_TOLERANCE) {
			changed[pixel] = 1;
			changedPixels += 1;
		}
	}

	return {
		width,
		height,
		changed,
		changedPixels,
		totalPixels,
		ratio: totalPixels === 0 ? 0 : changedPixels / totalPixels,
	};
}

/**
 * Paint the current raster with every changed pixel in red and every
 * unchanged pixel dimmed, so "where did it move" is legible in a
 * single image.
 */
export function renderOverlay(current, changed) {
	const { width, height, channels } = current;
	const out = Buffer.alloc(width * height * 4);
	for (let pixel = 0; pixel < width * height; pixel += 1) {
		const offset = pixel * channels;
		const target = pixel * 4;
		if (changed[pixel]) {
			out[target] = OVERLAY_CHANGED_RGB[0];
			out[target + 1] = OVERLAY_CHANGED_RGB[1];
			out[target + 2] = OVERLAY_CHANGED_RGB[2];
		} else {
			const luminance =
				0.2126 * current.data[offset] +
				0.7152 * current.data[offset + 1] +
				0.0722 * current.data[offset + 2];
			const dim = Math.round(luminance * OVERLAY_DIM_FACTOR);
			out[target] = dim;
			out[target + 1] = dim;
			out[target + 2] = dim;
		}
		out[target + 3] = 255;
	}
	return out;
}

/**
 * Compare two PNG buffers end to end.
 *
 * `overlay` is a PNG of the red diff view, so the caller can persist
 * the evidence without re-deriving it. Passing `overlay: false`
 * skips that encoding when only the ratio is needed.
 */
export async function comparePng(baselinePng, currentPng, { overlay = true } = {}) {
	const baseline = await decodePng(baselinePng);
	const current = await decodePng(currentPng);
	const result = diffRasters(baseline, current);

	return {
		changedPixels: result.changedPixels,
		totalPixels: result.totalPixels,
		ratio: result.ratio,
		width: result.width,
		height: result.height,
		stable: result.ratio <= STABLE_MAX_RATIO,
		broken: result.ratio >= MIN_BREAKAGE_RATIO,
		...(overlay
			? {
					overlayPng: await encodeRaster(
						renderOverlay(current, result.changed),
						result.width,
						result.height,
					),
				}
			: {}),
	};
}

async function encodeRaster(raw, width, height) {
	const sharp = (await import('sharp')).default;
	return sharp(raw, { raw: { width, height, channels: 4 } })
		.png()
		.toBuffer();
}
