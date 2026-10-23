/**
 * Fixture (pass): an icon-only button named by a visually hidden label.
 *
 * The label is in the accessibility tree and not on the screen, so the
 * button still SHOWS nothing but an icon — and still has a name.
 */
export function HiddenLabelIconButton() {
	return (
		<button type="button">
			<svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
				<path d="M2 4h12M2 8h12M2 12h12" fill="none" stroke="currentColor" strokeWidth="2" />
			</svg>
			<span className="sr-only">Open menu</span>
		</button>
	);
}
