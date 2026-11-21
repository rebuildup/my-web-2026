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
