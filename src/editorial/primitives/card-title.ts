import { css } from '../../../styled-system/css';

/**
 * Card title — the `xl` heading every entity card shares
 * (ADR-0022 C-5, layout-system.md §4.3).
 *
 * One style for "the name of the thing this card is about":
 * Explore destinations, portfolio index cards, about-page project
 * rows. The ink is declared explicitly (`text.default`) so a Panel
 * or PageSection tone rebinding reaches it — inherited colour keeps
 * the page's computed value and would stay dark on an inverse or
 * colour-field plate (Issue #1110).
 */
export const cardTitleClassName = /*#__PURE__*/ css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: 'xl',
	fontWeight: '700',
	lineHeight: '1.25',
	letterSpacing: '-0.01em',
	color: 'text.default',
});

/**
 * The link INSIDE a card title (ADR-0022 C-6/C-7). The heading is the
 * whole link, so a full-ink rule under every line would shout: the
 * underline stays — with no hue left it is the only affordance — but
 * is drawn in the identifying-rule tone and thickens on hover. One
 * style for every entity card (portfolio index rows, develop/video
 * tracks); a non-link title span (the design mosaic, whose whole tile
 * is the anchor) keeps the same underline minus the focus ring.
 */
export const cardTitleLinkClassName = /*#__PURE__*/ css({
	color: 'inherit',
	textDecoration: 'underline',
	textUnderlineOffset: '0.18em',
	textDecorationThickness: '1px',
	textDecorationColor: 'border.strong',
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '4px',
		borderRadius: '2px',
	},
	_hover: {
		textDecorationThickness: '2px',
		textDecorationColor: 'currentColor',
	},
});
