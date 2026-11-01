/**
 * Fixture — a page with TWO `<h1>` elements (Issue #398).
 *
 * The gate must report `page-multiple-h1` for this file: a reader
 * cannot tell which of the two headings names the page.
 */
export function FailMultipleH1Page() {
	return (
		<main id="main">
			<h1>First title</h1>
			<h1>Second title</h1>
			<h2>Section</h2>
		</main>
	);
}
