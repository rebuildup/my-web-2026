/**
 * Material Symbols glyph paths — the glyphs the platform's own
 * surfaces draw (Issue #823).
 *
 * Each `d` below is the path data of the corresponding 24 px outline
 * SVG from Google's short-term release endpoint
 * (`fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/
 * <name>/default/24px.svg`), inlined so the page renders the icon even
 * when no font request succeeds. `viewBox="0 -960 960 960"` is the
 * coordinate space those glyphs are authored in.
 *
 * Licence: Material Symbols are Apache-2.0
 * (https://github.com/google/material-design-icons). The attribution
 * lives here because the paths are bundled into this repository's
 * source rather than fetched at runtime; the visitor-facing asset
 * inventory (`quality/asset-license-inventory.json`) covers the bytes
 * under `public/`, not this module.
 *
 * WHY THE GLYPH DATA IS SPLIT BY CONSUMER (Issue #823, bundle budget)
 * ------------------------------------------------------------------
 * The path data reaches `MaterialSymbol` as a `d` PROP instead of
 * being looked up in a table inside the primitive, and the glyphs are
 * grouped into one module per consumer:
 *
 *   - this module: the glyphs the platform's own surfaces draw (the
 *     link arrow, the form error mark). It is reachable from the
 *     client entry shell, so it must stay small.
 *   - `material-symbol-tool-paths.ts`: the glyphs only the Tools
 *     index draws. That module is imported by that route alone, so it
 *     lands in the route's own chunk and never in the entry shell.
 *
 * One table holding every glyph would defeat both. A module imported
 * by the entry shell AND by a route chunk is hoisted into the entry
 * chunk (the common ancestor of its importers), so the whole table
 * would land in the first paint of every route — ~6.4 KB of path data
 * the entry never draws — and push the per-route JS budget
 * (Issue #482) over its cap.
 *
 * Sources of the two paths below (Apache-2.0, one URL per glyph):
 *   - arrow_forward: https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/arrow_forward/default/24px.svg
 *   - close:         https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/close/default/24px.svg
 */

/** The link / navigation arrow — `arrow_forward`. */
export const ARROW_FORWARD_PATH =
	'M647-440H160v-80h487L423-744l57-56 320 320-320 320-57-56 224-224Z';

/** The form error mark — `close`. */
export const CLOSE_PATH =
	'm256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z';
