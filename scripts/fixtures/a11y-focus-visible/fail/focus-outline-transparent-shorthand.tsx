/**
 * FAIL fixture — a focus block whose outline CANNOT BE SEEN, spelled as a
 * full shorthand.
 *
 * WCAG 2.2 SC 2.4.7 (AA): `outline: '2px solid transparent'` declares a
 * width and a style, so it reads as a visible ring, but the colour is
 * transparent and nothing is drawn. It is the same defect as
 * `outline: 'transparent'` in the spelling real stylesheets actually use.
 * This file must report `focus-indicator-invisible`.
 */
const css = (styles: Record<string, unknown>) => styles;

export const FocusOutlineTransparentShorthand = () => (
	<button
		type="button"
		className={css({
			_focus: {
				outline: '2px solid transparent',
			},
		})}
	>
		Open the panel
	</button>
);
