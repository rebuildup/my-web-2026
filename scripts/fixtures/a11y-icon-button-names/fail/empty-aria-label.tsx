/**
 * Fixture (fail): a name was specified and it is empty.
 *
 * `aria-label=""` reads like the button was named. It was not: the
 * announcement is still nameless.
 */
export function EmptyAriaLabelIconButton() {
	return (
		<>
			{/* biome-ignore lint/a11y/useValidAriaValues: the fixture reproduces the defect on purpose */}
			<button type="button" aria-label="">
				<svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
					<path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2" />
				</svg>
			</button>
		</>
	);
}
