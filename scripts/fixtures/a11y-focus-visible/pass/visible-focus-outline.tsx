/**
 * PASS fixture — a focus block that KEEPS a visible focus indicator.
 *
 * WCAG 2.2 SC 2.4.7 (AA): the focused component has a visible focus
 * indicator. This file must produce NO violation.
 *
 * The style entry point is stubbed so the fixture stays self-contained:
 * the gate reads the SOURCE TEXT, so the shape of the `css({...})` call
 * is what it decides on, and a fixture that imported the generated
 * stylesheet would depend on a build artefact that is not committed.
 */
const css = (styles: Record<string, unknown>) => styles;

export const VisibleFocusOutline = () => (
	<a
		href="/portfolio"
		className={css({
			color: 'text.default',
			_focusVisible: {
				outline: '2px solid #2b6cb0',
				outlineOffset: '2px',
			},
		})}
	>
		Portfolio
	</a>
);
