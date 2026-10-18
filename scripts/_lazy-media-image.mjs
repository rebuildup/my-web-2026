/**
 * Evidence-image budget for `docs/verification/**` (Issue #487).
 *
 * Why the cap is code and not a README sentence
 * ---------------------------------------------
 * The README promises that a rendered verification image that exceeds
 * the budget is not committed. A promise in prose does not keep a
 * future table row, a longer condition string or a taller report from
 * quietly doubling the blob — so the check lives here and the renderer
 * calls it before the file is moved into place.
 *
 * Split out of `render-lazy-media-report.mjs` so `node --test` can
 * assert the behaviour without launching Chromium; the renderer script
 * runs top-level side effects on import and cannot be imported.
 */

/** 300 KB — the ceiling every verification image in this repository respects. */
export const MAX_EVIDENCE_BYTES = 300 * 1024;

/** Render width cap, shared with the review brief for this repository. */
export const MAX_EVIDENCE_WIDTH = 1600;

/**
 * Fail when an evidence image is over budget.
 *
 * @param {number} bytes size of the encoded image
 * @param {string} path  what was being written, for the error message
 * @param {number} [max] budget in bytes
 */
export function assertEvidenceSize(bytes, path, max = MAX_EVIDENCE_BYTES) {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		throw new Error(`evidence image ${path}: size is not a usable number (${bytes})`);
	}
	if (bytes > max) {
		throw new Error(
			`evidence image ${path}: ${Math.round(bytes / 1024)} KB is over the ${Math.round(max / 1024)} KB budget — widen the render, shorten the report, or raise the budget deliberately. Nothing was written.`,
		);
	}
	return bytes;
}
