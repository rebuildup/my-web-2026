/**
 * Fixture — a page whose outline and landmarks are correct (Issue #398).
 *
 * One `<h1>`, contiguous heading levels, exactly one `main` landmark.
 * The gate must report NO violation for this file.
 */
export function PassOutlinePage() {
	return (
		<main id="main">
			<h1>Page title</h1>
			<section>
				<h2>First section</h2>
				<h3>Detail of the first section</h3>
			</section>
			<section>
				<h2>Second section</h2>
			</section>
		</main>
	);
}
