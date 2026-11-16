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
 * Sources of the paths below (Apache-2.0, one URL per glyph):
 *   - arrow_forward:       https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/arrow_forward/default/24px.svg
 *   - close:               https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/close/default/24px.svg
 *   - person:              https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/person/default/24px.svg
 *   - computer:            https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/computer/default/24px.svg
 *   - phone_android:       https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/phone_android/default/24px.svg
 *   - videogame_asset:     https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/videogame_asset/default/24px.svg
 *   - headphones:          https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/headphones/default/24px.svg
 *   - tv:                  https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/tv/default/24px.svg
 *   - live_tv:             https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/live_tv/default/24px.svg
 *   - emoticons:           https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/emoticons/default/24px.svg
 *   - sports_esports:      https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/sports_esports/default/24px.svg
 */

/** The link / navigation arrow — `arrow_forward`. */
export const ARROW_FORWARD_PATH =
	'M647-440H160v-80h487L423-744l57-56 320 320-320 320-57-56 224-224Z';

/** The form error mark — `close`. */
export const CLOSE_PATH =
	'm256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z';

/** The person glyph — `person`. */
export const PERSON_PATH =
	'M480-80q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm0-160q33 0 56.5-23.5T560-320q0-33-23.5-56.5T480-400q-33 0-56.5 23.5T400-320q0 33 23.5 56.5T480-240Zm0-320q88 0 151.5 54T880-360q0 30-12 57.5t-33.5 50.5q-67 73-137 103.5T480-80q-80 0-150-30.5T160-303.5q-21-23.5-33.5-50.5T120-360q0-80 63.5-134T480-560Z';

/** The computer glyph — `computer`. */
export const COMPUTER_PATH =
	'M80-80q-33 0-56.5-23.5T0-160v-520q0-33 23.5-56.5T80-800h640q33 0 56.5 23.5T800-720v520q0 33-23.5 56.5T720-80H80Zm0-80h640v-480H80v480Zm120-120v-240h400v240H200Z';

/** The phone android glyph — `phone_android`. */
export const PHONE_ANDROID_PATH =
	'M80-80q-33 0-56.5-23.5T0-160v-560q0-33 23.5-56.5T80-800h280v-80h160v80h280q33 0 56.5 23.5T880-720v560q0 33-23.5 56.5T800-80H80Zm0-80h640v-400H80v400Zm80-120h480v-240H160v240Zm160-280h160v-80H320v80Z';

/** The videogame asset glyph — `videogame_asset`. */
export const VIDEOGAME_ASSET_PATH =
	'M440-80q-17 0-28.5-11.5T400-120v-40q0-17 11.5-28.5T440-200h80q17 0 28.5 11.5T560-160v40q0 17-11.5 28.5T520-80H440Zm-40-40v-80h80v80h-80Zm200 0v-80h80v80h-80Zm-120-80v-240h160v240H520ZM120-280q-33 0-56.5-23.5T40-360v-160q0-33 23.5-56.5T120-560h240v-80H120v-80h480v80H320v80h280q33 0 56.5 23.5T880-400v160q0 33-23.5 56.5T800-160H360v-80h120v80H120Zm40-80h280v-80H160v80Zm240-160h-40v-80h40v80Zm-80 0h-40v-80h40v80Zm-80 0h-40v-80h40v80Z';

