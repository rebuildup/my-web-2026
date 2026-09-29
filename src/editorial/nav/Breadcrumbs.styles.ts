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
	// Tight padding so the chain does not claim a full band of
	// vertical space.
	paddingInline: '2',
	paddingBlock: '1',
	// Hairline bottom border separates the chain from the page
	// content without giving it header chrome.
	borderBlockEndWidth: '1px',
	borderBlockEndStyle: 'solid',
	borderBlockEndColor: 'border.subtle',
	'& ol': {
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'center',
		gap: '1',
		margin: '0',
		padding: '0',
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
