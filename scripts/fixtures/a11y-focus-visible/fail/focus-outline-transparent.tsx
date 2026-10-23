/**
 * FAIL fixture — a focus block whose outline CANNOT BE SEEN.
 *
 * WCAG 2.2 SC 2.4.7 (AA): the rule the gate exists to enforce. The
 * outline is declared, so the markup looks answered, but a transparent
 * outline draws nothing — the same defect as removing it, spelled
 * differently. This file must report `focus-indicator-invisible`.
 */
const css = (styles: Record<string, unknown>) => styles;

export const FocusOutlineTransparent = () => (
	<button
		type="button"
		className={css({
			_focus: {
				outline: 'transparent',
			},
		})}
	>
		Open the panel
	</button>
);
