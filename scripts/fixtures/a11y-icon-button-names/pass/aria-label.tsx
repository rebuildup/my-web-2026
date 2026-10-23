/**
 * Fixture (pass): an icon-only button named by `aria-label`.
 *
 * The label is the mechanism the gate accepts first: it names the
 * control without adding anything a sighted reader has to look at.
 */
export function AriaLabelIconButton() {
	return (
		<button type="button" aria-label="Close">
			<svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
				<path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2" />
			</svg>
		</button>
	);
}
