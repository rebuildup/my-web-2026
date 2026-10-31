/**
 * Fixture (pass): an icon-only button named by a non-empty `title`.
 *
 * `title` is the last-resort mechanism: it is what a browser shows as
 * a tooltip, so a reader can still reach the name.
 */
export function TitleIconButton() {
	return (
		<button type="button" title="Open menu">
			<svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
				<path d="M2 4h12M2 8h12M2 12h12" fill="none" stroke="currentColor" strokeWidth="2" />
			</svg>
		</button>
	);
}
