import { css } from '../../../styled-system/css';

/**
 * Default visual style for the `<Breadcrumbs />` primitive
 * (Issue #199).
 *
 * The component itself is style-agnostic (see `Breadcrumbs.tsx`) —
 * it renders only the semantic markup for the chain and accepts
 * styling via a `className` prop. This module is the design-system
 * helper that pages opt-in to when they want the standard breadcrumb
 * chrome without re-deriving every descendant selector. Pages with
 * a custom breadcrumb look pass their own `className` instead and
 * skip this import.
 *
 * The styled helper is intentionally kept in a SEPARATE file from
 * `Breadcrumbs.tsx` so the structural primitive carries no
 * styling-framework dependency. The component file is safe to
 * import from any styling context; this file is what couples
 * the design to Panda CSS.
 *
 * **DOM structure** (matches the markup emitted by `Breadcrumbs`):
 *
 * ```html
 * <nav className={...}>
 *   <ol>
 *     <li>
 *       <a>...</a> / <span aria-current="page">...</span>
 *       <span aria-hidden="true">/</span>
 *     </li>
 *     ...
 *   </ol>
 * </nav>
 * ```
 */
export const breadcrumbsChrome = css({
	fontFamily: 'sans',
	color: 'text.muted',
	// Constant `xs` (12px) at every viewport — a breadcrumb that
	// grows with the screen reads as a header, not a navigation aid.
	fontSize: 'xs',
	lineHeight: '1.5',
	paddingBlock: '1',
	// Hairline bottom border separates the chain from the page
	// content without giving it header chrome. The band stays
	// full-bleed (this is the border owner) — only the chain text
	// is put on the grid.
	borderBlockEndWidth: '1px',
	borderBlockEndStyle: 'solid',
	borderBlockEndColor: 'border.subtle',
	'& ol': {
		// Issue #300: the chain hung at x=8 (`paddingInline: 2` on
		// the full-width band) while every other public element
		// starts at the Container content edge (x=160 at 1280px).
		// The `<ol>` now reproduces the Container geometry exactly —
		// max-width 1024, centred, responsive paddingInline 4/6/8 —
		// so the first breadcrumb sits on the same left key line as
		// the page titles. At ≤1024px the band equals the viewport
		// and the padding alone matches the Container.
		maxWidth: '1024px',
		marginInline: 'auto',
		paddingInline: { base: '4', md: '6', lg: '8' },
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'center',
		gap: '1',
		marginBlock: '0',
		paddingBlock: '0',
		listStyle: 'none',
	},
	'& li': {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '1',
		minWidth: '0',
	},
	'& a': {
		color: 'text.muted',
		textDecoration: 'none',
		borderRadius: 'sm',
		paddingInline: '1',
		paddingBlock: '1',
		transition: 'color 120ms ease',
		_hover: { color: 'text.default', textDecoration: 'underline' },
		_focusVisible: {
			outline: '2px solid {colors.border.focus}',
			outlineOffset: '2px',
			color: 'text.default',
		},
	},
	'& [aria-current="page"]': {
		// `500` (medium) so the current page reads as the chain's
		// terminal without tipping into the 600/700 weight band that
		// headings occupy.
		color: 'text.default',
		fontWeight: '500',
		// Truncate an unexpectedly long project title so it does not
		// push the next viewport-overflow bug.
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		maxWidth: '100%',
	},
	'& [aria-hidden="true"]': {
		color: 'text.muted',
		userSelect: 'none',
	},
});
