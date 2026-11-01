/**
 * Fixture (fail): a non-empty name was asked for and an empty one was
 * written.
 *
 * `title=""` is the same defect as `aria-label=""`: the attribute is
 * there, the name is not.
 */
export function EmptyTitleIconButton() {
	return (
		<button type="button" title="">
			<svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
				<path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2" />
			</svg>
		</button>
	);
}
