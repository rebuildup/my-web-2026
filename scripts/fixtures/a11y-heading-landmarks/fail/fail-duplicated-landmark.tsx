/**
 * Fixture — a page with TWO `main` landmarks (Issue #398).
 *
 * The gate must report `landmark-duplicated` for this file: two `main`
 * landmarks make the region ambiguous.
 */
export function FailDuplicatedLandmarkPage() {
	return (
		<>
			<main id="main">
				<h1>Page title</h1>
			</main>
			<main>
				<h2>Another region</h2>
			</main>
		</>
	);
}
