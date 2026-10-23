/**
 * FAIL fixture — a focus block that REMOVES the focus indicator.
 *
 * WCAG 2.2 SC 2.4.7 (AA): the rule the gate exists to enforce. The
 * outline is gone and nothing replaces it, so the element has no visible
 * focus at all. This file must report `focus-indicator-removed`.
 */
const css = (styles: Record<string, unknown>) => styles;

export const FocusOutlineRemoved = () => (
	<a
		href="/portfolio"
		className={css({
			color: 'text.default',
			_focusVisible: {
				outline: 'none',
			},
		})}
	>
		Portfolio
	</a>
);
