/**
 * Fixture (fail): an icon-only button with no name mechanism at all.
 *
 * The icon is the whole button, so a screen reader announces
 * "button" and stops. Nothing here can supply a name.
 */
export function MissingNameIconButton() {
	return (
		<button type="button">
			<svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
				<path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2" />
			</svg>
		</button>
	);
}
