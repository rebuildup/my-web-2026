import { css, cx } from '../../../styled-system/css';

/**
 * Material Symbols icon primitive (Issue #785, design #764).
 *
 * The Tools index uses an icon per Tool so a visitor can tell what a
 * row is before reading it (owner instruction 2026-11-01: ここは
 * かっこよさではなく利便性を意識するべきところなのでアイコンを使う).
 * Issue #823 (owner instruction 2026-11-01: 文字で描いた記号をやめ
 * Material Symbols へ) reuses the same primitive for the OPERATION
 * cues — the `→` that marks a link and the `×` that marks a form
 * error — so a drawn sign is never a character in the text layer.
 * Design #764 selects Google's Material Symbols, so this primitive
 * draws the SHIPPED Material Symbols outline glyphs — not an ad-hoc
 * character set, not an emoji, not an icon font loaded at runtime.
 *
 * The glyph data is a PROP, not a lookup table
 * -------------------------------------------
 * The `d` attribute arrives from the caller, which owns the choice of
 * glyph. The path constants live in two modules, one per consumer:
 *
 *   - `material-symbol-paths.ts` — the glyphs the platform's own
 *     surfaces draw. It is reachable from the client entry shell.
 *   - `material-symbol-tool-paths.ts` — the glyphs only the Tools
 *     index draws. It belongs to that route's own chunk.
 *
 * Why this matters: a module imported by the entry shell AND by a
 * route chunk is hoisted into the entry chunk (the common ancestor of
 * its importers), so one table of every glyph would put ~6.4 KB of
 * path data the entry never draws into the first paint of every route
 * and push the per-route JS budget (Issue #482) over its cap. Passing
 * `d` in keeps each surface's cost to the glyphs that surface draws.
 *
 * Licence: Material Symbols are Apache-2.0
 * (https://github.com/google/material-design-icons). The attribution
 * lives with the path data because the paths are bundled into this
 * repository's source rather than fetched at runtime; the
 * visitor-facing asset inventory (`quality/asset-license-inventory.json`)
 * covers the bytes under `public/`, not these modules.
 *
 * Accessibility: the glyph is purely decorative — the control's own
 * text carries the name and the accessible purpose — so the SVG is
 * `aria-hidden` and its accessible name is never overridden by a
 * `<title>`. A caller that needs a named icon must supply the name on
 * the control, not on the glyph.
 */

/**
 * The glyph is an INLINE box by default.
 *
 * Panda's preflight (the `reset` layer) declares `svg { display: block }`,
 * which would break every place a glyph has to sit inside a line of
 * text — the SVG would become a block of its own and push the words
 * around it onto separate lines. `inline-block` keeps the glyph in
 * the text flow; inside a flex container the box is blockified by the
 * container anyway, so a glyph used as a flex item is unaffected.
 */
const glyphClassName = css({
	display: 'inline-block',
});

export interface MaterialSymbolProps {
	/**
	 * The glyph's path data — the `d` attribute of the 24 px outline
	 * SVG. The caller owns the choice of glyph (see the module header
	 * for the two path modules and for why the data is a prop).
	 */
	readonly d: string;
	/** Rendered edge length in CSS px. Defaults to 24 (the authored size). */
	readonly size?: number;
	readonly className?: string;
}

/**
 * Draw one Material Symbols glyph as an inline SVG.
 *
 * `fill="currentColor"` is inherited from the parent's `color`, so the
 * icon follows the row's text color through hover / focus without a
 * second palette.
 */
export function MaterialSymbol({ d, size = 24, className }: MaterialSymbolProps) {
	return (
		<svg
			aria-hidden="true"
			className={cx(glyphClassName, className)}
			focusable="false"
			height={size}
			viewBox="0 -960 960 960"
			width={size}
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d={d} fill="currentColor" />
		</svg>
	);
}
