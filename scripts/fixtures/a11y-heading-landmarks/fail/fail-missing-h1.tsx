/**
 * Fixture — a page with NO `<h1>` element (Issue #398).
 *
 * The gate must report `page-missing-h1` for this file: the document
 * has no title to announce. The page still renders a `main` landmark,
 * so it is a page and not a shared component.
 */
export function FailMissingH1Page() {
	return (
		<main id="main">
			<h2>Section without a page title</h2>
			<h3>Detail</h3>
		</main>
	);
}
