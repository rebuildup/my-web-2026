/**
 * Fixture (pass): an icon-only button named by an existing element.
 *
 * `aria-labelledby` is the mechanism that needs no new wording: the
 * name is already on the page, and the reference resolves to an id
 * this very file declares.
 */
export function LabelledByIconButton() {
	return (
		<>
			<span id="fixture-labelledby-label">Search</span>
			<button type="button" aria-labelledby="fixture-labelledby-label">
				<svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
					<circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
				</svg>
			</button>
		</>
	);
}
