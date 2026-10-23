/**
 * Fixture — a page whose landmarks are correct and whose headings stay
 * inside one level (Issue #398).
 *
 * One `<h1>`, one `main` landmark, no skipped level. The gate must
 * report NO violation for this file.
 */
export function PassLandmarkPage() {
	return (
		<main id="main">
			<h1>Another page title</h1>
			<section>
				<h2>Section</h2>
				<h2>Another section</h2>
			</section>
		</main>
	);
}
