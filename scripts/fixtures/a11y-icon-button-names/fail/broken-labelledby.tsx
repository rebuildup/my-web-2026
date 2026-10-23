/**
 * Fixture (fail): `aria-labelledby` points at an id this file does not
 * declare.
 *
 * The reference resolves to nothing, so the button is nameless while
 * the source reads as if it were named.
 */
export function BrokenLabelledByIconButton() {
	return (
		<button type="button" aria-labelledby="fixture-missing-label">
			<svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
				<circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
			</svg>
		</button>
	);
}