/** The headphones glyph — `headphones`. */
export const HEADPHONES_PATH =
	'M480-80q-83 0-141.5-58.5T280-240q0-41 18.5-77.5T400-400h-80v-160q0-33 23.5-56.5T360-640h160q33 0 56.5 23.5T560-560v160h-80q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-240q0 40-28.5 77T400-80h80q33 0 56.5 23.5T520-40q0 33-23.5 56.5T480-80Zm0-80q17 0 28.5-11.5T520-200q0-17-11.5-28.5T480-240q-17 0-28.5 11.5T440-200q0 17 11.5 28.5T480-160Zm160-320q0-17-11.5-28.5T560-480q-17 0-28.5 11.5T520-440q0 17 11.5 28.5T560-400q17 0 28.5-11.5T640-440v-80q0-33-23.5-56.5T560-600h-160q-33 0-56.5 23.5T360-520v80q0 33 23.5 56.5T440-400h80q33 0 56.5-23.5T520-480q0-17-11.5-28.5T480-520q-17 0-28.5 11.5T440-480q0 17 11.5 28.5T480-440Zm-320 0q0-17-11.5-28.5T240-480q-17 0-28.5 11.5T200-440q0 17 11.5 28.5T240-400q17 0 28.5-11.5T320-440v-80q0-33-23.5-56.5T240-600h-160q-33 0-56.5 23.5T40-520v80q0 33 23.5 56.5T120-400h80q33 0 56.5-23.5T200-480q0-17-11.5-28.5T160-520q-17 0-28.5 11.5T120-480q0 17 11.5 28.5T160-440Z';

/** The TV glyph — `tv`. */
export const TV_PATH =
	'M40-160q-33 0-56.5-23.5T0-240v-360q0-33 23.5-56.5T40-640h240v-80h480v80h240q33 0 56.5 23.5T880-560v360q0 33-23.5 56.5T840-160H40Zm0-80h800v-360H40v360Zm120-120h600v-200H160v200Z';

/** The live TV glyph — `live_tv`. */
export const LIVE_TV_PATH =
	'M40-160q-33 0-56.5-23.5T0-240v-360q0-33 23.5-56.5T40-640h240v-80h480v80h240q33 0 56.5 23.5T880-560v360q0 33-23.5 56.5T840-160H40Zm0-80h800v-360H40v360Zm120-120h600v-200H160v200Zm160 80q-17 0-28.5-11.5T240-240q0-17 11.5-28.5T280-280q17 0 28.5 11.5T320-240q0 17-11.5 28.5T280-200Zm200 0q-17 0-28.5-11.5T440-240q0-17 11.5-28.5T480-280q17 0 28.5 11.5T520-240q0 17-11.5 28.5T480-200Zm200 0q-17 0-28.5-11.5T640-240q0-17 11.5-28.5T680-280q17 0 28.5 11.5T720-240q0 17-11.5 28.5T680-200Zm-400-120h400v-80H160v80Z';

/** The emoticons glyph — `emoticons`. */
export const EMOTICONS_PATH =
	'M480-80q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm0-160q33 0 56.5-23.5T560-320q0-33-23.5-56.5T480-400q-33 0-56.5 23.5T400-320q0 33 23.5 56.5T480-240Zm-120-240q-17 0-28.5-11.5T320-560q0-17 11.5-28.5T360-600q17 0 28.5 11.5T400-560q0 17-11.5 28.5T360-520Zm240 0q-17 0-28.5-11.5T560-560q0-17 11.5-28.5T600-600q17 0 28.5 11.5T640-560q0 17-11.5 28.5T600-520Zm-120-120q-33 0-56.5-23.5T360-720q0-33 23.5-56.5T480-800q33 0 56.5 23.5T600-720q0 33-23.5 56.5T480-640Z';

/** The sports esports glyph — `sports_esports`. */
export const SPORTS_ESPORTS_PATH =
	'M480-80q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm0-160q33 0 56.5-23.5T560-320q0-33-23.5-56.5T480-400q-33 0-56.5 23.5T400-320q0 33 23.5 56.5T480-240Zm-200-200q-17 0-28.5-11.5T240-560q0-17 11.5-28.5T280-600q17 0 28.5 11.5T320-560q0 17-11.5 28.5T280-520Zm160 40q-33 0-56.5-23.5T360-520q0-33 23.5-56.5T480-640q33 0 56.5 23.5T600-520q0 33-23.5 56.5T480-400Zm240-40q-17 0-28.5-11.5T560-560q0-17 11.5-28.5T600-600q17 0 28.5 11.5T640-560q0 17-11.5 28.5T600-520Zm-160 80h-40v-80h40v80Zm80 0h-40v-80h40v80Z';
