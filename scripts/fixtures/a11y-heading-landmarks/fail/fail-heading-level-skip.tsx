/**
 * Fixture — a page whose heading levels skip one level (Issue #398).
 *
 * The gate must report `page-heading-level-skip` for this file: the
 * outline goes from `<h1>` to `<h3>`, so the nesting the second level
 * carries is lost.
 */
export function FailLevelSkipPage() {
	return (
		<main id="main">
			<h1>Page title</h1>
			<section>
				<h3>Section that skipped a level</h3>
			</section>
		</main>
	);
}
