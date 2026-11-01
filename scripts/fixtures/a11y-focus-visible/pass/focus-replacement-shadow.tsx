/**
 * PASS fixture — a focus block that removes the outline and REPLACES it.
 *
 * WCAG 2.2 SC 2.4.7 (AA): the indicator does not have to be an outline.
 * A focus block that drops the outline but draws its own ring still shows
 * the focus, so this file must produce NO violation.
 */
const css = (styles: Record<string, unknown>) => styles;

export const FocusReplacementShadow = () => (
	<button
		type="button"
		className={css({
			_focusVisible: {
				outline: 'none',
				boxShadow: '0 0 0 2px #2b6cb0',
			},
		})}
	>
		Open the panel
	</button>
);
