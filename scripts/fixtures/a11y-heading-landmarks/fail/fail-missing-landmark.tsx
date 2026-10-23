/**
 * Fixture — a page with NO `main` landmark (Issue #398).
 *
 * The gate must report `page-missing-landmark` for this file: the page
 * body is not exposed as a region.
 */
export function FailMissingLandmarkPage() {
	return (
		<div>
			<h1>Page title</h1>
			<section>
				<h2>Section</h2>
			</section>
		</div>
	);
}
